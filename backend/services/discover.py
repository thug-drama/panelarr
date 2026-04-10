from __future__ import annotations

import re

from backend.services.registry import KNOWN_SERVICES, get_service_fields

IMAGE_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "sonarr": [
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/sonarr", re.I),
        re.compile(r"hotio/sonarr", re.I),
        re.compile(r"^sonarr(:|$)", re.I),
    ],
    "radarr": [
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/radarr", re.I),
        re.compile(r"hotio/radarr", re.I),
        re.compile(r"^radarr(:|$)", re.I),
    ],
    "sabnzbd": [
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/sabnzbd", re.I),
        re.compile(r"hotio/sabnzbd", re.I),
        re.compile(r"^sabnzbd(:|$)", re.I),
    ],
    "nzbget": [
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/nzbget", re.I),
        re.compile(r"^nzbget(:|$)", re.I),
    ],
    "qbittorrent": [
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/qbittorrent", re.I),
        re.compile(r"qbittorrentofficial/qbittorrent-nox", re.I),
        re.compile(r"binhex/arch-qbittorrent", re.I),
        re.compile(r"^qbittorrent(:|$)", re.I),
    ],
    "transmission": [
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/transmission", re.I),
        re.compile(r"^transmission(:|$)", re.I),
    ],
    "deluge": [
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/deluge", re.I),
        re.compile(r"^deluge(:|$)", re.I),
    ],
    "plex": [
        re.compile(r"plexinc/pms-docker", re.I),
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/plex", re.I),
        re.compile(r"^plex(:|$)", re.I),
    ],
    "jellyfin": [
        re.compile(r"jellyfin/jellyfin", re.I),
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/jellyfin", re.I),
        re.compile(r"^jellyfin(:|$)", re.I),
    ],
    "emby": [
        re.compile(r"emby/embyserver", re.I),
        re.compile(r"(linuxserver|lscr\.io/linuxserver)/emby", re.I),
        re.compile(r"^emby(:|$)", re.I),
    ],
}

# Default ports, supplement what KNOWN_SERVICES provides
DEFAULT_PORTS: dict[str, int] = {
    "sonarr": 8989,
    "radarr": 7878,
    "sabnzbd": 8080,
    "nzbget": 6789,
    "qbittorrent": 8080,
    "transmission": 9091,
    "deluge": 8112,
    "plex": 32400,
    "jellyfin": 8096,
    "emby": 8096,
}

_CONFIDENCE_RANK = {"high": 2, "medium": 1}


def _service_default_port(service: str) -> int | None:
    """Return the default port for a service, preferring the registry value."""
    info = KNOWN_SERVICES.get(service, {})
    return info.get("default_port") or DEFAULT_PORTS.get(service)


def _image_matches(image: str, service: str) -> bool:
    """Return True if the container image matches any pattern for the service."""
    patterns = IMAGE_PATTERNS.get(service, [])
    return any(p.search(image) for p in patterns)


def match_container(container: dict) -> tuple[str, str] | None:
    """Match a container dict to a known service.

    Returns (service_name, confidence) where confidence is "high" or "medium",
    or None if no service can be confidently matched.

    The container dict is expected to have the shape returned by list_containers():
      name, image, ports ({"8989/tcp": 8989}), state, etc.

    Confidence heuristics, image_match is required so a name/port collision
    on its own (like authelia listening on transmission's port 9091) cannot
    cause a false positive:
    - high   = image_match AND name_match AND port_match (all three agree)
    - medium = image_match alone, or image_match plus exactly one of name/port
    - None   = no image match (single-signal name/port matches are dropped)
    """
    name: str = container.get("name", "").lower()
    image: str = container.get("image", "")
    ports: dict = container.get("ports", {})
    port_values: set[int] = {v for v in ports.values() if isinstance(v, int)}

    best_service: str | None = None
    best_confidence: str | None = None

    for service in IMAGE_PATTERNS:
        default_port = _service_default_port(service)

        image_match = _image_matches(image, service)
        if not image_match:
            continue

        name_match = service in name
        port_match = default_port is not None and default_port in port_values

        if name_match and port_match:
            confidence = "high"
        else:
            confidence = "medium"

        current_rank = _CONFIDENCE_RANK.get(best_confidence or "", -1)
        if _CONFIDENCE_RANK[confidence] > current_rank:
            best_service = service
            best_confidence = confidence

    if best_service is None or best_confidence is None:
        return None
    return (best_service, best_confidence)


def suggested_url(container: dict, service: str) -> str:
    """Build the suggested URL for a service.

    Uses container name as Docker DNS hostname and the service's default port.
    If the container exposes a non-default port mapping, prefer that host port.
    """
    name: str = container.get("name", "").lstrip("/")
    ports: dict = container.get("ports", {})
    default_port = _service_default_port(service) or 80

    # Check if the service port is exposed under a different host port
    port_key = f"{default_port}/tcp"
    if port_key in ports and isinstance(ports[port_key], int):
        exposed_port = ports[port_key]
        if exposed_port != default_port:
            return f"http://{name}:{exposed_port}"

    return f"http://{name}:{default_port}"


def match_containers_to_services(
    containers: list[dict],
    configured_services: set[str] | None = None,
) -> list[dict]:
    """Match a list of containers to known services.

    Returns one match dict per service slug (best confidence wins for duplicates).

    Each match dict:
    {
        "service": "sonarr",
        "label": "Sonarr",
        "category": "arr",
        "confidence": "high",
        "container_name": "sonarr",
        "image": "linuxserver/sonarr:latest",
        "suggested_url": "http://sonarr:8989",
        "port": 8989,
        "fields": ["url", "api_key"],
        "already_configured": False,
    }
    """
    if configured_services is None:
        configured_services = set()

    # service -> best match so far
    best: dict[str, dict] = {}

    for container in containers:
        result = match_container(container)
        if result is None:
            continue
        service, confidence = result

        existing = best.get(service)
        existing_rank = _CONFIDENCE_RANK.get(existing["confidence"], -1) if existing else -1
        if _CONFIDENCE_RANK[confidence] > existing_rank:
            info = KNOWN_SERVICES.get(service, {})
            best[service] = {
                "service": service,
                "label": info.get("label", service.title()),
                "category": info.get("category", ""),
                "confidence": confidence,
                "container_name": container.get("name", "").lstrip("/"),
                "image": container.get("image", ""),
                "suggested_url": suggested_url(container, service),
                "port": _service_default_port(service),
                "fields": get_service_fields(service),
                "already_configured": service in configured_services,
            }

    return list(best.values())
