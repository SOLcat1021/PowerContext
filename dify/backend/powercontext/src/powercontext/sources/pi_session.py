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

"""Capture the visible events on one Pi session branch as durable Sources."""

# ruff: noqa: TRY003 -- Invalid archives and changed history use public ValueError failures.

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from powercontext.sources.connectors import ConnectorRunCompletion, ConnectorRunSession, ConnectorRunStatus
from powercontext.sources.definitions import AdapterSourceDefinition
from powercontext.sources.models import Source, SourceMaterialization
from powercontext.sources.projections import TEXT_EVIDENCE_PROJECTION_KEY, TextEvidence


class PiSessionInput(BaseModel):
    content: bytes
    leaf_id: str | None = None


class PiEventInput(BaseModel):
    session_id: str
    event_id: str
    parent_id: str | None
    event_type: str
    role: str
    content: str
    record: dict[str, Any]


class PiEventSource(Source):
    source_id: str
    session_id: str
    event_id: str
    parent_id: str | None
    event_type: str
    role: str
    content: str
    record: dict[str, Any]


def _archive(content: bytes) -> tuple[str, list[dict[str, Any]], dict[str, dict[str, Any]]]:
    try:
        records = [json.loads(line) for line in content.decode("utf-8-sig").splitlines() if line.strip()]
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid UTF-8 Pi session JSONL") from exc
    if not records or not isinstance(records[0], dict):
        raise ValueError("Pi session header is missing")
    header = records[0]
    session_id = header.get("id")
    if (
        header.get("type") != "session"
        or type(header.get("version")) is not int
        or header["version"] != 3
        or not isinstance(session_id, str)
        or not session_id.strip()
    ):
        raise ValueError("Invalid Pi v3 session header")

    nodes: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for record in records[1:]:
        if not isinstance(record, dict):
            raise ValueError("Pi session node must be an object")  # noqa: TRY004
        event_id = record.get("id")
        if not isinstance(event_id, str) or not event_id.strip() or event_id in by_id:
            raise ValueError("Pi session event ID is missing or duplicated")
        if "parentId" not in record:
            raise ValueError("Pi session node has no parentId")
        parent_id = record["parentId"]
        if parent_id not in (None, "") and (not isinstance(parent_id, str) or parent_id not in by_id):
            raise ValueError("Pi session parent is missing or occurs after its child")
        nodes.append(record)
        by_id[event_id] = record
    return session_id, nodes, by_id


