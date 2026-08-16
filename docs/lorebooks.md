# Lorebooks

Lorebooks are the shared knowledge base behind your stories — world facts, character secrets, a chronological history, and (optionally) a graph of who's connected to whom. A lorebook is created once and can be attached to any [chat](./chats.md), where its entries are injected into the model's context as the conversation calls for them.

## Overview

A lorebook lives in its own sidebar panel. The panel's list view shows every lorebook you own, with quick counts for bindings, world entries, character entries, and history entries, so you can tell at a glance how developed each one is. From there you can:

- Create a new lorebook (just a name to start — everything else is filled in afterward).
- Import a lorebook from a JSON file. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the supported format and field mapping.
- Search the list by name or description.
- Open a lorebook to edit it, or delete it (with a confirmation prompt — deletion cannot be undone).

Opening a lorebook switches the panel into an editor with up to six tabs across the top:

1. **Lorebook** — name, description, tags.
2. **Bindings** — the `{{char:N}}` tokens that connect lore content to actual characters/personas.
3. **World Lore** — setting/faction/location knowledge not tied to one character.
4. **Character Lore** — per-character facts, secrets, and backstory.
5. **History** — a dated timeline, with scenes captured from chats underneath each entry.
6. **Graph** — a visual map of entities and relationships extracted from your history.

The Graph tab only appears when **Summarization** is turned on in [System Settings](./system-settings.md) — narrative-graph extraction is pure LLM extraction from summarized scenes, so it depends on that pipeline but not on vectorization/embeddings at all. If you're on the Graph tab and those settings get turned off, the panel automatically falls back to the World Lore tab so you're never stuck on a tab that no longer applies.

### Two retrieval modes change what fields you see

Everywhere entries are edited, the form adapts based on whether **vectorization** is enabled system-wide:

- **Vectorization off (keyword mode).** Entries carry comma-separated **Keywords**, an optional **Use Regex** flag (treat keywords as a regex pattern instead of plain substrings), **Case Sensitive** matching, and a manual **Priority** level used as a tie-breaker when several entries compete for limited context space.
- **Vectorization on (semantic mode).** All of the above fields are hidden. Entries are instead retrieved by embedding similarity against the current conversation — see [Embeddings & RAG](./embeddings-and-rag.md) for how that pipeline works and how to enable it.

