from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest


@pytest.fixture()
def config_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point settings.config_path at a temp file and bust the config cache."""
    import dataclasses

    cfg = tmp_path / "panelarr.json"

    import backend.config as cfg_module
    import backend.services.config as svc_cfg

    new_settings = dataclasses.replace(cfg_module.settings, config_path=str(cfg))
    monkeypatch.setattr(cfg_module, "settings", new_settings)
    monkeypatch.setattr(svc_cfg, "settings", new_settings)

    monkeypatch.setattr(svc_cfg, "_resolved_config_path", None)
    svc_cfg._config_cache = None
    svc_cfg._config_cache_at = 0.0

    yield cfg

    svc_cfg._config_cache = None
    svc_cfg._config_cache_at = 0.0


def _write_services(config_path: Path, *, sonarr: bool = False, radarr: bool = False) -> None:
    services: dict = {}
    if sonarr:
        services["sonarr"] = {"url": "http://sonarr:8989", "api_key": "skey"}
    if radarr:
        services["radarr"] = {"url": "http://radarr:7878", "api_key": "rkey"}
    config_path.write_text(json.dumps({"services": services}))

    import backend.services.config as svc_cfg

    svc_cfg._config_cache = None
    svc_cfg._config_cache_at = 0.0


SONARR_CALENDAR_SAMPLE = [
    {
        "id": 101,
        "seasonNumber": 2,
        "episodeNumber": 5,
        "title": "The One With The Tests",
        "airDateUtc": "2026-04-10T01:00:00Z",
        "hasFile": False,
        "monitored": True,
        "series": {
            "id": 9,
            "title": "Friends",
            "images": [
                {"coverType": "fanart", "remoteUrl": "http://x/fanart.jpg"},
                {"coverType": "poster", "remoteUrl": "http://x/poster.jpg"},
            ],
        },
    }
]

RADARR_MULTI_RELEASE = [
    {
        "id": 7,
        "title": "Test Movie",
        "year": 2026,
        "hasFile": False,
        "monitored": True,
        "inCinemas": "2026-04-15T00:00:00Z",
        "digitalRelease": "2026-04-09T00:00:00Z",
        "physicalRelease": "2026-04-20T00:00:00Z",
        "images": [{"coverType": "poster", "url": "http://r/p.jpg"}],
    }
]

RADARR_OUT_OF_WINDOW = [
    {
        "id": 8,
        "title": "Old Movie",
        "year": 2020,
        "hasFile": True,
        "monitored": True,
        "inCinemas": "2020-01-01T00:00:00Z",
        "images": [],
    }
]


@pytest.mark.asyncio
async def test_sonarr_normalization(monkeypatch: pytest.MonkeyPatch, config_path: Path) -> None:
    _write_services(config_path, sonarr=True)

    async def fake_arr_get(url, api_key, path, params=None, **kwargs):
        assert path == "/api/v3/calendar"
        assert params["includeSeries"] == "true"
        return SONARR_CALENDAR_SAMPLE

    monkeypatch.setattr("backend.services.calendar._arr_get", fake_arr_get)

    from backend.services.calendar import get_calendar

    start = datetime(2026, 4, 1, tzinfo=UTC)
    end = datetime(2026, 4, 30, tzinfo=UTC)
    result = await get_calendar(start, end)

    assert result["counts"]["episodes"] == 1
    assert result["counts"]["movies"] == 0
    item = result["items"][0]
    assert item["kind"] == "episode"
    assert item["source"] == "sonarr"
    assert item["title"] == "Friends"
    assert item["episode_code"] == "S02E05"
    assert "S02E05" in item["subtitle"]
    assert item["poster_url"] == "/api/media/poster?url=http://x/poster.jpg"
    assert item["deep_link"] == "/shows/9"
    assert item["air_date_utc"].startswith("2026-04-10T01:00:00")


@pytest.mark.asyncio
async def test_radarr_picks_soonest_in_window(
    monkeypatch: pytest.MonkeyPatch, config_path: Path
) -> None:
    _write_services(config_path, radarr=True)

    async def fake_arr_get(url, api_key, path, params=None, **kwargs):
        return RADARR_MULTI_RELEASE

    monkeypatch.setattr("backend.services.calendar._arr_get", fake_arr_get)

    from backend.services.calendar import get_calendar

    start = datetime(2026, 4, 1, tzinfo=UTC)
    end = datetime(2026, 4, 30, tzinfo=UTC)
    result = await get_calendar(start, end)

    assert result["counts"]["movies"] == 1
    item = result["items"][0]
    assert item["release_type"] == "digital"  # 2026-04-09 is earliest in window
    assert item["air_date_utc"].startswith("2026-04-09")
    assert "Digital" in item["subtitle"]


@pytest.mark.asyncio
async def test_radarr_no_release_in_window_skipped(
    monkeypatch: pytest.MonkeyPatch, config_path: Path
) -> None:
    _write_services(config_path, radarr=True)

    async def fake_arr_get(url, api_key, path, params=None, **kwargs):
        return RADARR_OUT_OF_WINDOW

    monkeypatch.setattr("backend.services.calendar._arr_get", fake_arr_get)

    from backend.services.calendar import get_calendar

    start = datetime(2026, 4, 1, tzinfo=UTC)
    end = datetime(2026, 4, 30, tzinfo=UTC)
    result = await get_calendar(start, end)

    assert result["counts"]["total"] == 0


@pytest.mark.asyncio
async def test_fanout_resilience_one_fails(
    monkeypatch: pytest.MonkeyPatch, config_path: Path
) -> None:
    _write_services(config_path, sonarr=True, radarr=True)

    async def fake_arr_get(url, api_key, path, params=None, **kwargs):
        if "sonarr" in url:
            raise RuntimeError("sonarr is down")
        return RADARR_MULTI_RELEASE

    monkeypatch.setattr("backend.services.calendar._arr_get", fake_arr_get)

    from backend.services.calendar import get_calendar

    start = datetime(2026, 4, 1, tzinfo=UTC)
    end = datetime(2026, 4, 30, tzinfo=UTC)
    result = await get_calendar(start, end)

    assert result["counts"]["movies"] == 1
    assert result["counts"]["episodes"] == 0
    assert any(e["source"] == "sonarr" for e in result["errors"])


@pytest.mark.asyncio
async def test_neither_configured_returns_empty(config_path: Path) -> None:
    _write_services(config_path)  # no services

    from backend.services.calendar import get_calendar

    start = datetime(2026, 4, 1, tzinfo=UTC)
    end = datetime(2026, 4, 30, tzinfo=UTC)
    result = await get_calendar(start, end)

    assert result["counts"]["total"] == 0
    assert result["errors"] == []


@pytest.mark.asyncio
async def test_only_sonarr_configured(monkeypatch: pytest.MonkeyPatch, config_path: Path) -> None:
    _write_services(config_path, sonarr=True)

    async def fake_arr_get(url, api_key, path, params=None, **kwargs):
        return SONARR_CALENDAR_SAMPLE

    monkeypatch.setattr("backend.services.calendar._arr_get", fake_arr_get)

    from backend.services.calendar import get_calendar

    result = await get_calendar(
        datetime(2026, 4, 1, tzinfo=UTC),
        datetime(2026, 4, 30, tzinfo=UTC),
    )
    assert result["counts"]["episodes"] == 1
    assert result["counts"]["movies"] == 0


@pytest.mark.asyncio
async def test_kind_filter_episodes_only(
    monkeypatch: pytest.MonkeyPatch, config_path: Path
) -> None:
    _write_services(config_path, sonarr=True, radarr=True)

    calls: list[str] = []

    async def fake_arr_get(url, api_key, path, params=None, **kwargs):
        calls.append(url)
        if "sonarr" in url:
            return SONARR_CALENDAR_SAMPLE
        return RADARR_MULTI_RELEASE

    monkeypatch.setattr("backend.services.calendar._arr_get", fake_arr_get)

    from backend.services.calendar import get_calendar

    result = await get_calendar(
        datetime(2026, 4, 1, tzinfo=UTC),
        datetime(2026, 4, 30, tzinfo=UTC),
        kind="episodes",
    )
    assert result["counts"]["episodes"] == 1
    assert result["counts"]["movies"] == 0
    assert all("sonarr" in u for u in calls)


@pytest.mark.asyncio
async def test_router_default_window(monkeypatch: pytest.MonkeyPatch, config_path: Path) -> None:
    _write_services(config_path)  # no services -> empty result, just exercises parsing

    from httpx import ASGITransport, AsyncClient

    from backend.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/calendar")

    assert resp.status_code == 200
    body = resp.json()
    assert body["counts"]["total"] == 0
    assert "items" in body
    assert "errors" in body


@pytest.mark.asyncio
async def test_router_bad_date_returns_400(config_path: Path) -> None:
    _write_services(config_path)

    from httpx import ASGITransport, AsyncClient

    from backend.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/calendar", params={"start": "not-a-date"})

    assert resp.status_code == 400
