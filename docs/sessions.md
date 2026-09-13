# Sessions

Sessions are where roleplay actually happens in Serene Pub: one or more [characters](./characters.md) and one or more [personas](./personas.md) exchange messages in a shared thread, with full control over turn order, regeneration, branching, and how much context the AI sees. This page covers the session screen itself — creating sessions, group-session mechanics, message actions, and the composer's Lore, Pinned Images, and Statistics tabs.

## Overview

A session lives at `/sessions/[id]` and is built from a few core pieces:

- **Characters** — one or more AI-driven participants, added in a specific order that determines their turn order in group sessions.
- **Personas** — one or more user-driven participants. The session owner and any guests each send messages as one of the personas attached to the session.
- **Scenario** — an optional block of scene-setting text that's fed into every prompt.
- **Lorebook** — an optional bound [lorebook](./lorebooks.md) supplying world lore, character lore, and history entries.
- **AI overrides** — admin-only per-session overrides for connection, sampling, [prompt config](./prompt-configs.md), and [Narrator Prompt config](./prompt-configs.md#session-prompts-narrator).

Everything in the session updates live over sockets — new messages, generation progress, edits, and deletions are pushed to every connected participant (owner and guests alike) as they happen.

Under the hood every session is a `roleplay`-type session with an `isGroup` flag that's automatically true once more than one character is attached.

## Starting a New Session

Click the **+** button at the top of the Sessions sidebar to open the new-session form. Creating a session is three answers, stacked down one column, each appearing once the one above it is answered: first the **Genre** — what kind of session this is, which decides what systems exist for it (characters, personas, lorebooks, the composer) and stays with the session for its life; then the **Preset** — the bundle an administrator has enabled for that genre, which decides which pipelines answer its events and which actions come along; then the session's own **Settings**, pre-filled from whatever the preset supplies — switching presets before you save only fills in fields you haven't typed into yet, never overwriting something you've already entered. A step with only one answer takes it silently rather than asking, so a stock install — one genre, one preset — shows you the settings form alone, exactly as it always has. If an administrator has enabled no preset for a genre, the form says so and **Create** is disabled: there is nothing to start the session from.

The preset is doing more than labelling the bundle: its **event bindings** are what decide which pipeline answers each of the genre's events — the reply, the greeting on creation, each action that comes along — and which named configuration that pipeline runs with, so two presets on one genre can differ entirely in what a turn actually does. Administrators set both of those, and the pre-filled values the settings step opens with, on the preset's own page under **Admin → Session presets** (bindings under _Event bindings_, the pre-fill under _Creation defaults_) — the latter only ever fills in fields the person creating the session hasn't already touched, so it can't clobber something they've typed.

If a bound pipeline later stops being available — an upgrade republished it, a plugin that shipped it was removed — the session does **not** stop working: it runs the genre's default pipeline for that event instead, and says so. Everyone in the session sees a banner naming which event fell back (administrators also get the pipeline it was bound to and a link to fix it), the run's own report says which pipeline actually ran and why, and the preset is flagged in **Admin → Session presets** until the binding resolves again.

The settings step requires:

- **Session Name** — required, shown in the sidebar and browser tab.
- **Characters** — at least one. Characters are listed in the order you add them; when there's more than one, you can drag them by the grip handle to reorder. This order is the round-robin turn order in group sessions.
- **Personas** — at least one. Unlike Characters, the **Add Persona** button is never actually disabled — you can add multiple personas to a brand-new session before it's ever saved, the same as adding multiple characters.

Optional fields available on the same form (covered in detail below): **Group Reply Strategy** (once 2+ characters are added), **Scenario**, **Lorebook**, **AI Override** (admin only), and **Tags**.

Saving calls `sessions:create` (or `sessions:update` when editing) over the socket; a success toast confirms the save and the form closes. Open the session itself from its entry in the sidebar list.

### Editing Session Settings Later

Reopening a session's settings (via the sidebar's Edit action, or the Edit button in a session's view panel) loads the same form used for creation, now pre-filled and with a few extra controls: per-character Active/Visibility toggles and the Guests section. Leaving the form with unsaved changes and trying to close the sidebar prompts a **"Your session has unsaved changes. Are you sure you want to discard them?"** confirmation before letting you navigate away.

### Guests

If accounts are enabled system-wide, editing an existing session reveals a **Guests** section where the session owner can add other users as guests via **Add Guests**. Guests can view the session and participate as their own persona; editing session settings itself remains owner-only, but regenerating/continuing/swiping a message is available to a guest too if it belongs to a character _they_ own — see [Guest Permission Boundaries](#guest-permission-boundaries) below for the precise rule. See [Users & Accounts](./users-and-accounts.md) for account/guest concepts in general.

### Deleting a Session

The sidebar's per-session overflow menu includes **Delete**, which opens a confirmation modal warning that the session and _all of its messages_ will be permanently removed — this cannot be undone. Deleting the session you're currently viewing navigates you back to the home screen automatically.

## The Sessions Sidebar

The sidebar list shows every session you own or have been added to as a guest, with:

- Stacked avatars for the session's characters and personas (up to 3 shown, with a "+N" badge for more).
- The session name and a truncated list of character/persona names underneath.
- A search box that filters by session name, persona name, character name, or tag.
- A per-session overflow menu (View, Edit, Delete) — Delete is a destructive confirmation modal that also removes all of the session's messages.

Clicking a session's **View** entry opens a compact read-only summary panel (characters, personas, scenario, tags) with **Go To Session** and **Edit** buttons, without leaving the sidebar. Clicking the session row itself navigates straight to `/sessions/[id]`.

The sidebar can also arrive pre-filtered: opening a session list from a character's or persona's own panel passes that character/persona's ID through, and the sidebar shows a removable filter chip plus only the matching sessions.

### Jumping to a Character or Persona from a Session

Inside a session, clicking a message's avatar opens an **avatar gallery modal** for that character or persona (browsing every uploaded image for them), while clicking their _name_ opens their full profile panel ([Characters](./characters.md) or [Personas](./personas.md)) so you can review or edit them without losing your place in the conversation.

## Group Sessions & Reply Strategy

A session becomes a "group session" as soon as it has more than one character attached. Group sessions add turn-order mechanics that 1:1 sessions don't need.

### Group Reply Strategy

When a session has 2+ characters, _or_ 2+ personas with just one character, the session settings form shows a **Group Reply Strategy** dropdown with:

- **Ordered (Round-robin)** — the default. Characters take turns in their configured order — see Turn Order & Round-Robin Replies, below, for exactly how Serene Pub decides who's due.
- **User-Split (Round-robin by user)** — only offered when user accounts are enabled system-wide, since it's meaningless with a single user. Instead of interleaving every participant's cast together, it groups personas and characters by which user owns them — one user's entire cast completes a turn before the next user's does.
- **Manual (User selects)** — you pick who responds using the Trigger Character controls described below instead of relying on the automatic rotation.

### The "Ready to Continue" Banner

In a group session, once it's a character's turn (and you don't have a draft message or an edit in progress), a rounded banner appears above the composer showing that character's avatar and name with **"ready to continue"**. It offers a **Continue** button (send them in) and a people-icon button to instead choose a different character.

### Triggering Responses Manually

The composer's **Extra Controls** tab (see below) exposes buttons for taking control of who talks next: **Continue**, **Trigger Character**, **Regenerate**, and a Narrator trigger (see [Narrator Response](#narrator-response) below). **Trigger Character** opens a searchable grid of the session's characters (search matches name, nickname, description, or creator notes), with a pinned option above the search box labeled with the resolved Narrator display name (**"Narrator"** by default) — picking a character generates exactly one response from them regardless of whose "turn" it technically is; picking the pinned option opens the Narrator Response instructions modal instead.

**Continue** (labeled "Continue Conversation" via its tooltip) repeatedly asks "is anyone due right now?" and generates for whoever is, one at a time, until nobody's due anymore (or a safety cap is hit) — useful for catching up a group session after several personas have spoken, without needing to click once per character.

### Activating, Deactivating & Visibility

Each character row in the session settings form (when editing an existing session) has two additional controls:

- An **Active/Inactive** switch — deactivating a character removes them from the turn rotation and generation entirely without removing them from the session. Toggling emits `sessions:toggleSessionCharacterActive`.
- A **visibility** button that cycles through **Full Info → Name Only → Hidden** (the tooltip states what happens on the character's other turns, e.g. "When not speaking: Only name/nickname is included"). This controls how much of that character's information is sent to the model when it isn't their turn — Name Only keeps just their name/nickname, Hidden omits them from context entirely while inactive-in-turn. Toggling emits `sessions:updateSessionCharacterVisibility`.

Deactivating a character is the right tool when you want to "bench" a character for a while (they stay in the session's roster, keep their message history, but stop being generated for) without the disruption of removing and re-adding them later. Visibility, by contrast, is purely a context-budget optimization for sessions with many characters — it doesn't affect whether a character can be triggered, only how much of their sheet the model sees when they're not the one speaking.

### Turn Order & Round-Robin Replies

Serene Pub decides who's due for a reply by looking at recent message history, not by tracking a persistent "whose turn is it" pointer — the whole rotation is recomputed fresh every time. Let N be the number of active characters plus personas attached to the session. Serene Pub looks at the last N messages: if every character and persona appears at least once in that window, the rotation is considered "healthy" (nobody's been silently dropped from the conversation), and any character who hasn't sent a message in the last N-1 of those messages is **due**. If more than one character is due at once, whichever has gone the longest without replying (or has never replied at all) is suggested first.

A character who has never sent a single message in the visible history is always treated as immediately due, regardless of whether the window currently looks "healthy" — this is what makes a brand-new session produce its first reply, and what keeps a character newly added mid-session from waiting around for the window to catch up.

Because this is recomputed from history rather than tracked as state, a persona doesn't have to wait for every other persona to speak before the next due character can go, and manually triggering a character out of turn (see Triggering Responses Manually, above) never leaves the rotation "stuck" on a character who was skipped — the very next automatic check just re-reads the updated history and picks correctly from it.

## Personas & Persona Switching

Every session needs at least one persona. If a session has more than one persona attached to your account, a **Switch Persona** control appears: an avatar with a chevron badge next to the composer on desktop-width screens, plus a dedicated "Switch Persona" tab on the composer's tab bar — always visible there even on mobile, unlike the other extra tabs (see The Composer's Tab Bar, below). On mobile, the avatar-and-chevron control is hidden in favor of that tab, so it's the one place to switch personas on a narrow screen.

If you're a guest in someone else's session and don't yet have a persona attached, the composer instead shows a **"Join the Conversation"** call-to-action with an **Add Your Persona** button, which opens a persona picker scoped to your own personas.

Message-level controls respect persona ownership: as a guest, you can only edit, hide, or delete messages that belong to your own persona — you cannot touch other participants' persona messages. Regenerating, continuing, and swiping are different: those work on _character_ messages, and a guest can use them on any character _they_ own, even in someone else's session — see [Guest Permission Boundaries](#guest-permission-boundaries) for the precise rule. Trigger Character and the round-robin Continue button, however, are unavailable to guests, since the whole Extra Controls tab is hidden for them.

## Scenario

The **Scenario** field (a multi-line textarea in the session settings form) is free text describing the setting, situation, or premise of the session. It's marked with an eye icon tooltipped "This field will be visible in prompts" — meaning its contents are compiled directly into the prompt sent to the model on every generation, alongside character and persona info. The scenario also displays in the session's read-only view panel in the sidebar.

## Lorebook Binding

The **Lorebook** dropdown in session settings attaches a single [lorebook](./lorebooks.md) to the session (or "None"). Once attached, the session draws on that lorebook's world lore, character lore, and history entries when compiling prompts, and unlocks the composer's **Lore** tab (below) for browsing/creating history entries and scenes directly from the session. Summarizing session messages into lore (see [Summarization](./summarization.md)) will also auto-bind a lorebook to the session if one isn't already set. A session's lorebook can also be attached or detached from the [Lorebooks](./lorebooks.md) sidebar itself, via each lorebook's menu or the detail view, when that session is the one currently open.

## Prompt Config, Connection & Sampling Overrides

Administrators editing a session see an **AI Override** section with a note that it "Overrides system defaults for this session. Leave as 'System default' to use the global setting." It lets an admin pin a specific **connection**, **sampling config** (both via the shared connection/sampling picker — see [Connections](./connections.md)), **prompt config**, and **Narrator Prompt** config (both plain dropdowns defaulting to "System default") to this one session, independent of what any individual user has active elsewhere. See [Prompt Configs](./prompt-configs.md) for what a prompt config controls, and the [Session Prompts: Narrator](./prompt-configs.md#session-prompts-narrator) section specifically for the Narrator Prompt override — note that unlike the Narrator Prompt override, the plain **prompt config** override on this form is currently a known no-op; see the caveat in [Per-session prompt override](./prompt-configs.md#per-session-prompt-override). This section is not shown to non-admin users.

## Tags

Sessions can be tagged from the settings form the same way [characters](./characters.md), [personas](./personas.md), and [lorebooks](./lorebooks.md) can — type into the tag field for autocomplete suggestions from existing tags, or add a new one. Tags feed the sidebar search box. See [Tags](./tags.md) for more on the tagging system.

## Sending Messages

The composer at the bottom of the session has **Compose** and **Preview** tabs (Preview renders your draft's Markdown, including the app's quoted-text styling, before you send). On desktop-width screens (1024px and up), pressing **Enter** sends the message and **Shift+Enter** inserts a newline; on narrower/mobile layouts, Enter always inserts a newline and you send via the paper-plane **Send** button. While a response is generating, the Send button is replaced by a **Stop Generation** button.

Your draft is autosaved to the server (debounced ~500ms as you type) so it survives a page reload or navigating away and back — drafts are restored automatically when you reopen the session.

If [context debugging](./system-settings.md) is enabled system-wide, the composer also shows a live token count against your active context limit, and turns red with a "Token limit exceeded" warning if your draft would push the compiled prompt over budget.

### The Composer's Tab Bar

Beyond Compose and Preview, the composer's tab bar picks up extra tabs conditionally, in this order:

1. **Switch Persona** — only if you have more than one persona attached to this session. This is the one extra tab guests still get.
2. **Extra Controls** — hidden entirely if you're a guest, regardless of whether you have a persona in the session yet.
3. **Lore** — only if the session has a lorebook attached, and hidden entirely for guests.
4. **Pinned Images** — hidden entirely for guests.
5. **Statistics** — only if context debugging is enabled system-wide, and hidden entirely for guests.

A read-only token-count tab pins itself to the far right once a prompt has been compiled at least once (for example, after your first send, or once context debugging starts tracking your draft).

On narrower/mobile layouts, Switch Persona stays its own permanent tab, but Extra Controls, Lore, Pinned Images, and Statistics collapse into a single "More" popover (an ellipsis button, or the active tab's own icon if one of them is open) to keep the tab row from overflowing.

### Auto-Cascading Group Replies

In a group session, any single persona message is enough to trigger a check for whether a character is now due (see Turn Order & Round-Robin Replies, above) — Serene Pub doesn't wait for every persona in the session to chime in first. If a character is due, they're generated automatically; if not, nothing happens until the rotation says someone is.

## Message Actions

Every message has a row of action buttons — shown inline on desktop (revealed on hover/focus) and via an overflow (⋮) popover on mobile. Which buttons appear depends on the message's role, position, and state.

### Quick Reference

| Action                   | Icon       | Where it appears                                                            | Who can use it                          |
| ------------------------ | ---------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Stop Generation          | Square     | Only on the message currently generating                                    | Owner                                   |
| Regenerate Response      | Refresh    | Only the newest character message, once idle                                | Owner, or whoever owns that character   |
| Continue Response        | Down arrow | Only the newest character message, if it has content                        | Owner, or whoever owns that character   |
| Edit Message             | Pencil     | Any message, unless something is generating or it's hidden                  | Owner, or the persona/character's owner |
| Branch Session           | Git branch | Any message, unless something is generating                                 | Any participant with session access     |
| Select for Summarization | Bookmark   | Any non-generating message                                                  | Any participant with session access     |
| Inspect run              | Receipt    | Character or Narrator messages a pipeline run produced                      | Whoever triggered that run              |
| View Prompt Details      | Info       | Character messages with recorded debug metadata, if context debugging is on | Anyone who can see the message          |
| Hide / Unhide Message    | Ghost      | Any message                                                                 | Owner, or the persona/character's owner |
| Delete Message           | Trash      | Any message                                                                 | Owner, or the persona/character's owner |
| Swipe Left / Right       | Chevrons   | The newest character message, or an eligible greeting                       | Owner, or whoever owns that character   |

The sections below go through the less self-explanatory of these in more detail.

### What Each Action Does

- **Stop Generation** (square icon) — only while that specific message is actively generating; cancels the in-flight LLM call.
- **Regenerate Response** (refresh icon) — only on the most recent character message, and only once nothing else is generating. Clears the message and re-runs generation from scratch. Available to the session owner, or to whoever owns that specific character (so a guest who brought their own character into the session can regenerate its replies too).
- **Continue Response** (down-arrow icon) — only on the most recent character message that already has content. Resumes generation, appending to the existing text instead of replacing it — useful when a response was cut off. Same owner-or-character-owner rule as Regenerate.
- **Edit Message** (pencil icon) — swaps the message body for an inline composer so you can rewrite it in place, with Cancel/Save controls replacing the row's action buttons while editing. Disabled while any message is generating or while the message is hidden.
- **Branch Session** (git-branch icon) — opens a small modal asking for a new session title, then creates a full copy of the session (same characters, personas, guests, tags, scenario, lorebook, and reply strategy) containing every message up to and including this one, and navigates you into the new session. Available to any participant with access to the session, not just the owner.
- **Select for Summarization** (bookmark icon) — enters summarization selection mode (see below). Not shown while a message is generating.
- **Inspect run** (receipt icon). Only on a reply a pipeline run produced, and only once it has finished generating. Opens the run inspector: one sentence saying what the run did, every stage in the order it ran, and for a selected stage the prompt it built, what it published, and which stop sequences went on the wire. See [Inspecting a run](./pipelines.md#inspecting-a-run).
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

Clicking Edit replaces the message content with the same composer used for new messages (Markdown, same keyboard shortcuts), pre-filled with the current text. Save writes the change via `sessionMessages:update`; Cancel discards it. You can't start editing while any message in the session is generating.

### Selecting Messages for Summarization

Selecting a message for summarization switches the whole session into a multi-select mode: the composer area is replaced by a toolbar showing how many messages are selected, with **Select All**, **Select None**, **Cancel**, and three destination buttons — **Scene**, **World Lore**, and **Character Lore** — plus per-message **Select**, **Select All Above**, and **Select All Below** helpers. Messages already captured in an existing scene are locked out of selection (shown with a film-strip "In Scene" badge). Selecting **Scene** requires a _contiguous_ run of messages with no visible (non-hidden) gap between the earliest and latest picks — Serene Pub blocks the summarize action and explains why if you've skipped over an unselected, visible message. The actual summarization mechanics (what gets extracted and how it's stored) are covered in [Summarization](./summarization.md); how the result feeds RAG is covered in [Embeddings & RAG](./embeddings-and-rag.md).

## The Extra Controls Tab

The composer's **Extra Controls** tab (message-square icon) is a compact row of buttons for group-session, regeneration, and Narrator response shortcuts without leaving the compose area. Note this whole tab (like Lore, Pinned Images, and Statistics) is hidden entirely for guests — see [The Composer's Tab Bar](#the-composers-tab-bar) above:

- **Continue** — checks who's due per the round-robin logic (see Group Sessions above) and keeps generating, one at a time, until nobody's due anymore.
- **Trigger Character** — opens the character-search modal (with a pinned option, labeled with the resolved Narrator display name, above the search box) and generates exactly one response from whichever you pick.
- **Regenerate** — re-generates the most recent message, character or Narrator response alike (equivalent to that message's own Regenerate action).
- **A Narrator trigger**, labeled with the resolved config's Display Name (**"Narrator"** by default) — opens the Narrator Response instructions modal. See [Narrator Response](#narrator-response) below.

Continue, Trigger Character, and Regenerate are disabled while any message is currently generating, or if the session has no persona at all; the Narrator trigger is disabled only while something is generating.

Unlike Regenerate/Continue/Swipe on an existing message (which enforce the owner-or-character-owner rule server-side), **Trigger Character and the round-robin Continue button here have no server-side ownership check at all** — they're gated purely by this whole tab being hidden from guests client-side. In practice this only matters if a guest could somehow reach the tab; through the normal UI, guests never see it.

## Chat

**Chat** is the genre a new install drops you into, and it is deliberately the frugal one: one call to the model per turn, the cheaper non-model mechanisms wherever they will do the job, a lorebook only if you want one, and no setup beyond a persona and a character. Everything more elaborate is still available (the stats panels, the inventory, the narrator, the tool loop), but nothing in a chat session runs any of it on its own: a chat turn does exactly what you asked for and stops, and anything multi-step is a button you press.

## Adventure

**Adventure** is the flagship, and it is the opposite trade from Chat on purpose. Chat spends one model call a turn and leaves the elaborate things to buttons; an adventure turn spends four agents working in order, automatically, and asks more of your setup in exchange: a lorebook is required, and so is at least one character and one persona. The point of the shape is that each agent does one job well:

- The **planner** reads what you just did, the scene so far and the world's current state, and decides what happens next and who has a reason to speak. It writes no prose at all, so it can run on a small, fast model.
- The **narrator** writes the scene from that plan: what happens, what it looks like, what it costs. It narrates the world in the third person and never puts words in a character's mouth.
- A **voice** speaks for each cast member the planner named, one per speaker, all at once. Each one knows only what that character knows.
- The **state-keeper** reads the finished reply and writes down what it made true: a health change, a mood turning, the weather closing in, an item changing hands.

### How each stage is asked

The four agents are not four copies of the same request, and the difference is worth knowing because it is what keeps a turn from reading like one long reply.

The planner and the state-keeper are asked a **question**, not given a turn. Their request names no speaker, ends with no line for a character to continue, and carries the shape of the answer itself: where your connection can enforce a shape, the list of beats and the list of changes are constrained on the wire rather than described in the instructions. Where it can only promise JSON, they ask for JSON; where it can do neither, they ask in words and the answer is read back the way it always was. Which of the three happened is on the turn's receipt, beside the stage that asked.

Those two also read the conversation as **prose only**. If an earlier reply ended with a block of JSON, that block is cut out of what they are shown, so a planner never reads its own shape back out of the transcript and a state-keeper never answers in the planner's. Nothing is changed in the session itself: the cut happens on the way into the prompt, and the stored message is exactly what was written.

The narrator and the voices are the two stages that ARE a turn. The narrator's prompt ends on the Narrator's own line, which is why the scene is narration rather than a character talking about themselves in the first person; each voice's prompt ends on that speaker's line, so two characters speaking in one turn are two different people rather than the same one twice.

What you see is one reply, the narration followed by each character's turn, with a ledger of the state-keeper's changes underneath it.

### What each agent is told

Every agent in a turn is given the same anchor before it writes: where the scene is, what time it is, what the weather is doing, who is in the cast by name, and that the player is the persona you are playing. The narrator gets the planner's beats as the things that happen in this scene, and is told to invent no named characters, not to move the scene somewhere else unless a beat says so, and to leave the dialogue to the voices. Each voice gets the same place and the same cast, so a character cannot answer from a harbour the plan never mentioned. Both are shown the world as it stands, which is what "use the state as fact" means in the shipped instructions.

The planner also says where this turn happens, what time it is and what the sky is doing, and those three become state changes like any other: a location the world has never been told lands as a proposal on the first turn, and a hint that repeats what the world already says proposes nothing.

The state-keeper is shown the reply it is reporting on, because the conversation it is assembled with predates the scene that was just written. It is also shown the values this session tracks with what each one accepts, written out: "stamina: a whole number from 0 to 10", "mood: one of calm, wary, afraid, angry, hopeful". A value outside that is refused and recorded on the run's receipt rather than put in front of you as something to accept.

### How a turn runs

Send a turn and the whole pipeline runs, stage by stage, before anything is saved. A card appears above the composer naming the stage the turn is on and how many have finished (plan, scene, one per speaking character, keep state), with a stop button that ends the run wherever it has got to. The narrator's prose streams into the reply as it is written, so the longest stage is the one you can watch; the planner's and the state-keeper's answers are not prose, never appear on screen, and never end up inside the reply. When the last voice has spoken, the finished reply replaces the streamed text with the assembled version: the scene, then each character's turn in the order the planner listed them. The state-keeper runs after that, on the reply that now exists, which is why its changes stay attached to the message that caused them. Its lines appear under the reply as pending unless the session trusts the narrator, in which case they are already applied. Every stage, every prompt and every refusal is on the turn's receipt, readable from the run inspector afterwards.

A chat turn does not work this way and is not meant to: one model call, sent and streamed by the connection itself. The difference is decided by the pipeline, not by the genre name, so a pipeline of your own with more than one generating step gets the staged treatment automatically.

### Stats, the world and the ledger

An Adventure session tracks seven things, and they are why the genre has widgets a chat does not. Each cast member carries **Health**, **Stamina**, **Mood** and **Trust** (how far they trust you, from hostile to loyal); the world carries a **Location**, a **Time of day** and the **Weather**. Nothing is stored until something changes it: a fresh session reads the defaults, and a character whose card says "Health, maximum 40" keeps that maximum.

Nothing the model proposes takes effect on its own. Each change appears under the reply as a pending line with **Accept** and **Reject**, because a model that could set a number silently could rewrite your character between two messages with nothing you could refuse. The changes are anchored to the message that produced them, so regenerating or swiping a reply takes its changes back with it.

### Session settings

Three settings, on the session, under **Edit session**:

| Setting                | What it does                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Tone**               | Grounded, pulpy, grim or whimsical. The narrator's own instructions are written with it.                               |
| **Difficulty**         | Story, normal or hard. The planner reads it when it decides what a scene costs you.                                    |
| **Trust the narrator** | Off by default. On, the state-keeper's changes are applied as they are made instead of waiting for you to accept them. |

### Buttons

Three actions come with the genre, in the action row above the composer's tab strip:

- **Look**: the narrator describes where you are, from the lore and the world state. It changes nothing, and it is the button to start a new adventure with, because creating a session deliberately makes no model call and the opening scene is yours to ask for.
- **Rest**: the party stops. Stamina comes back, health comes back slowly and only somewhere safe, and the clock moves on.
- **Time passes**: the world clock steps on one notch, and the weather may turn with it.

Rest and Time passes write no message at all. That is not a failure: a clock tick is a ledger line, not a paragraph, and Look is the button for the paragraph.

### What it needs

The **lorebook** is where the world lives, and an item somebody is carrying is an entry in it, so an adventure without one has nothing to describe or to hand out. The genre also makes several model calls per turn rather than one, so it is the genre to point at a local model you are not paying per token for. Each stage has its own connection and sampling settings in the pipeline panel, so the planner and the state-keeper can run on a small model while the prose runs on a large one.

## Narrator Response

**Narrator Response** is a manually-triggered message that narrates as the environment itself: weather, scenery, side characters, shopkeepers, monsters, or other third parties, rather than as any of the session's defined characters. It has no persistent identity of its own (no avatar, no character sheet) and is never auto-triggered: unlike ordinary character replies, a Narrator response never counts toward or interrupts round-robin turn order, and it's never suggested by the "ready to continue" banner.

### Triggering a Narrator Response

Two entry points open the same instructions modal:

- The Narrator trigger button in the **Extra Controls** tab (see above).
- The pinned option (labeled with the resolved Narrator display name) above the search box in the **Trigger Character** modal.

The modal shows an optional **Extra instructions** text field for anything you want this specific response to focus on (for example, "focus on the weather turning stormy" or "have the shopkeeper notice the party") — leave it blank for a generic narration pass. Confirming inserts a new message and starts generating immediately, just like any other response.

### Display name

A Narrator Response message shows up in the thread with an icon and a label — **"Narrator"** by default, or whatever **Display Name** is configured on the resolved Session Prompts: Narrator config (see [Prompt Configs](./prompt-configs.md#session-prompts-narrator)) at the moment it was generated. Renaming the config afterward doesn't retroactively relabel already-generated messages; each one keeps the name it was generated with.

### Message actions on a Narrator Response

Edit, Branch, Hide, Delete, and Regenerate all work on a Narrator Response message the same as on any other, restricted to the session **owner** (a Narrator Response isn't owned by any persona or character, so the persona/character-owner exception that applies to other messages doesn't apply here). Continue and Swipe aren't available on Narrator Response messages.

## The Lore Tab

When a session has a lorebook bound to it, the composer gains a **Lore** tab (book icon) surfacing that lorebook's history-entry pipeline without leaving the session:

- The current (most recent) history entry, with its scene count and an **Open in lorebook** shortcut.
- A **+** button to start a new history entry (iterating from the latest one).
- A **Summarize Scene** shortcut that drops you straight into summarization selection mode for capturing a scene.
- An **Extend Graph (N)** button when there are scenes that haven't been folded into the lorebook's relationship graph yet.
- A **Recent Entries** list (up to five prior entries) for quick navigation back into lorebook history.

This tab is a shortcut layer over the [lorebook](./lorebooks.md)'s own history-entry and scene features — the full editing experience lives in the Lorebooks panel.

## Pinned Images (Scene Images)

The composer's **Pinned Images** tab (images icon) lets you pin an avatar or gallery image from any character or persona in the session to a **Left** or **Right** slot. Pinned images render as overlays alongside the session itself (outside the message thread) — useful as a lightweight visual aid for "who's in the scene right now" without touching the character's actual profile avatar.

Each participant row shows Left/Right pin toggle buttons for their default avatar, plus an expandable gallery (fetched on demand) of that character's or persona's other uploaded images, each with hover-revealed Left/Right pin controls. Clearing a slot removes the overlay. Your left/right picks are remembered per session in the browser's local storage, so they persist across reloads but are not synced between devices or shared with other participants.

## Understanding RAG Notices

When [vectorization](./embeddings-and-rag.md) is enabled system-wide, a notice banner can appear directly above the composer summarizing the RAG-indexing state of everything relevant to the session (messages, characters, personas, and lorebook entries):

- **"RAG content not yet indexed"** — nothing has been embedded yet for this session's content; RAG can't surface anything from it until indexing runs.
- **"RAG content indexed with a different model"** — existing embeddings were generated with a previously-active embedding model and need to be redone against the current one.
- **"Indexing in progress…"** — a mix of indexed and pending content, with a running count and a note if the embedding queue itself is paused.

The notice offers **Prioritize in queue** (moves this session's content to the front of the embedding queue) and **Ignore for this session** (silences the notice and excludes the session from RAG going forward, with a one-click **Re-enable** link shown afterward in its place). No notice appears once everything is fully indexed.

Individual messages also carry a small per-message embedding-status icon next to the sender's name: a lightning bolt when that message's embedding matches the currently active embedding model, or a refresh icon when it was embedded under a since-changed model and is stale. See [Embeddings & RAG](./embeddings-and-rag.md) for how retrieval, scoring, and the underlying embedding queue actually work.

## Statistics Tab & Prompt Details

If **context debugging** is enabled in [System Settings](./system-settings.md), the composer gains a **Statistics** tab (bar-chart icon) showing a live token count and included/total message count for your current draft, plus a **Details** button that opens the full **Prompt Details** modal. That modal breaks down, for the most recently compiled prompt:

- **Token Budget** — total vs. limit, a progress bar, the active prompt format/template name, whether the RAG or keyword context-infill engine was used, and any truncation reason.
- **Messages** — how many session messages were included vs. excluded (with excluded message IDs listed), and, when RAG is active, a Guaranteed / RAG-recalled / Fill-in breakdown.
- **Lore & Graph** — pinned vs. RAG-recalled counts for world lore, character lore, and history entries, plus any graph relationship pairs that matched (RAG mode), or budget/top-score figures per lore type (keyword mode).
- **RAG Retrieval Scores** — the adaptive similarity threshold used, how many recent messages were embedded as the query window, and score-distribution bars for retrieved messages and lore.
- **Sources** — which characters, personas, and scenario contributed to the compiled prompt.
- **Prompt Preview** — the actual compiled prompt, rendered either as session-formatted role blocks or as raw text depending on the connection's prompt format.

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

To recap the ownership rules scattered through this page: guests can send messages as their own persona, edit/hide/delete only their own persona's messages, and branch the session — all of that is unconditional. Regenerating, continuing, and swiping a _character_ message, though, isn't session-owner-only: it's available to the session owner **or** to whoever owns that specific character, so a guest who brought their own character into someone else's session can control that character's replies too, even though they can't touch anyone else's. Triggering a character out of turn (Trigger Character) and the round-robin Continue button are the ones actually unavailable to guests — not because of a server-side ownership check, but because the whole Extra Controls tab (along with Lore, Pinned Images, and Statistics) is hidden from guests client-side. Select for Summarization has no ownership restriction at all — any participant with access to the session can use it, on any message.

### Session Not Found

Navigating to a session you don't have access to (or that's been deleted) shows a dedicated "Session not found" state instead of an empty thread.

### Context Exceeded Warnings

Both the composer and the Statistics tab track your compiled prompt's token total against your active context limit. If it goes over budget, the token counter turns red (in the composer tab bar and in the Statistics tab), the textarea gets an inline "Token limit exceeded. Message may be truncated." warning, and the Prompt Details modal's token bar switches from success-green through warning-orange to error-red as it fills up — the modal also surfaces the specific truncation reason (for example, oldest messages being dropped) when one applies.

### Why Can't I Regenerate, Continue, or Swipe?

These three actions are available to the session's **owner**, or to whoever owns the specific character the message belongs to — this is enforced server-side (`checkMessageEditPermission`), not just hidden in the UI. If you're a guest and don't own that character, you'll be able to send messages as your own persona and manage your own persona's messages, but these controls won't take effect for you on someone else's character. Separately, Trigger Character and the Extra Controls tab's round-robin Continue button are unavailable to any guest regardless of character ownership — but that restriction is purely client-side (the whole Extra Controls tab is hidden for guests), not a server-side ownership check like the other three.

### Why Isn't the Next-Character Banner Showing?

The "ready to continue" banner only appears when _all_ of the following are true: it's a group session with more than one active character, nothing is currently generating, you don't have unsent draft text, you aren't editing a message, the round-robin logic has a character queued up, and the session already has at least one message. Typing a draft or opening an edit will hide the banner until you clear it.
