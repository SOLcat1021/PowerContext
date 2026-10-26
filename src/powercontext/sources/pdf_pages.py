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
import re
from typing import Any
from urllib.parse import quote

from pydantic import BaseModel
from pypdf import PdfReader

from powercontext.builtin.artifacts.memory.models import MemoryCitation
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
    result_sets = [
        (await memory.search(SearchMemoryRequest(query=query, mode="fts", limit=limit))).hits
        for query in _pdf_query_variants(question)
    ]
    citations: list[MemoryCitation] = []
    seen: set[tuple[str, int, str, str]] = set()
    for rank in range(max((len(hits) for hits in result_sets), default=0)):
        for hits in result_sets:
            if rank >= len(hits):
                continue
            hit = hits[rank]
            identity = (hit.memory_ref.artifact_id, hit.memory_ref.revision, hit.entry_id, hit.entry_version_id)
            if identity in seen:
                continue
            seen.add(identity)
            citations.append(
                MemoryCitation(
                    memory_ref=hit.memory_ref,
                    entry_id=hit.entry_id,
                    entry_version_id=hit.entry_version_id,
                )
            )
            if len(citations) >= limit:
                return tuple(citations)
    return tuple(citations)


def _pdf_query_variants(question: str) -> tuple[str, ...]:
    """Expand common financial question vocabulary into filing terminology."""

    lowered = question.lower()
    expansions = []
    rules = (
        (("geograph", "operate"), "operations reportable segments divisions geography"),
        (("legal", "battle", "litigation"), "legal proceedings litigation claims regulatory material adverse effect"),
        (("ebitda",), "operating profit depreciation amortization"),
        (("capex", "capital expenditure"), "capital spending capital expenditures"),
        (("margin",), "net revenue operating profit depreciation amortization"),
        (("income statement", "p&l", "profit and loss"), "consolidated statement income operating profit net revenue"),
        (("cash flow",), "consolidated statement cash flows depreciation amortization capital spending"),
        (("restructur",), "restructuring impairment charges cost sales selling general administrative expenses"),
    )
    for triggers, expansion in rules:
        if any(trigger in lowered for trigger in triggers):
            expansions.append(expansion)
    tokens = re.findall(r"[a-z]+|\d+", lowered)
    informative = " ".join(token for token in tokens if token not in _PDF_QUERY_STOP_WORDS)
    return tuple(dict.fromkeys(value for value in (question, informative, *expansions) if value.strip()))


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
    "of",
    "on",
    "only",
    "outlined",
    "perspective",
    "question",
    "relying",
    "reported",
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
})


def _pdf_page_source_id(document_id: str, document_sha256: str, page_number: int) -> str:
    _validate_document_id(document_id)
    if len(document_sha256) != 64 or any(character not in "0123456789abcdef" for character in document_sha256):
        raise ValueError("document_sha256 must be a lowercase SHA-256 digest")
    if type(page_number) is not int or page_number < 1:
        raise ValueError("page_number must be a positive integer")
    source_id = f"pdf:{quote(document_id, safe='')}:{document_sha256}:{page_number}"
    if len(source_id) > MAX_SOURCE_ID_LENGTH:
        raise ValueError("PDF page source identity exceeds the maximum length")
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
