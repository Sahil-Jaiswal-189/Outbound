# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim AS node-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM ollama/ollama:0.35.1 AS ollama-cpu
# Render's CPU deployment does not need CUDA, Vulkan or JetPack payloads.
RUN find /usr/lib/ollama -mindepth 1 -maxdepth 1 -type d ! -name 'cpu*' -exec rm -rf {} +

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates python3 python3-venv supervisor libgomp1 libopenblas0 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 outbound \
    && useradd --uid 10001 --gid outbound --create-home outbound

COPY --from=node-deps /usr/local/bin/node /usr/local/bin/node

ENV PATH=/opt/venv/bin:$PATH
RUN python3 -m venv /opt/venv
COPY services/requirements-tabpfn.txt /tmp/requirements-tabpfn.txt
# Install CPU-only Torch first so pip does not pull the NVIDIA runtime.
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /tmp/requirements-tabpfn.txt

COPY --from=ollama-cpu /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama-cpu /usr/lib/ollama /usr/lib/ollama

WORKDIR /app
COPY --from=node-deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --chown=10001:10001 package.json server.mjs ./
COPY --chown=10001:10001 backend ./backend
COPY --chown=10001:10001 public ./public
COPY --chown=10001:10001 services ./services
COPY --chown=10001:10001 deploy ./deploy

ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 DATA_DIR=/var/data \
    OLLAMA_MODEL=qwen2.5:3b OLLAMA_NO_CLOUD=1 \
    OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_MAX_QUEUE=4 OLLAMA_CONTEXT_LENGTH=4096 \
    TABPFN_DEVICE=cpu TABPFN_MIN_ROWS=30 TABPFN_CACHE_SIZE=2 TABPFN_NO_BROWSER=1 \
    TABPFN_TIMEOUT_MS=90000 OLLAMA_TIMEOUT_MS=60000 \
    OMP_NUM_THREADS=2 MKL_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 \
    PYTHONUNBUFFERED=1 HF_HUB_DISABLE_TELEMETRY=1

EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -m deploy.healthcheck
ENTRYPOINT ["python", "-m", "deploy.entrypoint"]
