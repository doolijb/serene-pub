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

| Tag          | What you get                                   |
| ------------ | ---------------------------------------------- |
| `latest`     | Newest **stable** or **beta** release          |
| `0`          | Newest stable or beta in the `0.x` line        |
| `0.5`        | Newest stable or beta in the `0.5.x` line      |
| `0.5.3`      | That exact stable version                      |
| `0.5.3-beta` | That exact beta release                        |
| `0.5.3-rc-1` | Release candidate — pre-release, never aliased |
| `0.5.3-pr-5` | Pre-release build from a pull request          |

A stable release (`v0.5.3`) and a beta release (`v0.5.3-beta`) both move
`latest` and both move the major and minor aliases — beta is treated as a
release here, not a pre-release. Release candidates (`-rc-*`) and pre-release
builds (`-pr-*`) are published under their exact version only and never touch
`latest`, `0` or `0.5`, so pinning to any of those three will not pull them.

To pin to an exact version (recommended for production):

```yaml
image: ghcr.io/doolijb/serene-pub:0.5.3-beta
```

---

## Upgrading

```bash
docker compose -f docker-compose.dist.yml pull
docker compose -f docker-compose.dist.yml up -d
```

Database migrations run automatically on startup. Back up your data volume before upgrading across major versions.

**Coming from 0.5.2 or earlier?** Real-time updates used to run on a second
server (`SOCKETS_PORT`, default `3001`) and that port is gone. A proxy rule
routing `/socket.io/` to `:3001` will break; a leftover `-p 3001:3001` mapping
and `SOCKETS_PORT` variable will not, and are cleanup rather than an emergency.
See [Upgrading from 0.5.2 or earlier](./docs/hosting.md#upgrading-from-052-or-earlier)
for the whole list, with nginx and Caddy snippets.

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
(`PROTOCOL_HEADER`/`HOST_HEADER`) and the deprecated hosting variables, see
[docs/hosting.md](./docs/hosting.md).

| Variable                                         | Default                                   | Description                                                                                                        |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `SERENE_PUB_DATA_DIR`                            | `/data`                                   | Directory for all persistent data                                                                                  |
| `PORT`                                           | `3000`                                    | HTTP port the web server listens on                                                                                |
| `SERENE_AUTO_OPEN`                               | `1` (disabled)                            | Baked into the image (there's no browser to open in a container) and set again in both compose files — no need to touch this yourself |
| `NODE_ENV`                                       | `production`                              | Node.js environment                                                                                                |
| `USER_TOKEN_EXPIRATION_HOURS`                    | `168`                                     | Session lifetime in hours (168 = 7 days)                                                                           |
| `TRANSFORMERS_CACHE`                             | `$SERENE_PUB_DATA_DIR/transformers-cache` | Override embedding model cache directory                                                                           |
| `KOBOLDCPP_BINARY_DIR` / `KOBOLDCPP_BINARY_NAME` | unset                                     | Point managed KoboldCPP mode at a binary you mounted yourself — see [Managed mode](#koboldcpp--managed-mode) below |

---

## Changing the port

Update both the `ports` mapping **and** the environment variable. Real-time
updates share this port, so there is only one to change:

```yaml
ports:
    - "8080:8080" # host:container
environment:
    PORT: 8080
```

---

## Running behind a reverse proxy

Serene Pub runs one server (`PORT`, default `3000`), which serves the web app
and real-time updates (`/socket.io/`) together. Your proxy needs a single
upstream, and must forward WebSocket upgrade requests. See
[docs/hosting.md](./docs/hosting.md#reverse-proxy-or-tunnel-on-the-same-host) for a full nginx
example (including Nginx Proxy Manager) and the matching environment
variables (`PUBLIC_URL`, `TRUSTED_PROXIES`), plus a troubleshooting
table for the "mixed content" / CORS / timeout errors this typically shows
up as when misconfigured.

> **Upgrading?** Serene Pub used to run a second server on `SOCKETS_PORT`
> (default `3001`). Point any proxy rule that routed `/socket.io/` to `:3001` at
> `PORT` instead — that rule is the one thing that genuinely breaks. A leftover
> `-p 3001:3001` mapping and `SOCKETS_PORT` variable are harmless and can be
> dropped whenever convenient. Full details in
> [Upgrading from 0.5.2 or earlier](./docs/hosting.md#upgrading-from-052-or-earlier).

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
