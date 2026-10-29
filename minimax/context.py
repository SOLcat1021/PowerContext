"""Engineering context backed by real PowerContext HTTP + seekdb, no mocks."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / ".runtime"
BASE = os.environ.get("MINIMAX_CONTEXT_URL", "http://127.0.0.1:18280").rstrip("/")


def post(path, payload):
    headers = {"Content-Type": "application/json"}
    token = os.environ.get("MINIMAX_CONTEXT_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(BASE + path, data=json.dumps(payload).encode(), headers=headers)
    # Local loopback must not be sent to a system HTTP proxy.
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=60) as response:
        return json.load(response)


def scope(key, title):
    return post("/v1/scopes", {"title": title, "summary": "MiniMax SDD verification", "idempotency_key": key})["scope_id"]


def save_json(path, body):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ingest():
    # A fresh Scope is an immutable material revision. Switch active import only
    # after all writes succeed, so incomplete imports cannot supersede good data.
    batch = uuid4().hex
    material_scope = scope("minimax-material-" + batch, "SDD engineering material " + batch)
    receipts = []
    for relative in ("sample/spec.md", "sample/tasks.py", "sample/test_tasks.py"):
        body = (ROOT / relative).read_text(encoding="utf-8")
        digest = hashlib.sha256(body.encode()).hexdigest()
        document = {"path": relative, "sha256": digest, "content": body}
        result = post("/v1/memory/remember", {
            "scope_id": material_scope, "kind": "engineering_material",
            "text": "task priority filter engineering source\n" + json.dumps(document),
            "reason": "Explicit source import for TASK-PRIORITY",
        })
        receipts.append({"path": relative, "sha256": digest, "receipt": result})
    state_scope = scope("minimax-sdd-progress-v1", "MiniMax SDD task progress")
    active = {"material_scope": material_scope, "state_scope": state_scope, "batch": batch}
    save_json(RUNTIME / "active.json", active)
    save_json(ROOT / "evidence" / ("import-" + batch + ".json"), {**active, "receipts": receipts})
    return active


def search(scope_id, query):
    return post("/v1/memory/search", {"scope_id": scope_id, "query": query, "limit": 20, "mode": "fts"})


def prepare(task):
    active = json.loads((RUNTIME / "active.json").read_text(encoding="utf-8"))
    materials = search(active["material_scope"], task)
    hits = materials.get("hits", [])
    if not hits:
        raise RuntimeError("No database sources matched this task; refusing a fixed fallback answer")
    sources = []
    for hit in hits:
        document = json.loads(hit["text"].split("\n", 1)[1])
        source = ROOT / document["path"]
        if not source.is_file() or hashlib.sha256(source.read_text(encoding="utf-8").encode()).hexdigest() != document["sha256"]:
            raise RuntimeError("Source changed since import: " + document["path"])
        sources.append(document)
    expected = {"sample/spec.md", "sample/tasks.py", "sample/test_tasks.py"}
    if not expected.issubset({s["path"] for s in sources}):
        raise RuntimeError("Database query omitted a required source")
    progress = search(active["state_scope"], "minimaxprogress")
    result = {"task": task, "active_import": active, "sources": sources,
              "previous_progress": progress, "database_query": materials}
    save_json(ROOT / "evidence" / "context.json", result)
    return result


def record(state):
    active = json.loads((RUNTIME / "active.json").read_text(encoding="utf-8"))
    result = post("/v1/memory/remember", {"scope_id": active["state_scope"], "kind": "task_progress",
                  "text": "minimaxprogress\n" + json.dumps(state), "reason": "Persist task progress for module restart"})
    save_json(ROOT / "evidence" / ("state-" + uuid4().hex + ".json"), {"state": state, "receipt": result})
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["import", "prepare", "record"])
    parser.add_argument("value", nargs="?", default="task priority filter")
    args = parser.parse_args()
    result = ingest() if args.action == "import" else prepare(args.value) if args.action == "prepare" else record(json.loads(args.value))
    print(json.dumps(result, ensure_ascii=False, indent=2))
