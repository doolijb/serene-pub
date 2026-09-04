# Environment Variables

Serene Pub is configured almost entirely through environment variables rather than a settings file — there's no single config file to hand-edit before first launch. **If you're just running Serene Pub on your own computer, you can skip this entire page** — every variable below has a sensible default, and a normal local install needs none of them. This page exists for the cases where you *do* need to change something: a portable install, running behind a reverse proxy, Docker, or tweaking a specific feature's behavior.

Variables can be set however your platform normally sets them (shell export, a process manager, a Docker `environment:` block, etc.), or by placing a `.env` file in the directory you launch Serene Pub from — Serene Pub loads `.env` automatically on startup if one is present. Copying `.env.example` (in the project root) to `.env` and editing it is the easiest starting point.

For deployment-specific walkthroughs (reverse proxies, tunnels, Docker), see [Hosting Serene Pub](./hosting.md) and [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md) in the repository. This page focuses on what each variable does; those cover the surrounding setup.

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
3. Launch normally. On first run, Serene Pub creates the database and `meta.json` inside `data/`. From then on, copying the entire `serene-pub-portable/` folder anywhere — a different computer, a USB drive — brings your characters, chats, connections, and settings with it.

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
| `PORT` | `3000` | Port the web server listens on. It serves `/socket.io/` as well as the pages, so this is the only port to expose or proxy. |
| `HOST` | `0.0.0.0` | Network interface the server binds to. There is one bind: real-time updates are served by this same server, under `/socket.io/`. |
| `ORIGIN` | inferred from the request | Explicit public origin (e.g. `https://serene.example.com`). Set this if form submissions start failing behind a reverse proxy — SvelteKit uses it for CSRF checks. |
| `NODE_ENV` | — | Set to `production` for a production build. |
| `SERENE_PUB_SECURE_COOKIES` | unset | Set to `true` when this deployment terminates TLS itself rather than sitting behind a proxy that sets `X-Forwarded-Proto`. Declares the whole deployment HTTPS, which is what session cookies get `Secure`/`SameSite=strict` from and what makes HSTS advertised. It affects HTTPS detection only — there is no separate real-time endpoint for it to point anywhere. **Deprecated in favor of `PUBLIC_URL`**, which says the same thing and more precisely. |
| `BODY_SIZE_LIMIT` | `512K` | Maximum request body size accepted by the web server. Raise it if large character-card or image uploads fail. |
| `SHUTDOWN_TIMEOUT` | `30` | Seconds to wait for in-flight requests to finish during a graceful shutdown. |
| `IDLE_TIMEOUT` | `0` (disabled) | Seconds of inactivity after which the server exits, for socket-activated setups. |

## Public URL and Proxy Trust

**These two variables are all a proxied deployment normally needs.** Everything else in this section exists for unusual setups or predates them.

| Variable | Default | Description |
|---|---|---|
| `PUBLIC_URL` | unset | The address your users actually type, as a full origin including the scheme — e.g. `https://serene.example.com`. Everything else is derived from it: whether requests count as HTTPS, whether session cookies get the `Secure` flag, whether HSTS is advertised, and SvelteKit's CSRF origin. Applied **per request, matched on hostname**, so a request arriving on `localhost:3000` still auto-detects plain HTTP — one setting serves local and public access at the same time, with nothing to flip between them. Not a base path: `/serene` is rejected with a warning. `SERENE_PUB_PUBLIC_URL` is accepted as an alias, and `ORIGIN` is used as a fallback when neither is set. |
| `TRUSTED_PROXIES` | `private` | Which addresses your reverse proxy connects from, comma-separated. Accepts CIDRs (`10.0.0.0/8`, `2001:db8::/32`), bare addresses, and the keywords `private` (loopback plus RFC1918 and link-local ranges — the default), `none`, and `*`. This decides whether forwarded headers are believed at all, and setting it derives `ADDRESS_HEADER`, `HOST_HEADER` and `PROTOCOL_HEADER` for you. Worth narrowing from the default: the app binds `0.0.0.0`, so `private` trusts every host on your LAN to claim a client IP. |

Real-time updates are served on the same origin as the pages, under `/socket.io/`, so a proxy needs one upstream and no extra port — which is what makes Cloudflare Tunnel and similar setups work, since they can't expose an arbitrary port. See [Hosting Serene Pub](./hosting.md).

Serene Pub prints the configuration it actually resolved at startup, including which of these were used and any deprecated variables still set.

## Real-time updates (sockets)

Real-time updates — chat streaming, generation progress, model status — are served by the same server as the pages, on `PORT`, under the `/socket.io/` path. There is nothing to configure: the browser connects back to the origin it loaded the page from. A reverse proxy needs one upstream and must forward the WebSocket upgrade — see [Hosting Serene Pub](./hosting.md) for worked examples.

