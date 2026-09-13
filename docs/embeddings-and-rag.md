# Embeddings & RAG

Serene Pub can quietly turn your characters, personas, and lorebook content into searchable embeddings, then pull the most relevant pieces back into the prompt as a conversation grows.

This is a separate system from [Summarization](./summarization.md), which condenses session messages into permanent lorebook entries — the two are related (summarization output gets embedded too) but configured separately; only RAG has a switch.

## Overview

- **Embeddings** (internally "vectorization") turns text — session messages, character/persona descriptions, lorebook entries, narrative graph nodes — into a numeric vector that captures its meaning. This can run locally via a small on-device model, or against any external OpenAI-compatible embeddings API.
- **RAG (Retrieval-Augmented Generation)** is what happens at generation time: right before the model writes a reply, Serene Pub compares the current conversation against all those embeddings and pulls in the handful that are most semantically relevant — even if they're from messages or lore entries that fell out of the normal context window long ago.

As a session gets long, older messages and related lore don't just disappear from the model's awareness — if embeddings are enabled, the most relevant ones are found by meaning and quietly re-inserted.

### How retrieval fits into a generated reply

When you send a message, Serene Pub's prompt builder checks whether embeddings are enabled and ready. If so, it runs a semantic search scoped to the current session: the session's own messages plus the content of the session's own lorebook only — deliberately _not_ a linked character's or persona's own separate lorebook, and not messages from other sessions, even ones sharing the same lorebook and cast. RAG only ever draws on the story world the session itself is scoped to, never on an unrelated lorebook a cast member happens to also be attached to elsewhere. Results are ranked by similarity, boosted slightly for recency, and capped per content type (a handful of messages, world lore entries, character lore entries, history entries, and narrative-graph relationships) so retrieved context doesn't crowd out the guaranteed recent messages. If embeddings are off or the model isn't ready, prompt building falls back to non-semantic (keyword/recency-based) content selection instead.

### What gets embedded

Everything embeddings touch falls into one of these buckets: session messages, character descriptions, persona descriptions, and everything inside a lorebook — world lore entries, character lore entries, history entries, and (if the lorebook has one) narrative graph nodes and relationships. See [Lorebooks](./lorebooks.md) for what those lorebook content types are and how the narrative graph itself is built. A row only ever counts as "embedded" for the specific model (and, in External API mode, the specific endpoint) that produced it — switching models or backends effectively resets everything to needing re-embedding, as covered below.

Narrative graph **nodes** are embedded and tracked for staleness like everything else, but they're not actually part of RAG's similarity search — retrieval only searches messages, world lore, character lore, history entries, and narrative _relationships_. Graph context that reaches the prompt comes from relationship matches plus a direct node lookup, not from a node's own embedding being found by meaning.

### Why some short sessions never show RAG activity

