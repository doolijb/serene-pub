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

The first startup runs database migrations automatically and creates the built-in admin account. Accounts are off until you turn them on (see [Users & Accounts](./docs/users-and-accounts.md)).

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

| Path                  | Contents                                                     |
| --------------------- | ------------------------------------------------------------ |
| `data/serene-pub.db`  | PGlite database (characters, sessions, lorebooks, settings…) |
| `models/embeddings/`  | Downloaded local embedding models                            |
| `models/ner/`         | Downloaded local named-entity models                         |
| `models/llm/`         | Default KoboldCPP text model directory (managed mode)        |
| `models/image/`       | Default KoboldCPP image model directory (managed mode)       |
| `koboldcpp/`          | KoboldCPP binary downloaded in-app (managed mode)            |

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
(`PROTOCOL_HEADER`/`HOST_HEADER`/`TRUSTED_PROXIES`) and `PUBLIC_URL`, see
[docs/hosting.md](./docs/hosting.md).

| Variable                                         | Default                                   | Description                                                                                                        |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SERENE_PUB_DATA_DIR`                            | `/data`                                   | Directory for all persistent data                                                                                  |
| `PORT`                                           | `3000`                                    | HTTP port the web server listens on (serves the realtime socket too)                                                                                |
| `NODE_ENV`                                       | `production`                              | Node.js environment                                                                                                |
| `USER_TOKEN_EXPIRATION_HOURS`                    | `168`                                     | Session lifetime in hours (168 = 7 days)                                                                           |
| `TRANSFORMERS_CACHE`                             | `$SERENE_PUB_DATA_DIR/models/<embeddings or ner>` | Override the local embedding and named-entity model cache (one directory for both)                         |
| `KOBOLDCPP_BINARY_DIR` / `KOBOLDCPP_BINARY_NAME` | unset                                     | Point managed KoboldCPP mode at a binary you mounted yourself — see [Managed mode](#koboldcpp--managed-mode) below |

A container never opens a browser or window, so `AUTO_OPEN_CLIENT` and `DEFAULT_CLIENT` are ignored here.

---

## Changing ports

Update both the `ports` mapping **and** the corresponding environment variable.
One port serves the web UI and the realtime connection together:

```yaml
ports:
    - "8080:8080" # host:container
environment:
    PORT: 8080
```

---

## Running behind a reverse proxy

Serene Pub serves the web app and its realtime connection from a single
port (`PORT`, default `3000`), so proxying that one port is all that's
required — but your proxy **must forward WebSocket upgrade requests**
(`Upgrade` / `Connection` headers) for `/socket.io/` to work. See
[docs/hosting.md](./docs/hosting.md#reverse-proxy-or-tunnel-on-the-same-host)
for a full nginx example (including Nginx Proxy Manager) and the matching
environment variables (`PUBLIC_URL`, `TRUSTED_PROXIES`, `HOST_HEADER`), plus a
troubleshooting table for the "mixed content" / CORS / timeout errors this
typically shows up as when misconfigured.

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
3. Telling Serene Pub where the binary is: set `KOBOLDCPP_BINARY_DIR` (and `KOBOLDCPP_BINARY_NAME`) before the first start.

```yaml
services:
    serene-pub:
        image: ghcr.io/doolijb/serene-pub:latest
        volumes:
            - serene-pub-data:/data
            - /path/to/koboldcpp:/koboldcpp:ro # binary directory
            - /path/to/models:/data/models/llm # text model files
        environment:
            KOBOLDCPP_BINARY_DIR: /koboldcpp
            KOBOLDCPP_BINARY_NAME: koboldcpp-linux-x64 # the file you mounted
```

The variables are read on first boot only, while managed mode is not yet configured. After that, the binary and the **Models Directory** are managed on the KoboldCPP connection's **Settings** tab in **Connections** (see [Connections](./docs/connections.md)).

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
docker run -p 3000:3000 -v serene-pub-data:/data serene-pub:local
```

Multi-platform build (requires `docker buildx`):

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t serene-pub:local \
  --load \
  .
```
