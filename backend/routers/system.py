from __future__ import annotations

import os
import platform
import shutil
import time

import httpx
import psutil
from fastapi import APIRouter
from fastapi.responses import Response

from backend.config import settings
from backend.services.config import get_service_config, load_config
from backend.services.docker import get_docker_version, list_containers
from backend.services.media import get_emby_stats, get_jellyfin_stats, get_plex_stats

router = APIRouter(prefix="/api/system", tags=["system"])

_host_os_cache: str | None = None
_cpu_model_cache: str | None = None


def _disk_usage_for_path(path: str) -> dict | None:
    try:
        usage = shutil.disk_usage(path)
        pct = round(usage.used / usage.total * 100, 1)
        dev_id = os.stat(path).st_dev
        return {
            "mount": path,
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            "pct": pct,
            "_dev": dev_id,
        }
    except (OSError, ValueError):
        return None


# Paths that are Docker-internal bind mounts and should be skipped
_SKIP_MOUNTS = {
    "/etc/resolv.conf",
    "/etc/hostname",
    "/etc/hosts",
    "/dev",
    "/dev/shm",
    "/dev/pts",
    "/dev/mqueue",
    "/sys",
    "/proc",
    "/config",
    "/app",
}
_SKIP_PREFIXES = ("/snap/", "/run/", "/sys/", "/proc/", "/dev/")


def _collect_disks(filter_by_config: bool = True) -> list[dict]:
    """Collect unique disk mounts, deduplicating by OS device ID (st_dev).

    When `filter_by_config` is True (default), the result is filtered to
    the mounts listed in `config.thresholds.disks`. When that list is empty
    or unset, or when `filter_by_config` is False, all detected disks are
    returned.
    """
    disks: list[dict] = []
    seen_devices: set[int] = set()

    def _try_add(path: str) -> None:
        d = _disk_usage_for_path(path)
        if d and d["_dev"] not in seen_devices:
            seen_devices.add(d["_dev"])
            disks.append(d)

    # Priority paths first, preferred labels for well-known mounts
    for path in ["/", "/mnt/media", "/mnt/unionfs"]:
        _try_add(path)

    # Additional partitions
    partitions = psutil.disk_partitions(all=False)
    for part in partitions:
        mp = part.mountpoint
        if mp in _SKIP_MOUNTS:
            continue
        if any(mp.startswith(p) for p in _SKIP_PREFIXES):
            continue
        _try_add(mp)

    # Strip internal _dev field before returning
    for d in disks:
        d.pop("_dev", None)

    if filter_by_config:
        try:
            config = load_config()
            selected = list(config.thresholds.get("disks") or [])
        except Exception:
            selected = []
        if selected:
            disks = [d for d in disks if d["mount"] in selected]

    return disks


@router.get("/health")
async def health_check() -> dict:
    config = load_config()
    containers = []
    docker_ok = False
    try:
        containers = await list_containers(show_all=True)
        docker_ok = True
    except Exception:
        pass

    running = sum(1 for c in containers if c.get("state") == "running")
    total = len(containers)

    disks = _collect_disks()

    disk_warning = any(d["pct"] >= config.thresholds.get("disk_warn_pct", 85) for d in disks)
    disk_critical = any(d["pct"] >= config.thresholds.get("disk_crit_pct", 90) for d in disks)

    # Build status with reasons
    issues: list[str] = []
    status = "healthy"
    if not docker_ok:
        issues.append("Docker socket not reachable")
        status = "degraded"
    if disk_warning:
        warn_pct = config.thresholds.get("disk_warn_pct", 85)
        warn_mounts = [d["mount"] for d in disks if d["pct"] >= warn_pct]
        issues.append(f"Disk warning: {', '.join(warn_mounts)}")
        status = "degraded"
    if disk_critical:
        crit_pct = config.thresholds.get("disk_crit_pct", 90)
        crit_mounts = [d["mount"] for d in disks if d["pct"] >= crit_pct]
        issues.append(f"Disk critical: {', '.join(crit_mounts)}")
        status = "unhealthy"

    stopped = [c["name"] for c in containers if c.get("state") != "running"]
    if stopped:
        issues.append(f"Stopped containers: {', '.join(stopped[:5])}")

    mem = psutil.virtual_memory()
    if mem.percent >= 90:
        issues.append(f"Memory high: {mem.percent}%")
        if status == "healthy":
            status = "degraded"

    return {
        "status": status,
        "issues": issues,
        "version": "0.1.0-alpha",
        "containers_total": total,
        "containers_running": running,
        "docker_connected": docker_ok,
        "disk": disks,
        "disk_warning": disk_warning,
        "disk_critical": disk_critical,
        "memory_total": mem.total,
        "memory_used": mem.used,
        "memory_pct": mem.percent,
        "cpu_count": psutil.cpu_count(),
        "uptime": _get_uptime(),
    }


