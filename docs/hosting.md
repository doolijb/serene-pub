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

Serene Pub runs **one server** (SvelteKit, default port `3000`). Real-time
updates — chat streaming, model status, generation progress — travel over
Socket.IO on that same port, under the `/socket.io/` path.

That means a reverse proxy or tunnel needs exactly one upstream. The one thing
it must do beyond ordinary HTTP proxying is **forward the WebSocket upgrade**
(the `Upgrade` and `Connection` headers); without that, the page loads fine and
real-time features silently fail to connect.

> **Upgrading from 0.5.2 or earlier?** Serene Pub used to run a second
> WebSocket server on `SOCKETS_PORT` (default `3001`). That port is gone —
> nothing binds it. One thing genuinely breaks (a proxy rule routing
> `/socket.io/` to `:3001`), a few settings are now ignored, and everything else
> carries over untouched. Read
> [Upgrading from 0.5.2 or earlier](#upgrading-from-052-or-earlier) before you
> pull.

## The two settings that matter

Modern setups need exactly two variables:

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=172.16.0.0/12
```

`PUBLIC_URL` is the address your users actually type. Everything else is
derived from it — whether requests are HTTPS, whether session cookies get the
`Secure` flag, whether HSTS is advertised, and SvelteKit's CSRF origin.

`TRUSTED_PROXIES` is which addresses your proxy connects from. It decides
whether forwarded headers (`X-Forwarded-For`, `X-Forwarded-Host`,
`X-Forwarded-Proto`) are believed at all, and it fills in `ADDRESS_HEADER`,
`HOST_HEADER` and `PROTOCOL_HEADER` for you. Unset, it means "any address on
the local network", which is correct for a proxy running on the same machine or
LAN.

Crucially, `PUBLIC_URL` applies **per request, matched on hostname**. A request
arriving on `serene.example.com` gets the public answer; a request arriving on
`localhost:3000` still auto-detects plain HTTP. One setting serves both at once,
so you never have to flip configuration between local and public access.

## Common hosting configurations

### Direct access, no proxy

Nothing to configure. `http://localhost:3000` (or whatever `HOST`/`PORT` you
set) works out of the box — real-time updates are served on the same origin as
the page, so there is nothing to detect or point anywhere.

### Reverse proxy or tunnel on the same host

The most common setup: a single public hostname (nginx, Nginx Proxy Manager,
Caddy, Cloudflare Tunnel, Traefik) in front of the app. One `location` block
covers everything, `/socket.io/` included — just keep the `Upgrade` and
`Connection` headers, which is what lets WebSockets through:

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

`/socket.io/` is served on the public origin along with everything else, so the
browser connects real-time updates back to `https://serene.example.com` — the
same origin it loaded the page from.

### Cloudflare Tunnel

