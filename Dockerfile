# ============================================================
# Stage 1 — Build
# ============================================================
# Must match the runtime stage's libc (Debian/glibc, see below). npm resolves
# native packages against the *build* platform, and this stage's node_modules
# is copied wholesale into the runtime stage — so building on Alpine picks
# @img/sharp-linuxmusl-x64, which then can't load on glibc. sharp is a hard
# (statically imported) dependency of @huggingface/transformers, so that
# failure takes the whole local-embeddings engine down with it: the import
# probe in embedding/index.ts throws, and the app reports local embeddings as
# unsupported on every Docker deployment.
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install deps first (layer-cached until package files change)
COPY package.json ./
RUN npm install --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

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

EXPOSE 3000

CMD ["node", "build/index.js"]
