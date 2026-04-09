from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.routers.system import _collect_disks
from backend.services.auth_config import (
    get_effective_auth_mode,
    get_effective_credentials,
    is_auth_writable,
    is_setup_complete,
    mark_setup_complete,
    reset_setup,
    set_auth_in_config,
)
from backend.services.config import (
    PanelarrConfig,
    load_config,
    resolve_config_path,
    save_config,
)
from backend.services.discover import match_containers_to_services
from backend.services.docker import get_docker_version, list_containers
from backend.services.registry import KNOWN_SERVICES, get_service_fields

router = APIRouter(prefix="/api/setup", tags=["setup"])

VERSION = "0.1.0-alpha"


def _require_setup_incomplete() -> None:
    """Raise 403 if setup has already been completed."""
    if is_setup_complete():
        raise HTTPException(status_code=403, detail="Setup already complete")


# Well-known reverse-proxy auth headers, in priority order. The wizard inspects
# the incoming request and surfaces a recommendation if any of these are
# present, so users behind Authelia / Authentik / oauth2-proxy don't end up
# double-authenticating.
_PROXY_AUTH_HEADERS: tuple[tuple[str, str], ...] = (
    ("Remote-User", "Authelia"),
    ("X-authentik-username", "Authentik"),
    ("X-Auth-Request-User", "oauth2-proxy"),
    ("Cf-Access-Authenticated-User-Email", "Cloudflare Access"),
    ("Tailscale-User-Login", "Tailscale Serve"),
)


def _detect_proxy_auth(request: Request) -> dict | None:
    """Inspect request headers for a known reverse-proxy auth header.

    Returns {"header": str, "value": str, "provider": str} when one is found,
    otherwise None.
    """
    for header, provider in _PROXY_AUTH_HEADERS:
        value = request.headers.get(header)
        if value:
            return {"header": header, "value": value, "provider": provider}
    return None


@router.get("/status")
async def setup_status(request: Request) -> dict:
    """Return current setup and auth state."""
    docker_ok = (await get_docker_version()) is not None
    username, _ = get_effective_credentials()
    return {
        "setup_complete": is_setup_complete(),
        "has_credentials": username != "",
        "auth_mode": get_effective_auth_mode(),
        "auth_writable": is_auth_writable(),
        "docker_ok": docker_ok,
        "version": VERSION,
        "detected_proxy": _detect_proxy_auth(request),
    }


@router.get("/system-check")
async def system_check() -> dict:
    """Run pre-setup system checks and enumerate disks."""
    checks: list[dict] = []

    # 1. Docker socket reachable
    docker_info = await get_docker_version()
    docker_ok = docker_info is not None
    checks.append(
        {
            "name": "Docker socket",
            "ok": docker_ok,
            "message": (
                f"Docker {docker_info.get('Version', 'connected')}"
                if docker_ok
                else "Cannot reach Docker socket"
            ),
            "remediation": (
                None
                if docker_ok
                else (
                    "Mount the Docker socket into the container: "
                    "-v /var/run/docker.sock:/var/run/docker.sock:ro"
                )
            ),
        }
    )

    # 2. Config directory writable, uses auto-fallback resolver, so this
    # always succeeds in dev (falls back to ~/.config/panelarr) and only
    # fails in genuinely broken environments.
    try:
        config_path = resolve_config_path()
        test_file = config_path.parent / ".panelarr_write_test"
        test_file.write_text("ok")
        test_file.unlink()
        config_writable = True
        config_msg = f"Config will be saved to {config_path}"
        config_remediation = None
    except OSError as exc:
        config_writable = False
        config_msg = f"Config directory not writable: {exc}"
        config_remediation = (
            "Ensure either /config or ~/.config/panelarr is writable by the process. "
            "In Docker, mount a writable volume at /config."
        )

    checks.append(
        {
            "name": "Config storage",
            "ok": config_writable,
            "message": config_msg,
            "remediation": config_remediation,
        }
    )

    # 3. Enumerate disks (informational, failure is non-blocking)
    disks: list[dict] = []
    try:
        disks = _collect_disks(filter_by_config=False)
    except Exception as exc:  # noqa: BLE001
        checks.append(
            {
                "name": "Disk enumeration",
                "ok": False,
                "message": f"Could not enumerate disks: {exc}",
                "remediation": "Check that /proc and / are accessible.",
            }
        )

    # Currently selected disks (or default to all if nothing saved)
    config = load_config()
    selected = list(config.thresholds.get("disks") or [])

    return {
        "ok": all(c["ok"] for c in checks),
        "checks": checks,
        "disks": disks,
        "selected_disks": selected,
    }


class DisksBody(BaseModel):
    mounts: list[str]


