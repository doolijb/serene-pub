# Chats

Chats are where roleplay actually happens in Serene Pub: one or more [characters](./characters.md) and one or more [personas](./personas.md) exchange messages in a shared thread, with full control over turn order, regeneration, branching, and how much context the AI sees. This page covers the chat screen itself — creating chats, group-chat mechanics, message actions, and the composer's Lore, Pinned Images, and Statistics tabs.

## Overview

A chat lives at `/chats/[id]` and is built from a few core pieces:

- **Characters** — one or more AI-driven participants, added in a specific order that determines their turn order in group chats.
- **Personas** — one or more user-driven participants. The chat owner and any guests each send messages as one of the personas attached to the chat.
- **Scenario** — an optional block of scene-setting text that's fed into every prompt.
- **Lorebook** — an optional bound [lorebook](./lorebooks.md) supplying world lore, character lore, and history entries.
- **AI overrides** — admin-only per-chat overrides for connection, sampling, [prompt config](./prompt-configs.md), and [Narrator Prompt config](./prompt-configs.md#chat-prompts-narrator).

Everything in the chat updates live over sockets — new messages, generation progress, edits, and deletions are pushed to every connected participant (owner and guests alike) as they happen.

Under the hood every chat is a `roleplay`-type chat with an `isGroup` flag that's automatically true once more than one character is attached.

## Starting a New Chat

Click the **+** button at the top of the Chats sidebar to open the new-chat form. A chat requires:

- **Chat Name** — required, shown in the sidebar and browser tab.
- **Characters** — at least one. Characters are listed in the order you add them; when there's more than one, you can drag them by the grip handle to reorder. This order is the round-robin turn order in group chats.
- **Personas** — at least one. Unlike Characters, the **Add Persona** button is never actually disabled — you can add multiple personas to a brand-new chat before it's ever saved, the same as adding multiple characters.

Optional fields available on the same form (covered in detail below): **Group Reply Strategy** (once 2+ characters are added), **Scenario**, **Lorebook**, **AI Override** (admin only), and **Tags**.

Saving calls `chats:create` (or `chats:update` when editing) over the socket; a success toast confirms the save and the form closes. Open the chat itself from its entry in the sidebar list.

### Editing Chat Settings Later

Reopening a chat's settings (via the sidebar's Edit action, or the Edit button in a chat's view panel) loads the same form used for creation, now pre-filled and with a few extra controls: per-character Active/Visibility toggles and the Guests section. Leaving the form with unsaved changes and trying to close the sidebar prompts a **"Your chat has unsaved changes. Are you sure you want to discard them?"** confirmation before letting you navigate away.

### Guests

If accounts are enabled system-wide, editing an existing chat reveals a **Guests** section where the chat owner can add other users as guests via **Add Guests**. Guests can view the chat and participate as their own persona; editing chat settings itself remains owner-only, but regenerating/continuing/swiping a message is available to a guest too if it belongs to a character _they_ own — see [Guest Permission Boundaries](#guest-permission-boundaries) below for the precise rule. See [Users & Accounts](./users-and-accounts.md) for account/guest concepts in general.

### Deleting a Chat

The sidebar's per-chat overflow menu includes **Delete**, which opens a confirmation modal warning that the chat and _all of its messages_ will be permanently removed — this cannot be undone. Deleting the chat you're currently viewing navigates you back to the home screen automatically.

## The Chats Sidebar

The sidebar list shows every chat you own or have been added to as a guest, with:

- Stacked avatars for the chat's characters and personas (up to 3 shown, with a "+N" badge for more).
- The chat name and a truncated list of character/persona names underneath.
- A search box that filters by chat name, persona name, character name, or tag.
- A per-chat overflow menu (View, Edit, Delete) — Delete is a destructive confirmation modal that also removes all of the chat's messages.

Clicking a chat's **View** entry opens a compact read-only summary panel (characters, personas, scenario, tags) with **Go To Chat** and **Edit** buttons, without leaving the sidebar. Clicking the chat row itself navigates straight to `/chats/[id]`.

The sidebar can also arrive pre-filtered: opening a chat list from a character's or persona's own panel passes that character/persona's ID through, and the sidebar shows a removable filter chip plus only the matching chats.

### Jumping to a Character or Persona from a Chat

Inside a chat, clicking a message's avatar opens an **avatar gallery modal** for that character or persona (browsing every uploaded image for them), while clicking their _name_ opens their full profile panel ([Characters](./characters.md) or [Personas](./personas.md)) so you can review or edit them without losing your place in the conversation.

## Group Chats & Reply Strategy

A chat becomes a "group chat" as soon as it has more than one character attached. Group chats add turn-order mechanics that 1:1 chats don't need.

### Group Reply Strategy

When a chat has 2+ characters, _or_ 2+ personas with just one character, the chat settings form shows a **Group Reply Strategy** dropdown with:

- **Ordered (Round-robin)** — the default. Characters take turns in their configured order — see Turn Order & Round-Robin Replies, below, for exactly how Serene Pub decides who's due.
- **User-Split (Round-robin by user)** — only offered when user accounts are enabled system-wide, since it's meaningless with a single user. Instead of interleaving every participant's cast together, it groups personas and characters by which user owns them — one user's entire cast completes a turn before the next user's does.
- **Manual (User selects)** — you pick who responds using the Trigger Character controls described below instead of relying on the automatic rotation.

### The "Ready to Continue" Banner

In a group chat, once it's a character's turn (and you don't have a draft message or an edit in progress), a rounded banner appears above the composer showing that character's avatar and name with **"ready to continue"**. It offers a **Continue** button (send them in) and a people-icon button to instead choose a different character.

### Triggering Responses Manually

The composer's **Extra Controls** tab (see below) exposes buttons for taking control of who talks next: **Continue**, **Trigger Character**, **Regenerate**, and a Narrator trigger (see [Narrator Response](#narrator-response) below). **Trigger Character** opens a searchable grid of the chat's characters (search matches name, nickname, description, or creator notes), with a pinned option above the search box labeled with the resolved Narrator display name (**"Narrator"** by default) — picking a character generates exactly one response from them regardless of whose "turn" it technically is; picking the pinned option opens the Narrator Response instructions modal instead.

**Continue** (labeled "Continue Conversation" via its tooltip) repeatedly asks "is anyone due right now?" and generates for whoever is, one at a time, until nobody's due anymore (or a safety cap is hit) — useful for catching up a group chat after several personas have spoken, without needing to click once per character.

### Activating, Deactivating & Visibility

Each character row in the chat settings form (when editing an existing chat) has two additional controls:

- An **Active/Inactive** switch — deactivating a character removes them from the turn rotation and generation entirely without removing them from the chat. Toggling emits `chats:toggleChatCharacterActive`.
- A **visibility** button that cycles through **Full Info → Name Only → Hidden** (the tooltip states what happens on the character's other turns, e.g. "When not speaking: Only name/nickname is included"). This controls how much of that character's information is sent to the model when it isn't their turn — Name Only keeps just their name/nickname, Hidden omits them from context entirely while inactive-in-turn. Toggling emits `chats:updateChatCharacterVisibility`.

Deactivating a character is the right tool when you want to "bench" a character for a while (they stay in the chat's roster, keep their message history, but stop being generated for) without the disruption of removing and re-adding them later. Visibility, by contrast, is purely a context-budget optimization for chats with many characters — it doesn't affect whether a character can be triggered, only how much of their sheet the model sees when they're not the one speaking.

### Turn Order & Round-Robin Replies

Serene Pub decides who's due for a reply by looking at recent message history, not by tracking a persistent "whose turn is it" pointer — the whole rotation is recomputed fresh every time. Let N be the number of active characters plus personas attached to the chat. Serene Pub looks at the last N messages: if every character and persona appears at least once in that window, the rotation is considered "healthy" (nobody's been silently dropped from the conversation), and any character who hasn't sent a message in the last N-1 of those messages is **due**. If more than one character is due at once, whichever has gone the longest without replying (or has never replied at all) is suggested first.

A character who has never sent a single message in the visible history is always treated as immediately due, regardless of whether the window currently looks "healthy" — this is what makes a brand-new chat produce its first reply, and what keeps a character newly added mid-chat from waiting around for the window to catch up.

Because this is recomputed from history rather than tracked as state, a persona doesn't have to wait for every other persona to speak before the next due character can go, and manually triggering a character out of turn (see Triggering Responses Manually, above) never leaves the rotation "stuck" on a character who was skipped — the very next automatic check just re-reads the updated history and picks correctly from it.

## Personas & Persona Switching

Every chat needs at least one persona. If a chat has more than one persona attached to your account, a **Switch Persona** control appears: an avatar with a chevron badge next to the composer on desktop-width screens, plus a dedicated "Switch Persona" tab on the composer's tab bar — always visible there even on mobile, unlike the other extra tabs (see The Composer's Tab Bar, below). On mobile, the avatar-and-chevron control is hidden in favor of that tab, so it's the one place to switch personas on a narrow screen.

If you're a guest in someone else's chat and don't yet have a persona attached, the composer instead shows a **"Join the Conversation"** call-to-action with an **Add Your Persona** button, which opens a persona picker scoped to your own personas.

Message-level controls respect persona ownership: as a guest, you can only edit, hide, or delete messages that belong to your own persona — you cannot touch other participants' persona messages. Regenerating, continuing, and swiping are different: those work on _character_ messages, and a guest can use them on any character _they_ own, even in someone else's chat — see [Guest Permission Boundaries](#guest-permission-boundaries) for the precise rule. Trigger Character and the round-robin Continue button, however, are unavailable to guests, since the whole Extra Controls tab is hidden for them.

## Scenario

The **Scenario** field (a multi-line textarea in the chat settings form) is free text describing the setting, situation, or premise of the chat. It's marked with an eye icon tooltipped "This field will be visible in prompts" — meaning its contents are compiled directly into the prompt sent to the model on every generation, alongside character and persona info. The scenario also displays in the chat's read-only view panel in the sidebar.

## Lorebook Binding

The **Lorebook** dropdown in chat settings attaches a single [lorebook](./lorebooks.md) to the chat (or "None"). Once attached, the chat draws on that lorebook's world lore, character lore, and history entries when compiling prompts, and unlocks the composer's **Lore** tab (below) for browsing/creating history entries and scenes directly from the chat. Summarizing chat messages into lore (see [Summarization](./summarization.md)) will also auto-bind a lorebook to the chat if one isn't already set. A chat's lorebook can also be attached or detached from the [Lorebooks](./lorebooks.md) sidebar itself, via each lorebook's menu or the detail view, when that chat is the one currently open.

## Prompt Config, Connection & Sampling Overrides

Administrators editing a chat see an **AI Override** section with a note that it "Overrides system defaults for this chat. Leave as 'System default' to use the global setting." It lets an admin pin a specific **connection**, **sampling config** (both via the shared connection/sampling picker — see [Connections](./connections.md)), **prompt config**, and **Narrator Prompt** config (both plain dropdowns defaulting to "System default") to this one chat, independent of what any individual user has active elsewhere. See [Prompt Configs](./prompt-configs.md) for what a prompt config controls, and the [Chat Prompts: Narrator](./prompt-configs.md#chat-prompts-narrator) section specifically for the Narrator Prompt override — note that unlike the Narrator Prompt override, the plain **prompt config** override on this form is currently a known no-op; see the caveat in [Per-chat prompt override](./prompt-configs.md#per-chat-prompt-override). This section is not shown to non-admin users.

## Tags

Chats can be tagged from the settings form the same way [characters](./characters.md), [personas](./personas.md), and [lorebooks](./lorebooks.md) can — type into the tag field for autocomplete suggestions from existing tags, or add a new one. Tags feed the sidebar search box. See [Tags](./tags.md) for more on the tagging system.

## Sending Messages

The composer at the bottom of the chat has **Compose** and **Preview** tabs (Preview renders your draft's Markdown, including the app's quoted-text styling, before you send). On desktop-width screens (1024px and up), pressing **Enter** sends the message and **Shift+Enter** inserts a newline; on narrower/mobile layouts, Enter always inserts a newline and you send via the paper-plane **Send** button. While a response is generating, the Send button is replaced by a **Stop Generation** button.

Your draft is autosaved to the server (debounced ~500ms as you type) so it survives a page reload or navigating away and back — drafts are restored automatically when you reopen the chat.

If [context debugging](./system-settings.md) is enabled system-wide, the composer also shows a live token count against your active context limit, and turns red with a "Token limit exceeded" warning if your draft would push the compiled prompt over budget.

### The Composer's Tab Bar

Beyond Compose and Preview, the composer's tab bar picks up extra tabs conditionally, in this order:

1. **Switch Persona** — only if you have more than one persona attached to this chat. This is the one extra tab guests still get.
2. **Extra Controls** — hidden entirely if you're a guest, regardless of whether you have a persona in the chat yet.
3. **Lore** — only if the chat has a lorebook attached, and hidden entirely for guests.
4. **Pinned Images** — hidden entirely for guests.
5. **Statistics** — only if context debugging is enabled system-wide, and hidden entirely for guests.

A read-only token-count tab pins itself to the far right once a prompt has been compiled at least once (for example, after your first send, or once context debugging starts tracking your draft).

On narrower/mobile layouts, Switch Persona stays its own permanent tab, but Extra Controls, Lore, Pinned Images, and Statistics collapse into a single "More" popover (an ellipsis button, or the active tab's own icon if one of them is open) to keep the tab row from overflowing.

### Auto-Cascading Group Replies

In a group chat, any single persona message is enough to trigger a check for whether a character is now due (see Turn Order & Round-Robin Replies, above) — Serene Pub doesn't wait for every persona in the chat to chime in first. If a character is due, they're generated automatically; if not, nothing happens until the rotation says someone is.

## Message Actions

Every message has a row of action buttons — shown inline on desktop (revealed on hover/focus) and via an overflow (⋮) popover on mobile. Which buttons appear depends on the message's role, position, and state.

### Quick Reference

| Action                   | Icon       | Where it appears                                                            | Who can use it                          |
| ------------------------ | ---------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Stop Generation          | Square     | Only on the message currently generating                                    | Owner                                   |
| Regenerate Response      | Refresh    | Only the newest character message, once idle                                | Owner, or whoever owns that character   |
| Continue Response        | Down arrow | Only the newest character message, if it has content                        | Owner, or whoever owns that character   |
| Edit Message             | Pencil     | Any message, unless something is generating or it's hidden                  | Owner, or the persona/character's owner |
| Branch Chat              | Git branch | Any message, unless something is generating                                 | Any participant with chat access        |
| Select for Summarization | Bookmark   | Any non-generating message, if summarization is enabled                     | Any participant with chat access        |
| View Prompt Details      | Info       | Character messages with recorded debug metadata, if context debugging is on | Anyone who can see the message          |
| Hide / Unhide Message    | Ghost      | Any message                                                                 | Owner, or the persona/character's owner |
| Delete Message           | Trash      | Any message                                                                 | Owner, or the persona/character's owner |
| Swipe Left / Right       | Chevrons   | The newest character message, or an eligible greeting                       | Owner, or whoever owns that character   |

The sections below go through the less self-explanatory of these in more detail.

### What Each Action Does

- **Stop Generation** (square icon) — only while that specific message is actively generating; cancels the in-flight LLM call.
- **Regenerate Response** (refresh icon) — only on the most recent character message, and only once nothing else is generating. Clears the message and re-runs generation from scratch. Available to the chat owner, or to whoever owns that specific character (so a guest who brought their own character into the chat can regenerate its replies too).
- **Continue Response** (down-arrow icon) — only on the most recent character message that already has content. Resumes generation, appending to the existing text instead of replacing it — useful when a response was cut off. Same owner-or-character-owner rule as Regenerate.
- **Edit Message** (pencil icon) — swaps the message body for an inline composer so you can rewrite it in place, with Cancel/Save controls replacing the row's action buttons while editing. Disabled while any message is generating or while the message is hidden.
- **Branch Chat** (git-branch icon) — opens a small modal asking for a new chat title, then creates a full copy of the chat (same characters, personas, guests, tags, scenario, lorebook, and reply strategy) containing every message up to and including this one, and navigates you into the new chat. Available to any participant with access to the chat, not just the owner.
- **Select for Summarization** (bookmark icon) — only shown when summarization is enabled system-wide; enters summarization selection mode (see below). Not shown while a message is generating.
- **View Prompt Details** (info icon) — only shown with context debugging enabled and only once the message has recorded debug metadata; opens the same Prompt Details modal described under Statistics, scoped to that message's generation.
- **Hide / Unhide Message** (ghost icon) — toggles `isHidden`; hidden messages are dimmed in the thread and excluded from what gets sent to the model, without deleting them.
- **Delete Message** (trash icon) — opens a confirmation modal before permanently removing the message.

### Swiping Through Alternate Replies

Character messages that are eligible support **swiping**: a left/right chevron pair (with an "N / total" counter) lets you cycle through alternate generations of that same message.

- **Swipe Left** steps back to a previously-generated variant (only enabled once you've swiped forward at least once).
- **Swipe Right** steps forward through already-generated variants if any exist ahead of your current position; once you're on the _newest_ variant, swiping right instead generates a brand-new alternate response and appends it to the swipe history.

Swipe controls only appear on the latest message from a character (or, for greeting messages, any greeting that comes after the last persona message) and follow the same owner-or-character-owner rule as regenerate/continue.

### Greeting Messages

A character's opening line — generated when they first join the conversation — is flagged as a **greeting** and shown with a small handshake icon next to their name. Greetings behave slightly differently from ordinary messages for swiping: you can page back and forth through a greeting's existing alternates (if the character has more than one greeting variant defined), but swiping right on a greeting never generates a brand-new one on the fly the way it does for a normal reply — you're only ever browsing variants that already exist for that character.

### Editing a Message

Clicking Edit replaces the message content with the same composer used for new messages (Markdown, same keyboard shortcuts), pre-filled with the current text. Save writes the change via `chatMessages:update`; Cancel discards it. You can't start editing while any message in the chat is generating.

### Selecting Messages for Summarization

Selecting a message for summarization switches the whole chat into a multi-select mode: the composer area is replaced by a toolbar showing how many messages are selected, with **Select All**, **Select None**, **Cancel**, and three destination buttons — **Scene**, **World Lore**, and **Character Lore** — plus per-message **Select**, **Select All Above**, and **Select All Below** helpers. Messages already captured in an existing scene are locked out of selection (shown with a film-strip "In Scene" badge). Selecting **Scene** requires a _contiguous_ run of messages with no visible (non-hidden) gap between the earliest and latest picks — Serene Pub blocks the summarize action and explains why if you've skipped over an unselected, visible message. The actual summarization mechanics (what gets extracted and how it's stored) are covered in [Summarization](./summarization.md); how the result feeds RAG is covered in [Embeddings & RAG](./embeddings-and-rag.md).

## The Extra Controls Tab

The composer's **Extra Controls** tab (message-square icon) is a compact row of buttons for group-chat, regeneration, and Narrator response shortcuts without leaving the compose area. Note this whole tab (like Lore, Pinned Images, and Statistics) is hidden entirely for guests — see [The Composer's Tab Bar](#the-composers-tab-bar) above:

- **Continue** — checks who's due per the round-robin logic (see Group Chats above) and keeps generating, one at a time, until nobody's due anymore.
- **Trigger Character** — opens the character-search modal (with a pinned option, labeled with the resolved Narrator display name, above the search box) and generates exactly one response from whichever you pick.
- **Regenerate** — re-generates the most recent message, character or Narrator response alike (equivalent to that message's own Regenerate action).
- **A Narrator trigger**, labeled with the resolved config's Display Name (**"Narrator"** by default) — opens the Narrator Response instructions modal. See [Narrator Response](#narrator-response) below.

Continue, Trigger Character, and Regenerate are disabled while any message is currently generating, or if the chat has no persona at all; the Narrator trigger is disabled only while something is generating.

Unlike Regenerate/Continue/Swipe on an existing message (which enforce the owner-or-character-owner rule server-side), **Trigger Character and the round-robin Continue button here have no server-side ownership check at all** — they're gated purely by this whole tab being hidden from guests client-side. In practice this only matters if a guest could somehow reach the tab; through the normal UI, guests never see it.

## Narrator Response

**Narrator Response** is a manually-triggered message that narrates as the environment itself: weather, scenery, side characters, shopkeepers, monsters, or other third parties, rather than as any of the chat's defined characters. It has no persistent identity of its own (no avatar, no character sheet) and is never auto-triggered: unlike ordinary character replies, a Narrator response never counts toward or interrupts round-robin turn order, and it's never suggested by the "ready to continue" banner.

### Triggering a Narrator Response

Two entry points open the same instructions modal:

- The Narrator trigger button in the **Extra Controls** tab (see above).
- The pinned option (labeled with the resolved Narrator display name) above the search box in the **Trigger Character** modal.

The modal shows an optional **Extra instructions** text field for anything you want this specific response to focus on (for example, "focus on the weather turning stormy" or "have the shopkeeper notice the party") — leave it blank for a generic narration pass. Confirming inserts a new message and starts generating immediately, just like any other response.

### Display name

A Narrator Response message shows up in the thread with an icon and a label — **"Narrator"** by default, or whatever **Display Name** is configured on the resolved Chat Prompts: Narrator config (see [Prompt Configs](./prompt-configs.md#chat-prompts-narrator)) at the moment it was generated. Renaming the config afterward doesn't retroactively relabel already-generated messages; each one keeps the name it was generated with.

### Message actions on a Narrator Response

Edit, Branch, Hide, Delete, and Regenerate all work on a Narrator Response message the same as on any other, restricted to the chat **owner** (a Narrator Response isn't owned by any persona or character, so the persona/character-owner exception that applies to other messages doesn't apply here). Continue and Swipe aren't available on Narrator Response messages.

## The Lore Tab

When a chat has a lorebook bound to it, the composer gains a **Lore** tab (book icon) surfacing that lorebook's history-entry pipeline without leaving the chat:

- The current (most recent) history entry, with its scene count and an **Open in lorebook** shortcut.
- A **+** button to start a new history entry (iterating from the latest one).
- A **Summarize Scene** shortcut (when summarization is enabled) that drops you straight into summarization selection mode for capturing a scene.
- An **Extend Graph (N)** button when there are scenes that haven't been folded into the lorebook's relationship graph yet.
- A **Recent Entries** list (up to five prior entries) for quick navigation back into lorebook history.

This tab is a shortcut layer over the [lorebook](./lorebooks.md)'s own history-entry and scene features — the full editing experience lives in the Lorebooks panel.

## Pinned Images (Scene Images)

The composer's **Pinned Images** tab (images icon) lets you pin an avatar or gallery image from any character or persona in the chat to a **Left** or **Right** slot. Pinned images render as overlays alongside the chat itself (outside the message thread) — useful as a lightweight visual aid for "who's in the scene right now" without touching the character's actual profile avatar.

Each participant row shows Left/Right pin toggle buttons for their default avatar, plus an expandable gallery (fetched on demand) of that character's or persona's other uploaded images, each with hover-revealed Left/Right pin controls. Clearing a slot removes the overlay. Your left/right picks are remembered per chat in the browser's local storage, so they persist across reloads but are not synced between devices or shared with other participants.

## Understanding RAG Notices

When [vectorization](./embeddings-and-rag.md) is enabled system-wide, a notice banner can appear directly above the composer summarizing the RAG-indexing state of everything relevant to the chat (messages, characters, personas, and lorebook entries):

- **"RAG content not yet indexed"** — nothing has been embedded yet for this chat's content; RAG can't surface anything from it until indexing runs.
- **"RAG content indexed with a different model"** — existing embeddings were generated with a previously-active embedding model and need to be redone against the current one.
- **"Indexing in progress…"** — a mix of indexed and pending content, with a running count and a note if the embedding queue itself is paused.

The notice offers **Prioritize in queue** (moves this chat's content to the front of the embedding queue) and **Ignore for this chat** (silences the notice and excludes the chat from RAG going forward, with a one-click **Re-enable** link shown afterward in its place). No notice appears once everything is fully indexed.

Individual messages also carry a small per-message embedding-status icon next to the sender's name: a lightning bolt when that message's embedding matches the currently active embedding model, or a refresh icon when it was embedded under a since-changed model and is stale. See [Embeddings & RAG](./embeddings-and-rag.md) for how retrieval, scoring, and the underlying embedding queue actually work.

## Statistics Tab & Prompt Details

If **context debugging** is enabled in [System Settings](./system-settings.md), the composer gains a **Statistics** tab (bar-chart icon) showing a live token count and included/total message count for your current draft, plus a **Details** button that opens the full **Prompt Details** modal. That modal breaks down, for the most recently compiled prompt:

- **Token Budget** — total vs. limit, a progress bar, the active prompt format/template name, whether the RAG or keyword context-infill engine was used, and any truncation reason.
- **Messages** — how many chat messages were included vs. excluded (with excluded message IDs listed), and, when RAG is active, a Guaranteed / RAG-recalled / Fill-in breakdown.
- **Lore & Graph** — pinned vs. RAG-recalled counts for world lore, character lore, and history entries, plus any graph relationship pairs that matched (RAG mode), or budget/top-score figures per lore type (keyword mode).
- **RAG Retrieval Scores** — the adaptive similarity threshold used, how many recent messages were embedded as the query window, and score-distribution bars for retrieved messages and lore.
- **Sources** — which characters, personas, and scenario contributed to the compiled prompt.
- **Prompt Preview** — the actual compiled prompt, rendered either as chat-formatted role blocks or as raw text depending on the connection's prompt format.

### Per-Message Prompt Details

With context debugging on, character messages that recorded generation metadata also get a **View Prompt Details** action in their own message controls, opening the same modal scoped to that specific message's generation rather than your current draft.

## Power-User Notes & Edge Cases

### Loading Older History

Scrolling within ~200px of the top of the message list triggers loading the next page of older messages (25 at a time), preserving your scroll position so the view doesn't jump. This is a cursor-based `beforeId` pagination, not a full reload.

### Native Thinking & Reasoning Blocks

If the active model/connection returns native "thinking" output (e.g. Ollama models with `think: true`) or assistant-mode XML-tag reasoning, the message shows a collapsible **Thinking** or **Reasoning** section above its main content — collapsed by default, expandable per-message.

### Generation Stages

While a message is generating with no content yet, the UI distinguishes **Queued** (waiting in the LLM queue) from **Loading model…** (a managed model is starting up) before falling back to the typing/generating animation once tokens start streaming.

### Failed Generations

If a generation errors out, the message shows the error text/code inline with a **Retry** button that re-runs regeneration in place, rather than silently failing or leaving a blank message.

### Guest Permission Boundaries

To recap the ownership rules scattered through this page: guests can send messages as their own persona, edit/hide/delete only their own persona's messages, and branch the chat — all of that is unconditional. Regenerating, continuing, and swiping a _character_ message, though, isn't chat-owner-only: it's available to the chat owner **or** to whoever owns that specific character, so a guest who brought their own character into someone else's chat can control that character's replies too, even though they can't touch anyone else's. Triggering a character out of turn (Trigger Character) and the round-robin Continue button are the ones actually unavailable to guests — not because of a server-side ownership check, but because the whole Extra Controls tab (along with Lore, Pinned Images, and Statistics) is hidden from guests client-side. Select for Summarization has no ownership restriction at all — any participant with access to the chat can use it, on any message.

### Chat Not Found

Navigating to a chat you don't have access to (or that's been deleted) shows a dedicated "Chat not found" state instead of an empty thread.

### Context Exceeded Warnings

Both the composer and the Statistics tab track your compiled prompt's token total against your active context limit. If it goes over budget, the token counter turns red (in the composer tab bar and in the Statistics tab), the textarea gets an inline "Token limit exceeded. Message may be truncated." warning, and the Prompt Details modal's token bar switches from success-green through warning-orange to error-red as it fills up — the modal also surfaces the specific truncation reason (for example, oldest messages being dropped) when one applies.

### Why Can't I Regenerate, Continue, or Swipe?

These three actions are available to the chat's **owner**, or to whoever owns the specific character the message belongs to — this is enforced server-side (`checkMessageEditPermission`), not just hidden in the UI. If you're a guest and don't own that character, you'll be able to send messages as your own persona and manage your own persona's messages, but these controls won't take effect for you on someone else's character. Separately, Trigger Character and the Extra Controls tab's round-robin Continue button are unavailable to any guest regardless of character ownership — but that restriction is purely client-side (the whole Extra Controls tab is hidden for guests), not a server-side ownership check like the other three.

### Why Isn't the Next-Character Banner Showing?

The "ready to continue" banner only appears when _all_ of the following are true: it's a group chat with more than one active character, nothing is currently generating, you don't have unsent draft text, you aren't editing a message, the round-robin logic has a character queued up, and the chat already has at least one message. Typing a draft or opening an edit will hide the banner until you clear it.
