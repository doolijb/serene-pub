# Summarization & RAG

Serene Pub can quietly turn your characters, personas, and lorebook content into searchable embeddings, then pull the most relevant pieces back into the prompt as a conversation grows — this is what "Vectorization & RAG" and "Summarization" do under the hood.

## Overview

Two related background systems work together to help the model stay coherent in long chats, without you having to manually re-paste old context:

- **Vectorization** turns text (chat messages, character/persona descriptions, lorebook entries, narrative graph nodes) into a numeric "embedding" — a vector that captures its meaning. This happens locally, using a small embedding model that runs on your own machine.
- **RAG (Retrieval-Augmented Generation)** is what happens at generation time: right before the model writes a reply, Serene Pub compares the current conversation against all those embeddings and pulls in the handful that are most semantically relevant — even if they're from messages or lore entries that fell out of the normal context window long ago.
- **Summarization** is a separate, on-demand tool for condensing chat messages into permanent [lorebook](./lorebooks.md) entries — world lore, character lore, or scene summaries — so long stretches of roleplay can be distilled into compact facts instead of being kept (or embedded) verbatim forever.

In practice this means: as a chat gets long, older messages and related lore don't just disappear from the model's awareness — if vectorization is on, the most relevant ones are found by meaning and quietly re-inserted, and you can also manually compress old messages into lorebook history via summarization.

### How retrieval fits into a generated reply

When you send a message, Serene Pub's prompt builder checks whether vectorization is enabled and ready. If so, it runs a semantic search scoped to the current chat: the chat's own messages, its lorebook, the lorebooks of any linked characters or personas, and — if characters overlap — messages from other chats that share the same lorebook and cast. Results are ranked by similarity, boosted slightly for recency, and capped per content type (a handful of messages, world lore entries, character lore entries, history entries, and narrative-graph relationships) so retrieved context doesn't crowd out the guaranteed recent messages. If vectorization is off or the model isn't loaded, prompt building falls back to non-semantic (keyword/recency-based) content selection instead.

### What gets embedded

Everything vectorization touches falls into one of these buckets: chat messages, character descriptions, persona descriptions, and everything inside a lorebook — world lore entries, character lore entries, history entries, and (if the lorebook has one) narrative graph nodes and relationships. See [Lorebooks](./lorebooks.md) for what those lorebook content types are and how the narrative graph itself is built. A row only ever counts as "embedded" for the model that produced it — switching embedding models effectively resets everything to needing re-embedding, as covered below.

### Why some short chats never show RAG activity

