# Copyright (c) 2026 OceanBase.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Capture complete PDF documents as revision-stable, page-level evidence."""

# ruff: noqa: TRY003, TRY300, TRY301 -- Public validation failures intentionally use ValueError.

from __future__ import annotations

import hashlib
import io
import math
import re
from collections import Counter
from typing import Any
from urllib.parse import quote

from pydantic import BaseModel
from pypdf import PdfReader

from powercontext.builtin.artifacts.memory.models import MemoryCitation, MemoryHit
from powercontext.builtin.runtime.models import SearchMemoryRequest
from powercontext.limits import MAX_SOURCE_ID_LENGTH
from powercontext.sources.definitions import AdapterSourceDefinition
from powercontext.sources.models import Source, SourceMaterialization
from powercontext.sources.projections import TEXT_EVIDENCE_PROJECTION_KEY, TextEvidence


class PDFDocumentInput(BaseModel):
    document_id: str
    content: bytes


class PDFPageInput(BaseModel):
    document_id: str
    document_sha256: str
    page_number: int
    text: str


class PDFPageSource(Source):
    source_id: str
    document_id: str
    document_sha256: str
    page_number: int
    text: str


def parse_pdf_document(value: PDFDocumentInput) -> tuple[PDFPageInput, ...]:
    """Parse every physical page before returning any revision-bound page values."""

    _validate_document_id(value.document_id)
    if not value.content:
        raise ValueError("PDF content must not be empty")
    digest = hashlib.sha256(value.content).hexdigest()
    try:
        reader = PdfReader(io.BytesIO(value.content), strict=True)
        if reader.is_encrypted and not reader.decrypt(""):
            raise ValueError("PDF requires a non-empty password")
        pages = tuple(
            PDFPageInput(
                document_id=value.document_id,
                document_sha256=digest,
                page_number=number,
                text=page.extract_text() or "",
            )
            for number, page in enumerate(reader.pages, start=1)
        )
        if not pages:
            raise ValueError("PDF document has no pages")
        for page in pages:
            _pdf_page_source_id(page.document_id, page.document_sha256, page.page_number)
        return pages
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("PDF document could not be parsed completely") from error


class PDFPageSourceAdapter:
    input_class = PDFPageInput
    name = "pdf-page"
    source_class = PDFPageSource

    async def resolve(self, value: PDFPageInput, /) -> PDFPageSource:
        source_id = _pdf_page_source_id(value.document_id, value.document_sha256, value.page_number)
        return PDFPageSource(
            name=source_id,
            source_id=source_id,
            materialization=SourceMaterialization.CAPTURED,
            document_id=value.document_id,
            document_sha256=value.document_sha256,
            page_number=value.page_number,
            text=value.text,
        )

    async def read(self, source: PDFPageSource, /) -> PDFPageInput:
        return PDFPageInput(
            document_id=source.document_id,
            document_sha256=source.document_sha256,
            page_number=source.page_number,
            text=source.text,
        )


class PDFPageTextEvidenceProjection:
    name = TEXT_EVIDENCE_PROJECTION_KEY.name
    version = TEXT_EVIDENCE_PROJECTION_KEY.version
    source_class = PDFPageSource
    output_class: type[BaseModel] = TextEvidence

    def project(self, source: PDFPageSource, /) -> TextEvidence:
        return TextEvidence(
            source_type="pdf-page",
            source_id=source.source_id,
            content=f"{source.document_id}\n{source.text}",
            metadata={
                "document_id": source.document_id,
                "document_sha256": source.document_sha256,
                "page_number": source.page_number,
            },
        )


PDF_PAGE_SOURCE_DEFINITION = AdapterSourceDefinition(
    PDFPageSourceAdapter(),
    projections=(PDFPageTextEvidenceProjection(),),
)


async def search_pdf_pages(memory: Any, question: str, limit: int = 10) -> tuple[MemoryCitation, ...]:
    """Return distinct exact page citations from the scoped Memory search API."""

    if not isinstance(question, str) or not question.strip():
        raise ValueError("question must contain non-whitespace text")
    if type(limit) is not int or limit < 1:
        raise ValueError("limit must be a positive integer")
    candidate_limit = min(max(limit * 5, 20), 100)
    section_cues = _pdf_section_cues(question)
    result_sets, query_weights, informative_terms = await _pdf_search_candidates(
        memory, question, section_cues, candidate_limit
    )
    fused_scores: dict[tuple[str, int, str, str], float] = {}
    fused_hits: dict[tuple[str, int, str, str], MemoryHit] = {}
    rank_constant = 60
    for query, hits in result_sets.items():
        query_weight = query_weights[query]
        for rank, hit in enumerate(hits, start=1):
            identity = _pdf_hit_identity(hit)
            fused_scores[identity] = fused_scores.get(identity, 0.0) + query_weight / (rank_constant + rank)
            fused_hits.setdefault(identity, hit)

    # A long financial question can need several distinct statements. Keep the
    # actual section pages found through Memory in the result before filling the
    # remaining slots with the fused ranking.
    anchors: list[tuple[str, int, str, str]] = []
    for query, marker, prefer_start, count in section_cues:
        for hit in _pdf_section_hits(result_sets[query], marker, prefer_start=prefer_start, count=count):
            identity = _pdf_hit_identity(hit)
            if identity not in anchors:
                anchors.append(identity)
    lexical_scores = _pdf_lexical_scores(fused_hits, informative_terms)
    peak_fusion = max(fused_scores.values(), default=1.0)
    ranked = sorted(
        fused_scores,
        key=lambda identity: (
            -(0.7 * fused_scores[identity] / peak_fusion + 0.3 * lexical_scores[identity]),
            identity,
        ),
    )
    selected = tuple(dict.fromkeys((*anchors, *ranked)))[:limit]
    return tuple(
        MemoryCitation(
            memory_ref=fused_hits[identity].memory_ref,
            entry_id=fused_hits[identity].entry_id,
            entry_version_id=fused_hits[identity].entry_version_id,
        )
        for identity in selected
    )


