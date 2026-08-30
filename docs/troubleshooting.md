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

## Document View

- **Can't find the way back to the standard site.** Press **Ctrl+Shift+Y** from anywhere — it's a toggle, so it switches you back the same way it switched you in. The header's **Browse Standard Site** button and the Settings page's **Turn Off Document View** button both work too; see [Document View](./document-view.md#leaving-document-view) for the difference between them.
- **Document View keeps turning itself back on** after you turn it off, or keeps starting in the standard interface after you turn it on. Your choice is remembered per browser (not per account) via a stored preference, which always wins over the server-wide `PUBLIC_DOCUMENT_VIEW_DEFAULT` default — if it's not sticking, check that the browser you're testing in isn't in a private/incognito window that clears storage between sessions.
- **A feature I use isn't there.** Document View intentionally covers a smaller surface than the full app — see [What's Different From the Standard Site](./document-view.md#whats-different-from-the-standard-site) for the full list of what to reach for the standard site for instead.

## Android

Several features (local embedding models, the KoboldCPP/Ollama Managers, SillyTavern import, and a handful of connection types/token counters) aren't available on Android due to constraints of running a full server inside a mobile app. See [Android App](./android.md#feature-limitations) for the complete list before assuming something is broken.

## Docker & Self-Hosting

Networking, volumes, reverse proxies, and environment variables are covered in [DOCKER.md](../DOCKER.md) and [HOSTING.md](../HOSTING.md) — most "can't reach the server" or "my data disappeared after a restart" issues trace back to the `SERENE_PUB_DATA_DIR` volume not being mounted where you think it is. A few real-time symptoms behind a reverse proxy — note that as of the single-listener change, sockets share the app's port, so most of these now mean "upgrade headers aren't being forwarded" rather than "the second port isn't routed":

- **Browser console shows "Mixed Content... has been blocked."** The socket connects to the same origin as the page, so this now means the page itself was served over `http://` from an `https://` context — check your proxy, and set `PROTOCOL_HEADER` if it sets `X-Forwarded-Proto`.
- **"blocked by CORS policy" pointing at your own domain.** Your proxy is rewriting the `Host` header so it no longer matches the `Origin` the page was loaded from — set `HOST_HEADER`, or add the hostname to `ALLOWED_ORIGINS`.
- **Socket requests 404 at `/socket.io/...`, or a "Socket connection timeout" with no CORS/404 error at all.** Your proxy is reaching the app but not forwarding WebSocket upgrades — make sure it passes the `Upgrade` and `Connection` headers through. `/socket.io/` is served by the same port as the app, so no extra routing is needed.
- **`.env` changes don't seem to apply.** `PORT`, `HOST`, `PROTOCOL_HEADER`, `HOST_HEADER`, and `ORIGIN` are read by adapter-node before the app's own `.env` loading runs — use `node --env-file=.env build/index.js` instead of a bare `node build/index.js`.
