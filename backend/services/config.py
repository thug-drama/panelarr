from __future__ import annotations

import json
import logging
import os
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel

from backend.config import settings
from backend.services.registry import KNOWN_SERVICES, get_secret_fields

logger = logging.getLogger(__name__)

API_TIMEOUT = 10
MASKED_PREFIX = "****"
SENSITIVE_KEYS = {"api_key", "password", "token"}


class PanelarrConfig(BaseModel):
    services: dict[str, dict] = {}
    notifications: dict = {"channels": [], "rules": []}
    thresholds: dict = {
        "disk_warn_pct": 85,
        "disk_crit_pct": 90,
        "watchdog_threshold_hours": 2,
        "disks": [],
    }
    auth: dict = {}
    setup: dict = {}


_resolved_config_path: Path | None = None


def resolve_config_path() -> Path:
    """Return a writable config file path.

    Tries `settings.config_path` first; if that location is not writable
    (common in dev where /config doesn't exist on the host), falls back to
    `~/.config/panelarr/panelarr.json`. Result is cached for the lifetime
    of the process.
    """
    global _resolved_config_path
    if _resolved_config_path is not None:
        return _resolved_config_path

    primary = Path(settings.config_path)
    fallback = Path.home() / ".config" / "panelarr" / "panelarr.json"
    candidates = [primary, fallback]

    for candidate in candidates:
        try:
            candidate.parent.mkdir(parents=True, exist_ok=True)
            test = candidate.parent / ".panelarr_write_test"
            test.write_text("ok")
            test.unlink()
        except OSError:
            continue
        if candidate != primary:
            logger.warning("Config path %s not writable; falling back to %s", primary, candidate)
        _resolved_config_path = candidate
        return candidate

    # Last resort, use the fallback path even if untested; subsequent
    # writes will surface the underlying error.
    _resolved_config_path = fallback
    return fallback


def is_masked(value: str) -> bool:
    """Check if a value is a masked secret (starts with ****)."""
    return isinstance(value, str) and value.startswith(MASKED_PREFIX)


def get_service_config(config: PanelarrConfig, name: str) -> dict:
    """Get config dict for a service by name."""
    return config.services.get(name, {})


def _migrate_v1_to_v2(raw: dict) -> dict:
    """Migrate old config format (typed top-level fields) to v2 (all in services dict)."""
    if "services" in raw and isinstance(raw["services"], dict):
        # Check if it's already v2 (services contains actual service configs)
        # v1 had services as overflow for dynamic services alongside typed fields
        # v2 has ALL services in services dict
        typed_keys = ("sonarr", "radarr", "sabnzbd", "qbittorrent", "plex", "jellyfin")
        has_typed = any(k in raw for k in typed_keys)
        if not has_typed:
            return raw  # Already v2

    # Migrate typed service fields into services dict
    services = raw.get("services", {}) if isinstance(raw.get("services"), dict) else {}
    for name in ("sonarr", "radarr", "sabnzbd", "qbittorrent", "plex", "jellyfin"):
        if name in raw and isinstance(raw[name], dict):
            svc = raw.pop(name)
            # Only migrate if it has data
            if any(v for v in svc.values() if v):
                services[name] = svc

    # Migrate discord_webhook into notifications
    notifications = raw.get("notifications", {"channels": [], "rules": []})
    if not isinstance(notifications, dict):
        notifications = {"channels": [], "rules": []}

    # Move old notification_channels/rules into notifications
    if "notification_channels" in raw:
        notifications["channels"] = raw.pop("notification_channels", [])
    if "notification_rules" in raw:
        notifications["rules"] = raw.pop("notification_rules", [])

    # Move discord_webhook, create a legacy channel if webhook exists
    discord_webhook = raw.pop("discord_webhook", "")

    # Migrate thresholds
    thresholds = raw.get("thresholds", {})
    if not isinstance(thresholds, dict):
        thresholds = {}
    for key in ("disk_warn_pct", "disk_crit_pct", "watchdog_threshold_hours"):
        if key in raw:
            thresholds[key] = raw.pop(key)
    thresholds.setdefault("disk_warn_pct", 85)
    thresholds.setdefault("disk_crit_pct", 90)
    thresholds.setdefault("watchdog_threshold_hours", 2)

    # Clean result, preserve auth and setup blocks untouched, since they
    # are not part of the v1 → v2 migration and stripping them would wipe
    # credentials and wizard state on first load.
    result = {
        "services": services,
        "notifications": notifications,
        "thresholds": thresholds,
    }
    if "auth" in raw and isinstance(raw["auth"], dict):
        result["auth"] = raw["auth"]
    if "setup" in raw and isinstance(raw["setup"], dict):
        result["setup"] = raw["setup"]

    # If there was a legacy discord webhook and no channels exist, preserve it
    # by creating a channel automatically
    if discord_webhook and not discord_webhook.startswith("****"):
        channels = notifications.get("channels", [])
        if not any(ch.get("type") == "discord" for ch in channels):
            channels.append(
                {
                    "id": uuid.uuid4().hex[:12],
                    "type": "discord",
                    "name": "Discord (migrated)",
                    "config": {"webhook_url": discord_webhook},
                    "enabled": True,
                }
            )
            notifications["channels"] = channels

    return result


