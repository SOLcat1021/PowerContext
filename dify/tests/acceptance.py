"""Real HTTP + real seekdb acceptance; does not claim to execute the Dify engine.

Starts two separate backend processes against the same database. The second
process must retrieve the first one's memory. SQL independently verifies the
same Scope/Artifact and exact text. Output never includes credentials.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pymysql
import yaml
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get("POWERCONTEXT_BASE_URL", "http://127.0.0.1:18180").rstrip("/")
TOKEN = os.environ.get("POWERCONTEXT_TOKEN", "")
HEADERS = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}


def post(client, path, payload, expected=200):
    result = client.post(path, json=payload)
    if result.status_code != expected:
        raise RuntimeError(f"{path}: expected {expected}, got {result.status_code}: {result.text[:500]}")
    return result.json()


def payload_code(node_id):
    dsl = yaml.safe_load((ROOT / "echoes-theatre.yml").read_text())
    node = next(node for node in dsl["workflow"]["graph"]["nodes"] if node["data"]["title"] == node_id)
    namespace = {}
    exec(compile(node["data"]["code"], f"DSL:{node_id}", "exec"), namespace)
    return namespace["main"]


def main():
    output = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "evidence")
    output.mkdir(parents=True, exist_ok=True)
    marker = "echoesprobe" + uuid4().hex
    story = f'玩家把 "发光钥匙" 交给猫。\n路径 C:\\moon；记号 {marker} 🎭'
    record = {"recorded_at": datetime.now(timezone.utc).isoformat(), "kind": "real_http_and_sql",
              "dify_engine_executed": False, "probe_text": story, "rounds": []}
    scope = None
    expected_scope = None
    for round_index in (1, 2):
        log_path = output / f"backend-process-{round_index}.log"
        with log_path.open("w") as log:
            process = subprocess.Popen([sys.executable, str(ROOT / "serve_backend.py")],
                                       cwd=ROOT, env=os.environ.copy(), stdout=log, stderr=subprocess.STDOUT)
            try:
                with httpx.Client(base_url=BASE, headers=HEADERS, timeout=45, trust_env=False) as client:
                    deadline = time.monotonic() + 120
                    while True:
                        if process.poll() is not None:
                            raise RuntimeError(f"Backend exited; inspect {log_path}")
                        try:
                            ready = client.get("/v1/capabilities")
                            if ready.status_code == 200:
                                break
                        except httpx.TransportError:
                            pass
                        if time.monotonic() > deadline:
                            raise TimeoutError("Backend did not become ready")
                        time.sleep(0.25)
                    if round_index == 1:
                        scope_body = {"title": "回声剧场真实存储验收", "summary": "带引号、换行的剧情跨进程恢复", "idempotency_key": marker}
                        created = post(client, "/v1/scopes", scope_body, 201)
                        scope = created["scope_id"]
                        expected_scope = post(client, "/v1/scopes", scope_body, 201)["scope_id"]
                        assert expected_scope == scope
                        search_payload = json.loads(payload_code("构造检索 JSON")(scope, marker)["payload"])
                        before = post(client, "/v1/memory/search", search_payload)
                        assert before["hits"] == []
                        write_payload = json.loads(payload_code("构造记忆 JSON")(scope, '我说："请记住"\n', story)["payload"])
                        remembered = post(client, "/v1/memory/remember", write_payload)
                        record.update(scope_id=scope, memory=remembered["memory"], empty_before_write=True,
                                      create_scope_replay_same_id=True, written_text=write_payload["text"])
                        other_scope = post(client, "/v1/scopes", {**scope_body, "idempotency_key": marker + "-other"}, 201)["scope_id"]
                        isolated = post(client, "/v1/memory/search", {**search_payload, "scope_id": other_scope})
                        assert isolated["hits"] == []
                        record["other_scope_isolated"] = True
                    search_payload = json.loads(payload_code("构造检索 JSON")(scope, marker)["payload"])
                    found = post(client, "/v1/memory/search", search_payload)
                    assert any(story in hit["text"] for hit in found["hits"]), found
                    record["rounds"].append({"process_id": process.pid, "http_search": found})
            finally:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    embedded = None
    if os.environ.get("POWERCONTEXT_SEEKDB_PATH"):
        import pylibseekdb
        embedded = pylibseekdb.open(os.environ["POWERCONTEXT_SEEKDB_PATH"])
        connection_options = dict(embedded.connection_options())
        connection_options.update(database="test", charset="utf8mb4")
    else:
        url = make_url(os.environ["POWERCONTEXT_DATABASE_URL"])
        connection_options = dict(host=url.host, port=url.port or 2881, user=url.username,
                                  password=url.password or "", database=url.database, charset="utf8mb4")
    with pymysql.connect(**connection_options, cursorclass=pymysql.cursors.DictCursor) as db:
        with db.cursor() as cursor:
            cursor.execute("SELECT VERSION() AS version, DATABASE() AS database_name")
            record["database_identity"] = cursor.fetchone()
            assert "OceanBase" in record["database_identity"]["version"]
            cursor.execute("SELECT scope_id, family, artifact_id, revision, content FROM pc_artifacts WHERE scope_id=%s", (scope,))
            rows = cursor.fetchall()
            exact = []
            for row in rows:
                content = row.pop("content")
                if isinstance(content, bytes):
                    content = content.decode()
                exact.append({**row, "content_sha256": hashlib.sha256(content.encode()).hexdigest(),
                              "content": json.loads(content)})
            assert exact, "No persisted artifact manifest in actual SQL database"
            record["sql_artifacts"] = exact
            cursor.execute("SELECT scope_id, memory_artifact_id, entry_id, entry_version_id, kind, text, "
                           "entry_content_hash, created_in_revision FROM pc_memory_entry_versions WHERE scope_id=%s", (scope,))
            versions = [row for row in cursor.fetchall() if row["text"] == record["written_text"]]
            assert versions, "No exact persisted memory text in actual SQL database"
            manifest_entries = [entry for artifact in exact for entry in artifact["content"].get("manifest", {}).get("entries", [])]
            assert any(entry["entry_version_id"] == version["entry_version_id"]
                       and entry["entry_content_hash"] == version["entry_content_hash"]
                       for entry in manifest_entries for version in versions), "Memory body must match its authoritative manifest"
            record["sql_memory_versions"] = versions
            cursor.execute("SHOW CREATE TABLE pc_artifacts")
            record["artifact_table_ddl"] = cursor.fetchone()["Create Table"]
            cursor.execute("SHOW CREATE TABLE pc_memory_entry_versions")
            record["memory_versions_table_ddl"] = cursor.fetchone()["Create Table"]
    if embedded is not None:
        embedded.close()
    record["passed"] = True
    (output / "acceptance.json").write_text(json.dumps(record, ensure_ascii=False, indent=2, default=str) + "\n")
    print(json.dumps({"passed": True, "backend_restarted": True, "sql_verified": True, "scope_id": scope,
                      "dify_engine_executed": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
