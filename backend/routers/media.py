from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

from backend.services.arr import (
    add_movie,
    add_show,
    get_quality_profiles,
    get_radarr_movie_detail,
    get_radarr_movies,
    get_sonarr_series,
    get_sonarr_series_detail,
    search_movies,
    search_shows,
    trigger_episode_search,
    trigger_movie_search,
    trigger_search_missing,
    trigger_season_search,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/media", tags=["media"])

POSTER_CACHE_DIR = Path("/config/poster_cache")
POSTER_TIMEOUT = 10


def _evict_poster_cache(max_bytes: int = 500 * 1024 * 1024) -> None:
    """Evict oldest cached posters when total size exceeds max_bytes."""
    if not POSTER_CACHE_DIR.is_dir():
        return
    files = sorted(POSTER_CACHE_DIR.iterdir(), key=lambda p: p.stat().st_mtime)
    total = sum(f.stat().st_size for f in files)
    while total > max_bytes and files:
        oldest = files.pop(0)
        total -= oldest.stat().st_size
        oldest.unlink(missing_ok=True)


_poster_client: httpx.AsyncClient | None = None
_poster_client_lock = asyncio.Lock()


async def _get_poster_client() -> httpx.AsyncClient:
    global _poster_client
    if _poster_client is None or _poster_client.is_closed:
        async with _poster_client_lock:
            if _poster_client is None or _poster_client.is_closed:
                _poster_client = httpx.AsyncClient(
                    timeout=POSTER_TIMEOUT,
                    limits=httpx.Limits(max_connections=20),
                )
    return _poster_client


def _proxy_images(item: dict) -> dict:
    """Replace poster and fanart URLs with proxy URLs."""
    for key in ("poster", "fanart", "banner"):
        if item.get(key):
            item[key] = f"/api/media/poster?url={item[key]}"
    return item


@router.get("/movies")
async def list_movies() -> list[dict]:
    movies = await get_radarr_movies()
    for m in movies:
        if m.get("poster"):
            m["poster"] = f"/api/media/poster?url={m['poster']}"
    return movies


@router.get("/shows")
async def list_shows() -> list[dict]:
    shows = await get_sonarr_series()
    for s in shows:
        if s.get("poster"):
            s["poster"] = f"/api/media/poster?url={s['poster']}"
    return shows


@router.get("/movies/quality-profiles")
async def movie_quality_profiles() -> list[dict]:
    return await get_quality_profiles("radarr")


@router.get("/shows/quality-profiles")
async def show_quality_profiles() -> list[dict]:
    return await get_quality_profiles("sonarr")


@router.get("/movies/search")
async def movie_search(q: str) -> list[dict]:
    if len(q) < 2 or len(q) > 200:
        return []
    results = await search_movies(q)
    for m in results:
        if m.get("poster"):
            m["poster"] = f"/api/media/poster?url={m['poster']}"
    return results


@router.post("/movies/add")
async def movie_add(body: dict) -> dict:
    tmdb_id = body.get("tmdbId")
    if not tmdb_id:
        return {"ok": False, "message": "tmdbId required"}
    quality = body.get("qualityProfileId", 0)
    return await add_movie(int(tmdb_id), int(quality))


@router.get("/shows/search")
async def show_search(q: str) -> list[dict]:
    if len(q) < 2 or len(q) > 200:
        return []
    results = await search_shows(q)
    for s in results:
        if s.get("poster"):
            s["poster"] = f"/api/media/poster?url={s['poster']}"
    return results


@router.post("/shows/add")
async def show_add(body: dict) -> dict:
    tvdb_id = body.get("tvdbId")
    if not tvdb_id:
        return {"ok": False, "message": "tvdbId required"}
    quality = body.get("qualityProfileId", 0)
    return await add_show(int(tvdb_id), int(quality))


@router.get("/shows/{show_id}")
async def show_detail(show_id: int) -> dict:
    detail = await get_sonarr_series_detail(show_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Not found")
    return _proxy_images(detail)


@router.get("/movies/{movie_id}")
async def movie_detail(movie_id: int) -> dict:
    detail = await get_radarr_movie_detail(movie_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Not found")
    return _proxy_images(detail)


@router.post("/movies/{movie_id}/search")
async def search_movie(movie_id: int) -> dict:
    """Trigger a Radarr search for a specific movie."""
    return await trigger_movie_search(movie_id)


@router.post("/shows/{show_id}/search-missing")
async def search_missing_episodes(show_id: int) -> dict:
    """Search for all missing episodes of a show."""
    return await trigger_search_missing("sonarr", show_id)


@router.post("/shows/{show_id}/search-season/{season_number}")
async def search_season(show_id: int, season_number: int) -> dict:
    """Search for all episodes in a specific season."""
    return await trigger_season_search(show_id, season_number)


@router.post("/shows/search-episodes")
async def search_episodes(body: dict) -> dict:
    """Search for specific episodes by ID."""
    episode_ids = body.get("episodeIds", [])
    if not episode_ids or not isinstance(episode_ids, list):
        return {"ok": False, "message": "episodeIds required"}
    return await trigger_episode_search(episode_ids)


ALLOWED_POSTER_HOSTS = {
    "image.tmdb.org",
    "artworks.thetvdb.com",
    "assets.fanart.tv",
    "www.thetvdb.com",
    "thetvdb.com",
}


@router.get("/poster")
async def poster_proxy(url: str) -> Response:
    """Proxy and cache poster images. Only allows known image CDN hosts."""
    if not url:
        return Response(status_code=404)

    # Must be HTTPS from an allowed host
    if not url.startswith("https://"):
        return Response(status_code=403)

    parsed = urlparse(url)
    if parsed.hostname not in ALLOWED_POSTER_HOSTS:
        return Response(status_code=403)

    # Generate cache key from URL
    url_hash = hashlib.md5(url.encode()).hexdigest()
    cache_path = POSTER_CACHE_DIR / f"{url_hash}.jpg"

    # Serve from cache if exists
    if cache_path.is_file():
        return FileResponse(
            cache_path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=604800"},  # 7 days
        )

    # Fetch from remote
    try:
        client = await _get_poster_client()
        resp = await client.get(url)
        if resp.status_code != 200:
            return Response(status_code=404)

        # Validate content-type is actually an image
        content_type = resp.headers.get("content-type", "")
        if not content_type.startswith("image/"):
            return Response(status_code=415)

        # Reject oversized responses (max 10 MB)
        if len(resp.content) > 10 * 1024 * 1024:
            return Response(status_code=413)

        # Enforce poster cache size (max 500 MB, evict oldest)
        POSTER_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _evict_poster_cache(max_bytes=500 * 1024 * 1024)
        cache_path.write_bytes(resp.content)

        return Response(
            content=resp.content,
            media_type=content_type,
            headers={"Cache-Control": "public, max-age=604800"},
        )
    except Exception:
        return Response(status_code=404)
