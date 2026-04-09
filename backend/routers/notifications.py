from __future__ import annotations

from fastapi import APIRouter

from backend.services.notifications import (
    add_channel,
    add_rule,
    delete_channel,
    delete_rule,
    get_channels,
    get_rules,
    notify_event,
    send_to_channel,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/channels")
async def list_channels() -> list[dict]:
    return get_channels()


@router.post("/channels")
async def create_channel(body: dict) -> dict:
    return add_channel(body)


@router.delete("/channels/{channel_id}")
async def remove_channel(channel_id: str) -> dict:
    ok = delete_channel(channel_id)
    return {"ok": ok}


@router.post("/channels/{channel_id}/test")
async def test_channel(channel_id: str) -> dict:
    channels = get_channels()
    channel = next((ch for ch in channels if ch["id"] == channel_id), None)
    if not channel:
        return {"ok": False, "message": "Channel not found"}
    ok = await send_to_channel(channel, "Panelarr Test", "This is a test notification.")
    return {"ok": ok, "message": "Sent" if ok else "Failed to send"}


@router.post("/channels/test")
async def test_channel_draft(body: dict) -> dict:
    """Test an unsaved channel payload (used by the Add Channel form)."""
    channel = {
        "type": body.get("type", ""),
        "name": body.get("name", "Draft"),
        "config": body.get("config", {}),
        "enabled": True,
    }
    if not channel["type"]:
        return {"ok": False, "message": "Channel type is required"}
    ok = await send_to_channel(channel, "Panelarr Test", "This is a test notification.")
    return {"ok": ok, "message": "Sent" if ok else "Failed to send"}


@router.get("/rules")
async def list_rules() -> list[dict]:
    return get_rules()


@router.post("/rules")
async def create_rule(body: dict) -> dict:
    return add_rule(body)


@router.delete("/rules/{rule_id}")
async def remove_rule(rule_id: str) -> dict:
    ok = delete_rule(rule_id)
    return {"ok": ok}


@router.post("/health-check")
async def send_health_notification() -> dict:
    """Trigger a health check notification to all subscribed channels."""
    from backend.routers.system import health_check

    health = await health_check()

    lines = [f"Status: {health['status'].upper()}"]
    lines.append(f"Containers: {health['containers_running']}/{health['containers_total']}")
    lines.append(f"Memory: {health['memory_pct']}%")
    for d in health.get("disk", []):
        lines.append(f"Disk {d['mount']}: {d['pct']}%")

    body = "\n".join(lines)
    color = 0x00FF00 if health["status"] == "healthy" else 0xFF0000

    result = await notify_event("health_check", "Panelarr Health Check", body, color, force=True)
    return {"ok": result["sent"] > 0 or result["failed"] == 0, **result}