RAG scoring only ever considers messages _older_ than the most recent ten in a session — those ten are always included in the prompt directly, so there's nothing for retrieval to add. This also means sessions with ten or fewer messages are treated as not applicable for RAG at all: there's no [RAG notice](#understanding-rag-notices), and nothing gets prioritized in the queue for them, because everything already fits in the guaranteed window.

## Embedding connections

Embeddings are a section of the **Connections** sidebar, beside LLMs and Image. An embedding connection is a connection like any other: a service, a base URL and key where the service needs them, a model, and an idle TTL. Three services are offered:

- **Local ONNX** runs a model on this device: one download, then fully offline with no per-request cost. Not offered where the native runtime is unavailable (Android).
- **OpenAI-compatible** points at any `/embeddings` endpoint: OpenAI, or a self-hosted LM Studio or llama.cpp server on your network.
- **Ollama** uses Ollama's own embed endpoint with any embedding model it has pulled.

One embedding connection is starred, **Use for embeddings**, and that star is what turns retrieval by meaning on. With no star, retrieval runs on keywords alone. There is no separate switch.

The onboarding wizard's Embeddings/RAG step explains this and offers **Open Embedding Connections**; the wizard waits for a starred connection before treating the step as done.

### Choosing a local embedding model

Local ONNX offers three tiers, each trading speed for retrieval quality:

| Tier     | Model               | Dimensions | Size    | Notes                                                                                                                                                                     |
| -------- | ------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fast     | all-MiniLM-L6-v2    | 384        | ~80 MB  | Lightweight; good for shorter lorebook entries and fact-style lore; best if RAM is limited or you want to get started immediately.                                        |
| Balanced | EmbeddingGemma-300M | 768        | ~300 MB | Google's current-generation embedding model; multilingual, with strong semantic understanding of longer prose and character descriptions; a good default for most setups. |
| Best     | bge-m3              | 1024       | ~570 MB | Top-tier, multilingual retrieval quality with an 8192-token context window, useful for long character and lorebook entries; recommended if you have the RAM.              |

Models you have placed under the local models folder with the embeddings modality are offered beside these.

### Moving the star re-indexes everything

Every embedded row records which model and endpoint produced it. Starring a different embedding connection asks you to confirm and names the cost: "Every embedded row is re-indexed against the new model: N rows". On confirm the old vectors are deleted and the queue starts from the beginning against the new model. Starring a second connection that names the same endpoint and model is a no-op. Unstarring stops the queue and keeps the vectors.

### Model idle TTL

On a Local ONNX connection, **Idle TTL** unloads the model after that many minutes of inactivity, freeing RAM between bursts of embedding work. 0 keeps it loaded.

## Named entity connections

Named entities are a fourth Connections section. One local service is offered (ONNX, token classification) with two catalogue models: bert-base-NER (English; people, places, organisations, other; about 109 MB) and distilbert multilingual NER (ten languages; people, places, organisations, dates; about 135 MB). The form has no base URL or key, only an idle TTL.

Starring one, **Use for entity extraction**, adds a tier to name extraction: the spans the model finds are stored beside the names the lorebook already knows, so an entry can be matched by what a scene calls it even in lower case. With no star the extraction lane runs on the lorebook's own names and capitalised words, which is a working state rather than an off one. A starred model that fails to load falls back to that state and says so.

Starring a different entity model asks first and names the cost: "Every annotated row is re-scanned against the new model: N rows". On confirm every annotation is dropped and rebuilt through the background lane. A second connection naming the same model is a no-op; unstarring keeps what has been scanned.

## The starred connection's detail panel

The starred embedding connection shows its queue:

- A **status card** (Running / Paused / Idle) with Start or Stop, live Completed and Queued counters, and the label of the item being embedded.
- A **Queue** of pending priority groups: one session together with its lorebook, linked characters and linked personas, so a session's content is embedded as a unit.
- A **Recent** list of completed groups.
- A **Load now** action and a download bar when the local model is not in memory, for example after a server restart.

Within a group, content is embedded in a fixed order: session messages first, then lorebook content (world lore, character lore, history entries, narrative graph nodes, narrative graph relationships), then characters, then personas.

### Understanding queue states

The queue has three states, shown by both the sidebar's status card and the header navigation icon:

- **Idle** — nothing queued, or the queue has been explicitly stopped.
- **Running** — actively embedding items one at a time; since Embeddings has no left-navigation icon of its own (see above), the header's **Connections** icon is what animates and turns green while this is happening.
- **Paused** — reserved for pausing the queue without fully stopping it (for example, to avoid competing with the model during an active session generation).

### Troubleshooting a stuck or empty queue

If the queue looks stuck at "Idle" with items still needing embeddings, check the starred connection's detail panel first — the queue silently stops (and logs a warning server-side) if embeddings are disabled, if a local model fails to auto-load (most commonly because it isn't cached and can't be re-downloaded, or the server restarted and the model needs to be reloaded), or if an External API config has stopped validating. Reloading or re-downloading the model from the warning banner, then pressing Start on the Queue tab, resolves most local-mode cases. If a specific session's content never seems to finish indexing, the RAG notice inside that session has a "Prioritize in queue" button that jumps its content to the very front of the queue.

## Understanding RAG Notices

Inside a session, a **RAG notice** banner (the `RagNotice` component) can appear just above the message composer once a conversation has grown past 10 messages — below that threshold everything already fits in the guaranteed context window, so the notice doesn't apply. It checks the embedding status of the session's older messages, its linked characters, personas, and lorebook content, and shows one of three variants:

- **"RAG content not yet indexed"** — none of the applicable older content has been embedded yet, so RAG can't surface anything from this session.
- **"RAG content indexed with a different model"** — everything was embedded with a previous model/backend and needs re-indexing with the currently active one.
- **"Indexing in progress…"** — a mix of ready and pending content; shows a running count like "12 of 40 items indexed" and notes if the queue itself is paused.

Each notice includes a **Prioritize in queue** button, which moves the session (and its linked lorebook/characters/personas) to the front of the embeddings queue, and an **Ignore for this session** button, which silences the notice for that specific session going forward (shown afterward as a small "RAG disabled for this session" line with a "Re-enable" link). Once every applicable item is fully indexed with the current model, the notice disappears on its own.

### The per-item vectorization status icon

Elsewhere in the UI (character and persona editors, for example), a small icon next to an entity's name reflects its individual embedding status against the currently active model: a lightning bolt for "vectors up to date," a refresh icon for "vectors stale — model changed," and nothing shown at all if embeddings are disabled or the item has never been embedded.

## How Serene Pub ranks retrieved content

This is internal behavior — there's no UI to tune it — but understanding it helps explain why the model sometimes does or doesn't seem to "remember" something.

### Two-pass semantic queries

Rather than a single similarity search, retrieval runs two passes: a "current" query built from the last couple of messages (what's being discussed right now), and a broader "recent" query built from the few messages before that. Results from the current-topic pass are merged in first and get priority; the recent-context pass only contributes items the current pass didn't already surface. This keeps retrieval responsive to sudden topic changes instead of anchoring too heavily on whatever was relevant several messages ago.

### Blending and de-duplicating results

Each of the two passes (current and recent) actually embeds every message in its query window individually, runs a separate similarity search per message-embedding, and combines those per-message result lists with Reciprocal Rank Fusion (an item's position in each list counts more than its raw score) before re-ranking with Maximal Marginal Relevance, which intentionally trades a little relevance for diversity so the retrieved set doesn't fill up with five near-duplicate restatements of the same fact — all of this RRF+MMR work happens _within_ a single pass. The current-pass and recent-pass results are then combined by simple de-duplication (the current pass's items win; the recent pass only contributes items not already seen), not by a second round of RRF across passes. A small recency boost is also applied to message scores, and only results that clear an adaptive similarity threshold are kept.

One consequence worth knowing: the per-content-type budget described below is enforced separately inside each of the two passes, not globally across both. If the current and recent passes surface mostly disjoint items, the effective number of results for a given content type in one generation can end up close to double the stated per-pass budget, not capped at it.

### Relationships from the narrative graph

Relationships are retrieved the same way lore is. Serene Pub walks the narrative graph from whoever is speaking — what they think of the others, what the others think of them, and any figures the whole world knows of — and offers each individual relationship as a candidate that competes for the context window, rather than pasting the whole graph in.

They are ordered by three things, in this order:

1. **Who is in the scene.** A relationship with someone in this chat's cast outranks one with a character who is only in the lorebook.
2. **Whose relationship it is.** A tie the speaking character is party to outranks one between two other people.
3. **What changed most recently.** Among relationships that tie on the first two, the ones edited most recently come first.

The order is strict: presence beats everything under it, and being the speaker's own beats recency. A relationship the scene is present for is never pushed down by one that was merely edited a minute ago.

**Relationships get no share of the context window until you give them one.** Under **Context split** on the ranking step, the Relationships band starts at zero, which leaves the whole graph out of the budget — so the retrieval panel lists every relationship as _Left out — Relationships is switched off: its share is zero_, and nothing is spent. Drag that band above zero and relationships start competing for room like world lore and history do.

The band is also what the prompt's relationship sections are written from. While it has no share, nothing is selected and those sections carry the narrative-graph block they always have — every relationship the walk reached, in whatever order the rows came back, governed only by the **Most relationships** ceiling on the two relationship steps. Give the band a share and the same sections are rebuilt from what ranking actually chose: the relationships that were selected, in the order above, and only as many as the band's slice of the window and its **Most entries per source** ceiling had room for. Nothing else about them changes — the same headings, the same layout, the same **Relationship perspectives** and **Known relationships** blocks — so raising the share narrows the graph in the prompt to the part of it that earned the room, and lowering it back to zero restores the full block.

Every relationship that is considered shows up in the retrieval explanation with its reasons written out — _someone on this tie is in the cast_, _the speaking character is party to it_, _2nd most recently changed of 6_ — so an absent relationship has an answer rather than a shrug. See [Lorebooks](./lorebooks.md) for how relationships are created and edited.

### Always-included content

Two categories bypass ranking entirely: the most recent handful of session messages (the "guaranteed window") are always in the prompt regardless of token budget, and any lorebook entry marked **constant** is always included as long as it's enabled — constant entries are lore the model should never forget, so they skip the relevance contest altogether. See [Lorebooks](./lorebooks.md) for how the constant flag is set on an entry.

Bypassing the relevance contest also means bypassing token-budget trimming — pinned/constant world lore, character lore, and history entries aren't among the content types the token-budget enforcement step is allowed to shrink. In practice this is rarely an issue, but if the combined content you've marked constant/pinned in a lorebook is large enough on its own, there's currently no mechanism to trim it back down to fit the model's context limit the way ordinary RAG-recalled content is.

## Context Debugging

A System Settings toggle, **Enable Context Debugging**, is worth knowing about alongside RAG: when turned on, it adds a Statistics tab and a debug icon to session messages, computes full RAG and prompt-infill diagnostics for each generation, and saves that metadata alongside the message so you can inspect exactly what content the model saw — including which RAG results were retrieved — after the fact. This is an admin-only, opt-in setting since the extra computation and stored metadata add overhead; it's primarily useful when troubleshooting why a particular reply did or didn't seem to "remember" something. See [System Settings](./system-settings.md) for the rest of the settings on this screen.

One diagnostic gotcha worth knowing: because the current and recent passes each compute their own adaptive similarity threshold, and the recorded value is simply whatever ran last, the "adaptive similarity threshold" figure shown in Prompt Details reflects only the **recent** pass's threshold, not the current pass's — keep that in mind if the number looks like it doesn't match what you'd expect from the most recent messages specifically.
