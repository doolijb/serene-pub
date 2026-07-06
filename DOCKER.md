# Running Serene Pub with Docker

Official images are published to the GitHub Container Registry at:

```
ghcr.io/doolijb/serene-pub
```

---

## Quick start

```bash
docker compose -f docker-compose.dist.yml up -d
```

That's it. The web UI will be available at **http://localhost:3000**.

The first startup runs database migrations automatically and creates an admin account on first login.

---

## Image tags

| Tag | What you get |
|-----|--------------|
| `latest` | Latest **stable** release |
| `1`, `1.2` | Latest stable within that major / minor line |
| `1.2.3` | Exact stable version |
| `1.2.3-beta` | Pre-release — beta |
| `1.2.3-rc-1` | Pre-release — release candidate |
| `1.2.3-pr-5` | Pre-release — pull-request build |

**`latest`, major, and minor aliases are only updated on stable releases.**  
Pre-release tags are published but never assigned to `latest`, so pinning to `latest` will not pull an unstable build.

To pin to an exact version (recommended for production):

```yaml
image: ghcr.io/doolijb/serene-pub:1.2.3
```

---

## Upgrading

```bash
docker compose -f docker-compose.dist.yml pull
docker compose -f docker-compose.dist.yml up -d
```

Database migrations run automatically on startup. Back up your data volume before upgrading across major versions.

---

## Persistent data

Everything that needs to survive container restarts lives under `SERENE_PUB_DATA_DIR` (default `/data` inside the container). The `docker-compose.dist.yml` mounts this as a named volume called `serene-pub-data`.

The data directory contains:

| Path | Contents |
|------|----------|
| `data/serene-pub.db` | PGLite database (characters, chats, lorebooks, settings…) |
| `transformers-cache/` | Downloaded AI embedding models |
| `koboldcpp/models/` | Default KoboldCPP model directory (managed mode) |

### Bind-mount instead of a named volume

If you prefer a host directory (e.g. for easy backups):

```yaml
volumes:
  - ./serene-pub-data:/data
```

---

## Environment variables

All variables are optional unless noted.

| Variable | Default | Description |
|----------|---------|-------------|
| `SERENE_PUB_DATA_DIR` | `/data` | Directory for all persistent data |
| `PORT` | `3000` | HTTP port the web server listens on |
| `SOCKETS_PORT` | `3001` | WebSocket server port |
| `SERENE_AUTO_OPEN` | `1` | Set to `1` to disable automatic browser launch (always disabled in containers) |
| `NODE_ENV` | `production` | Node.js environment |
| `USER_TOKEN_EXPIRATION_HOURS` | `168` | Session lifetime in hours (168 = 7 days) |
| `TRANSFORMERS_CACHE` | `$SERENE_PUB_DATA_DIR/transformers-cache` | Override embedding model cache directory |

---

## Changing ports

Update both the `ports` mapping **and** the corresponding environment variable:

```yaml
ports:
  - "8080:8080"   # host:container
  - "8081:8081"
environment:
  PORT: 8080
  SOCKETS_PORT: 8081
```

---

## Running behind a reverse proxy

Serene Pub uses WebSockets for real-time updates. Your proxy must forward WebSocket upgrade requests.

### Nginx example

```nginx
server {
    listen 80;
    server_name serene.example.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }
}
```

Both ports (HTTP and WebSocket) should be proxied, or configure Serene Pub to use the same port for both by pointing `SOCKETS_PORT` to the same value as `PORT` if your reverse proxy consolidates them.

---

## AI connections

### Ollama

Run Ollama in a separate container and point Serene Pub at it:

```yaml
services:
  serene-pub:
    image: ghcr.io/doolijb/serene-pub:latest
    environment:
      # Serene Pub connects to Ollama via its container name
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama
    volumes:
      - ollama-data:/root/.ollama

volumes:
  serene-pub-data:
  ollama-data:
```

In Serene Pub's connection settings, set the Ollama base URL to `http://ollama:11434`.

### KoboldCPP — external mode

Run KoboldCPP as a separate container (or on the host) and add a KoboldCPP connection in Serene Pub pointing to its URL. No extra Docker configuration needed.

### KoboldCPP — managed mode

Managed mode lets Serene Pub spawn and control the KoboldCPP process directly. Inside a container this requires:

1. Mounting the KoboldCPP binary into the container.
2. Mounting your model files.
3. Setting the binary directory in Serene Pub's KoboldCPP settings (or via environment at startup).

```yaml
services:
  serene-pub:
    image: ghcr.io/doolijb/serene-pub:latest
    volumes:
      - serene-pub-data:/data
      - /path/to/koboldcpp:/koboldcpp:ro     # binary directory
      - /path/to/models:/data/koboldcpp/models  # model files
```

After mounting, configure the binary path in **Settings → KoboldCPP Manager**.

> **Note:** Managed KoboldCPP mode requires the Linux binary to be executable and compatible with the container's architecture (amd64 or arm64).

---

## Building locally

```bash
docker build -t serene-pub:local .
docker run -p 3000:3000 -p 3001:3001 -v serene-pub-data:/data serene-pub:local
```

Multi-platform build (requires `docker buildx`):

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t serene-pub:local \
  --load \
  .
```
