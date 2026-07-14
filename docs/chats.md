# Chats

Chats are where roleplay actually happens in Serene Pub: one or more [characters](./characters.md) and one or more [personas](./personas.md) exchange messages in a shared thread, with full control over turn order, regeneration, branching, and how much context the AI sees. This page covers the chat screen itself — creating chats, group-chat mechanics, message actions, and the composer's Lore, Pinned Images, and Statistics tabs.

## Overview

A chat lives at `/chats/[id]` and is built from a few core pieces:

- **Characters** — one or more AI-driven participants, added in a specific order that determines their turn order in group chats.
- **Personas** — one or more user-driven participants. The chat owner and any guests each send messages as one of the personas attached to the chat.
- **Scenario** — an optional block of scene-setting text that's fed into every prompt.
- **Lorebook** — an optional bound [lorebook](./lorebooks.md) supplying world lore, character lore, and history entries.
- **AI overrides** — admin-only per-chat overrides for connection, sampling, and [prompt config](./prompt-configs.md).

Everything in the chat updates live over sockets — new messages, generation progress, edits, and deletions are pushed to every connected participant (owner and guests alike) as they happen.

Under the hood every chat is a `roleplay`-type chat with an `isGroup` flag that's automatically true once more than one character is attached.

## Starting a New Chat

Click the **+** button at the top of the Chats sidebar to open the new-chat form. A chat requires:

- **Chat Name** — required, shown in the sidebar and browser tab.
- **Characters** — at least one. Characters are listed in the order you add them; when there's more than one, you can drag them by the grip handle to reorder. This order is the round-robin turn order in group chats.
- **Personas** — at least one. Once a persona is added, the "Add Persona" button becomes disabled unless you're editing an existing chat with multiple personas already present — persona selection for new chats is effectively single-persona-first, with more added later via editing.

Optional fields available on the same form (covered in detail below): **Group Reply Strategy** (once 2+ characters are added), **Scenario**, **Lorebook**, **AI Override** (admin only), and **Tags**.

Saving calls `chats:create` (or `chats:update` when editing) over the socket; a success toast confirms the save and the form closes. Open the chat itself from its entry in the sidebar list.

### Guests

If accounts are enabled system-wide, editing an existing chat reveals a **Guests** section where the chat owner can add other users as guests via **Add Guests**. Guests can view the chat and participate as their own persona, but most administrative actions (editing chat settings, regenerating, continuing, swiping) remain owner-only. See [Users & Accounts](./users-and-accounts.md) for account/guest concepts in general.

### Editing Chat Settings Later

Reopening a chat's settings (via the sidebar's Edit action, or the Edit button in a chat's view panel) loads the same form used for creation, now pre-filled and with a few extra controls: per-character Active/Visibility toggles, the Guests section, and (existing chats only) the ability to add additional personas beyond the first. Leaving the form with unsaved changes and trying to close the sidebar prompts a **"Your chat has unsaved changes. Are you sure you want to discard them?"** confirmation before letting you navigate away.

### Deleting a Chat

The sidebar's per-chat overflow menu includes **Delete**, which opens a confirmation modal warning that the chat and *all of its messages* will be permanently removed — this cannot be undone. Deleting the chat you're currently viewing navigates you back to the home screen automatically.

## The Chats Sidebar

The sidebar list shows every chat you own or have been added to as a guest, with:

- Stacked avatars for the chat's characters and personas (up to 3 shown, with a "+N" badge for more).
- The chat name and a truncated list of character/persona names underneath.
- A search box that filters by chat name, persona name, character name, or tag.
- A per-chat overflow menu (View, Edit, Delete) — Delete is a destructive confirmation modal that also removes all of the chat's messages.

Clicking a chat's **View** entry opens a compact read-only summary panel (characters, personas, scenario, tags) with **Go To Chat** and **Edit** buttons, without leaving the sidebar. Clicking the chat row itself navigates straight to `/chats/[id]`.

The sidebar can also arrive pre-filtered: opening a chat list from a character's or persona's own panel passes that character/persona's ID through, and the sidebar shows a removable filter chip plus only the matching chats.

### Jumping to a Character or Persona from a Chat

Inside a chat, clicking a message's avatar opens an **avatar gallery modal** for that character or persona (browsing every uploaded image for them), while clicking their *name* opens their full profile panel ([Characters](./characters.md) or [Personas](./personas.md)) so you can review or edit them without losing your place in the conversation.

## Group Chats & Reply Strategy

A chat becomes a "group chat" as soon as it has more than one character attached. Group chats add turn-order mechanics that 1:1 chats don't need.

### Turn Order & Round-Robin Replies

