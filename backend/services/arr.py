from __future__ import annotations

import asyncio
import logging

import httpx

from backend.services.config import get_service_config, load_config
from backend.services.registry import KNOWN_SERVICES

logger = logging.getLogger(__name__)

API_TIMEOUT = 15


def _safe_error(exc: Exception) -> str:
    """Return a safe error message that never includes URLs or query params."""
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    if isinstance(exc, httpx.ConnectError):
        return "Connection refused or unreachable"
    if isinstance(exc, httpx.TimeoutException):
        return "Request timed out"
    return type(exc).__name__


SEARCH_TIMEOUT = 30  # External lookups (TMDB/TVDB) can be slow

_http_client: httpx.AsyncClient | None = None
_http_client_lock = asyncio.Lock()


async def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        async with _http_client_lock:
            if _http_client is None or _http_client.is_closed:
                _http_client = httpx.AsyncClient(
                    timeout=API_TIMEOUT,
                    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                )
    return _http_client


async def close_http_client() -> None:
    """Close the shared HTTP client. Call on application shutdown."""
    global _http_client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


async def _arr_get(
    url: str, api_key: str, path: str, params: dict | None = None, *, timeout: int = API_TIMEOUT
) -> dict | list:
    """Make an authenticated GET to an ARR service API."""
    client = await _get_http_client()
    resp = await client.get(
        f"{url}{path}",
        headers={"X-Api-Key": api_key},
        params=params,
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json()


async def _arr_post(url: str, api_key: str, path: str, body: dict | None = None) -> dict:
    """Make an authenticated POST to an ARR service API."""
    client = await _get_http_client()
    resp = await client.post(
        f"{url}{path}",
        headers={"X-Api-Key": api_key},
        json=body or {},
    )
    resp.raise_for_status()
    return resp.json()


async def _arr_delete(url: str, api_key: str, path: str, params: dict | None = None) -> dict | None:
    """Make an authenticated DELETE to an ARR service API."""
    client = await _get_http_client()
    resp = await client.delete(
        f"{url}{path}",
        headers={"X-Api-Key": api_key},
        params=params,
    )
    if resp.status_code == 200:
        return resp.json()
    resp.raise_for_status()
    return None


def _is_configured(url: str, api_key: str) -> bool:
    return bool(url and api_key)


async def get_arr_status(service_name: str) -> dict:
    """Get status for any ARR service (sonarr, radarr)."""
    config = load_config()
    svc = get_service_config(config, service_name)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"configured": False}
    try:
        return await _arr_get(url, api_key, "/api/v3/system/status")
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("%s status error: %s", service_name, exc)
        return {"configured": True, "error": _safe_error(exc)}


async def get_arr_queue(service_name: str) -> dict:
    """Get queue for any ARR service with a queue."""
    config = load_config()
    svc = get_service_config(config, service_name)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"configured": False, "records": []}
    try:
        params = {"pageSize": "100"}
        # Sonarr-specific params
        if service_name == "sonarr":
            params.update(
                {
                    "includeUnknownSeriesItems": "true",
                    "includeSeries": "true",
                    "includeEpisode": "true",
                }
            )
        elif service_name == "radarr":
            params.update(
                {
                    "includeUnknownMovieItems": "true",
                    "includeMovie": "true",
                }
            )
        result = await _arr_get(url, api_key, "/api/v3/queue", params=params)
        return result if isinstance(result, dict) else {"records": result}
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("%s queue error: %s", service_name, exc)
        return {"configured": True, "error": _safe_error(exc), "records": []}


# Backward-compat wrappers
async def get_sonarr_status() -> dict:
    return await get_arr_status("sonarr")


async def get_radarr_status() -> dict:
    return await get_arr_status("radarr")


async def get_sonarr_queue() -> dict:
    return await get_arr_queue("sonarr")


async def get_radarr_queue() -> dict:
    return await get_arr_queue("radarr")


async def delete_queue_item(
    service: str, item_id: int, *, blocklist: bool = False
) -> dict[str, object]:
    """Delete or blocklist a queue item from any ARR service."""
    config = load_config()
    svc = get_service_config(config, service)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")

    if not _is_configured(url, api_key):
        return {"ok": False, "message": f"{service} not configured"}

    try:
        await _arr_delete(
            url,
            api_key,
            f"/api/v3/queue/{item_id}",
            params={
                "removeFromClient": "true",
                "blocklist": str(blocklist).lower(),
            },
        )
        return {"ok": True}
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        return {"ok": False, "message": _safe_error(exc)}


