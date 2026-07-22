# Embeddings & RAG

Serene Pub can quietly turn your characters, personas, and lorebook content into searchable embeddings, then pull the most relevant pieces back into the prompt as a conversation grows.

This is a separate system from [Summarization](./summarization.md), which condenses chat messages into permanent lorebook entries — the two are related (summarization output gets embedded too) but independently enabled and configured.

## Overview

- **Embeddings** (internally "vectorization") turns text — chat messages, character/persona descriptions, lorebook entries, narrative graph nodes — into a numeric vector that captures its meaning. This can run locally via a small on-device model, or against any external OpenAI-compatible embeddings API.
- **RAG (Retrieval-Augmented Generation)** is what happens at generation time: right before the model writes a reply, Serene Pub compares the current conversation against all those embeddings and pulls in the handful that are most semantically relevant — even if they're from messages or lore entries that fell out of the normal context window long ago.

As a chat gets long, older messages and related lore don't just disappear from the model's awareness — if embeddings are enabled, the most relevant ones are found by meaning and quietly re-inserted.

### How retrieval fits into a generated reply

When you send a message, Serene Pub's prompt builder checks whether embeddings are enabled and ready. If so, it runs a semantic search scoped to the current chat: the chat's own messages, its lorebook, the lorebooks of any linked characters or personas, and — if characters overlap — messages from other chats that share the same lorebook and cast. Results are ranked by similarity, boosted slightly for recency, and capped per content type (a handful of messages, world lore entries, character lore entries, history entries, and narrative-graph relationships) so retrieved context doesn't crowd out the guaranteed recent messages. If embeddings are off or the model isn't ready, prompt building falls back to non-semantic (keyword/recency-based) content selection instead.

### What gets embedded

Everything embeddings touch falls into one of these buckets: chat messages, character descriptions, persona descriptions, and everything inside a lorebook — world lore entries, character lore entries, history entries, and (if the lorebook has one) narrative graph nodes and relationships. See [Lorebooks](./lorebooks.md) for what those lorebook content types are and how the narrative graph itself is built. A row only ever counts as "embedded" for the specific model (and, in External API mode, the specific endpoint) that produced it — switching models or backends effectively resets everything to needing re-embedding, as covered below.

Narrative graph **nodes** are embedded and tracked for staleness like everything else, but they're not actually part of RAG's similarity search — retrieval only searches messages, world lore, character lore, history entries, and narrative _relationships_. Graph context that reaches the prompt comes from relationship matches plus a direct node lookup, not from a node's own embedding being found by meaning.

### Why some short chats never show RAG activity

