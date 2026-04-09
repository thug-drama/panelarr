from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter

from backend.services.arr import (
    delete_queue_item,
    get_arr_history,
    get_arr_library_stats,
    get_arr_queue,
    get_arr_tasks,
    get_configured_arr_services,
    get_qbittorrent_stats,
    get_sabnzbd_stats,
    trigger_import_scan,
)
from backend.services.config import load_config

router = APIRouter(prefix="/api/downloads", tags=["downloads"])


def _normalize_queue_item(item: dict, source: str) -> dict:
    """Normalize a Sonarr/Radarr queue item into a unified shape."""
    title = item.get("title", "Unknown")
    if source == "sonarr":
        series = item.get("series", {})
        episode = item.get("episode", {})
        if series and episode:
            ep_title = episode.get("title", "")
            s = episode.get("seasonNumber", 0)
            e = episode.get("episodeNumber", 0)
            title = f"{series.get('title', title)} - S{s:02d}E{e:02d}"
            if ep_title:
                title += f" - {ep_title}"
    elif source == "radarr":
        movie = item.get("movie", {})
        if movie:
            title = movie.get("title", title)
            year = movie.get("year")
            if year:
                title += f" ({year})"

    size = item.get("size", 0)
    sizeleft = item.get("sizeleft", 0)
    pct = round((1 - sizeleft / size) * 100, 1) if size > 0 else 0

    status_messages = item.get("statusMessages", [])
    tracked_status = item.get("trackedDownloadStatus", "")
    has_warning = tracked_status == "warning" or bool(status_messages)
    warning_text = ""
    warning_type = ""
    if status_messages:
        # Collect all warning messages
        texts = []
        for msg in status_messages:
            msg_title = msg.get("title", "")
            if msg_title:
                texts.append(msg_title)
            for m in msg.get("messages", []):
                if m and m != msg_title:
                    texts.append(m)
        warning_text = "; ".join(texts) if texts else tracked_status
        warning_type = tracked_status
    elif has_warning and tracked_status:
        warning_text = tracked_status
        warning_type = tracked_status

    # Include media identifiers for matching on detail pages
    series_id = None
    episode_id = None
    movie_id = None
    if source == "sonarr":
        series_id = item.get("seriesId") or item.get(
            "series",
            {},
        ).get("id")
        episode_id = item.get("episodeId") or item.get(
            "episode",
            {},
        ).get("id")
    elif source == "radarr":
        movie_id = item.get("movieId") or item.get(
            "movie",
            {},
        ).get("id")

    return {
        "id": item.get("id"),
        "app": source,
        "title": title,
        "seriesId": series_id,
        "episodeId": episode_id,
        "movieId": movie_id,
        "status": item.get("trackedDownloadState", item.get("status", "unknown")),
        "pct": pct,
        "size": size,
        "sizeleft": sizeleft,
        "time_left": item.get("timeleft", ""),
        "added": item.get("added", ""),
        "protocol": item.get("protocol", ""),
        "indexer": item.get("indexer", ""),
        "warning": has_warning,
        "warning_text": warning_text,
        "warning_type": warning_type,
        "download_client": item.get("downloadClient", ""),
    }


@router.get("/queue")
async def get_download_queue() -> list[dict]:
    arr_services = get_configured_arr_services()
    items: list[dict] = []
    queue_results = await asyncio.gather(*[get_arr_queue(svc) for svc in arr_services])
    for svc_name, data in zip(arr_services, queue_results):
        for record in data.get("records", []):
            items.append(_normalize_queue_item(record, svc_name))

    items.sort(key=lambda x: (x["status"] != "downloading", x["pct"]))
    return items


@router.get("/stats")
async def get_download_stats() -> dict:
    arr_services = get_configured_arr_services()
    sab, qbit, *queue_results = await asyncio.gather(
        get_sabnzbd_stats(),
        get_qbittorrent_stats(),
        *[get_arr_queue(svc) for svc in arr_services],
    )

    all_records: list[dict] = []
    arr_stats: dict[str, dict] = {}
    for svc_name, data in zip(arr_services, queue_results):
        records = data.get("records", [])
        all_records.extend(records)
        warnings = sum(1 for r in records if r.get("trackedDownloadStatus") == "warning")
        arr_stats[svc_name] = {
            "queue": len(records),
            "warnings": warnings,
            "configured": data.get("configured", True),
        }

    torrent_active = sum(
        1
        for r in all_records
        if r.get("protocol") == "torrent" and r.get("trackedDownloadState") == "downloading"
    )
    nzb_active = sum(
        1
        for r in all_records
        if r.get("protocol") == "usenet" and r.get("trackedDownloadState") == "downloading"
    )

    return {
        **arr_stats,
        "arr_services": arr_services,
        "sabnzbd": sab,
        "qbittorrent": qbit,
        "torrent_active": torrent_active,
        "nzb_active": nzb_active,
    }