async def get_sabnzbd_stats() -> dict:
    """Get SABnzbd queue stats."""
    config = load_config()
    svc = get_service_config(config, "sabnzbd")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not url or not api_key:
        return {"configured": False}
    try:
        client = await _get_http_client()
        resp = await client.get(
            f"{url}/api",
            params={
                "apikey": api_key,
                "mode": "queue",
                "output": "json",
            },
        )
        resp.raise_for_status()
        data = resp.json().get("queue", {})
        return {
            "configured": True,
            "queue": int(data.get("noofslots_total", 0)),
            "speed": data.get("speed", "0 B/s"),
            "size_left": data.get("sizeleft", "0 B"),
            "status": data.get("status", "Idle"),
        }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("SABnzbd stats error: %s", exc)
        return {"configured": True, "error": _safe_error(exc)}


async def get_qbittorrent_stats() -> dict:
    """Get qBittorrent transfer stats."""
    config = load_config()
    svc = get_service_config(config, "qbittorrent")
    url = svc.get("url", "")
    username = svc.get("username", "")
    password = svc.get("password", "")
    if not url:
        return {"configured": False}
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            login_resp = await client.post(
                f"{url}/api/v2/auth/login",
                data={"username": username, "password": password},
            )
            if login_resp.text != "Ok.":
                return {"configured": True, "error": "Authentication failed"}

            cookies = login_resp.cookies
            info_resp = await client.get(
                f"{url}/api/v2/transfer/info",
                cookies=cookies,
            )
            info_resp.raise_for_status()
            info = info_resp.json()

            dl_resp, seed_resp = await asyncio.gather(
                client.get(
                    f"{url}/api/v2/torrents/info",
                    params={"filter": "downloading"},
                    cookies=cookies,
                ),
                client.get(
                    f"{url}/api/v2/torrents/info",
                    params={"filter": "seeding"},
                    cookies=cookies,
                ),
            )
            downloading = dl_resp.json() if dl_resp.status_code == 200 else []
            seeding = seed_resp.json() if seed_resp.status_code == 200 else []

            # Detect VPN via network interface binding
            vpn_interface = ""
            vpn_active = False
            try:
                prefs_resp = await client.get(
                    f"{url}/api/v2/app/preferences",
                    cookies=cookies,
                )
                if prefs_resp.status_code == 200:
                    prefs = prefs_resp.json()
                    iface = prefs.get("current_interface_name", "")
                    addr = prefs.get("current_interface_address", "")
                    vpn_interface = iface or addr
                    vpn_interfaces = {"tun0", "wg0", "proton0", "protonwire", "nordlynx"}
                    vpn_active = iface.lower() in vpn_interfaces or bool(
                        iface and iface not in ("", "eth0", "br0", "lo")
                    )
            except Exception:
                pass

            return {
                "configured": True,
                "active": len(downloading),
                "downloading": len(downloading),
                "seeding": len(seeding),
                "speed_down": info.get("dl_info_speed", 0),
                "speed_up": info.get("up_info_speed", 0),
                "vpn_active": vpn_active,
                "vpn_interface": vpn_interface,
            }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("qBittorrent stats error: %s", exc)
        return {"configured": True, "error": _safe_error(exc)}


async def get_qbittorrent_torrents(filter_type: str = "seeding") -> dict:
    """Get torrent list from qBittorrent for UI display."""
    config = load_config()
    svc = get_service_config(config, "qbittorrent")
    url = svc.get("url", "")
    username = svc.get("username", "")
    password = svc.get("password", "")
    if not url:
        return {"configured": False, "torrents": []}
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            login_resp = await client.post(
                f"{url}/api/v2/auth/login",
                data={"username": username, "password": password},
            )
            if login_resp.text != "Ok.":
                return {"configured": True, "error": "Auth failed", "torrents": []}
            resp = await client.get(
                f"{url}/api/v2/torrents/info",
                params={"filter": filter_type},
                cookies=login_resp.cookies,
            )
            resp.raise_for_status()
            torrents = [
                {
                    "hash": t["hash"],
                    "name": t.get("name", ""),
                    "size": t.get("size", 0),
                    "state": t.get("state", ""),
                    "progress": t.get("progress", 0),
                    "up_speed": t.get("upspeed", 0),
                    "ratio": t.get("ratio", 0),
                }
                for t in resp.json()
            ]
            return {"configured": True, "torrents": torrents}
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        return {"configured": True, "error": _safe_error(exc), "torrents": []}


