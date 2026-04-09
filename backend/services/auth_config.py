from __future__ import annotations

import logging
from datetime import UTC, datetime

logger = logging.getLogger(__name__)

VERSION = "0.1.0-alpha"

_VALID_AUTH_MODES = {"none", "basic", "proxy", "apikey"}


#
# All auth values live in panelarr.json. There is no env-var override:
# the setup wizard writes them, the Settings page updates them, and the
# backend reads them back. Keeping a single source of truth makes the
# code easier to reason about and the UX easier to explain.


def get_effective_auth_mode() -> str:
    """Return the configured auth mode, defaulting to 'none'."""
    from backend.services.config import load_config

    config = load_config()
    mode = config.auth.get("mode", "none") if config.auth else "none"  # type: ignore[union-attr]
    if mode not in _VALID_AUTH_MODES:
        logger.warning("Invalid auth mode %r in config, falling back to 'none'", mode)
        return "none"
    return mode


def get_effective_credentials() -> tuple[str, str]:
    """Return ``(username, password_hash)`` for basic auth.

    Reads from ``panelarr.json``. Returns ``("", "")`` when credentials
    are not yet configured.
    """
    from backend.services.config import load_config

    config = load_config()
    if not config.auth:
        return ("", "")
    username = config.auth.get("username", "")  # type: ignore[union-attr]
    password_hash = config.auth.get("password_hash", "")  # type: ignore[union-attr]
    if username and password_hash:
        return (username, password_hash)
    return ("", "")


def get_effective_proxy_header() -> str:
    """Return the configured proxy header name, defaulting to 'Remote-User'."""
    from backend.services.config import load_config

    config = load_config()
    if not config.auth:
        return "Remote-User"
    return config.auth.get("proxy_header", "Remote-User")  # type: ignore[union-attr]


def get_effective_api_key() -> str:
    """Return the configured API key, or an empty string if unset."""
    from backend.services.config import load_config

    config = load_config()
    if not config.auth:
        return ""
    return config.auth.get("api_key", "")  # type: ignore[union-attr]


def is_auth_writable() -> bool:
    """Auth settings are always writable through the UI.

    This function used to return ``False`` when ``AUTH_USERNAME`` /
    ``AUTH_PASSWORD`` were pinned via the environment. Env-based auth
    has been removed, so it now always returns ``True``. Kept as a
    function so existing callers and API responses do not change shape.
    """
    return True


def set_auth_in_config(
    *,
    mode: str | None = None,
    username: str | None = None,
    password: str | None = None,
    proxy_header: str | None = None,
    api_key: str | None = None,
) -> None:
    """Write auth fields to panelarr.json, preserving existing auth.secret.

    Only non-None arguments are written. Password is bcrypt-hashed before storage.
    """
    from backend.services.auth import hash_password
    from backend.services.config import load_config, save_config

    config = load_config()
    # config.auth is a plain dict, preserve existing fields (e.g. secret)
    auth: dict = dict(config.auth) if config.auth else {}  # type: ignore[arg-type]

    if mode is not None:
        auth["mode"] = mode
    if username is not None:
        auth["username"] = username
    if password is not None:
        auth["password_hash"] = hash_password(password)
    if proxy_header is not None:
        auth["proxy_header"] = proxy_header
    if api_key is not None:
        auth["api_key"] = api_key

    # Rebuild config with updated auth block
    data = config.model_dump()
    data["auth"] = auth
    from backend.services.config import PanelarrConfig

    save_config(PanelarrConfig(**data))


def is_setup_complete() -> bool:
    """True iff config['setup']['completed_at'] is set.

    Backfill: only on the *first observation* of a *legacy* install
    (setup dict is empty, services are already configured, AND the wizard
    has not started writing the auth block) do we auto-write
    setup.completed_at = 'auto-migrated' so existing users skip the wizard.

    The auth-block check is what distinguishes a legacy install from a
    wizard mid-flight: the wizard always writes auth before services, so
    once `auth.mode` is present we know we're inside an active wizard and
    must not short-circuit it. After a reset, setup contains a 'reset_at'
    sentinel which also prevents re-backfilling.
    """
    from backend.services.config import PanelarrConfig, load_config, save_config

    config = load_config()
    setup: dict = config.setup if config.setup else {}  # type: ignore[assignment]

    if setup.get("completed_at"):
        return True

    auth_block: dict = config.auth if config.auth else {}  # type: ignore[assignment]
    wizard_in_progress = bool(auth_block.get("mode"))

    if not setup and config.services and not wizard_in_progress:
        logger.info(
            "Backfilling setup.completed_at for existing installation (%d service(s) configured)",
            len(config.services),
        )
        data = config.model_dump()
        data["setup"] = {"completed_at": "auto-migrated", "version": VERSION}
        save_config(PanelarrConfig(**data))
        return True

    return False


def mark_setup_complete() -> None:
    """Write config['setup'] = {completed_at, version}."""
    from backend.services.config import PanelarrConfig, load_config, save_config

    config = load_config()
    data = config.model_dump()
    data["setup"] = {
        "completed_at": datetime.now(UTC).isoformat(),
        "version": VERSION,
    }
    save_config(PanelarrConfig(**data))


def reset_setup() -> None:
    """Wipe wizard-managed config so the user can re-run the wizard cleanly.

    This is a *destructive* operation: it clears services, notifications,
    thresholds, and the setup flag, but preserves the `auth` block (and its
    `secret`) so the current user is not unexpectedly logged out.

    Writes a 'reset_at' sentinel into `setup` so `is_setup_complete()` does
    not re-backfill on the next call from the legacy migration heuristic.
    """
    from backend.services.config import PanelarrConfig, load_config, save_config

    config = load_config()
    data = config.model_dump()

    # Preserve auth (mode + credentials + secret) so login still works.
    preserved_auth = dict(data.get("auth", {}))

    # Wipe everything else managed by the wizard.
    data["services"] = {}
    data["notifications"] = {"channels": [], "rules": []}
    data["thresholds"] = {
        "disk_warn_pct": 85,
        "disk_crit_pct": 90,
        "watchdog_threshold_hours": 2,
        "disks": [],
    }
    data["auth"] = preserved_auth
    data["setup"] = {"reset_at": datetime.now(UTC).isoformat()}

    save_config(PanelarrConfig(**data))