@router.get("/info")
async def system_info() -> dict:
    docker_ver = await get_docker_version()
    mem = psutil.virtual_memory()
    swap = psutil.swap_memory()
    cpu_freq = psutil.cpu_freq()
    cpu_pct = psutil.cpu_percent(interval=0)
    net = psutil.net_io_counters()
    disk_io = psutil.disk_io_counters()

    return {
        "hostname": platform.node(),
        "os": await _get_host_os(),
        "arch": platform.machine(),
        "kernel": platform.release(),
        "python_version": platform.python_version(),
        "docker_version": docker_ver.get("Version", "unknown") if docker_ver else "unavailable",
        "cpu_model": _get_cpu_model(),
        "cpu_count": psutil.cpu_count(),
        "cpu_count_physical": psutil.cpu_count(logical=False),
        "cpu_freq_mhz": round(cpu_freq.current, 0) if cpu_freq else None,
        "cpu_pct": cpu_pct,
        "memory_total": mem.total,
        "memory_used": mem.used,
        "memory_available": mem.available,
        "memory_pct": mem.percent,
        "swap_total": swap.total,
        "swap_used": swap.used,
        "swap_pct": swap.percent,
        "uptime": _get_uptime(),
        "load_average": list(psutil.getloadavg()),
        "net_bytes_sent": net.bytes_sent if net else 0,
        "net_bytes_recv": net.bytes_recv if net else 0,
        "disk_read_bytes": disk_io.read_bytes if disk_io else 0,
        "disk_write_bytes": disk_io.write_bytes if disk_io else 0,
    }


async def _get_host_os() -> str:
    """Get host OS name from Docker daemon info (not the container's OS)."""
    global _host_os_cache
    if _host_os_cache is not None:
        return _host_os_cache
    try:
        async with httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(uds=settings.docker_socket), timeout=5
        ) as client:
            resp = await client.get("http://localhost/v1.44/info")
            if resp.status_code == 200:
                info = resp.json()
                _host_os_cache = info.get("OperatingSystem", platform.platform())
                return _host_os_cache
    except Exception:
        pass
    _host_os_cache = platform.platform()
    return _host_os_cache


def _get_cpu_model() -> str:
    """Get CPU model string."""
    global _cpu_model_cache
    if _cpu_model_cache is not None:
        return _cpu_model_cache
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    _cpu_model_cache = line.split(":")[1].strip()
                    return _cpu_model_cache
    except (FileNotFoundError, PermissionError):
        pass
    _cpu_model_cache = platform.processor() or "Unknown"
    return _cpu_model_cache


@router.get("/disk")
async def disk_usage() -> list[dict]:
    config = load_config()
    disks = _collect_disks()
    for d in disks:
        d["warn"] = d["pct"] >= config.thresholds.get("disk_warn_pct", 85)
        d["critical"] = d["pct"] >= config.thresholds.get("disk_crit_pct", 90)
    return disks


