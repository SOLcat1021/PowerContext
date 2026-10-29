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

"""Persistent source-dependency lifecycle propagation."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, cast

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator
from sqlalchemy import insert, select, update

from powercontext.artifacts import ArtifactRef, MemoryCitation
from powercontext.builtin.persistence.database import AsyncDatabase
from powercontext.builtin.persistence.tables import SOURCE_LIFECYCLE_NODES_TABLE
from powercontext.sources import SourceRef

if TYPE_CHECKING:
    from powercontext.builtin.context import BuiltinArtifacts, BuiltinSources
    from powercontext.builtin.runtime.application import BuiltinRuntime
    from powercontext.builtin.runtime.protocols import BuiltinTriggers
    from powercontext.context import PowerContext

LifecycleKind = Literal["source", "memory", "topic"]
LifecyclePolicy = Literal["all", "any"]
LifecycleReference = SourceRef | MemoryCitation | ArtifactRef


class SourceLifecycleError(ValueError):
    """Report an invalid graph registration, event, or lifecycle resolution."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class SourceLifecycleEvent(BaseModel):
    """One ordered availability change for a registered Source node."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    node_id: str
    revision: StrictInt = Field(gt=0)
    sequence: StrictInt = Field(gt=0)
    available: StrictBool
    reason: str

    @field_validator("node_id", "reason")
    @classmethod
    def require_visible_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty or whitespace")  # noqa: TRY003
        return value


@dataclass(frozen=True, slots=True)
class _Node:
    node_id: str
    kind: LifecycleKind
    reference: LifecycleReference
    revision: int | None
    parents: tuple[str, ...]
    policy: LifecyclePolicy | None
    active: bool
    last_sequence: int | None = None
    last_event: SourceLifecycleEvent | None = None

    def same_binding(self, other: _Node) -> bool:
        return (
            self.node_id,
            self.kind,
            self.reference,
            self.revision,
            self.parents,
            self.policy,
        ) == (
            other.node_id,
            other.kind,
            other.reference,
            other.revision,
            other.parents,
            other.policy,
        )


class _SourceLifecycleRepository:
    def __init__(self, database: AsyncDatabase) -> None:
        self._database = database

    async def nodes(self, scope_id: str) -> dict[str, _Node]:
        async with self._database.connection() as connection:
            rows = (
                await connection.execute(
                    select(SOURCE_LIFECYCLE_NODES_TABLE).where(SOURCE_LIFECYCLE_NODES_TABLE.c.scope_id == scope_id)
                )
            ).mappings()
            return {str(row["node_id"]): _node_from_row(row) for row in rows}

    async def add(self, scope_id: str, node: _Node) -> None:
        async with self._database.connection() as connection:
            await connection.execute(
                insert(SOURCE_LIFECYCLE_NODES_TABLE).values(
                    scope_id=scope_id,
                    node_id=node.node_id,
                    kind=node.kind,
                    reference_payload=_reference_payload(node.reference),
                    lifecycle_revision=node.revision,
                    parents_payload=json.dumps(node.parents, ensure_ascii=False, separators=(",", ":")),
                    policy=node.policy,
                    active=node.active,
                    last_sequence=node.last_sequence,
                    last_event_payload=None if node.last_event is None else node.last_event.model_dump_json(),
                )
            )

    async def commit_event(
        self,
        scope_id: str,
        event: SourceLifecycleEvent,
        active: dict[str, bool],
    ) -> None:
        async with self._database.connection() as connection:
            for node_id, available in active.items():
                values: dict[str, object] = {"active": available}
                if node_id == event.node_id:
                    values.update(
                        last_sequence=event.sequence,
                        last_event_payload=event.model_dump_json(),
                    )
                await connection.execute(
                    update(SOURCE_LIFECYCLE_NODES_TABLE)
                    .where(
                        SOURCE_LIFECYCLE_NODES_TABLE.c.scope_id == scope_id,
                        SOURCE_LIFECYCLE_NODES_TABLE.c.node_id == node_id,
                    )
                    .values(**values)
                )

    async def inactive_topic_ids(self, scope_id: str) -> set[str]:
        nodes = await self.nodes(scope_id)
        return {
            cast(ArtifactRef, node.reference).artifact_id
            for node in nodes.values()
            if node.kind == "topic" and not node.active
        }


class ScopedSourceLifecycleService:
    def __init__(self, runtime: BuiltinRuntime, repository: _SourceLifecycleRepository, scope_id: str) -> None:
        self._runtime = runtime
        self._repository = repository
        self.scope_id = scope_id

    async def register_source(self, node_id: str, source_ref: SourceRef, *, revision: int) -> None:
        _validate_node_id(node_id)
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise SourceLifecycleError("revision")
        try:
            await self._runtime.records.for_scope(self.scope_id).get_source(
                source_ref.source_type, source_ref.source_id
            )
        except (LookupError, ValueError) as error:
            raise SourceLifecycleError("source-ref") from error
        await self._register(
            _Node(
                node_id=node_id,
                kind="source",
                reference=source_ref,
                revision=revision,
                parents=(),
                policy=None,
                active=True,
            )
        )

    async def register_memory(
        self,
        node_id: str,
        citation: MemoryCitation,
        *,
        parents: tuple[str, ...],
        policy: LifecyclePolicy,
    ) -> None:
        _validate_node_id(node_id)
        await self._validate_memory_reference(citation)
        await self._register_derived(node_id, "memory", citation, parents, policy)

    async def register_topic(
        self,
        node_id: str,
        artifact_ref: ArtifactRef,
        *,
        parents: tuple[str, ...],
        policy: LifecyclePolicy,
    ) -> None:
        _validate_node_id(node_id)
        if artifact_ref.family != "topic-memory":
            raise SourceLifecycleError("topic-family")
        try:
            await self._runtime.records.for_scope(self.scope_id).get_artifact_revision(
                artifact_ref.family, artifact_ref.artifact_id, artifact_ref.revision
            )
        except (LookupError, ValueError) as error:
            raise SourceLifecycleError("topic-ref") from error
        await self._register_derived(node_id, "topic", artifact_ref, parents, policy)

    async def apply(self, event: SourceLifecycleEvent) -> list[str]:
        async with self._runtime._context(self.scope_id) as context, self._runtime._locked(self.scope_id):
            nodes = await self._repository.nodes(self.scope_id)
            source = nodes.get(event.node_id)
            if source is None or source.kind != "source":
                raise SourceLifecycleError("event-source")
            if source.revision != event.revision:
                raise SourceLifecycleError("event-revision")
            if source.last_sequence is not None:
                if event.sequence == source.last_sequence and event == source.last_event:
                    return sorted(node_id for node_id, node in nodes.items() if node.active)
                if event.sequence <= source.last_sequence:
                    raise SourceLifecycleError("event-sequence")

            active = _propagate(nodes, override=(event.node_id, event.available))
            await self._align_memory(context, nodes, active)
            await self._repository.commit_event(self.scope_id, event, active)
            return sorted(node_id for node_id, available in active.items() if available)

    async def resolve(
        self,
        node_id: str,
        *,
        purpose: Literal["generation", "audit"],
    ) -> LifecycleReference:
        if purpose not in {"generation", "audit"}:
            raise SourceLifecycleError("purpose")
        node = (await self._repository.nodes(self.scope_id)).get(node_id)
        if node is None:
            raise SourceLifecycleError("unknown-node")
        if purpose == "generation" and not node.active:
            raise SourceLifecycleError("unavailable")
        return node.reference

    async def _register_derived(
        self,
        node_id: str,
        kind: Literal["memory", "topic"],
        reference: MemoryCitation | ArtifactRef,
        parents: tuple[str, ...],
        policy: LifecyclePolicy,
    ) -> None:
        if policy not in {"all", "any"}:
            raise SourceLifecycleError("policy")
        if not parents:
            raise SourceLifecycleError("parents-empty")
        if len(parents) != len(set(parents)):
            raise SourceLifecycleError("parents-duplicate")
        if node_id in parents:
            raise SourceLifecycleError("parent-self")
        nodes = await self._repository.nodes(self.scope_id)
        if any(parent not in nodes for parent in parents):
            raise SourceLifecycleError("parent-missing")
        support = tuple(nodes[parent].active for parent in parents)
        active = all(support) if policy == "all" else any(support)
        await self._register(
            _Node(
                node_id=node_id,
                kind=kind,
                reference=reference,
                revision=None,
                parents=parents,
                policy=policy,
                active=active,
            )
        )

    async def _register(self, node: _Node) -> None:
        async with self._runtime._context(self.scope_id) as context, self._runtime._locked(self.scope_id):
            nodes = await self._repository.nodes(self.scope_id)
            existing = nodes.get(node.node_id)
            if existing is not None:
                if not existing.same_binding(node):
                    raise SourceLifecycleError("registration-conflict")
                if existing.kind == "memory":
                    await self._align_memory(context, nodes, {existing.node_id: existing.active})
                return
            await self._repository.add(self.scope_id, node)
            if node.kind == "memory":
                await self._align_memory(context, {node.node_id: node}, {node.node_id: node.active})

    async def _validate_memory_reference(self, citation: MemoryCitation) -> None:
        try:
            async with self._runtime._context(self.scope_id) as context:
                memory = await context.artifacts.memory.revision(citation.memory_ref)
                entries = await context.artifacts.memory.entries(memory)
                if not any(
                    entry.entry_id == citation.entry_id and entry.entry_version_id == citation.entry_version_id
                    for entry in entries
                ):
                    raise SourceLifecycleError("memory-ref")
        except (LookupError, ValueError) as error:
            if isinstance(error, SourceLifecycleError):
                raise
            raise SourceLifecycleError("memory-ref") from error

    @staticmethod
    async def _align_memory(
        context: PowerContext[BuiltinSources, BuiltinArtifacts, BuiltinTriggers],
        nodes: dict[str, _Node],
        active: dict[str, bool],
    ) -> None:
        targets = tuple(node for node in nodes.values() if node.kind == "memory" and node.node_id in active)
        if not targets:
            return
        service = context.artifacts.memory
        current = await service.head(context.artifacts.memory_artifact_id)
        entries = {entry.entry_id: entry for entry in await service.entries(current)}
        states = {entry.entry_id: entry.state for entry in current.content.manifest.entries}
        deactivate = []
        reactivate = []
        for node in targets:
            citation = cast(MemoryCitation, node.reference)
            entry = entries.get(citation.entry_id)
            if entry is None or entry.entry_version_id != citation.entry_version_id:
                raise SourceLifecycleError("memory-changed")
            if active[node.node_id] and states.get(entry.entry_id) == "inactive":
                reactivate.append(entry)
            elif not active[node.node_id] and states.get(entry.entry_id) == "active":
                deactivate.append(entry)
        if deactivate:
            current = await service.forget(current, entries=tuple(deactivate), reason="source lifecycle unavailable")
        if reactivate:
            await service.reactivate(current, entries=tuple(reactivate), reason="source lifecycle available")


class SourceLifecycleApplication:
    def __init__(self, runtime: BuiltinRuntime, database: AsyncDatabase) -> None:
        self._runtime = runtime
        self._repository = _SourceLifecycleRepository(database)

    def for_scope(self, scope_id: str, /) -> ScopedSourceLifecycleService:
        return ScopedSourceLifecycleService(self._runtime, self._repository, scope_id)

    async def inactive_topic_ids(self, scope_id: str) -> set[str]:
        return await self._repository.inactive_topic_ids(scope_id)


def _propagate(nodes: dict[str, _Node], *, override: tuple[str, bool]) -> dict[str, bool]:
    source_id, source_state = override
    active = {
        node_id: source_state if node_id == source_id else node.active
        for node_id, node in nodes.items()
        if node.kind == "source"
    }
    pending = {node_id for node_id, node in nodes.items() if node.kind != "source"}
    while pending:
        progressed = False
        for node_id in tuple(pending):
            node = nodes[node_id]
            if not all(parent in active for parent in node.parents):
                continue
            support = tuple(active[parent] for parent in node.parents)
            active[node_id] = all(support) if node.policy == "all" else any(support)
            pending.remove(node_id)
            progressed = True
        if not progressed:
            raise SourceLifecycleError("dependency-cycle")
    return active


def _node_from_row(row: object) -> _Node:
    values = cast(dict[str, object], row)
    kind = cast(LifecycleKind, str(values["kind"]))
    event_payload = values["last_event_payload"]
    return _Node(
        node_id=str(values["node_id"]),
        kind=kind,
        reference=_parse_reference(kind, str(values["reference_payload"])),
        revision=None if values["lifecycle_revision"] is None else int(cast(int, values["lifecycle_revision"])),
        parents=tuple(json.loads(str(values["parents_payload"]))),
        policy=None if values["policy"] is None else cast(LifecyclePolicy, str(values["policy"])),
        active=bool(values["active"]),
        last_sequence=None if values["last_sequence"] is None else int(cast(int, values["last_sequence"])),
        last_event=None if event_payload is None else SourceLifecycleEvent.model_validate_json(str(event_payload)),
    )


def _reference_payload(reference: LifecycleReference) -> str:
    return reference.model_dump_json()


def _parse_reference(kind: LifecycleKind, payload: str) -> LifecycleReference:
    if kind == "source":
        return SourceRef.model_validate_json(payload)
    if kind == "memory":
        return MemoryCitation.model_validate_json(payload)
    return ArtifactRef.model_validate_json(payload)


def _validate_node_id(node_id: str) -> None:
    if not isinstance(node_id, str) or not node_id.strip() or node_id != node_id.strip() or len(node_id) > 256:
        raise SourceLifecycleError("node-id")


__all__ = ["SourceLifecycleError", "SourceLifecycleEvent"]
