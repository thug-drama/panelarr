from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    """Bootstrap-only environment configuration.

    Panelarr reads four values from the environment, host, port, the
    Docker socket path, and the config-file location. These have to be
    available *before* ``panelarr.json`` can be loaded, so they cannot
    live inside it. Everything else (services, notifications, thresholds,
    authentication) is managed through the Settings UI and persisted to
    ``panelarr.json``.

    All four have sensible defaults that match the official Docker image,
    so a fresh install does not need a ``.env`` file at all.
    """

    host: str = field(default_factory=lambda: os.getenv("PANELARR_HOST", "0.0.0.0"))
    port: int = field(default_factory=lambda: int(os.getenv("PANELARR_PORT", "8000")))
    docker_socket: str = field(
        default_factory=lambda: os.getenv("DOCKER_SOCKET", "/var/run/docker.sock")
    )
    config_path: str = field(
        default_factory=lambda: os.getenv("CONFIG_PATH", "/config/panelarr.json")
    )


settings = Settings()
