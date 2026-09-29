# Hosting Serene Pub

Common hosting and reverse-proxy setups for running Serene Pub outside of a
plain `npm run dev` — whether that's `node build/index.js` directly, Docker, or
behind a proxy or tunnel. For the full list of every environment variable, see
[Environment Variables](./environment-variables.md). For Docker specifics
(images, volumes, compose examples), see
[DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md).

**If you're just running Serene Pub for yourself on one machine** — plain
`npm run dev`, or a built app you launch directly with nothing in front of it —
you don't need this page. Everything here is about exposing the app beyond that:
a reverse proxy, a tunnel, a container, or another device on your network.

## Why this exists

Serene Pub runs **one server** on one port (default `3000`). Real-time updates
— session messages, generation progress, model status — travel over Socket.IO
on that same port, under `/socket.io/`. A reverse proxy or tunnel in front of
the app has nothing extra to route, but it **must forward WebSocket upgrades**
(the `Upgrade` and `Connection` headers), or real-time features fail to connect
even though the page itself loads fine.

The rest of this page is about telling the app its public address and which
proxy to trust.

## The two settings that matter

Modern setups need exactly two variables:

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=172.16.0.0/12
```

`PUBLIC_URL` is the address your users actually type. Everything else is
derived from it — whether requests are HTTPS, whether session cookies get the
`Secure` flag, whether HSTS is advertised, what URL the browser is told to open
its socket connection to, and SvelteKit's CSRF origin.

`TRUSTED_PROXIES` is which addresses your proxy connects from. It decides
whether forwarded headers (`X-Forwarded-For`, `X-Forwarded-Host`,
`X-Forwarded-Proto`) are believed at all, and it fills in `ADDRESS_HEADER`,
`HOST_HEADER` and `PROTOCOL_HEADER` for you. Unset, the trusted range is the
local network (loopback and private addresses), but those three header
variables are left unset, so forwarded headers are not read — set it whenever a
proxy sits in front of the app.

Crucially, `PUBLIC_URL` applies **per request, matched on hostname**. A request
arriving on `serene.example.com` gets the public answer; a request arriving on
`localhost:3000` still auto-detects plain HTTP. One setting serves both at once,
so you never have to flip configuration between local and public access.

## Common hosting configurations

### Direct access, no proxy

Nothing to configure. `http://localhost:3000` (or whatever `HOST`/`PORT` you
set) works out of the box — the browser opens its socket to the same address
the page came from.

### Reverse proxy or tunnel on the same host

The most common setup: a single public hostname (nginx, Nginx Proxy Manager,
Caddy, Cloudflare Tunnel, Traefik) in front of the app. Proxy the one port, and
make sure WebSocket upgrades are passed through:

```nginx
server {
    listen 443 ssl;
    server_name serene.example.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   X-Forwarded-Host $host;
    }
}
```

Then everything is reachable through the one public hostname and port:

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=127.0.0.1
```

`/socket.io/` is served by that same `location /`, so the browser's socket
connects to `https://serene.example.com` like every other request.

### Cloudflare Tunnel

Cloudflare Tunnel maps a public hostname to a local origin. Point the hostname
at the app's port (`http://localhost:3000`, or a local reverse proxy in front of
it); sockets ride the same origin, and `cloudflared` forwards WebSocket upgrades
on its own. Then:

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=127.0.0.1
```

The edge-to-`cloudflared` hop is always encrypted regardless of how the local
origin is configured, so `cloudflared` → proxy → app staying plain HTTP on your
own machine is normal and not a security concern.

> If you see **"Socket connection timeout"** with a Cloudflare Tunnel, check that
> the tunnel (or the proxy it points at) passes WebSocket upgrades through to
> the app's port. Older versions ran sockets on a second port that Cloudflare
> could not serve; current versions do not.

### Docker

See [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md). The
same guidance applies — the container exposes only `PORT` (sockets share it),
and the compose files carry commented-out `PUBLIC_URL` and `TRUSTED_PROXIES`
examples.

## Migrating to PUBLIC_URL

Nothing below is broken and nothing needs changing on a schedule — the old
variables are still honored. But one `PUBLIC_URL` replaces all of them, and
Serene Pub prints a notice at startup for each of the first four you still have
set, naming its replacement.

| Deprecated | Replace with |
|---|---|
| `SOCKETS_HTTPS_HOSTS=example.com` | `PUBLIC_URL=https://example.com` |
| `SOCKETS_HTTP_MODE=https` | `PUBLIC_URL=https://<your hostname>` |
| `SERENE_PUB_SECURE_COOKIES=true` | `PUBLIC_URL=https://<your hostname>` |
| `PUBLIC_SOCKETS_ENDPOINT=<url>` | Nothing — delete it. Sockets share the app's address, so there is no separate endpoint to name; it is ignored. |
| `HOST_HEADER`, `PROTOCOL_HEADER`, `ADDRESS_HEADER` | `TRUSTED_PROXIES=<your proxy's address>` derives all three. |

