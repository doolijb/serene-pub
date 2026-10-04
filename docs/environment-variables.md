# Environment variables

Environment variables are settings Serene Pub reads once, when it starts: its port, where it keeps data, how it sits behind a proxy.

:::tip You may never need this page
If you run Serene Pub on your own computer, skip it: every variable has a sensible default, and a normal install needs none of them. Settings you change while using the app are in **Settings** and the admin area, not here. This page is for a portable install, a server, a reverse proxy, Docker, or account recovery.
:::

For walkthroughs of proxies, tunnels and containers, see [Hosting](./hosting.md) and [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md).

## Where `.env` lives

Set variables however your system normally does (a Docker `environment:` block, a systemd unit, a shell `export`), or write them into a file named `.env` in your **data folder**, next to the database:

| System | Path |
| --- | --- |
| Linux | `~/.local/share/SerenePub/.env` |
| Windows | `%LOCALAPPDATA%\SerenePub\Data\.env` |
| macOS | `~/Library/Application Support/SerenePub/.env` |

If you've set `SERENE_PUB_DATA_DIR`, it's `<that folder>/.env` instead. The easiest start is to copy `.env.example` (at the top of the extracted release) to that path and uncomment what you need. Each line is `NAME=value`.

You never have to guess which file was used: every start prints an `Env files:` line naming the files Serene Pub actually read.

Three places are read, highest priority first. A lower one only fills in what nothing higher has set:

1. **Real environment variables**: a Docker `environment:` block, a systemd `Environment=`, a shell `export`, or Node's `--env-file`.
2. **`<data folder>/.env`**: the file above, the one to edit by hand.
3. **`<install folder>/.env`**: a `.env` at the top of the extracted `serene-pub` folder (or in the folder Serene Pub runs from, for Docker or a source checkout). Still read, but only `SERENE_PUB_DATA_DIR` belongs there; Serene Pub prints a notice naming anything else it finds, so you can move it.

Don't keep settings inside the install folder: an update replaces the app's files, and a `.env` there can be lost with them. Your data folder is never touched by an update.

### `SERENE_PUB_DATA_DIR` is the one exception

`SERENE_PUB_DATA_DIR` chooses the data folder, so it can't be read from a file inside it. Set it as a real environment variable, or in the `.env` at the top of the install folder. A relative path is taken from the top of the install folder, so it means the same place however you start Serene Pub.

## Portable, self-contained setup

To keep everything in one folder you control (a USB drive, a synced folder, something you back up as a unit) instead of the system's hidden data location:

1. Extract a release. You get one `serene-pub/` folder. Everything that *is* the application lives in `app/`; a `data/` folder beside it will be yours:
    ```
    serene-pub/
      Serene Pub.exe | serene-pub   <- the launcher: what you normally start
      app/                          <- the application; an update replaces this whole folder
      .env.example
      data/                         <- you create this
    ```
    (On macOS the launcher and `app/` are inside **Serene Pub.app**; the folder that holds it plays the part of `serene-pub/`.)
2. Create `.env` at the top of the folder, next to the launcher (not inside `app/`), containing just:

    ```
    SERENE_PUB_DATA_DIR=./data
    ```

    Put every other setting in `data/.env`.

3. Start Serene Pub as usual. The first start creates the database and `meta.json` inside `data/`. From then on, copying the whole `serene-pub/` folder anywhere brings your characters, sessions, connections and settings with it.

## Data and storage

| Variable | Default | What it does |
| --- | --- | --- |
| `SERENE_PUB_DATA_DIR` | your system's data location (table above) | Where the database, `meta.json` (the secret behind sign-ins and stored passphrases), backups, `.env`, downloaded models and the KoboldCPP program all live. See [the exception](#serene_pub_data_dir-is-the-one-exception) for where it can be set. |
| `TRANSFORMERS_CACHE` | `<data folder>/models/embeddings` and `<data folder>/models/ner` | Where the on-device embedding and named-entity models are downloaded. Set, it is used for both. |

## Feature toggles

Small, self-contained switches. Each is safe to try on its own.

