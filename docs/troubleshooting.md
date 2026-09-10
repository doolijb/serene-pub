# Troubleshooting

This page collects the most common ways Serene Pub gets stuck, organized by area, with a pointer to the full explanation elsewhere in the docs. If something here doesn't resolve it, [open an issue](https://github.com/doolijb/serene-pub/issues) or ask in [Discord](https://discord.gg/3kUx3MDcSa).

## Connections

- **"Test: Failed!" on a connection.** The error shown directly under the Test Connection button is the real cause (bad Base URL, missing/incorrect API key, service not running, wrong port) — read it before assuming the connection type is broken. See [Connections](./connections.md).
- **Model output is garbled, run-on, or ignores turn boundaries.** This is almost always the wrong **Prompt Format** for a text-completion connection — check it against the model's actual training format. See [Prompt Formats and Token Counters](./connections.md#prompt-formats-and-token-counters).
- **Context budget seems off (too much or too little history/lore fits).** Check the connection's **Token Counter** — leaving it on the generic **Estimate** for a model with unusual tokenization can under- or over-estimate how much fits under the Sampling Config's Context Tokens limit.
- **A custom Context Config broke every session using it.** A malformed Handlebars template can break generation instance-wide. Test edits on a low-stakes session before setting a custom Context Config as your default. See [Context Configs](./context-templates.md).

## KoboldCPP Manager