The old second-server settings — `SOCKETS_PORT` and `SOCKETS_ENDPOINT` — are
gone rather than deprecated: there is no second server for them to describe, and
nothing reads them. Delete them, and any second port mapping (such as `3001`),
when you upgrade. `SOCKETS_ALLOWED_ORIGINS` is now `ALLOWED_ORIGINS`; the old
name is no longer read, so rename it.

## Startup banner

Every start prints the configuration it actually resolved:

```
[Serene Pub] Public URL:  https://serene.example.com   (from PUBLIC_URL)
[Serene Pub] Local URL:   http://localhost:3000
[Serene Pub] Trusted proxies: 172.16.0.0/12
[Serene Pub] Allowed origins: same-hostname (zero-config) + local network for non-browser clients
```

If a setting isn't doing what you expect, this is the first place to look — it
reports the resolved answer, not what you wrote.

## Security notes

- **Multi-user ("accounts") mode**: when disabled (the default), every socket
  connection is automatically treated as the first admin user with no login at
  all — appropriate for a single-person local instance, but it means anyone who
  can reach the app's ports has full access. If you're exposing the instance
  beyond your own machine, turn accounts on in Admin › General. The origin
  allowlist works with zero configuration for virtually every setup; you
  generally don't need to set anything for it.
- **Don't set `ALLOWED_ORIGINS=*`** unless your page and socket
  connection genuinely use different hostnames. It disables the origin allowlist
  entirely *and* stops non-browser clients from being restricted to the local
  network. Combined with accounts-disabled mode, anything that can reach the
  port gets an unauthenticated admin session. Serene Pub warns at startup when
  it is set.
- **`TRUSTED_PROXIES` is worth narrowing.** The default trusts the whole local
  network, and the app binds `0.0.0.0` by default — so any host on your LAN can
  send a forged `X-Forwarded-For` and evade login rate limiting. Naming your
  proxy's address specifically (`TRUSTED_PROXIES=127.0.0.1`) closes that, as
  does binding `HOST=127.0.0.1` when the proxy runs on the same machine.
- **Back up `meta.json` alongside your database.** It lives in
  `SERENE_PUB_DATA_DIR` next to the database files and holds a secret key used
  to derive both session tokens and stored passphrase hashes. If it's lost or
  regenerated — for instance a partial restore that includes the DB but not this
  file — every existing session is invalidated and every stored passphrase stops
  validating. Treat it as part of the same backup set as the database, not a
  disposable cache.
- Session cookies expire after `USER_TOKEN_EXPIRATION_HOURS` (default 7 days)
  and are `httpOnly`, plus `Secure` whenever the request is HTTPS. Logging out
  revokes the session server-side immediately rather than just clearing the
  cookie.
- **Content-Security-Policy** is on by default and strict. If your hosting layer
  injects its own scripts or styles — most commonly Cloudflare's "Browser
  Insights" beacon (`static.cloudflareinsights.com`) — the browser console shows
  a CSP violation naming the blocked URL. Prefer disabling that feature at the
  CDN level (Cloudflare: Speed → Optimization → Browser Insights) since it's
  third-party content this app doesn't control; otherwise allow the domain via
  `CSP_EXTRA_SCRIPT_SRC`, `CSP_EXTRA_STYLE_SRC` or `CSP_EXTRA_CONNECT_SRC`.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Socket connection timeout", no CORS or 404 error at all | Your proxy or tunnel reaches the app but isn't forwarding WebSocket upgrades. Pass the `Upgrade` and `Connection` headers through — see the nginx example above. |
| Console shows "Mixed Content... has been blocked" | The socket connects to the page's own origin, so this means the page itself was served over `http://` inside an `https://` context. Check your proxy, and set `PUBLIC_URL=https://<your hostname>`. |
| "blocked by CORS policy" pointing at your own domain | The socket's `Origin` and the `Host` the app sees differ — usually a proxy rewriting `Host`. Forward the original `Host` (or set `TRUSTED_PROXIES` so `X-Forwarded-Host` is believed); `ALLOWED_ORIGINS` is the last resort. |
| Socket requests 404 at `/socket.io/...` | Something in front of the app routes `/socket.io/` away from it. It is served by the app's own port — proxy it like every other path. |
| Login rate limiting locks out everyone at once | `ADDRESS_HEADER` isn't set, so every user shares your proxy's address as one bucket. Set `TRUSTED_PROXIES`, which derives it. |
| Browser refuses to load `http://localhost:3000`, forcing HTTPS | An older build advertised HSTS over plain HTTP. Clear the entry at `chrome://net-internals/#hsts`. Fixed in current versions. |
| `.env` changes don't seem to apply | First, check the file is where Serene Pub looks: `<data dir>/.env` (see [Environment Variables](./environment-variables.md#where-env-lives)) — the startup banner's `Env files:` line names the files it actually read. Beyond that, variables read by the server framework itself (`PORT`, `HOST`, `ORIGIN`, `PROTOCOL_HEADER`, `HOST_HEADER`, `ADDRESS_HEADER`, `XFF_DEPTH`) must be set before any code runs. Current builds load `.env` early enough automatically; if you use a custom entrypoint, launch with `node --env-file=<data dir>/.env build/index.js`. The startup banner tells you which case you're in. |
