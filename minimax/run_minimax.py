"""Submit database-derived context to official MiniMax CLI and record the result."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from context import ROOT, prepare, record, save_json


def run_tests(label, test_class=None):
    command = [sys.executable, "-m", "unittest", "-v"] + (["test_tasks." + test_class] if test_class else [])
    result = subprocess.run(command, cwd=ROOT / "sample", capture_output=True, text=True, encoding="utf-8")
    entry = {"command": command, "exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
             "source_sha256": hashlib.sha256((ROOT / "sample/tasks.py").read_bytes()).hexdigest(),
             "tests_sha256": hashlib.sha256((ROOT / "sample/test_tasks.py").read_bytes()).hexdigest()}
    save_json(ROOT / "evidence" / (label + ".json"), entry)
    return result.returncode


def main():
    mcode = shutil.which("mcode.cmd") or shutil.which("mcode")
    if not mcode:
        candidate = Path.home() / "AppData/Roaming/npm/mcode.cmd"
        mcode = str(candidate) if candidate.exists() else None
    if not mcode:
        raise SystemExit("Install official @minimax-ai/code and run mcode login")
    evidence = ROOT / "evidence"
    evidence.mkdir(exist_ok=True)
    before = (ROOT / "sample/tasks.py").read_bytes()
    (evidence / "tasks.before.py").write_bytes(before)
    tests_before = (ROOT / "sample/test_tasks.py").read_bytes()
    if run_tests("before-regression", "RegressionTests") != 0:
        raise RuntimeError("Baseline regression tests must pass")
    if run_tests("before-target", "TargetTests") == 0:
        raise RuntimeError("Target tests already pass; this is not a before/after development sample")
    context = prepare("task priority filter")
    prompt = ("Implement TASK-PRIORITY using the following real database-retrieved engineering context. "
              "Modify only sample/tasks.py. Do not change tests, specifications, evidence or context tooling. "
              "Do not access credentials, install dependencies or use the network. Run python -m unittest -v "
              "in sample to verify. Explain the change briefly.\n" + json.dumps(context, ensure_ascii=False))
    (evidence / "minimax-prompt.txt").write_text(prompt, encoding="utf-8")
    command = [mcode, "exec", "--cwd", str(ROOT), "--input", "-", "--timeout", "4m", "--max-steps", "15",
               "--output-format", "json", "--prompt-mode", "coding"]
    started = datetime.now(timezone.utc).isoformat()
    result = subprocess.run(command, input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=300)
    (evidence / "minimax-response.json").write_text(result.stdout, encoding="utf-8")
    (evidence / "minimax-stderr.txt").write_text(result.stderr, encoding="utf-8")
    save_json(evidence / "minimax-run.json", {"command": command, "started_at": started, "exit_code": result.returncode})
    if result.returncode != 0:
        raise RuntimeError("MiniMax run failed; see evidence")
    body = json.loads(result.stdout)
    if body.get("status") != "succeeded":
        raise RuntimeError("MiniMax did not report success")
    if (ROOT / "sample/test_tasks.py").read_bytes() != tests_before:
        raise RuntimeError("Tests changed during development")
    after = (ROOT / "sample/tasks.py").read_bytes()
    (evidence / "tasks.after.py").write_bytes(after)
    import difflib
    (evidence / "minimax.patch").write_text("".join(difflib.unified_diff(before.decode().splitlines(True),
                   after.decode().splitlines(True), fromfile="before/tasks.py", tofile="after/tasks.py")), encoding="utf-8")
    if after == before or run_tests("after-all") != 0:
        raise RuntimeError("MiniMax changes did not satisfy the same tests")
    record({"task": "TASK-PRIORITY", "completed": ["MiniMax code change", "target and regression tests"],
            "todo": ["restart context module and verify persisted state", "spec update verification"],
            "verification": "evidence/after-all.json", "model": body.get("model")})
    print("MiniMax code change and tests passed; progress saved through PowerContext.")


if __name__ == "__main__":
    main()