Regardless of mode, a **Pinned** entry is always included in context, bypassing both keyword matching and semantic relevance scoring — useful for facts the model must never forget (a core worldbuilding rule, a character's one unbreakable trait, and so on). An **Enabled** switch lets you soft-disable an entry without deleting it, which is handy for retiring outdated lore while keeping it around for reference.

### Creating, importing, and deleting a lorebook

The `+` button in the list view creates a new lorebook from just a name.

**Importing a foreign file** (a SillyTavern-style lorebook JSON, or any file without Serene Pub's own export metadata): every entry in the file — regardless of what type it was in the source format — is created as a World Lore entry in a brand-new lorebook, since world entries are the most format-agnostic starting point and don't require a binding. You're prompted to confirm or edit the new lorebook's name before the import commits.

**Re-importing a lorebook Serene Pub itself exported** is a different, much more faithful path: the importer detects Serene Pub's own export metadata and does a full round-trip instead of flattening everything to World Lore — entries are routed back to their original World/Character/History tables, Scenes are restored under their History entries, and Bindings and the entire narrative graph (nodes, relationships, aliases, and parent links) are restored too. If you re-import a lorebook that already exists, Serene Pub detects the conflict by content hash and asks whether to **Overwrite Existing** or **Import as New** (or reports that nothing changed, if the content is identical).

**Exporting** a lorebook is a real, working feature (not disabled) — available from a lorebook's toolbar or its row menu in the list view. It opens an **Export Options** dialog letting you choose whether to include bound characters, bound personas, and the narrative graph (all on by default) before downloading the file.

### Attaching a lorebook to the currently open chat

If you have a chat open, each lorebook's row menu (and the detail view's header, once opened) offers an **Attach to current chat** / **Detach from current chat** action — a shortcut for the same [Lorebook Binding](./chats.md#lorebook-binding) done from chat settings. If the open chat already has a lorebook attached, every other lorebook's attach action is disabled until it's detached, and the currently-attached one shows the detach action instead. Guests viewing someone else's shared chat don't see these actions — only the chat's owner can change its lorebook.

## Lorebook Tab

This is the lorebook's identity, and the simplest tab in the editor:

- **Name** (required) — shown everywhere the lorebook is referenced, including in chat settings and the sidebar list.
- **Description** (optional) — free text, useful as a one-line reminder of what the lorebook covers.
- **Tags** — the same tagging system used for [characters](./characters.md); type a tag name and press Enter or pick from the autocomplete suggestions, and click a tag chip to remove it.

The tab opens in a read-only view; click **Edit** to change fields, then **Update** to save or **Cancel** to discard your changes and revert to the last saved state. If you try to navigate to another tab (or close the sidebar) with unsaved changes, a confirmation modal stops you from losing them — this unsaved-changes guard applies across every tab in the editor, not just this one, since the Bindings, World Lore, Character Lore, and History tabs all track their own in-progress edits the same way.

## Bindings Tab

Bindings are the layer that connects a lorebook's abstract placeholders to concrete characters, personas, or standalone background characters. Each binding is a token of the form `{{char:1}}`, `{{char:2}}`, `{{char:3}}`, and so on — you insert these tokens into lore content instead of hard-coding a name, and at prompt time (and in the editor's live preview) they're swapped for whichever character, persona, or background-character name is currently linked to that binding number. This indirection means you can reuse the same lorebook across chats with different casts, or swap out who plays "the mentor" without rewriting every entry that mentions them.

Three buttons drive binding creation:

- **Add Character** — opens a character picker; selecting one creates a new binding, assigns it the next free `{{char:N}}` number automatically, and links it to that character immediately.
- **Add Persona** — the same flow, but for [personas](./personas.md).
- **Add Background Character** — creates a binding with no linked character or persona sheet at all, identified only by a name you type in (e.g. "The Innkeeper"). Use this for NPCs or background figures you want the lore and graph systems to track without maintaining a full character sheet for them.

Bindings can also exist **unlinked** — created automatically (see [Automatic binding discovery](#automatic-binding-discovery) below) with no character or persona attached yet, functionally identical to a background character until you attach one. Unlinked binding cards offer **Link character** / **Link persona** actions. Hovering a linked binding card reveals an **Unlink** action, which detaches the character or persona but keeps the row itself — the binding number, and any content already referencing it — intact as a background character; nothing you've written breaks.

### Editing a binding's identity and status

Clicking the pencil icon on a binding card opens an inline edit form:

- **Name** and **Aliases** — editable only for background (unlinked) bindings; a linked binding's name and aliases are always kept in sync with its character's or persona's own name/nickname/aliases and can't be edited here. Aliases help scene summarization recognize a character under a nickname or title instead of minting a duplicate node for them.
- **Summary** — up to 200 characters describing this character's current situation. Note that this field only reaches the model when the binding's **Visibility** is set to **legendary**: the relationship context sent with each generation is built around the speaker, and a summary is attached only to the "legendary figures" layer of it. A normal-visibility binding's Summary is stored and shown in the UI but is never sent to the AI, so treat it as a note to yourself unless you also mark the binding legendary.
- **State** — active, deceased, missing, or departed, for your own tracking of who's still around in the story.
- **Visibility** — normal (surfaces by relevance), legendary (always appears as a historical figure), or hidden (excluded from other characters' relationship context).

A **View relationships** link on the edit form jumps straight to this binding's node in the Graph tab. Deleting a binding — linked or background — also permanently deletes any private Character Lore and graph relationships tied to it; the confirmation prompt says so explicitly, and the action cannot be undone.

### How binding placeholders resolve in content

World Lore, Character Lore, and History entries all share the same rich-text content editor, which recognizes `{{char:N}}` tokens as special inline tags rather than plain text. An "Insert Character Tag" toolbar button opens a picker listing every binding in the lorebook — colored by whether it's linked to a character, a persona, or nothing — and inserts the chosen tag directly into the content at the cursor. While editing, the tag renders as the bound character or persona's nickname (or name); underneath, it's stored as the raw `{{char:N}}` token, so renaming a character elsewhere in the app doesn't require touching your lore text at all.

The legacy single-brace `{char:N}` form is still supported for backward compatibility, but only at the server/prompt level — binding auto-discovery and prompt-time resolution both still recognize it, so old content using it keeps working. The editor itself, however, doesn't give it the same special inline-tag treatment: typing or pasting `{char:N}` shows as plain text rather than a resolvable chip, so new content is best written with the double-brace `{{char:N}}` form via the Insert Character Tag picker.

### Automatic binding discovery

You rarely need to create bindings from scratch, because the server keeps them in sync with what's actually written in your entries: whenever a lorebook's entries change, every World Lore, Character Lore, and History entry's content is scanned for `{{char:N}}` / `{char:N}` tokens, and any token found that doesn't already have a binding record gets one created automatically — unlinked, ready for you to attach a character or persona (or leave as a background character).

Bindings are never deleted automatically, even if every reference to them is later removed from your lore — a binding also carries a character's graph presence, lore, and relationships, and silently deleting it out from under someone editing their story turned out to be more surprising than helpful. If a binding is no longer needed, remove it yourself with the **Delete** action on its card.

### Possible duplicates and recent merges

Below the binding list, two sections help keep the cast clean — each only appears when there's something to show:

- **Possible duplicates** appears automatically whenever the app suspects two bindings represent the same person (matched by name/alias similarity) — for example after a graph Build or Extend introduces a new node that closely resembles an existing one. Each suggested pair offers **Yes, absorb** (folds one into the other — see [Merging duplicate bindings](#merging-duplicate-bindings) below) or **No, different people**, which dismisses that specific pair permanently so it won't be suggested again.
- **Recent merges** is a collapsed-by-default list (click to expand) of absorptions you've performed, each with an **Undo** link that restores the absorbed binding exactly as it was — including its lore, aliases, and relationships. Undo stops being available once the surviving binding has itself been absorbed into something else or deleted, at which point the link is disabled with an explanatory tooltip.

### Bindings and the narrative graph

A binding is also a lorebook's narrative-graph node — the two used to be separate records, linked together, but they're now the same underlying row. Editing a binding's status fields (in [Editing a binding's identity and status](#editing-a-bindings-identity-and-status) above) is the same thing as editing its node in the [Graph tab](#graph-tab), and creating a binding is the only way to add a node to the graph by hand.

Because a binding *is* a lorebook's graph node, there's no separate linking or reconciliation step to keep the two in sync — attaching a character to a binding, or renaming it, is immediately reflected everywhere the binding's identity is used, including the Graph tab. Attaching an existing chat's characters and personas to a lorebook works the same way: opening a chat that has a lorebook attached automatically creates any missing bindings for that chat's cast. If any binding still has no character or persona attached (for example, one you added manually, or one whose link was removed), an **Unlinked Lorebook Binding** prompt appears, letting you link it to one of the chat's characters or personas on the spot, or skip it and leave it unlinked for now.

## World Lore Tab

World Lore entries hold setting, location, faction, and general-knowledge facts that aren't tied to one character — cities, factions, historical background, magic systems, house rules, and anything else that's true regardless of who's in the scene.

Each entry has:

- **Name** (required) — also used as the visible label in the list.
- **Content** — the rich-text field described above, supporting binding tags.
- **Keywords** (keyword mode only) — comma-separated triggers, e.g. `umber, umber city`.

### Search, sort, and reorder

The list toolbar offers a free-text search across name, content, and keywords, plus a sort dropdown with eight options: Position (ascending/descending), Priority (ascending/descending, with pinned entries always sorted first), Date Created, and Date Updated. A dedicated reorder mode (sort icon) switches the list into a drag-and-drop view where dragging a card sets that entry's explicit **Position** — useful when you want manual control over which entries get evaluated first in keyword mode, independent of alphabetical or chronological order.

Each card in the list shows a live preview of its content (with binding tags already resolved to character/persona names), an embedding-status indicator, and small badges for **disabled**, **pinned**, **priority level** (rendered as one to three plus-signs), and **regex keys** where applicable.

### Advanced settings on an entry

Expanding **Advanced Settings** while editing an entry exposes:

- **Use Regex** — keyword mode only; treats the Keywords field as a regular expression instead of a list of plain substrings.
- **Case Sensitive** — keyword mode only; keyword matching normally ignores case.
- **Pinned** — always included in context regardless of relevance or priority. Disables the Priority selector while active, since a pinned entry has no need for a tie-breaker.
- **Enabled** — soft-disable without deleting.
- **Priority** — keyword mode only, and only when not pinned. Three levels: Normal, High, Very High, used to decide which entries win when multiple keyword matches compete for a limited context budget.

## Character Lore Tab

Character Lore entries have the identical name/content/keywords/advanced-settings shape as World Lore entries, with one addition: a **Binding** dropdown that ties the entry to a specific `{{char:N}}` binding — a bound character or persona — or leaves it as "None (Unbound)". Typical uses are per-character secrets, backstory, abilities, or relationship notes that should only matter, or only make sense, when that particular character is relevant to the scene.

Entries with no binding are flagged with an "Unbound" warning badge in both the list and the entry's detail view, since an unbound entry has no character context tying it to anyone — it behaves like a World Lore entry in practice, just filed under the wrong tab. A binding that exists but has since lost its linked character or persona (see the Bindings tab) is flagged the same way when you open that entry, so you can tell the difference between "never bound" and "used to be bound."

The list, search, sort, and reorder behavior is otherwise identical to the World Lore tab, with one extra piece of information: each card and the reorder view both show which binding an entry is attached to, so you can scan the list for a specific character's lore at a glance.

## History Tab

The History tab is a chronological timeline of your story, distinct from World/Character Lore in that every entry is anchored to a date rather than a topic. It has the same free-text search box as World/Character Lore, plus a sort dropdown (Entry Date, Date Created, Date Updated, each ascending/descending) — but no drag-to-reorder mode, since entries are always ordered by date rather than a manually-set position.

Each **History Entry** has:

- **Year** (required).
- **Month** (optional) and **Day** (optional, but requires Month to be set — you can't have a day without knowing the month).
- **Content** — the same rich-text field as other entry types.
- **Keywords** (keyword mode only), plus the same Pinned / Enabled / Use Regex / Case Sensitive switches described above.
- **Completed** — marks whether the entry's content has been finalized, either by hand or via the Compile step described below.

Entries are locked into chronological order by the editor itself: when you edit an existing entry's date, the form calculates the exclusive date range allowed by its immediate chronological neighbors and refuses a save that would put the entry out of sequence, telling you exactly which date range is valid.

### Advancing the story's clock

The **Next Date** button (calendar-plus icon in the toolbar) is a shortcut that clones the latest entry's date forward by exactly one day, correctly rolling over month and year boundaries — including leap years — and opens a new blank entry at that date, ready for you to fill in. The entry list also flags whichever entry currently holds the very latest date as **(Current)**, so you always know where "now" is in your timeline without checking dates by hand.

### Scenes: capturing chat moments into history

Each history entry has a **Scenes** sub-tab, separate from its Content field. A Scene is a saved reference to a specific, consecutive run of messages in a chat — created via the Summarize-to-Lorebook flow described in the [pipeline section](#the-scene--history--graph-pipeline) below — along with:

- A **Name**.
- A generated **Summary**.
- **Participants** — characters physically present in the scene.
- **Mentioned** — characters referenced in the scene but not present.
- A link back to the source chat and how many of its messages the scene covers.

Scenes can be edited by hand (name, summary, and both character lists), processed or re-processed to have the LLM regenerate their summary from the underlying messages, or deleted outright. A film-strip badge on the history entry's list card shows how many scenes it has captured, and a graph icon marks scenes that have already been folded into the narrative graph.

### Compiling scenes into an entry's content

A history entry's Content field and its Scenes are separate things until you explicitly combine them. Once an entry has at least one scene, a **Compile to Entry** button becomes available — either at the bottom of the entry's Scenes sub-tab, or directly from the entry's row in the History list itself via its **···** menu, so you don't have to open an entry just to compile it. Either entry point opens the same Compile modal (detailed in the pipeline section), which synthesizes every one of that entry's scene summaries into a single piece of dated Content — turning a handful of scattered scene notes into one coherent paragraph of "what happened this year." A compile running in the background shows a **Compiling…** badge on the entry's list card, and a finished-but-unreviewed compile shows a **Review** badge — both clickable shortcuts back into the same modal, and both persist across closing and reopening the sidebar the same way a Graph build does.

## Graph Tab

The Graph tab visualizes a narrative graph: nodes representing characters, factions, or other recurring entities, connected by directed relationships (e.g. "ally," "rival," "romantic") that the LLM extracts from your summarized scenes and history entries. It's only available when Summarization is enabled system-wide (vectorization/embeddings has no bearing on it), and it's the most power-user-facing part of the lorebook system — most of what appears here starts out generated, then gets refined by hand.

The toolbar switches between a force-directed **graph view** and a flat **list view** of every node and relationship, offers **Build Graph** (relabeled **Rebuild Graph** once nodes already exist) and **Extend** actions covered below, and an **Add Character** button that jumps to the [Bindings tab](#bindings-tab) — since a node is a binding (see above), that's also where a node is added or edited by hand, rather than in a separate form here.

### Node fields

A node's fields are exactly the fields on its underlying binding, described under [Editing a binding's identity and status](#editing-a-bindings-identity-and-status):

- **Name** (and Aliases) — synced from the linked character/persona, or set directly for a background character.
- **State** — active, deceased, missing, or departed.
- **Visibility** — normal, legendary (known widely / mythologized), or hidden (secret from most characters).
- **Summary** — an optional 200-character note used as short context infill when the node is referenced.

There's no separate "which character does this node represent" field to set, because the node and the character binding are the same record — linking a binding to a character in the Bindings tab is what gives that node its identity.

### Relationship fields

- **Type** — free text, e.g. "ally," "rival," "romantic," "mentor."
- **Status** — active, resolved, broken, or evolved.
- **Visibility** — acknowledged, secret, or public.
- **Description** — free text detail about the relationship.
- **Reason for this state** — optional note on why the relationship is at its current status (useful when a relationship changes over time and you want a record of why).
- An optional link to a History Entry marking when the relationship applies.

Clicking a node in graph view opens a detail card (purely informational — its fields aren't editable inline) where you can add a new relationship starting from it, jump to the Bindings tab to edit it, absorb it into another node, or delete it — deleting a node also permanently deletes every relationship attached to it, and the confirmation prompt tells you exactly how many that is before you commit.

### Building vs. extending the graph

Two different actions grow the graph, and picking the right one matters:

- **Build Graph** processes every summarized scene in the lorebook (plus any history entry that has direct content) and proposes a **complete** graph from scratch. If a graph already exists, building again **replaces it entirely** — the confirmation screen states how many existing unbound nodes and relationships will be permanently deleted.
- **Extend** only processes scenes and history entries that haven't been graphed yet, adding new nodes and relationships to what's already there without touching or deleting anything existing.

In both cases, scenes that don't yet have a generated summary are listed as "skipped" in the confirmation screen, since the extraction step only has text to work with once a scene has been summarized — an unprocessed scene simply doesn't contribute anything to the graph yet.

Either action runs as a background LLM job with a live progress bar showing the current scene being processed and a running count of nodes/relationships found so far. When it finishes, a **review** screen lists every proposed node and relationship individually — each one can be expanded, hand-edited, or removed before you click **Apply Graph** to commit them. A build in progress persists across closing and reopening the sidebar (it's tracked as a background activity, the same way other long-running LLM tasks are), and can be cancelled mid-run without losing the entries it already has.

### What a graph rebuild actually preserves

A rebuild sounds like it should wipe the slate clean, but in practice no binding row is ever deleted by it, bound or unbound: every relationship in the lorebook is wiped and rebuilt from scratch, but every binding instead has its graph-side fields (state, visibility, summary, aliases synced from its character, its scene/history-entry anchor) reset to defaults rather than the row itself being removed. That means a rebuild can't silently detach a character's private Character Lore or delete a background character you added by hand — though any manual edits you'd made to a node's state, visibility, or summary are still lost in the reset, just not the binding itself.

### Merging duplicate bindings

Extraction — or manual entry — can sometimes produce two nodes for what's really the same underlying character, e.g. "Kira" and "the innkeeper" turning out to be the same person once the story reveals it. The **Absorb** action (the git-merge icon on a node's detail card, or the **Yes, absorb** button in the Bindings tab's [Possible duplicates](#possible-duplicates-and-recent-merges) list) folds one binding into another: you pick which duplicate to fold in, its name is added to the survivor's "Also known as" list, its relationships and any private Character Lore are reattached to the survivor, and the absorbed binding row itself is deleted. If the two bindings being merged are both linked to a character or persona, the app refuses — two linked bindings represent genuinely distinct people and can never be folded into each other; a linked binding merging with a background/unlinked one is fine, and the linked one always survives regardless of which you pick as the "target."

This is a safe, reversible cleanup step, not a permanent one: every absorb is logged, and **Undo** in the Bindings tab's **Recent merges** list restores the absorbed binding exactly as it was — until the surviving binding is itself absorbed into something else or deleted, at which point that particular undo is no longer available.

## The Scene → History → Graph Pipeline

Turning a conversation into structured, graph-connected lore is a four-step pipeline that spans the chat page and three of the tabs above. Each generation step runs through the same kind of modal shell: a confirm/configure screen, a running screen with live streaming progress (and, for longer jobs, a debug trace of the actual prompts sent to the model), and a review screen where you edit the LLM's output before committing it.

### Step 1 — Summarize to Lorebook (from the chat)

From within a chat, selecting one or more messages and choosing to summarize opens the **Summarize to Lorebook** modal. You pick an entry type:

- **Scene** — requires selecting (or creating on the spot) the History Entry this scene belongs to. The selected messages must form a consecutive, gap-free run — the modal warns you if there's a visible message in between that wasn't selected.
- **World Lore** — an optional focus topic narrows what the summary concentrates on.
- **Character Lore** — a focus topic is required here (e.g. "abilities" or "relationship with Kira"), and you can optionally bind the resulting entry to a character or persona.

If the chat doesn't have a lorebook attached yet, the modal walks you through attaching an existing one or creating a new one before you can continue. Clicking **Generate Summary** streams a draft from the LLM — in batches for longer message selections, followed by a synthesis pass that merges the batches into one coherent result — and lands you on a review screen where you can edit the generated name and content by hand. Saving a **Scene** creates the Scene record (with its Participants/Mentioned character lists, auto-extracted by the model) attached to the chosen history entry; saving **World Lore** or **Character Lore** creates the corresponding lore entry directly, ready to appear in its respective tab.

### Step 2 — Process Scene (in the History tab)

A saved scene doesn't need a summary right away — you can capture the raw message range now and generate its summary later. Its **Process** action (sparkles icon; becomes **Reprocess** once it already has a summary) opens the **Scene Summary** modal, which re-derives the scene's summary and its Participants/Mentioned lists directly from the scene's underlying messages, independent of whatever was captured in Step 1. Progress streams live in the same batched-draft-then-synthesis pattern, and the result lands on a review screen where you can hand-edit the title, the summary text, or either character list before clicking **Apply**.

If a scene has a pending review that you didn't finish — the app closed, or you navigated away mid-process — the same pending result reopens for review the next time you visit it, rather than being lost; the activity sidebar also offers a "Review & Apply" shortcut that jumps straight back into this modal for any scene with unfinished work.

### Step 3 — Compile to Entry (in the History tab)

Once a history entry has one or more scenes with summaries, its **Compile to Entry** button opens a modal titled **Compile to Entry**, which synthesizes all of that entry's scene summaries into a single piece of dated Content. If the entry already had existing content, the review screen shows a word-level diff — additions and removals highlighted inline — against the newly synthesized version, so you can see precisely what changed before accepting it rather than blindly overwriting your own edits. Saving marks the entry **Completed** and writes the synthesized text into its Content field; that field is the text every other system in the app — search, retrieval, and prompt building — treats as the entry's canonical, authoritative content, regardless of how many scenes fed into producing it.

### Step 4 — Build or Extend the Narrative Graph (in the Graph tab)

With scenes summarized and history entries compiled, the [Graph tab](#graph-tab)'s **Build Graph** / **Extend** actions extract nodes and relationships from that material, as described above. This is the step that turns "text describing what happened" into "a queryable graph of who is connected to whom, and how, and why it changed" — new scenes and history entries keep accumulating as "ready to process" counts on the Graph tab's toolbar until you run Build or Extend again, so the graph is always an explicit, on-demand snapshot rather than something that updates itself silently in the background.

### Where the pipeline typically breaks down

A few conditions block each step, and knowing them ahead of time saves a trip through an error message:

- The Graph tab (and therefore Step 4) is entirely unavailable unless Summarization is enabled in [System Settings](./system-settings.md) — vectorization being on or off doesn't affect this.
- Step 1's Scene option refuses to generate if the selected messages have a gap — reselect a truly consecutive run of visible messages.
- Step 1's Character Lore option won't generate without a focus topic; World Lore's topic is optional.
- Step 4 silently skips any scene that hasn't been through Step 2 (or the review from Step 1) yet — if your "ready to process" count seems low, check for scenes still missing a summary.
