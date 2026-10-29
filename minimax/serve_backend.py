"""Launch a dedicated real PowerContext + seekdb backend (Linux/WSL)."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "vendor/powercontext/src"))
import uvicorn
from powercontext.builtin.persistence.seekdb import SeekDBConfig
from powercontext.server.factory import create_server_app
from powercontext.server.settings import BearerAuthConfig, McpConfig, ServerSettings

if __name__ == "__main__":
    workspace = ROOT / ".runtime/server"
    workspace.mkdir(parents=True, exist_ok=True)
    settings = ServerSettings(workspace=workspace,
        database=SeekDBConfig(path=Path(os.environ.get("MINIMAX_SEEKDB_PATH", str(ROOT / ".runtime/seekdb")))),
        auth=BearerAuthConfig(enabled=bool(os.environ.get("MINIMAX_CONTEXT_TOKEN")), token=os.environ.get("MINIMAX_CONTEXT_TOKEN") or None),
        mcp=McpConfig(enabled=False))
    uvicorn.run(create_server_app(settings=settings), host="127.0.0.1", port=18280)
