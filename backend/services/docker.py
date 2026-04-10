from __future__ import annotations

import asyncio
import logging
import re
import struct
from datetime import UTC, datetime

import httpx

from backend.config import settings

logger = logging.getLogger(__name__)

DOCKER_API_VERSION = "v1.44"
DOCKER_TIMEOUT = 30
STATS_TIMEOUT = 5
_MANIFEST_ACCEPT = (
    "application/vnd.docker.distribution.manifest.list.v2+json, "
    "application/vnd.docker.distribution.manifest.v2+json, "
    "application/vnd.oci.image.index.v1+json"
)


def _docker_transport() -> httpx.AsyncHTTPTransport:
    sock = settings.docker_socket
    if sock.startswith("tcp://") or sock.startswith("http://"):
        return httpx.AsyncHTTPTransport()
    return httpx.AsyncHTTPTransport(uds=sock)


def _docker_base_url() -> str:
    sock = settings.docker_socket
    if sock.startswith("tcp://"):
        return sock.replace("tcp://", "http://")
    if sock.startswith("http://"):
        return sock
    return "http://localhost"


def _docker_url(path: str) -> str:
    return f"{_docker_base_url()}/{DOCKER_API_VERSION}{path}"


def _human_uptime(started_at: str) -> str:
    """Convert ISO timestamp to human-readable uptime."""
    try:
        start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
        delta = datetime.now(UTC) - start
        days = delta.days
        hours, remainder = divmod(delta.seconds, 3600)
        minutes = remainder // 60
        if days > 0:
            return f"{days}d {hours}h {minutes}m"
        if hours > 0:
            return f"{hours}h {minutes}m"
        return f"{minutes}m"
    except (ValueError, TypeError):
        return ""


def _compute_uptime(started_at: str, raw_status: str, state: str) -> str:
    """Compute uptime from StartedAt or fall back to Docker Status field."""
    if state != "running":
        return ""
    if started_at:
        result = _human_uptime(started_at)
        if result:
            return result
    # List API returns "Up 3 days" or "Up 2 hours" in Status field
    if raw_status.lower().startswith("up "):
        return raw_status[3:].strip()
    return ""


def _format_bytes(num_bytes: int | float) -> str:
    """Format bytes to human-readable string."""
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if abs(num_bytes) < 1024:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f} PiB"


def _calc_cpu_pct(stats: dict) -> float:
    """Calculate CPU % from Docker stats response."""
    try:
        cpu_delta = (
            stats["cpu_stats"]["cpu_usage"]["total_usage"]
            - stats["precpu_stats"]["cpu_usage"]["total_usage"]
        )
        system_delta = (
            stats["cpu_stats"]["system_cpu_usage"] - stats["precpu_stats"]["system_cpu_usage"]
        )
        num_cpus = stats["cpu_stats"].get("online_cpus", 1)
        if system_delta > 0 and cpu_delta >= 0:
            return round((cpu_delta / system_delta) * num_cpus * 100, 2)
    except (KeyError, TypeError, ZeroDivisionError):
        pass
    return 0.0


def _extract_public_urls(labels: dict) -> list[dict]:
    """Extract public URLs from reverse proxy labels (Traefik, Caddy, nginx-proxy, custom)."""
    urls: list[dict] = []
    seen: set[str] = set()

    # Traefik: traefik.http.routers.{name}.rule = Host(`domain`)
    entrypoints: dict[str, str] = {}
    rules: dict[str, str] = {}
    tls_routers: set[str] = set()
    for key, value in labels.items():
        if not key.startswith("traefik.http.routers."):
            continue
        parts = key.split(".")
        if len(parts) < 5:
            continue
        router_name = parts[3]
        suffix = ".".join(parts[4:])
        if suffix == "rule":
            rules[router_name] = value
        elif suffix == "entrypoints":
            entrypoints[router_name] = value
        elif suffix.startswith("tls"):
            tls_routers.add(router_name)

    for router_name, rule in rules.items():
        hosts = re.findall(r"Host\(`([^`]+)`\)", rule)
        ep = entrypoints.get(router_name, "")
        has_tls = router_name in tls_routers
        is_https = has_tls or "websecure" in ep or "https" in ep
        protocol = "https" if is_https else "http"
        for host in hosts:
            url = f"{protocol}://{host}"
            if url not in seen:
                urls.append({"url": url, "source": "traefik"})
                seen.add(url)

    # Caddy: caddy=domain or caddy_0=domain
    for key, value in labels.items():
        if key == "caddy" or key.startswith("caddy_"):
            domain = value.strip()
            if domain and not domain.startswith("http"):
                url = f"https://{domain}"
            else:
                url = domain
            if url and url not in seen:
                urls.append({"url": url, "source": "caddy"})
                seen.add(url)

    # nginx-proxy: VIRTUAL_HOST=domain
    vhost = labels.get("VIRTUAL_HOST", "")
    if vhost:
        for host in vhost.split(","):
            host = host.strip()
            if host:
                url = f"http://{host}"
                if url not in seen:
                    urls.append({"url": url, "source": "nginx-proxy"})
                    seen.add(url)

    # Custom: panelarr.url=https://...
    custom_url = labels.get("panelarr.url", "")
    if custom_url and custom_url not in seen:
        urls.append({"url": custom_url, "source": "custom"})
        seen.add(custom_url)

    return urls


