from __future__ import annotations

from fastapi import APIRouter

from backend.services.arr import (
    get_radarr_queue,
    get_radarr_status,
    get_sonarr_queue,
    get_sonarr_status,
)

router = APIRouter(prefix="/api/arr", tags=["arr"])


@router.get("/sonarr/status")
async def sonarr_status() -> dict:
    return await get_sonarr_status()


@router.get("/sonarr/queue")
async def sonarr_queue() -> dict:
    return await get_sonarr_queue()


@router.get("/radarr/status")
async def radarr_status() -> dict:
    return await get_radarr_status()


@router.get("/radarr/queue")
async def radarr_queue() -> dict:
    return await get_radarr_queue()