| Variable | Default | What it does |
| --- | --- | --- |
| `AUTO_OPEN_CLIENT` | `1` | Set to `0` to stop Serene Pub opening anything when it starts, or after an update. The desktop launcher reads it (its tray menu's **Open on start** writes it to your data folder's `.env`), and with it on still opens nothing after an update while a tab or window is already connected; a server started without the launcher reads it too and opens a browser tab. (An older `SERENE_AUTO_OPEN=1` meant the same as `AUTO_OPEN_CLIENT=0`, and is still read when this is unset.) Never opens anything in Docker. |
| `DEFAULT_CLIENT` | `window` | What the desktop launcher opens: `window` (Serene Pub in its own window) or `browser` (a tab in your web browser). The tray menu's **Default: Window / Browser** writes it. Where a window can't be shown (no WebView2 on Windows, no WebKitGTK on Linux), the launcher opens the browser instead. Without the launcher it has no effect. |
| `USER_TOKEN_EXPIRATION_HOURS` | `168` (7 days) | How long a sign-in lasts before you have to sign in again. |
| `ENABLE_UNSAFE_CHARACTER_BROWSING` | unset | Set to `true` to let the character Library show an **include NSFW** option when browsing outside sources such as CharaVault. It only makes the option appear; it stays off until someone turns it on. |
| `PUBLIC_DOCUMENT_VIEW_DEFAULT` | `false` | Set to `true` to open [Document View](./document-view.md) (the simplified, high-contrast, screen-reader-friendly version) by default in any browser that hasn't chosen yet. Someone who switches views keeps their choice. |
| `SP_PLUGINS_ENABLED` | unset (off) | Set to `1` or `true` to run plugins: their hooks, sandbox and components. Off, you can still install and configure plugins under **Admin › Plugins**, which says the sandbox is off, but they do nothing. Releases ship with it off. |

## Desktop launcher

The launcher (the program behind the tray icon) starts the app with these set, so the app knows how it was started and where an update goes. They are the launcher's to set: setting them yourself doesn't make an install updatable, and a wrong value only switches in-app updates off. They're listed here so a support report or a process listing makes sense.

| Variable | Set to | What it tells the app |
| --- | --- | --- |
| `SERENE_PUB_INSTALL_ROOT` | the `serene-pub` folder (on macOS, the folder holding **Serene Pub.app**) | Where the install is. A relative `SERENE_PUB_DATA_DIR` is taken from here. `app/run.sh` and `app/run.cmd` set it too. |
| `SERENE_PUB_LAUNCHER_VERSION` | the launcher's version | That it was started by the launcher. Unset means it was started some other way, and [updating from the app](./updating.md) is off. |
| `SERENE_PUB_UPDATE_CHANNEL` | `portable` for the release zips | How this install is updated. Pre-release builds carry `prerelease`, and never update. |
| `SERENE_PUB_TARGET` | `linux-x64`, `windows-x64`, `macos-x64` or `macos-arm64` | Which release download fits this install. |
| `SERENE_PUB_UPDATE_DIR` | `staging` inside the `serene-pub` folder (macOS: `.serene-pub-staging` beside the app) | Where a downloaded update is unpacked before the launcher swaps it in. |

The launcher itself reads `SERENE_PUB_DATA_DIR`, `AUTO_OPEN_CLIENT` and `DEFAULT_CLIENT` from the same places the app does (above), and it only ever writes `AUTO_OPEN_CLIENT` and `DEFAULT_CLIENT` to your data folder's `.env`, keeping every other line as it was. A variable set in your system's real environment wins, and the tray menu shows it as set by your system.

## KoboldCPP run by Serene Pub