async def qbittorrent_torrent_action(action: str, hashes: list[str]) -> dict:
    """Perform an action on qBittorrent torrents (pause/resume/delete)."""
    config = load_config()
    svc = get_service_config(config, "qbittorrent")
    url = svc.get("url", "")
    username = svc.get("username", "")
    password = svc.get("password", "")
    if not url:
        return {"ok": False, "message": "qBittorrent not configured"}

    action_map = {
        "pause": "/api/v2/torrents/pause",
        "resume": "/api/v2/torrents/resume",
        "delete": "/api/v2/torrents/delete",
    }
    if action not in action_map:
        return {"ok": False, "message": f"Unknown action: {action}"}

    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            login_resp = await client.post(
                f"{url}/api/v2/auth/login",
                data={"username": username, "password": password},
            )
            if login_resp.text != "Ok.":
                return {"ok": False, "message": "Authentication failed"}

            data: dict[str, str] = {"hashes": "|".join(hashes)}
            if action == "delete":
                data["deleteFiles"] = "false"

            resp = await client.post(
                f"{url}{action_map[action]}",
                data=data,
                cookies=login_resp.cookies,
            )
            resp.raise_for_status()
            return {"ok": True}
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        return {"ok": False, "message": _safe_error(exc)}


def get_configured_arr_services() -> list[str]:
    """Return list of configured ARR services that have queues."""
    config = load_config()
    result = []
    for name, info in KNOWN_SERVICES.items():
        if info.get("category") != "arr" or not info.get("has_queue"):
            continue
        svc = get_service_config(config, name)
        if svc.get("url") and svc.get("api_key"):
            result.append(name)
    return result


async def get_arr_tasks(service_name: str) -> list[dict]:
    """Get active/queued user-relevant tasks from an ARR service."""
    config = load_config()
    svc = get_service_config(config, service_name)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []

    # Only show tasks the user cares about, skip internal housekeeping
    relevant_tasks = {
        "DownloadedMoviesScan": "Importing movies",
        "DownloadedEpisodesScan": "Importing episodes",
        "ManualImport": "Manual import",
        "MoviesSearch": "Searching for movies",
        "EpisodeSearch": "Searching for episodes",
        "SeasonSearch": "Searching season",
        "SeriesSearch": "Searching series",
        "MissingMoviesSearch": "Searching missing movies",
        "MissingEpisodesSearch": "Searching missing episodes",
    }

    try:
        data = await _arr_get(url, api_key, "/api/v3/command")
        if not isinstance(data, list):
            return []
        tasks = []
        for cmd in data:
            status = cmd.get("status", "")
            if status not in ("queued", "started"):
                continue
            name = cmd.get("name", "")
            if name not in relevant_tasks:
                continue
            tasks.append(
                {
                    "id": cmd.get("id"),
                    "app": service_name,
                    "name": name,
                    "label": relevant_tasks[name],
                    "status": status,
                    "started": cmd.get("started", ""),
                }
            )
        return tasks
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("%s tasks error: %s", service_name, exc)
        return []


async def get_arr_history(service_name: str, limit: int = 30) -> list[dict]:
    """Get recent user-relevant activity from an ARR service."""
    config = load_config()
    svc = get_service_config(config, service_name)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []

    # Only events the user cares about
    relevant_events = {
        "grabbed": "Grabbed",
        "downloadFolderImported": "Imported",
        "downloadImported": "Imported",
        "downloadFailed": "Failed",
        "movieFileDeleted": "Deleted",
        "episodeFileDeleted": "Deleted",
    }

    try:
        params: dict[str, str] = {
            "pageSize": str(limit),
            "sortKey": "date",
            "sortDirection": "descending",
        }
        # Include structured data so we get nice titles instead of raw filenames
        if service_name == "sonarr":
            params["includeSeries"] = "true"
            params["includeEpisode"] = "true"
        elif service_name == "radarr":
            params["includeMovie"] = "true"
        data = await _arr_get(url, api_key, "/api/v3/history", params=params)
        records = data.get("records", []) if isinstance(data, dict) else []
        results = []
        for r in records:
            event = r.get("eventType", "")
            if event not in relevant_events:
                continue

            # Build human-readable title from structured data
            series_title = r.get("series", {}).get("title", "") if r.get("series") else ""
            episode = r.get("episode", {}) if r.get("episode") else {}
            movie_title = r.get("movie", {}).get("title", "") if r.get("movie") else ""

            if series_title and episode:
                s = episode.get("seasonNumber", 0)
                e = episode.get("episodeNumber", 0)
                ep_title = episode.get("title", "")
                display = f"{series_title}, S{s:02d}E{e:02d}"
                if ep_title:
                    display += f", {ep_title}"
            elif movie_title:
                year = r.get("movie", {}).get("year", "")
                display = f"{movie_title} ({year})" if year else movie_title
            else:
                display = r.get("sourceTitle", "Unknown")

            results.append(
                {
                    "id": r.get("id"),
                    "app": service_name,
                    "event": event,
                    "eventLabel": relevant_events[event],
                    "title": display,
                    "date": r.get("date", ""),
                    "quality": r.get("quality", {}).get("quality", {}).get("name", ""),
                }
            )
            if len(results) >= 10:
                break
        return results
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("%s history error: %s", service_name, exc)
        return []


