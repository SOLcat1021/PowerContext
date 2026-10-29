"""Run the bundled, unmodified PowerContext runtime against OceanBase/seekdb."""
from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from powercontext.builtin.persistence.oceanbase import OceanBaseConfig
from powercontext.builtin.persistence.seekdb import SeekDBConfig
from powercontext.server.factory import create_server_app
from powercontext.server.settings import BearerAuthConfig, McpConfig, ServerSettings


def main() -> None:
    database_url = os.environ.get("POWERCONTEXT_DATABASE_URL")
    seekdb_path = os.environ.get("POWERCONTEXT_SEEKDB_PATH")
    if bool(database_url) == bool(seekdb_path):
        raise SystemExit("Set exactly one of POWERCONTEXT_DATABASE_URL (OceanBase) or POWERCONTEXT_SEEKDB_PATH (embedded seekdb).")
    token = os.environ.get("POWERCONTEXT_TOKEN", "")
    workspace = Path(os.environ.get("POWERCONTEXT_WORKSPACE", ".echoes-runtime")).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    settings = ServerSettings(
        workspace=workspace,
        database=OceanBaseConfig(url=database_url) if database_url else SeekDBConfig(path=Path(seekdb_path)),
        auth=BearerAuthConfig(enabled=bool(token), token=token or None),
        mcp=McpConfig(enabled=False),
    )
    host = os.environ.get("POWERCONTEXT_HOST", "127.0.0.1")
    if host not in {"127.0.0.1", "::1", "localhost"} and not token:
        raise SystemExit("Non-loopback binding requires POWERCONTEXT_TOKEN.")
    uvicorn.run(create_server_app(settings=settings), host=host,
                port=int(os.environ.get("POWERCONTEXT_PORT", "18180")), access_log=True)


if __name__ == "__main__":
    main()