def _preserve_secrets(merged: dict, original: dict) -> dict:
    """Replace masked values in merged dict with real values from original."""
    # Handle services dict
    merged_svcs = merged.get("services", {})
    orig_svcs = original.get("services", {})
    for svc_name, svc_config in merged_svcs.items():
        if isinstance(svc_config, dict):
            orig_svc = orig_svcs.get(svc_name, {})
            secret_fields = get_secret_fields(svc_name)
            for sf in secret_fields:
                if sf in svc_config and is_masked(svc_config[sf]):
                    svc_config[sf] = orig_svc.get(sf, "")

    # Handle notification channel configs
    merged_channels = merged.get("notifications", {}).get("channels", [])
    orig_channels = original.get("notifications", {}).get("channels", [])
    orig_ch_map = {ch["id"]: ch for ch in orig_channels if "id" in ch}
    for ch in merged_channels:
        orig_ch = orig_ch_map.get(ch.get("id", ""), {})
        ch_config = ch.get("config", {})
        orig_config = orig_ch.get("config", {})
        for key in ("webhook_url", "bot_token"):
            if key in ch_config and is_masked(ch_config[key]):
                ch_config[key] = orig_config.get(key, "")

    return merged


def _migrate_config_file(config_path: Path) -> None:
    """Migrate old config file names to current name."""
    if config_path.is_file():
        return
    old_names = ["stackpanel.json"]
    for old_name in old_names:
        old_path = config_path.parent / old_name
        if old_path.is_file():
            logger.info("Migrating config file: %s → %s", old_path, config_path)
            old_path.rename(config_path)
            return


_config_cache: PanelarrConfig | None = None
_config_cache_at: float = 0.0
_CONFIG_TTL = 5.0


def load_config() -> PanelarrConfig:
    """Load config from JSON file, migrate if needed, overlay env vars.

    Results are cached for up to _CONFIG_TTL seconds to avoid repeated disk reads.
    """
    global _config_cache, _config_cache_at
    now = time.monotonic()
    if _config_cache is not None and (now - _config_cache_at) < _CONFIG_TTL:
        return _config_cache

    config_path = resolve_config_path()
    _migrate_config_file(config_path)
    config = PanelarrConfig()
    if config_path.is_file():
        try:
            raw = json.loads(config_path.read_text())
            # Migrate v1 format to v2 if needed
            raw = _migrate_v1_to_v2(raw)
            config = PanelarrConfig(**raw)
            logger.debug("Config loaded from %s", config_path)
        except (json.JSONDecodeError, ValueError) as exc:
            logger.warning("Invalid config file at %s: %s, using defaults", config_path, exc)
    else:
        logger.debug("No config file at %s, using defaults", config_path)

    _config_cache = config
    _config_cache_at = now
    return config