There is also **nothing to configure about which origins may connect.** An origin whose hostname matches the hostname the request itself arrived on is always allowed, which covers `localhost`, LAN IPs and any custom domain with zero configuration — a same-site tab's `Origin` *is* whatever hostname it used to reach this server, because the handshake goes to the very server that served the page. A genuinely cross-origin page's `Origin` is the attacker's hostname and never matches. The one setup that default cannot serve — a proxy that rewrites `Host` to an internal name — is covered by `PUBLIC_URL`, whose hostname is allowed alongside it.

Clients that send no `Origin` header at all (CLI tools, server-to-server integrations) aren't subject to the browser-mediated attack this defends against, and are allowed from the local network only. That restriction cannot be widened: with accounts disabled (the default) such a connection is auto-attached to the first admin user with no token, so reaching an instance from elsewhere means enabling user accounts and connecting with a token.

### No longer used

Two generations of socket-specific configuration ended up here: the variables that named the separate real-time server, and the ones that gave the real-time layer its own origin and protocol trust. All are **ignored**, not deprecated — Serene Pub prints a startup notice if any is still set. If you are coming from 0.5.2 or earlier, [Upgrading from 0.5.2 or earlier](./hosting.md#upgrading-from-052-or-earlier) covers which of these actually breaks something and which are merely clutter.

| Variable | Why it's gone |
|---|---|
| `SOCKETS_PORT` | No second listener exists. `PORT` binds the one server, which serves `/socket.io/` too. |
| `SOCKETS_ENDPOINT` | Was a full override for the URL the browser connected to. The browser now connects to the page's own origin, so there is no other address to send it to. |
| `PUBLIC_SOCKETS_ENDPOINT` | The same override under its older name. |
| `ALLOWED_ORIGINS` | The origin allowlist. **No replacement setting** — unlike everything else in this table, there is nothing to re-express it as. Origin trust is derived from the request's own `Host` header plus `PUBLIC_URL`, as described above. In particular there is no longer any way to switch the check off (`ALLOWED_ORIGINS=*`), which with accounts disabled had handed an unauthenticated admin session to anything that could reach the port. |
| `SOCKETS_ALLOWED_ORIGINS` | The older spelling of the same allowlist, from when real-time updates had their own server. Also no replacement. |
| `SOCKETS_HTTPS_HOSTS` | Comma-separated hostnames always treated as `https://`. Use `PUBLIC_URL=https://<host>`, which says scheme and host together and is matched per request. |
| `SOCKETS_HTTP_MODE` | Global protocol override applied to every hostname regardless of how a request arrived — which is why it never suited an install reachable both directly and through a proxy. Use `PUBLIC_URL=https://<host>`. |

## Reverse Proxy Trust

Unset by default, meaning Serene Pub does **not** trust forwarded headers — every request looks like plain HTTP from the proxy's own address, since that's genuinely what the proxy sends.

**Setting `TRUSTED_PROXIES` fills all three of these in for you**, so you normally don't need to touch them directly. They remain available for setups using non-standard header names. Note these are read by `@sveltejs/adapter-node` itself, before Serene Pub's own code runs.

| Variable | Default | Description |
|---|---|---|
| `HOST_HEADER` | unset | Header holding the real client-facing hostname, e.g. `x-forwarded-host`. |
| `PROTOCOL_HEADER` | unset | Header holding the real client-facing protocol, e.g. `x-forwarded-proto`. |
| `ADDRESS_HEADER` | unset | Header holding the real client IP, e.g. `x-forwarded-for`. **Login rate limiting depends on this being set correctly** when behind a proxy — without it every user's failed logins share one bucket (the proxy's own address), so one person can lock everyone out. Only trusted when the request's direct peer passes `TRUSTED_PROXIES`, so it's safe on an install that's also reached directly and a remote client can't spoof past the rate limiter. Serene Pub prints a one-time startup warning if it sees a forwarded-for header arrive while this is unset. |
| `XFF_DEPTH` | `1` | How many proxies `@sveltejs/adapter-node` should count back through when reading `X-Forwarded-For`. Leave it alone: Serene Pub resolves the client address itself using depth-independent chain walking and never relies on this. It only affects code calling SvelteKit's `getClientAddress()` directly, which this app does not do. |
| `PORT_HEADER` | unset | Header holding the real client-facing port. Rarely needed. |

## Content Security Policy

Serene Pub ships a strict Content-Security-Policy by default; it isn't a header you can disable via an env var. These are applied at runtime, so they take effect on a prebuilt release or Docker image without rebuilding. These add extra allowed sources for content your hosting layer injects into the page that isn't part of the app itself — most commonly Cloudflare's "Browser Insights" beacon when a zone is proxied through Cloudflare with that feature on. Prefer disabling such features at the CDN/proxy level over widening these, since it's third-party content the app has no control over.

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
