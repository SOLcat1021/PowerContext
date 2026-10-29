"""Render recorded evidence for screenshots; this is not the MiniMax UI."""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT / "evidence"
sections = []
for label, name in [
    ("Before: regression tests", "before-regression.json"),
    ("Before: target feature tests", "before-target.json"),
    ("MiniMax official CLI result", "minimax-response.json"),
    ("Actual generated code diff", "minimax.patch"),
    ("After: unchanged tests", "after-all.json"),
    ("State recovered after restart", "recovered.json"),
    ("Specification update and re-import", "spec-update.json"),
    ("Direct seekdb SQL evidence", "database.json"),
]:
    path = EVIDENCE / name
    if path.exists():
        text = path.read_text(encoding="utf-8")
        if name == "minimax-response.json":
            try:
                text = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
            except json.JSONDecodeError:
                pass
        sections.append(f'<section><h2>{html.escape(label)}</h2><p>Source: evidence/{name}</p><pre>{html.escape(text)}</pre></section>')
page = '''<!doctype html><html><meta charset="utf-8"><title>MiniMax SDD evidence</title>
<style>body{margin:40px auto;max-width:1100px;background:#eef2f7;color:#172333;font:16px system-ui}
h1{color:#153b72}section{background:white;padding:22px;margin:20px 0;border-radius:12px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#102236;color:#e2efff;padding:18px;font:14px Consolas,monospace}
p{color:#526275}h2{font-size:21px}</style>
<h1>MiniMax · SDD engineering context</h1><p>Evidence viewer generated from actual execution logs. This page is not the MiniMax product UI.</p>'''
if (EVIDENCE / "minimax-response.json").exists():
    model = json.loads((EVIDENCE / "minimax-response.json").read_text(encoding="utf-8"))
    before = json.loads((EVIDENCE / "before-target.json").read_text(encoding="utf-8"))
    after = json.loads((EVIDENCE / "after-all.json").read_text(encoding="utf-8"))
    summary = f'<section><h2>Actual run summary</h2><p>Model: {html.escape(model["model"]["modelId"])} · Run: {html.escape(model["runId"])}</p>'
    summary += f'<p>Before target exit code: {before["exit_code"]} · After all tests exit code: {after["exit_code"]}</p>'
    summary += '<pre>' + html.escape(after["stderr"]) + '</pre></section>'
    page += summary
(EVIDENCE / "report.html").write_text(page + "".join(sections) + "</html>", encoding="utf-8")
if all((EVIDENCE / name).exists() for name in ("database.json", "recovered.json", "spec-update.json")):
    database = json.loads((EVIDENCE / "database.json").read_text(encoding="utf-8"))
    recovered = json.loads((EVIDENCE / "recovered.json").read_text(encoding="utf-8"))
    update = json.loads((EVIDENCE / "spec-update.json").read_text(encoding="utf-8"))
    verification = {"database": database["identity"], "stored_rows": len(database["rows"]),
                    "sql_verification_passed": database["passed"],
                    "fresh_process_recovered_hits": len(recovered["result"]["hits"]),
                    "specification_update_marker": update["marker"],
                    "reimported_sources": [s["path"] for s in update["context"]["sources"]],
                    "saved_progress_used_in_updated_context": bool(update["context"]["previous_progress"]["hits"])}
    (EVIDENCE / "verification.html").write_text(page.split('<section>')[0] + '<section><h2>Persistence and specification verification</h2><p>Sources: database.json, recovered.json, spec-update.json</p><pre>'
             + html.escape(json.dumps(verification, indent=2)) + '</pre></section></html>', encoding="utf-8")