def _parse_container(container: dict, stats: dict | None = None) -> dict:
    """Parse Docker API container + optional stats into our response shape."""
    state = container.get("State", "unknown")
    if isinstance(state, dict):
        status_text = state.get("Status", "unknown")
        started_at = state.get("StartedAt", "")
    else:
        status_text = state
        started_at = ""

    name = container.get("Name", "").lstrip("/")
    if not name:
        names = container.get("Names", [])
        name = names[0].lstrip("/") if names else container.get("Id", "")[:12]

    ports = {}
    for p in container.get("Ports", []):
        private = p.get("PrivatePort")
        public = p.get("PublicPort")
        if private:
            ports[f"{private}/tcp"] = public or private

    cpu_pct = 0.0
    mem_usage = "0 MiB"
    mem_limit = "0 MiB"
    if stats:
        cpu_pct = _calc_cpu_pct(stats)
        mem_stats = stats.get("memory_stats", {})
        mem_usage = _format_bytes(mem_stats.get("usage", 0))
        mem_limit = _format_bytes(mem_stats.get("limit", 0))

    restart_count = 0
    host_config = container.get("HostConfig", {})
    if isinstance(host_config, dict):
        restart_policy = host_config.get("RestartPolicy", {})
        if isinstance(restart_policy, dict):
            restart_count = restart_policy.get("MaximumRetryCount", 0)
    state_obj = container.get("State", {})
    if isinstance(state_obj, dict):
        restart_count = state_obj.get("RestartCount", restart_count)

    # Resolve human-readable image name, multiple fallback sources
    image = container.get("Image", "")
    labels = container.get("Labels", {}) or {}
    config_obj = container.get("Config", {}) if isinstance(container.get("Config"), dict) else {}

    # Priority: Compose label > Config.Image > OCI label > top-level Image
    compose_image = labels.get("com.docker.compose.image", "")
    config_image = config_obj.get("Image", "")

    if compose_image and not compose_image.startswith("sha256:"):
        image = compose_image
    elif config_image and not config_image.startswith("sha256:"):
        image = config_image
    elif image.startswith("sha256:"):
        oci_title = labels.get("org.opencontainers.image.title", "")
        if oci_title:
            image = oci_title
        else:
            image = image[:19] + "..."

    return {
        "id": container.get("Id", "")[:12],
        "name": name,
        "image": image,
        "status": container.get("Status", status_text),
        "state": status_text if isinstance(status_text, str) else "unknown",
        "ports": ports,
        "created": container.get("Created", ""),
        "uptime": _compute_uptime(started_at, container.get("Status", ""), status_text),
        "cpu_percent": cpu_pct,
        "memory_usage": mem_usage,
        "memory_limit": mem_limit,
        "restart_count": restart_count,
        "urls": _extract_public_urls(container.get("Labels", {})),
    }


async def _fetch_stats(client: httpx.AsyncClient, container_id: str) -> dict | None:
    """Fetch stats for a single container. Returns None on error."""
    try:
        resp = await client.get(
            _docker_url(f"/containers/{container_id}/stats"),
            params={"stream": "false"},
            timeout=STATS_TIMEOUT,
        )
        if resp.status_code == 200:
            return resp.json()
    except (httpx.TimeoutException, httpx.ConnectError):
        pass
    return None


