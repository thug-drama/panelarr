from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.routers import (
    arr,
    auth,
    calendar,
    config,
    containers,
    downloads,
    logs,
    media,
    notifications,
    setup,
    system,
)
from backend.services.arr import close_http_client
from backend.services.auth import COOKIE_NAME, validate_api_key, verify_token
from backend.services.auth_config import get_effective_auth_mode, is_setup_complete

_log = logging.getLogger("panelarr.startup")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan: warn about missing auth on startup, close
    shared HTTP clients on shutdown."""
    try:
        if get_effective_auth_mode() == "none":
            _log.warning(
                "Panelarr is running without authentication. "
                "Set an auth mode under Settings → Authentication for security."
            )
        yield
    finally:
        await close_http_client()


app = FastAPI(
    title="Panelarr",
    version="0.1.0-alpha",
    description="Self-hosted control center for Docker-based media server stacks",
    lifespan=lifespan,
)

_allowed_origins = os.getenv("ALLOWED_ORIGINS", "").split(",")
_allowed_origins = [o.strip() for o in _allowed_origins if o.strip()]

# allow_credentials=True is incompatible with allow_origins=["*"] per
# the fetch spec. When no origins are configured, use permissive CORS
# without credentials. When explicit origins are set, enable credentials.
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins or ["*"],
    allow_credentials=bool(_allowed_origins),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["X-Api-Key", "Content-Type", "X-Confirm-Reset"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Enforce authentication based on AUTH_MODE."""
    mode = get_effective_auth_mode()
    path = request.url.path

    # Setup status is always public, the SPA hits it on every page load
    # to decide whether to redirect to /setup or to the dashboard, so it
    # cannot be auth-gated even after the wizard has finished.
    if path == "/api/setup/status":
        return await call_next(request)

    # Setup endpoints are open while the wizard hasn't finished, except
    # /reset which requires auth even in mode=none (it's destructive).
    if path.startswith("/api/setup/") and path != "/api/setup/reset" and not is_setup_complete():
        return await call_next(request)

    # Mode none, no auth
    if mode == "none":
        return await call_next(request)

    # Only login, logout, and status are public auth endpoints.
    # Write endpoints (PUT /api/auth/config, POST /api/auth/apikey/regenerate)
    # must go through mode-specific auth checks below.
    if path in ("/api/auth/login", "/api/auth/logout", "/api/auth/status"):
        return await call_next(request)

    # Static files (SPA) always accessible, frontend handles redirect to /login
    if not path.startswith("/api/") and not path.startswith("/ws/"):
        return await call_next(request)

    # API key check, works alongside any mode when configured
    api_key = request.headers.get("X-Api-Key", "")
    if api_key and validate_api_key(api_key):
        return await call_next(request)

    # Mode-specific checks
    if mode == "basic":
        token = request.cookies.get(COOKIE_NAME)
        if token and verify_token(token):
            return await call_next(request)
        return JSONResponse(
            status_code=401,
            content={"detail": "Authentication required"},
        )

    if mode == "proxy":
        # Proxy handles auth, we just pass through
        return await call_next(request)

    if mode == "apikey":
        # No valid API key was found above
        return JSONResponse(
            status_code=401,
            content={"detail": "Valid API key required"},
        )

    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Add security response headers."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    csp = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'"
    )
    response.headers["Content-Security-Policy"] = csp
    return response


app.include_router(setup.router)
app.include_router(auth.router)
app.include_router(containers.router)
app.include_router(arr.router)
app.include_router(system.router)
app.include_router(logs.router)
app.include_router(config.router)
app.include_router(downloads.router)
app.include_router(media.router)
app.include_router(notifications.router)
app.include_router(calendar.router)

# Serve built frontend assets in production
static_dir = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if static_dir.is_dir():
    from fastapi.responses import FileResponse

    # Mount static assets (JS, CSS, fonts, images)
    app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets")

    # Serve static files that exist (favicon, logos, etc.)
    @app.get("/{path:path}")
    async def spa_fallback(path: str) -> FileResponse:
        """Serve static files or fall back to index.html for SPA routing."""
        file_path = (static_dir / path).resolve()
        # Prevent path traversal, file must be within static_dir
        if not str(file_path).startswith(str(static_dir.resolve())):
            return FileResponse(static_dir / "index.html")
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(static_dir / "index.html")
