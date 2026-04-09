# Configuration

Panelarr is configured through the web UI. On first start the setup wizard walks through authentication, service connections, notifications, and disk monitoring. Everything is saved to `/config/panelarr.json`.

There is no `.env` file. A fresh install is just `docker compose up -d` followed by finishing the wizard.

## Bootstrap Environment Variables

A handful of values need to be available before `panelarr.json` can be read, so they come from the environment. All four have defaults that match the official Docker image; you only need to set them to override those defaults.

| Variable | Default | When to set it |
|---|---|---|
| `PANELARR_HOST` | `0.0.0.0` | Pin the backend to a specific interface |
| `PANELARR_PORT` | `8000` | Run on a non-standard port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Non-standard Docker socket path |
| `CONFIG_PATH` | `/config/panelarr.json` | Store the config file elsewhere |

Set them under `environment:` in `docker-compose.yml`:

```yaml
services:
  panelarr:
    image: panelarr:latest
    environment:
      - PANELARR_PORT=9000
      - DOCKER_SOCKET=/var/run/podman.sock
```

## What Lives in the UI

Everything below is configured through the setup wizard or the Settings page and persists across container rebuilds.

| Area | Where to set it |
|---|---|
| Authentication (none / basic / proxy / apikey) | Setup wizard, or Settings → Authentication |
| Sonarr / Radarr / SABnzbd / qBittorrent / Plex / Jellyfin | Settings → service cards |
| Notification channels (Discord, Telegram, Slack, Email/SMTP, webhook) | Settings → Notifications |
| Notification rules | Settings → Notifications |
| Disks to monitor | Settings → Disks to Monitor |
| Disk warning / critical thresholds | Settings → Alerts & Thresholds |
| Watchdog stall threshold | Settings → Alerts & Thresholds |

## JSON Config File

The wizard and Settings page save to `/config/panelarr.json`. The schema:

```json
{
  "services": {
    "sonarr":      { "url": "http://sonarr:8989",      "api_key": "..." },
    "radarr":      { "url": "http://radarr:7878",      "api_key": "..." },
    "sabnzbd":     { "url": "http://sabnzbd:8080",     "api_key": "..." },
    "qbittorrent": { "url": "http://qbittorrent:8080", "username": "...", "password": "..." },
    "plex":        { "url": "http://plex:32400",       "token": "..." },
    "jellyfin":    { "url": "http://jellyfin:8096",    "api_key": "..." }
  },
  "notifications": {
    "channels": [],
    "rules": []
  },
  "thresholds": {
    "disk_warn_pct": 85,
    "disk_crit_pct": 90,
    "watchdog_threshold_hours": 2,
    "disks": []
  },
  "auth": {
    "mode": "basic",
    "username": "admin",
    "password_hash": "...",
    "secret": "...",
    "proxy_header": "Remote-User",
    "api_key": "..."
  },
  "setup": {
    "completed_at": "2025-01-01T00:00:00Z",
    "version": "0.1.0-alpha"
  }
}
```

API keys and passwords are masked when returned by `GET /api/config` (last 4 characters only). The `auth` block is stripped entirely from that response; non-secret auth metadata is exposed via `GET /api/auth/status` instead.

Mount the config directory so it survives rebuilds:

```yaml
volumes:
  - /opt/panelarr/config:/config
```

## Traefik

By default Panelarr listens on port 8000. The shipped `docker-compose.yml` maps it to the host with `ports: ["8000:8000"]`.

When running behind Traefik:

1. Put Panelarr on the same Docker network as Traefik.
2. Remove the `ports` mapping (Traefik routes internally; keeping it open bypasses Traefik).

### Generic Traefik

```yaml
services:
  panelarr:
    build: .
    container_name: panelarr
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/panelarr/config:/config
    restart: unless-stopped
    networks:
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.panelarr.rule=Host(`panelarr.your-domain.com`)"
      - "traefik.http.routers.panelarr.entrypoints=websecure"
      - "traefik.http.routers.panelarr.tls.certresolver=letsencrypt"
      - "traefik.http.services.panelarr.loadbalancer.server.port=8000"

networks:
  traefik:
    external: true
```

Replace `traefik` with your Traefik network name.

### Saltbox

Saltbox runs Traefik on a network called `saltbox`:

```yaml
services:
  panelarr:
    build: .
    container_name: panelarr
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/panelarr/config:/config
    restart: unless-stopped
    networks:
      - saltbox
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.panelarr.rule=Host(`panelarr.your-domain.com`)"
      - "traefik.http.routers.panelarr.entrypoints=websecure"
      - "traefik.http.routers.panelarr.tls.certresolver=letsencrypt"
      - "traefik.http.services.panelarr.loadbalancer.server.port=8000"

networks:
  saltbox:
    external: true
```

## Authentication

Set the auth mode in the setup wizard or under Settings → Authentication. Default is `none`.

### none

No authentication. All endpoints are public. Use this on a trusted LAN or when your reverse proxy handles auth.

### basic

Built-in username/password with JWT session cookies. Login page at `/login`. Sessions last 24 hours. The JWT signing secret is generated on first start and saved to `auth.secret` in `panelarr.json`.

### proxy

Trusts a header set by an upstream proxy. Panelarr reads the authenticated username from it. The wizard auto-detects common providers and suggests the right header name.

Common headers:

| Proxy | Header |
|---|---|
| Authelia | `Remote-User` |
| Authentik | `X-authentik-username` |
| oauth2-proxy | `X-Auth-Request-User` |
| Cloudflare Access | `Cf-Access-Authenticated-User-Email` |
| Tailscale Serve | `Tailscale-User-Login` |

### apikey

Requires an `X-Api-Key` header on all API requests. Generate or rotate the key under Settings → Authentication, or via `POST /api/auth/apikey/regenerate`.

### Saltbox with Traefik + Authelia

```yaml
services:
  panelarr:
    build: .
    container_name: panelarr
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/panelarr/config:/config
    restart: unless-stopped
    networks:
      - saltbox
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.panelarr.rule=Host(`panelarr.your-domain.com`)"
      - "traefik.http.routers.panelarr.entrypoints=websecure"
      - "traefik.http.routers.panelarr.tls.certresolver=letsencrypt"
      - "traefik.http.services.panelarr.loadbalancer.server.port=8000"
      - "traefik.http.routers.panelarr.middlewares=authelia@docker"

networks:
  saltbox:
    external: true
```

After the container starts, open the wizard and pick Reverse Proxy as the auth mode. Panelarr will detect Authelia's `Remote-User` header automatically.