Only for [KoboldCPP, run by Serene Pub](./connections.md#koboldcpp-run-by-serene-pub), where Serene Pub downloads and runs KoboldCPP for you.

| Variable | Default | What it does |
| --- | --- | --- |
| `KOBOLDCPP_BINARY_DIR` | unset | The folder holding the KoboldCPP program, or where a download from the app should put it. Read on the very first start only, so it never overrides a setup that already works. Useful for a Docker image with KoboldCPP mounted in. |
| `KOBOLDCPP_BINARY_NAME` | unset | The file name of a KoboldCPP program you provided inside `KOBOLDCPP_BINARY_DIR`, instead of letting Serene Pub download one. |

## Tunnels

| Variable | Default | What it does |
| --- | --- | --- |
| `SERENE_PUB_CLOUDFLARED_PATH` | unset | The path to a `cloudflared` program you've already installed, for the [built-in tunnel](./system-settings.md#network) to use instead of downloading its own. Useful on a machine that can't reach GitHub. |

---

Everything below is for running Serene Pub as a server for other people. If that's not you, you're done.

## Server and network

Read by the web server itself before the rest of the app starts. Serene Pub loads `.env` early enough for them to apply.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | The port Serene Pub listens on. Live updates share it. |
| `HOST` | `0.0.0.0` (every network) | Which network it listens on. `127.0.0.1` allows only this computer, or a proxy on it. |
| `ORIGIN` | worked out from each request | The public origin, used for form checks. `PUBLIC_URL` sets it for you; set it yourself only if form submissions fail behind a proxy and you can't use `PUBLIC_URL`. |
| `BODY_SIZE_LIMIT` | `512K` | The largest request the server accepts. Raise it if large card or image uploads fail. |
| `SHUTDOWN_TIMEOUT` | `30` | Seconds to let requests finish when Serene Pub is stopped. |
| `IDLE_TIMEOUT` | `0` (off) | Seconds without activity after which the server exits, for socket-activated setups. |

## Public URL and proxy trust

**These two are all a server behind a proxy normally needs.** [Hosting](./hosting.md#the-two-settings-that-matter) explains them with examples.

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | unset | The address people type, with the scheme: `https://serene.example.com`. Everything else follows from it: HTTPS, `Secure` cookies, HSTS, where the browser opens its live connection, and `ORIGIN`. It applies only to requests arriving on that hostname, so `http://localhost:3000` keeps working beside it. It must be an origin, not a path: `https://example.com/serene` is refused with a warning. `SERENE_PUB_PUBLIC_URL` is accepted as another name for it. |
| `TRUSTED_PROXIES` | unset | The addresses your reverse proxy connects from, comma-separated: networks (`10.0.0.0/8`, `2001:db8::/32`), single addresses, or `private` (this computer plus every local network range), `none` or `*`. Setting it makes Serene Pub read the forwarded headers below from those addresses only. Name your proxy rather than using `private`, which trusts every device on your network. |

## Allowed origins

A browser may open a live connection to Serene Pub from the same hostname it loaded the page from, with no setting at all. Programs that send no origin are allowed only from your local network.

| Variable | Default | What it does |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | unset | Extra hostnames (no scheme or port), comma-separated, that may open a live connection, for the rare setup where the page and the connection use different hostnames. `*` switches the check off entirely, which is unsafe: see [Hosting](./hosting.md#security-notes). |

## Account recovery

Only someone who can change the server's settings can use these, and that access is what makes them safe. See [Users and accounts](./users-and-accounts.md#if-the-admin-account-itself-is-locked-out).

| Variable | Default | What it does |
| --- | --- | --- |
| `SERENE_PUB_ADMIN_USERNAME` | unset | **First start only.** The first administrator's username. |
| `SERENE_PUB_ADMIN_PASSWORD` | unset | **First start only.** The first administrator's passphrase. Ignored once one is set, so it can never overwrite a passphrase chosen later. |
| `SERENE_PUB_ENABLE_ACCOUNTS` | off | **First start only.** Turns user accounts on, for setting up a server unattended. Needs a valid `SERENE_PUB_ADMIN_PASSWORD` too, since accounts can't be turned off again. Ignored on an existing pub, and on Android. |
| `SERENE_PUB_RECOVERY_KEY` | unset | Any string you choose, together with `SERENE_PUB_RECOVERY_PASSWORD`. On the next start, the first administrator's passphrase is reset, their two-factor is cleared and their sessions are signed out. The key is then used up, so the variables can stay in place harmlessly; use a **new** key to reset again. Only a hash of it is stored. |
| `SERENE_PUB_RECOVERY_PASSWORD` | unset | The new passphrase for `SERENE_PUB_RECOVERY_KEY`. It must follow the usual rule (at least 10 characters, with an uppercase letter, a lowercase letter and a special character); one that doesn't is refused and the key stays unused. |

## Forwarded headers

`TRUSTED_PROXIES` sets the first three for you. Set them by hand only if your proxy uses unusual header names.

| Variable | Default | What it does |
| --- | --- | --- |
| `HOST_HEADER` | unset | The header holding the hostname the visitor used, such as `x-forwarded-host`. |
| `PROTOCOL_HEADER` | unset | The header holding the visitor's protocol, such as `x-forwarded-proto`. |
| `ADDRESS_HEADER` | unset | The header holding the visitor's address, such as `x-forwarded-for`. The sign-in rate limit depends on it: without it, every visitor behind a proxy shares one limit. It's only believed from addresses `TRUSTED_PROXIES` allows. Serene Pub warns once at startup if forwarded addresses arrive while it's unset. |
| `PORT_HEADER` | unset | The header holding the visitor's port. Rarely needed. |
| `XFF_DEPTH` | `1` | Leave it alone: Serene Pub works out the visitor's address itself and doesn't use it. |

## Content Security Policy

Serene Pub always sends a strict Content Security Policy. These add sources for content your proxy or CDN injects into the page, most often Cloudflare's Browser Insights beacon. Turning such features off at the CDN is better than allowing them. They apply when Serene Pub starts, so a release or Docker image needs no rebuild.

| Variable | Default | What it does |
| --- | --- | --- |
| `CSP_EXTRA_SCRIPT_SRC` | unset | Extra allowed script sources, comma-separated. |
| `CSP_EXTRA_STYLE_SRC` | unset | Extra allowed stylesheet sources, comma-separated. |
| `CSP_EXTRA_CONNECT_SRC` | unset | Extra allowed addresses for requests and live connections, comma-separated. |

## Older variables

`SOCKETS_HTTPS_HOSTS`, `SOCKETS_HTTP_MODE` and `SERENE_PUB_SECURE_COOKIES` still work but are replaced by `PUBLIC_URL`; `PUBLIC_SOCKETS_ENDPOINT`, `SOCKETS_PORT`, `SOCKETS_ENDPOINT` and `SOCKETS_ALLOWED_ORIGINS` are no longer read: delete them. Serene Pub warns at startup about the first three and about `PUBLIC_SOCKETS_ENDPOINT`. See [Upgrading an older proxy setup](./hosting.md#upgrading-an-older-proxy-setup).