async def _pdf_search_candidates(
    memory: Any,
    question: str,
    section_cues: tuple[tuple[str, str, bool, int], ...],
    candidate_limit: int,
) -> tuple[dict[str, tuple[MemoryHit, ...]], dict[str, float], tuple[str, ...]]:
    query_weights: dict[str, float] = {}
    for index, query in enumerate(_pdf_query_variants(question)):
        query_weights[query] = max(query_weights.get(query, 0.0), (1.5, 1.25)[index] if index < 2 else 0.75)
    for query, _marker, _prefer_start, _count in section_cues:
        query_weights[query] = max(query_weights.get(query, 0.0), 0.8)
    result_sets: dict[str, tuple[MemoryHit, ...]] = {}
    for query in query_weights:
        result_sets[query] = (
            await memory.search(SearchMemoryRequest(query=query, mode="fts", limit=candidate_limit))
        ).hits

    # Broad financial terms can fill an FTS candidate cap before a distinctive
    # question term is considered. Search a few such terms on their own when the
    # first pass barely found them; all candidates still come from scoped Memory.
    informative_terms = _pdf_informative_terms(question)
    initial_texts = {
        _pdf_hit_identity(hit): set(re.findall(r"[a-z]+|\d+", hit.text.casefold()))
        for hits in result_sets.values()
        for hit in hits
    }
    coverage = Counter(term for tokens in initial_texts.values() for term in set(informative_terms) & tokens)
    rare_terms = sorted(
        (term for term in set(informative_terms) if len(term) >= 4 and not term.isdigit()),
        key=lambda term: (coverage[term], -len(term), term),
    )
    for term in rare_terms[:4]:
        if term not in result_sets and coverage[term] < max(len(initial_texts) // 3, 1):
            query_weights[term] = 0.4
            result_sets[term] = (
                await memory.search(SearchMemoryRequest(query=term, mode="fts", limit=candidate_limit))
            ).hits
    return result_sets, query_weights, informative_terms


def _pdf_hit_identity(hit: MemoryHit) -> tuple[str, int, str, str]:
    return (hit.memory_ref.artifact_id, hit.memory_ref.revision, hit.entry_id, hit.entry_version_id)


def _pdf_lexical_scores(
    hits: dict[tuple[str, int, str, str], MemoryHit], terms: tuple[str, ...]
) -> dict[tuple[str, int, str, str], float]:
    """Favor distinctive question vocabulary while discounting repeated filing boilerplate."""

    question_terms = set(terms)
    page_terms = {identity: set(re.findall(r"[a-z]+|\d+", hit.text.casefold())) for identity, hit in hits.items()}
    document_frequency = Counter(term for tokens in page_terms.values() for term in question_terms & tokens)
    page_count = len(page_terms)
    term_weights = {
        term: math.log((page_count + 1) / (document_frequency[term] + 1))
        for term in question_terms
        if document_frequency[term]
    }
    total_weight = sum(term_weights.values())
    return {
        identity: (
            sum(term_weights.get(term, 0.0) for term in question_terms & tokens) / total_weight if total_weight else 0.0
        )
        for identity, tokens in page_terms.items()
    }


def _pdf_section_cues(question: str) -> tuple[tuple[str, str, bool, int], ...]:
    """Find filing section names implied by a question, without document-specific facts."""

    lowered = question.casefold()
    cues = []
    if any(term in lowered for term in ("geograph", "region", "primarily operate")):
        cues.append(("our operations reportable segments", "our operations", False, 2))
    if any(term in lowered for term in ("legal", "litigation", "lawsuit", "legal battle")):
        cues.append(("item 3 legal proceedings", "item 3 legal proceedings", False, 1))
    if any(term in lowered for term in ("income statement", "p&l", "profit and loss", "operating income", "ebitda")):
        cues.extend((
            ("consolidated statement of income", "statement of income", True, 1),
            ("consolidated statements of operations", "statements of operations", True, 1),
        ))
    if any(term in lowered for term in ("cash flow", "capex", "capital expenditure", "ebitda")):
        cues.append(("consolidated statement of cash flows", "statement of cash flows", True, 1))
    return tuple(cues)


def _pdf_section_hits(
    hits: tuple[MemoryHit, ...], marker: str, *, prefer_start: bool, count: int
) -> tuple[MemoryHit, ...]:
    """Select real Memory hits whose extracted pages contain the named section."""

    matches = []
    for rank, hit in enumerate(hits):
        normalized = re.sub(r"[^a-z0-9]+", " ", hit.text.casefold())
        position = normalized.find(marker)
        if position >= 0:
            continuation = normalized[position + len(marker) :].lstrip().startswith("continued")
            priority = position + (100_000 if continuation else 0) if prefer_start else rank
            matches.append((priority, rank, hit))
    return tuple(hit for _, _, hit in sorted(matches, key=lambda value: (value[0], value[1]))[:count])


def _pdf_query_variants(question: str) -> tuple[str, ...]:
    """Create generic lexical views of financial questions without answer data."""

    lowered = question.lower()
    expansions = []
    rules = (
        (
            ("geograph", "operate", "region"),
            "operations operating segments reportable segments divisions geography countries regions",
        ),
        (
            ("legal", "battle", "litigation", "lawsuit"),
            "legal proceedings litigation claims lawsuits regulatory material adverse effect",
        ),
        (("ebitda",), "operating income operating profit depreciation amortization"),
        (("capex", "capital expenditure"), "capital spending capital expenditures purchases property plant equipment"),
        (("margin",), "net revenue sales operating income operating profit depreciation amortization"),
        (
            ("income statement", "p&l", "profit and loss"),
            "consolidated statements operations income operating income net revenue",
        ),
        (("cash flow",), "consolidated statements cash flows depreciation amortization capital expenditures"),
        (("restructur",), "restructuring impairment charges restructuring costs severance"),
        (
            ("materially important", "materially significant", "material"),
            "material materiality significant reasonably possible probable",
        ),
        (("ongoing", "current", "as of"), "ongoing current fiscal year prior year reporting period"),
        (("quantity", "amount", "cost", "costs"), "amounts expense expenses costs charge charges"),
    )
    for triggers, expansion in rules:
        if any(trigger in lowered for trigger in triggers):
            expansions.append(expansion)
    informative = " ".join(_pdf_informative_terms(question))
    variants = [question, informative, *expansions]
    # Short overlapping windows preserve key combinations in long analyst
    # prompts, where a few generic instruction words can otherwise dominate FTS
    # admission. Use only the original informative terms, never generated facts.
    informative_tokens = informative.split()
    if len(informative_tokens) >= 5:
        variants.extend(
            " ".join(informative_tokens[start : start + 5]) for start in range(0, len(informative_tokens) - 2, 3)
        )
    return tuple(dict.fromkeys(value for value in variants if value.strip()))


def _pdf_informative_terms(question: str) -> tuple[str, ...]:
    return tuple(
        token for token in re.findall(r"[a-z]+|\d+", question.casefold()) if token not in _PDF_QUERY_STOP_WORDS
    )


_PDF_QUERY_STOP_WORDS = frozenset({
    "a",
    "an",
    "and",
    "are",
    "as",
    "assuming",
    "by",
    "calculate",
    "can",
    "company",
    "define",
    "details",
    "for",
    "from",
    "give",
    "has",
    "have",
    "if",
    "in",
    "is",
    "it",
    "less",
    "only",
    "of",
    "on",
    "outlined",
    "perspective",
    "question",
    "relying",
    "reported",
    "respond",
    "response",
    "shown",
    "state",
    "statement",
    "statements",
    "the",
    "then",
    "to",
    "using",
    "what",
    "who",
    "with",
    "year",
})


def _pdf_page_source_id(document_id: str, document_sha256: str, page_number: int) -> str:
    _validate_document_id(document_id)
    if len(document_sha256) != 64 or any(character not in "0123456789abcdef" for character in document_sha256):
        raise ValueError("document_sha256 must be a lowercase SHA-256 digest")
    if type(page_number) is not int or page_number < 1:
        raise ValueError("page_number must be a positive integer")
    source_id = f"pdf:{quote(document_id, safe='')}:{document_sha256}:{page_number}"
    if len(source_id) > MAX_SOURCE_ID_LENGTH:
        document_key = hashlib.sha256(document_id.encode("utf-8")).hexdigest()
        # A caret is always percent-encoded by quote(), so this namespace
        # cannot collide with a literal short document ID.
        source_id = f"pdf:^sha256-{document_key}:{document_sha256}:{page_number}"
    return source_id


def _validate_document_id(document_id: str) -> None:
    if not isinstance(document_id, str) or not document_id.strip():
        raise ValueError("document_id must contain non-whitespace text")


__all__ = [
    "PDF_PAGE_SOURCE_DEFINITION",
    "PDFDocumentInput",
    "PDFPageInput",
    "PDFPageSource",
    "parse_pdf_document",
    "search_pdf_pages",
]
