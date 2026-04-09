from __future__ import annotations

from backend.services.discover import match_container, match_containers_to_services, suggested_url


def test_high_confidence_sonarr() -> None:
    container = {
        "name": "sonarr",
        "image": "linuxserver/sonarr:latest",
        "ports": {"8989/tcp": 8989},
    }
    result = match_container(container)
    assert result is not None
    service, confidence = result
    assert service == "sonarr"
    assert confidence == "high"


def test_high_confidence_radarr() -> None:
    container = {
        "name": "radarr",
        "image": "lscr.io/linuxserver/radarr:latest",
        "ports": {"7878/tcp": 7878},
    }
    result = match_container(container)
    assert result is not None
    service, confidence = result
    assert service == "radarr"
    assert confidence == "high"


def test_medium_confidence_image_only() -> None:
    # Image matches but name and port don't
    container = {
        "name": "media-manager",
        "image": "hotio/sonarr:latest",
        "ports": {"9999/tcp": 9999},
    }
    result = match_container(container)
    assert result is not None
    service, confidence = result
    assert service == "sonarr"
    assert confidence == "medium"


def test_no_match_when_image_does_not_match() -> None:
    # Image is fully opaque (no sonarr substring), even with name + port
    # signals we drop the match to avoid false positives like authelia
    # exposing port 9091 matching transmission.
    container = {
        "name": "my-sonarr",
        "image": "custom-registry.example.com/foo-bar:abc123",
        "ports": {"8989/tcp": 8989},
    }
    assert match_container(container) is None


def test_no_match_name_only() -> None:
    # Name says sonarr but image and port don't agree, single signal, dropped.
    container = {
        "name": "sonarr",
        "image": "my-custom-image:latest",
        "ports": {"9999/tcp": 9999},
    }
    assert match_container(container) is None


def test_no_match_authelia_on_transmission_port() -> None:
    # Regression: authelia listens on 9091 (transmission's default port).
    # Without an image match we must NOT classify it as transmission.
    container = {
        "name": "authelia",
        "image": "authelia/authelia:latest",
        "ports": {"9091/tcp": 9091},
    }
    assert match_container(container) is None


def test_no_match_random_container() -> None:
    container = {
        "name": "nginx",
        "image": "nginx:latest",
        "ports": {"80/tcp": 80},
    }
    result = match_container(container)
    assert result is None


def test_no_match_empty_container() -> None:
    assert match_container({"name": "", "image": "", "ports": {}}) is None


def test_plex_plexinc_image() -> None:
    container = {
        "name": "plex",
        "image": "plexinc/pms-docker:latest",
        "ports": {"32400/tcp": 32400},
    }
    result = match_container(container)
    assert result is not None
    service, confidence = result
    assert service == "plex"
    assert confidence == "high"


def test_jellyfin() -> None:
    container = {
        "name": "jellyfin",
        "image": "jellyfin/jellyfin:latest",
        "ports": {"8096/tcp": 8096},
    }
    result = match_container(container)
    assert result is not None
    service, confidence = result
    assert service == "jellyfin"
    assert confidence == "high"


def test_suggested_url_default_port() -> None:
    container = {"name": "sonarr", "ports": {"8989/tcp": 8989}}
    url = suggested_url(container, "sonarr")
    assert url == "http://sonarr:8989"


def test_suggested_url_with_slash_prefix() -> None:
    container = {"name": "/sonarr", "ports": {}}
    url = suggested_url(container, "sonarr")
    assert url == "http://sonarr:8989"


def test_suggested_url_non_default_host_port() -> None:
    # Host port is remapped to 19898, but we still use container name + default for Docker DNS
    container = {"name": "sonarr", "ports": {"8989/tcp": 19898}}
    url = suggested_url(container, "sonarr")
    # When port is remapped we surface the remapped port
    assert url == "http://sonarr:19898"


def test_match_multiple_containers() -> None:
    containers = [
        {
            "name": "sonarr",
            "image": "linuxserver/sonarr:latest",
            "ports": {"8989/tcp": 8989},
        },
        {
            "name": "radarr",
            "image": "linuxserver/radarr:latest",
            "ports": {"7878/tcp": 7878},
        },
        {
            "name": "nginx",
            "image": "nginx:latest",
            "ports": {"80/tcp": 80},
        },
    ]
    matches = match_containers_to_services(containers)
    services = {m["service"] for m in matches}
    assert "sonarr" in services
    assert "radarr" in services
    assert "nginx" not in services
    assert len(matches) == 2


def test_dedup_best_confidence_wins() -> None:
    # Two containers both match sonarr, the one with high confidence should win
    containers = [
        {
            "name": "sonarr-backup",
            "image": "hotio/sonarr:latest",
            "ports": {"9999/tcp": 9999},
        },
        {
            "name": "sonarr",
            "image": "linuxserver/sonarr:latest",
            "ports": {"8989/tcp": 8989},
        },
    ]
    matches = match_containers_to_services(containers)
    sonarr_matches = [m for m in matches if m["service"] == "sonarr"]
    assert len(sonarr_matches) == 1
    assert sonarr_matches[0]["confidence"] == "high"
    assert sonarr_matches[0]["container_name"] == "sonarr"


def test_already_configured_tagging() -> None:
    containers = [
        {
            "name": "sonarr",
            "image": "linuxserver/sonarr:latest",
            "ports": {"8989/tcp": 8989},
        },
        {
            "name": "radarr",
            "image": "linuxserver/radarr:latest",
            "ports": {"7878/tcp": 7878},
        },
    ]
    matches = match_containers_to_services(containers, configured_services={"sonarr"})
    sonarr = next(m for m in matches if m["service"] == "sonarr")
    radarr = next(m for m in matches if m["service"] == "radarr")
    assert sonarr["already_configured"] is True
    assert radarr["already_configured"] is False


def test_match_includes_expected_keys() -> None:
    containers = [
        {
            "name": "sonarr",
            "image": "linuxserver/sonarr:latest",
            "ports": {"8989/tcp": 8989},
        }
    ]
    matches = match_containers_to_services(containers)
    assert len(matches) == 1
    m = matches[0]
    for key in (
        "service",
        "label",
        "category",
        "confidence",
        "container_name",
        "image",
        "suggested_url",
        "port",
        "fields",
        "already_configured",
    ):
        assert key in m, f"Missing key: {key}"


def test_empty_containers() -> None:
    assert match_containers_to_services([]) == []