async def trigger_import_scan(service: str, download_id: int | None = None) -> dict[str, object]:
    """Trigger a download import scan on an ARR service.

    Uses RefreshMonitoredDownloads which processes all pending imports without
    requiring a specific path, works reliably across all *arr services.
    """
    config = load_config()
    svc = get_service_config(config, service)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"ok": False, "message": f"{service} not configured"}

    try:
        # RefreshMonitoredDownloads re-checks all tracked downloads and triggers
        # imports for any that are completed. No path parameter needed.
        await _arr_post(url, api_key, "/api/v3/command", {"name": "RefreshMonitoredDownloads"})
        return {"ok": True, "message": f"Import refresh triggered on {service}"}
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        return {"ok": False, "message": _safe_error(exc)}


def _extract_poster(images: list) -> str:
    """Extract poster URL from an ARR images array. Prefers remoteUrl (TMDB CDN)."""
    for img in images or []:
        if img.get("coverType") == "poster":
            remote = img.get("remoteUrl", "")
            if remote:
                return remote
            local = img.get("url", "")
            if local:
                return local
    return ""


async def get_radarr_movies() -> list[dict]:
    """Get all movies from Radarr with normalized fields."""
    config = load_config()
    svc = get_service_config(config, "radarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []
    try:
        data = await _arr_get(url, api_key, "/api/v3/movie")
        if not isinstance(data, list):
            return []
        movies = []
        for m in data:
            radarr_status = m.get("status", "")
            is_released = radarr_status == "released"
            release_date = (
                m.get("digitalRelease") or m.get("physicalRelease") or m.get("inCinemas") or ""
            )
            status = "missing"
            if m.get("hasFile"):
                status = "downloaded"
            elif not m.get("monitored"):
                status = "unmonitored"
            elif not is_released:
                status = "upcoming"
            movies.append(
                {
                    "id": m.get("id"),
                    "title": m.get("title", ""),
                    "sortTitle": m.get("sortTitle", ""),
                    "year": m.get("year"),
                    "status": status,
                    "radarrStatus": radarr_status,
                    "releaseDate": release_date,
                    "inCinemas": m.get("inCinemas", ""),
                    "digitalRelease": m.get("digitalRelease", ""),
                    "physicalRelease": m.get("physicalRelease", ""),
                    "monitored": m.get("monitored", False),
                    "hasFile": m.get("hasFile", False),
                    "sizeOnDisk": m.get("sizeOnDisk", 0),
                    "added": m.get("added", ""),
                    "runtime": m.get("runtime", 0),
                    "genres": m.get("genres", []),
                    "overview": m.get("overview", ""),
                    "imdbId": m.get("imdbId", ""),
                    "poster": _extract_poster(m.get("images", [])),
                    "qualityProfileId": m.get("qualityProfileId"),
                    "certification": m.get("certification", ""),
                    "ratings": m.get("ratings", {}),
                }
            )
        return movies
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Radarr movies error: %s", exc)
        return []


async def get_sonarr_series() -> list[dict]:
    """Get all series from Sonarr with normalized fields."""
    config = load_config()
    svc = get_service_config(config, "sonarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []
    try:
        data = await _arr_get(url, api_key, "/api/v3/series")
        if not isinstance(data, list):
            return []
        series = []
        for s in data:
            # Sum episode counts excluding specials (season 0)
            # episodeCount = aired episodes only (air date has passed)
            # totalEpisodeCount = all episodes including unaired future ones
            seasons = s.get("seasons", [])
            episode_file_count = 0
            aired_episodes = 0
            total_episodes = 0
            season_count = 0
            for season in seasons:
                snum = season.get("seasonNumber", 0)
                if snum == 0:
                    continue  # Skip specials
                season_count += 1
                ss = season.get("statistics", {})
                episode_file_count += ss.get("episodeFileCount", 0)
                aired_episodes += ss.get("episodeCount", 0)
                total_episodes += ss.get("totalEpisodeCount", 0)

            status = "continuing"
            if s.get("status") == "ended":
                status = "ended"
            if not s.get("monitored"):
                status = "unmonitored"

            series.append(
                {
                    "id": s.get("id"),
                    "title": s.get("title", ""),
                    "sortTitle": s.get("sortTitle", ""),
                    "year": s.get("year"),
                    "status": status,
                    "monitored": s.get("monitored", False),
                    "seasonCount": season_count,
                    "episodeCount": aired_episodes,
                    "episodeFileCount": episode_file_count,
                    "totalEpisodeCount": total_episodes,
                    "airedEpisodes": aired_episodes,
                    "missingEpisodes": max(0, aired_episodes - episode_file_count),
                    "percentComplete": round(
                        (episode_file_count / aired_episodes * 100) if aired_episodes > 0 else 100
                    ),
                    "sizeOnDisk": s.get("statistics", {}).get("sizeOnDisk", 0),
                    "added": s.get("added", ""),
                    "nextAiring": s.get("nextAiring", ""),
                    "previousAiring": s.get("previousAiring", ""),
                    "genres": s.get("genres", []),
                    "network": s.get("network", ""),
                    "overview": s.get("overview", ""),
                    "imdbId": s.get("imdbId", ""),
                    "poster": _extract_poster(s.get("images", [])),
                    "ratings": s.get("ratings", {}),
                }
            )
        return series
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Sonarr series error: %s", exc)
        return []


def _extract_image(images: list, cover_type: str) -> str:
    """Extract an image URL by coverType (fanart, banner, etc.)."""
    for img in images or []:
        if img.get("coverType") == cover_type:
            remote = img.get("remoteUrl", "")
            if remote:
                return remote
            local = img.get("url", "")
            if local:
                return local
    return ""


async def get_sonarr_series_detail(series_id: int) -> dict:
    """Get full series detail with seasons and episodes from Sonarr."""
    config = load_config()
    svc = get_service_config(config, "sonarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {}
    try:
        series_data, episodes_data = await asyncio.gather(
            _arr_get(url, api_key, f"/api/v3/series/{series_id}"),
            _arr_get(
                url,
                api_key,
                "/api/v3/episode",
                params={"seriesId": series_id, "includeEpisodeFile": "true"},
            ),
        )
        if not isinstance(series_data, dict) or not series_data.get("id"):
            return {}

        # Group episodes by season. Specials (season 0) are kept so users
        # who care about them can browse and download them, but they're
        # excluded from the show-level totals further down.
        episodes_by_season: dict[int, list[dict]] = {}
        for ep in episodes_data if isinstance(episodes_data, list) else []:
            snum = ep.get("seasonNumber", 0)
            normalized_ep = {
                "id": ep.get("id"),
                "episodeNumber": ep.get("episodeNumber"),
                "seasonNumber": snum,
                "title": ep.get("title", ""),
                "airDate": ep.get("airDate", ""),
                "airDateUtc": ep.get("airDateUtc", ""),
                "overview": ep.get("overview", ""),
                "hasFile": ep.get("hasFile", False),
                "monitored": ep.get("monitored", False),
                "episodeFileId": ep.get("episodeFileId", 0),
            }
            # Include file quality info if available
            ef = ep.get("episodeFile")
            if ep.get("hasFile") and ef:
                q = ef.get("quality", {}).get("quality", {})
                normalized_ep["quality"] = q.get("name", "")
                normalized_ep["size"] = ef.get("size", 0)
            else:
                normalized_ep["quality"] = None
                normalized_ep["size"] = None
            episodes_by_season.setdefault(snum, []).append(normalized_ep)

        # Sort episodes within each season
        for snum in episodes_by_season:
            episodes_by_season[snum].sort(key=lambda e: e.get("episodeNumber", 0))

        # Build season objects from series data. We include season 0
        # (specials) in the list but flag it so the frontend can render it
        # differently (and so we can keep it out of the totals).
        seasons = []
        total_episode_file_count = 0
        total_aired_episodes = 0
        season_count = 0
        for season in series_data.get("seasons", []):
            snum = season.get("seasonNumber", 0)
            is_specials = snum == 0
            ss = season.get("statistics", {})
            efc = ss.get("episodeFileCount", 0)
            aired = ss.get("episodeCount", 0)
            if not is_specials:
                total_episode_file_count += efc
                total_aired_episodes += aired
                season_count += 1
            seasons.append(
                {
                    "seasonNumber": snum,
                    "isSpecials": is_specials,
                    "monitored": season.get("monitored", False),
                    "episodeCount": aired,
                    "episodeFileCount": efc,
                    "totalEpisodeCount": ss.get("totalEpisodeCount", 0),
                    "sizeOnDisk": ss.get("sizeOnDisk", 0),
                    "percentComplete": round((efc / aired * 100) if aired > 0 else 100),
                    "episodes": episodes_by_season.get(snum, []),
                }
            )
        seasons.sort(key=lambda s: s["seasonNumber"])

        status = "continuing"
        if series_data.get("status") == "ended":
            status = "ended"
        if not series_data.get("monitored"):
            status = "unmonitored"

        return {
            "id": series_data.get("id"),
            "title": series_data.get("title", ""),
            "sortTitle": series_data.get("sortTitle", ""),
            "year": series_data.get("year"),
            "status": status,
            "monitored": series_data.get("monitored", False),
            "seasonCount": season_count,
            "episodeFileCount": total_episode_file_count,
            "airedEpisodes": total_aired_episodes,
            "missingEpisodes": max(0, total_aired_episodes - total_episode_file_count),
            "percentComplete": round(
                (total_episode_file_count / total_aired_episodes * 100)
                if total_aired_episodes > 0
                else 100
            ),
            "sizeOnDisk": series_data.get("statistics", {}).get("sizeOnDisk", 0),
            "added": series_data.get("added", ""),
            "genres": series_data.get("genres", []),
            "network": series_data.get("network", ""),
            "overview": series_data.get("overview", ""),
            "imdbId": series_data.get("imdbId", ""),
            "tvdbId": series_data.get("tvdbId"),
            "runtime": series_data.get("runtime", 0),
            "path": series_data.get("path", ""),
            "qualityProfileId": series_data.get("qualityProfileId"),
            "certification": series_data.get("certification", ""),
            "ratings": series_data.get("ratings", {}),
            "poster": _extract_poster(series_data.get("images", [])),
            "fanart": _extract_image(series_data.get("images", []), "fanart"),
            "banner": _extract_image(series_data.get("images", []), "banner"),
            "seasons": seasons,
        }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Sonarr series detail error: %s", exc)
        return {}


async def get_radarr_movie_detail(movie_id: int) -> dict:
    """Get full movie detail from Radarr."""
    config = load_config()
    svc = get_service_config(config, "radarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {}
    try:
        data = await _arr_get(url, api_key, f"/api/v3/movie/{movie_id}")
        if not isinstance(data, dict) or not data.get("id"):
            return {}

        radarr_status = data.get("status", "")
        is_released = radarr_status == "released"
        release_date = (
            data.get("digitalRelease") or data.get("physicalRelease") or data.get("inCinemas") or ""
        )
        status = "missing"
        if data.get("hasFile"):
            status = "downloaded"
        elif not data.get("monitored"):
            status = "unmonitored"
        elif not is_released:
            status = "upcoming"

        movie_file = None
        mf = data.get("movieFile")
        if data.get("hasFile") and mf:
            q = mf.get("quality", {}).get("quality", {})
            movie_file = {
                "quality": q.get("name", ""),
                "size": mf.get("size", 0),
                "dateAdded": mf.get("dateAdded", ""),
                "relativePath": mf.get("relativePath", ""),
            }

        return {
            "id": data.get("id"),
            "title": data.get("title", ""),
            "sortTitle": data.get("sortTitle", ""),
            "year": data.get("year"),
            "status": status,
            "radarrStatus": radarr_status,
            "releaseDate": release_date,
            "inCinemas": data.get("inCinemas", ""),
            "digitalRelease": data.get("digitalRelease", ""),
            "physicalRelease": data.get("physicalRelease", ""),
            "monitored": data.get("monitored", False),
            "hasFile": data.get("hasFile", False),
            "sizeOnDisk": data.get("sizeOnDisk", 0),
            "added": data.get("added", ""),
            "runtime": data.get("runtime", 0),
            "genres": data.get("genres", []),
            "overview": data.get("overview", ""),
            "imdbId": data.get("imdbId", ""),
            "tmdbId": data.get("tmdbId"),
            "certification": data.get("certification", ""),
            "ratings": data.get("ratings", {}),
            "qualityProfileId": data.get("qualityProfileId"),
            "path": data.get("path", ""),
            "studio": data.get("studio", ""),
            "youTubeTrailerId": data.get("youTubeTrailerId", ""),
            "poster": _extract_poster(data.get("images", [])),
            "fanart": _extract_image(data.get("images", []), "fanart"),
            "movieFile": movie_file,
        }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Radarr movie detail error: %s", exc)
        return {}


async def get_arr_library_stats() -> dict:
    """Get total movie/show/etc counts from configured ARR services."""
    config = load_config()
    result: dict[str, dict] = {}
    for name in ("sonarr", "radarr"):
        svc = get_service_config(config, name)
        url, api_key = svc.get("url", ""), svc.get("api_key", "")
        if not _is_configured(url, api_key):
            continue
        try:
            if name == "sonarr":
                data = await _arr_get(url, api_key, "/api/v3/series")
                result["sonarr"] = {
                    "total": len(data) if isinstance(data, list) else 0,
                    "label": "Shows",
                }
            elif name == "radarr":
                data = await _arr_get(url, api_key, "/api/v3/movie")
                result["radarr"] = {
                    "total": len(data) if isinstance(data, list) else 0,
                    "label": "Movies",
                }
        except Exception:
            logger.debug("Failed to get %s library stats", name)
    return result


async def get_quality_profiles(
    service: str,
) -> list[dict]:
    """Get quality profiles from a Sonarr or Radarr instance."""
    config = load_config()
    svc = get_service_config(config, service)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []
    try:
        data = await _arr_get(url, api_key, "/api/v3/qualityprofile")
        if not isinstance(data, list):
            return []
        return [{"id": p.get("id"), "name": p.get("name", "")} for p in data]
    except (
        httpx.ConnectError,
        httpx.TimeoutException,
        httpx.HTTPStatusError,
    ):
        return []


async def search_movies(query: str) -> list[dict]:
    """Search for movies via Radarr's TMDB lookup."""
    config = load_config()
    svc = get_service_config(config, "radarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []
    try:
        data = await _arr_get(
            url, api_key, "/api/v3/movie/lookup", params={"term": query}, timeout=SEARCH_TIMEOUT
        )
        if not isinstance(data, list):
            return []
        results = []
        for m in data[:20]:
            results.append(
                {
                    "tmdbId": m.get("tmdbId"),
                    "imdbId": m.get("imdbId", ""),
                    "title": m.get("title", ""),
                    "year": m.get("year"),
                    "overview": m.get("overview", ""),
                    "runtime": m.get("runtime", 0),
                    "genres": m.get("genres", []),
                    "poster": _extract_poster(m.get("images", [])),
                    "ratings": m.get("ratings", {}),
                    "certification": m.get("certification", ""),
                    "inLibrary": m.get("id", 0) > 0,
                }
            )
        return results
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Movie search error: %s", exc)
        return []


async def add_movie(tmdb_id: int, quality_profile_id: int = 0) -> dict[str, object]:
    """Add a movie to Radarr by TMDB ID."""
    config = load_config()
    svc = get_service_config(config, "radarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"ok": False, "message": "Radarr not configured"}
    try:
        # Get root folder
        root_folders = await _arr_get(url, api_key, "/api/v3/rootfolder")
        if not root_folders:
            return {"ok": False, "message": "No root folder configured in Radarr"}
        root_path = root_folders[0].get("path", "")

        # Get quality profile (use first if not specified)
        if quality_profile_id == 0:
            profiles = await _arr_get(url, api_key, "/api/v3/qualityprofile")
            if profiles:
                quality_profile_id = profiles[0].get("id", 1)

        # Lookup the movie to get full data
        lookup = await _arr_get(
            url,
            api_key,
            "/api/v3/movie/lookup",
            params={"term": f"tmdb:{tmdb_id}"},
            timeout=SEARCH_TIMEOUT,
        )
        if not lookup:
            return {"ok": False, "message": "Movie not found on TMDB"}
        movie_data = lookup[0] if isinstance(lookup, list) else lookup

        # Add the movie
        movie_data["rootFolderPath"] = root_path
        movie_data["qualityProfileId"] = quality_profile_id
        movie_data["monitored"] = True
        movie_data["addOptions"] = {"searchForMovie": True}

        result = await _arr_post(url, api_key, "/api/v3/movie", body=movie_data)
        return {
            "ok": True,
            "message": f"Added: {result.get('title', 'Unknown')}",
            "id": result.get("id"),
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 400:
            try:
                detail = exc.response.json()
                msg = (
                    detail[0].get("errorMessage", _safe_error(exc))
                    if isinstance(detail, list)
                    else str(detail)
                )
            except Exception:
                msg = _safe_error(exc)
            return {"ok": False, "message": msg}
        return {"ok": False, "message": f"HTTP {exc.response.status_code}"}
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return {"ok": False, "message": _safe_error(exc)}


async def search_shows(query: str) -> list[dict]:
    """Search for TV shows via Sonarr's TVDB lookup."""
    config = load_config()
    svc = get_service_config(config, "sonarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return []
    try:
        data = await _arr_get(
            url, api_key, "/api/v3/series/lookup", params={"term": query}, timeout=SEARCH_TIMEOUT
        )
        if not isinstance(data, list):
            return []
        results = []
        for s in data[:20]:
            results.append(
                {
                    "tvdbId": s.get("tvdbId"),
                    "imdbId": s.get("imdbId", ""),
                    "title": s.get("title", ""),
                    "year": s.get("year"),
                    "overview": s.get("overview", ""),
                    "seasonCount": s.get("statistics", {}).get(
                        "seasonCount", len(s.get("seasons", []))
                    ),
                    "network": s.get("network", ""),
                    "genres": s.get("genres", []),
                    "poster": _extract_poster(s.get("images", [])),
                    "ratings": s.get("ratings", {}),
                    "status": s.get("status", ""),
                    "inLibrary": s.get("id", 0) > 0,
                }
            )
        return results
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Show search error: %s", exc)
        return []


async def add_show(tvdb_id: int, quality_profile_id: int = 0) -> dict[str, object]:
    """Add a TV show to Sonarr by TVDB ID."""
    config = load_config()
    svc = get_service_config(config, "sonarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"ok": False, "message": "Sonarr not configured"}
    try:
        # Get root folder
        root_folders = await _arr_get(url, api_key, "/api/v3/rootfolder")
        if not root_folders:
            return {"ok": False, "message": "No root folder configured in Sonarr"}
        root_path = root_folders[0].get("path", "")

        # Get quality profile
        if quality_profile_id == 0:
            profiles = await _arr_get(url, api_key, "/api/v3/qualityprofile")
            if profiles:
                quality_profile_id = profiles[0].get("id", 1)

        # Lookup the show to get full data
        lookup = await _arr_get(
            url,
            api_key,
            "/api/v3/series/lookup",
            params={"term": f"tvdb:{tvdb_id}"},
            timeout=SEARCH_TIMEOUT,
        )
        if not lookup:
            return {"ok": False, "message": "Show not found on TVDB"}
        series_data = lookup[0] if isinstance(lookup, list) else lookup

        # Add the show
        series_data["rootFolderPath"] = root_path
        series_data["qualityProfileId"] = quality_profile_id
        series_data["monitored"] = True
        # "future" only monitors episodes that haven't aired yet, which is
        # almost always what users want when adding an existing show, they
        # don't want Sonarr to immediately attempt to grab the entire back
        # catalogue. Users who do want the back catalogue can flip individual
        # seasons on from the Shows page in Sonarr.
        series_data["addOptions"] = {
            "monitor": "future",
            "searchForMissingEpisodes": False,
            "searchForCutoffUnmetEpisodes": False,
        }

        result = await _arr_post(url, api_key, "/api/v3/series", body=series_data)
        return {
            "ok": True,
            "message": f"Added: {result.get('title', 'Unknown')}",
            "id": result.get("id"),
        }
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 400:
            try:
                detail = exc.response.json()
                msg = (
                    detail[0].get("errorMessage", _safe_error(exc))
                    if isinstance(detail, list)
                    else str(detail)
                )
            except Exception:
                msg = _safe_error(exc)
            return {"ok": False, "message": msg}
        return {"ok": False, "message": f"HTTP {exc.response.status_code}"}
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return {"ok": False, "message": _safe_error(exc)}


async def trigger_search_missing(service: str, series_id: int) -> dict[str, object]:
    """Search for missing episodes of a specific show in Sonarr."""
    config = load_config()
    svc = get_service_config(config, service)
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"ok": False, "message": f"{service} not configured"}
    try:
        await _arr_post(
            url,
            api_key,
            "/api/v3/command",
            {"name": "SeriesSearch", "seriesId": series_id},
        )
        return {"ok": True, "message": "Searching for missing episodes"}
    except (
        httpx.ConnectError,
        httpx.TimeoutException,
        httpx.HTTPStatusError,
    ) as exc:
        return {"ok": False, "message": _safe_error(exc)}


async def trigger_season_search(
    series_id: int,
    season_number: int,
) -> dict[str, object]:
    """Search for all episodes of a specific season in Sonarr."""
    config = load_config()
    svc = get_service_config(config, "sonarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"ok": False, "message": "Sonarr not configured"}
    try:
        await _arr_post(
            url,
            api_key,
            "/api/v3/command",
            {
                "name": "SeasonSearch",
                "seriesId": series_id,
                "seasonNumber": season_number,
            },
        )
        return {
            "ok": True,
            "message": f"Searching season {season_number}",
        }
    except (
        httpx.ConnectError,
        httpx.TimeoutException,
        httpx.HTTPStatusError,
    ) as exc:
        return {"ok": False, "message": _safe_error(exc)}


async def trigger_episode_search(
    episode_ids: list[int],
) -> dict[str, object]:
    """Search for specific episodes in Sonarr."""
    config = load_config()
    svc = get_service_config(config, "sonarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"ok": False, "message": "Sonarr not configured"}
    try:
        await _arr_post(
            url,
            api_key,
            "/api/v3/command",
            {"name": "EpisodeSearch", "episodeIds": episode_ids},
        )
        count = len(episode_ids)
        label = "episode" if count == 1 else "episodes"
        return {
            "ok": True,
            "message": f"Searching {count} {label}",
        }
    except (
        httpx.ConnectError,
        httpx.TimeoutException,
        httpx.HTTPStatusError,
    ) as exc:
        return {"ok": False, "message": _safe_error(exc)}


async def trigger_movie_search(movie_id: int) -> dict[str, object]:
    """Search for a specific movie in Radarr."""
    config = load_config()
    svc = get_service_config(config, "radarr")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not _is_configured(url, api_key):
        return {"ok": False, "message": "Radarr not configured"}
    try:
        await _arr_post(
            url,
            api_key,
            "/api/v3/command",
            {"name": "MoviesSearch", "movieIds": [movie_id]},
        )
        return {"ok": True, "message": "Search started for movie"}
    except (
        httpx.ConnectError,
        httpx.TimeoutException,
        httpx.HTTPStatusError,
    ) as exc:
        return {"ok": False, "message": _safe_error(exc)}
