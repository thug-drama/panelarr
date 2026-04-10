from __future__ import annotations

import json
from urllib.parse import urlparse

from fastapi import APIRouter, Body, HTTPException

from backend.services.config import (
    PanelarrConfig,
    _preserve_secrets,
    get_masked_config,
    load_config,
    save_config,
    test_service_connection,
)
from backend.services.registry import KNOWN_SERVICES, SERVICE_CATEGORIES, SERVICE_TYPES

router = APIRouter(prefix="/api/config", tags=["config"])

PROTECTED_KEYS = {"auth"}


@router.get("")
async def get_config() -> dict:
    return get_masked_config()


@router.put("")
async def update_config(updates: dict) -> dict:
    for key in PROTECTED_KEYS:
        updates.pop(key, None)

    current = load_config()
    original = json.loads(json.dumps(current.model_dump()))  # Deep copy
    merged = json.loads(json.dumps(original))

    # Validate service URLs before saving
    if "services" in updates:
        for svc_name, svc_cfg in updates["services"].items():
            url = svc_cfg.get("url", "")
            if url:
                parsed = urlparse(url)
                if parsed.scheme not in ("http", "https"):
                    raise HTTPException(
                        status_code=422,
                        detail=f"Service '{svc_name}': URL scheme must be http or https",
                    )
                if not parsed.hostname:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Service '{svc_name}': URL has no hostname",
                    )
        merged["services"] = updates["services"]

    # Merge notifications
    if "notifications" in updates:
        merged["notifications"] = updates["notifications"]

    # Merge thresholds
    if "thresholds" in updates:
        merged.setdefault("thresholds", {}).update(updates["thresholds"])

    # Preserve secrets (masked values → keep originals)
    merged = _preserve_secrets(merged, original)

    new_config = PanelarrConfig(**merged)
    save_config(new_config)
    return {"status": "ok"}


@router.post("/test/{service}")
async def test_connection(
    service: str,
    override: dict | None = Body(default=None),
) -> dict:
    return await test_service_connection(service, override)


@router.get("/registry")
async def get_service_registry() -> dict:
    """Return the service registry for UI rendering."""
    return {
        "services": KNOWN_SERVICES,
        "types": SERVICE_TYPES,
        "categories": SERVICE_CATEGORIES,
    }

    # Debug endpoint removed for security, use `docker exec` for troubleshooting
