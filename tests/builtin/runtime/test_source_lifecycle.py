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

"""Regression coverage for source lifecycle state recovery."""

from __future__ import annotations

import asyncio

import pytest

from powercontext.builtin.artifacts.memory import MemoryEntryInput
from powercontext.builtin.persistence.sqlite import SQLiteConfig
from powercontext.builtin.runtime import (
    BuiltinConfig,
    CaptureSource,
    RememberMemoryRequest,
    open_builtin_runtime,
)
from powercontext.builtin.runtime.source_lifecycle import SourceLifecycleEvent
from powercontext.builtin.scope import ScopeDraft


def test_replaying_interrupted_event_does_not_create_another_memory_revision(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    """A retry completes lifecycle bookkeeping after the native write already committed."""

    async def run() -> None:
        config = BuiltinConfig(database=SQLiteConfig(url=f"sqlite+aiosqlite:///{tmp_path / 'lifecycle.db'}"))
        async with open_builtin_runtime(config) as runtime:
            scope = await runtime.scopes.create(
                ScopeDraft(title="Lifecycle", summary="Retry recovery", idempotency_key="lifecycle-retry")
            )
            source = await runtime.sources.for_scope(scope.scope_id).capture(
                CaptureSource(source_id="origin", content="Original evidence", metadata={})
            )
            memory = await runtime.memory.for_scope(scope.scope_id).remember(
                RememberMemoryRequest(entries=(MemoryEntryInput(kind="fact", text="Derived evidence"),))
            )
            lifecycle = runtime.lifecycle.for_scope(scope.scope_id)
            await lifecycle.register_source("origin", source.source_ref, revision=1)
            await lifecycle.register_memory(
                "derived", memory.entry.citation, parents=("origin",), policy="all"
            )

            service_type = type(lifecycle)
            original_align = service_type._align_memory
            interrupted = False

            async def align_then_interrupt(context, nodes, active) -> None:
                nonlocal interrupted
                await original_align(context, nodes, active)
                if not interrupted:
                    interrupted = True
                    raise RuntimeError("interrupted after native memory write")

            event = SourceLifecycleEvent(
                node_id="origin", revision=1, sequence=1, available=False, reason="source removed"
            )
            monkeypatch.setattr(service_type, "_align_memory", staticmethod(align_then_interrupt))
            with pytest.raises(RuntimeError, match="interrupted after native memory write"):
                await lifecycle.apply(event)
            revision_after_interruption = (await runtime.memory.for_scope(scope.scope_id).list()).memory_ref

            monkeypatch.setattr(service_type, "_align_memory", staticmethod(original_align))
            assert await lifecycle.apply(event) == []
            assert (await runtime.memory.for_scope(scope.scope_id).list()).memory_ref == revision_after_interruption

    asyncio.run(run())
