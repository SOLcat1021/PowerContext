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

"""Concurrent request coalescing and bounded caching for embedding models."""

from __future__ import annotations

import asyncio
import math
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from itertools import islice

from powercontext.builtin.inference.models import EmbeddingResult, EmbeddingVector, InferenceUsage
from powercontext.builtin.inference.protocols import EmbeddingModel, QueryEmbeddingModel, embed_query

_Embed = Callable[[tuple[str, ...]], Awaitable[EmbeddingResult]]


class _InvalidCoalescingParameterError(ValueError):
    def __init__(self, name: str, expectation: str) -> None:
        super().__init__(f"{name} must be {expectation}")


class _InvalidVectorCountError(ValueError):
    def __init__(self, actual: int, expected: int) -> None:
        super().__init__(f"embedding model returned {actual} vectors for {expected} texts")


@dataclass(frozen=True, slots=True, eq=False)
class _BatchReceipt:
    """One provider batch, shared by every text and caller that depended on it."""

    usage: InferenceUsage


@dataclass(frozen=True, slots=True)
class _ResolvedEmbedding:
    vector: EmbeddingVector
    receipt: _BatchReceipt | None


@dataclass(slots=True)
class _EmbeddingState:
    cache: OrderedDict[str, EmbeddingVector] = field(default_factory=OrderedDict)
    in_flight: dict[str, asyncio.Future[_ResolvedEmbedding]] = field(default_factory=dict)
    pending: OrderedDict[str, asyncio.Future[_ResolvedEmbedding]] = field(default_factory=OrderedDict)
    flush_task: asyncio.Task[None] | None = None


