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

| Tag          | What you get                                         |
| ------------ | ---------------------------------------------------- |
| `latest`     | Latest **stable** or **beta** release                |
| `1`, `1.2`   | Latest stable or beta within that major / minor line |
| `1.2.3`      | Exact stable version                                 |
| `1.2.3-beta` | Beta release                                         |
| `1.2.3-rc-1` | Pre-release — release candidate                      |
| `1.2.3-pr-5` | Pre-release build                                    |

**`latest`, major, and minor aliases are updated on stable and beta releases.**  
Release candidates (`-rc-*`) and pre-release builds (`-pr-*`) are published but never assigned to `latest`, so pinning to `latest` will not pull those builds.

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

| Path                  | Contents                                                  |
| --------------------- | --------------------------------------------------------- |
| `data/serene-pub.db`  | PGLite database (characters, chats, lorebooks, settings…) |
| `transformers-cache/` | Downloaded AI embedding models                            |
| `koboldcpp/models/`   | Default KoboldCPP model directory (managed mode)          |

### Bind-mount instead of a named volume

If you prefer a host directory (e.g. for easy backups):

```yaml
volumes:
    - ./serene-pub-data:/data
```

---

## Environment variables

All variables are optional unless noted. This is the Docker-relevant subset —
for the full reference, including reverse-proxy trust settings
(`PROTOCOL_HEADER`/`HOST_HEADER`) and socket endpoint overrides
(`SOCKETS_HTTPS_HOSTS`/`PUBLIC_SOCKETS_ENDPOINT`), see
[docs/hosting.md](./docs/hosting.md).

| Variable                                         | Default                                   | Description                                                                                                        |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SERENE_PUB_DATA_DIR`                            | `/data`                                   | Directory for all persistent data                                                                                  |
| `PORT`                                           | `3000`                                    | HTTP port the web server listens on                                                                                |
| `SOCKETS_PORT`                                   | `3001`                                    | WebSocket server port                                                                                              |
| `SERENE_AUTO_OPEN`                               | `1` (disabled)                            | Baked into the image (there's no browser to open in a container) and set again in both compose files — no need to touch this yourself |
| `NODE_ENV`                                       | `production`                              | Node.js environment                                                                                                |
| `USER_TOKEN_EXPIRATION_HOURS`                    | `168`                                     | Session lifetime in hours (168 = 7 days)                                                                           |
| `TRANSFORMERS_CACHE`                             | `$SERENE_PUB_DATA_DIR/transformers-cache` | Override embedding model cache directory                                                                           |
| `SOCKETS_ALLOWED_ORIGINS`                        | `*` (in both compose files)               | Disables the app-level socket origin allowlist. Both `docker-compose.dist.yml` and `docker-compose.dev.yml` ship with this set, since a Docker deployment's network exposure is already controlled by its port mapping and/or a reverse proxy — see the comment above `SOCKETS_ALLOWED_ORIGINS` in either compose file if you'd rather remove it and rely on the app-level allowlist too |
| `KOBOLDCPP_BINARY_DIR` / `KOBOLDCPP_BINARY_NAME` | unset                                     | Point managed KoboldCPP mode at a binary you mounted yourself — see [Managed mode](#koboldcpp--managed-mode) below |

---

## Changing ports

Update both the `ports` mapping **and** the corresponding environment variable:

```yaml
ports:
    - "8080:8080" # host:container
    - "8081:8081"
environment:
    PORT: 8080
    SOCKETS_PORT: 8081
```

---

## Running behind a reverse proxy

Serene Pub runs two servers — the web app (`PORT`, default `3000`) and a
separate WebSocket server (`SOCKETS_PORT`, default `3001`). Your proxy needs
to route **both**, and forward WebSocket upgrade requests. The simplest way
is a path split on the same host — see
[docs/hosting.md](./docs/hosting.md#reverse-proxy-or-tunnel-on-the-same-host) for a full nginx
example (including Nginx Proxy Manager) and the matching environment
variables (`SOCKETS_HTTPS_HOSTS`, `HOST_HEADER`), plus a troubleshooting
table for the "mixed content" / CORS / timeout errors this typically shows
up as when misconfigured.

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
            - /path/to/koboldcpp:/koboldcpp:ro # binary directory
            - /path/to/models:/data/koboldcpp/models # model files
```

After mounting, configure the binary path in **Settings → KoboldCPP Manager**.

> **Note:** Managed KoboldCPP mode requires the Linux binary to be executable and compatible with the container's architecture (amd64 or arm64).

---

## Building locally

Simplest option — [`docker-compose.dev.yml`](docker-compose.dev.yml) builds from your local source and runs it with its own isolated data volume (`serene-pub-dev-data`, separate from the one `docker-compose.dist.yml` uses), so it won't collide with a pre-built instance running alongside it:

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

Or by hand:

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
