"""Create and seed the PowerContext scope used by the Echoes Theatre demo.

The script intentionally uses only the Python standard library so it can run in
the same small environment used to demonstrate the Dify application.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


BASE_URL = os.environ.get("POWERCONTEXT_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
SCOPE_ID = os.environ.get("POWERCONTEXT_SCOPE_ID", "dify-echoes-demo")
TOKEN = os.environ.get("POWERCONTEXT_TOKEN", "")


def request(method: str, path: str, payload: dict | None = None) -> tuple[int, object]:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8")
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body: object = json.loads(raw)
        except json.JSONDecodeError:
            body = raw
        return exc.code, body


def main() -> int:
    status, body = request(
        "POST",
        "/v1/scopes",
        {
            "title": "回声剧场演示",
            "summary": "Dify Just for Fun 作品的跨会话剧情记忆",
            "idempotency_key": SCOPE_ID,
        },
    )
    if status not in (201, 409):
        print(f"创建 Scope 失败（HTTP {status}）：{body}", file=sys.stderr)
        return 1

    if status == 201 and isinstance(body, dict):
        actual_scope = body.get("scope_id") or body.get("id") or SCOPE_ID
    else:
        actual_scope = SCOPE_ID

    seed = [
        "玩家喜欢把危险的道具交给会说冷笑话的猫。",
        "月亮车站的第三块钟面后面藏着一条通往海底的门。",
        "玩家已经答应过守门人：每次改变路线都要留下一个荒诞的理由。",
    ]
    for text in seed:
        status, body = request(
            "POST",
            "/v1/memory/remember",
            {
                "scope_id": actual_scope,
                "kind": "echoes_theatre_seed",
                "text": text,
                "reason": "回声剧场验证样例的初始剧情记忆",
            },
        )
        if status not in (200, 201):
            print(f"写入初始记忆失败（HTTP {status}）：{body}", file=sys.stderr)
            return 1

    print(f"POWERCONTEXT_SCOPE_ID={actual_scope}")
    print("已写入 3 条初始剧情记忆。请把这个 Scope ID 填入 Dify 的环境变量 POWERCONTEXT_SCOPE_ID。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

