from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from backend.services.calendar import get_calendar

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


def _parse_date(value: str | None, *, fallback: datetime) -> datetime:
    if not value:
        return fallback
    try:
        # Accept either a bare date (YYYY-MM-DD) or full ISO-8601
        if len(value) == 10:
            dt = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=UTC)
        else:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
        return dt
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid date '{value}': expected YYYY-MM-DD or ISO-8601",
        ) from exc


@router.get("")
async def list_calendar(
    start: str | None = Query(None, description="ISO-8601 or YYYY-MM-DD (UTC)"),
    end: str | None = Query(None, description="ISO-8601 or YYYY-MM-DD (UTC)"),
    kind: str = Query("all", pattern="^(all|episodes|movies|episode|movie)$"),
    include_unmonitored: bool = Query(True),
    include_specials: bool = Query(False),
    include_downloaded: bool = Query(True),
) -> dict:
    """Unified calendar across configured ARR services.

    Defaults to a 35-day window starting today (covers a full month grid).
    Specials (Sonarr season 0) are hidden by default to match the show
    detail view. Downloaded items are included by default; disable to
    focus on what's still pending.
    """
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    start_dt = _parse_date(start, fallback=today)
    end_dt = _parse_date(end, fallback=today + timedelta(days=35))

    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="end must be >= start")

    return await get_calendar(
        start_dt,
        end_dt,
        kind=kind,
        include_unmonitored=include_unmonitored,
        include_specials=include_specials,
        include_downloaded=include_downloaded,
    )


def _ics_escape(value: str) -> str:
    """Escape RFC 5545 reserved characters in TEXT values."""
    return (
        (value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
        .replace("\r", "")
    )


def _ics_dt(value: str) -> str:
    """Convert ISO-8601 (with Z) to ICS-style UTC date-time (YYYYMMDDTHHMMSSZ)."""
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return ""
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _ics_uid(item: dict) -> str:
    """Stable UID for a calendar item so calendar apps can dedupe across refreshes."""
    raw = f"{item.get('source', '')}-{item.get('kind', '')}-{item.get('id', '')}"
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"{digest}@panelarr"


def _build_ics(items: list[dict]) -> str:
    """Build a minimal RFC 5545 VCALENDAR from calendar items."""
    now_utc = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Panelarr//Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Panelarr",
        "X-WR-CALDESC:Upcoming episodes and movie releases",
    ]
    for item in items:
        dtstart = _ics_dt(item.get("air_date_utc", ""))
        if not dtstart:
            continue
        # Episodes are point-in-time events; give them a 1-hour block so they
        # render visibly in week/day views. Movies use a 2-hour block.
        block_hours = 1 if item.get("kind") == "episode" else 2
        try:
            start_dt = datetime.fromisoformat(item["air_date_utc"].replace("Z", "+00:00"))
            dtend = (
                (start_dt + timedelta(hours=block_hours)).astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
            )
        except (ValueError, KeyError):
            dtend = dtstart

        title = item.get("title") or ""
        subtitle = item.get("subtitle") or ""
        summary = f"{title}, {subtitle}" if subtitle else title
        if item.get("has_file"):
            summary = f"\u2713 {summary}"  # check mark prefix for downloaded

        description_bits = [subtitle] if subtitle else []
        description_bits.append(f"Source: {item.get('source', '')}")
        description = " · ".join(filter(None, description_bits))

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{_ics_uid(item)}",
                f"DTSTAMP:{now_utc}",
                f"DTSTART:{dtstart}",
                f"DTEND:{dtend}",
                f"SUMMARY:{_ics_escape(summary)}",
                f"DESCRIPTION:{_ics_escape(description)}",
                f"CATEGORIES:{item.get('kind', '').upper()}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    # RFC 5545 mandates CRLF line endings
    return "\r\n".join(lines) + "\r\n"


@router.get("/feed.ics")
async def calendar_ics(
    start: str | None = Query(None),
    end: str | None = Query(None),
    kind: str = Query("all", pattern="^(all|episodes|movies|episode|movie)$"),
    include_unmonitored: bool = Query(True),
    include_specials: bool = Query(False),
    include_downloaded: bool = Query(True),
) -> Response:
    """Subscribe-able iCalendar feed of upcoming releases.

    Mirrors the ``GET /api/calendar`` query params so users can pin
    whichever filter combination they want into their calendar app.
    Defaults to a 90-day window so subscribers see a meaningful horizon.
    """
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    start_dt = _parse_date(start, fallback=today)
    end_dt = _parse_date(end, fallback=today + timedelta(days=90))

    if end_dt < start_dt:
        raise HTTPException(status_code=400, detail="end must be >= start")

    payload = await get_calendar(
        start_dt,
        end_dt,
        kind=kind,
        include_unmonitored=include_unmonitored,
        include_specials=include_specials,
        include_downloaded=include_downloaded,
    )
    body = _build_ics(payload.get("items", []))
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="panelarr.ics"'},
    )
