from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any, TypedDict

import httpx

from backend.services.arr import _arr_get, _is_configured
from backend.services.config import get_service_config, load_config

logger = logging.getLogger(__name__)


class CalendarItem(TypedDict, total=False):
    kind: str  # "episode" | "movie"
    source: str  # "sonarr" | "radarr"
    id: int
    title: str
    subtitle: str
    air_date_utc: str  # ISO-8601 UTC
    has_file: bool
    monitored: bool
    poster_url: str | None
    deep_link: str | None
    # Episode-only
    season: int | None
    episode: int | None
    episode_code: str | None
    series_id: int | None
    # Movie-only
    release_type: str | None  # "cinema" | "digital" | "physical"
    movie_id: int | None


def _pick_poster(images: list[dict] | None) -> str | None:
    """Pick a poster URL from an ARR images array, wrapped in the proxy.

    The frontend CSP blocks external image hosts, so all artwork must be
    routed through ``/api/media/poster?url=...`` (which only allows known
    image CDNs and caches them on disk).
    """
    if not images:
        return None
    raw: str | None = None
    for img in images:
        if (img.get("coverType") or "").lower() == "poster":
            raw = img.get("remoteUrl") or img.get("url")
            break
    if raw is None:
        first = images[0]
        raw = first.get("remoteUrl") or first.get("url")
    if not raw:
        return None
    return f"/api/media/poster?url={raw}"


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # ARR APIs return Z-suffixed ISO strings
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _to_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _episode_code(season: int | None, episode: int | None) -> str | None:
    if season is None or episode is None:
        return None
    return f"S{season:02d}E{episode:02d}"


def _soonest_release(movie: dict, start: datetime, end: datetime) -> tuple[datetime, str] | None:
    """Pick the soonest release date for a Radarr movie within [start, end]."""
    candidates: list[tuple[datetime, str]] = []
    for field, label in (
        ("inCinemas", "cinema"),
        ("digitalRelease", "digital"),
        ("physicalRelease", "physical"),
    ):
        dt = _parse_iso(movie.get(field))
        if dt is not None and start <= dt <= end:
            candidates.append((dt, label))
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0])
    return candidates[0]


async def _fetch_sonarr_calendar(
    start: datetime,
    end: datetime,
    include_unmonitored: bool,
    *,
    include_specials: bool = False,
) -> list[CalendarItem]:
    config = load_config()
    svc = get_service_config(config, "sonarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []

    params = {
        "start": _to_utc_iso(start),
        "end": _to_utc_iso(end),
        "unmonitored": "true" if include_unmonitored else "false",
        "includeSeries": "true",
    }
    raw = await _arr_get(url, api_key, "/api/v3/calendar", params=params)
    if not isinstance(raw, list):
        return []

    items: list[CalendarItem] = []
    for ep in raw:
        # Specials live on season 0 in Sonarr; skip them by default to match
        # the show-detail view (which also hides season 0).
        if not include_specials and ep.get("seasonNumber") == 0:
            continue
        air = _parse_iso(ep.get("airDateUtc"))
        if air is None:
            continue
        series = ep.get("series") or {}
        series_title = series.get("title") or ""
        season_num = ep.get("seasonNumber")
        episode_num = ep.get("episodeNumber")
        code = _episode_code(season_num, episode_num)
        ep_title = ep.get("title") or ""
        subtitle = " · ".join(filter(None, [code, ep_title]))

        items.append(
            CalendarItem(
                kind="episode",
                source="sonarr",
                id=int(ep.get("id") or 0),
                title=series_title,
                subtitle=subtitle,
                air_date_utc=_to_utc_iso(air),
                has_file=bool(ep.get("hasFile")),
                monitored=bool(ep.get("monitored", True)),
                poster_url=_pick_poster(series.get("images")),
                deep_link=f"/shows/{series.get('id')}" if series.get("id") else None,
                season=season_num,
                episode=episode_num,
                episode_code=code,
                series_id=series.get("id"),
            )
        )
    return items


async def _fetch_radarr_calendar(
    start: datetime, end: datetime, include_unmonitored: bool
) -> list[CalendarItem]:
    config = load_config()
    svc = get_service_config(config, "radarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []

    params = {
        "start": _to_utc_iso(start),
        "end": _to_utc_iso(end),
        "unmonitored": "true" if include_unmonitored else "false",
    }
    raw = await _arr_get(url, api_key, "/api/v3/calendar", params=params)
    if not isinstance(raw, list):
        return []

    items: list[CalendarItem] = []
    for movie in raw:
        chosen = _soonest_release(movie, start, end)
        if chosen is None:
            continue
        when, release_type = chosen
        title = movie.get("title") or ""
        year = movie.get("year")
        subtitle_bits: list[str] = []
        if year:
            subtitle_bits.append(str(year))
        subtitle_bits.append(release_type.title())
        items.append(
            CalendarItem(
                kind="movie",
                source="radarr",
                id=int(movie.get("id") or 0),
                title=title,
                subtitle=" · ".join(subtitle_bits),
                air_date_utc=_to_utc_iso(when),
                has_file=bool(movie.get("hasFile")),
                monitored=bool(movie.get("monitored", True)),
                poster_url=_pick_poster(movie.get("images")),
                deep_link=f"/movies/{movie.get('id')}" if movie.get("id") else None,
                release_type=release_type,
                movie_id=movie.get("id"),
            )
        )
    return items


async def get_calendar(
    start: datetime,
    end: datetime,
    *,
    kind: str = "all",
    include_unmonitored: bool = True,
    include_specials: bool = False,
    include_downloaded: bool = True,
) -> dict[str, Any]:
    """Fetch a unified calendar from configured ARR services.

    Returns:
        {
            "items": [CalendarItem, ...],   # sorted by air_date_utc
            "counts": {"episodes": N, "movies": N, "total": N},
            "errors": [{"source": "sonarr", "message": "..."}, ...],
        }
    """
    tasks: list[asyncio.Future] = []
    sources: list[str] = []
    if kind in ("all", "episode", "episodes"):
        tasks.append(
            asyncio.create_task(
                _fetch_sonarr_calendar(
                    start,
                    end,
                    include_unmonitored,
                    include_specials=include_specials,
                )
            )
        )
        sources.append("sonarr")
    if kind in ("all", "movie", "movies"):
        tasks.append(asyncio.create_task(_fetch_radarr_calendar(start, end, include_unmonitored)))
        sources.append("radarr")

    results = await asyncio.gather(*tasks, return_exceptions=True)

    items: list[CalendarItem] = []
    errors: list[dict[str, str]] = []
    for source, result in zip(sources, results, strict=True):
        if isinstance(result, BaseException):
            msg = str(result) if not isinstance(result, httpx.HTTPError) else repr(result)
            logger.warning("calendar fetch failed for %s: %s", source, msg)
            errors.append({"source": source, "message": msg})
            continue
        items.extend(result)

    if not include_downloaded:
        items = [i for i in items if not i.get("has_file")]

    items.sort(key=lambda i: i.get("air_date_utc") or "")

    episodes = sum(1 for i in items if i.get("kind") == "episode")
    movies = sum(1 for i in items if i.get("kind") == "movie")

    return {
        "items": items,
        "counts": {
            "episodes": episodes,
            "movies": movies,
            "total": episodes + movies,
        },
        "errors": errors,
    }