- **Binary download or auto-start failed.** The real underlying error is shown inline (download failure) or under the colored status dot on the **Performance** tab (start failure) — read that message first. See [Troubleshooting: download or start failures](./connections.md#troubleshooting-download-or-start-failures).
- **Failing right after setup on Docker or a NAS.** The most common cause is the app's data directory (where the KoboldCPP binary/admin directory live) being a mounted volume the container's user can't write to. Confirm the container can create directories and write files in its mounted data volume before assuming the download itself is broken.
- **A model reload takes a while after switching connections or editing GPU Layers/Flash Attention/Batch Size.** This is expected — those settings only take effect the _next_ time the connection generates, and a reload can take up to 10 minutes for a large model. See the [reload-on-change note](./connections.md#power-user-note-gpu-layers-flash-attention-batch-size-and-reload-on-change).

## Ollama Manager

- **"Update Available" but nothing updates in-app.** Serene Pub can't update Ollama itself — the callout links out to `ollama.com/download` because updating the Ollama installation is outside Serene Pub's control.

## Embeddings & RAG

- **The embeddings queue is stuck at "Idle" with items still waiting.** Check the **Settings** tab first: the queue silently stops if embeddings are disabled, if a local model failed to auto-load (not cached, or the server restarted and needs a reload), or if an External API config stopped validating. Reload/re-download the model, then press **Start** on the Queue tab. See [Troubleshooting a stuck or empty queue](./embeddings-and-rag.md#troubleshooting-a-stuck-or-empty-queue).
- **A specific session's RAG notice never clears.** Use that notice's **Prioritize in queue** button to jump its content to the front of the embeddings queue.
- **RAG doesn't seem to retrieve anything in a short session.** Sessions with 10 or fewer messages are expected to show no RAG activity — everything already fits in the guaranteed context window. See [Why some short sessions never show RAG activity](./embeddings-and-rag.md#why-some-short-sessions-never-show-rag-activity).

## Summarization, Scenes & the Narrative Graph

- **A graph build, scene summarization, or compile job sits at "running" too long.** Check the admin **LLM Queue** tab (Activity sidebar) to see whether the underlying generation call is queued behind other work, still generating, or has silently disappeared — the latter usually means an error on the connection side. See [Troubleshooting a job that seems stuck](./summarization.md#troubleshooting-a-job-that-seems-stuck).
- **The Graph tab isn't showing up on a lorebook.** It only appears when Summarization is enabled system-wide (System Settings) — Embeddings/Vectorization has no bearing on it. See [Lorebooks](./lorebooks.md#graph-tab).
- **"Generate Summary" refuses to run on a Scene selection.** The selected messages must form one consecutive, gap-free run with no unselected visible message in between — reselect a truly contiguous range.
- **Character Lore summarization won't generate.** Unlike World Lore, a Character Lore summary requires a focus topic (e.g. "abilities" or "relationship with Kira") before it will run.
- **A scene's "ready to process" count for the graph seems low.** Step 4 (Build/Extend Graph) silently skips any scene that hasn't been through Process Scene (or reviewed from the initial Summarize-to-Lorebook step) yet — check for scenes still missing a summary. See [The Scene → History → Graph Pipeline](./lorebooks.md#the-scene-history-graph-pipeline).

## Accounts & Login

- **"Enable User Accounts" looks locked/greyed out.** This is intentional — enabling User Accounts is a one-way, permanent switch with no UI path back to single-user mode.
- **A standard user or second admin forgot their passphrase.** An admin resets it from the Users panel — **Edit** the account and fill in **New Passphrase** / **Confirm Passphrase**; leaving those fields blank leaves the existing passphrase untouched.
- **Locked out of the `admin` account after enabling User Accounts.** There's currently no self-service or API recovery path for this — no reset endpoint, no CLI script. The only way back in is direct database access to update the stored passphrase hash. Avoid this situation by keeping your admin passphrase somewhere safe and creating a second admin account once accounts are enabled. See [If the admin account itself is locked out](./users-and-accounts.md#if-the-admin-account-itself-is-locked-out).

## Database

### Database won't open

**Symptom.** Serene Pub starts, but every page answers with "Serene Pub started, but the database could not be opened." (HTTP 503) and no part of the app works. Launched from a terminal, the startup log carries a multi-line `[db] The database could not be opened.` report naming the same paths.

**Cause.** Serene Pub stores everything in an embedded PostgreSQL data directory. A force-quit, an out-of-memory kill, or a power loss can stop the server mid-write and leave that directory in a state PostgreSQL refuses to start on. The boot log's `[db] previous shutdown: clean | unclean | unknown` line says which ending the last run had — `unclean` means nothing ran on the way out, which is the usual case here.

**Serene Pub changes nothing on its own.** It does not repair, move, or delete the data directory in this state, and it will keep serving that page until the database opens. Everything below is done by hand, and the first step of all of them is a copy.

#### Where your data is

The database lives in a `data/` folder inside your data directory:

| OS      | Data directory                            |
| ------- | ----------------------------------------- |
| Linux   | `~/.local/share/SerenePub`                |
| Windows | `%LOCALAPPDATA%\SerenePub\Data`           |
| macOS   | `~/Library/Application Support/SerenePub` |

If you've set [`SERENE_PUB_DATA_DIR`](./environment-variables.md#serene_pub_data_dir-is-the-one-exception), it's that directory instead. You never have to guess: the startup log's `Using PGlite database at:` line names the exact path, and so does the 503 page.

Inside `<data directory>/data` you'll find:

- **`serene-pub.db/`** — the database. It's a **folder**, not a file, and it is the thing that won't open.
- **`meta.json`** — a small sibling file holding the schema version and `cryptoSecretKey`. That key encrypts stored API passphrases and signs login sessions, and it is **not** inside `serene-pub.db/` or inside any backup archive — a copy travels _beside_ each one instead, see below. Keep it. Losing it means re-entering every saved API key and everyone logging in again — but it also means a restored or brand-new database still works with your existing credentials, which is why it survives everything below.
- **`backups/`** — `.tgz` archives of the whole `serene-pub.db/` folder, named `serene-pub-<version>-<timestamp>.tgz`. One is taken **once a day** and one **before a version upgrade runs migrations**; you can take one any time from **Settings → Data** or with `npm run db:recover -- --backup`. None are ever deleted automatically. A fresh install often has none at all.

    Two settings in **Admin → Settings → Backups** control this: _Back up daily_ (on by default), and _Include user files_ (off by default). Neither ever deletes anything — turning daily backups off just stops new ones being taken.

- **`backups/<archive>.tgz.meta.json`** — a copy of `meta.json` as it was when that backup was taken, kept _beside_ the archive rather than inside it so the archive stays exactly what `tar -xzf` and Serene Pub both expect. It is what lets a restored database's stored API passphrases still decrypt. Archives taken before this existed simply don't have one, and restore then keeps your current `meta.json`.
- **`backups/<archive>.tgz.users.tgz`** — your user files (media and avatars: everything under `<data directory>/data/users/`), archived beside the dump when _Include user files_ is on. Present only for backups taken with that setting on, so most installs have none. Beside rather than inside for the same reason as `meta.json`, and separate because it is by far the larger of the two: a dump is measured in megabytes, a media library has no ceiling.

    Card-import caches (`users/<id>/cache/`) are deliberately left out — they're rebuilt from the cards you still have.

    It matters more than its size suggests. Avatars are real foreign keys into the database's `files` table, so a database restored **without** its user files points at images that were never archived.

- **`serene-pub.db.broken-<timestamp>/`** — a database a recovery set aside. Serene Pub never deletes one; **Settings → Data** and the recovery page both list them with a delete button when you want the space back.
- **`users.broken-<timestamp>/`** — the user files a restore replaced, moved aside the same way and just as permanently. Only appears when you restore a backup that carries user files.

#### The quickest route: the recovery page

When the database won't open, Serene Pub still starts and still answers on its usual address — it just serves one page instead of the app. Open it (the same URL you always use) and follow the **Open recovery** button. Launched from a desktop shortcut or the applications menu, the launcher opens that page in your browser for you as soon as it sees the app come up in this state, and if the app never starts at all it writes `serene-pub-last-error.log` into your data directory (and raises a desktop dialog where one is available) instead of failing silently. On macOS that includes double-clicking `Serene Pub.app` from the Dock or Finder — the bundle runs the same launcher, so it opens the recovery page for you and leaves the same log, without a dialog (raising one there costs a Finder permission prompt of its own). From there you can:

- **Restore a backup** — the broken database is _moved_ to `serene-pub.db.broken-<date>` in the same folder and the backup is unpacked in its place. Nothing is deleted. The archive is checked before anything moves, and the restored copy has to open before it is put in place; if it doesn't, the attempt is left as `serene-pub.db.restore-failed-<date>` and your database is untouched. If the backup carries user files, the confirmation page offers to put those back too (ticked by default) — your current `users/` is moved to `users.broken-<date>`, again without deleting anything.
- **Start fresh** — moves the broken database aside and creates an empty one on the next start. `meta.json` is left alone, so your login and saved API passphrases keep working.
- **Download the broken database** as a `.tgz`, for a bug report or for the `pg_resetwal` route below.
- **Delete** a backup or a set-aside database, one at a time, with a confirmation.

Each action asks you to confirm on a second page that restates exactly what will move, and every one of them is written to the server log and to `meta.json`'s `recoveryLog`.

**The recovery page only answers this machine and your local network** (loopback and the private ranges — `10.x`, `172.16–31.x`, `192.168.x`, link-local, and IPv6 `fc00::/7`). There is no database in this state, so there are no accounts and nothing to log in with; the address is the only credential there is. Anything else gets a bare 503 that names no paths and offers no actions. If you reach your instance only through a tunnel or a reverse proxy, use the command line instead — a forwarded `X-Forwarded-For` is deliberately not believed here.

#### From a terminal: `npm run db:recover`

The same operations, for Docker, a NAS, or anything reached over SSH. Run it with Serene Pub **stopped** — it takes the same database lock the other `db:` commands do, and refuses if the app is holding it.

```
npm run db:recover -- --list                 # what's here, and what can be restored
npm run db:recover -- --backup [label]       # take one now (needs a database that opens)
npm run db:recover -- --restore <file>       # put a backup in place of the current database
npm run db:recover -- --fresh                # set the current one aside, start empty
npm run db:recover -- --delete-backup <file>
npm run db:recover -- --delete-aside <dir>
```

`--restore` and `--fresh` print exactly what will move and wait for you to type `yes`. Add `--yes` to answer in advance — required when there is no terminal to ask (a script, a container's entrypoint).

Two more flags cover the user-file tier:

- `--users` with `--backup` archives `users/` beside the dump for this backup, whatever the stored setting says.
- `--no-users` with `--restore` leaves your current `users/` alone. Without it, a backup that carries user files puts them back and moves the ones you have to `users.broken-<date>` — which is the default because a database restored on its own points at media that came with it.

#### Restore the newest backup by hand

Do this with Serene Pub **stopped**. Nothing here deletes anything.

1. Move the broken database aside — **never delete it.** It is still the only copy of anything newer than your last backup, and it may be repairable.

    ```
    cd "<data directory>/data"
    mv serene-pub.db serene-pub.db.broken-2026-09-09
    ```

    On Windows, rename the `serene-pub.db` folder in Explorer.

2. Pick the newest archive in `backups/` — the 503 page and the startup log both name it — and extract it into a **new, empty** `serene-pub.db` folder:

    ```
    mkdir serene-pub.db
    tar -xzf backups/serene-pub-0.5.9-2026-02-02T00-00-00.tgz -C serene-pub.db
    ```

    `tar` will print `Removing leading '/' from member names`. That is expected: the archive stores the database's own paths from its root, and every tar that ships with Linux, macOS and Windows strips that leading slash. Check afterwards that `serene-pub.db/PG_VERSION` and `serene-pub.db/base` exist — if the folder came out empty, or with one folder inside it, you extracted to the wrong place.

3. **`meta.json` is not in the archive**, and the safe default is to leave the one you have exactly where it is. If it is missing or unreadable, Serene Pub creates a new one with a new key and your saved API passphrases will no longer decrypt.

    If the backup has a companion `backups/<archive>.tgz.meta.json` and you are restoring an _old_ backup, the passphrases stored inside that database were encrypted with the key in the companion, not the one you have now. Copy `cryptoSecretKey` (and `version`) across by hand — keep a copy of your current `meta.json` first — or let the recovery page or `npm run db:recover -- --restore` do it, which is what they do automatically and why they keep the file they replaced as `meta.json.replaced-<date>`.

4. If the backup has a `backups/<archive>.tgz.users.tgz` beside it and you want the media that came with it, move your current `users/` aside — again, don't delete it — and unpack the tier in its place. The archive contains a single `users/` folder, so extract it into the data directory itself, not into `users/`:

    ```
    mv users users.broken-2026-09-09
    tar -xzf backups/serene-pub-0.5.9-2026-02-02T00-00-00.tgz.users.tgz -C .
    ```

    Skip this and your media stays exactly as it is — which is fine, except that avatars added since the backup will point at images the restored database has no rows for, and the other way round.

5. Start Serene Pub. You are back at the moment that backup was taken; anything after it is only in the folder you set aside in step 1.

**If there is no backup**, moving `serene-pub.db` aside on its own is enough to start over — this is what the recovery page's **Start fresh** and `npm run db:recover -- --fresh` do — Serene Pub creates a new, empty database on the next launch. Sessions, characters and lorebooks are gone, but because `meta.json` stays, stored passphrases and accounts still work. Keep the folder you moved aside until you're certain you don't want it repaired.

#### Advanced: repairing the directory with `pg_resetwal`

Only worth trying if the data since your last backup matters. Verified once, on 2026-08-12, with data fully intact — but it can also make things worse, which is why it is done on a copy.

This needs PostgreSQL 16 client binaries that Serene Pub does not ship (`apt-get download postgresql-16` then `dpkg -x`; the `.deb` is the route because the npm embedded-postgres package lacks `pg_resetwal`).

1. Work on a **copy** of `serene-pub.db`; remove `postmaster.pid` (the embedded server writes a synthetic one).
2. `pg_controldata -D <copy>` — if state is "shut down" with a valid checkpoint, recovery is likely.
3. `pg_resetwal -n -D <copy>` (dry run), then without `-n`.
4. Open the copy with Serene Pub before swapping it in — point `SERENE_PUB_DATA_DIR` at a scratch directory containing it, rather than replacing your real one to find out.

Partial or table-level repair isn't covered: none of the tooling for it ships with Serene Pub.

## Document View

- **Can't find the way back to the standard site.** Press **Ctrl+Shift+Y** from anywhere — it's a toggle, so it switches you back the same way it switched you in. The header's **Browse Standard Site** button and the Settings page's **Turn Off Document View** button both work too; see [Document View](./document-view.md#leaving-document-view) for the difference between them.
- **Document View keeps turning itself back on** after you turn it off, or keeps starting in the standard interface after you turn it on. Your choice is remembered per browser (not per account) via a stored preference, which always wins over the server-wide `PUBLIC_DOCUMENT_VIEW_DEFAULT` default — if it's not sticking, check that the browser you're testing in isn't in a private/incognito window that clears storage between sessions.
- **A feature I use isn't there.** Document View intentionally covers a smaller surface than the full app — see [What's Different From the Standard Site](./document-view.md#whats-different-from-the-standard-site) for the full list of what to reach for the standard site for instead.

## Android

Several features (local embedding models, the KoboldCPP/Ollama Managers, SillyTavern import, and a handful of connection types/token counters) aren't available on Android due to constraints of running a full server inside a mobile app. See [Android App](./android.md#feature-limitations) for the complete list before assuming something is broken.

## Docker & Self-Hosting

Networking, volumes, reverse proxies, and environment variables are covered in [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md) and [Hosting Serene Pub](./hosting.md) — most "can't reach the server" or "my data disappeared after a restart" issues trace back to the `SERENE_PUB_DATA_DIR` volume not being mounted where you think it is. A few real-time symptoms behind a reverse proxy — note that sockets now share the app's port, so most of these mean "upgrade headers aren't being forwarded" rather than "the second port isn't routed":

- **Browser console shows "Mixed Content... has been blocked."** The socket connects to the same origin as the page, so this now means the page itself was served over `http://` from an `https://` context — check your proxy, and set `PROTOCOL_HEADER` if it sets `X-Forwarded-Proto`.
- **"blocked by CORS policy" pointing at your own domain.** Your proxy is rewriting the `Host` header so it no longer matches the `Origin` the page was loaded from — set `HOST_HEADER`, or add the hostname to `ALLOWED_ORIGINS`.
- **Socket requests 404 at `/socket.io/...`, or a "Socket connection timeout" with no CORS/404 error at all.** Your proxy is reaching the app but not forwarding WebSocket upgrades — make sure it passes the `Upgrade` and `Connection` headers through. `/socket.io/` is served by the same port as the app, so no extra routing is needed.
- **`.env` changes don't seem to apply.** Check it's in the right place first: `.env` lives in your [data directory](./environment-variables.md#where-env-lives), not next to the executable, and the startup banner's `Env files:` line names the files that were actually read. If you launch through a custom entrypoint rather than `build/index.js`, `PORT`, `HOST`, `PROTOCOL_HEADER`, `HOST_HEADER`, and `ORIGIN` are read by adapter-node before the app's own `.env` loading runs — use `node --env-file=<data dir>/.env build/index.js`.
