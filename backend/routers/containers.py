from __future__ import annotations

import logging
import re

from fastapi import APIRouter, HTTPException

from backend.services.docker import (
    check_container_updates,
    container_action,
    get_container,
    list_containers,
    pull_and_recreate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/containers", tags=["containers"])

CONTAINER_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,127}$")


def _validate_name(name: str) -> None:
    if not CONTAINER_NAME_RE.match(name):
        raise HTTPException(status_code=422, detail="Invalid container name")


@router.get("")
async def get_containers(show_all: bool = True) -> list[dict]:
    try:
        return await list_containers(show_all=show_all)
    except Exception as exc:
        logger.error("Docker error listing containers: %s", exc)
        raise HTTPException(status_code=503, detail="Docker unavailable") from exc


@router.get("/check-updates")
async def check_updates() -> dict:
    """Check all containers for available image updates."""
    try:
        containers = await list_containers(show_all=True)
    except Exception as exc:
        logger.error("Docker error checking updates: %s", exc)
        raise HTTPException(status_code=503, detail="Docker unavailable") from exc
    results = await check_container_updates(containers)
    updates_available = sum(1 for r in results.values() if r.get("has_update"))
    return {"updates": results, "updates_available": updates_available}


@router.get("/{name}")
async def get_container_detail(name: str) -> dict:
    _validate_name(name)
    try:
        container = await get_container(name)
    except Exception as exc:
        logger.error("Docker error getting container %s: %s", name, exc)
        raise HTTPException(status_code=503, detail="Docker unavailable") from exc
    if not container:
        raise HTTPException(status_code=404, detail="Container not found")
    return container


@router.post("/{name}/restart")
async def restart_container(name: str) -> dict:
    _validate_name(name)
    return await container_action(name, "restart")


@router.post("/{name}/start")
async def start_container(name: str) -> dict:
    _validate_name(name)
    return await container_action(name, "start")


@router.post("/{name}/stop")
async def stop_container(name: str) -> dict:
    _validate_name(name)
    return await container_action(name, "stop")


@router.post("/{name}/update")
async def update_container(name: str) -> dict:
    _validate_name(name)
    return await pull_and_recreate(name)
