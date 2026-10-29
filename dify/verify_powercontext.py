"""Run the two checks used in the Echoes Theatre verification sample."""

from __future__ import annotations

import json
import os
import urllib.request


base_url = os.environ.get("POWERCONTEXT_BASE_URL", "http://127.0.0.1:18180").rstrip("/")
scope_id = os.environ["POWERCONTEXT_SCOPE_ID"]
token = os.environ.get("POWERCONTEXT_TOKEN", "")


def post(path: str, payload: dict) -> dict:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


result = post(
    "/v1/memory/search",
    {"scope_id": scope_id, "query": "月亮车站", "limit": 8, "mode": "fts"},
)
hits = result.get("hits", [])
print(f"search_hits={len(hits)}")
for index, hit in enumerate(hits[:3], 1):
    print(f"hit_{index}={hit.get('text', hit)}")
assert hits, "PowerContext returned no seeded memories"
print("PowerContext search verification passed")