class CoalescingEmbeddingModel:
    """Share embedding work across calls and cache successful vectors.

    Pending and in-flight work is scoped to the event loop on which callers
    submit it. Completed vectors are ordinary immutable tuples, so the bounded
    cache can also be reused by a later event loop when the wrapper is idle.
    """

    def __init__(
        self,
        model: EmbeddingModel,
        *,
        max_batch_size: int = 64,
        coalesce_ms: float = 5.0,
        cache_size: int = 1024,
    ) -> None:
        if isinstance(max_batch_size, bool) or not isinstance(max_batch_size, int) or max_batch_size < 1:
            raise _InvalidCoalescingParameterError("max_batch_size", "a positive integer")
        if (
            isinstance(coalesce_ms, bool)
            or not isinstance(coalesce_ms, (int, float))
            or not math.isfinite(coalesce_ms)
            or coalesce_ms < 0
        ):
            raise _InvalidCoalescingParameterError("coalesce_ms", "a finite non-negative number")
        if isinstance(cache_size, bool) or not isinstance(cache_size, int) or cache_size < 0:
            raise _InvalidCoalescingParameterError("cache_size", "a non-negative integer")

        self._model = model
        self.profile = model.profile
        self._max_batch_size = max_batch_size
        self._coalesce_seconds = float(coalesce_ms) / 1000.0
        self._cache_size = cache_size
        self._documents = _EmbeddingState()
        self._queries = _EmbeddingState()
        self._distinct_queries = isinstance(model, QueryEmbeddingModel)

    async def embed(self, texts: tuple[str, ...], /) -> EmbeddingResult:
        """Embed document texts, preserving input order and duplicate positions."""

        return await self._embed(self._documents, self._model.embed, texts)

    async def embed_query(self, texts: tuple[str, ...], /) -> EmbeddingResult:
        """Embed queries while preserving a provider's asymmetric query behavior."""

        if not self._distinct_queries:
            return await self._embed(self._documents, self._model.embed, texts)
        return await self._embed(self._queries, self._embed_base_query, texts)

    async def _embed_base_query(self, texts: tuple[str, ...]) -> EmbeddingResult:
        return await embed_query(self._model, texts)

    async def _embed(self, state: _EmbeddingState, delegate: _Embed, texts: tuple[str, ...]) -> EmbeddingResult:
        if not texts:
            return EmbeddingResult(vectors=())

        loop = asyncio.get_running_loop()
        requested: list[asyncio.Future[_ResolvedEmbedding] | _ResolvedEmbedding] = []
        for text in texts:
            cached = self._cache_get(state, text)
            if cached is not None:
                requested.append(_ResolvedEmbedding(vector=cached, receipt=None))
                continue

            future = state.in_flight.get(text)
            if future is None:
                future = loop.create_future()
                state.in_flight[text] = future
                state.pending[text] = future
            requested.append(future)

        if state.pending and (state.flush_task is None or state.flush_task.done()):
            state.flush_task = asyncio.create_task(self._drain(state, delegate))

        resolved = await self._resolve_without_cancelling_shared_work(requested)
        receipts = tuple(dict.fromkeys(item.receipt for item in resolved if item.receipt is not None))
        return EmbeddingResult(
            vectors=tuple(item.vector for item in resolved),
            usage=_sum_usage(tuple(receipt.usage for receipt in receipts)),
        )

    async def _resolve_without_cancelling_shared_work(
        self,
        requested: list[asyncio.Future[_ResolvedEmbedding] | _ResolvedEmbedding],
    ) -> tuple[_ResolvedEmbedding, ...]:
        futures = tuple(item for item in requested if isinstance(item, asyncio.Future))
        if futures:
            # Shield the aggregate rather than individual shared futures. Cancelling
            # one caller must never cancel provider work used by another caller.
            await asyncio.shield(asyncio.gather(*futures))
        return tuple(item.result() if isinstance(item, asyncio.Future) else item for item in requested)

    async def _drain(self, state: _EmbeddingState, delegate: _Embed) -> None:
        try:
            # A zero-width window still yields once so calls already scheduled on
            # this loop can join the same pending set.
            await asyncio.sleep(self._coalesce_seconds)
            while state.pending:
                batch = tuple(islice(state.pending, self._max_batch_size))
                futures = tuple(state.pending.pop(text) for text in batch)
                try:
                    result = await delegate(batch)
                    if len(result.vectors) != len(batch):
                        _raise_invalid_vector_count(len(result.vectors), len(batch))
                except asyncio.CancelledError as error:
                    # A provider can cancel its own request independently of any
                    # waiter. Release these keys before propagating cancellation
                    # so a later call can retry instead of awaiting stale futures.
                    self._fail_batch(state, batch, futures, error)
                    raise
                except Exception as error:
                    self._fail_batch(state, batch, futures, error)
                    continue

                receipt = _BatchReceipt(usage=result.usage)
                for text, future, vector in zip(batch, futures, result.vectors, strict=True):
                    if state.in_flight.get(text) is future:
                        del state.in_flight[text]
                    self._cache_put(state, text, vector)
                    if not future.done():
                        future.set_result(_ResolvedEmbedding(vector=vector, receipt=receipt))
        finally:
            state.flush_task = None
            if state.pending:
                state.flush_task = asyncio.create_task(self._drain(state, delegate))

    @staticmethod
    def _fail_batch(
        state: _EmbeddingState,
        texts: tuple[str, ...],
        futures: tuple[asyncio.Future[_ResolvedEmbedding], ...],
        error: BaseException,
    ) -> None:
        for text, future in zip(texts, futures, strict=True):
            if state.in_flight.get(text) is future:
                del state.in_flight[text]
            if not future.done():
                future.set_exception(error)

    def _cache_get(self, state: _EmbeddingState, text: str) -> EmbeddingVector | None:
        if self._cache_size == 0:
            return None
        try:
            vector = state.cache.pop(text)
        except KeyError:
            return None
        state.cache[text] = vector
        return vector

    def _cache_put(self, state: _EmbeddingState, text: str, vector: EmbeddingVector) -> None:
        if self._cache_size == 0:
            return
        state.cache.pop(text, None)
        state.cache[text] = vector
        while len(state.cache) > self._cache_size:
            state.cache.popitem(last=False)


def _sum_usage(values: tuple[InferenceUsage, ...]) -> InferenceUsage:
    if not values:
        return InferenceUsage(requests=0)
    return InferenceUsage(
        requests=sum(value.requests for value in values),
        input_tokens=_sum_optional(value.input_tokens for value in values),
        output_tokens=_sum_optional(value.output_tokens for value in values),
    )


def _sum_optional(values: Iterable[int | None]) -> int | None:
    materialized = tuple(values)
    if any(value is None for value in materialized):
        return None
    return sum(value for value in materialized if value is not None)


def _raise_invalid_vector_count(actual: int, expected: int) -> None:
    raise _InvalidVectorCountError(actual, expected)


__all__ = ["CoalescingEmbeddingModel"]