async def list_containers(show_all: bool = True) -> list[dict]:
    """List all Docker containers with stats."""
    async with httpx.AsyncClient(transport=_docker_transport(), timeout=DOCKER_TIMEOUT) as client:
        resp = await client.get(
            _docker_url("/containers/json"),
            params={"all": str(show_all).lower()},
        )
        resp.raise_for_status()
        containers = resp.json()

        running_ids = [c["Id"] for c in containers if c.get("State") == "running"]

        stats_map: dict[str, dict | None] = {}
        if running_ids:
            results = await asyncio.gather(
                *[_fetch_stats(client, cid) for cid in running_ids],
                return_exceptions=True,
            )
            for cid, result in zip(running_ids, results):
                stats_map[cid] = result if isinstance(result, dict) else None

        return [_parse_container(c, stats_map.get(c["Id"])) for c in containers]


async def get_container(name_or_id: str) -> dict | None:
    """Get a single container by name or ID."""
    async with httpx.AsyncClient(transport=_docker_transport(), timeout=DOCKER_TIMEOUT) as client:
        resp = await client.get(_docker_url(f"/containers/{name_or_id}/json"))
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        container = resp.json()

        stats = None
        state = container.get("State", {})
        if isinstance(state, dict) and state.get("Running"):
            stats = await _fetch_stats(client, container["Id"])

        return _parse_container(container, stats)


ALLOWED_ACTIONS = frozenset({"start", "stop", "restart"})
PULL_TIMEOUT = 300  # 5 minutes for image pulls


async def pull_and_recreate(name_or_id: str) -> dict:
    """Pull the latest image and fully recreate the container.

    Watchtower-style update: inspect → pull → stop → remove → create → start → reconnect networks.
    Preserves all config: env vars, volumes, ports, labels, restart policy, networks.

    NOTE: Do NOT call this from within the container being updated. The stop step
    will kill the running process before the new container can be started, leaving
    the service down. Use self_update() instead, which delegates the destructive
    steps to an ephemeral Docker CLI sidecar container so the swap happens after
    the HTTP response has been sent.
    """
    try:
        async with httpx.AsyncClient(transport=_docker_transport(), timeout=PULL_TIMEOUT) as client:
            # 1. Inspect the running container to capture full config
            inspect_resp = await client.get(_docker_url(f"/containers/{name_or_id}/json"))
            if inspect_resp.status_code == 404:
                return {"status": "error", "message": "Container not found"}
            inspect_resp.raise_for_status()
            old = inspect_resp.json()

            config = old.get("Config", {})
            host_config = old.get("HostConfig", {})
            network_settings = old.get("NetworkSettings", {})
            container_name = old.get("Name", "").lstrip("/")
            image = config.get("Image", "")

            if not image:
                return {"status": "error", "message": "Cannot determine container image"}

            # 2. Pull the latest image
            logger.info("Pulling image %s for container %s", image, container_name)
            pull_resp = await client.post(
                _docker_url("/images/create"),
                params={"fromImage": image},
            )
            if pull_resp.status_code not in (200, 204):
                return {"status": "error", "message": f"Pull failed: HTTP {pull_resp.status_code}"}

            # 3. Stop the old container
            await client.post(
                _docker_url(f"/containers/{old['Id']}/stop"),
                params={"t": "10"},
            )

            # 4. Remove the old container
            rm_resp = await client.delete(
                _docker_url(f"/containers/{old['Id']}"),
                params={"force": "true"},
            )
            if rm_resp.status_code not in (200, 204):
                return {
                    "status": "error",
                    "message": "Failed to remove old container, it may need manual cleanup",
                }

            # 5. Build the create payload from the old container's config
            if host_config.get("Privileged"):
                logger.warning(
                    "Container %s has Privileged=true, recreating with same privileges",
                    container_name,
                )
            create_body: dict = {
                **config,
                "HostConfig": host_config,
            }

            # Attach to the same networks
            networks = network_settings.get("Networks", {})
            if networks:
                networking_config: dict = {"EndpointsConfig": {}}
                for net_name, net_config in networks.items():
                    networking_config["EndpointsConfig"][net_name] = {
                        "IPAMConfig": net_config.get("IPAMConfig"),
                        "Aliases": net_config.get("Aliases"),
                    }
                create_body["NetworkingConfig"] = networking_config

            # 6. Create the new container with the same name
            create_resp = await client.post(
                _docker_url("/containers/create"),
                params={"name": container_name},
                json=create_body,
            )
            if create_resp.status_code not in (200, 201):
                error_body = create_resp.text
                logger.warning("Container create failed: %s", error_body[:200])
                return {
                    "status": "error",
                    "message": "Failed to create container, check server logs",
                }
            new_id = create_resp.json().get("Id", "")

            # 7. Connect to additional networks (create only connects to the first)
            for net_name in list(networks.keys())[1:]:
                net_config = networks[net_name]
                await client.post(
                    _docker_url(f"/networks/{net_name}/connect"),
                    json={
                        "Container": new_id,
                        "EndpointConfig": {
                            "IPAMConfig": net_config.get("IPAMConfig"),
                            "Aliases": net_config.get("Aliases"),
                        },
                    },
                )

            # 8. Start the new container
            start_resp = await client.post(_docker_url(f"/containers/{new_id}/start"))
            if start_resp.status_code not in (200, 204):
                return {
                    "status": "partial",
                    "message": "Container recreated but failed to start",
                }

            logger.info("Container %s updated successfully", container_name)
            return {
                "status": "ok",
                "message": f"Updated {container_name}, pulled, recreated, and started",
                "image": image,
            }
    except httpx.TimeoutException:
        return {"status": "error", "message": "Pull timed out, image may be very large"}
    except Exception:
        logger.exception("Container update failed for %s", name_or_id)
        return {"status": "error", "message": "Container update failed, check server logs"}


