from __future__ import annotations

import asyncio
import logging
import re

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from backend.services.auth import COOKIE_NAME, validate_api_key, verify_token
from backend.services.auth_config import get_effective_auth_mode
from backend.services.docker import get_container_logs, stream_container_logs

logger = logging.getLogger(__name__)

router = APIRouter(tags=["logs"])

CONTAINER_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,127}$")

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _check_ws_auth(websocket: WebSocket) -> bool:
    """Check WebSocket authentication based on the configured auth mode."""
    mode = get_effective_auth_mode()
    if mode == "none":
        return True
    if mode == "proxy":
        return True
    if mode == "basic":
        token = websocket.cookies.get(COOKIE_NAME)
        return bool(token and verify_token(token))
    if mode == "apikey":
        api_key = websocket.headers.get("x-api-key", "")
        return validate_api_key(api_key)
    return False


@router.get("/api/logs/{container_name}")
async def get_logs(
    container_name: str,
    lines: int = Query(default=200, ge=1, le=5000),
) -> dict:
    if not CONTAINER_NAME_RE.match(container_name):
        return {"container": container_name, "lines": [], "error": "Invalid container name"}
    log_lines = await get_container_logs(container_name, lines)
    return {"container": container_name, "lines": [_strip_ansi(line) for line in log_lines]}


@router.websocket("/ws/logs/{container_name}")
async def ws_stream_logs(websocket: WebSocket, container_name: str) -> None:
    if not _check_ws_auth(websocket):
        await websocket.close(code=4401)
        return
    if not CONTAINER_NAME_RE.match(container_name):
        await websocket.close(code=4400)
        return
    await websocket.accept()
    try:
        async for line in stream_container_logs(container_name):
            await websocket.send_text(_strip_ansi(line))
            await asyncio.sleep(0)
        # Stream ended, container likely stopped. Close with 4000 (custom: stream ended)
        # so the frontend knows NOT to auto-reconnect.
        try:
            await websocket.send_text("[Stream ended, container stopped]")
            await websocket.close(code=4000, reason="Container stopped")
        except RuntimeError:
            pass
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Log streaming error for %s", container_name)
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass
