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

"""Portable full and incremental prepared-context wire formats."""

# ruff: noqa: TRY003 -- Wire validation reports public ContextPackError details.

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass

_PACK_SCHEMA = "powercontext.context-pack.v1"
_DELTA_SCHEMA = "powercontext.context-pack-delta.v1"
_DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")


class ContextPackError(ValueError):
    """An invalid context-pack input or wire value."""


def _wire(value: dict[str, object]) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _decode_wire(data: bytes, keys: set[str], schema: str) -> dict[str, object]:
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
        raise ContextPackError("Invalid context-pack JSON") from exc
    if not isinstance(value, dict) or set(value) != keys or value.get("schema") != schema:
        raise ContextPackError("Invalid context-pack fields")
    return value


def _decode_items(value: object) -> tuple[bytes, ...]:
    if not isinstance(value, list):
        raise ContextPackError("Context-pack items must be an array")
    items = []
    for encoded in value:
        if not isinstance(encoded, str):
            raise ContextPackError("Context-pack item is not Base64 text")
        try:
            item = base64.b64decode(encoded, validate=True)
            item.decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
            raise ContextPackError("Invalid context-pack item") from exc
        if base64.b64encode(item).decode("ascii") != encoded:
            raise ContextPackError("Noncanonical Base64 item")
        items.append(item)
    return tuple(items)


def _encoded_items(items: tuple[bytes, ...]) -> list[str]:
    return [base64.b64encode(item).decode("ascii") for item in items]


def _valid_digest(value: object) -> bool:
    return isinstance(value, str) and _DIGEST.fullmatch(value) is not None


@dataclass(frozen=True, slots=True)
class ContextPack:
    items: tuple[bytes, ...]
    digest: str
    byte_count: int

    @classmethod
    def build(cls, items: tuple[bytes, ...]) -> ContextPack:
        items = tuple(items)
        for item in items:
            if not isinstance(item, bytes):
                raise ContextPackError("Context-pack items must be bytes")
            try:
                item.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise ContextPackError("Context-pack items must be valid UTF-8") from exc
        unsigned = {"schema": _PACK_SCHEMA, "items": _encoded_items(items)}
        digest = "sha256:" + hashlib.sha256(_wire(unsigned)).hexdigest()
        byte_count = 0
        while True:
            actual = len(_wire({**unsigned, "digest": digest, "byte_count": byte_count}))
            if actual == byte_count:
                break
            byte_count = actual
        return cls(items=items, digest=digest, byte_count=byte_count)

    @classmethod
    def from_content(cls, content: str | None, *, chunk_bytes: int = 512) -> ContextPack:
        if type(chunk_bytes) is not int or chunk_bytes < 1:
            raise ContextPackError("chunk_bytes must be a positive integer")
        if content is None:
            content = ""
        if not isinstance(content, str):
            raise ContextPackError("content must be text or None")
        chunks: list[bytes] = []
        current = bytearray()
        for char in content:
            try:
                encoded = char.encode("utf-8")
            except UnicodeEncodeError as exc:
                raise ContextPackError("content is not valid UTF-8 text") from exc
            if len(encoded) > chunk_bytes:
                raise ContextPackError("A character exceeds chunk_bytes")
            if len(current) + len(encoded) > chunk_bytes:
                chunks.append(bytes(current))
                current.clear()
            current.extend(encoded)
        if current:
            chunks.append(bytes(current))
        return cls.build(tuple(chunks))

    def to_bytes(self) -> bytes:
        return _wire({
            "schema": _PACK_SCHEMA,
            "items": _encoded_items(self.items),
            "digest": self.digest,
            "byte_count": self.byte_count,
        })

    @classmethod
    def from_bytes(cls, data: bytes) -> ContextPack:
        value = _decode_wire(data, {"schema", "items", "digest", "byte_count"}, _PACK_SCHEMA)
        if not _valid_digest(value["digest"]) or type(value["byte_count"]) is not int:
            raise ContextPackError("Invalid context-pack checksum")
        built = cls.build(_decode_items(value["items"]))
        if value["digest"] != built.digest or value["byte_count"] != built.byte_count:
            raise ContextPackError("Context-pack checksum mismatch")
        return built


@dataclass(frozen=True, slots=True)
class ContextPackDelta:
    base_digest: str
    target_digest: str
    prefix_items: int
    appended: tuple[bytes, ...]

    @classmethod
    def between(cls, base: ContextPack, target: ContextPack) -> ContextPackDelta:
        prefix = 0
        for old, new in zip(base.items, target.items, strict=False):
            if old != new:
                break
            prefix += 1
        return cls(base.digest, target.digest, prefix, target.items[prefix:])

    @property
    def byte_count(self) -> int:
        return len(self.to_bytes())

    def to_bytes(self) -> bytes:
        return _wire({
            "schema": _DELTA_SCHEMA,
            "base_digest": self.base_digest,
            "target_digest": self.target_digest,
            "prefix_items": self.prefix_items,
            "appended": _encoded_items(self.appended),
        })

    @classmethod
    def from_bytes(cls, data: bytes) -> ContextPackDelta:
        value = _decode_wire(
            data,
            {"schema", "base_digest", "target_digest", "prefix_items", "appended"},
            _DELTA_SCHEMA,
        )
        if (
            not _valid_digest(value["base_digest"])
            or not _valid_digest(value["target_digest"])
            or type(value["prefix_items"]) is not int
            or value["prefix_items"] < 0
        ):
            raise ContextPackError("Invalid context-pack delta checksum or prefix")
        return cls(
            base_digest=value["base_digest"],
            target_digest=value["target_digest"],
            prefix_items=value["prefix_items"],
            appended=_decode_items(value["appended"]),
        )


def apply_context_pack_delta(base: ContextPack, delta: ContextPackDelta) -> ContextPack:
    if (
        delta.base_digest != base.digest
        or type(delta.prefix_items) is not int
        or delta.prefix_items < 0
        or delta.prefix_items > len(base.items)
    ):
        raise ContextPackError("Invalid base pack or delta prefix")
    target = ContextPack.build(base.items[: delta.prefix_items] + delta.appended)
    if target.digest != delta.target_digest:
        raise ContextPackError("Context-pack delta target mismatch")
    return target


__all__ = ["ContextPack", "ContextPackDelta", "ContextPackError", "apply_context_pack_delta"]