async def self_update() -> dict:
    """Safely update the panelarr container from within itself.

    The fundamental problem with self-updating is that the process doing the
    update lives inside the container being replaced. A naive
    stop → remove → create → start sequence kills the executing process at the
    stop step, so the create and start steps never run, leaving the service
    permanently down.

    Why other approaches fail
    -------------------------
    * **Blue/green port swap** – the new container cannot bind port 8000 while
      the old one is still running.
    * **docker update** – the Docker Engine API's POST /containers/{id}/update
      only changes resource limits; you cannot change the image in place.
    * **Kill PID 1 + restart policy** – Docker's restart policy reuses the image
      layer the container was *created* from, not any newly pulled image, so the
      same old version comes back.
    * **Rename + create** – still has the port conflict problem during the
      window where both containers exist.

    The correct approach: ephemeral sidecar container
    -------------------------------------------------
    Pull the new image first (so it is cached locally, same as what the new
    container will use). Then spawn a one-shot ephemeral ``docker:cli`` container
    via the Docker socket. That sidecar runs entirely outside of the panelarr
    process tree; it outlives panelarr, performs the stop/rm/create/start
    sequence, and then exits. The sidecar has no port bindings, no name
    conflicts, and its only dependency is the Docker socket.

    The sequence inside the sidecar shell script:
        docker stop panelarr
        docker rm panelarr
        docker create --name panelarr <all original flags reconstructed>
        docker network connect <extra networks>
        docker start panelarr
        docker rm sidecar (self-cleanup via --rm flag)

    This is the same mechanism Watchtower uses when updating itself: it
    schedules a lifecycle hook that runs as an external process.

    After returning ``{"status": "updating"}`` the frontend should poll
    ``GET /api/system/health`` until it gets a 200 response with the new
    version, then reload.
    """
    try:
        async with httpx.AsyncClient(transport=_docker_transport(), timeout=PULL_TIMEOUT) as client:
            # ── 1. Inspect ourselves ─────────────────────────────────────────────
            # We identify our own container by the name "panelarr" (set in
            # docker-compose.yml via container_name). Using the name is robust
            # because the container ID changes on every recreation.
            inspect_resp = await client.get(_docker_url("/containers/panelarr/json"))
            if inspect_resp.status_code == 404:
                return {
                    "status": "error",
                    "message": "Container 'panelarr' not found — is container_name set?",
                }
            inspect_resp.raise_for_status()
            old = inspect_resp.json()

            config = old.get("Config", {})
            host_config = old.get("HostConfig", {})
            network_settings = old.get("NetworkSettings", {})
            container_name = old.get("Name", "").lstrip("/")
            image = config.get("Image", "")

            if not image:
                return {"status": "error", "message": "Cannot determine container image"}

            # ── 2. Pull the new image ────────────────────────────────────────────
            # Pull via the Engine API (not docker CLI) so we get the image layer
            # cached locally before we touch the running container. If the pull
            # fails we abort early — the running container is untouched.
            logger.info("self_update: pulling %s", image)
            pull_resp = await client.post(
                _docker_url("/images/create"),
                params={"fromImage": image},
                timeout=PULL_TIMEOUT,
            )
            if pull_resp.status_code not in (200, 204):
                return {
                    "status": "error",
                    "message": f"Image pull failed: HTTP {pull_resp.status_code}",
                }
            logger.info("self_update: pull complete for %s", image)

            # ── 3. Build the docker-run argv for the recreated panelarr container ─
            # We reconstruct the full set of flags from the inspect output so the
            # new container is identical to the old one. The sidecar will pass
            # these to ``docker run`` / ``docker create`` + ``docker start``.
            argv: list[str] = ["docker", "create", "--name", container_name]

            # Restart policy
            restart_policy = host_config.get("RestartPolicy", {})
            rp_name = restart_policy.get("Name", "")
            if rp_name and rp_name != "no":
                max_retry = restart_policy.get("MaximumRetryCount", 0)
                if rp_name == "on-failure" and max_retry:
                    argv += ["--restart", f"on-failure:{max_retry}"]
                else:
                    argv += ["--restart", rp_name]

            # Environment variables
            for env_var in config.get("Env") or []:
                argv += ["--env", env_var]

            # Volume binds
            for bind in host_config.get("Binds") or []:
                argv += ["--volume", bind]

            # Named volumes (Mounts with type=volume)
            for mount in host_config.get("Mounts") or []:
                if mount.get("Type") == "volume":
                    src = mount.get("Source") or mount.get("Name", "")
                    dst = mount.get("Destination", "")
                    mode = "ro" if mount.get("ReadOnly") else "rw"
                    if src and dst:
                        argv += ["--volume", f"{src}:{dst}:{mode}"]

            # Port bindings
            port_bindings = host_config.get("PortBindings") or {}
            for container_port, host_bindings in port_bindings.items():
                for hb in host_bindings or []:
                    host_ip = hb.get("HostIp", "")
                    host_port = hb.get("HostPort", "")
                    if host_ip:
                        argv += ["--publish", f"{host_ip}:{host_port}:{container_port}"]
                    else:
                        argv += ["--publish", f"{host_port}:{container_port}"]

            # Labels
            for k, v in (config.get("Labels") or {}).items():
                argv += ["--label", f"{k}={v}"]

            # Capabilities
            for cap in host_config.get("CapAdd") or []:
                argv += ["--cap-add", cap]
            for cap in host_config.get("CapDrop") or []:
                argv += ["--cap-drop", cap]

            # Memory / CPU limits (docker create flags)
            mem_limit = host_config.get("Memory", 0)
            if mem_limit:
                argv += ["--memory", str(mem_limit)]
            nano_cpus = host_config.get("NanoCpus", 0)
            if nano_cpus:
                # NanoCPUs → fractional CPUs string (e.g. 1000000000 → "1.0")
                argv += ["--cpus", str(nano_cpus / 1_000_000_000)]

            # tmpfs mounts
            for tmpfs_path in (host_config.get("Tmpfs") or {}).keys():
                argv += ["--tmpfs", tmpfs_path]

            # Privileged (preserve if set, though Panelarr drops this)
            if host_config.get("Privileged"):
                argv.append("--privileged")

            # Healthcheck (pass through if defined in the container)
            healthcheck = config.get("Healthcheck") or {}
            hc_test = healthcheck.get("Test") or []
            if hc_test and hc_test[0] not in ("NONE", ""):
                # hc_test is ["CMD", ...] or ["CMD-SHELL", "..."]
                hc_cmd = " ".join(hc_test[1:]) if hc_test[0] == "CMD-SHELL" else None
                if hc_cmd:
                    argv += ["--health-cmd", hc_cmd]
                interval_ns = healthcheck.get("Interval", 0)
                timeout_ns = healthcheck.get("Timeout", 0)
                retries = healthcheck.get("Retries", 0)
                start_ns = healthcheck.get("StartPeriod", 0)
                if interval_ns:
                    argv += ["--health-interval", f"{interval_ns // 1_000_000}ms"]
                if timeout_ns:
                    argv += ["--health-timeout", f"{timeout_ns // 1_000_000}ms"]
                if retries:
                    argv += ["--health-retries", str(retries)]
                if start_ns:
                    argv += ["--health-start-period", f"{start_ns // 1_000_000}ms"]

            # Image must be last before any CMD override
            argv.append(image)

            # ── 4. Build extra network-connect commands ───────────────────────────
            # ``docker create`` only attaches to the first network specified via
            # --network. We emit additional ``docker network connect`` calls for
            # any extra networks so the sidecar can run them after the create.
            networks = network_settings.get("Networks", {})
            net_names = list(networks.keys())

            # Attach the first network during create (avoids a separate connect call)
            if net_names:
                argv = argv[:-1] + ["--network", net_names[0], argv[-1]]

            extra_network_cmds: list[list[str]] = []
            for net_name in net_names[1:]:
                extra_network_cmds.append(
                    ["docker", "network", "connect", net_name, container_name]
                )

            # ── 5. Build the sidecar shell script ───────────────────────────────
            # The script:
            #   a) waits a moment so the HTTP response can be flushed to the client
            #   b) stops and removes the old panelarr container
            #   c) creates the new one with the reconstructed argv
            #   d) connects extra networks
            #   e) starts it
            #
            # The sidecar container itself is started with --rm so Docker removes
            # it automatically when the script exits.
            create_cmd = " ".join(_shell_quote(a) for a in argv)
            extra_net_lines = "\n".join(
                " ".join(_shell_quote(a) for a in cmd) for cmd in extra_network_cmds
            )
            script = (
                "set -e\n"
                "sleep 2\n"
                f"docker stop --time 10 {_shell_quote(container_name)}\n"
                f"docker rm {_shell_quote(container_name)}\n"
                f"{create_cmd}\n"
                f"{extra_net_lines}\n"
                f"docker start {_shell_quote(container_name)}\n"
            )

            # 6. Ensure the sidecar image is available locally
            logger.info("self_update: pulling docker:cli sidecar image")
            cli_pull = await client.post(
                _docker_url("/images/create"),
                params={"fromImage": "docker", "tag": "cli"},
                timeout=60,
            )
            if cli_pull.status_code not in (200, 201):
                logger.warning("self_update: docker:cli pull returned %s", cli_pull.status_code)

            # 7. Launch the ephemeral sidecar
            sidecar_name = f"panelarr-updater-{int(asyncio.get_event_loop().time())}"
            sock = settings.docker_socket
            if sock.startswith("tcp://") or sock.startswith("http://"):
                # TCP socket proxy: sidecar connects via DOCKER_HOST env var
                sidecar_host_config: dict = {
                    "AutoRemove": True,
                    "NetworkMode": "host",
                }
                sidecar_env = [f"DOCKER_HOST={sock}"]
            else:
                # Unix socket: mount it into the sidecar
                sidecar_host_config = {
                    "AutoRemove": True,
                    "Binds": [f"{sock}:/var/run/docker.sock"],
                    "NetworkMode": "none",
                }
                sidecar_env = []

            sidecar_body: dict = {
                "Image": "docker:cli",
                "Cmd": ["/bin/sh", "-c", script],
                "Env": sidecar_env,
                "HostConfig": sidecar_host_config,
            }

            logger.info("self_update: launching sidecar %s", sidecar_name)
            create_resp = await client.post(
                _docker_url("/containers/create"),
                params={"name": sidecar_name},
                json=sidecar_body,
                timeout=30,
            )
            if create_resp.status_code not in (200, 201):
                logger.error(
                    "self_update: sidecar create failed %s: %s",
                    create_resp.status_code,
                    create_resp.text[:200],
                )
                return {
                    "status": "error",
                    "message": "Failed to create updater sidecar — update aborted",
                }

            sidecar_id = create_resp.json().get("Id", "")
            start_resp = await client.post(
                _docker_url(f"/containers/{sidecar_id}/start"),
                timeout=10,
            )
            if start_resp.status_code not in (200, 204):
                # Clean up the stranded sidecar
                await client.delete(
                    _docker_url(f"/containers/{sidecar_id}"),
                    params={"force": "true"},
                    timeout=10,
                )
                return {
                    "status": "error",
                    "message": "Failed to start updater sidecar — update aborted",
                }

            logger.info(
                "self_update: sidecar %s started; panelarr will be replaced in ~2 s",
                sidecar_name,
            )
            # Return immediately. The sidecar will stop and recreate this container
            # in ~2 seconds. The frontend polls /api/system/health until it gets
            # a 200 with the new version, then reloads.
            return {
                "status": "updating",
                "message": (
                    "Update in progress. Panelarr will restart in a few seconds. "
                    "The UI will reload automatically when the new version is ready."
                ),
                "image": image,
            }

    except httpx.TimeoutException:
        return {"status": "error", "message": "Image pull timed out — update aborted"}
    except Exception:
        logger.exception("self_update failed")
        return {"status": "error", "message": "Self-update failed — check server logs"}


