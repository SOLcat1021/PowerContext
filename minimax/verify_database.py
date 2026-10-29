"""Independent SQL verification. Stop the embedded backend before running."""
import json
import os
from pathlib import Path

import pylibseekdb
import pymysql

ROOT = Path(__file__).resolve().parent
active = json.loads((ROOT / ".runtime/active.json").read_text())
db = pylibseekdb.open(os.environ["MINIMAX_SEEKDB_PATH"])
try:
    options = dict(db.connection_options())
    options.update(database="test", charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor)
    with pymysql.connect(**options) as connection, connection.cursor() as cursor:
        cursor.execute("SELECT VERSION() AS version, DATABASE() AS database_name")
        identity = cursor.fetchone()
        assert "OceanBase" in identity["version"], identity
        cursor.execute("SELECT scope_id, entry_id, kind, text FROM pc_memory_entry_versions WHERE scope_id IN (%s,%s)",
                       (active["material_scope"], active["state_scope"]))
        rows = cursor.fetchall()
        assert any("sample/spec.md" in r["text"] for r in rows)
        assert any("sample/tasks.py" in r["text"] for r in rows)
        assert any("test_tasks.py" in r["text"] for r in rows)
        assert any("TASK-PRIORITY" in r["text"] and r["kind"] == "task_progress" for r in rows)
        result = {"identity": identity, "query": "SELECT scope_id, entry_id, kind, text FROM pc_memory_entry_versions WHERE scope_id IN (?, ?)",
                  "scope_ids": [active["material_scope"], active["state_scope"]], "rows": rows, "passed": True}
        (ROOT / "evidence/database.json").write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps({"identity": identity, "stored_rows": len(rows), "passed": True}))
finally:
    db.close()
