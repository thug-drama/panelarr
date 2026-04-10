#!/bin/sh
set -e

# Detect the host Docker socket's GID and add panelarr to that group
# so the non-root user can manage containers without manual setup.
SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"
if [ -S "$SOCKET" ]; then
    SOCK_GID=$(stat -c '%g' "$SOCKET" 2>/dev/null || stat -f '%g' "$SOCKET" 2>/dev/null)
    if [ -n "$SOCK_GID" ] && [ "$SOCK_GID" != "0" ]; then
        # Create or reuse a group with the socket's GID
        if ! getent group "$SOCK_GID" >/dev/null 2>&1; then
            groupadd -g "$SOCK_GID" hostdocker
        fi
        usermod -aG "$SOCK_GID" panelarr 2>/dev/null || true
    fi
fi

# Ensure /config is writable by panelarr regardless of how the volume
# was created (root-owned named volume, bind mount, etc.)
chown -R panelarr:panelarr /config 2>/dev/null || true

# Drop to non-root and start the app
exec gosu panelarr uvicorn backend.main:app --host 0.0.0.0 --port "${PANELARR_PORT:-8000}"