def _shell_quote(s: str) -> str:
    """Minimal shell single-quote escaping for embedding in a sh -c script."""
    return "'" + s.replace("'", "'\\''") + "'"


async def container_action(name_or_id: str, action: str) -> dict:
    """Perform an action (start/stop/restart) on a container."""
    if action not in ALLOWED_ACTIONS:
        return {"status": "error", "message": f"Invalid action: {action}"}
    async with httpx.AsyncClient(transport=_docker_transport(), timeout=DOCKER_TIMEOUT) as client:
        resp = await client.post(_docker_url(f"/containers/{name_or_id}/{action}"))
        if resp.status_code == 404:
            return {"status": "error", "message": "Container not found"}
        if resp.status_code in (204, 304):
            return {"status": "ok", "container": name_or_id, "action": action}
        resp.raise_for_status()
        return {"status": "ok", "container": name_or_id, "action": action}


def _parse_docker_log_stream(data: bytes) -> list[str]:
    """Parse Docker multiplexed log stream into lines."""
    lines: list[str] = []
    offset = 0
    while offset < len(data):
        if offset + 8 > len(data):
            remaining = data[offset:].decode("utf-8", errors="replace").strip()
            if remaining:
                lines.extend(remaining.splitlines())
            break
        header = data[offset : offset + 8]
        _stream_type = header[0]
        frame_size = struct.unpack(">I", header[4:8])[0]
        offset += 8
        if frame_size == 0:
            continue
        if offset + frame_size > len(data):
            frame = data[offset:]
        else:
            frame = data[offset : offset + frame_size]
        text = frame.decode("utf-8", errors="replace").rstrip("\n")
        if text:
            lines.extend(text.splitlines())
        offset += frame_size
    return lines


