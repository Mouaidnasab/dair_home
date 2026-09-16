# One image for the Raspberry Pi: FastAPI backend + the built dashboard. No Node at runtime.
#   docker buildx build --platform linux/arm64 -t dair-home .

# ---- 1. build the dashboard (runs on the build machine's native platform) ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS client
WORKDIR /src
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY client ./client
RUN pnpm run build

# ---- 2. runtime ----
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Damascus \
    DATA_DIR=/data \
    STATIC_DIR=/app/static
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/main.py backend/topology.toml ./
COPY backend/app ./app
COPY --from=client /src/dist/public ./static
RUN useradd --system --uid 1000 dair && mkdir -p /data && chown dair /data
USER dair
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=5m --timeout=5s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
