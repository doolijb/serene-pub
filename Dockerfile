# ============================================================
# Stage 1 — Build
# ============================================================
FROM node:24-alpine AS builder

WORKDIR /app

# Install deps first (layer-cached until package files change)
COPY package.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Prune to production-only node_modules
RUN npm prune --production

# ============================================================
# Stage 2 — Runtime
# ============================================================
# Debian slim (glibc), not alpine: onnxruntime-node's prebuilt native binary
# (used by @huggingface/transformers for local embeddings) has no musl build
# and fails to dlopen on Alpine with "Error loading shared library
# ld-linux-x86-64.so.2".
FROM node:24-bookworm-slim

WORKDIR /app

# Defaults — all overridable at runtime via environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    SOCKETS_PORT=3001 \
    SERENE_PUB_DATA_DIR=/data \
    # Disable auto-open in container environments
    SERENE_AUTO_OPEN=1

# Copy only what's needed to run
COPY --from=builder /app/build        ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/drizzle      ./drizzle
COPY --from=builder /app/package.json ./

# Run as a non-root user rather than the container default (root) — limits
# blast radius if the app process is ever compromised. /data is created (and
# owned) here, before VOLUME, so a fresh anonymous/named volume inherits the
# right ownership instead of defaulting to root.
RUN groupadd -r serene && useradd -r -g serene -d /app serene \
    && mkdir -p /data \
    && chown -R serene:serene /app /data
USER serene

# Persistent data volume (database, uploads, model cache, etc.)
VOLUME ["/data"]

EXPOSE 3000 3001

CMD ["node", "build/index.js"]
