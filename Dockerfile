FROM node:22-slim AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir .

COPY backend/ ./backend/
COPY --from=frontend-build /build/frontend/dist ./frontend/dist
COPY entrypoint.sh /entrypoint.sh

RUN groupadd -r panelarr && useradd -r -g panelarr panelarr \
    && mkdir -p /config \
    && chown -R panelarr:panelarr /config /app \
    && chmod +x /entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/system/health')"

ENTRYPOINT ["/entrypoint.sh"]
