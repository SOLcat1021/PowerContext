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

"""Boundary coverage for revision-stable PDF page sources."""

from __future__ import annotations

import asyncio
import hashlib
import io

import pytest


def test_long_document_ids_remain_distinct_and_resolvable() -> None:
    pypdf = pytest.importorskip("pypdf")
    from powercontext.sources import SourceDefinitionRegistry
    from powercontext.sources.pdf_pages import PDF_PAGE_SOURCE_DEFINITION, PDFDocumentInput, parse_pdf_document

    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=100, height=100)
    buffer = io.BytesIO()
    writer.write(buffer)
    long_id = "annual-report-" + "x" * 250
    literal_hash_id = "sha256-" + hashlib.sha256(long_id.encode()).hexdigest()
    ids = (long_id, "annual-report-" + "x" * 249 + "y", "财报" * 100, literal_hash_id)
    registry = SourceDefinitionRegistry((PDF_PAGE_SOURCE_DEFINITION,))

    async def verify() -> None:
        names = []
        for document_id in ids:
            page = parse_pdf_document(PDFDocumentInput(document_id=document_id, content=buffer.getvalue()))[0]
            source = await registry.resolve(page)
            assert source.name == (await registry.resolve(page)).name
            assert len(source.name) <= 256
            assert await registry.read(source) == page
            names.append(source.name)
        assert len(set(names)) == len(ids)

    asyncio.run(verify())
