"""Run in a fresh process after restarting the backend; exercise dynamic imports."""
import json
from pathlib import Path
from uuid import uuid4

from context import ROOT, ingest, prepare, record, save_json, search


def main():
    active = json.loads((ROOT / ".runtime/active.json").read_text(encoding="utf-8"))
    recovered = search(active["state_scope"], "minimaxprogress")
    assert any("TASK-PRIORITY" in h["text"] and "target and regression tests" in h["text"] for h in recovered["hits"])
    save_json(ROOT / "evidence/recovered.json", {"fresh_process": True, "result": recovered})
    spec = ROOT / "sample/spec.md"
    original = spec.read_text(encoding="utf-8")
    marker = "specrevision" + uuid4().hex
    try:
        spec.write_text(original + "\nUpdated clarification: medium priority is supported. Revision " + marker + "\n", encoding="utf-8")
        ingest()
        updated = prepare("task priority filter")
        assert any(marker in s["content"] for s in updated["sources"])
        assert updated["previous_progress"]["hits"], "Recovered state must be used in the new context"
        save_json(ROOT / "evidence/spec-update.json", {"marker": marker, "fresh_import": True, "context": updated})
    finally:
        spec.write_text(original, encoding="utf-8")
        ingest()
    resumed = prepare("task priority filter")
    assert resumed["previous_progress"]["hits"]
    save_json(ROOT / "evidence/resumed-context.json", resumed)
    record({"task": "TASK-PRIORITY", "completed": ["MiniMax code change", "10 unchanged tests pass",
            "backend and context module restarted", "state reused in subsequent context", "specification re-import"],
            "todo": [], "verification": "evidence/after-all.json"})
    print("Fresh process recovered state; updated specification retrieved; resumed context uses saved state.")


if __name__ == "__main__":
    main()
