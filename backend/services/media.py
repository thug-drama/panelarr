from __future__ import annotations

import asyncio
import logging

import httpx

from backend.services.config import get_service_config, load_config

logger = logging.getLogger(__name__)

API_TIMEOUT = 10


def _parse_plex_session(metadata: dict) -> dict:
    """Parse a Plex session into a rich stream info dict."""
    user = metadata.get("User", {}).get("title", "Unknown")
    title = metadata.get("title", "Unknown")
    grandparent = metadata.get("grandparentTitle", "")
    parent_index = metadata.get("parentIndex")
    index = metadata.get("index")
    media_type = metadata.get("type", "")

    # Build display title
    if media_type == "episode" and grandparent:
        ep_label = f"S{parent_index:02d}E{index:02d}" if parent_index and index else ""
        display = f"{grandparent}, {ep_label} {title}".strip()
    elif media_type == "movie":
        year = metadata.get("year", "")
        display = f"{title} ({year})" if year else title
    elif media_type == "track":
        artist = metadata.get("grandparentTitle", "")
        display = f"{artist}, {title}" if artist else title
    else:
        display = title

    # Player info
    player = metadata.get("Player", {})
    state = player.get("state", "playing")
    device = player.get("device", "")
    platform = player.get("platform", "")
    product = player.get("product", "")

    # Transcode or direct
    session = metadata.get("TranscodeSession", {})
    is_transcode = bool(session)
    video_decision = session.get("videoDecision", "direct play") if session else "direct play"

    # Progress
    duration = metadata.get("duration", 0)
    view_offset = metadata.get("viewOffset", 0)
    progress_pct = round((view_offset / duration) * 100) if duration > 0 else 0

    # Poster/thumb URL (relative to Plex server)
    thumb = metadata.get("thumb", "")
    art = metadata.get("art", "")
    grandparent_thumb = metadata.get("grandparentThumb", "")

    return {
        "user": user,
        "title": display,
        "type": media_type,
        "state": state,
        "device": device or platform,
        "product": product,
        "transcode": is_transcode,
        "video_decision": video_decision,
        "progress_pct": progress_pct,
        "duration_ms": duration,
        "view_offset_ms": view_offset,
        "thumb": grandparent_thumb or thumb,
        "art": art,
        "year": metadata.get("year"),
        "season": parent_index,
        "episode": index,
        "show_title": grandparent if media_type == "episode" else None,
        "episode_title": title if media_type == "episode" else None,
        "address": player.get("address", ""),
    }


async def get_plex_stats() -> dict:
    """Get Plex active streams with details, library count, and library totals."""
    config = load_config()
    svc = get_service_config(config, "plex")
    url, token = svc.get("url", ""), svc.get("token", "")
    if not url or not token:
        return {"configured": False}
    try:
        headers = {
            "X-Plex-Token": token,
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            sessions_resp = await client.get(f"{url}/status/sessions", headers=headers)
            sessions_resp.raise_for_status()
            sessions_data = sessions_resp.json()
            media_container = sessions_data.get("MediaContainer", {})
            active_streams = int(media_container.get("size", 0))

            streams = []
            for metadata in media_container.get("Metadata", []):
                stream = _parse_plex_session(metadata)
                # Use proxy URL to avoid exposing Plex token to the browser
                if stream["thumb"]:
                    encoded_path = stream["thumb"]
                    stream["thumb_url"] = f"/api/system/plex/thumb?path={encoded_path}"
                else:
                    stream["thumb_url"] = None
                streams.append(stream)

            lib_resp = await client.get(f"{url}/library/sections", headers=headers)
            lib_resp.raise_for_status()
            lib_data = lib_resp.json()
            lib_container = lib_data.get("MediaContainer", {})
            sections = lib_container.get("Directory", [])
            libraries = len(sections)

            # Count total movies and shows, fetch all sections in parallel
            async def _fetch_section_count(section: dict) -> tuple[str, int]:
                section_type = section.get("type", "")
                section_key = section.get("key", "")
                try:
                    count_resp = await client.get(
                        f"{url}/library/sections/{section_key}/all",
                        headers=headers,
                        params={"X-Plex-Container-Start": "0", "X-Plex-Container-Size": "0"},
                    )
                    if count_resp.status_code == 200:
                        count_data = count_resp.json()
                        total = int(count_data.get("MediaContainer", {}).get("totalSize", 0))
                        return section_type, total
                except Exception:
                    pass
                return section_type, 0

            section_counts = await asyncio.gather(*[_fetch_section_count(s) for s in sections])
            total_movies = sum(t for stype, t in section_counts if stype == "movie")
            total_shows = sum(t for stype, t in section_counts if stype == "show")

            return {
                "configured": True,
                "active_streams": active_streams,
                "streams": streams,
                "libraries": libraries,
                "total_movies": total_movies,
                "total_shows": total_shows,
                "server_url": url,
            }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Plex stats error: %s", exc)
        return {"configured": True, "error": str(exc)}
    except Exception as exc:
        logger.warning("Plex stats unexpected error: %s", exc)
        return {"configured": True, "error": str(exc)}


async def get_jellyfin_stats() -> dict:
    """Get Jellyfin active streams and library count."""
    config = load_config()
    svc = get_service_config(config, "jellyfin")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not url or not api_key:
        return {"configured": False}
    try:
        auth_header = {"Authorization": f'MediaBrowser Token="{api_key}"'}
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            sessions_resp = await client.get(
                f"{url}/Sessions",
                headers=auth_header,
            )
            sessions_resp.raise_for_status()
            sessions = sessions_resp.json()
            active_streams = sum(1 for s in sessions if s.get("NowPlayingItem") is not None)

            lib_resp = await client.get(
                f"{url}/Library/VirtualFolders",
                headers=auth_header,
            )
            lib_resp.raise_for_status()
            libraries = len(lib_resp.json())

            return {
                "configured": True,
                "active_streams": active_streams,
                "libraries": libraries,
            }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Jellyfin stats error: %s", exc)
        return {"configured": True, "error": str(exc)}
    except Exception as exc:
        logger.warning("Jellyfin stats unexpected error: %s", exc)
        return {"configured": True, "error": str(exc)}


async def get_emby_stats() -> dict:
    """Get Emby active streams and library count."""
    config = load_config()
    svc = get_service_config(config, "emby")
    url, api_key = svc.get("url", ""), svc.get("api_key", "")
    if not url or not api_key:
        return {"configured": False}
    try:
        auth_header = {"Authorization": f'MediaBrowser Token="{api_key}"'}
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            sessions_resp = await client.get(
                f"{url}/Sessions",
                headers=auth_header,
            )
            sessions_resp.raise_for_status()
            sessions = sessions_resp.json()
            active_streams = sum(1 for s in sessions if s.get("NowPlayingItem") is not None)

            lib_resp = await client.get(
                f"{url}/Library/VirtualFolders",
                headers=auth_header,
            )
            lib_resp.raise_for_status()
            libraries = len(lib_resp.json())

            return {
                "configured": True,
                "active_streams": active_streams,
                "libraries": libraries,
            }
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        logger.warning("Emby stats error: %s", exc)
        return {"configured": True, "error": str(exc)}
    except Exception as exc:
        logger.warning("Emby stats unexpected error: %s", exc)
        return {"configured": True, "error": str(exc)}