@router.delete("/queue/{source}/{item_id}")
async def remove_queue_item(source: str, item_id: int) -> dict:
    configured = get_configured_arr_services()
    if source not in configured:
        return {"ok": False, "message": f"Unknown or unconfigured service: {source}"}
    return await delete_queue_item(source, item_id, blocklist=False)


@router.post("/queue/{source}/{item_id}/blocklist")
async def blocklist_queue_item(source: str, item_id: int) -> dict:
    configured = get_configured_arr_services()
    if source not in configured:
        return {"ok": False, "message": f"Unknown or unconfigured service: {source}"}
    return await delete_queue_item(source, item_id, blocklist=True)


@router.post("/queue/blocklist-all-warnings")
async def blocklist_all_warnings() -> dict:
    arr_services = get_configured_arr_services()

    # Phase 1: fetch all queues concurrently
    queue_results = await asyncio.gather(*[get_arr_queue(svc) for svc in arr_services])

    # Phase 2: collect warning items then delete concurrently
    delete_tasks = []
    for svc_name, data in zip(arr_services, queue_results):
        for record in data.get("records", []):
            if record.get("trackedDownloadStatus") == "warning":
                delete_tasks.append(delete_queue_item(svc_name, record["id"], blocklist=True))

    if delete_tasks:
        await asyncio.gather(*delete_tasks, return_exceptions=True)

    return {"blocklisted": len(delete_tasks)}


@router.post("/watchdog")
async def run_watchdog() -> dict:
    """Find downloads stalled longer than the configured threshold."""
    config = load_config()
    threshold_hours = config.thresholds.get("watchdog_threshold_hours", 2)
    arr_services = get_configured_arr_services()
    now = datetime.now(UTC)

    stalled: list[dict] = []
    all_records: list[tuple[dict, str]] = []
    queue_results = await asyncio.gather(*[get_arr_queue(svc) for svc in arr_services])
    for svc_name, data in zip(arr_services, queue_results):
        for record in data.get("records", []):
            all_records.append((record, svc_name))

    for record, source in all_records:
        tracked_state = record.get("trackedDownloadState", "")
        tracked_status = record.get("trackedDownloadStatus", "")

        # Skip healthy active downloads, only flag stuck/errored/warned items
        if tracked_state == "downloading" and tracked_status == "ok":
            continue

        added = record.get("added", "")
        if not added:
            continue
        try:
            added_dt = datetime.fromisoformat(added.replace("Z", "+00:00"))
            hours_since = (now - added_dt).total_seconds() / 3600
            if hours_since >= threshold_hours:
                stalled.append(
                    {
                        "id": record.get("id"),
                        "title": record.get("title", "Unknown"),
                        "source": source,
                        "status": tracked_status or tracked_state,
                        "hours": round(hours_since, 1),
                    }
                )
        except (ValueError, TypeError):
            continue

    return {"stalled": stalled, "threshold_hours": threshold_hours, "count": len(stalled)}


@router.post("/import-scan/{source}")
async def run_import_scan(source: str) -> dict:
    """Trigger a download import scan on an ARR service to process stuck completed downloads."""
    configured = get_configured_arr_services()
    if source not in configured:
        return {"ok": False, "message": f"Unknown or unconfigured service: {source}"}
    return await trigger_import_scan(source)


@router.get("/library-stats")
async def library_stats() -> dict:
    """Get total counts from configured ARR services (movies, shows, etc.)."""
    return await get_arr_library_stats()


@router.get("/history")
async def download_history() -> list[dict]:
    """Get recent download/import history from all configured ARR services."""
    arr_services = get_configured_arr_services()
    history_results = await asyncio.gather(*[get_arr_history(svc) for svc in arr_services])
    all_history: list[dict] = [item for history in history_results for item in history]
    # Sort by date descending
    all_history.sort(key=lambda x: x.get("date", ""), reverse=True)
    return all_history[:30]


@router.get("/tasks")
async def active_tasks() -> list[dict]:
    """Get currently running/queued tasks from all configured ARR services."""
    arr_services = get_configured_arr_services()
    task_results = await asyncio.gather(*[get_arr_tasks(svc) for svc in arr_services])
    return [task for tasks in task_results for task in tasks]