def save_config(config: PanelarrConfig) -> None:
    """Write config to JSON file atomically and invalidate the in-process cache.

    Writes go through a sibling temp file + ``os.replace`` so the on-disk file
    is never observed half-written. If the process is killed between the
    ``write`` and the ``replace``, the original file is left untouched and
    the temp file is cleaned up on the next save attempt.
    """
    global _config_cache
    config_path = resolve_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    data = config.model_dump()
    payload = json.dumps(data, indent=2)

    # Write to a sibling temp file in the same directory so os.replace is
    # guaranteed to be atomic (same filesystem). NamedTemporaryFile is used
    # with delete=False because we hand the path to os.replace ourselves.
    tmp_dir = config_path.parent
    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=tmp_dir,
        prefix=".panelarr.",
        suffix=".tmp",
        delete=False,
    )
    try:
        try:
            tmp.write(payload)
            tmp.flush()
            os.fsync(tmp.fileno())
        finally:
            tmp.close()
        # Lock down permissions BEFORE the rename so the file is never
        # world-readable, even for the brief window between create and replace.
        try:
            os.chmod(tmp.name, 0o600)
        except OSError:
            pass
        os.replace(tmp.name, config_path)
    except Exception:
        # Best-effort cleanup of the temp file if anything went wrong
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise

    _config_cache = None
    # Log which services have data
    saved_svcs = [name for name, cfg in data.get("services", {}).items() if cfg.get("url")]
    logger.info("Config saved to %s, services: %s", config_path, ", ".join(saved_svcs) or "none")


def mask_secret(value: str) -> str:
    """Show only last 4 chars of a secret. Hide fully if 8 chars or fewer."""
    if not value:
        return ""
    if len(value) <= 8:
        return MASKED_PREFIX
    return MASKED_PREFIX + value[-4:]


def get_masked_config() -> dict:
    """Return config with sensitive fields masked."""
    config = load_config()
    data = config.model_dump()

    # Mask service secrets
    for svc_name, svc_config in data.get("services", {}).items():
        if isinstance(svc_config, dict):
            secret_fields = get_secret_fields(svc_name)
            for sf in secret_fields:
                if sf in svc_config and isinstance(svc_config[sf], str):
                    svc_config[sf] = mask_secret(svc_config[sf])

    # Mask notification channel secrets
    for ch in data.get("notifications", {}).get("channels", []):
        ch_config = ch.get("config", {})
        for key in ("webhook_url", "bot_token"):
            if key in ch_config and isinstance(ch_config[key], str):
                ch_config[key] = mask_secret(ch_config[key])

    # Never expose auth secrets
    data.pop("auth", None)
    return data


def _validate_url(url: str) -> str | None:
    """Validate a service URL. Returns error message or None if valid."""
    if not url:
        return "No URL configured"
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return f"URL scheme '{parsed.scheme}' not allowed, use http or https"
    if not parsed.hostname:
        return "URL has no hostname"
    return None


def _build_config_for_test(service: str, override: dict | None = None) -> PanelarrConfig:
    """Build a config for testing, merging form overrides onto real config."""
    config = load_config()
    if not override:
        return config

    data = config.model_dump()
    original = json.loads(json.dumps(data))  # Deep copy

    # Merge service-specific overrides into services dict
    if service == "discord":
        # Discord override goes into notification channel config
        pass  # Handled separately in test function
    elif service in data.get("services", {}):
        for key, value in override.items():
            data["services"][service][key] = value
    else:
        data.setdefault("services", {})[service] = override

    data = _preserve_secrets(data, original)
    return PanelarrConfig(**data)


async def _test_arr_service(url: str, api_key: str, client: httpx.AsyncClient) -> dict:
    """Test an ARR service."""
    err = _validate_url(url)
    if err:
        return {"ok": False, "message": err}
    resp = await client.get(
        f"{url}/api/v3/system/status",
        headers={"X-Api-Key": api_key},
    )
    resp.raise_for_status()
    return {"ok": True, "message": f"Connected, v{resp.json().get('version', '?')}"}


async def _test_sabnzbd(url: str, api_key: str, client: httpx.AsyncClient) -> dict:
    if not url:
        return {"ok": False, "message": "No URL configured"}
    resp = await client.get(
        f"{url}/api",
        params={"mode": "version", "apikey": api_key, "output": "json"},
    )
    resp.raise_for_status()
    return {"ok": True, "message": f"Connected, {resp.json().get('version', '?')}"}


