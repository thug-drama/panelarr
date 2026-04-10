<div align="center">

<img src="frontend/public/logo-mark.svg" alt="Panelarr" height="80" />

**Homelab media control center**

<br />
<br />

[![CI](https://github.com/thug-drama/panelarr/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/thug-drama/panelarr/actions/workflows/ci.yml)
![Version](https://img.shields.io/github/v/release/thug-drama/panelarr?include_prereleases&style=flat-square&color=6366f1&label=version)
![License](https://img.shields.io/badge/license-MIT-6366f1?style=flat-square)
![Python](https://img.shields.io/badge/Python-3.11+-3776ab?style=flat-square&logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-ready-2496ed?style=flat-square&logo=docker&logoColor=white)

</div>

<br />

<!-- screenshot here -->

A self-hosted control panel for Docker-based media stacks. Manage containers, monitor Sonarr/Radarr/qBittorrent/SABnzbd, browse your library, and stream live logs from one place.

## Features

**Dashboard**: stat cards for containers, downloads, disk usage, and system health. Now Streaming card with Plex session details. Upcoming releases widget.

**Movies & Shows**: browse and search your Sonarr/Radarr libraries. Movie and show detail pages with per-episode download progress and search actions.

**Containers**: searchable container table with start/stop/restart, live stats, and WebSocket log streaming per container.

**Downloads**: unified queue from all configured ARR services. Warning detection with per-item and bulk blocklist. Tabs for All, Warnings, Torrents, NZBs, and per-service.

**Notifications**: Discord, Telegram, Slack, Email (SMTP), and generic webhook. Rules engine for routing events to channels.

**Settings**: configure all services from the UI. Secrets are masked on read and preserved on save.

**Authentication**: four modes: `none`, `basic` (JWT session cookies), `proxy` (header from Authelia/Authentik/etc.), `apikey`.

## Quick Start

### Option 1. Docker (recommended)

Pull the pre-built image from GitHub Container Registry. No build step, works on amd64 and arm64 (Raspberry Pi friendly).

Create a `docker-compose.yml`:

```yaml
services:
  panelarr:
    image: ghcr.io/thug-drama/panelarr:latest
    container_name: panelarr
    ports:
      - "8000:8000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - panelarr_config:/config
    restart: unless-stopped

volumes:
  panelarr_config:
```

Start it:

```bash
docker compose up -d
```

Open `http://localhost:8000` and finish the setup wizard.

Available tags:

| Tag | Source | Use when |
|---|---|---|
| `latest` | last `v*.*.*` release | production |
| `v0.1.0-alpha` | exact release tag | pinning to a specific version |
| `dev` | every push to `develop` | living on the edge |

Traefik users: see [docs/configuration.md](docs/configuration.md) for network and label setup, including Saltbox and Authelia.

### Option 2. Build from source

```bash
git clone https://github.com/thug-drama/panelarr.git
cd panelarr
docker compose up -d --build
```

Same endpoint (`http://localhost:8000`), same wizard. This builds the image locally instead of pulling from GHCR, useful when you want to test uncommitted changes.

### How it works

The setup wizard runs on first visit and asks for authentication preferences and service URLs (Sonarr, Radarr, qBittorrent, SABnzbd, Plex, Jellyfin, etc.). Everything is saved to `/config/panelarr.json` and editable later from Settings without a restart.

Panelarr mounts the Docker socket (`/var/run/docker.sock`) read-only so it can manage containers on the host. This is required. If you're running behind a reverse proxy, remove the `ports` mapping and add Traefik labels instead. See [docs/configuration.md](docs/configuration.md) for details.

## Supported Services

| Category | Service |
|---|---|
| ARR | Sonarr, Radarr |
| Usenet | SABnzbd, NZBGet |
| Torrents | qBittorrent, Transmission, Deluge |
| Media Servers | Plex, Jellyfin, Emby |
| Notifications | Discord, Telegram, Slack, Email (SMTP), Webhook |

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+ / FastAPI / uvicorn |
| Frontend | React 18 / Vite 6 / Tailwind CSS v4 |
| Components | Base UI React (coss/ui) |
| Data Fetching | React Query |
| Real-time | WebSockets |
| Deployment | Single Docker container, no nginx required |

The production image is a multi-stage build: Node 22 compiles the frontend to static assets, then `python:3.11-slim` serves everything from port 8000.

## Configuration

No `.env` file. All configuration lives in `panelarr.json` and is managed from the Settings page.

Four bootstrap values can be overridden via environment variables before the config file loads:

| Variable | Default | When to set it |
|---|---|---|
| `PANELARR_HOST` | `0.0.0.0` | Pin to a specific interface |
| `PANELARR_PORT` | `8000` | Non-standard port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Podman or rootless socket |
| `CONFIG_PATH` | `/config/panelarr.json` | Custom config location |

Full reference in [docs/configuration.md](docs/configuration.md): JSON schema, Traefik setup, auth mode examples.

## Development

Active work lands on `develop`; `main` is cut from `develop` at release time by the maintainer and holds tagged stable releases only. Pull requests should target `develop`, never `main`. See [CONTRIBUTING.md](CONTRIBUTING.md) for full setup, code style, branch naming, and PR process.

```bash
git clone https://github.com/thug-drama/panelarr.git
cd panelarr
pip install -e ".[dev]"
npm -C frontend install

# Terminal 1
uvicorn backend.main:app --reload

# Terminal 2
npm -C frontend run dev
```

Backend at `http://localhost:8000` (OpenAPI docs at `/docs`). Frontend at `http://localhost:5173` (proxies `/api` and `/ws` to backend).

## Roadmap

- Watch history from Plex and Jellyfin

## License

[MIT](LICENSE)
