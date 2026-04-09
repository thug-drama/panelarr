from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture()
def config_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point settings.config_path at a temp file and bust the config cache."""
    import dataclasses

    cfg = tmp_path / "panelarr.json"

    # Settings is a frozen dataclass, so we replace the whole module-level
    # `settings` attribute with a new instance instead of mutating a field.
    import backend.config as cfg_module
    import backend.services.config as svc_cfg

    new_settings = dataclasses.replace(cfg_module.settings, config_path=str(cfg))
    monkeypatch.setattr(cfg_module, "settings", new_settings)
    # `backend.services.config` did `from backend.config import settings`,
    # which captured a reference at import time, patch that name too.
    monkeypatch.setattr(svc_cfg, "settings", new_settings)

    # Reset the resolved-path memo and the config cache so the next call
    # to load_config re-reads from the freshly-patched path.
    monkeypatch.setattr(svc_cfg, "_resolved_config_path", None)
    svc_cfg._config_cache = None
    svc_cfg._config_cache_at = 0.0

    yield cfg

    # Cleanup cache after test
    svc_cfg._config_cache = None
    svc_cfg._config_cache_at = 0.0


def test_auth_mode_from_config(config_path: Path) -> None:
    config_path.write_text(json.dumps({"auth": {"mode": "proxy"}}))

    from backend.services.auth_config import get_effective_auth_mode

    assert get_effective_auth_mode() == "proxy"


def test_auth_mode_default(config_path: Path) -> None:
    # No config file
    from backend.services.auth_config import get_effective_auth_mode

    assert get_effective_auth_mode() == "none"


def test_auth_mode_invalid_falls_back_to_none(config_path: Path) -> None:
    config_path.write_text(json.dumps({"auth": {"mode": "nonsense"}}))

    from backend.services.auth_config import get_effective_auth_mode

    assert get_effective_auth_mode() == "none"


def test_credentials_from_config(config_path: Path) -> None:
    config_path.write_text(
        json.dumps({"auth": {"username": "cfguser", "password_hash": "$2b$12$fakehashXYZ"}})
    )

    from backend.services.auth_config import get_effective_credentials

    username, pw_hash = get_effective_credentials()
    assert username == "cfguser"
    assert pw_hash == "$2b$12$fakehashXYZ"


def test_credentials_empty_when_unset(config_path: Path) -> None:
    from backend.services.auth_config import get_effective_credentials

    username, pw_hash = get_effective_credentials()
    assert username == ""
    assert pw_hash == ""


def test_set_auth_writes_bcrypt_hash(config_path: Path) -> None:
    from backend.services.auth_config import set_auth_in_config

    set_auth_in_config(mode="basic", username="alice", password="hunter2")

    data = json.loads(config_path.read_text())
    auth = data["auth"]
    assert auth["mode"] == "basic"
    assert auth["username"] == "alice"
    assert auth["password_hash"].startswith("$2b$")

    # Verify the stored hash is valid
    from backend.services.auth import verify_password

    assert verify_password("hunter2", auth["password_hash"])


def test_set_auth_preserves_secret(config_path: Path) -> None:
    # Pre-populate with an existing secret
    config_path.write_text(json.dumps({"auth": {"secret": "existingsecret"}}))

    # Bust the cache so we read from the new file
    import backend.services.config as svc_cfg

    svc_cfg._config_cache = None

    from backend.services.auth_config import set_auth_in_config

    set_auth_in_config(mode="basic", username="bob", password="pass")

    data = json.loads(config_path.read_text())
    assert data["auth"]["secret"] == "existingsecret"
    assert data["auth"]["username"] == "bob"


def test_set_auth_partial_update(config_path: Path) -> None:
    from backend.services.auth_config import set_auth_in_config

    set_auth_in_config(mode="proxy", proxy_header="X-Remote-User")

    data = json.loads(config_path.read_text())
    auth = data["auth"]
    assert auth["mode"] == "proxy"
    assert auth["proxy_header"] == "X-Remote-User"
    # password_hash should not exist
    assert "password_hash" not in auth


def test_setup_incomplete_fresh(config_path: Path) -> None:
    from backend.services.auth_config import is_setup_complete

    assert is_setup_complete() is False


def test_setup_complete_after_mark(config_path: Path) -> None:
    from backend.services.auth_config import is_setup_complete, mark_setup_complete

    assert is_setup_complete() is False
    mark_setup_complete()

    # Bust cache for re-read
    import backend.services.config as svc_cfg

    svc_cfg._config_cache = None
    assert is_setup_complete() is True


def test_setup_backfill_with_services(config_path: Path) -> None:
    """Existing user with services but no setup flag should get auto-migrated."""
    config_path.write_text(
        json.dumps({"services": {"sonarr": {"url": "http://sonarr:8989", "api_key": "abc"}}})
    )

    import backend.services.config as svc_cfg

    svc_cfg._config_cache = None

    from backend.services.auth_config import is_setup_complete

    assert is_setup_complete() is True

    # Verify the flag was written
    data = json.loads(config_path.read_text())
    assert data["setup"]["completed_at"] == "auto-migrated"


def test_setup_no_backfill_without_services(config_path: Path) -> None:
    """Fresh config with no services should NOT be auto-migrated."""
    from backend.services.auth_config import is_setup_complete

    assert is_setup_complete() is False


def test_reset_setup(config_path: Path) -> None:
    from backend.services.auth_config import is_setup_complete, mark_setup_complete, reset_setup

    mark_setup_complete()

    import backend.services.config as svc_cfg

    svc_cfg._config_cache = None
    assert is_setup_complete() is True

    reset_setup()
    svc_cfg._config_cache = None
    assert is_setup_complete() is False

    # Verify completed_at key is gone but version may remain
    data = json.loads(config_path.read_text())
    assert "completed_at" not in data.get("setup", {})


def test_auth_always_writable(config_path: Path) -> None:
    """After the env-auth removal, auth is always writable through the UI."""
    from backend.services.auth_config import is_auth_writable

    assert is_auth_writable() is True


def test_proxy_header_from_config(config_path: Path) -> None:
    config_path.write_text(json.dumps({"auth": {"proxy_header": "X-From-Config"}}))

    import backend.services.config as svc_cfg

    svc_cfg._config_cache = None

    from backend.services.auth_config import get_effective_proxy_header

    assert get_effective_proxy_header() == "X-From-Config"


def test_proxy_header_default(config_path: Path) -> None:
    from backend.services.auth_config import get_effective_proxy_header

    assert get_effective_proxy_header() == "Remote-User"


def test_api_key_from_config(config_path: Path) -> None:
    config_path.write_text(json.dumps({"auth": {"api_key": "from-config"}}))

    import backend.services.config as svc_cfg

    svc_cfg._config_cache = None

    from backend.services.auth_config import get_effective_api_key

    assert get_effective_api_key() == "from-config"


def test_api_key_empty_default(config_path: Path) -> None:
    from backend.services.auth_config import get_effective_api_key

    assert get_effective_api_key() == ""
