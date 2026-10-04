# Troubleshooting

Find what you're seeing below. Each answer is a quick fix and a link to the page that explains more.

:::tip Asking for help
Still stuck? Ask in [Discord](https://discord.gg/3kUx3MDcSa) or [open an issue](https://github.com/doolijb/serene-pub/issues). An admin can attach a support report (**Admin › Diagnostics › Copy report**, see [Support report](./system-settings.md#support-report)): it has the versions, settings, plugins and recent errors an answer usually needs, with secrets and names removed.
:::

## It won't start

- **Nothing opens, the window closes at once, or the port is in use**: see [Install → Check that it worked](./install.md#check-that-it-worked).
- **A page says "Serene Pub started, but the database could not be opened."**: see [Database won't open](#database-wont-open) below.
- **The first start after upgrading from 0.5 takes minutes**: it's converting your data. Leave it running. See [Upgrading from 0.5](./upgrading-from-0.5.md).
- **It won't open after upgrading from 0.5**: the conversion was undone, so nothing is lost. The startup log says why, and the next start tries again.
- **The startup log says "This build is older (or newer) than its database migrations"** (running from source): the app was built before the database migrations in `drizzle/` last changed, or after. It stops before touching your data, because an old build can't update the database correctly with new migrations. Run `npm run build` again, then start it. The downloaded app always ships its build and migrations together, so you won't see this there.

## Nobody replies

- **The Connections view doesn't say *Sessions can reply***: open it from the rail. A connection that says **Needs a key** wants its API key; **Not reachable** means the program or service can't be found (is it running? is the address right?). See [Connect a model](./connect-a-model.md#check-that-it-worked).
- **KoboldCPP says *Crashed*, or the model never finishes loading**: the model is probably too big for your memory. Pick a smaller one. The connection's status card shows the real error. See [KoboldCPP, run by Serene Pub](./connections.md#troubleshooting-download-or-start-failures).
- **The first reply after changing a KoboldCPP setting takes ages**: settings like GPU layers reload the model on the next reply, which can take several minutes for a big one. See [Launch settings](./connections.md#launch-settings-and-when-a-model-reloads).
- **In a group session, nobody takes a turn**: **Auto-advance** may be off, or the turn order **Manual**. Press **Continue** or **Pick who speaks**. See [Sessions → Troubleshooting](./sessions.md#troubleshooting).
- **KoboldCPP fails right after setup in Docker or on a NAS**: the data folder is often a mounted volume the container can't write to. Check it can create files there.

## Replies are garbled or wrong

- **Run-on, garbled, or the AI writes your lines too**: on a text-completion connection this is almost always the wrong prompt format for the model. See [Prompt formats and token counters](./connections.md#prompt-formats-and-token-counters).
- **The reasoning shows up in the reply, or the reply in the Reasoning fold**: Serene Pub splits them on the model's own reasoning markers (`<think>…</think>` and similar) or on a separate reasoning field, never on how the text reads. When **Reasoning** is on, a model whose chat template opens the reasoning itself (Qwen 3.5 and Qwen3's Thinking models, for example) is routed into the fold from its first word. If a model writes something reply-like before its `</think>`, that part lands in the fold, because the model marked it as reasoning. With **Reasoning** unset, such a model's reasoning shows in the reply until its `</think>` arrives, then moves to the fold. Turn **Reasoning** on in the step's sampling to route it from the start. The other way round, **Reasoning** on for a model that doesn't reason makes its reply fill the fold while it streams; it moves into place when the reply finishes. Turn **Reasoning** off for that model.
- **Too much or too little history fits**: check the connection's token counter. The generic estimate can be off for some models.
- **Every session broke after a context template was edited**: a template that says the wrong thing affects every pipeline that uses it. Switch back to the shipped one and test edits on a spare session. See [Context templates](./context-templates.md).
- **The service refuses to write your scene**: that's the service's content rules, not Serene Pub. Try another model, or a local one.

## A long reply stops partway

A reply isn't cut off for taking a long time. Waiting for the model, loading it, reading a long prompt, reasoning and writing all count as working, however long they take. A reply stops on its own only when:

- **The model sends nothing for 10 minutes** (*connection idle* or *did not respond*): the program running the model has probably hung or crashed. Check its window or log. On slow hardware with a very long prompt, try a shorter context or a smaller model.
- **One step runs for over an hour** (*timeout after 3600000ms (the pub's ceiling)*): the step is stopped however busy it is. Lower the reply length or use a faster model.
- **A step that isn't generating goes quiet for its own limit** (*timeout after … without progress*): something inside Serene Pub stalled. Ask for help with a support report (see the tip at the top).

When a reply is stopped, Serene Pub also tells KoboldCPP to stop generating, so the next reply doesn't wait behind the abandoned one.

## Every reply is slow to start on a local model

A local server can reuse its work on the start of the prompt from the turn before, and only read what is new. When every reply starts slowly, re-reading the whole conversation each time, something at the start of the prompt changed:

- **Hybrid models on KoboldCPP** (Qwen 3.5, 3.6 and 3.8, and other models KoboldCPP calls *RNN or Hybrid*) reuse their cache only when the new prompt begins with the old one exactly. Serene Pub keeps the start of the prompt the same where it can: the story's date sits at the end of the instructions, the example dialogue a character shows stays the same for a whole session, the line naming who speaks next isn't sent on chat messages, the post-history reminder and the author's note go at the end by default, a long session is read by how much the window holds rather than as its newest 100 messages, and when the conversation outgrows the window its oldest messages are left out in one larger step rather than one message every turn.
- **The window is full**: when the prompt is longer than the model's context, the server trims it from the front, which changes the start on every turn. Raise **Context Tokens** in the [sampling config](./connections.md#sampling-configs) if the model allows it. Serene Pub counts with KoboldCPP's and llama.cpp's own tokenizer to avoid this; the first reply after starting the app still estimates.
- **What changes every turn**: lore chosen for this turn, the post-history reminder (once the conversation passes its trigger) and an author's note move with the conversation. At their default depth of 0 they sit after the newest message, so only the last exchange is read again; an author's note moved further back (**Messages from the end** above 0) moves everything after it. Most servers then read again only from the first change; a hybrid model on KoboldCPP reads again from its last saved point, which is often the start. A post-history reminder near the end of every prompt is the usual cause once a conversation passes the reminder's trigger; see [The postHistory object](./context-templates.md#the-posthistory-object).
- **The model was swapped or reloaded**: its cache starts empty.

## My model ignores images

Open the reply's prompt details first. An image the model was sent shows as a file on its message's turn; one it wasn't sent shows as its name, such as `[image: cat.png]`.

- **The composer won't take an image at all**: open **More** (⋮) in the composer and choose **What can be attached**. It says which part of the reply can't read images and why. See [Attach images and files](./sessions.md#attach-images-and-files).
- **Vision is off for the model**: Vision turns on by itself when the model's host says the model reads images (OpenRouter and similar listings, Ollama, LM Studio), or when a KoboldCPP run by Serene Pub has a **Vision projector** set for the model. Otherwise set **Vision** to **On** under **What this connection can do**. Setting it to **Off** there wins over everything else. See [Images and files](./connections.md#images-and-files).
- **The connection sends text completions**: a text completion has nowhere to put a picture. Switch it to **Chat messages**. See [Chat messages or text completion](./connections.md#chat-messages-or-text-completion).
- **The image is older than the media lookback**: only the last 10 messages send their images; older ones go as their names. Raise **Media lookback** on the reply pipeline's **Place attachments** step. See [Attachments in a prompt](./pipelines.md#attachments-in-a-prompt).
- **Your context template doesn't render attachments**: a template needs `{{{attachments}}}` after `{{{message}}}` in its message loop. The shipped one has it; the prompt details say *this template does not render attachments* when yours doesn't. See [Context templates](./context-templates.md).
- **A local model can't see**: its vision part has to be loaded too. Start llama.cpp's server with `--mmproj`; for KoboldCPP run by Serene Pub, set the model's **Vision projector**; in Ollama or LM Studio use a vision model such as `qwen2.5vl`.

## Characters don't remember

- **The embeddings queue sits at Idle with work waiting**: the embedding model may need loading, or its service stopped answering. See [Troubleshooting a stuck or empty queue](./embeddings-and-rag.md#troubleshooting-a-stuck-or-empty-queue).
- **One session's memory notice never clears**: press **Prioritize in queue** on the notice.
- **A short session shows no notice**: sessions of 10 messages or fewer never do; Search by meaning still works in them. See [Why some short sessions never show a RAG notice](./embeddings-and-rag.md#why-some-short-sessions-never-show-a-rag-notice).

## Lore is missing from a reply

Open the reply's run in the [run inspector](./pipelines.md#inspecting-a-run) (administrators: **Inspect run** in the reply's **⋮** menu).

- **A warning says a step ran out of time**: each lore read has a few seconds. A reply always comes before background work: while a reply is being written, and for a moment after, the pub doesn't index lorebooks or conversations, and indexing picks up again between replies. So a lore read that still runs out of time is usually a very large lorebook on a slow machine, or the first reply after many entries were imported or changed, when that reply has to index them before it can read them. The next reply usually has them.
- **No warning, and the entry isn't in the prompt**: select the lore step and read its **Prompt** table. It says whether each entry was considered and why it was left out.

## A summary or graph build seems stuck

Check **Activity**: a failed job keeps its card, with a way to see the error. Admins can also check the **LLM queue** tab to see whether the call is waiting, generating, or gone. See [Troubleshooting a job that seems stuck](./summarization.md#troubleshooting-a-job-that-seems-stuck).

## Can't sign in

- **Someone forgot their passphrase**: an admin resets it from the Users view. See [A member forgot their passphrase](./users-and-accounts.md#a-member-forgot-their-passphrase).
- **Lost your authenticator and recovery codes**: another admin can clear your two-factor. See [Lost your authenticator](./users-and-accounts.md#lost-your-authenticator-and-your-recovery-codes).
- **The only admin is locked out**: recover with two settings on the server. See [If the admin account itself is locked out](./users-and-accounts.md#if-the-admin-account-itself-is-locked-out).
- **The User accounts switch can't be turned off**: that's by design. Once accounts are on, they stay on.

## Something from 0.5 is missing or different

- **Where did it go?** See [Upgrading from 0.5 → Where things are now](./upgrading-from-0.5.md#where-things-are-now).
- **What changed in my data?** Open **Admin › History** and filter to the data upgrade. Every change the upgrade made, and everything it couldn't carry, is listed by name.
- **Where's the copy from before the upgrade?** In your data folder's `backups/`, named `serene-pub-0.5.3-beta-<date>.tgz` (or `serene-pub-0.0.0-<date>.tgz` for an install only ever run from source).
- **Saved API keys stopped working after restoring a 0.5 backup**: copy the 0.5 install's `cryptoSecretKey` into `meta.json` with Serene Pub stopped, or enter the keys again. See [Restoring a 0.5 backup later](./upgrading-from-0.5.md#restoring-a-05-backup-later).

## Can't reach it from another device

Most problems behind a reverse proxy or tunnel (nothing updates, "Mixed Content", "blocked by CORS policy", `.env` changes ignored) are covered in [Hosting → Troubleshooting](./hosting.md#troubleshooting). In Docker, data that vanishes after a restart usually means the data folder isn't mounted where you think; see [DOCKER.md](https://github.com/doolijb/serene-pub/blob/main/DOCKER.md).

## Stuck in Document View

- **Can't find the way back**: press **Ctrl+Shift+Y**. See [Leaving Document View](./document-view.md#leaving-document-view).
- **It keeps turning back on, or won't stay on**: the choice is remembered per browser. A private window forgets it.
- **A feature is missing**: Document View covers less on purpose. See [What's different](./document-view.md#whats-different-from-the-usual-interface).

## A feature is missing on Android

Running models on the phone, local embeddings, SillyTavern import and a few connection types aren't available there. See [Android app → Feature limitations](./android.md#feature-limitations).

## Database

This section is for when the database itself is damaged. It's rare, and nothing here happens on its own: every step is yours.

### Database won't open

**What you see.** Every page says "Serene Pub started, but the database could not be opened." (an HTTP 503), and nothing else works. Started from a terminal, the startup log has a `[db] The database could not be opened.` report naming the same paths.

**Why.** A force-quit, an out-of-memory kill or a power cut can stop the server mid-write and leave the database in a state it refuses to open. The startup log's `[db] previous shutdown:` line says how the last run ended; `unclean` is the usual case here.

**Serene Pub changes nothing by itself.** It won't repair, move or delete the database, and keeps showing that page until the database opens. The quickest fix is the [recovery page](#the-quickest-route-the-recovery-page).

#### Where your data is

Your **data folder**:

| System | Data folder |
| --- | --- |
| Linux | `~/.local/share/SerenePub` |
| Windows | `%LOCALAPPDATA%\SerenePub\Data` |
| macOS | `~/Library/Application Support/SerenePub` |

If you set [`SERENE_PUB_DATA_DIR`](./environment-variables.md#serene_pub_data_dir-is-the-one-exception), it's that folder instead. The startup log's `Using PGlite database at:` line names the exact path, and so does the 503 page.

Inside it, the `data` folder holds:

- **`serene-pub.db/`**: the database. It's a folder, not a file.
- **`meta.json`**: a small file with the database version and the key (`cryptoSecretKey`) that encrypts saved API keys and signs logins. It isn't inside the database or the backups, so it survives everything below. Keep it: losing it means re-entering every API key and everyone logging in again.
- **`backups/`**: `.tgz` copies of the database, named `serene-pub-<version>-<date>.tgz`. One is taken each day (unless **Back up daily** is off in **Admin › Data and backups**) and one before an update changes the database; take one any time from **Settings › Data**. None is ever deleted automatically. A new install may have none.
- **`backups/<archive>.tgz.meta.json`**: the `meta.json` from when that backup was taken, kept beside it so a restored database's API keys still decrypt.
- **`backups/<archive>.tgz.users.tgz`**: your pictures and media from when that backup was taken. Only there when **Include user files** was on.
- **`serene-pub.db.broken-<date>/`** and **`users.broken-<date>/`**: a database or media folder a recovery set aside. Never deleted automatically; **Settings › Data** and the recovery page can delete them when you want the space back.

#### The quickest route: the recovery page

When the database won't open, Serene Pub still answers at its usual address with one page. Open it and press **Open recovery**. (Started from its launcher, Serene Pub opens it for you. If the app doesn't start at all, the tray icon says it stopped: choose **View Logs**, and `server.log` says why.)

From there you can:

- **Restore a backup**: the broken database is moved aside to `serene-pub.db.broken-<date>`, and the backup is unpacked in its place. Nothing is deleted. The backup is checked first: it has to open, and its lorebooks have to read in full, before it's put in place. If the backup has your media too, you're offered to put that back as well.
- **Start fresh**: move the broken database aside and start with an empty one. `meta.json` stays, so logins and API keys keep working.
- **Download the broken database**, for a bug report or the repair below.
- **Delete** a backup or a set-aside database, with a confirmation.

Each action shows exactly what will move and asks you to confirm.

The recovery page only answers this computer and your local network. Over a tunnel or reverse proxy, use the command line instead.

#### From a terminal: `npm run db:recover`

The same actions, for Docker, a NAS, or a server you reach over SSH. Run it with Serene Pub **stopped**.

```
npm run db:recover -- --list                 # what's here, and what can be restored
npm run db:recover -- --backup [label]       # take a backup now (needs a database that opens)
npm run db:recover -- --restore <file>       # put a backup in place of the current database
npm run db:recover -- --fresh                # set the current one aside, start empty
npm run db:recover -- --delete-backup <file>
npm run db:recover -- --delete-aside <dir>
```

`--restore` and `--fresh` show what will move and wait for you to type `yes`; add `--yes` to answer in advance (needed in a script). `--users` with `--backup` includes your media in that backup; `--no-users` with `--restore` leaves your current media alone.

#### Restore the newest backup by hand

With Serene Pub **stopped**. Nothing here deletes anything.

1. Move the broken database aside. **Never delete it**: it's the only copy of anything since your last backup, and it may be repairable.

    ```
    cd "<data folder>/data"
    mv serene-pub.db serene-pub.db.broken-2026-09-09
    ```

    On Windows, rename the `serene-pub.db` folder in Explorer.

2. Pick the newest archive in `backups/` and unpack it into a **new, empty** `serene-pub.db` folder:

    ```
    mkdir serene-pub.db
    tar -xzf backups/serene-pub-0.6.0-2026-09-01T00-00-00.tgz -C serene-pub.db
    ```

    `tar` may print `Removing leading '/' from member names`; that's expected. Afterwards, `serene-pub.db/PG_VERSION` and `serene-pub.db/base` should exist. If the folder is empty, or has one folder inside it, you unpacked to the wrong place.

3. Leave `meta.json` where it is. If you're restoring an *older* backup that has a `.tgz.meta.json` beside it, its API keys were encrypted with the key in that file: copy `cryptoSecretKey` (and `version`) from it into `meta.json`, after keeping a copy of yours. The recovery page and `db:recover --restore` do this for you.

4. To restore the media from that time too, if a `.tgz.users.tgz` is beside the backup: move your current `users/` folder aside and unpack it into the `data` folder itself:

    ```
    mv users users.broken-2026-09-09
    tar -xzf backups/serene-pub-0.6.0-2026-09-01T00-00-00.tgz.users.tgz -C .
    ```

    Skip this and your media stays as it is; pictures added since the backup won't match the restored database.

5. Start Serene Pub. You're back to when the backup was taken. Anything newer is only in the folder you set aside in step 1.

**No backup?** Moving `serene-pub.db` aside on its own is enough to start over with an empty database. Your sessions, characters and lorebooks are in the folder you moved, so keep it until you're sure you don't want it repaired.

#### Advanced: repairing it with `pg_resetwal`

Only worth trying if what changed since your last backup matters. It has recovered databases fully before, but it can also make things worse, so always work on a copy. You'll need the PostgreSQL 16 `pg_resetwal` and `pg_controldata` tools, which Serene Pub doesn't ship.

1. Copy `serene-pub.db`, and delete `postmaster.pid` from the copy.
2. `pg_controldata -D <copy>`: if the state is "shut down" with a valid checkpoint, recovery is likely.
3. `pg_resetwal -n -D <copy>` for a dry run, then again without `-n`.
4. Test the copy before swapping it in: point `SERENE_PUB_DATA_DIR` at a scratch folder containing it.
