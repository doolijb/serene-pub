# Hosting Serene Pub

Reach your pub from other devices, from outside your home, or from behind a reverse proxy, a tunnel or a container.

:::tip You may never need this page
If you only use Serene Pub on the computer it runs on, there's nothing to set up here. Come back when you want to reach it from somewhere else.
:::

Every variable named on this page is described in [Environment variables](./environment-variables.md), with where to put it. For Docker images, volumes and compose files, see [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md) in the repository.

## First: turn on accounts

Until [user accounts](./users-and-accounts.md) are on, anyone who can reach your pub is its administrator, with no sign-in. That's fine on your own computer. Before anyone else can reach it, turn accounts on in **Admin › General**. The built-in tunnel won't start until you do.

## On your home network

Serene Pub listens on every network your computer is on, so a phone or another computer on the same Wi-Fi can already open it at `http://<your computer's address>:3000` (for example `http://192.168.1.42:3000`). [Install](./install.md#everyday-use) shows how to find that address. Nothing needs configuring.

To allow only the computer it runs on, set `HOST=127.0.0.1`.

## From anywhere: the built-in tunnel

The simplest way to reach your pub from outside your home is the tunnel in **Admin › Pub › Network**. It goes through Cloudflare, so there's nothing to change on your router and no address to buy.

- **Easy**: a free Cloudflare quick tunnel. No account needed, but the address is random and changes every time the tunnel restarts, so a link you share lasts only until then.
- **Custom domain**: your own hostname on a free Cloudflare account, with an address that stays the same.

Press **Start tunnel**; once it reads *Running*, **Copy link** gives you the public address. [Pub settings](./system-settings.md#network) describes every option on the card. Tunnels aren't available in the Android app.

The rest of this page is for running your own front door instead: a reverse proxy, your own Cloudflare Tunnel, or a container.

## What a proxy must do

Serene Pub is **one server on one port** (`3000` unless you set `PORT`). Live updates (new messages, a reply being written, model status) travel over a WebSocket connection on that same port, under `/socket.io/`. So a reverse proxy or tunnel in front of it has one thing to remember: it **must pass WebSocket upgrades through** (the `Upgrade` and `Connection` headers). Without that, pages load but nothing updates live.

## The two settings that matter

Behind a proxy, set exactly two variables:

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=127.0.0.1
```

**`PUBLIC_URL`** is the address people actually type. Everything else follows from it: that requests are HTTPS, that sign-in cookies are marked `Secure`, the HSTS header, where the browser opens its live connection, and the origin used for form checks. It applies **only to requests arriving on that hostname**, so the same pub still answers plainly on `http://localhost:3000` at the same time. There's nothing to switch between local and public use.

**`TRUSTED_PROXIES`** is the address (or range) your proxy connects from. Only requests from there have their forwarded headers (`X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`) believed, and setting it turns on reading those headers. Without it, every visitor looks like the proxy, so they share one sign-in rate limit and one person's failed attempts can lock everyone out.

## Reverse proxy or tunnel on the same host

The usual setup: nginx, Nginx Proxy Manager, Caddy, Traefik or your own Cloudflare Tunnel on the same machine, with one public hostname. Proxy the one port and pass WebSocket upgrades through. For nginx:

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

Then:

```
PUBLIC_URL=https://serene.example.com
TRUSTED_PROXIES=127.0.0.1
```

`/socket.io/` is served by the same `location /`, so there's nothing else to route. If the proxy runs on the same machine, also consider `HOST=127.0.0.1` so the pub can only be reached through it.

### Your own Cloudflare Tunnel

Point the tunnel's public hostname at `http://localhost:3000` (or at a local proxy in front of it). `cloudflared` passes WebSocket upgrades through by itself. Use the same two settings as above. The hop from Cloudflare to `cloudflared` is always encrypted, so plain HTTP between `cloudflared` and the app on your own machine is normal.

### Proxy on another machine or in Docker

Set `TRUSTED_PROXIES` to the proxy's address or network instead of `127.0.0.1`, for example `TRUSTED_PROXIES=172.16.0.0/12` for a proxy on a Docker network. The container exposes only `PORT`; the compose files in the release carry commented-out `PUBLIC_URL` and `TRUSTED_PROXIES` lines to fill in.

## Check what it resolved

Every start prints the configuration Serene Pub actually worked out, for example:

```
[Serene Pub] Public URL:  https://serene.example.com   (from PUBLIC_URL)
[Serene Pub] Local URL:   http://localhost:3000
[Serene Pub] Trusted proxies: 172.16.0.0/12
[Serene Pub] Allowed origins: same-hostname (zero-config) + local network for non-browser clients
```

It also names the `.env` files it read, and warns about any setting it doesn't expect. When something isn't doing what you meant, look here first: it shows the answer, not what you wrote.

## Security notes

- **Turn accounts on** before anyone else can reach the pub (see [above](#first-turn-on-accounts)).
- **Allowed origins need no setting.** A browser may open a live connection from the same hostname it loaded the page from; programs that send no origin (scripts, the Android app's own view) are allowed only from your local network. `ALLOWED_ORIGINS` adds extra hostnames for the rare setup where the page and the connection use different ones.
- **Don't set `ALLOWED_ORIGINS=*`.** It switches the check off entirely, for browsers and other programs alike. With accounts off, anything that reaches the port gets an administrator. Serene Pub warns at startup when it's set.
- **Narrow `TRUSTED_PROXIES`.** Set to `private`, it trusts every device on your local network to report a visitor's address, so any of them could dodge the sign-in rate limit. Name your proxy's own address instead.
- **Keep `meta.json` with your database.** It sits in your [data folder](./environment-variables.md#data-and-storage) and holds the secret that sign-ins and stored passphrases depend on. Serene Pub's own backups keep a copy beside every database backup; if you back up by hand, copy it too. Restoring a database without it signs everyone out and makes every stored passphrase stop working.
- **Backups leave out your pictures unless you ask.** By default a backup holds the database only. If the disk is lost and you restore one, characters and sessions come back but their avatars, sprites and media don't. Turn on **Include user files** in **Admin › Data and backups**, or copy the data folder's `users/` folder yourself. Each backup is also built in memory before it's written, so the server briefly needs about as much free memory as the compressed database takes on disk.
- **Sign-ins last** `USER_TOKEN_EXPIRATION_HOURS` (7 days by default). The cookie can't be read by page scripts, is `Secure` over HTTPS, and **Logout** ends the session on the server at once.
- **Content Security Policy** is on and strict. If your proxy or CDN injects its own scripts, the browser console shows a CSP error naming the blocked address. Most often it's Cloudflare's Browser Insights beacon (`static.cloudflareinsights.com`): turn that off in Cloudflare (Speed → Optimization → Browser Insights), or allow it with `CSP_EXTRA_SCRIPT_SRC`.

## Troubleshooting

| What you see | Likely cause |
| --- | --- |
| Pages load but nothing updates; "Socket connection timeout" | The proxy or tunnel isn't passing WebSocket upgrades. Pass `Upgrade` and `Connection` through, as in the nginx example. |
| Requests to `/socket.io/...` return 404 | Something in front of the app sends `/socket.io/` elsewhere. Proxy it to the app's port like every other path. |
| "Mixed Content ... has been blocked" in the console | The page was served over `http://` inside an `https://` site. Check the proxy, and set `PUBLIC_URL=https://<your hostname>`. |
| "blocked by CORS policy" naming your own domain | The proxy changes the `Host` header. Forward the original `Host`, or set `TRUSTED_PROXIES` so `X-Forwarded-Host` is believed. `ALLOWED_ORIGINS` is the last resort. |
| One person's failed sign-ins lock everyone out | Forwarded addresses aren't being read, so everyone shares the proxy's address. Set `TRUSTED_PROXIES`. |
| Changes to `.env` do nothing | Check the file is where Serene Pub looks: `<data folder>/.env` (see [Where `.env` lives](./environment-variables.md#where-env-lives)). The startup banner's `Env files:` line names the files it read. With a custom start command that skips the bundled one, start with `node --env-file=<data folder>/.env build/index.js`. |

## Upgrading an older proxy setup

Older releases used other variables for the same jobs. Where they still work, Serene Pub warns about each one at startup and names what replaces it:

| Old | Use instead |
| --- | --- |
| `SOCKETS_HTTPS_HOSTS=example.com`, `SOCKETS_HTTP_MODE=https`, `SERENE_PUB_SECURE_COOKIES=true` | `PUBLIC_URL=https://example.com` |
| `HOST_HEADER`, `PROTOCOL_HEADER`, `ADDRESS_HEADER` set by hand | `TRUSTED_PROXIES=<your proxy's address>`, which sets all three. The old way still works without a warning. |
| `PUBLIC_SOCKETS_ENDPOINT` | Nothing: delete it. It's ignored. |
| `SOCKETS_PORT`, `SOCKETS_ENDPOINT` | Nothing: delete them, and any second port mapping such as `3001`. They're no longer read. |
| `SOCKETS_ALLOWED_ORIGINS` | `ALLOWED_ORIGINS`. The old name is no longer read. |