@router.post("/disks")
async def setup_disks(body: DisksBody) -> dict:
    """Save the list of disk mounts to monitor on the dashboard."""
    _require_setup_incomplete()

    config = load_config()
    data = config.model_dump()
    thresholds = dict(data.get("thresholds", {}))
    thresholds["disks"] = list(body.mounts)
    data["thresholds"] = thresholds
    save_config(PanelarrConfig(**data))
    return {"ok": True, "count": len(body.mounts)}


class AuthBody(BaseModel):
    mode: str
    username: str | None = None
    password: str | None = None
    proxy_header: str | None = None
    api_key: str | None = None


_VALID_MODES = {"none", "basic", "proxy", "apikey"}


@router.post("/auth")
async def setup_auth(body: AuthBody) -> dict:
    """Configure authentication mode and credentials."""
    _require_setup_incomplete()

    if body.mode not in _VALID_MODES:
        raise HTTPException(status_code=422, detail=f"Invalid mode: {body.mode!r}")

    if body.mode == "basic":
        if not body.username or not body.password:
            raise HTTPException(
                status_code=422,
                detail="username and password are required for basic auth mode",
            )
        set_auth_in_config(mode="basic", username=body.username, password=body.password)
        return {"ok": True}

    if body.mode == "proxy":
        header = body.proxy_header or "Remote-User"
        set_auth_in_config(mode="proxy", proxy_header=header)
        return {"ok": True}

    if body.mode == "apikey":
        generated_key = secrets.token_urlsafe(32)
        set_auth_in_config(mode="apikey", api_key=generated_key)
        # Returned only once, client must store it
        return {"ok": True, "api_key": generated_key}

    # mode == "none"
    set_auth_in_config(mode="none")
    return {"ok": True}


@router.get("/discover")
async def discover_services() -> dict:
    """Discover running containers and match them to known services."""
    try:
        containers = await list_containers(show_all=False)
    except Exception:
        containers = []

    config = load_config()
    configured = set(config.services.keys())
    matches = match_containers_to_services(containers, configured)

    known_services = [
        {
            "service": name,
            "label": info.get("label", name.title()),
            "category": info.get("category", ""),
            "fields": get_service_fields(name),
        }
        for name, info in KNOWN_SERVICES.items()
    ]

    return {"matches": matches, "known_services": known_services}


class ServicesBody(BaseModel):
    services: dict[str, dict]


@router.post("/services")
async def setup_services(body: ServicesBody) -> dict:
    """Save service configuration (URL, API keys, etc.)."""
    _require_setup_incomplete()

    config = load_config()
    data = config.model_dump()

    # Merge incoming services onto existing, new values overwrite, secrets
    # from body are raw (wizard sends plaintext), so no mask-preservation needed.
    for svc_name, svc_cfg in body.services.items():
        data.setdefault("services", {})[svc_name] = svc_cfg

    save_config(PanelarrConfig(**data))
    return {"ok": True}


class NotificationChannelConfig(BaseModel):
    type: str
    name: str
    config: dict
    enabled: bool = True


class NotificationBody(BaseModel):
    channel: NotificationChannelConfig


@router.post("/test-notification")
async def setup_test_notification(body: NotificationBody) -> dict:
    """Test a notification channel inline (without saving it)."""
    _require_setup_incomplete()
    from backend.services.notifications import send_to_channel

    channel = body.channel.model_dump()
    try:
        ok = await send_to_channel(
            channel,
            "Panelarr Test",
            "This is a test notification from the setup wizard.",
        )
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": str(exc)}
    return {"ok": ok, "message": "Sent" if ok else "Failed to send"}


@router.post("/notifications")
async def setup_notifications(body: NotificationBody) -> dict:
    """Append a notification channel to the config."""
    _require_setup_incomplete()

    config = load_config()
    data = config.model_dump()

    channel = body.channel.model_dump()
    channel["id"] = uuid.uuid4().hex[:12]

    channels: list = data.setdefault("notifications", {}).setdefault("channels", [])
    channels.append(channel)

    save_config(PanelarrConfig(**data))
    return {"ok": True, "id": channel["id"]}


class ThresholdsBody(BaseModel):
    disk_warn_pct: int = 85
    disk_crit_pct: int = 90
    watchdog_threshold_hours: int = 2


@router.post("/thresholds")
async def setup_thresholds(body: ThresholdsBody) -> dict:
    """Save threshold configuration."""
    _require_setup_incomplete()

    config = load_config()
    data = config.model_dump()
    data["thresholds"] = body.model_dump()
    save_config(PanelarrConfig(**data))
    return {"ok": True}


@router.post("/complete")
async def setup_complete() -> dict:
    """Mark setup as complete."""
    _require_setup_incomplete()
    mark_setup_complete()
    return {"ok": True, "redirect": "/"}


@router.post("/reset")
async def setup_reset() -> dict:
    """Reset the setup completion flag to re-run the wizard."""
    if not is_setup_complete():
        raise HTTPException(status_code=400, detail="Setup is not complete, nothing to reset")
    reset_setup()
    return {"ok": True}
