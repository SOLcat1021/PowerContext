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

"""Capture CSV records as stable, individually citable Sources."""

# ruff: noqa: TRY003 -- Public validation failures intentionally use ValueError.

from __future__ import annotations

import csv
import io
import json
from urllib.parse import quote

from pydantic import BaseModel

from powercontext.limits import MAX_SOURCE_ID_LENGTH
from powercontext.sources.definitions import AdapterSourceDefinition
from powercontext.sources.models import Source, SourceMaterialization
from powercontext.sources.projections import TEXT_EVIDENCE_PROJECTION_KEY, TextEvidence


class CSVDocumentInput(BaseModel):
    document_id: str
    primary_key: str
    content: bytes


class CSVRowInput(BaseModel):
    document_id: str
    primary_key: str
    primary_key_value: str
    columns: tuple[str, ...]
    values: tuple[str, ...]


class CSVRowSource(Source):
    source_id: str
    document_id: str
    primary_key: str
    primary_key_value: str
    columns: tuple[str, ...]
    values: tuple[str, ...]


def csv_row_source_id(document_id: str, primary_key_value: str) -> str:
    """Build a delimiter-safe identity from the stable document and key values."""
    if not document_id or document_id != document_id.strip():
        raise ValueError("document_id must be nonempty and have no surrounding whitespace")
    if not primary_key_value or not primary_key_value.strip():
        raise ValueError("primary_key_value must not be blank")
    source_id = f"csv:{quote(document_id, safe='')}:{quote(primary_key_value, safe='')}"
    if len(source_id) > MAX_SOURCE_ID_LENGTH:
        raise ValueError("CSV row source_id exceeds the maximum length")
    return source_id


def parse_csv_document(value: CSVDocumentInput) -> tuple[CSVRowInput, ...]:  # noqa: C901
    """Parse and validate the whole document before exposing any row."""
    if not value.document_id or value.document_id != value.document_id.strip():
        raise ValueError("document_id must be nonempty and have no surrounding whitespace")
    if not value.primary_key:
        raise ValueError("primary_key must be nonempty")
    try:
        decoded = value.content.decode("utf-8-sig")
        reader = csv.reader(io.StringIO(decoded, newline=""), strict=True)
        try:
            columns = tuple(next(reader))
        except StopIteration:
            raise ValueError("CSV document has no header") from None
        if not columns or any(not column.strip() for column in columns) or len(set(columns)) != len(columns):
            raise ValueError("CSV header has blank or duplicate columns")
        try:
            primary_key_index = columns.index(value.primary_key)
        except ValueError:
            raise ValueError("primary_key does not exactly match a header column") from None

        rows: list[CSVRowInput] = []
        seen_keys: set[str] = set()
        for record in reader:
            if not record:
                continue
            if len(record) != len(columns):
                raise ValueError("CSV record width differs from the header")
            key = record[primary_key_index]
            if not key.strip() or key in seen_keys:
                raise ValueError("CSV primary_key value is blank or duplicated")
            csv_row_source_id(value.document_id, key)
            seen_keys.add(key)
            rows.append(
                CSVRowInput(
                    document_id=value.document_id,
                    primary_key=value.primary_key,
                    primary_key_value=key,
                    columns=columns,
                    values=tuple(record),
                )
            )
    except (UnicodeDecodeError, csv.Error) as exc:
        raise ValueError("Invalid UTF-8 CSV document") from exc
    return tuple(rows)


class CSVRowSourceAdapter:
    """Resolve and read captured CSV rows without an external data source."""

    input_class = CSVRowInput
    name = "csv-row"
    source_class = CSVRowSource

    async def resolve(self, value: CSVRowInput, /) -> CSVRowSource:
        if len(value.columns) != len(value.values) or value.primary_key not in value.columns:
            raise ValueError("CSV row columns and values are inconsistent")
        if value.values[value.columns.index(value.primary_key)] != value.primary_key_value:
            raise ValueError("CSV row primary_key_value differs from its field value")
        source_id = csv_row_source_id(value.document_id, value.primary_key_value)
        return CSVRowSource(
            name=source_id,
            source_id=source_id,
            materialization=SourceMaterialization.CAPTURED,
            document_id=value.document_id,
            primary_key=value.primary_key,
            primary_key_value=value.primary_key_value,
            columns=value.columns,
            values=value.values,
        )

    async def read(self, source: CSVRowSource, /) -> CSVRowInput:
        return CSVRowInput(
            document_id=source.document_id,
            primary_key=source.primary_key,
            primary_key_value=source.primary_key_value,
            columns=source.columns,
            values=source.values,
        )


class CSVRowTextEvidenceProjection:
    name = TEXT_EVIDENCE_PROJECTION_KEY.name
    version = TEXT_EVIDENCE_PROJECTION_KEY.version
    source_class = CSVRowSource
    output_class: type[BaseModel] = TextEvidence

    def project(self, source: CSVRowSource, /) -> TextEvidence:
        row = dict(zip(source.columns, source.values, strict=True))
        return TextEvidence(
            source_type="csv-row",
            source_id=source.source_id,
            content=json.dumps(row, ensure_ascii=False, separators=(",", ":")),
            metadata={
                "document_id": source.document_id,
                "primary_key": source.primary_key,
                "primary_key_value": source.primary_key_value,
                "columns": list(source.columns),
                "row": row,
            },
        )


CSV_ROW_SOURCE_DEFINITION = AdapterSourceDefinition(
    CSVRowSourceAdapter(),
    projections=(CSVRowTextEvidenceProjection(),),
)


__all__ = [
    "CSV_ROW_SOURCE_DEFINITION",
    "CSVDocumentInput",
    "CSVRowInput",
    "CSVRowSource",
    "csv_row_source_id",
    "parse_csv_document",
]
