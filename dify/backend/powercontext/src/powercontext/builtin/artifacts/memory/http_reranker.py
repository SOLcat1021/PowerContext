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

"""Score Memory candidates with a caller-owned HTTP client."""

# ruff: noqa: TRY003 -- Protocol validation failures intentionally use ValueError.

from __future__ import annotations

import math

import httpx

from powercontext.builtin.artifacts.memory.models import MemoryHit
from powercontext.builtin.artifacts.memory.reranking import MemoryRerankDecision
from powercontext.builtin.inference import InferenceUsage


class HTTPMemoryReranker:
    """Batch candidate scoring while preserving ranks from the full input pool."""

    def __init__(
        self,
        endpoint: str,
        *,
        client: httpx.AsyncClient,
        batch_size: int = 32,
        policy_id: str = "http-cross-encoder-v1",
    ) -> None:
        if type(batch_size) is not int or batch_size < 1:
            raise ValueError("batch_size must be positive")
        self.endpoint = endpoint
        self.client = client
        self.batch_size = batch_size
        self.policy_id = policy_id

    async def rerank(  # noqa: C901
        self,
        query: str,
        candidates: tuple[MemoryHit, ...],
        limit: int,
        /,
    ) -> MemoryRerankDecision:
        if not candidates or type(limit) is not int or limit < 1 or limit > len(candidates):
            raise ValueError("limit must be between one and the candidate count")

        scores: dict[int, float] = {}
        requests = 0
        for start in range(0, len(candidates), self.batch_size):
            batch = candidates[start : start + self.batch_size]
            ranks = set(range(start + 1, start + len(batch) + 1))
            response = await self.client.post(
                self.endpoint,
                json={
                    "query": query,
                    "candidates": [
                        {"rank": rank, "text": candidate.text} for rank, candidate in enumerate(batch, start=start + 1)
                    ],
                },
            )
            requests += 1
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as exc:
                raise ValueError("Invalid reranker JSON response") from exc
            if not isinstance(payload, dict) or set(payload) != {"scores"} or not isinstance(payload["scores"], list):
                raise ValueError("Invalid reranker response schema")

            batch_scores: dict[int, float] = {}
            for item in payload["scores"]:
                if not isinstance(item, dict) or set(item) != {"rank", "score"}:
                    raise ValueError("Invalid reranker score schema")
                rank, score = item["rank"], item["score"]
                if (
                    type(rank) is not int
                    or rank not in ranks
                    or rank in batch_scores
                    or type(score) not in (int, float)
                ):
                    raise ValueError("Invalid reranker score or rank coverage")
                try:
                    numeric_score = float(score)
                except OverflowError as exc:
                    raise ValueError("Reranker score exceeds the numeric range") from exc
                if not math.isfinite(numeric_score):
                    raise ValueError("Reranker score must be finite")
                batch_scores[rank] = numeric_score
            if set(batch_scores) != ranks:
                raise ValueError("Reranker response does not cover the batch")
            scores.update(batch_scores)

        selected = tuple(sorted(scores, key=lambda rank: (-scores[rank], rank))[:limit])
        return MemoryRerankDecision(selected_ranks=selected, usage=InferenceUsage(requests=requests))


__all__ = ["HTTPMemoryReranker"]
