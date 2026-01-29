# Multi-stage build for Serene Pub (SvelteKit + adapter-node)

FROM node:20-slim AS builder
WORKDIR /app

# Install deps (package-lock.json optional)
COPY package.json package-lock.json* ./
RUN npm set progress=false && npm config set depth 0 || true
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install production deps only
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --omit=dev

# Copy built app
COPY --from=builder /app/build ./build

# Copy any assets that the runtime might need
COPY --from=builder /app/dist-assets ./dist-assets
COPY --from=builder /app/static ./static
COPY --from=builder /app/drizzle/meta ./meta
# Also include full drizzle folder (migrations and meta) for runtime migration lookup
COPY --from=builder /app/drizzle ./drizzle

# Expose persistent data directory for the app (PGlite/Serene Pub data)
VOLUME ["/root/.local/share/SerenePub/data"]

EXPOSE 3000
ENV PORT=3000

CMD ["node", "build/index.js"]
