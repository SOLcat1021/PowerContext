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

"""Portable full and incremental encodings of prepared context."""

# ruff: noqa: TRY003

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from dataclasses import dataclass
from typing import Any

__all__ = ["ContextPack", "ContextPackDelta", "ContextPackError", "apply_context_pack_delta"]

_PACK_SCHEMA = "powercontext.context-pack.v1"
_DELTA_SCHEMA = "powercontext.context-pack-delta.v1"
_PACK_FIELDS = frozenset(("schema", "items", "digest", "byte_count"))
_DELTA_FIELDS = frozenset(("schema", "base_digest", "target_digest", "prefix_items", "appended"))


class ContextPackError(ValueError):
    """The context pack or delta does not satisfy the wire contract."""


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _encode_items(items: tuple[bytes, ...]) -> list[str]:
    return [base64.b64encode(item).decode("ascii") for item in items]


def _validate_items(items: object, *, field: str) -> tuple[bytes, ...]:
    if not isinstance(items, tuple):
        raise ContextPackError(f"{field} must be a tuple of bytes")
    for item in items:
        if type(item) is not bytes:
            raise ContextPackError(f"{field} must contain only bytes")
        try:
            item.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ContextPackError(f"{field} must contain valid UTF-8 chunks") from error
    return items


def _decode_items(value: object, *, field: str) -> tuple[bytes, ...]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ContextPackError(f"{field} must be an array of Base64 strings")
    decoded: list[bytes] = []
    for item in value:
        try:
            raw = base64.b64decode(item, validate=True)
            raw.decode("utf-8")
        except (binascii.Error, UnicodeDecodeError, ValueError) as error:
            raise ContextPackError(f"{field} contains an invalid UTF-8 Base64 chunk") from error
        if base64.b64encode(raw).decode("ascii") != item:
            raise ContextPackError(f"{field} contains a non-canonical Base64 chunk")
        decoded.append(raw)
    return tuple(decoded)


def _decode_object(payload: bytes | bytearray | memoryview, *, fields: frozenset[str]) -> dict[str, Any]:
    if not isinstance(payload, (bytes, bytearray, memoryview)):
        raise ContextPackError("wire payload must be bytes")
    try:
        value = json.loads(bytes(payload))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ContextPackError("wire payload is not valid UTF-8 JSON") from error
    if not isinstance(value, dict) or set(value) != fields:
        raise ContextPackError("wire payload has missing or extra fields")
    return value


def _validate_digest(value: object, *, field: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 71
        or not value.startswith("sha256:")
        or any(character not in "0123456789abcdef" for character in value[7:])
    ):
        raise ContextPackError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _pack_digest(items: tuple[bytes, ...]) -> str:
    unsigned = {"schema": _PACK_SCHEMA, "items": _encode_items(items)}
    return "sha256:" + hashlib.sha256(_canonical_json(unsigned)).hexdigest()


def _pack_payload(items: tuple[bytes, ...], digest: str, byte_count: int) -> dict[str, object]:
    return {
        "schema": _PACK_SCHEMA,
        "items": _encode_items(items),
        "digest": digest,
        "byte_count": byte_count,
    }


def _pack_byte_count(items: tuple[bytes, ...], digest: str) -> int:
    byte_count = 0
    while True:
        measured = len(_canonical_json(_pack_payload(items, digest, byte_count)))
        if measured == byte_count:
            return measured
        byte_count = measured