RAG scoring only ever considers messages *older* than the most recent ten in a chat — those ten are always included in the prompt directly, so there's nothing for retrieval to add. This also means chats with ten or fewer messages are treated as not applicable for RAG at all: there's no [RAG notice](#understanding-rag-notices), and nothing gets prioritized in the queue for them, because everything already fits in the guaranteed window.

## Enabling Summarization & Vectorization

Both subsystems are controlled from **System Settings**, under the "Vectorization & RAG" and "Summarization" sections, and both require admin privileges to change.

- **Enable Vectorization & RAG** is a switch. Turning it on opens an "Enable Vectorization" dialog where you pick a local embedding model, then choose either **Enable, start later** (saves the setting and downloads/loads the model, but leaves the queue idle) or **Enable & Start Now** (also kicks off the background embedding queue immediately). Turning the switch off stops the queue and unloads the model from memory.
- **Enable Summarization** is a separate switch. Its description in-app: "When enabled, older chat messages may be condensed into summaries to preserve context while staying within token limits. Summaries are generated automatically in the background and are used in place of the original messages during prompt construction."

Once vectorization is enabled, a new **Vectorization** entry (lightning-bolt icon) appears in the app's left navigation for all users — this opens the [Vectorization Sidebar](#the-vectorization-sidebar) described below. The icon spins and turns green while the embedding queue is actively running, so you can tell at a glance whether background work is happening.

### Choosing an embedding model

The enable dialog (and the sidebar's Settings tab) let you pick from three local embedding models, each trading speed for retrieval quality:

| Tier | Model | Dimensions | Size | Notes |
|---|---|---|---|---|
| Fast | all-MiniLM-L6-v2 | 384 | ~80 MB | Lightweight; good for shorter lorebook entries and fact-style lore; best if RAM is limited or you want to get started immediately. |
| Balanced | all-mpnet-base-v2 | 768 | ~420 MB | Stronger semantic understanding of longer prose and character descriptions; a good default for most setups. |
| Best | bge-large-en-v1.5 | 1024 | ~1.2 GB | Top-tier retrieval quality for nuanced narrative context, character relationships, and thematic similarity; recommended if you have the hardware. |

All three run fully locally via an ONNX-based embedding runtime — nothing is sent to an external embedding API. Models are downloaded once and cached; switching models later re-downloads only if the new one isn't cached yet.

### Changing models later invalidates existing embeddings

Every embedded row stores which model produced it. If you switch to a different embedding model — from the "Change Model" button in the sidebar's Settings tab, or by re-enabling with a different choice — **all existing embeddings become "stale"**: they were produced by a model that's no longer active, so they're excluded from RAG search and automatically re-queued for re-embedding with the new model. The in-app warning is explicit about this: "Changing the model will stop the current vectorization queue. All existing embeddings will need to be regenerated with the new model." Content also becomes stale automatically whenever its underlying text is edited after being embedded (its "updated" timestamp moves past its "last vectorized" timestamp).

### Model Idle TTL

Also on the Settings tab: **Model Idle TTL**, a number-of-minutes field with a description of "Unload the embedding model after this many minutes of inactivity. Set to 0 to keep it loaded indefinitely." This frees up RAM when vectorization has been idle for a while, at the cost of a short reload delay the next time embedding work resumes.

## The Vectorization Sidebar

The Vectorization Sidebar has two tabs: **Queue** and **Settings**.

### The Queue tab

The Queue tab shows:

- A **status card** at the top (Running / Paused / Idle) with a Start or Stop button, plus a live "Completed" and "Queued" counter. While running, it shows the label of the item currently being embedded (e.g. a specific chat message, character, or lorebook entry).
- A **Queue** list of pending "priority groups" — each group bundles one chat together with its lorebook, linked characters, and linked personas, so a chat's content is embedded as a unit rather than getting interleaved with unrelated content. Each queued group shows its label, owner, and a short summary (e.g. "2 chars · 1 persona · 1 lorebook"). Groups can be reordered with up/down arrows or removed from the queue entirely with the X button.
- A **Recent** history list of the last completed groups, each with a relative "time ago" timestamp, kept for reference after they finish.

Within a group, content is embedded in a fixed order: chat messages first, then lorebook content (world lore → character lore → history entries → narrative graph nodes → narrative graph relationships), then characters, then personas. Once the priority queue is empty, the queue falls back to a global sweep that finds any other unembedded or stale content anywhere in the database, so nothing is left behind indefinitely.

### The Settings tab

The Settings tab surfaces:

- A **warning banner** if the embedding model isn't currently loaded in memory — for example after a server restart, or if the cached model files are missing — with a "Reload Model" / "Re-download Model" button.
- An **Embedding Model** card showing the active model's name, tier badge (Fast/Balanced/Best), dimensions, size, and description, plus a "Loaded" / "Not loaded" status pill.
- The **Model Idle TTL** control described above.
- A **Change Model** button that opens the same model-picker dialog used when first enabling vectorization, with the same warning that switching models invalidates existing embeddings.

### Understanding queue states

The queue has three states, shown by both the sidebar's status card and the header navigation icon:

- **Idle** — nothing queued, or the queue has been explicitly stopped.
- **Running** — actively embedding items one at a time; the header's Vectorization icon animates and turns green.
- **Paused** — reserved for pausing the queue without fully stopping it (for example, to avoid competing with the model during an active chat generation).

### Troubleshooting a stuck or empty queue

If the queue looks stuck at "Idle" with items still needing embeddings, check the Settings tab first — the queue silently stops (and logs a warning server-side) if vectorization is disabled or if the embedding model fails to auto-load, most commonly because the model isn't cached and can't be re-downloaded, or the server restarted and the model needs to be reloaded. Reloading or re-downloading the model from the warning banner, then pressing Start on the Queue tab, resolves most of these cases. If a specific chat's content never seems to finish indexing, the RAG notice inside that chat has a "Prioritize in queue" button that jumps its content to the very front of the queue.

## How Serene Pub ranks retrieved content

This is internal behavior — there's no UI to tune it — but understanding it helps explain why the model sometimes does or doesn't seem to "remember" something.

### Two-pass semantic queries

Rather than a single similarity search, retrieval runs two passes: a "current" query built from the last couple of messages (what's being discussed right now), and a broader "recent" query built from the few messages before that. Results from the current-topic pass are merged in first and get priority; the recent-context pass only contributes items the current pass didn't already surface. This keeps retrieval responsive to sudden topic changes instead of anchoring too heavily on whatever was relevant several messages ago.

### Blending and de-duplicating results

Because two separate ranked lists come back from the two query passes, they're combined using Reciprocal Rank Fusion (an item's position in each list counts more than its raw score) and then re-ranked with Maximal Marginal Relevance, which intentionally trades a little relevance for diversity so the retrieved set doesn't fill up with five near-duplicate restatements of the same fact. A small recency boost is also applied to message scores, and only results that clear an adaptive similarity threshold are kept.

### Always-included content

Two categories bypass ranking entirely: the most recent handful of chat messages (the "guaranteed window") are always in the prompt regardless of token budget, and any lorebook entry marked **constant** is always included as long as it's enabled — constant entries are lore the model should never forget, so they skip the relevance contest altogether. See [Lorebooks](./lorebooks.md) for how the constant flag is set on an entry.

## Understanding RAG Notices

Inside a chat, a **RAG notice** banner (the `RagNotice` component) can appear just above the message composer once a conversation has grown past 10 messages — below that threshold everything already fits in the guaranteed context window, so the notice doesn't apply. It checks the embedding status of the chat's older messages, its linked characters, personas, and lorebook content, and shows one of three variants:

- **"RAG content not yet indexed"** — none of the applicable older content has been embedded yet, so RAG can't surface anything from this chat.
- **"RAG content indexed with a different model"** — everything was embedded with a previous embedding model and needs re-indexing with the currently active one.
- **"Indexing in progress…"** — a mix of ready and pending content; shows a running count like "12 of 40 items indexed" and notes if the queue itself is paused.

Each notice includes a **Prioritize in queue** button, which moves the chat (and its linked lorebook/characters/personas) to the front of the vectorization queue, and an **Ignore for this chat** button, which silences the notice for that specific chat going forward (shown afterward as a small "RAG disabled for this chat" line with a "Re-enable" link). Once every applicable item is fully indexed with the current model, the notice disappears on its own.

### The per-item vectorization status icon

Elsewhere in the UI (character and persona editors, for example), a small icon next to an entity's name reflects its individual embedding status against the currently active model: a lightning bolt for "vectors up to date," a refresh icon for "vectors stale — model changed," and nothing shown at all if vectorization is disabled or the item has never been embedded.

## The Scene pipeline

Beyond automatic background vectorization, Serene Pub has a manual, LLM-assisted pipeline for turning chat messages into permanent lorebook content — this is "summarization" in the everyday sense of writing a summary, distinct from vectorization/embedding.

### Summarize to Lorebook

From a chat, selecting messages and choosing to summarize opens the **Summarize to Lorebook** dialog. You pick an entry type — **Scene**, **World Lore**, or **Character Lore** — and, if the chat doesn't already have one, attach or create a [lorebook](./lorebooks.md) first. World Lore and Character Lore entries accept an optional (Character Lore: required) focus topic, e.g. "abilities" or "relationship with Kira," which gets folded into the generation prompt. Character Lore entries can optionally be bound to a specific character or persona. Generation runs in two phases shown live in the dialog: **drafting** (messages are batched and each batch is independently summarized) and **synthesizing** (the drafts are merged into one coherent, past-tense entry). The result is editable before saving, and for Scene entries the model also extracts a list of **participant** characters (physically present) and **mentioned** characters (referenced but absent), which you can adjust by hand before saving.

Scene entries require selecting a [history entry](./lorebooks.md) to attach to (or creating a new blank one on the spot), and the selected messages must form one consecutive, gap-free run with no unselected visible messages in between — the dialog warns if that's violated.

### Re-processing a scene

Once a scene exists, its **Process Scene** action can regenerate its summary and character list from scratch using the same drafting/synthesizing flow, replacing the previous result after you confirm. This is useful if the scene's underlying messages changed, or if an earlier summary came out wrong.

### Compiling scenes into a history entry

A lorebook's history entries can bundle several individual scene summaries into one combined entry via **Compile to Entry** (in the History Entry manager). This step skips the batch-drafting phase — since each scene is already a finished summary — and goes straight to synthesis, merging the scene summaries into a single coherent history-entry narrative you can review before applying.

### Where summarization prompts are configured

The drafting, synthesis, and name-generation prompts used by World Lore, Character Lore, and Scene summarization are each their own configuration, editable from the **Prompts** sidebar under World Summarize, Character Summarize, and Scene Summarize sections. See [Prompt Configs](./prompt-configs.md) for how these presets — and their optional per-step connection/sampling overrides — are managed.

## The Activity Sidebar

The Activity Sidebar tracks the live progress of longer-running background jobs so you don't have to babysit a modal to know when something finishes. It has an **Activity** tab (visible to everyone) and, for admins only, an **LLM Queue** tab.

### The Activity tab

The Activity tab shows a card per in-progress or awaiting-review job relevant to the current user (plus other users' jobs, shown read-only). Card types include:

- **Graph build/extend** jobs — building or extending a lorebook's narrative graph, showing the current phase and a "scene X/Y" progress indicator. See [Lorebooks](./lorebooks.md) for what the narrative graph is.
- **Scene** summarization jobs — shows "Processing…", then "Ready to review" or "Failed," with a "Review Results" button that jumps straight to the scene.
- **Compile** jobs — history-entry compilation, with the same running/review/error states and a "Review & Apply" button.

Each card can be dismissed once finished (via the X button), and jobs that are still running for the current user can be cancelled with a **Stop** button (admins can also stop other users' jobs). A badge on the Activity tab shows the total count of active-or-awaiting-review items; the same count feeds a badge on the app header's Activity icon.

### The LLM Queue tab (admin only)

Distinct from the vectorization queue, this tab lists **LLM generation tasks** currently queued or in-flight across the whole server — chat replies, summarization calls, graph-build steps, and similar — refreshing about once per second while open. Each row shows a label, the connection and sampling preset in use, and a status; expanding a row reveals its type, connection, sampling config, associated chat/lorebook ID if any, and how long it's been running. This is a systemwide operational view, separate from the per-chat and per-user [connections](./connections.md) configuration.

### Troubleshooting a job that seems stuck

If a graph build, scene summarization, or compile job sits at "running" far longer than expected, check the LLM Queue tab (admin) to see whether its underlying generation call is actually queued behind other work, still generating, or has silently disappeared (which usually indicates an error on the connection side — see [Connections](./connections.md) for diagnosing a misbehaving connection). Jobs that finish with an error surface an "Failed" state with a **View Error** / **Go to Scene** or **Go to Entry** button so you can inspect what happened without losing the rest of your work.

## Context Debugging

A separate System Settings toggle, **Enable Context Debugging**, is worth knowing about alongside RAG: when turned on, it adds a Statistics tab and a debug icon to chat messages, computes full RAG and prompt-infill diagnostics for each generation, and saves that metadata alongside the message so you can inspect exactly what content the model saw — including which RAG results were retrieved — after the fact. This is an admin-only, opt-in setting since the extra computation and stored metadata add overhead; it's primarily useful when troubleshooting why a particular reply did or didn't seem to "remember" something. See [System Settings](./system-settings.md) for the rest of the settings on this screen.
