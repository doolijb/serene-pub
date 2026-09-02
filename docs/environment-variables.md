# Environment Variables

Serene Pub is configured almost entirely through environment variables rather than a settings file — there's no single config file to hand-edit before first launch. **If you're just running Serene Pub on your own computer, you can skip this entire page** — every variable below has a sensible default, and a normal local install needs none of them. This page exists for the cases where you _do_ need to change something: a portable install, running behind a reverse proxy, Docker, or tweaking a specific feature's behavior.

Variables can be set however your platform normally sets them (shell export, a process manager, a Docker `environment:` block, etc.), or by writing them into a `.env` file that Serene Pub reads on startup. That file belongs in your **data directory** — see [Where `.env` lives](#where-env-lives) below, which also explains why it is no longer next to the executable. Copying `.env.example` (in the project root, or at the top of an extracted release) and editing it is the easiest starting point.

For deployment-specific walkthroughs (reverse proxies, tunnels, Docker), see [Hosting Serene Pub](./hosting.md) and [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md) in the repository. This page focuses on what each variable does; those cover the surrounding setup.

## Where `.env` lives

`.env` goes in your **data directory**, next to the database:

| OS      | Path                                           |
| ------- | ---------------------------------------------- |
| Linux   | `~/.local/share/SerenePub/.env`                |
| Windows | `%APPDATA%\SerenePub\.env`                     |
| macOS   | `~/Library/Application Support/SerenePub/.env` |

If you've set `SERENE_PUB_DATA_DIR`, it's `<that directory>/.env` instead. You never have to guess: the startup banner prints an `Env files:` line naming the file (or files) it actually read.

Serene Pub reads three sources, highest priority first:

1. **Real environment variables** — always win. A Docker `environment:` block, a systemd `Environment=`, a shell `export`, or Node's `--env-file` flag all land here.
2. **`<dataDir>/.env`** — the file above. The place to keep configuration you edit by hand.
3. **`<installRoot>/.env`** — the top of the extracted `serene-pub/` folder, beside the `.env.example` shipped there. Falls back to the directory Serene Pub runs from, which is the same thing for a source checkout or Docker. Still read, indefinitely, but **deprecated**. If a file exists in both places the install-root one wins, and the startup banner names the one it ignored.

A lower source only supplies a variable nothing higher already set, so you can override one setting from the environment without touching your file — and a leftover install-directory `.env` can't shadow the file you actually meant to edit.

### Why it moved out of the install folder

Because that folder is disposable, and increasingly so:

- Updating Serene Pub **replaces the application folder wholesale** — a release keeps everything that _is_ the application in one `app/` folder precisely so an update can swap it in a single move, and the manual "extract the new zip over your old folder" path overwrites it the same way.
- `brew upgrade --cask` replaces the entire `.app`.
- A macOS app bundle is code-signed; editing a file inside it breaks the signature.
- An AppImage is a read-only filesystem, so you can't put a file beside the executable at all.

In every one of those cases a `.env` in the install folder is either deleted or impossible to write in the first place — silently, taking your admin password, recovery key and hosting settings with it. Your data directory is never touched by an update, which is why the database has always lived there and why configuration now does too. **If you move `.env` back next to the executable, the next update will eat it.**

### Upgrading an existing install

Move your `.env` into the data directory (see the table above) and restart. Nothing breaks if you don't get around to it: the old location keeps working, and Serene Pub prints a startup notice naming the variables still coming from it so you can see exactly what an update would cost you. Serene Pub does not move the file for you.

### `SERENE_PUB_DATA_DIR` is the one exception

`SERENE_PUB_DATA_DIR` chooses the data directory, so it can't be read from a file inside it. It can only come from a real environment variable (a launcher script, a systemd unit, a Docker `environment:` block) or from the install-root `.env` — which stays supported for exactly this reason. A relative value is resolved against the install root once, at startup, so it names the same directory no matter where you launch from.

## Portable / Self-Contained Setup

The most common reason to open this page: keeping Serene Pub's data in one folder you control (a USB drive, a synced folder, something you back up as a unit) instead of the OS-specific hidden location it uses by default (e.g. under your user profile on Windows, `~/.local/share` on Linux, `~/Library/Application Support` on macOS).

1. Extract a release. You get one `serene-pub/` folder, laid out like this — everything that _is_ the application lives in `app/`, and a `data/` folder beside it is yours:
    ```
    serene-pub/
      app/                  <- the application; an update replaces this whole folder
        run.sh | run.cmd    <- the server itself, for headless/service use
      run.sh | run.cmd      <- what you normally launch
      .env.example
      data/                 <- you create this
    ```
2. Create `.env` next to `run.sh` — at the top of the folder, _not_ inside `app/` — containing just:

    ```
    SERENE_PUB_DATA_DIR=./data
    ```

    A relative path is resolved against the top of the extracted folder, not against wherever you happened to launch from, so `./data` always means the `data/` shown above. An absolute path works too and is unambiguous.

    This is the [one variable](#serene_pub_data_dir-is-the-one-exception) that has to live in the install folder rather than in the data directory, since it's what chooses that directory. Put everything _else_ in `data/.env`. Serene Pub prints a startup notice listing anything it's still reading from the install folder.

3. Launch normally, with `run.sh`/`run.cmd` at the top of the folder. On first run, Serene Pub creates the database and `meta.json` inside `data/`. From then on, copying the entire `serene-pub/` folder anywhere — a different computer, a USB drive — brings your characters, sessions, connections, and settings with it.

If you're launching a built app directly with `node` rather than a packaged executable, Node's own `--env-file` flag is an alternative to Serene Pub's automatic `.env` loading:

```
node --env-file=data/.env build/index.js
```

That turns the file's contents into real environment variables before any code runs at all, which puts them in the highest-priority source and sidesteps module load order entirely. It isn't required — Serene Pub loads `.env` early enough for `PORT`, `HOST`, `PROTOCOL_HEADER`, `HOST_HEADER` and `ORIGIN` (which the underlying server framework reads before the app's own code runs) to apply — but it's the most explicit option, and the fallback if you're using a custom entrypoint that doesn't go through `build/index.js`. The startup banner tells you which case you're in.

## Data & Storage

| Variable              | Default                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERENE_PUB_DATA_DIR` | OS-appropriate user data directory | Where the database, `meta.json` (the secret key backing sessions and stored passphrases), your `.env`, the embedding model cache, and downloaded KoboldCPP binaries/models all live. Set this to keep everything in one folder you control — see [Portable / Self-Contained Setup](#portable--self-contained-setup) above. Because it chooses the directory `.env` is read from, it's the one variable that cannot be set in `<dataDir>/.env` — see [the exception](#serene_pub_data_dir-is-the-one-exception). |

## Feature Toggles

Small, self-contained switches for specific features — each is safe to try in isolation.

| Variable                           | Default                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERENE_AUTO_OPEN`                 | unset (a browser tab opens automatically) | Set to `1` or `true` to **disable** automatically opening a browser tab when Serene Pub starts.                                                                                                                                                                                                                                                                                                                                 |
| `USER_TOKEN_EXPIRATION_HOURS`      | `168` (7 days)                            | How long a login session lasts before it expires.                                                                                                                                                                                                                                                                                                                                                                               |
| `ENABLE_UNSAFE_CHARACTER_BROWSING` | unset (hidden)                            | Set to `true` to allow the Character Library's "include NSFW" toggle to appear when browsing external card sources (e.g. CharaVault). Still off by default even once enabled — this only unlocks the toggle, it doesn't turn NSFW results on by itself.                                                                                                                                                                         |
| `PUBLIC_DOCUMENT_VIEW_DEFAULT`     | `false`                                   | Set to `true` to make [Document View](./document-view.md) (the simplified, high-contrast, keyboard- and screen-reader-friendly interface) the default for anyone who hasn't visited yet. Only applies before a given browser has its own stored preference — once someone toggles Document View themselves, that choice always wins, even if this changes later. Useful for an install primarily used by vision-impaired users. |

## KoboldCPP Managed Mode

Only relevant if you're running KoboldCPP in [Managed mode](./connections.md) — where Serene Pub downloads and runs the KoboldCPP binary for you rather than you pointing it at a server you run yourself.

| Variable                | Default | Description                                                                                                                                                                                                                                                                             |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KOBOLDCPP_BINARY_DIR`  | unset   | Directory containing (or where an in-app download should place) the KoboldCPP binary. Only applied on first boot, or if managed mode isn't already configured — an already-working setup is never silently overridden. Useful for a Docker deployment mounting a pre-downloaded binary. |
| `KOBOLDCPP_BINARY_NAME` | unset   | Filename of a pre-existing binary inside `KOBOLDCPP_BINARY_DIR`, for pointing at a binary you provided yourself rather than letting Serene Pub download one.                                                                                                                            |

---

Everything below this point is deployment-level configuration — reverse proxies, Docker, hosting Serene Pub for more than just yourself. If that's not what you're doing, you're done reading.

## Server & Network

These are read by `@sveltejs/adapter-node` itself, before Serene Pub's own code runs — see the [portable setup note above](#portable--self-contained-setup) if changes to them don't seem to take effect.

| Variable                    | Default                   | Description                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                      | `3000`                    | Port the web server listens on. Real-time updates share it — see [Sockets](#sockets-real-time-updates) below.                                                                                                                                                                                                                                                       |
| `HOST`                      | `0.0.0.0`                 | Network interface the web server binds to.                                                                                                                                                                                                                                                                                                                          |
| `ORIGIN`                    | inferred from the request | Explicit public origin (e.g. `https://serene.example.com`). Set this if form submissions start failing behind a reverse proxy — SvelteKit uses it for CSRF checks.                                                                                                                                                                                                  |
| `NODE_ENV`                  | —                         | Set to `production` for a production build.                                                                                                                                                                                                                                                                                                                         |
| `SERENE_PUB_SECURE_COOKIES` | unset                     | Set to `true` when this deployment terminates TLS itself rather than sitting behind a proxy that sets `X-Forwarded-Proto`. Declares the whole deployment HTTPS: session cookies get `Secure`/`SameSite=strict`, HSTS is advertised, and the real-time endpoint uses `https`. **Deprecated in favor of `PUBLIC_URL`**, which says the same thing and more precisely. |
| `BODY_SIZE_LIMIT`           | `512K`                    | Maximum request body size accepted by the web server. Raise it if large character-card or image uploads fail.                                                                                                                                                                                                                                                       |
| `SHUTDOWN_TIMEOUT`          | `30`                      | Seconds to wait for in-flight requests to finish during a graceful shutdown.                                                                                                                                                                                                                                                                                        |
| `IDLE_TIMEOUT`              | `0` (disabled)            | Seconds of inactivity after which the server exits, for socket-activated setups.                                                                                                                                                                                                                                                                                    |

## Public URL and Proxy Trust

**These two variables are all a proxied deployment normally needs.** Everything else in this section exists for unusual setups or predates them.

| Variable          | Default   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PUBLIC_URL`      | unset     | The address your users actually type, as a full origin including the scheme — e.g. `https://serene.example.com`. Everything else is derived from it: whether requests count as HTTPS, whether session cookies get the `Secure` flag, whether HSTS is advertised, the URL the browser is told to open its real-time connection to, and SvelteKit's CSRF origin. Applied **per request, matched on hostname**, so a request arriving on `localhost:3000` still auto-detects plain HTTP — one setting serves local and public access at the same time, with nothing to flip between them. Not a base path: `/serene` is rejected with a warning. `SERENE_PUB_PUBLIC_URL` is accepted as an alias, and `ORIGIN` is used as a fallback when neither is set. |
| `TRUSTED_PROXIES` | `private` | Which addresses your reverse proxy connects from, comma-separated. Accepts CIDRs (`10.0.0.0/8`, `2001:db8::/32`), bare addresses, and the keywords `private` (loopback plus RFC1918 and link-local ranges — the default), `none`, and `*`. This decides whether forwarded headers are believed at all, and setting it derives `ADDRESS_HEADER`, `HOST_HEADER` and `PROTOCOL_HEADER` for you. Worth narrowing from the default: the app binds `0.0.0.0`, so `private` trusts every host on your LAN to claim a client IP.                                                                                                                                                                                                                               |

When `PUBLIC_URL` names the same origin your proxy serves `/socket.io/` on, the real-time endpoint is advertised **without a port** — which is what makes Cloudflare Tunnel and similar setups work, since they can't expose an arbitrary port like `3001`. See [Hosting Serene Pub](./hosting.md).

Serene Pub prints the configuration it actually resolved at startup, including which of these were used and any deprecated variables still set.

## Sockets (real-time updates)

Real-time updates (session messages, generation progress, model status) are served from the **same port as the web app**, under `/socket.io/`. There is no second server and nothing extra to route.

Earlier versions ran a separate real-time server on its own port, configured with `SOCKETS_PORT`, `SOCKETS_ENDPOINT`/`PUBLIC_SOCKETS_ENDPOINT`, `SOCKETS_HTTP_MODE` and `SOCKETS_HTTPS_HOSTS`. None of them are needed any more and none are documented here; `SOCKETS_ALLOWED_ORIGINS` is now `ALLOWED_ORIGINS`. If you are upgrading, delete all of them along with any second port mapping — Serene Pub lists whichever you still have set at startup, with the replacement for each. A reverse proxy needs only to forward WebSocket upgrade headers (`Upgrade`, `Connection`) for the one port it already proxies.

| Variable          | Default                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS` | not needed for most setups | Comma-separated hostnames (no scheme/port) explicitly allowed to open a realtime connection, beyond the automatic default (any origin matching the hostname the request itself arrived on). The app and its sockets share one server, so an ordinary browser tab is same-origin and already covered — this only matters where Origin and Host legitimately differ. Set to the literal value `*` to disable the allowlist entirely. |

## Account recovery

Setting any of these requires access to the environment the app runs in — that
access _is_ the authorization, in the same way it is for editing the database
directly.

| Variable                       | Default | Description                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERENE_PUB_ADMIN_USERNAME`    | unset   | **First boot only.** Names the initial admin account. Ignored once that account has a password.                                                                                                                                                                                                                                                               |
| `SERENE_PUB_ADMIN_PASSWORD`    | unset   | **First boot only.** Sets the initial admin's password. Ignored once one exists, so it can never overwrite a password you chose later.                                                                                                                                                                                                                        |
| `SERENE_PUB_ENABLE_ACCOUNTS`   | off     | **First boot only.** Enables user accounts automatically, for unattended deployments. Requires `SERENE_PUB_ADMIN_PASSWORD` to also be set and valid — enabling accounts is a one-way change, so doing it without a working password would lock everyone out. Ignored on an existing install, and on Android (single-user by design).                          |
| `SERENE_PUB_RECOVERY_KEY`      | unset   | A string you choose, paired with `SERENE_PUB_RECOVERY_PASSWORD`. On the next boot the admin password is reset, two-factor is cleared, and all sessions are revoked. The key is then recorded as spent — booting again with the same key does nothing, so the variables can stay in place harmlessly. Use a **new** key to reset again. Stored only as a hash. |
| `SERENE_PUB_RECOVERY_PASSWORD` | unset   | The password `SERENE_PUB_RECOVERY_KEY` sets. Must meet the same rules the app's UI enforces; a password that fails them is refused and the key stays unspent.                                                                                                                                                                                                 |

## Reverse Proxy Trust

Unset by default, meaning Serene Pub does **not** trust forwarded headers — every request looks like plain HTTP from the proxy's own address, since that's genuinely what the proxy sends.

**Setting `TRUSTED_PROXIES` fills all three of these in for you**, so you normally don't need to touch them directly. They remain available for setups using non-standard header names. Note these are read by `@sveltejs/adapter-node` itself, before Serene Pub's own code runs.

| Variable          | Default | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_HEADER`     | unset   | Header holding the real client-facing hostname, e.g. `x-forwarded-host`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PROTOCOL_HEADER` | unset   | Header holding the real client-facing protocol, e.g. `x-forwarded-proto`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ADDRESS_HEADER`  | unset   | Header holding the real client IP, e.g. `x-forwarded-for`. **Login rate limiting depends on this being set correctly** when behind a proxy — without it every user's failed logins share one bucket (the proxy's own address), so one person can lock everyone out. Only trusted when the request's direct peer passes `TRUSTED_PROXIES`, so it's safe on an install that's also reached directly and a remote client can't spoof past the rate limiter. Serene Pub prints a one-time startup warning if it sees a forwarded-for header arrive while this is unset. |
| `XFF_DEPTH`       | `1`     | How many proxies `@sveltejs/adapter-node` should count back through when reading `X-Forwarded-For`. Leave it alone: Serene Pub resolves the client address itself using depth-independent chain walking and never relies on this. It only affects code calling SvelteKit's `getClientAddress()` directly, which this app does not do.                                                                                                                                                                                                                               |
| `PORT_HEADER`     | unset   | Header holding the real client-facing port. Rarely needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Content Security Policy

Serene Pub ships a strict Content-Security-Policy by default; it isn't a header you can disable via an env var. These are applied at runtime, so they take effect on a prebuilt release or Docker image without rebuilding. These add extra allowed sources for content your hosting layer injects into the page that isn't part of the app itself — most commonly Cloudflare's "Browser Insights" beacon when a zone is proxied through Cloudflare with that feature on. Prefer disabling such features at the CDN/proxy level over widening these, since it's third-party content the app has no control over.

| Variable                | Default | Description                                                |
| ----------------------- | ------- | ---------------------------------------------------------- |
| `CSP_EXTRA_SCRIPT_SRC`  | unset   | Comma-separated extra allowed script sources.              |
| `CSP_EXTRA_STYLE_SRC`   | unset   | Comma-separated extra allowed stylesheet sources.          |
| `CSP_EXTRA_CONNECT_SRC` | unset   | Comma-separated extra allowed fetch/XHR/WebSocket targets. |

## Development Only

These only matter if you're running Serene Pub from source against an external PostgreSQL database for development. A normal install — including every production deployment — uses an embedded database automatically and never needs these.

| Variable            | Default     | Description                   |
| ------------------- | ----------- | ----------------------------- |
| `DATABASE_URL`      | `localhost` | External PostgreSQL host.     |
| `DATABASE_PORT`     | `3002`      | External PostgreSQL port.     |
| `POSTGRES_USER`     | `postgres`  | External PostgreSQL username. |
| `POSTGRES_PASSWORD` | `password`  | External PostgreSQL password. |
