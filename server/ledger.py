"""
测绘员的旗标账本（Demo 4）。

这不是游戏存档，也不是聊天记录。
它只记住同一条测线上发生过的几件事实：见过面、换过油、警告过、上次停在哪个状态。

关掉这个进程，记忆就没了——和浏览器里 LLM 失败就回退本地，是同一模式。
HTML 仍然可以双击打开；本服务挂了，灰岩会失忆，游戏继续可玩。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# ledger.py 在 server/ 里，上一级才是 index.html 所在的仓库根。
ROOT = Path(__file__).resolve().parent.parent
ALLOWED_STATES = frozenset(
    {"idle", "greet", "ask", "trade", "warn", "farewell", "done"}
)

app = FastAPI(
    title="Survey line ledger",
    description="NPC 旗标账本：只记 met / traded / warned / last_state。",
    docs_url=None,
    redoc_url=None,
)

# 浏览器可能从 file://、:8000 或本服务的 :8765 打开页面。
# 本地演示允许任何来源；这里没有密钥，也不该有。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=".*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 测线键 → 旗标。进程内字典，没有数据库。
LEDGER: dict[str, dict[str, Any]] = {}


class FlagBody(BaseModel):
    """POST 时整张表一起送来。缺的字段按「没发生过」处理。"""

    line: str = Field(..., min_length=1, max_length=80)
    met: bool = False
    traded: bool = False
    warned: bool = False
    last_state: str = "idle"


def blank_flags() -> dict[str, Any]:
    return {
        "met": False,
        "traded": False,
        "warned": False,
        "last_state": "idle",
    }


def line_key(raw: str) -> str:
    """
    同一条测线：下行只是在种子后面叠 "-down"。
    账本键剥掉这些后缀，所以 stardust-7 和 stardust-7-down 是同一个人。
    """
    s = (raw or "").strip()
    if not s:
        raise HTTPException(status_code=400, detail="测线键为空")
    if len(s) > 80:
        raise HTTPException(status_code=400, detail="测线键太长")
    if "/" in s or "\\" in s or ".." in s:
        raise HTTPException(status_code=400, detail="测线键含非法字符")
    while s.endswith("-down"):
        s = s[: -len("-down")]
    if not s:
        raise HTTPException(status_code=400, detail="测线键为空")
    return s


def clamp_state(value: str) -> str:
    s = (value or "idle").strip()
    return s if s in ALLOWED_STATES else "idle"


def public_payload(key: str) -> dict[str, Any]:
    stored = key in LEDGER
    flags = LEDGER.get(key) or blank_flags()
    return {
        "line": key,
        "flags": flags,
        "source": "ledger" if stored else "blank",
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "entries": len(LEDGER)}


@app.get("/memory")
def get_memory(line: str) -> dict[str, Any]:
    key = line_key(line)
    return public_payload(key)


@app.post("/memory")
def post_memory(body: FlagBody) -> dict[str, Any]:
    key = line_key(body.line)
    LEDGER[key] = {
        "met": bool(body.met),
        "traded": bool(body.traded),
        "warned": bool(body.warned),
        "last_state": clamp_state(body.last_state),
    }
    return public_payload(key)


# API 路由必须写在 mount 之前，否则 /memory 会被当成静态文件。
app.mount("/", StaticFiles(directory=str(ROOT), html=True), name="site")
