FROM node:22-slim AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci && npm cache clean --force
COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml README.md ./
RUN pip install --no-cache-dir .

COPY backend/ ./backend/
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

RUN groupadd -r panelarr && useradd -r -g panelarr panelarr \
    && mkdir -p /config \
    && chown -R panelarr:panelarr /config /app

USER panelarr

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/system/health')"

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