async def _test_qbittorrent(
    url: str, username: str, password: str, client: httpx.AsyncClient
) -> dict:
    if not url:
        return {"ok": False, "message": "No URL configured"}
    resp = await client.post(
        f"{url}/api/v2/auth/login",
        data={"username": username, "password": password},
    )
    if resp.text == "Ok.":
        return {"ok": True, "message": "Connected"}
    return {"ok": False, "message": "Authentication failed"}


async def _test_transmission(
    url: str, username: str, password: str, client: httpx.AsyncClient
) -> dict:
    if not url:
        return {"ok": False, "message": "No URL configured"}
    resp = await client.get(
        f"{url}/transmission/rpc",
        auth=(username, password) if username else None,
    )
    if resp.status_code in (200, 409):
        return {"ok": True, "message": "Connected"}
    resp.raise_for_status()
    return {"ok": False, "message": f"HTTP {resp.status_code}"}


async def _test_plex(url: str, token: str, client: httpx.AsyncClient) -> dict:
    if not url:
        return {"ok": False, "message": "No URL configured"}
    resp = await client.get(
        f"{url}/identity",
        headers={"X-Plex-Token": token},
    )
    resp.raise_for_status()
    return {"ok": True, "message": "Connected"}


async def _test_jellyfin_emby(url: str, client: httpx.AsyncClient) -> dict:
    if not url:
        return {"ok": False, "message": "No URL configured"}
    resp = await client.get(f"{url}/System/Info/Public")
    resp.raise_for_status()
    info = resp.json()
    return {"ok": True, "message": f"Connected, v{info.get('Version', '?')}"}


async def _test_api_key_service(
    url: str, api_key: str, test_path: str, client: httpx.AsyncClient
) -> dict:
    if not url:
        return {"ok": False, "message": "No URL configured"}
    resp = await client.get(
        f"{url}{test_path}",
        params={"apikey": api_key},
    )
    resp.raise_for_status()
    return {"ok": True, "message": "Connected"}


async def test_service_connection(service: str, override: dict | None = None) -> dict[str, object]:
    """Test connectivity to a configured service."""
    config = _build_config_for_test(service, override)
    svc_config = get_service_config(config, service)

    # For discord, use the override directly
    if service == "discord" and override and "webhook_url" in override.get("config", override):
        cfg = override.get("config", override)
        webhook = cfg.get("webhook_url", override.get("discord_webhook", ""))
        if not webhook or is_masked(webhook):
            return {"ok": False, "message": "No webhook URL configured"}
        try:
            async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
                resp = await client.post(webhook, json={"content": "Panelarr test notification"})
                resp.raise_for_status()
                return {"ok": True, "message": "Webhook sent"}
        except Exception as exc:
            return {"ok": False, "message": type(exc).__name__}

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            svc_info = KNOWN_SERVICES.get(service)
            svc_type = svc_info["type"] if svc_info else None

            if svc_type == "arr":
                return await _test_arr_service(
                    svc_config.get("url", ""), svc_config.get("api_key", ""), client
                )
            elif svc_type == "sabnzbd":
                return await _test_sabnzbd(
                    svc_config.get("url", ""), svc_config.get("api_key", ""), client
                )
            elif svc_type == "qbittorrent":
                return await _test_qbittorrent(
                    svc_config.get("url", ""),
                    svc_config.get("username", ""),
                    svc_config.get("password", ""),
                    client,
                )
            elif svc_type == "transmission":
                return await _test_transmission(
                    svc_config.get("url", ""),
                    svc_config.get("username", ""),
                    svc_config.get("password", ""),
                    client,
                )
            elif svc_type == "plex":
                return await _test_plex(
                    svc_config.get("url", ""), svc_config.get("token", ""), client
                )
            elif svc_type in ("jellyfin", "emby"):
                return await _test_jellyfin_emby(svc_config.get("url", ""), client)
            else:
                return {"ok": False, "message": f"Unknown service: {service}"}
    except httpx.ConnectError:
        return {"ok": False, "message": "Connection refused, is the service running?"}
    except httpx.TimeoutException:
        return {"ok": False, "message": "Connection timed out"}
    except httpx.HTTPStatusError as exc:
        return {"ok": False, "message": f"HTTP {exc.response.status_code}"}
    except Exception as exc:
        return {"ok": False, "message": type(exc).__name__}