RAG scoring only ever considers messages _older_ than the most recent ten in a chat — those ten are always included in the prompt directly, so there's nothing for retrieval to add. This also means chats with ten or fewer messages are treated as not applicable for RAG at all: there's no [RAG notice](#understanding-rag-notices), and nothing gets prioritized in the queue for them, because everything already fits in the guaranteed window.

## Enabling Embeddings

Embeddings don't have their own left-navigation icon. They're configured from an **Embedding** card inside the **Connections** sidebar (the `Icons.Cable`-icon nav entry) — and that card is itself hidden until an admin has already turned embeddings on. The actual first-time entry point is the **Enable Embeddings** toggle on the [System Settings](./system-settings.md) tab (or the onboarding wizard's Embeddings/RAG step, which does the same thing) — either one jumps you straight into the Connections sidebar with the now-visible Embedding card open. Once configured, the card shows a two-card chooser the first time it has nothing set up yet:

- **Local Model** — runs a small embedding model on this device; one-time download, then works fully offline with no per-request cost. Not offered on Android (see below).
- **External API** — points at any OpenAI-compatible `/embeddings` endpoint: OpenAI itself, or a self-hosted Ollama/LM Studio/llama.cpp server elsewhere on your network. The base URL, API key, and model name are tested against a real embed call before anything is saved.

Once configured, the panel switches to its normal Queue/Settings view (below), and the Settings tab gains **Switch to Local Model** / **Switch to External API** actions for reconfiguring later, plus a **Disable Embeddings** action (RAG then falls back to keyword search, and the panel returns to the chooser).

The onboarding wizard's Embeddings/RAG step doesn't duplicate this setup UI — its **Open Embeddings Settings** button opens this same panel and the wizard waits for it to report ready before letting you continue, the same pattern used for the Ollama/KoboldCPP "Easy Setup" steps. A **Disable & Skip** button is offered if you change your mind mid-wizard after already enabling something.

**On Android**, only External API is offered — on-device embedding models depend on a native library that can't run in the Android app's bundled runtime. See [Android App](./android.md) for the full list of Android-specific limitations.

### Choosing a local embedding model

If you choose Local Model, you pick from three tiers, each trading speed for retrieval quality:

| Tier     | Model               | Dimensions | Size    | Notes                                                                                                                                                                                                             |
| -------- | ------------------- | ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fast     | all-MiniLM-L6-v2    | 384        | ~80 MB  | Lightweight; good for shorter lorebook entries and fact-style lore; best if RAM is limited or you want to get started immediately.                                                                                |
| Balanced | EmbeddingGemma-300M | 768        | ~300 MB | Google's current-generation embedding model; multilingual, with strong semantic understanding of longer prose and character descriptions; a good default for most setups.                                         |
| Best     | bge-m3              | 1024       | ~570 MB | Top-tier, multilingual retrieval quality with an 8192-token context window — 16x the reach of the previous best-tier model, useful for long character and lorebook entries; recommended if you have the hardware. |

All three run fully locally via an ONNX-based embedding runtime — nothing is sent to an external API. Balanced and Best load int8-quantized weights (a small quality tradeoff for a much smaller download than full precision); Fast already downloads a small enough model that quantizing it further isn't worthwhile. Models are downloaded once and cached; switching models later re-downloads only if the new one isn't cached yet.

### Changing models or backends later invalidates existing embeddings

Every embedded row stores which model (and, for External API, which endpoint) produced it. If you switch — via **Switch to Local Model**/**Switch to External API**, the **Change Model** button, or by reconfiguring the API's model field — **all existing embeddings become "stale"**: they were produced by a source that's no longer active, so they're excluded from RAG search and automatically re-queued for re-embedding. Content also becomes stale automatically whenever its underlying text is edited after being embedded (its "updated" timestamp moves past its "last vectorized" timestamp).

### Model Idle TTL

On the Settings tab (Local Model mode only): **Model Idle TTL**, a number-of-minutes field with a description of "Unload the embedding model after this many minutes of inactivity. Set to 0 to keep it loaded indefinitely." This frees up RAM when embedding work has been idle for a while, at the cost of a short reload delay the next time it resumes. Not applicable in External API mode — there's no local model to unload.

## The Embeddings Sidebar

Once configured, the Embeddings Sidebar has two tabs: **Queue** and **Settings**.

### The Queue tab

The Queue tab shows:

- A **status card** at the top (Running / Paused / Idle) with a Start or Stop button, plus a live "Completed" and "Queued" counter. While running, it shows the label of the item currently being embedded (e.g. a specific chat message, character, or lorebook entry).
- A **Queue** list of pending "priority groups" — each group bundles one chat together with its lorebook, linked characters, and linked personas, so a chat's content is embedded as a unit rather than getting interleaved with unrelated content. Each queued group shows its label, owner, and a short summary (e.g. "2 chars · 1 persona · 1 lorebook"). Groups can be reordered with up/down arrows or removed from the queue entirely with the X button.
- A **Recent** history list of the last completed groups, each with a relative "time ago" timestamp, kept for reference after they finish.

Within a group, content is embedded in a fixed order: chat messages first, then lorebook content (world lore → character lore → history entries → narrative graph nodes → narrative graph relationships), then characters, then personas. Once the priority queue is empty, the queue falls back to a global sweep that finds any other unembedded or stale content anywhere in the database, so nothing is left behind indefinitely.

### The Settings tab

The Settings tab surfaces:

- A **warning banner** if a local embedding model isn't currently loaded in memory — for example after a server restart, or if the cached model files are missing — with a "Reload Model" / "Re-download Model" button.
- A card showing the active model/API's name, dimensions, and (for local models) tier badge, size, and description, plus a "Ready" / "Not ready" status pill.
- The **Model Idle TTL** control described above (local mode only).
- **Switch to Local Model** / **Switch to External API** and **Disable Embeddings** actions.

### Understanding queue states

The queue has three states, shown by both the sidebar's status card and the header navigation icon:

- **Idle** — nothing queued, or the queue has been explicitly stopped.
- **Running** — actively embedding items one at a time; the header's Embeddings icon animates and turns green.
- **Paused** — reserved for pausing the queue without fully stopping it (for example, to avoid competing with the model during an active chat generation).

### Troubleshooting a stuck or empty queue

If the queue looks stuck at "Idle" with items still needing embeddings, check the Settings tab first — the queue silently stops (and logs a warning server-side) if embeddings are disabled, if a local model fails to auto-load (most commonly because it isn't cached and can't be re-downloaded, or the server restarted and the model needs to be reloaded), or if an External API config has stopped validating. Reloading or re-downloading the model from the warning banner, then pressing Start on the Queue tab, resolves most local-mode cases. If a specific chat's content never seems to finish indexing, the RAG notice inside that chat has a "Prioritize in queue" button that jumps its content to the very front of the queue.

## How Serene Pub ranks retrieved content

This is internal behavior — there's no UI to tune it — but understanding it helps explain why the model sometimes does or doesn't seem to "remember" something.

### Two-pass semantic queries

Rather than a single similarity search, retrieval runs two passes: a "current" query built from the last couple of messages (what's being discussed right now), and a broader "recent" query built from the few messages before that. Results from the current-topic pass are merged in first and get priority; the recent-context pass only contributes items the current pass didn't already surface. This keeps retrieval responsive to sudden topic changes instead of anchoring too heavily on whatever was relevant several messages ago.

### Blending and de-duplicating results

Each of the two passes (current and recent) actually embeds every message in its query window individually, runs a separate similarity search per message-embedding, and combines those per-message result lists with Reciprocal Rank Fusion (an item's position in each list counts more than its raw score) before re-ranking with Maximal Marginal Relevance, which intentionally trades a little relevance for diversity so the retrieved set doesn't fill up with five near-duplicate restatements of the same fact — all of this RRF+MMR work happens _within_ a single pass. The current-pass and recent-pass results are then combined by simple de-duplication (the current pass's items win; the recent pass only contributes items not already seen), not by a second round of RRF across passes. A small recency boost is also applied to message scores, and only results that clear an adaptive similarity threshold are kept.

One consequence worth knowing: the per-content-type budget described below is enforced separately inside each of the two passes, not globally across both. If the current and recent passes surface mostly disjoint items, the effective number of results for a given content type in one generation can end up close to double the stated per-pass budget, not capped at it.

### Always-included content

Two categories bypass ranking entirely: the most recent handful of chat messages (the "guaranteed window") are always in the prompt regardless of token budget, and any lorebook entry marked **constant** is always included as long as it's enabled — constant entries are lore the model should never forget, so they skip the relevance contest altogether. See [Lorebooks](./lorebooks.md) for how the constant flag is set on an entry.

Bypassing the relevance contest also means bypassing token-budget trimming — pinned/constant world lore, character lore, and history entries aren't among the content types the token-budget enforcement step is allowed to shrink. In practice this is rarely an issue, but if the combined content you've marked constant/pinned in a lorebook is large enough on its own, there's currently no mechanism to trim it back down to fit the model's context limit the way ordinary RAG-recalled content is.

## Understanding RAG Notices

Inside a chat, a **RAG notice** banner (the `RagNotice` component) can appear just above the message composer once a conversation has grown past 10 messages — below that threshold everything already fits in the guaranteed context window, so the notice doesn't apply. It checks the embedding status of the chat's older messages, its linked characters, personas, and lorebook content, and shows one of three variants:

- **"RAG content not yet indexed"** — none of the applicable older content has been embedded yet, so RAG can't surface anything from this chat.
- **"RAG content indexed with a different model"** — everything was embedded with a previous model/backend and needs re-indexing with the currently active one.
- **"Indexing in progress…"** — a mix of ready and pending content; shows a running count like "12 of 40 items indexed" and notes if the queue itself is paused.

Each notice includes a **Prioritize in queue** button, which moves the chat (and its linked lorebook/characters/personas) to the front of the embeddings queue, and an **Ignore for this chat** button, which silences the notice for that specific chat going forward (shown afterward as a small "RAG disabled for this chat" line with a "Re-enable" link). Once every applicable item is fully indexed with the current model, the notice disappears on its own.

### The per-item vectorization status icon

Elsewhere in the UI (character and persona editors, for example), a small icon next to an entity's name reflects its individual embedding status against the currently active model: a lightning bolt for "vectors up to date," a refresh icon for "vectors stale — model changed," and nothing shown at all if embeddings are disabled or the item has never been embedded.

## Context Debugging

A System Settings toggle, **Enable Context Debugging**, is worth knowing about alongside RAG: when turned on, it adds a Statistics tab and a debug icon to chat messages, computes full RAG and prompt-infill diagnostics for each generation, and saves that metadata alongside the message so you can inspect exactly what content the model saw — including which RAG results were retrieved — after the fact. This is an admin-only, opt-in setting since the extra computation and stored metadata add overhead; it's primarily useful when troubleshooting why a particular reply did or didn't seem to "remember" something. See [System Settings](./system-settings.md) for the rest of the settings on this screen.

One diagnostic gotcha worth knowing: because the current and recent passes each compute their own adaptive similarity threshold, and the recorded value is simply whatever ran last, the "adaptive similarity threshold" figure shown in Prompt Details reflects only the **recent** pass's threshold, not the current pass's — keep that in mind if the number looks like it doesn't match what you'd expect from the most recent messages specifically.
