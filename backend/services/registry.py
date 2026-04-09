from __future__ import annotations

# Service type definitions, how to connect and authenticate
SERVICE_TYPES: dict[str, dict] = {
    "arr": {
        "auth": "api_key",
        "test_path": "/api/v3/system/status",
        "fields": ["url", "api_key"],
        "field_labels": {"url": "URL", "api_key": "API Key"},
        "secret_fields": ["api_key"],
    },
    "sabnzbd": {
        "auth": "query_param",
        "fields": ["url", "api_key"],
        "field_labels": {"url": "URL", "api_key": "API Key"},
        "secret_fields": ["api_key"],
    },
    "nzbget": {
        "auth": "basic",
        "fields": ["url", "username", "password"],
        "field_labels": {"url": "URL", "username": "Username", "password": "Password"},
        "secret_fields": ["password"],
    },
    "qbittorrent": {
        "auth": "login",
        "fields": ["url", "username", "password"],
        "field_labels": {"url": "URL", "username": "Username", "password": "Password"},
        "secret_fields": ["password"],
    },
    "transmission": {
        "auth": "basic",
        "fields": ["url", "username", "password"],
        "field_labels": {"url": "URL", "username": "Username", "password": "Password"},
        "secret_fields": ["password"],
    },
    "deluge": {
        "auth": "password",
        "fields": ["url", "password"],
        "field_labels": {"url": "URL", "password": "Password"},
        "secret_fields": ["password"],
    },
    "plex": {
        "auth": "token",
        "fields": ["url", "token"],
        "field_labels": {"url": "URL", "token": "Token"},
        "secret_fields": ["token"],
    },
    "jellyfin": {
        "auth": "api_key",
        "fields": ["url", "api_key"],
        "field_labels": {"url": "URL", "api_key": "API Key"},
        "secret_fields": ["api_key"],
    },
    "emby": {
        "auth": "api_key",
        "fields": ["url", "api_key"],
        "field_labels": {"url": "URL", "api_key": "API Key"},
        "secret_fields": ["api_key"],
    },
}

# Known services and their categories
KNOWN_SERVICES: dict[str, dict] = {
    # ARR services (all use /api/v3)
    "sonarr": {
        "type": "arr",
        "label": "Sonarr",
        "category": "arr",
        "description": "TV show management",
        "has_queue": True,
        "default_port": 8989,
    },
    "radarr": {
        "type": "arr",
        "label": "Radarr",
        "category": "arr",
        "description": "Movie management",
        "has_queue": True,
        "default_port": 7878,
    },
    # Bazarr omitted, subtitle management doesn't integrate beyond connection testing
    # Download clients
    "sabnzbd": {
        "type": "sabnzbd",
        "label": "SABnzbd",
        "category": "download",
        "description": "Usenet downloader",
    },
    "nzbget": {
        "type": "nzbget",
        "label": "NZBGet",
        "category": "download",
        "description": "Usenet downloader",
    },
    "qbittorrent": {
        "type": "qbittorrent",
        "label": "qBittorrent",
        "category": "download",
        "description": "Torrent client",
    },
    "transmission": {
        "type": "transmission",
        "label": "Transmission",
        "category": "download",
        "description": "Torrent client",
    },
    "deluge": {
        "type": "deluge",
        "label": "Deluge",
        "category": "download",
        "description": "Torrent client",
    },
    # Media servers
    "plex": {
        "type": "plex",
        "label": "Plex",
        "category": "media",
        "description": "Media server",
    },
    "jellyfin": {
        "type": "jellyfin",
        "label": "Jellyfin",
        "category": "media",
        "description": "Media server",
    },
    "emby": {
        "type": "emby",
        "label": "Emby",
        "category": "media",
        "description": "Media server",
    },
}

# Category labels and ordering for UI
SERVICE_CATEGORIES: dict[str, dict] = {
    "arr": {"label": "ARR Services", "order": 1},
    "download": {"label": "Download Clients", "order": 2},
    "media": {"label": "Media Servers", "order": 3},
}


def get_service_fields(service_name: str) -> list[str]:
    """Get the config fields for a service."""
    info = KNOWN_SERVICES.get(service_name)
    if not info:
        return ["url", "api_key"]
    stype = SERVICE_TYPES.get(info["type"], {})
    return stype.get("fields", ["url", "api_key"])


def get_secret_fields(service_name: str) -> list[str]:
    """Get the secret field names for a service."""
    info = KNOWN_SERVICES.get(service_name)
    if not info:
        return ["api_key"]
    stype = SERVICE_TYPES.get(info["type"], {})
    return stype.get("secret_fields", ["api_key"])