@dataclass(frozen=True, slots=True)
class ContextPack:
    """A complete prepared context split into independently reusable chunks."""

    items: tuple[bytes, ...]
    digest: str
    byte_count: int

    @classmethod
    def build(cls, items: tuple[bytes, ...]) -> ContextPack:
        validated = _validate_items(items, field="items")
        digest = _pack_digest(validated)
        return cls(items=validated, digest=digest, byte_count=_pack_byte_count(validated, digest))

    @classmethod
    def from_content(cls, content: str, *, chunk_bytes: int = 512) -> ContextPack:
        if not isinstance(content, str):
            raise ContextPackError("content must be a string")
        if type(chunk_bytes) is not int or chunk_bytes <= 0:
            raise ContextPackError("chunk_bytes must be a positive integer")

        chunks: list[bytes] = []
        pending = bytearray()
        for character in content:
            encoded = character.encode("utf-8")
            if len(encoded) > chunk_bytes:
                raise ContextPackError("chunk_bytes cannot contain one complete UTF-8 character")
            if pending and len(pending) + len(encoded) > chunk_bytes:
                chunks.append(bytes(pending))
                pending.clear()
            pending.extend(encoded)
        if pending:
            chunks.append(bytes(pending))
        return cls.build(tuple(chunks))

    def to_bytes(self) -> bytes:
        items = _validate_items(self.items, field="items")
        digest = _validate_digest(self.digest, field="digest")
        if type(self.byte_count) is not int or self.byte_count < 0:
            raise ContextPackError("byte_count must be a non-negative integer")
        if digest != _pack_digest(items):
            raise ContextPackError("context pack digest does not match its items")
        payload = _canonical_json(_pack_payload(items, digest, self.byte_count))
        if len(payload) != self.byte_count:
            raise ContextPackError("context pack byte_count does not match its wire payload")
        return payload

    @classmethod
    def from_bytes(cls, payload: bytes | bytearray | memoryview) -> ContextPack:
        value = _decode_object(payload, fields=_PACK_FIELDS)
        if value["schema"] != _PACK_SCHEMA:
            raise ContextPackError("unsupported context pack schema")
        items = _decode_items(value["items"], field="items")
        digest = _validate_digest(value["digest"], field="digest")
        byte_count = value["byte_count"]
        if type(byte_count) is not int or byte_count < 0:
            raise ContextPackError("byte_count must be a non-negative integer")
        pack = cls(items=items, digest=digest, byte_count=byte_count)
        pack.to_bytes()
        return pack


@dataclass(frozen=True, slots=True)
class ContextPackDelta:
    """A reusable base prefix and the chunks needed to build a target pack."""

    base_digest: str
    target_digest: str
    prefix_items: int
    appended: tuple[bytes, ...]

    @property
    def byte_count(self) -> int:
        return len(self.to_bytes())

    @classmethod
    def between(cls, base: ContextPack, target: ContextPack) -> ContextPackDelta:
        base.to_bytes()
        target.to_bytes()
        prefix_items = 0
        for base_item, target_item in zip(base.items, target.items, strict=False):
            if base_item != target_item:
                break
            prefix_items += 1
        return cls(
            base_digest=base.digest,
            target_digest=target.digest,
            prefix_items=prefix_items,
            appended=target.items[prefix_items:],
        )

    def to_bytes(self) -> bytes:
        base_digest = _validate_digest(self.base_digest, field="base_digest")
        target_digest = _validate_digest(self.target_digest, field="target_digest")
        if type(self.prefix_items) is not int or self.prefix_items < 0:
            raise ContextPackError("prefix_items must be a non-negative integer")
        appended = _validate_items(self.appended, field="appended")
        return _canonical_json({
            "schema": _DELTA_SCHEMA,
            "base_digest": base_digest,
            "target_digest": target_digest,
            "prefix_items": self.prefix_items,
            "appended": _encode_items(appended),
        })

    @classmethod
    def from_bytes(cls, payload: bytes | bytearray | memoryview) -> ContextPackDelta:
        value = _decode_object(payload, fields=_DELTA_FIELDS)
        if value["schema"] != _DELTA_SCHEMA:
            raise ContextPackError("unsupported context pack delta schema")
        base_digest = _validate_digest(value["base_digest"], field="base_digest")
        target_digest = _validate_digest(value["target_digest"], field="target_digest")
        prefix_items = value["prefix_items"]
        if type(prefix_items) is not int or prefix_items < 0:
            raise ContextPackError("prefix_items must be a non-negative integer")
        appended = _decode_items(value["appended"], field="appended")
        return cls(
            base_digest=base_digest,
            target_digest=target_digest,
            prefix_items=prefix_items,
            appended=appended,
        )


def apply_context_pack_delta(base: ContextPack, delta: ContextPackDelta) -> ContextPack:
    """Rebuild and authenticate a target pack using only a base and delta."""

    base.to_bytes()
    delta.to_bytes()
    if base.digest != delta.base_digest:
        raise ContextPackError("context pack delta refers to a different base")
    if delta.prefix_items > len(base.items):
        raise ContextPackError("prefix_items exceeds the base pack")
    target = ContextPack.build((*base.items[: delta.prefix_items], *delta.appended))
    if target.digest != delta.target_digest:
        raise ContextPackError("context pack delta target digest does not match")
    return target