async def get_container_logs(name_or_id: str, lines: int = 200) -> list[str]:
    """Get last N log lines from a container."""
    async with httpx.AsyncClient(transport=_docker_transport(), timeout=DOCKER_TIMEOUT) as client:
        tty = await _is_tty_container(client, name_or_id)
        resp = await client.get(
            _docker_url(f"/containers/{name_or_id}/logs"),
            params={
                "stdout": "true",
                "stderr": "true",
                "tail": str(lines),
                "timestamps": "true" if not tty else "false",
            },
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        if tty:
            # TTY: raw text, no multiplexing
            text = resp.content.decode("utf-8", errors="replace")
            return [line for line in text.splitlines() if line.strip()]
        return _parse_docker_log_stream(resp.content)


async def _is_tty_container(client: httpx.AsyncClient, name_or_id: str) -> bool:
    """Check if a container has TTY enabled (affects log format)."""
    try:
        resp = await client.get(_docker_url(f"/containers/{name_or_id}/json"))
        if resp.status_code == 200:
            config = resp.json().get("Config", {})
            return config.get("Tty", False)
    except Exception:
        pass
    return False


async def stream_container_logs(name_or_id: str):
    """Async generator yielding live log lines from a container."""
    async with httpx.AsyncClient(transport=_docker_transport(), timeout=None) as client:
        tty = await _is_tty_container(client, name_or_id)
        async with client.stream(
            "GET",
            _docker_url(f"/containers/{name_or_id}/logs"),
            params={
                "stdout": "true",
                "stderr": "true",
                "follow": "true",
                "tail": "50",
                "timestamps": "true" if not tty else "false",
            },
        ) as resp:
            if tty:
                # TTY containers send raw text, not multiplexed frames
                async for chunk in resp.aiter_bytes():
                    text = chunk.decode("utf-8", errors="replace")
                    for line in text.splitlines():
                        if line.strip():
                            yield line
            else:
                # Non-TTY: multiplexed Docker log format
                buffer = b""
                async for chunk in resp.aiter_bytes():
                    buffer += chunk
                    while len(buffer) >= 8:
                        frame_size = struct.unpack(">I", buffer[4:8])[0]
                        total = 8 + frame_size
                        if len(buffer) < total:
                            break
                        frame = buffer[8:total]
                        buffer = buffer[total:]
                        text = frame.decode("utf-8", errors="replace").rstrip("\n")
                        for line in text.splitlines():
                            if line:
                                yield line


async def get_docker_version() -> dict | None:
    """Get Docker engine version info."""
    try:
        async with httpx.AsyncClient(
            transport=_docker_transport(), timeout=DOCKER_TIMEOUT
        ) as client:
            resp = await client.get(_docker_url("/version"))
            resp.raise_for_status()
            return resp.json()
    except (httpx.ConnectError, httpx.TimeoutException):
        return None


def _parse_image_ref(image: str) -> tuple[str, str, str]:
    """Parse image string into (registry, repository, tag).

    Examples:
        lscr.io/linuxserver/sonarr:latest -> (lscr.io, linuxserver/sonarr, latest)
        ghcr.io/org/app:v1 -> (ghcr.io, org/app, v1)
        nginx:latest -> (registry-1.docker.io, library/nginx, latest)
        myapp -> (registry-1.docker.io, library/myapp, latest)
    """
    tag = "latest"
    if ":" in image and not image.rsplit(":", 1)[1].count("/"):
        image, tag = image.rsplit(":", 1)
    # Remove sha256 digest if present
    if "@" in image:
        image = image.split("@")[0]

    parts = image.split("/")
    if len(parts) == 1:
        return ("registry-1.docker.io", f"library/{parts[0]}", tag)
    if len(parts) == 2 and "." not in parts[0] and ":" not in parts[0]:
        return ("registry-1.docker.io", image, tag)
    registry = parts[0]
    repo = "/".join(parts[1:])
    return (registry, repo, tag)


async def _check_single_container_update(
    container: dict,
    docker: httpx.AsyncClient,
    registry_client: httpx.AsyncClient,
) -> tuple[str, dict] | None:
    """Check a single container for an available image update.

    Returns (name, result_dict) or None if the container should be skipped.
    """
    name = container.get("name", "")
    image = container.get("image", "")
    if not image:
        return None

    reg, repo, tag = _parse_image_ref(image)
    try:
        # Get local image digest from Docker
        img_resp = await docker.get(_docker_url(f"/images/{image}/json"))
        if img_resp.status_code != 200:
            return None
        img_data = img_resp.json()
        local_digests = img_data.get("RepoDigests", [])
        local_digest = ""
        for d in local_digests:
            if "@sha256:" in d:
                local_digest = d.split("@")[1]
                break

        # Query remote registry for latest digest via v2 manifest HEAD request
        if reg == "registry-1.docker.io":
            # Docker Hub requires a token
            token_resp = await registry_client.get(
                f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull",
            )
            if token_resp.status_code != 200:
                return None
            token = token_resp.json().get("token", "")
            manifest_resp = await registry_client.head(
                f"https://registry-1.docker.io/v2/{repo}/manifests/{tag}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": _MANIFEST_ACCEPT,
                },
            )
        elif reg == "ghcr.io":
            manifest_resp = await registry_client.head(
                f"https://ghcr.io/v2/{repo}/manifests/{tag}",
                headers={"Accept": _MANIFEST_ACCEPT},
            )
        else:
            # Generic v2 registry (lscr.io, etc.)
            manifest_resp = await registry_client.head(
                f"https://{reg}/v2/{repo}/manifests/{tag}",
                headers={"Accept": _MANIFEST_ACCEPT},
            )

        remote_digest = manifest_resp.headers.get("docker-content-digest", "")
        has_update = bool(local_digest and remote_digest and local_digest != remote_digest)

        return (
            name,
            {
                "has_update": has_update,
                "local_digest": local_digest[:19] if local_digest else "",
                "remote_digest": remote_digest[:19] if remote_digest else "",
                "image": image,
            },
        )
    except Exception:
        logger.debug("Update check failed for %s", name)
        return None


async def check_container_updates(containers: list[dict]) -> dict[str, dict]:
    """Check each container's image for available updates concurrently.

    Compares local image digest against remote registry using Docker v2 API.
    Returns {container_name: {"has_update": bool, "local_digest": str, "remote_digest": str}}.
    """
    results: dict[str, dict] = {}
    async with httpx.AsyncClient(transport=_docker_transport(), timeout=DOCKER_TIMEOUT) as docker:
        async with httpx.AsyncClient(timeout=10) as registry_client:
            outcomes = await asyncio.gather(
                *[_check_single_container_update(c, docker, registry_client) for c in containers],
                return_exceptions=True,
            )
            for outcome in outcomes:
                if isinstance(outcome, tuple):
                    name, result = outcome
                    results[name] = result

    return results
