# Environment Variables

Serene Pub is configured almost entirely through environment variables rather than a settings file — there's no single config file to hand-edit before first launch. **If you're just running Serene Pub on your own computer, you can skip this entire page** — every variable below has a sensible default, and a normal local install needs none of them. This page exists for the cases where you *do* need to change something: a portable install, running behind a reverse proxy, Docker, or tweaking a specific feature's behavior.

Variables can be set however your platform normally sets them (shell export, a process manager, a Docker `environment:` block, etc.), or by placing a `.env` file in the directory you launch Serene Pub from — Serene Pub loads `.env` automatically on startup if one is present. Copying `.env.example` (in the project root) to `.env` and editing it is the easiest starting point.

For deployment-specific walkthroughs (reverse proxies, tunnels, Docker), see [Hosting Serene Pub](https://github.com/doolijb/serene-pub/blob/main/HOSTING.md) and [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md) in the repository. This page focuses on what each variable does; those cover the surrounding setup.

## Portable / Self-Contained Setup

The most common reason to open this page: keeping Serene Pub's data in one folder you control (a USB drive, a synced folder, something you back up as a unit) instead of the OS-specific hidden location it uses by default (e.g. under your user profile on Windows, `~/.local/share` on Linux, `~/Library/Application Support` on macOS).

1. Pick (or create) a folder for the whole portable install, containing the built app (or the platform executable from a release) plus a subfolder for data, e.g.:
   ```
   serene-pub-portable/
     Serene Pub.exe        (or the Linux/macOS equivalent)
     data/
   ```
2. In that same folder, create a `.env` file:
   ```
   SERENE_PUB_DATA_DIR=./data
   ```
   A relative path resolves against the directory you launch Serene Pub *from* — so always launch it from inside `serene-pub-portable/`, not by referencing the executable from elsewhere.
3. Launch normally. On first run, Serene Pub creates the database and `meta.json` inside `data/`. From then on, copying the entire `serene-pub-portable/` folder anywhere — a different computer, a USB drive — brings your characters, sessions, connections, and settings with it.

If you're launching a built app directly with `node` rather than a packaged executable, prefer Node's own `--env-file` flag over relying on Serene Pub's automatic `.env` loading:

```
node --env-file=.env build/index.js
```

This guarantees every variable in `.env` — including `SERENE_PUB_DATA_DIR` — is set before any code runs at all, rather than depending on module load order. A few variables further down this page (`PORT`, `HOST`, `PROTOCOL_HEADER`, `HOST_HEADER`, `ORIGIN`) are read by the underlying server framework itself, before Serene Pub's own `.env` loading gets a chance to run, so `--env-file` is the safest choice generally, not just for a portable setup specifically.

## Data & Storage

| Variable | Default | Description |
|---|---|---|
| `SERENE_PUB_DATA_DIR` | OS-appropriate user data directory | Where the database, `meta.json` (the secret key backing sessions and stored passphrases), the embedding model cache, and downloaded KoboldCPP binaries/models all live. Set this to keep everything in one folder you control — see [Portable / Self-Contained Setup](#portable--self-contained-setup) above. |

## Feature Toggles

Small, self-contained switches for specific features — each is safe to try in isolation.

| Variable | Default | Description |
|---|---|---|
| `SERENE_AUTO_OPEN` | unset (a browser tab opens automatically) | Set to `1` or `true` to **disable** automatically opening a browser tab when Serene Pub starts. |
| `USER_TOKEN_EXPIRATION_HOURS` | `168` (7 days) | How long a login session lasts before it expires. |
| `ENABLE_UNSAFE_CHARACTER_BROWSING` | unset (hidden) | Set to `true` to allow the Character Library's "include NSFW" toggle to appear when browsing external card sources (e.g. CharaVault). Still off by default even once enabled — this only unlocks the toggle, it doesn't turn NSFW results on by itself. |
| `PUBLIC_DOCUMENT_VIEW_DEFAULT` | `false` | Set to `true` to make [Document View](./document-view.md) (the simplified, high-contrast, keyboard- and screen-reader-friendly interface) the default for anyone who hasn't visited yet. Only applies before a given browser has its own stored preference — once someone toggles Document View themselves, that choice always wins, even if this changes later. Useful for an install primarily used by vision-impaired users. |

## KoboldCPP Managed Mode

Only relevant if you're running KoboldCPP in [Managed mode](./connections.md) — where Serene Pub downloads and runs the KoboldCPP binary for you rather than you pointing it at a server you run yourself.

| Variable | Default | Description |
|---|---|---|
| `KOBOLDCPP_BINARY_DIR` | unset | Directory containing (or where an in-app download should place) the KoboldCPP binary. Only applied on first boot, or if managed mode isn't already configured — an already-working setup is never silently overridden. Useful for a Docker deployment mounting a pre-downloaded binary. |
| `KOBOLDCPP_BINARY_NAME` | unset | Filename of a pre-existing binary inside `KOBOLDCPP_BINARY_DIR`, for pointing at a binary you provided yourself rather than letting Serene Pub download one. |

---

Everything below this point is deployment-level configuration — reverse proxies, Docker, hosting Serene Pub for more than just yourself. If that's not what you're doing, you're done reading.

## Server & Network

These are read by `@sveltejs/adapter-node` itself, before Serene Pub's own code runs — see the [portable setup note above](#portable--self-contained-setup) if changes to them don't seem to take effect.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the main web server listens on. |
| `HOST` | `0.0.0.0` | Network interface the main web server and the socket server both bind to. |
| `ORIGIN` | inferred from the request | Explicit public origin (e.g. `https://serene.example.com`). Set this if form submissions start failing behind a reverse proxy — SvelteKit uses it for CSRF checks. |
| `NODE_ENV` | — | Set to `production` for a production build (session cookies become `Secure`-only, among other production-mode behaviors). |

## Sockets (real-time updates)

Serene Pub runs a second server for real-time updates (session messages, generation progress, model status) separate from the main web server. If you're putting a reverse proxy or tunnel in front of Serene Pub, it needs to know about this second server too, or real-time features will silently fail even though the page loads fine — see [Hosting Serene Pub](https://github.com/doolijb/serene-pub/blob/main/HOSTING.md) for worked examples.

| Variable | Default | Description |
|---|---|---|
| `SOCKETS_PORT` | `3001` | Port the real-time server listens on. |
| `SOCKETS_HTTPS_HOSTS` | unset | Comma-separated hostnames that should always get an `https://` real-time connection, even if the request otherwise looks like plain HTTP (common when a proxy terminates TLS). A host listed here is automatically an allowed origin too. |
| `SOCKETS_ALLOWED_ORIGINS` | not needed for most setups | Comma-separated hostnames (no scheme/port) explicitly allowed to open a real-time connection, beyond the automatic default (any origin matching the hostname the request itself arrived on — this already covers `localhost`, LAN IPs, and any custom domain with zero configuration). Set to the literal value `*` to disable the allowlist entirely. |
| `SOCKETS_HTTP_MODE` | auto-detected | Global protocol override (`http` or `https`) applied to every hostname *not* covered by `SOCKETS_HTTPS_HOSTS`. Prefer `SOCKETS_HTTPS_HOSTS` when the app is reachable both directly and through a proxy, since this setting applies everywhere regardless of how a request arrived. |
| `PUBLIC_SOCKETS_ENDPOINT` | unset | Full override for the URL the browser connects to for real-time updates (protocol + host + port). Takes priority over everything else above — only needed if none of the other options cover your setup. |

## Reverse Proxy Trust

Unset by default, meaning Serene Pub does **not** trust forwarded headers — every request looks like plain HTTP from the proxy's own address, since that's genuinely what the proxy sends. Only set these if you're actually running behind a reverse proxy or tunnel that sets the corresponding header itself.

| Variable | Default | Description |
|---|---|---|
| `HOST_HEADER` | unset | Header holding the real client-facing hostname, e.g. `x-forwarded-host`. |
| `PROTOCOL_HEADER` | unset | Header holding the real client-facing protocol, e.g. `x-forwarded-proto`. |
| `ADDRESS_HEADER` | unset | Header holding the real client IP, e.g. `x-forwarded-for`. **Login rate limiting depends on this being set correctly** when behind a proxy — without it, every user's failed logins share one bucket (the proxy's own address), so one person locking themselves out can lock everyone out. Only set this when a trusted proxy is actually in front of the app; setting it with no proxy present lets any client bypass rate limiting by sending a spoofed header directly. Serene Pub prints a one-time startup warning if it ever sees a forwarded-for header arrive while this is unset. |

## Content Security Policy

Serene Pub ships a strict Content-Security-Policy by default; it isn't a header you can disable via an env var. These add extra allowed sources for content your hosting layer injects into the page that isn't part of the app itself — most commonly Cloudflare's "Browser Insights" beacon when a zone is proxied through Cloudflare with that feature on. Prefer disabling such features at the CDN/proxy level over widening these, since it's third-party content the app has no control over.

| Variable | Default | Description |
|---|---|---|
| `CSP_EXTRA_SCRIPT_SRC` | unset | Comma-separated extra allowed script sources. |
| `CSP_EXTRA_STYLE_SRC` | unset | Comma-separated extra allowed stylesheet sources. |
| `CSP_EXTRA_CONNECT_SRC` | unset | Comma-separated extra allowed fetch/XHR/WebSocket targets. |

## Development Only

These only matter if you're running Serene Pub from source against an external PostgreSQL database for development. A normal install — including every production deployment — uses an embedded database automatically and never needs these.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `localhost` | External PostgreSQL host. |
| `DATABASE_PORT` | `3002` | External PostgreSQL port. |
| `POSTGRES_USER` | `postgres` | External PostgreSQL username. |
| `POSTGRES_PASSWORD` | `password` | External PostgreSQL password. |