@router.get("/disks/all")
async def all_disks() -> dict:
    """Return every detected mount (unfiltered) plus the currently selected list.

    Used by the Settings page to let the user pick which mounts to monitor on
    the dashboard. The wizard's `/api/setup/system-check` endpoint returns the
    same shape, but is gated to incomplete-setup only.
    """
    config = load_config()
    disks = _collect_disks(filter_by_config=False)
    selected = list(config.thresholds.get("disks") or [])
    return {"disks": disks, "selected": selected}


@router.post("/discord/health-check")
async def discord_health_check() -> dict:
    """Run health check and post to Discord webhook."""
    config = load_config()
    # Find Discord webhook from notification channels
    data = config.model_dump()
    channels = data.get("notifications", {}).get("channels", [])
    discord_ch = next((ch for ch in channels if ch.get("type") == "discord"), None)
    webhook_url = discord_ch.get("config", {}).get("webhook_url", "") if discord_ch else ""
    if not webhook_url or webhook_url.startswith("****"):
        return {
            "ok": False,
            "message": "No Discord channel configured, add one in Settings > Notifications",
        }

    health = await health_check()

    disk_lines = []
    for d in health.get("disk", []):
        crit_pct = config.thresholds.get("disk_crit_pct", 90)
        warn_pct = config.thresholds.get("disk_warn_pct", 85)
        emoji = "🔴" if d["pct"] >= crit_pct else "🟡" if d["pct"] >= warn_pct else "🟢"
        disk_lines.append(f"{emoji} {d['mount']}: {d['pct']}%")

    embed = {
        "title": "Panelarr Health Check",
        "color": 0x00FF00 if health["status"] == "healthy" else 0xFF0000,
        "fields": [
            {
                "name": "Status",
                "value": health["status"].capitalize(),
                "inline": True,
            },
            {
                "name": "Containers",
                "value": f"{health['containers_running']}/{health['containers_total']} running",
                "inline": True,
            },
            {
                "name": "Memory",
                "value": f"{health['memory_pct']}%",
                "inline": True,
            },
            {
                "name": "Disk",
                "value": "\n".join(disk_lines) or "No disks found",
                "inline": False,
            },
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                webhook_url,
                json={"embeds": [embed]},
            )
            resp.raise_for_status()
            return {"ok": True, "message": "Health check posted to Discord"}
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPStatusError) as exc:
        return {"ok": False, "message": str(exc)}


@router.get("/media")
async def media_stats() -> dict:
    """Get Plex and Jellyfin media server stats."""
    plex = await get_plex_stats()
    jellyfin = await get_jellyfin_stats()
    emby = await get_emby_stats()
    return {"plex": plex, "jellyfin": jellyfin, "emby": emby}


@router.get("/plex/thumb")
async def plex_thumbnail(path: str) -> Response:
    """Proxy a Plex thumbnail. Path must be a relative Plex library path."""
    # SSRF prevention, only allow relative Plex paths (starts with /)
    if not path.startswith("/library/") and not path.startswith("/:/"):
        return Response(status_code=403)
    if "://" in path:
        return Response(status_code=403)

    config = load_config()
    svc = get_service_config(config, "plex")
    url, token = svc.get("url", ""), svc.get("token", "")
    if not url or not token:
        return Response(status_code=404)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{url}/photo/:/transcode",
                params={
                    "width": "300",
                    "height": "450",
                    "minSize": "1",
                    "upscale": "1",
                    "url": path,
                    "X-Plex-Token": token,
                },
            )
            if resp.status_code == 200:
                return Response(
                    content=resp.content,
                    media_type=resp.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": "public, max-age=3600"},
                )
    except Exception:
        pass
    return Response(status_code=404)


def _get_uptime() -> str:
    try:
        boot = psutil.boot_time()
        elapsed = time.time() - boot
        days = int(elapsed // 86400)
        hours = int((elapsed % 86400) // 3600)
        minutes = int((elapsed % 3600) // 60)
        if days > 0:
            return f"{days}d {hours}h {minutes}m"
        return f"{hours}h {minutes}m"
    except Exception:
        return "unknown"