def _visible_content(value: object) -> str:
    if isinstance(value, str):
        return value
    if not isinstance(value, list):
        return ""
    parts: list[str] = []
    for block in value:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind == "text" and isinstance(block.get("text"), str):
            parts.append(block["text"])
        elif kind == "toolCall":
            arguments = json.dumps(
                block.get("arguments", {}), ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            parts.append(f"[tool_call {block.get('name', '')} {block.get('id', '')}] {arguments}")
    return "\n".join(part for part in parts if part)


def _event(session_id: str, record: dict[str, Any]) -> PiEventInput | None:  # noqa: C901
    event_type = record.get("type")
    role = ""
    body = ""
    if event_type == "message":
        message = record.get("message")
        if not isinstance(message, dict):
            return None
        role = message.get("role", "")
        if role == "bashExecution":
            command, output = message.get("command"), message.get("output")
            if isinstance(command, str) and isinstance(output, str) and (command or output):
                body = f"$ {command}\n{output}"
        elif role == "toolResult":
            visible = _visible_content(message.get("content"))
            if visible:
                body = f"[tool_result {message.get('toolName', '')} {message.get('toolCallId', '')}] {visible}"
        else:
            body = _visible_content(message.get("content"))
    elif event_type in {"compaction", "branch_summary"}:
        role = event_type
        if isinstance(record.get("summary"), str):
            body = record["summary"]
    elif event_type == "custom_message":
        role = "custom"
        body = _visible_content(record.get("content"))
    if not isinstance(role, str) or not body:
        return None
    parent = record["parentId"]
    return PiEventInput(
        session_id=session_id,
        event_id=record["id"],
        parent_id=parent if parent else None,
        event_type=event_type,
        role=role,
        content=f"{role}: {body}",
        record=record,
    )


def parse_pi_session(value: PiSessionInput) -> tuple[PiEventInput, ...]:
    """Validate the complete archive, then select the root-to-leaf visible path."""
    session_id, nodes, by_id = _archive(value.content)
    if value.leaf_id is None:
        if not nodes:
            return ()
        leaf_id = nodes[-1]["id"]
    else:
        leaf_id = value.leaf_id
    if leaf_id not in by_id:
        raise ValueError("Selected Pi leaf does not exist")
    branch: list[dict[str, Any]] = []
    while leaf_id:
        record = by_id[leaf_id]
        branch.append(record)
        leaf_id = record["parentId"]
    events = (_event(session_id, record) for record in reversed(branch))
    return tuple(event for event in events if event is not None)


def _source_id(session_id: str, event_id: str) -> str:
    components = json.dumps([session_id, event_id], ensure_ascii=False, separators=(",", ":"))
    return "pi:" + hashlib.sha256(components.encode("utf-8")).hexdigest()


class PiEventSourceAdapter:
    input_class = PiEventInput
    name = "pi-event"
    source_class = PiEventSource

    async def resolve(self, value: PiEventInput, /) -> PiEventSource:
        source_id = _source_id(value.session_id, value.event_id)
        return PiEventSource(
            name=source_id,
            source_id=source_id,
            materialization=SourceMaterialization.CAPTURED,
            session_id=value.session_id,
            event_id=value.event_id,
            parent_id=value.parent_id,
            event_type=value.event_type,
            role=value.role,
            content=value.content,
            record=value.record,
        )

    async def read(self, source: PiEventSource, /) -> PiEventInput:
        return PiEventInput(
            session_id=source.session_id,
            event_id=source.event_id,
            parent_id=source.parent_id,
            event_type=source.event_type,
            role=source.role,
            content=source.content,
            record=source.record,
        )


class PiEventTextEvidenceProjection:
    name = TEXT_EVIDENCE_PROJECTION_KEY.name
    version = TEXT_EVIDENCE_PROJECTION_KEY.version
    source_class = PiEventSource
    output_class: type[BaseModel] = TextEvidence

    def project(self, source: PiEventSource, /) -> TextEvidence:
        return TextEvidence(
            source_type="pi-event",
            source_id=source.source_id,
            content=source.content,
            metadata={
                "session_id": source.session_id,
                "event_id": source.event_id,
                "parent_id": source.parent_id,
                "event_type": source.event_type,
                "role": source.role,
            },
        )


PI_EVENT_SOURCE_DEFINITION = AdapterSourceDefinition(
    PiEventSourceAdapter(),
    projections=(PiEventTextEvidenceProjection(),),
)


class PiSessionConnector:
    """Import one selected branch, retaining a durable checksum for every imported event."""

    name = "pi-session-history"
    version = "1"
    source_definitions = frozenset({"pi-event"})

    def __init__(self, path: str | Path, leaf_id: str | None = None) -> None:
        self.path = Path(path)
        self.leaf_id = leaf_id

    async def run(self, session: ConnectorRunSession, /) -> ConnectorRunCompletion:
        raw = self.path.read_bytes()
        session_id, _, by_id = _archive(raw)
        events = parse_pi_session(PiSessionInput(content=raw, leaf_id=self.leaf_id))
        previous = session.checkpoint
        if previous is None:
            imported: dict[str, str] = {}
        elif (
            not isinstance(previous, dict)
            or previous.get("session_id") != session_id
            or not isinstance(previous.get("records"), dict)
        ):
            raise ValueError("Invalid Pi session checkpoint")
        else:
            imported = dict(previous["records"])

        def checksum(record: dict[str, Any]) -> str:
            canonical = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

        for event_id, expected in imported.items():
            if event_id not in by_id or checksum(by_id[event_id]) != expected:
                raise ValueError("Previously imported Pi event was changed")
        for event in events:
            if event.event_id not in imported:
                await session.submit(event.event_id, "pi-event", event)
                imported[event.event_id] = checksum(event.record)
        return ConnectorRunCompletion(
            status=ConnectorRunStatus.COMPLETE,
            checkpoint={"session_id": session_id, "records": imported},
        )


__all__ = [
    "PI_EVENT_SOURCE_DEFINITION",
    "PiEventInput",
    "PiEventSource",
    "PiSessionConnector",
    "PiSessionInput",
    "parse_pi_session",
]