Cloudflare Tunnel maps a public hostname to a local origin. It cannot expose an
arbitrary port, and Cloudflare's proxy only serves a fixed set of ports — which
used to make this the hardest setup to get right. With one listener there is
nothing special to do: point the tunnel at `http://localhost:3000` and set

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=127.0.0.1
```

The edge-to-`cloudflared` hop is always encrypted regardless of how the local
origin is configured, so `cloudflared` → proxy → app staying plain HTTP on your
own machine is normal and not a security concern.

> If you see **"Socket connection timeout"** with a Cloudflare Tunnel, check
> that WebSockets are enabled for the zone (Network settings) — the handshake
> starts as ordinary HTTP polling and then upgrades, so the page can load
> perfectly while the upgrade is being dropped.

### Docker

See [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md). The
same guidance applies — the container exposes one port (`PORT`), and the compose
files carry commented-out `PUBLIC_URL` and `TRUSTED_PROXIES` examples.

## Upgrading from 0.5.2 or earlier

Serene Pub used to run **two** listeners: the web app on `PORT`, and a separate
Socket.IO server on `SOCKETS_PORT` (default `3001`). From 0.5.3 there is one
listener. `PORT` binds it, and it serves `/socket.io/` itself.

Most installs upgrade with no changes at all. Exactly one thing genuinely stops
working, and it's worth checking first.

### 1. A proxy rule sending `/socket.io/` to port 3001 — this one breaks

**Symptom:** the page loads normally and then nothing happens. Messages don't
stream, model status never arrives, generation appears to hang forever. There's
no error page and often nothing useful in the console — the socket simply never
connects, so the app looks frozen rather than broken.

**Cause:** nothing listens on `3001` any more, so a proxy rule pointing there
has no upstream to reach.

**Fix:** delete the special-cased `/socket.io/` rule and let your normal
upstream serve that path along with everything else, making sure the WebSocket
`Upgrade`/`Connection` headers are forwarded.

nginx — one `location` covers the whole site:

```nginx
server {
    listen 443 ssl;
    server_name serene.example.com;

    # If you have a block like this, delete it — nothing listens on 3001:
    #
    #   location /socket.io/ {
    #       proxy_pass http://localhost:3001;
    #   }

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

`proxy_http_version 1.1` together with the `Upgrade`/`Connection` pair is what
lets nginx pass a WebSocket handshake through. Without them the page still
loads and the socket still fails — the same symptom as pointing at `3001`, from
a different cause.

Caddy — `reverse_proxy` forwards WebSocket upgrades on its own, so once the
`/socket.io/` special case is gone the whole site is one line:

```caddy
serene.example.com {
	# Delete any handle/reverse_proxy pair that routed sockets separately:
	#
	#   handle /socket.io/* {
	#       reverse_proxy localhost:3001
	#   }

	reverse_proxy localhost:3000
}
```

### 2. A leftover `-p 3001:3001` and `SOCKETS_PORT` — harmless

**Nothing is wrong here.** Publishing a container port that nothing inside the
container listens on is not an error: Docker sets up the forward, no process
accepts on it, and the container starts and runs exactly as it should.
`SOCKETS_PORT` is simply read by nothing.

You will, however, see both named at startup:

```
[Serene Pub] IGNORED hosting variables are set. Real-time updates share the app's own server, port and origin trust, so these have no effect and can be removed:
[Serene Pub]   SOCKETS_PORT=3001 — no second listener exists — PORT binds the one server, which serves /socket.io/ too
```

That notice is housekeeping, not a failure report. Drop the `- "3001:3001"`
line from your compose file and `SOCKETS_PORT` from your environment whenever
it's convenient; your instance works the same either way.

### 3. `ALLOWED_ORIGINS` and `SOCKETS_ALLOWED_ORIGINS` are ignored

Origin trust isn't configured any more. An origin whose hostname matches the
hostname the request itself arrived on is always allowed — that covers
`localhost`, a LAN IP, a port-mapped Docker host and any custom domain, with
nothing set at all — and `PUBLIC_URL`'s hostname is allowed alongside it, which
covers the one case that rule can't serve: a proxy that rewrites `Host` to an
internal name.

For nearly every install, the old allowlist was naming exactly the hostnames
that are now derived automatically, so deleting it changes nothing.

Two things really are gone, with no replacement:

- **`ALLOWED_ORIGINS=*` can't be re-created.** The check can no longer be
  switched off by any setting. With accounts disabled — the default — that
  wildcard handed an unauthenticated admin session to anything that could reach
  the port, which is why it was removed rather than renamed.
- **A non-browser client that sends no `Origin` header is accepted from the
  local network only, and that can't be widened.** If you were using the
  allowlist to let a script or a server-to-server integration connect from
  outside your LAN, that path is closed. Enable user accounts and connect with a
  token instead.

### 4. `SOCKETS_HTTP_MODE` and `SOCKETS_HTTPS_HOSTS` are ignored — check your cookies

These are the ones that can go wrong quietly. Both used to declare "this
deployment is HTTPS", and both are now read by nothing.

You're affected if **all** of the following are true:

- a TLS-terminating proxy sits in front of Serene Pub, and
- you relied on `SOCKETS_HTTP_MODE=https` or `SOCKETS_HTTPS_HOSTS=<your host>`
  to say so, and
- you have none of `PUBLIC_URL`, `TRUSTED_PROXIES` or
  `SERENE_PUB_SECURE_COOKIES` set.

In that case Serene Pub no longer has any way to know the deployment is HTTPS.
Nothing errors and the site keeps loading: session cookies quietly lose their
`Secure` flag and HSTS stops being advertised, on a site still served over
HTTPS. Serene Pub prints a targeted warning at startup when it sees exactly this
combination.

The fix is to state the public address:

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=127.0.0.1
```

`PUBLIC_URL=https://<your public hostname>` is the replacement for both
variables: it gives scheme and host together and is matched per request, so a
request arriving on `localhost:3000` still auto-detects plain HTTP at the same
time — there's nothing to flip between local and public access. Add
`TRUSTED_PROXIES` naming the address your proxy connects from if one fronts
you; that's what makes `X-Forwarded-Proto` believed at all, and it derives
`ADDRESS_HEADER`, `HOST_HEADER` and `PROTOCOL_HEADER` for you.

## Deprecated and ignored variables

Two different things live here, and the difference matters. A **deprecated**
variable still works, so you can migrate whenever you feel like it. An
**ignored** variable is read by nothing and its value has no effect at all.
Serene Pub prints both lists at startup, worded to match.

### Deprecated — still honored, migrate whenever

Nothing in this table is broken and nothing needs changing on a schedule. One
`PUBLIC_URL` replaces all of them.

| Deprecated (still honored) | Replace with |
|---|---|
| `SERENE_PUB_SECURE_COOKIES=true` | `PUBLIC_URL=https://<your hostname>` |
| `HOST_HEADER`, `PROTOCOL_HEADER`, `ADDRESS_HEADER` | `TRUSTED_PROXIES=<your proxy's address>` derives all three. |

### Ignored — read by nothing, remove them

These have no effect whatsoever. See
[Upgrading from 0.5.2 or earlier](#upgrading-from-052-or-earlier) above for
which of them actually breaks something (one does) and which are just clutter.

| Ignored | Why |
|---|---|
| `SOCKETS_PORT=3001` | No second listener exists. `PORT` binds the one server, which serves `/socket.io/` too. |
| `SOCKETS_ENDPOINT=<url>` | The browser opens its socket against the page's own origin; there is no other address to send it to. |
| `PUBLIC_SOCKETS_ENDPOINT=<url>` | Same, under its older name. |
| `SOCKETS_HTTPS_HOSTS=example.com` | Use `PUBLIC_URL=https://example.com`, which says scheme and host together and is matched per request. |
| `SOCKETS_HTTP_MODE=https` | Use `PUBLIC_URL=https://<your hostname>`. A global protocol override never suited an install reached both directly and through a proxy. |
| `ALLOWED_ORIGINS=<hosts>` | **Nothing — there is no replacement.** Origin trust is derived: an origin whose hostname matches the hostname the request arrived on is always allowed, and `PUBLIC_URL`'s hostname is allowed alongside it. `ALLOWED_ORIGINS=*` in particular is gone, so the allowlist can no longer be switched off. |
| `SOCKETS_ALLOWED_ORIGINS=<hosts>` | Same, under its older name. |

Why the endpoint overrides are gone rather than kept: each was a **global**
override, applied to every request regardless of which hostname it arrived on.
That made an install reachable both publicly and at `localhost` impossible to
configure correctly — fixing one broke the other. A same-origin connection has
the property those variables were trying to fake.

## Startup banner

Every start prints the configuration it actually resolved:

```
[Serene Pub] Public URL:  https://serene.example.com   (from PUBLIC_URL)
[Serene Pub] Local URL:   http://localhost:3000
[Serene Pub] Socket URL:  same origin as above — route /socket.io/ to port 3000 and forward the WebSocket upgrade
[Serene Pub] Trusted proxies: 172.16.0.0/12
[Serene Pub] Allowed origins: same-hostname (zero-config) + local network for non-browser clients
```

If a setting isn't doing what you expect, this is the first place to look — it
reports the resolved answer, not what you wrote.

## Security notes

- **Multi-user ("accounts") mode**: when disabled (the default), every socket
  connection is automatically treated as the first admin user with no login at
  all — appropriate for a single-person local instance, but it means **anyone
  who can reach the app's port has full access, and no origin check changes
  that**: someone who simply points their own browser at your address is not
  cross-origin, so nothing about them looks suspicious. If you are exposing the
  instance beyond your own machine — a port forward, a tunnel, a public reverse
  proxy — turn accounts on in System Settings. That is the control that matters
  here; the origin checks below defend against a different attack.
- **Origin trust needs no configuration, and cannot be switched off.** An
  origin whose hostname matches the hostname the request arrived on is always
  allowed, which covers localhost, LAN IPs and any custom domain with nothing
  set. A genuinely cross-origin page — the attack this defends against, since
  browsers do *not* apply CORS restrictions to a WebSocket upgrade — differs by
  hostname and is rejected. If your proxy rewrites `Host` to an internal name,
  set `PUBLIC_URL`; its hostname is allowed alongside the automatic match.
  `ALLOWED_ORIGINS` used to be able to disable all of this and is now ignored.
- **Non-browser clients are local-network only.** A client that sends no
  `Origin` header at all (a CLI tool, a server-to-server integration) is
  accepted only from a local-network address, and there is no way to widen
  that. If you need to reach an instance from elsewhere programmatically,
  enable user accounts and connect with a token.
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
| "Socket connection timeout", no CORS or 404 error at all | The WebSocket upgrade isn't getting through. Check that your proxy passes the `Upgrade` and `Connection` headers on `/socket.io/` (and that WebSockets are enabled at your CDN, if you use one). |
| Console shows "Mixed Content... has been blocked" | Not the real-time connection — it uses the page's own origin and cannot mismatch. Serene Pub does not know it is served over HTTPS, so something else emits an `http://` URL. Set `PUBLIC_URL=https://<your hostname>` and check your proxy sends `X-Forwarded-Proto`. |
| "blocked by CORS policy" pointing at your own domain | The `Origin` the browser sent doesn't match the `Host` your proxy forwarded — usually a proxy rewriting `Host` to an internal name. Forward the real one (`proxy_set_header Host $host`), or set `PUBLIC_URL` to the hostname your users actually type, which allowlists it. |
| Socket requests 404 at `/socket.io/...` | Requests aren't reaching the app at all, or reached it before the first page render — reload once, and check your proxy isn't intercepting `/socket.io/` and routing it elsewhere. A rule left over from the old `:3001` setup does exactly this; see [Upgrading from 0.5.2 or earlier](#upgrading-from-052-or-earlier). |
| Login rate limiting locks out everyone at once | `ADDRESS_HEADER` isn't set, so every user shares your proxy's address as one bucket. Set `TRUSTED_PROXIES`, which derives it. |
| Browser refuses to load `http://localhost:3000`, forcing HTTPS | An older build advertised HSTS over plain HTTP. Clear the entry at `chrome://net-internals/#hsts`. Fixed in current versions. |
| `.env` changes don't seem to apply | Variables read by the server framework itself (`PORT`, `HOST`, `ORIGIN`, `PROTOCOL_HEADER`, `HOST_HEADER`, `ADDRESS_HEADER`, `XFF_DEPTH`) must be set before any code runs. Current builds load `.env` early enough automatically; if you use a custom entrypoint, launch with `node --env-file=.env build/index.js`. The startup banner tells you which case you're in. |
