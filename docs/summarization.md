# Summarization

Summarization is an on-demand tool for condensing session messages into permanent [lorebook](./lorebooks.md) entries — world lore, character lore, or scene summaries — so long stretches of roleplay can be distilled into compact facts instead of being kept verbatim forever.

This is a separate system from [Embeddings & RAG](./embeddings-and-rag.md), which automatically retrieves relevant content by meaning rather than compressing it — the two are related (summarized content gets embedded too, once RAG is enabled) but configured separately; only RAG has a switch. Summarization is a manual, LLM-assisted pipeline for turning session messages into permanent lorebook content, distinct from the automatic background indexing RAG does.

## Always available

Summarization has no switch. Selecting messages to summarize, processing a scene, compiling a history entry and building the graph are offered in every install; each is a manual action that runs only when you start it, so nothing costs tokens on its own. Vectorization is the one retrieval capability that still has a setting, because it needs a model chosen first.

## Summarize to Lorebook

From a session, selecting messages and choosing to summarize opens the **Summarize to Lorebook** dialog. You pick an entry type — **Scene**, **World lore**, or **Character lore** — and, if the session doesn't already read one, choose or create a [lorebook](./lorebooks.md) first. World lore and character lore entries accept an optional (character lore: required) focus topic, e.g. "abilities" or "relationship with Kira," which gets folded into the generation prompt. Character lore entries can optionally be bound to a specific character — your personas included, since a persona is a character you play. Generation runs in phases shown live in the dialog: **drafting** (messages are batched and each batch is independently summarized), **synthesizing** (the drafts are merged into one coherent, past-tense entry), and **naming** the result. The result is editable before saving, and for Scene entries the model also extracts a list of **participant** characters (physically present) and **mentioned** characters (referenced but absent), which you can adjust by hand before saving.

Scene entries require selecting a [history entry](./lorebooks.md) to attach to (or creating a new blank one on the spot), and the selected messages must form one consecutive, gap-free run with no unselected visible messages in between — the dialog warns if that's violated. A message can be in only one scene: messages already in a scene are dropped from the selection, and a save that names one anyway (or a message from another session) is refused with nothing saved.

### Re-processing a scene

Once a scene exists, its **Process** action (relabeled **Reprocess** once it already has a summary) opens the **Scene summary** window and can regenerate its summary and character list from scratch using the same drafting/synthesizing flow, replacing the previous result after you confirm. This is useful if the scene's underlying messages changed, or if an earlier summary came out wrong.

### Compiling scenes into a history entry

A lorebook's history entries can bundle several individual scene summaries into one combined entry via **Compile to Entry** (on a history entry in the lorebook's **History** section). This step skips the batch-drafting phase — since each scene is already a finished summary — and goes straight to synthesis, merging the scene summaries into a single coherent history-entry narrative you can review before applying. Applying writes only what changed. While you are reading the lorebook as of a date, it is filed as a dated change (an amendment) at that date, on the line you are reading, rather than changing the entry itself; see [Amendments](./lorebooks.md#amendments). The review stays open until the server has saved it, so a refusal leaves the compiled text there to retry.

### Where summarization prompts are configured

Each kind of summary — world lore, character lore, scene and history — is its own pipeline, configured in the **Pipelines** view like any other (see [Pipelines](./pipelines.md)). A summary runs in three model steps: drafting each batch of messages, merging the drafts, and naming the result. Each step takes its own prompt, picked on the step in the pipeline's configuration; the shipped scene and history pipelines start from the same prompts. To change the wording, clone a shipped prompt and pick the clone — see [Pipelines → Prompts](./pipelines.md#prompts). Which connection and sampling settings each step's call uses is set per step on the same configuration, so drafting can run on a smaller model than the merge.

## The Activity Sidebar

The Activity Sidebar tracks the live progress of longer-running background jobs so you don't have to babysit a modal to know when something finishes. It has an **Activity** tab (visible to everyone) and, for admins only, an **LLM queue** tab. [Getting Around → Activity](./getting-around.md#activity) describes the whole view, including what raises a notification and when one clears.

### The Activity tab

The Activity tab is in three parts, and a part with nothing in it is not shown:

- **Waiting on you** — your notifications that still need you: your turn in a session, a question addressed to you, a reply that failed. Ones you have not seen yet come first, in bold and marked **New**; a red dot means something failed, a gold one that it wants you to act. Each has a button that takes you there (and marks it seen) and an X to dismiss it.
- **In progress** — the job cards described below.
- **Earlier** — notifications that no longer need you, dimmed. Their buttons still take you there.

When all three are empty the tab says "Nothing is waiting on you."

The In progress part shows a card per in-progress or awaiting-review job relevant to the current user (plus other users' jobs, shown read-only). Card types include:

- **Graph build/extend** jobs — building or extending a lorebook's narrative graph, showing the current phase and a "scene X/Y" progress indicator. Extraction here is pure LLM text-processing of already-summarized scenes and history entries, so it depends on nothing being switched on, vectorization/RAG included — see [Lorebooks](./lorebooks.md#nesting-and-links) for what the narrative graph is. Once built, graph nodes are lorebook bindings like any other, so their content is also picked up by [Embeddings & RAG](./embeddings-and-rag.md)'s background indexing if that's separately enabled.
- **Summarize** jobs — a [Summarize to Lorebook](#summarize-to-lorebook) run for world or character lore: "Summarizing…", then "Ready to review" or "Failed". Its title takes you back to the session, where the review opens.
- **Scene** summarization jobs — shows "Processing…", then "Ready to review" or "Failed," with a "Review results" button that jumps straight to the scene.
- **Compile** jobs — history-entry compilation, with the same running/review/error states and a "Review and apply" button.

Each card can be dismissed once finished (via the X button), and most jobs that are still running for the current user can be cancelled with a **Stop** button (admins can also stop other users' jobs). **Compile jobs are the exception** — a running compile has no Stop control, so its card offers no action until it finishes, fails, or lands in review; the X to dismiss it only appears once it's no longer running. Graph build/extend, Scene, and Summarize cards all do offer Stop while running. The Activity tab's label carries the count of notifications waiting plus job cards. On the rail, the Activity icon's dot is red or gold while you have an unseen notification, or one of your own jobs failed or is waiting for your review; queued generation work no longer lights it. On a phone the same dot shows on the **Views** button.

### The LLM Queue tab (admin only)

Distinct from the embeddings queue, this tab lists **LLM generation tasks** currently queued or in-flight across the whole server — session replies, summarization calls, graph-build steps, and similar — refreshing about once per second while open. Each row shows a label, the connection and sampling preset in use, and a status; expanding a row reveals its type, connection, sampling config, associated session/lorebook ID if any, and how long it's been running. This is a systemwide operational view, separate from the per-session and per-user [connections](./connections.md) configuration.

### Troubleshooting a job that seems stuck

If a graph build, scene summarization, or compile job sits at "running" far longer than expected, check the LLM Queue tab (admin) to see whether its underlying generation call is actually queued behind other work, still generating, or has silently disappeared (which usually indicates an error on the connection side — see [Connections](./connections.md) for diagnosing a misbehaving connection). Jobs that finish with an error surface a "Failed" state with a **View Error** / **Go to Scene** or **Go to Entry** button so you can inspect what happened without losing the rest of your work.
