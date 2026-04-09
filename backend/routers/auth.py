from __future__ import annotations

import secrets
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.services.auth import (
    COOKIE_NAME,
    create_token,
    get_credentials,
    validate_api_key,
    verify_password,
    verify_token,
)
from backend.services.auth_config import (
    get_effective_auth_mode,
    get_effective_proxy_header,
    is_auth_writable,
    set_auth_in_config,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Simple in-memory rate limiter: max 10 attempts per IP per 60 seconds
_login_attempts: dict[str, list[float]] = defaultdict(list)
RATE_LIMIT_MAX = 10
RATE_LIMIT_WINDOW = 60


def _check_rate_limit(ip: str) -> bool:
    """Return True if the request is within rate limits."""
    now = time.monotonic()
    attempts = _login_attempts[ip]
    # Prune old entries
    _login_attempts[ip] = [t for t in attempts if now - t < RATE_LIMIT_WINDOW]
    if len(_login_attempts[ip]) >= RATE_LIMIT_MAX:
        return False
    _login_attempts[ip].append(now)
    return True


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, request: Request) -> JSONResponse:
    if get_effective_auth_mode() != "basic":
        return JSONResponse(
            status_code=400,
            content={"detail": "Login not available in this auth mode"},
        )

    # Rate limiting, use direct client IP as primary key to prevent spoofing
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many login attempts. Try again in a minute."},
        )

    username, password_hash = get_credentials()
    if not username:
        return JSONResponse(
            status_code=500,
            content={
                "detail": "No credentials configured, run setup or configure auth in Settings"
            },
        )

    if body.username != username or not verify_password(body.password, password_hash):
        return JSONResponse(
            status_code=401,
            content={"detail": "Invalid username or password"},
        )

    token = create_token(body.username)
    # Respect X-Forwarded-Proto from reverse proxy for secure cookie flag
    proto = request.headers.get("X-Forwarded-Proto", request.url.scheme)
    is_secure = proto == "https"

    response = JSONResponse(content={"ok": True, "user": body.username})
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=86400,
        secure=is_secure,
    )
    return response


@router.post("/logout")
async def logout() -> JSONResponse:
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(key=COOKIE_NAME, path="/")
    return response


@router.get("/status")
async def auth_status(request: Request) -> dict:
    mode = get_effective_auth_mode()
    authenticated = False
    user = None

    if mode == "none":
        authenticated = True
    elif mode == "basic":
        token = request.cookies.get(COOKIE_NAME)
        if token:
            payload = verify_token(token)
            if payload:
                authenticated = True
                user = payload.get("sub")
    elif mode == "proxy":
        authenticated = True
        user = request.headers.get(get_effective_proxy_header())
    elif mode == "apikey":
        api_key = request.headers.get("X-Api-Key", "")
        authenticated = validate_api_key(api_key)

    # Surface non-secret auth metadata so the Settings page can render the
    # current username / proxy header without needing to read panelarr.json.
    # The /api/config endpoint strips the entire `auth` block on purpose.
    stored_username, stored_hash = get_credentials()
    proxy_header = get_effective_proxy_header()

    return {
        "mode": mode,
        "authenticated": authenticated,
        "user": user,
        "writable": is_auth_writable(),
        "username": stored_username,
        "has_password": bool(stored_hash),
        "proxy_header": proxy_header,
    }


_VALID_MODES = {"none", "basic", "proxy", "apikey"}


class AuthConfigBody(BaseModel):
    mode: str
    username: str | None = None
    password: str | None = None
    proxy_header: str | None = None


@router.put("/config")
async def update_auth_config(body: AuthConfigBody) -> dict:
    """Update the persistent auth configuration after the initial setup.

    Mirrors the wizard's `POST /api/setup/auth` shape but is callable any
    time.
    """
    if body.mode not in _VALID_MODES:
        raise HTTPException(status_code=422, detail=f"Invalid mode: {body.mode!r}")

    if body.mode == "basic":
        username, current_hash = get_credentials()
        if not body.username:
            raise HTTPException(status_code=422, detail="username is required for basic auth mode")
        # Allow updating username without rotating the password by leaving
        # it blank, preserves the existing hash.
        if body.password:
            set_auth_in_config(mode="basic", username=body.username, password=body.password)
        elif current_hash and body.username == username:
            set_auth_in_config(mode="basic")  # mode-only refresh, keep existing creds
        elif current_hash:
            # Username changed but no new password supplied, keep the same hash
            # but write the new username explicitly.
            set_auth_in_config(mode="basic", username=body.username)
        else:
            raise HTTPException(
                status_code=422,
                detail="password is required when no credentials exist yet",
            )
        return {"ok": True}

    if body.mode == "proxy":
        header = body.proxy_header or "Remote-User"
        set_auth_in_config(mode="proxy", proxy_header=header)
        return {"ok": True}

    if body.mode == "apikey":
        # Mode switch only, does not regenerate the key. Use
        # POST /api/auth/apikey/regenerate to mint a fresh one.
        set_auth_in_config(mode="apikey")
        return {"ok": True}

    # mode == "none"
    set_auth_in_config(mode="none")
    return {"ok": True}


@router.post("/apikey/regenerate")
async def regenerate_apikey() -> dict:
    """Generate a fresh API key and persist it. Returned only once."""
    new_key = secrets.token_urlsafe(32)
    set_auth_in_config(api_key=new_key)
    return {"ok": True, "api_key": new_key}
