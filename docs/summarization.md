# Summarization

Summarization is an on-demand tool for condensing chat messages into permanent [lorebook](./lorebooks.md) entries — world lore, character lore, or scene summaries — so long stretches of roleplay can be distilled into compact facts instead of being kept verbatim forever.

This is a separate system from [Embeddings & RAG](./embeddings-and-rag.md), which automatically retrieves relevant content by meaning rather than compressing it — the two are related (summarized content gets embedded too, once RAG is enabled) but independently enabled and configured. Summarization is a manual, LLM-assisted pipeline for turning chat messages into permanent lorebook content, distinct from the automatic background indexing RAG does.

## Enabling Summarization

Summarization is controlled from **System Settings**, under the "Summarization" section, and requires admin privileges to change. It's a single switch — its in-app description: "When enabled, you can select a range of chat messages and generate a Scene Summary from them (via an LLM), which feeds the Narrative Graph and can become a lorebook history entry. This is a manual, per-chat action — nothing runs automatically, and the original messages are never removed or replaced during prompt construction."

The onboarding wizard's Summarization step offers **Skip for now** (marks the step done without turning summarization on) and **Enable Summarization** (turns the feature on server-wide and marks the step done). Either choice advances the wizard. This step is tracked per-user on the server, independent of whether you actually have any chats yet.

## Summarize to Lorebook

From a chat, selecting messages and choosing to summarize opens the **Summarize to Lorebook** dialog. You pick an entry type — **Scene**, **World Lore**, or **Character Lore** — and, if the chat doesn't already have one, attach or create a [lorebook](./lorebooks.md) first. World Lore and Character Lore entries accept an optional (Character Lore: required) focus topic, e.g. "abilities" or "relationship with Kira," which gets folded into the generation prompt. Character Lore entries can optionally be bound to a specific character or persona. Generation runs in two phases shown live in the dialog: **drafting** (messages are batched and each batch is independently summarized) and **synthesizing** (the drafts are merged into one coherent, past-tense entry). The result is editable before saving, and for Scene entries the model also extracts a list of **participant** characters (physically present) and **mentioned** characters (referenced but absent), which you can adjust by hand before saving.

Scene entries require selecting a [history entry](./lorebooks.md) to attach to (or creating a new blank one on the spot), and the selected messages must form one consecutive, gap-free run with no unselected visible messages in between — the dialog warns if that's violated.

### Re-processing a scene

Once a scene exists, its **Process** action (relabeled **Reprocess** once it already has a summary) opens the **Scene Summary** modal and can regenerate its summary and character list from scratch using the same drafting/synthesizing flow, replacing the previous result after you confirm. This is useful if the scene's underlying messages changed, or if an earlier summary came out wrong.

### Compiling scenes into a history entry

A lorebook's history entries can bundle several individual scene summaries into one combined entry via **Compile to Entry** (in the History Entry manager). This step skips the batch-drafting phase — since each scene is already a finished summary — and goes straight to synthesis, merging the scene summaries into a single coherent history-entry narrative you can review before applying.

### Where summarization prompts are configured

The drafting, synthesis, and name-generation prompts used by World Lore, Character Lore, and Scene summarization are each their own configuration, editable from the **Prompts** sidebar under World Summarize, Character Summarize, and Scene Summarize sections. See [Prompt Configs](./prompt-configs.md) for how these presets — and their optional per-step connection/sampling overrides — are managed.

## The Activity Sidebar

The Activity Sidebar tracks the live progress of longer-running background jobs so you don't have to babysit a modal to know when something finishes. It has an **Activity** tab (visible to everyone) and, for admins only, an **LLM Queue** tab.

### The Activity tab

The Activity tab shows a card per in-progress or awaiting-review job relevant to the current user (plus other users' jobs, shown read-only). Card types include:

- **Graph build/extend** jobs — building or extending a lorebook's narrative graph, showing the current phase and a "scene X/Y" progress indicator. Extraction here is pure LLM text-processing of already-summarized scenes and history entries, so it depends on Summarization being enabled, not on vectorization/RAG — see [Lorebooks](./lorebooks.md#graph-tab) for what the narrative graph is. Once built, graph nodes are lorebook bindings like any other, so their content is also picked up by [Embeddings & RAG](./embeddings-and-rag.md)'s background indexing if that's separately enabled.
- **Scene** summarization jobs — shows "Processing…", then "Ready to review" or "Failed," with a "Review Results" button that jumps straight to the scene.
- **Compile** jobs — history-entry compilation, with the same running/review/error states and a "Review & Apply" button.

Each card can be dismissed once finished (via the X button), and most jobs that are still running for the current user can be cancelled with a **Stop** button (admins can also stop other users' jobs). **Compile jobs are the exception** — a running compile has no Stop control, so its card offers no action until it finishes, fails, or lands in review; the X to dismiss it only appears once it's no longer running. Graph build/extend, Scene, and Summarize cards all do offer Stop while running. A badge on the Activity tab shows the total count of active-or-awaiting-review items; the same count feeds a badge on the app header's Activity icon.

### The LLM Queue tab (admin only)

Distinct from the embeddings queue, this tab lists **LLM generation tasks** currently queued or in-flight across the whole server — chat replies, summarization calls, graph-build steps, and similar — refreshing about once per second while open. Each row shows a label, the connection and sampling preset in use, and a status; expanding a row reveals its type, connection, sampling config, associated chat/lorebook ID if any, and how long it's been running. This is a systemwide operational view, separate from the per-chat and per-user [connections](./connections.md) configuration.

### Troubleshooting a job that seems stuck

If a graph build, scene summarization, or compile job sits at "running" far longer than expected, check the LLM Queue tab (admin) to see whether its underlying generation call is actually queued behind other work, still generating, or has silently disappeared (which usually indicates an error on the connection side — see [Connections](./connections.md) for diagnosing a misbehaving connection). Jobs that finish with an error surface a "Failed" state with a **View Error** / **Go to Scene** or **Go to Entry** button so you can inspect what happened without losing the rest of your work.
