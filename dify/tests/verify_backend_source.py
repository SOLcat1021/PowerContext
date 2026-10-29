"""Verify the bundled runtime against the pinned Git archive manifest."""
from pathlib import Path
import hashlib
import json

backend = Path(__file__).resolve().parents[1] / "backend"
manifest = json.loads((backend / "source-sha256.json").read_text())
for relative, expected in manifest.items():
    actual = hashlib.sha256((backend / "powercontext" / relative).read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f"Bundled source differs from pinned commit: {relative}")
print(f"Verified {len(manifest)} pinned upstream files")