Serene Pub tracks whose turn it is by looking at messages sent since the last persona (user) message. In the normal (non-triggered) flow, it walks the active characters in their configured order and picks the **first one who hasn't replied yet** since that last user message; once every active character has replied, the round is considered complete and no one is auto-suggested next. Character order — set when you add them, and reorderable by drag-and-drop in the chat settings form — is what defines this rotation.

For example, in a 3-character group chat (Alice, Bob, Carol, in that order) where you just sent a message: Alice is suggested next. Once Alice replies, Bob is suggested. Once Bob replies, Carol is suggested. Once all three have replied, the round is complete and the composer waits for your next message — at which point the rotation starts over from Alice.

### Group Reply Strategy

When a chat has 2+ characters, the chat settings form shows a **Group Reply Strategy** dropdown with two options:

- **Ordered (Round-robin)** — the default. Characters take turns in their configured order, as described above.
- **Manual (User selects)** — you pick who responds using the Trigger Character controls described below instead of relying on the automatic rotation.

### The "Ready to Continue" Banner

In a group chat, once it's a character's turn (and you don't have a draft message or an edit in progress), a rounded banner appears above the composer showing that character's avatar and name with **"ready to continue"**. It offers a **Continue** button (send them in) and a people-icon button to instead choose a different character.

### Triggering Responses Manually

The composer's **Extra Controls** tab (see below) exposes three buttons for taking control of who talks next: **Continue**, **Trigger Character**, and **Regenerate**. **Trigger Character** opens a searchable grid of the chat's characters (search matches name, nickname, description, or creator notes) — picking one generates exactly one response from that character regardless of whose "turn" it technically is.

**Continue** (labeled "Continue Conversation" via its tooltip) re-runs the round-robin turn logic in "triggered" mode: it will keep generating responses, character by character, until every active character has replied in the current round — useful for catching up a group chat after several personas have spoken.

### Activating, Deactivating & Visibility

Each character row in the chat settings form (when editing an existing chat) has two additional controls:

- An **Active/Inactive** switch — deactivating a character removes them from the turn rotation and generation entirely without removing them from the chat. Toggling emits `chats:toggleChatCharacterActive`.
- A **visibility** button that cycles through **Full Visibility → Minimal Visibility → Hidden** (tooltip labeled "Context Optimization"). This controls how much of that character's information is sent to the model when it isn't their turn — Minimal keeps just their name/nickname, Hidden omits them from context entirely while inactive-in-turn. Toggling emits `chats:updateChatCharacterVisibility`.

Deactivating a character is the right tool when you want to "bench" a character for a while (they stay in the chat's roster, keep their message history, but stop being generated for) without the disruption of removing and re-adding them later. Visibility, by contrast, is purely a context-budget optimization for chats with many characters — it doesn't affect whether a character can be triggered, only how much of their sheet the model sees when they're not the one speaking.

## Personas & Persona Switching

Every chat needs at least one persona. If a chat has more than one persona attached to your account, a **Switch Persona** control appears (an avatar with a chevron badge next to the composer, and — on the composer's tab bar — a dedicated "Switch Persona" tab on smaller layouts) so you can pick which persona your next message is sent as.

If you're a guest in someone else's chat and don't yet have a persona attached, the composer instead shows a **"Join the Conversation"** call-to-action with an **Add Your Persona** button, which opens a persona picker scoped to your own personas.

Message-level controls respect persona ownership: as a guest, you can only edit, hide, or delete messages that belong to your own persona (or to a persona owned by you specifically) — you cannot touch other participants' messages, and you cannot regenerate, continue, swipe, or trigger character responses at all (those require chat ownership).

## Scenario

The **Scenario** field (a multi-line textarea in the chat settings form) is free text describing the setting, situation, or premise of the chat. It's marked with an eye icon tooltipped "This field will be visible in prompts" — meaning its contents are compiled directly into the prompt sent to the model on every generation, alongside character and persona info. The scenario also displays in the chat's read-only view panel in the sidebar.

## Lorebook Binding

The **Lorebook** dropdown in chat settings attaches a single [lorebook](./lorebooks.md) to the chat (or "None"). Once attached, the chat draws on that lorebook's world lore, character lore, and history entries when compiling prompts, and unlocks the composer's **Lore** tab (below) for browsing/creating history entries and scenes directly from the chat. Summarizing chat messages into lore (see [Summarization](./summarization.md)) will also auto-bind a lorebook to the chat if one isn't already set. A chat's lorebook can also be attached or detached from the [Lorebooks](./lorebooks.md) sidebar itself, via each lorebook's menu or the detail view, when that chat is the one currently open.

## Prompt Config, Connection & Sampling Overrides

Administrators editing a chat see an **AI Override** section with a note that it "Overrides system defaults for this chat. Leave as 'System default' to use the global setting." It lets an admin pin a specific **connection**, **sampling config** (both via the shared connection/sampling picker — see [Connections](./connections.md)), and **prompt config** (a plain dropdown defaulting to "System default") to this one chat, independent of what any individual user has active elsewhere. See [Prompt Configs](./prompt-configs.md) for what a prompt config controls. This section is not shown to non-admin users.

## Tags

Chats can be tagged from the settings form the same way [characters](./characters.md), [personas](./personas.md), and [lorebooks](./lorebooks.md) can — type into the tag field for autocomplete suggestions from existing tags, or add a new one. Tags feed the sidebar search box. See [Tags](./tags.md) for more on the tagging system.

## Sending Messages

The composer at the bottom of the chat has **Compose** and **Preview** tabs (Preview renders your draft's Markdown, including the app's quoted-text styling, before you send). On desktop-width screens (1024px and up), pressing **Enter** sends the message and **Shift+Enter** inserts a newline; on narrower/mobile layouts, Enter always inserts a newline and you send via the paper-plane **Send** button. While a response is generating, the Send button is replaced by a **Stop Generation** button.

Your draft is autosaved to the server (debounced ~500ms as you type) so it survives a page reload or navigating away and back — drafts are restored automatically when you reopen the chat.

If [context debugging](./system-settings.md) is enabled system-wide, the composer also shows a live token count against your active context limit, and turns red with a "Token limit exceeded" warning if your draft would push the compiled prompt over budget.

### The Composer's Tab Bar

Beyond Compose and Preview, the composer's tab bar picks up extra tabs conditionally, in this order:

1. **Switch Persona** — only if you have more than one persona attached to this chat.
2. **Extra Controls** — always available (unless you're a guest without a persona yet).
3. **Lore** — only if the chat has a lorebook attached.
4. **Pinned Images** — always available.
5. **Statistics** — only if context debugging is enabled system-wide.

A read-only token-count tab pins itself to the far right once a prompt has been compiled at least once (for example, after your first send, or once context debugging starts tracking your draft).

### Auto-Cascading Group Replies

In a group chat, once every persona attached to the chat has sent a message following the last character reply, Serene Pub automatically triggers the next round of character responses — you don't have to manually click Continue after every persona in the group has spoken.

## Message Actions

Every message has a row of action buttons — shown inline on desktop (revealed on hover/focus) and via an overflow (⋮) popover on mobile. Which buttons appear depends on the message's role, position, and state.

### Quick Reference

| Action | Icon | Where it appears | Who can use it |
| --- | --- | --- | --- |
| Stop Generation | Square | Only on the message currently generating | Owner |
| Regenerate Response | Refresh | Only the newest character message, once idle | Owner |
| Continue Response | Down arrow | Only the newest character message, if it has content | Owner |
| Edit Message | Pencil | Any message, unless something is generating or it's hidden | Owner, or the persona/character's owner |
| Branch Chat | Git branch | Any message, unless something is generating | Any participant with chat access |
| Select for Summarization | Bookmark | Any non-generating message, if summarization is enabled | Owner, or the persona/character's owner |
| View Prompt Details | Info | Character messages with recorded debug metadata, if context debugging is on | Anyone who can see the message |
| Hide / Unhide Message | Ghost | Any message | Owner, or the persona/character's owner |
| Delete Message | Trash | Any message | Owner, or the persona/character's owner |
| Swipe Left / Right | Chevrons | The newest character message, or an eligible greeting | Owner |

The sections below go through the less self-explanatory of these in more detail.

### What Each Action Does

- **Stop Generation** (square icon) — only while that specific message is actively generating; cancels the in-flight LLM call.
- **Regenerate Response** (refresh icon) — only on the most recent character message, and only once nothing else is generating. Clears the message and re-runs generation from scratch. Owner-only.
- **Continue Response** (down-arrow icon) — only on the most recent character message that already has content. Resumes generation, appending to the existing text instead of replacing it — useful when a response was cut off. Owner-only.
- **Edit Message** (pencil icon) — swaps the message body for an inline composer so you can rewrite it in place, with Cancel/Save controls replacing the row's action buttons while editing. Disabled while any message is generating or while the message is hidden.
- **Branch Chat** (git-branch icon) — opens a small modal asking for a new chat title, then creates a full copy of the chat (same characters, personas, guests, tags, scenario, lorebook, and reply strategy) containing every message up to and including this one, and navigates you into the new chat. Available to any participant with access to the chat, not just the owner.
- **Select for Summarization** (bookmark icon) — only shown when summarization is enabled system-wide; enters summarization selection mode (see below). Not shown while a message is generating.
- **View Prompt Details** (info icon) — only shown with context debugging enabled and only once the message has recorded debug metadata; opens the same Prompt Details modal described under Statistics, scoped to that message's generation.
- **Hide / Unhide Message** (ghost icon) — toggles `isHidden`; hidden messages are dimmed in the thread and excluded from what gets sent to the model, without deleting them.
- **Delete Message** (trash icon) — opens a confirmation modal before permanently removing the message.

### Swiping Through Alternate Replies

Character messages that are eligible support **swiping**: a left/right chevron pair (with an "N / total" counter) lets you cycle through alternate generations of that same message.

- **Swipe Left** steps back to a previously-generated variant (only enabled once you've swiped forward at least once).
- **Swipe Right** steps forward through already-generated variants if any exist ahead of your current position; once you're on the *newest* variant, swiping right instead generates a brand-new alternate response and appends it to the swipe history.

Swipe controls only appear on the latest message from a character (or, for greeting messages, any greeting that comes after the last persona message) and are owner-only, like regenerate/continue.

### Greeting Messages

A character's opening line — generated when they first join the conversation — is flagged as a **greeting** and shown with a small handshake icon next to their name. Greetings behave slightly differently from ordinary messages for swiping: you can page back and forth through a greeting's existing alternates (if the character has more than one greeting variant defined), but swiping right on a greeting never generates a brand-new one on the fly the way it does for a normal reply — you're only ever browsing variants that already exist for that character.

### Editing a Message

Clicking Edit replaces the message content with the same composer used for new messages (Markdown, same keyboard shortcuts), pre-filled with the current text. Save writes the change via `chatMessages:update`; Cancel discards it. You can't start editing while any message in the chat is generating.

### Selecting Messages for Summarization

Selecting a message for summarization switches the whole chat into a multi-select mode: the composer area is replaced by a toolbar showing how many messages are selected, with **Select All**, **Select None**, **Cancel**, and three destination buttons — **Scene**, **World Lore**, and **Character Lore** — plus per-message **Select**, **Select All Above**, and **Select All Below** helpers. Messages already captured in an existing scene are locked out of selection (shown with a film-strip "In Scene" badge). Selecting **Scene** requires a *contiguous* run of messages with no visible (non-hidden) gap between the earliest and latest picks — Serene Pub blocks the summarize action and explains why if you've skipped over an unselected, visible message. The actual summarization mechanics (what gets extracted and how it's stored) are covered in [Summarization](./summarization.md); how the result feeds RAG is covered in [Embeddings & RAG](./embeddings-and-rag.md).

## The Extra Controls Tab

The composer's **Extra Controls** tab (message-square icon) is a compact row of three buttons for group-chat and regeneration shortcuts without leaving the compose area:

- **Continue** — cascades through the round-robin turn order (see Group Chats above), generating for every character who still owes a reply this round.
- **Trigger Character** — opens the character-search modal and generates exactly one response from whichever character you pick.
- **Regenerate** — re-generates the most recent character message (equivalent to that message's own Regenerate action).

All three are disabled while any message is currently generating, or if the chat has no persona at all.

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

To recap the ownership rules scattered through this page: guests can send messages as their own persona, and edit/hide/delete only their own persona's messages, and can branch the chat. Regenerating, continuing, swiping, and triggering character turns are restricted to the chat's owner regardless of guest status.

### Chat Not Found

Navigating to a chat you don't have access to (or that's been deleted) shows a dedicated "Chat not found" state instead of an empty thread.

### Context Exceeded Warnings

Both the composer and the Statistics tab track your compiled prompt's token total against your active context limit. If it goes over budget, the token counter turns red (in the composer tab bar and in the Statistics tab), the textarea gets an inline "Token limit exceeded. Message may be truncated." warning, and the Prompt Details modal's token bar switches from success-green through warning-orange to error-red as it fills up — the modal also surfaces the specific truncation reason (for example, oldest messages being dropped) when one applies.

### Why Can't I Regenerate, Continue, or Swipe?

These three actions — along with Trigger Character and the Extra Controls tab's Continue/Regenerate buttons — are restricted to the chat's **owner**. If you're viewing a chat as a guest, you'll be able to send messages as your own persona and manage your own messages, but you won't see these controls take effect the way the owner does. This is enforced server-side, not just hidden in the UI.

### Why Isn't the Next-Character Banner Showing?

The "ready to continue" banner only appears when *all* of the following are true: it's a group chat with more than one active character, nothing is currently generating, you don't have unsent draft text, you aren't editing a message, the round-robin logic has a character queued up, and the chat already has at least one message. Typing a draft or opening an edit will hide the banner until you clear it.
