from __future__ import annotations

import json
import logging
import os
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
TOKEN_EXPIRY_HOURS = 24
COOKIE_NAME = "sp_session"


_cached_secret: str | None = None


def get_or_create_secret() -> str:
    """Get the JWT signing secret, generating one on first use.

    Cached in memory after the first read. The secret lives in
    ``panelarr.json`` under ``auth.secret`` and is auto-generated on
    first start if the file does not already contain one.
    """
    global _cached_secret
    if _cached_secret:
        return _cached_secret

    from backend.services.config import resolve_config_path

    config_path = resolve_config_path()
    if config_path.is_file():
        try:
            data = json.loads(config_path.read_text())
            stored = data.get("auth", {}).get("secret", "")
            if stored:
                _cached_secret = stored
                return _cached_secret
        except (json.JSONDecodeError, ValueError):
            pass

    # Generate new secret and persist with restrictive permissions
    new_secret = secrets.token_hex(32)
    try:
        data = {}
        if config_path.is_file():
            data = json.loads(config_path.read_text())
        data.setdefault("auth", {})["secret"] = new_secret
        config_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(config_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
    except Exception:
        logger.warning("Could not persist auth secret to config file")
    _cached_secret = new_secret
    return _cached_secret


MAX_PASSWORD_BYTES = 72


def hash_password(plaintext: str) -> str:
    """Hash a password with bcrypt.

    Raises ValueError if the encoded password exceeds bcrypt's 72-byte limit.
    """
    encoded = plaintext.encode()
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be {MAX_PASSWORD_BYTES} bytes or fewer when encoded")
    return bcrypt.hashpw(encoded, bcrypt.gensalt()).decode()


def verify_password(plaintext: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(plaintext.encode(), hashed.encode())
    except (ValueError, TypeError):
        return False


def get_credentials() -> tuple[str, str]:
    """Get username and password hash for basic auth.

    Delegates to auth_config for env > config-file priority resolution.
    Returns (username, password_hash).
    """
    from backend.services.auth_config import get_effective_credentials

    return get_effective_credentials()


def create_token(username: str) -> str:
    """Create a JWT token for a user."""
    secret = get_or_create_secret()
    payload = {
        "sub": username,
        "iat": datetime.now(UTC),
        "exp": datetime.now(UTC) + timedelta(hours=TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def verify_token(token: str) -> dict | None:
    """Verify a JWT token. Returns payload dict or None."""
    try:
        secret = get_or_create_secret()
        return jwt.decode(token, secret, algorithms=[ALGORITHM])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def validate_api_key(provided: str) -> bool:
    """Validate an API key using timing-safe comparison.

    Uses get_effective_api_key() so env and config-file keys both work.
    """
    from backend.services.auth_config import get_effective_api_key

    expected = get_effective_api_key()
    if not expected or not provided:
        return False
    return secrets.compare_digest(provided, expected)
