# Copyright (c) 2026 OceanBase.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Preserve native channel ranks when a hybrid statement combines candidates."""

from __future__ import annotations

from pathlib import Path

import pytest

from powercontext.builtin.artifacts.memory import EmbeddingProfile, MemoryEntryInput
from powercontext.builtin.inference import EmbeddingResult
from powercontext.builtin.persistence.seekdb import SeekDBConfig
from powercontext.builtin.runtime import BuiltinConfig, open_builtin_contexts


class _TiedEmbedding:
    profile = EmbeddingProfile(
        profile_id="native-rank-regression-v1",
        model="constant",
        dimension=3,
        distance="l2",
        normalization="unit",
    )

    async def embed(self, texts: tuple[str, ...], /) -> EmbeddingResult:
        return EmbeddingResult(vectors=tuple((1.0, 0.0, 0.0) for _ in texts))


@pytest.mark.asyncio
async def test_hybrid_preserves_vector_ranks_when_fts_has_no_candidates(tmp_path: Path) -> None:
    pytest.importorskip("pylibseekdb")
    async with open_builtin_contexts(
        BuiltinConfig(database=SeekDBConfig(path=tmp_path / "db")), embedding_model=_TiedEmbedding()
    ) as contexts:
        memory = (await contexts.get("rank-regression")).artifacts.memory
        head = await memory.remember(
            memory=None,
            entries=tuple(MemoryEntryInput(kind="fact", text=f"Distinct evidence document {i}.") for i in range(24)),
            mode="append",
        )
        assert head is not None
        lexical = await memory.search("absentquerytoken", memories=(head,), mode="fts", limit=10)
        assert lexical.hits == ()
        vector = await memory.search("absentquerytoken", memories=(head,), mode="vector", limit=10)
        expected = tuple((hit.entry_id, hit.entry_version_id, hit.text) for hit in vector.hits)
        assert len(expected) == 10
        for _ in range(3):
            hybrid = await memory.search("absentquerytoken", memories=(head,), mode="hybrid", limit=10)
            assert tuple((hit.entry_id, hit.entry_version_id, hit.text) for hit in hybrid.hits) == expected
            assert all(hit.matched_by == ("vector",) and hit.memory_ref == head.as_ref() for hit in hybrid.hits)
