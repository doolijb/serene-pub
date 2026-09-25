# Sessions

Sessions are where roleplay actually happens in Serene Pub: one or more [characters](./characters.md) and one or more [personas](./personas.md) exchange messages in a shared thread, with full control over turn order, regeneration, branching, and how much context the AI sees. This page covers the session screen itself — creating sessions, group-session mechanics, message actions, and the composer's Lore, Pinned Images, and Statistics tabs.

## Overview

A session lives at `/sessions/[id]` and is built from a few core pieces:

- **Characters** — one or more AI-driven participants, added in a specific order that determines their turn order in group sessions.
- **Personas** — one or more user-driven participants. The session owner and any guests each send messages as one of the personas attached to the session.
- **Scenario** — an optional block of scene-setting text that's fed into every prompt.
- **Lorebook** — an optional bound [lorebook](./lorebooks.md) supplying world lore, character lore, and history entries.
- **Which connection a session uses** — none of its own: the pipeline configuration's pair, or the instance default. Overrides are by model, never by connection (see [below](#which-connection-a-session-uses)).

Everything in the session updates live over sockets — new messages, generation progress, edits, and deletions are pushed to every connected participant (owner and guests alike) as they happen.

Under the hood every session is a `roleplay`-type session with an `isGroup` flag that's automatically true once more than one character is attached.

### The session header

The bar across the top of a session says which session you are in. Its name comes first, on the same column the messages take, so it starts where the story does. Beside it is the cast: up to five faces — each one's portrait, or a disc with their initial, with the personas people speak as tinted gold — and a gold dot on whoever the rotation has queued up next. Last is the genre the session is played in. On a phone, when the session has side panels, the button that opens them sits at the right of the same bar (see [Session Layout](./session-layout.md)).

## Starting a session

Click **New** at the top of the Sessions sidebar — or **Start a session** on the home screen — to open the start screen. Both land on the same screen: the home's button opens the Sessions view straight onto it, passing along anything it already knows (a character to start with, a persona to speak as), and the wizard's first session on the home screen picks the genre and preset by the same rules, so its defaults and the start screen's never disagree. When that genre requires a lorebook, the wizard's character card does not create the session itself: it opens the start screen with the character, genre and preset filled in, and the screen asks for the lorebook. Starting a session is a few answers stacked down one column, each a card that collapses to a one-line summary once it is answered, with a **Change** link to reopen it:

1. **Genre** — what kind of session this is. The genre decides which systems exist for it (characters, personas, lorebooks, the composer) and stays with the session for its life. The screen opens on the genre whose default preset an administrator has starred, or the first one registered.
2. **Preset** — the bundle an administrator has enabled for that genre, which decides which pipelines answer its events and which actions come along. It also supplies the pre-fill the fields below start from; switching presets only fills in fields you haven't typed into yet, never overwriting something you've already entered.
3. **Who is in it** — the characters, at least as many as the genre requires, and the persona you play as. Your default persona is picked for you. With more than eight characters a filter box appears above the list.
4. **Lorebook** — only for a genre whose shape has one. Where the genre requires it (Adventure does: the world lives in the lorebook), the card is marked and **Start** stays disabled until one is chosen; with exactly one lorebook it is picked for you, and the list stays on screen so the pick is visible and can be changed. Where it is optional, **None** is offered too. If you have no lorebooks and the genre needs one, the card says so — create one in Lorebooks first.
5. **Name** — optional. Leave it empty and the session takes the name shown in the box as a placeholder: _Session with Wren_ for one character, _Wren, Brother Alder and Sable_ for a group. Under it, **Add a scenario** reveals an optional Scenario box — scene-setting text every prompt will see. It stays closed unless you ask for it, or unless the preset's creation defaults already put text there, in which case it opens with that text in it.

A step with exactly one answer takes it silently and shows as its summary line rather than asking — so a stock install, one genre and one preset, opens on **Who is in it**. If an administrator has enabled no preset for a genre, the step says so and **Start** is disabled: there is nothing to start the session from.

Everything else a session has — tags, turn order, per-pipeline settings, the lorebook again if you want to change it, and the scenario again if you skipped it here — is set afterwards in the session's own settings. See [Editing session settings](#editing-session-settings-later).

The preset is doing more than labelling the bundle: its **event bindings** are what decide which pipeline answers each of the genre's events — the reply, the greeting on creation, each action that comes along — and which named configuration that pipeline runs with, so two presets on one genre can differ entirely in what a turn actually does. Administrators set both of those, and the pre-filled values the start screen opens with, on the preset's own page under **Admin → Session presets** (bindings under _Event bindings_, the pre-fill under _Creation defaults_).

The preset is the session's second word on the matter, not its first. A session is a work rather than a preference, so a pipeline the session has chosen for itself — its own binding for the reply or for an action — wins over the preset's binding for that event, and the preset in turn wins over an administrator's instance-wide default; only then does the genre's own pipeline answer. A choice that has stopped being eligible — the pipeline it names was retired, or no longer answers this genre's reply — is skipped rather than honoured, and the next layer decides. A session's own choice is about a **subject**: the reply is the core event `message-respond`, and the choice selects among the pipelines that answer it for the genre; an action is named by its identity (`<spec slug>#<key>`) and is served by the pipeline that declares it, so its row is where the session's enabled-when override lives rather than a choice among alternatives. Today nothing in the session screens makes that per-session choice; it is reachable through the session owner's socket API alone (`sessions:bindFunction`, with a `subject`). A lifecycle event — creation, the greeting — can carry a per-session row too, on the same terms, though no screen offers one.

If a bound pipeline later stops being available — an upgrade republished it, a plugin that shipped it was removed — the session does **not** stop working: it runs the genre's default pipeline for that event instead, and says so. Everyone in the session sees a banner naming which event fell back (administrators also get the pipeline it was bound to and a link to fix it), the run's own report says which pipeline actually ran and why, and the preset is flagged in **Admin → Session presets** until the binding resolves again.

**Start** sends `sessions:create`, and the screen hands you straight to the new session. Leaving the screen part-answered — Escape, the back chevron, or closing the view — asks before it discards, the same confirmation the settings form uses.

### Editing Session Settings Later

Reopening a session's settings (via the sidebar's Edit action, or Edit session in a session's detail) opens the session's own screen: its name at the top with **Save**, then three tabs.

- **Participants** — the cast and the personas, each row carrying a drag handle, an Active switch, a visibility button and a remove action; removed participants, whose message history you can reassign; guests, when accounts are enabled; and the group reply strategy once there is more than one of anybody.
- **Settings** — the scenario and the lorebook, the session's preset, its actions, turn order (only for genres whose replies pick a speaker — a narrator-driven genre such as Adventure or the Lair has no turn to order, and the control is absent), any fields the genre declares, per-pipeline settings for this session only, and tags.
- **Privacy** — what this session exposes of your own data, and to whom.

A tab whose required field is missing carries a dot, so you can see where to look without opening it. Leaving the form with unsaved changes and trying to close the sidebar prompts a **"Your session has unsaved changes. Are you sure you want to discard them?"** confirmation before letting you navigate away.

### Guests

If accounts are enabled system-wide, editing an existing session reveals a **Guests** section where the session owner can add other users as guests via **Add Guests**. Guests can view the session and participate as their own persona; editing session settings itself remains owner-only, but regenerating/continuing/swiping a message is available to a guest too if it belongs to a character _they_ own — see [Guest Permission Boundaries](#guest-permission-boundaries) below for the precise rule. See [Users & Accounts](./users-and-accounts.md) for account/guest concepts in general.

### Deleting a Session

The sidebar's per-session overflow menu includes **Delete**, which opens a confirmation modal warning that the session and _all of its messages_ will be permanently removed — this cannot be undone. Deleting the session you're currently viewing navigates you back to the home screen automatically.

## The Sessions Sidebar

The sidebar list shows every session you own or have been added to as a guest. Each row is:

Each row's last line and message count stay current while you play: a new turn, an edit, a deletion or a regenerated reply in any session you are in updates the row (and the home page's continue card) as it happens, without reopening the list.

- A cover: the first character's picture, with the second badged onto its corner when the session has more than one, so a group reads as a group at a glance.
- The session name, and at the end of the same line the time the session last moved ("2 h ago") with an ember dot before it when the last thing said was not yours — the session is waiting on you.
- Underneath, the **last line**: who spoke and the opening of what they said. A session with nothing said in it yet lists its cast instead. While a reply is being written in that session — in this tab or anyone's — the line is the run's own status instead, with a pulsing dot: _Jasmine is thinking_, then _Jasmine is typing_, until the reply lands and the last line returns. The "your turn" dot yields to it.
- A genre chip after the name, only on an install that actually has more than one genre, and a people icon when the session is one somebody shared with you.
- A per-session overflow menu (View, Edit, Delete) — Delete is a destructive confirmation modal that also removes all of the session's messages.

Above the list are a **New** button on its own row and, under it, the filter box and the **filter popout**. The box filters by session name, persona name, character name, or tag. The popout is a single choice: **All**, **Waiting on you** (every session whose last line is not yours), then one row per genre — only when there is more than one — and one row per tag any session carries. The choice shows as a dismissible chip under the toolbar and stacks with whatever you have typed, so a tag plus a word means both.

The list itself is grouped by when each session last moved: **Today**, **Yesterday**, **This week**, **Earlier**, each heading appearing only when it has sessions under it. The session currently open sits above all of them under no heading, so it is never scrolled past.

Clicking a session's **View** entry opens its read-only **detail** without leaving the sidebar: the session's cover and name, a line giving its genre, its message count and when it was last active, then cards for the cast (characters, then your personas under **You**), the last line, the scenario, the lorebook and anyone it is shared with. Every action lives in that panel's header — **Open session** as the primary button, with Edit session, View lorebook and Delete behind the `⋯` menu. Clicking the session row itself navigates straight to `/sessions/[id]`; clicking the row of the session you already have open shows its detail panel instead.

The sidebar can also arrive pre-filtered: opening a session list from a character's or persona's own panel passes that character/persona's ID through, and the sidebar shows a removable filter chip — in the same strip as the popout's chip — plus only the matching sessions.

### Jumping to a Character or Persona from a Session

Inside a session, clicking a message's avatar opens an **avatar gallery modal** for that character or persona (browsing every uploaded image for them), while clicking their _name_ opens their full profile panel in the [Characters](./characters.md) view with that character selected, so you can review or edit them without losing your place in the conversation.

## Group Sessions & Reply Strategy

A session becomes a "group session" as soon as it has more than one character attached. Group sessions add turn-order mechanics that 1:1 sessions don't need.

### Turn order

Who replies next is **state**: every genre has its own turn-order pipeline, which runs after each message lands (and after cast or settings changes) and writes the session's prepared turns down. It writes no message; the order it wrote is what the "who's next" line and **Continue** read. By default it follows rules and calls no model. The session settings form shows a card for it, **Turn order (Chat) · Strategy**, which chooses the strategy those rules use. Its default, *Pipeline default*, is the pipeline's own, which for Chat is round robin. The same form shows a card for any other step a genre's pipelines let a session swap, each applied on its own.

Chat can instead let **the model** decide: set **Who speaks next is decided by** to *The model*. Each time the order is recomputed, the model reads the recent conversation and orders who speaks next among those who have not spoken since your last message — so a round still ends. It costs one model call per recompute. When the model's answer names nobody who can speak, or no answer arrives, round robin stands and the run report says so. A plugin can offer its own model strategy in its place. Core's rule strategies:

- **Round robin** — the default. Every active character speaks once, in their configured order, after each of your messages — see Turn Order & Round-Robin Replies, below.
- **Round robin by user** — the characters owned by whoever sent the last message complete a turn before anyone else's. Only meaningful with several accounts in one session; with a single user it behaves like round robin.
- **Random** — a seeded draw over the active characters (and any genre-provided speaker that takes turns). Seeded, so a replayed run seats the same character.
- **Scripted** — round robin, with scripts in charge: attach **Select the speaker** scripts to the speaker step in the Pipelines panel (a script kind an extension can also provide) and the first script to name a candidate wins; when none does, the round-robin answer stands.
- **Manual** — nobody auto-replies; the line beside the composer reads *Waiting for a message — or pick who speaks next*, and **Pick** chooses who responds.
- **Narrator replies** — one narrator turn after each of your messages, in the pipeline's own voice rather than a character's.

Which of these a session may choose is the genre's turn-order pipeline to say: Chat's offers the six above, plus any strategy an installed plugin contributes to it (an administrator can switch a contribution off, which also returns sessions that picked it to the default). The Guide, the Writing Room and the narrator-driven genres (Adventure, the Lair, Whodunit) offer no choice and show no Turn order control. A session preset can seed a strategy as a creation default. If a seeded choice cannot be applied (the step no longer offers it), the session still starts, on the pipeline's default for that step, and a notice says which setting was not applied and why.

### Who is due next

The line beside the composer shows the head of the session's prepared turns, exactly as the turn-order pipeline wrote them. Nothing on the page works it out again. While you have no draft and no edit in progress:

- a character's turn reads *Wren is ready to continue*, with **Continue** to send them in;
- a narrator turn reads *The narrator is ready to continue*, also with **Continue**;
- a person's turn reads *Your turn* for your own persona, or *<name>'s turn* for someone else's, with no Continue: a person's turn is taken by writing;
- when nobody is prepared, because a round is over or the strategy is Manual, it reads *Waiting for a message — or pick who speaks next*.

**Someone else** (or **Pick**) opens *Who speaks next?*, a list of the session's characters and speakers from the same prepared order, with the next one marked. Choosing one fires their turn instead. A session's owner may pick anyone; a guest may only take a prepared turn that is theirs. While the line offers Continue, Continue is the one primary button on the surface and Send steps back to a tonal fill.

The Messages panel's **Who is due next** setting chooses how much the line shows: `head` (the default) is the line above, `list` adds who follows after that (*Then Mira, Tobin*), and `hidden` removes it. A panel that had *Show who is due next* switched off reads as `hidden`.

### Triggering Responses Manually

The **Actions** row above the composer (see [Actions](#actions)) holds the turn controls:
**Continue**, **Pick who speaks**, **Regenerate**, and the Narrator trigger (see [Narrator
Response](#narrator-response) below). **Pick who speaks** generates exactly one response from the
character you choose regardless of whose turn it technically is. **Continue** repeatedly asks "is
anyone due right now?" and generates for whoever is, one at a time, until nobody is due (or a safety
cap is hit) — useful for catching a group session up after several personas have spoken.

### Activating, Deactivating & Visibility

Each character row in the session settings form (when editing an existing session) has two additional controls:

- An **Active/Inactive** switch — deactivating a character removes them from the turn rotation and generation entirely without removing them from the session. Toggling emits `sessions:toggleSessionCharacterActive`.
- A **visibility** button that cycles through **Full Info → Name Only → Hidden** (the tooltip states what happens on the character's other turns, e.g. "When not speaking: Only name/nickname is included"). This controls how much of that character's information is sent to the model when it isn't their turn — Name Only keeps just their name/nickname, Hidden omits them from context entirely while inactive-in-turn. Toggling emits `sessions:updateSessionCharacterVisibility`.

Deactivating a character is the right tool when you want to "bench" a character for a while (they stay in the session's roster, keep their message history, but stop being generated for) without the disruption of removing and re-adding them later. Visibility, by contrast, is purely a context-budget optimization for sessions with many characters — it doesn't affect whether a character can be triggered, only how much of their sheet the model sees when they're not the one speaking.

### Turn Order & Round-Robin Replies

Round robin is **once per turn of yours**: after each message you send, every active character speaks once, in their configured order, and a character who has already spoken since your last message is not due again until you speak again. When everyone has spoken, nobody is due — it's your turn. Sending twice in a row opens a fresh round.

The rule is computed from the visible history every time, not tracked as a pointer, so nothing can get "stuck": manually triggering a character out of turn (see Triggering Responses Manually, above) simply counts as that character's turn for the round, and the others are still owed theirs. Hidden messages and Narrator responses are outside the rotation entirely, and a genre-provided speaker's line (the Guide's mascot, the Writing Room's scribe) never marks a character as having spoken. A brand-new session with greetings starts on your turn; one without them starts on the first character's.

The decision is recorded: every reply's run report names the strategy that ran and whether it seated the character the trigger asked for or one it chose itself — so "why did Bram speak?" is answered on the receipt, not guessed.

## Personas & Persona Switching

Every session needs at least one persona. If a session has more than one persona attached to your account, a **Switch Persona** control appears: an avatar with a chevron badge next to the composer on desktop-width screens, plus a dedicated "Switch Persona" tab on the composer's tab bar — always visible there even on mobile, unlike the other extra tabs (see The Composer's Tab Bar, below). On mobile, the avatar-and-chevron control is hidden in favor of that tab, so it's the one place to switch personas on a narrow screen.

A persona is a [character](./characters.md) you play — see [Personas](./personas.md). The persona picker lists the characters flagged as your personas first, with a **Show all characters** toggle for the rest; picking an unflagged character flags it for you.

If you're a guest in someone else's session and don't yet have a persona attached, the composer instead shows a **"Join the Conversation"** call-to-action with an **Add Your Persona** button, which opens a persona picker scoped to your own personas.

Message-level controls respect persona ownership: as a guest, you can only edit, hide, or delete messages that belong to your own persona — you cannot touch other participants' persona messages. Regenerating, continuing, and swiping are different: those work on _character_ messages, and a guest can use them on any character _they_ own, even in someone else's session — see [Guest Permission Boundaries](#guest-permission-boundaries) for the precise rule. Trigger Character and the round-robin Continue button, however, are unavailable to guests, since the whole Extra Controls tab is hidden for them.

## Scenario

The **Scenario** field (a multi-line textarea in the session settings form) is free text describing the setting, situation, or premise of the session. It's marked with an eye icon tooltipped "This field will be visible in prompts" — meaning its contents are compiled directly into the prompt sent to the model on every generation, alongside character and persona info. The scenario also displays in the session's read-only detail panel in the sidebar.

## Lorebook Binding

The **Lorebook** dropdown in session settings attaches a single [lorebook](./lorebooks.md) to the session (or "None"). Once attached, the session draws on that lorebook's world lore, character lore, and history entries when compiling prompts, and unlocks the composer's **Lore** tab (below) for browsing/creating history entries and scenes directly from the session. Summarizing session messages into lore (see [Summarization](./summarization.md)) will also auto-bind a lorebook to the session if one isn't already set. A session's lorebook can also be attached or detached from the [Lorebooks](./lorebooks.md) sidebar itself, via each lorebook's menu or the detail view, when that session is the one currently open.

## Which connection a session uses

A session has no connection override. Every reply runs on the (endpoint, model) pair its pipeline configuration names, or on the instance's chat default from **Admin → Defaults** when the configuration names none — see [Connections](./connections.md#choosing-a-pair). Overrides are always by model, never by connection: to run one session on a different model, give it a pipeline configuration whose provider slot names that model (see [Pipelines](./pipelines.md)). The former per-session **connection** pick was retired in 0.6 because an endpoint alone no longer identifies what will run.

The session row still stores per-session picks for a **sampling config**, a **prompt config** and a **Narrator Prompt** config, and generation reads the sampling and Narrator Prompt ones; the session edit form currently exposes no controls for them. See [Prompt Configs](./prompt-configs.md) for what those configs control.

## Tags

Sessions can be tagged from the settings form the same way [characters](./characters.md), [personas](./personas.md), and [lorebooks](./lorebooks.md) can — type into the tag field for autocomplete suggestions from existing tags, or add a new one. Tags feed the sidebar search box. See [Tags](./tags.md) for more on the tagging system.

## Sending Messages

The composer is the card at the foot of the conversation (or at its head, if you set **Composer
position** to *top* in the Messages panel's settings). Its placeholder names the persona you are
writing as: *Write as Sable…*. On desktop-width screens (1024px and up) **Enter** sends and
**Shift+Enter** inserts a newline; on narrower layouts Enter always inserts a newline and you send
with the **Send** button. The first time you focus the field on a desktop, a one-line reminder of
those keys appears under the card, once, and is not shown again. While a response is generating,
**Send** becomes **Stop**.

Your draft is autosaved to the server (debounced ~500ms as you type) so it survives a page reload or
navigating away and back — drafts are restored automatically when you reopen the session.

If [context debugging](./system-settings.md) is enabled system-wide, a 2px line along the top edge
of the card fills as your compiled prompt approaches the context limit and turns ember past 90%.
Over budget, one sentence appears under the field: "This draft pushes the prompt past the context
limit. Older turns will be trimmed."

### The composer's footer

The footer holds up to five things, left to right:

0. **The channel strip** — one small button per channel, shown **only when the session's genre has
   more than one**, which today means the Writing Room. Whichever is lit is where your next message
   lands and what the conversation above shows; switching hides the other channel's messages rather
   than losing them. A session with one channel — every other genre — draws nothing here at all.
1. **Your persona** — the avatar and name you are writing as. When more than one of your personas is
   in the session, a chevron marks it and clicking opens the switcher (see [Personas & Persona
   Switching](#personas--persona-switching)). This is the one control guests still get.
2. **Preview** (eye) — toggles the field into the rendered Markdown of your draft, set in the prose
   face exactly as it will read in the conversation. Press it again to go back to writing.
3. **More** (⋮) — a menu of the composer's panels: **Lore** (only if the session has a lorebook
   attached), **Pinned images**, and **Statistics** (only if context debugging is on). Picking one
   opens that panel in place of the field, with **Back to compose** to return. Guests see none of
   these.
4. **Send**, or **Stop** while a reply is generating.

### Actions

Above the card sits one quiet word, **Actions**. Click it (or press Enter on it) and a row of chips
opens beneath it; the row stays open until you click **Actions** again or press Escape while
something in it has focus — moving on to the transcript or the field leaves it where it is, so the
list above never shifts under a click. It wraps as far as it needs and never scrolls sideways.

What the genre contributes comes first as filled chips: an adventure session has **Look**, **Rest**
and **Time passes**; a chat session has its Narrator, **Side character** and **Image**, and whatever
its pipelines add. After them, as outlined chips, the turn controls (hidden from guests):

- **Continue** — asks the reply pipeline who is due (see Turn order above) and keeps
  generating, one at a time, until nobody is due. Present when the genre offers `continue`.
- **Pick who speaks** — opens the character search (name, nickname, description or creator notes)
  with the Narrator pinned above the box, and generates exactly one response from whoever you pick;
  the pinned option opens the Narrator instructions instead.
- **Regenerate** — regenerates the most recent message, character or Narrator alike. Present when
  the genre offers `retry`.

Continue, Pick who speaks and Regenerate are disabled while anything is generating or if the
session has no persona; the Narrator trigger is disabled only while something is generating.

Unlike Regenerate, Continue and Swipe on an existing message (which enforce the owner-or-character-
owner rule server-side), **Pick who speaks and the round-robin Continue have no server-side
ownership check** — they are hidden from guests client-side and that is the whole gate.

#### Where an action appears, and who may use it

Every action a session offers — a genre's chip, a message's menu entry, a slash command — is
declared once, by whatever contributes it, with three facts: a **venue** (where it appears: the
composer row, a message's ⋮ menu, the turn controls, a widget; and optionally on one channel only),
an **audience** (who may *see* it and who may *act* on it), and whether it is **quick**.

- **Primary set and overflow.** Each venue shows its quick actions up front — the chips, the
  message row's hover icons — and keeps *every* enabled action in an overflow: the **More** menu
  beside the chips, the ⋮ menu on a message. Nothing is ever reachable only by being prominent, and
  nothing is hidden by not being. A style pack may move the primary set around; it cannot take an
  action away.
- **New.** An action you have not met yet — one a newly installed plugin contributed, say — lands in
  the overflow wearing a small **New** mark, and the **More** button carries a dot while it holds
  one. Opening that menu (or the `/` palette) is meeting them; the mark clears for you and stays for
  everyone else until they open it too.
- **Who may act.** A genre's action is seen by every member of the session and, unless it says
  otherwise, used by the owner alone: a guest sees the chip greyed with *'Roll' is not yours to
  use here — its audience is owner.* rather than seeing nothing (the chip stays reachable by
  keyboard and reads the reason aloud; it simply does nothing when pressed) — the very sentence
  the server refuses a press with, since one rule has one sentence wherever it is heard. An
  action may widen that to any participant. Core's message
  verbs follow the per-message ownership rule under [Guest Permission
  Boundaries](#guest-permission-boundaries) — Stop is any member's, Branch is the owner's, the rest
  belong to whoever the message belongs to; a plugin's message action that names the same rule
  follows it too. The server checks the same declaration when the action fires — *the one you
  pressed*, named by its identity (the pipeline that declares it, and its key): two actions that
  happen to share a key (say Serene Pub's own **Summarize** and a plugin's) are two things, each
  with its own audience, each running its own pipeline, each switched on and off on its own under
  **Actions** in session settings. The greyed chip is a courtesy and the refusal is the law. A ⋮ menu entry that is grey
  says why the same way — *not yours to change*, *wait for the reply to finish*, *finish the edit
  first*, *unhide it first*, *only the newest reply can be regenerated*, *nothing to swipe to* —
  in its tooltip and to a screen reader, and stays reachable by keyboard.
- **Why is a button grey?** Because a condition the action declared does not hold right now —
  and the grey control tells you which. Besides the audience, every action may carry an
  **enabled-when**: a declared condition over what the session has already said about itself — a
  world slot (a genre's *Survey* that waits for a location, say), a field, whether anything is
  generating, or a fact about the message it is pressed on (the newest reply, hidden, a swipe to
  take). The condition is data, never code: a genre may ship defaults per function (none of
  Serene Pub's own genres do), the action may declare its own, and a session may override one
  function's — the nearest wins. A control whose condition does not hold stays listed — the chip, the ⋮ menu entry, the **More**
  menu row and the `/` palette row alike — greyed with the condition's reason in its tooltip,
  as a second line in the palette and to a screen reader, and the same sentence is what the
  server refuses with if the press is made anyway. The verdict follows the values: set the slot
  and the chip lifts without a reload, and every time a run ends the server re-sends the list.
  *Generating* counts every run of the session — an image render or a summary is the session
  being busy, not only a reply. Regenerate, Continue and Swipe act on the **newest** reply
  only, arrows included: swiping an earlier reply would rewrite history mid-conversation, so
  an older row's arrow is grey with *only the newest reply can be regenerated*. ⏳ The session
  override has no editor yet; it is set over the session bindings socket alone.
- **One name, one action.** A slash name is one action's: two pipelines claiming the same name for
  the same genre is refused when the second is published, whatever their keys. A plugin's names
  are prefixed with the plugin's id, so a plugin action keyed like one of Serene Pub's verbs is a
  different action under a different name and never shadows it.
- **Channels.** An action declared for one channel appears on that channel's composer and messages
  only; one declared for none appears everywhere. A channel decides where an action is *listed*,
  never who may use it.

#### Slash commands

Type `/` at the start of an empty draft and a palette opens above the field listing every action
the composer offers — the chips, the overflow and the turn controls — by its **slash name** with its
label beside it. Keep typing to filter (`/nar` narrows to Narrate and Side character; a label
matches too, so `/image` finds Image), **↑/↓** move the highlight, **Enter** runs the highlighted
row, or the first match when nothing is highlighted (a bare `/` and Enter only highlights — nothing
was named), **Tab** completes the name, and **Escape** closes the list until you change the draft.
A name typed in full — `/narrate` then Enter — runs whether or not the list is open. Running a
command clears the draft; it never sends it. While a reply is streaming the rows are greyed with
*wait for the reply to finish*, exactly as the chips and the **More** menu are.

Serene Pub's own actions have bare names (`/narrate`, `/continue`, `/retry`); a plugin's are
`/<plugin>.<action>` (`/acme.roll`), so two authors can never claim one name, and the palette
completes the long form so nobody types it. Slash names are stable and never translated — the label
beside them is.

#### Questions put to the cast — forms

Some actions are not finished when they run: they **ask**. A pipeline can end a message with a
question and a row of choices (or a small form), addressed to one participant — the Adventure
narrator's **Ask** puts a question with two to four options to one member of the cast: *Will you
come to the festival? — Yes · Maybe · No*. That block is a **form**: an action still waiting for
its answer, and the person it is addressed to is the only one who may give it.

- **If a person portrays the addressee** — the character is your persona, say — the buttons are
  yours: click one and the answer runs like any action you fired, receipted, visible in the run
  history, and the line it writes is yours, under your persona. Anyone else pressing them is told *that question was put to Tom, and it is theirs to
  answer*, and sees no buttons on the block in the first place — only *Awaiting an answer*. The
  owner is no exception: asking is not answering.
- **If the AI portrays the addressee** — Tom is in the cast and nobody has him as a persona — the
  genre's **answer pipeline** answers for him the moment the asking run finishes: it reads Tom's
  card and the conversation, puts the question to the model as Tom with the options spelled out,
  asks for one JSON object naming a choice, and then presses the button exactly as a person would
  have. Tom's *Maybe* lands as Tom's line, the run appears in the history as a child of the run
  that asked (the inspector shows the parent), and the next reply's pipeline sees *a question was
  answered* among the session's changes. Nothing about it is magic: every step is a node on a
  receipt, an administrator can turn review on for the answer like any other write, and the model
  never sees a confirmation screen — it sees the question and it answers.
- **If the question is put to nobody in particular** — the narrator named no one, or a name that
  resolves to nobody here (unknown, or a participant since departed) — the buttons are open to
  whoever the action's audience names (Adventure's *Answer* admits any participant), and the
  answer is the presser's: their persona's line when they hold one in the session, else their own.
- **If the block names someone nobody here portrays** — a reference the narrator wrote to a
  character outside the session — the block waits, and the owner may answer it.

A question is answered **once**. The moment an answer lands the block is marked with who answered
and what they chose, every client greys it and shows the answer in place of the buttons, and a
second press — a person's or the model's — is refused naming who already answered.

A question can also be **superseded**: every question carries the point in its channel it was asked
at, and once the conversation on that channel has moved past it unanswered — any newer line on the
same channel — a press on it is refused with *That question was overtaken — the conversation moved
on before it was answered*, whether the press is yours or the answer pipeline's (whose run then
halts on that sentence, receipted), and the block collapses to one line, *Superseded — the
conversation moved on*, with no buttons. A question answered before the conversation moved on stays
answered; a line on another lane of the channel changes nothing; and the first refused press
records *a question lapsed* among the session's changes so the next reply's pipeline knows. An
answer is not the conversation moving on: when a message puts three questions to three characters,
each answer lands as its own line and the other questions stay open, so all three get answered.

A question that asks another question is allowed to, and stops: a chain of answers is cut at four
runs deep (and sixteen runs per asking tree), and the cut is written down as a halted run naming
the cap rather than left to spin. While the AI is answering, the progress card of the action you
fired shows the answer being made — *Answer a form* — and your press is acknowledged once the whole
chain has finished.

A pipeline may point a question's buttons at **another pipeline's action** on purpose — the
Adventure narrator's *Ask* points its choices at *Answer*, which lives on its own pipeline — and
the press is then held to *that* action's audience, which is how a question written by the owner's
narrator can be answerable by any participant. The write checks the named action exists for the
session's genre, is not marked `world`, and carries the key the button says it does; a button
that disagrees with the action it names is refused at the write.

**The line.** Only questions inside the story can be put to a character. An action whose result
reaches outside it — a character card, lorebook data, settings, permissions, connections — is
marked `world` by whoever declares it, and a `world` action can never ride a message as a
question, can never be widened past the owner (or an administrator), and can never be answered by
a model: it belongs in the composer or the review gate, and a pipeline that tries to put one in a
message is refused at the write. So a character asking a question is fine, and a character
granting another character permission is impossible by construction.

### Auto-advance: what a send sets in motion

After you send, the turn order is recomputed, and the session's **Auto-advance** setting decides what happens next:

- **Off** — nothing replies until you press **Continue** (or pick someone). A send with auto-advance off waits for you; that is the feature.
- **Next turn** — the first prepared turn is fired once.
- **Whole round** — Chat's default. The first turn is fired, and when that reply finishes the order is recomputed and the next is fired, until the order is empty, it reaches a person's turn, or a safety cap is hit.

Only your own send starts this. Edits, deletes, settings changes and imports recompute the order but fire nothing. **Stop ends the round**: a reply you stop does not fire the next turn, whichever way the stop lands. A person's turn in the order is shown, never generated — that is how the session knows it is your turn. Under **Manual** the order is always empty, so nothing fires until you pick someone.

## Message Actions

Every message is one turn: the speaker's avatar in the left gutter, a name row, and the prose. The
name row carries the speaker's name, any badges (a handshake for a greeting, a ghost when hidden, a
film mark naming the scene that took it), a status while the model is writing, and, on the right,
the time, the swipe control, the quick actions and a ⋮ menu. The quick actions are the message
venue's primary set — **Regenerate** and **Edit**, and the **Stop** pill while a reply streams — and
appear when you hover or focus the turn on a mouse, always on a touch screen; the ⋮ menu is the
venue's overflow and always lists every action the message offers, core's and a plugin's alike, so
nothing is reachable only by hovering (see [Where an action appears](#where-an-action-appears-and-who-may-use-it)).

### Quick Reference

| Action              | Where                       | Where it appears                                                            | Who can use it                          |
| ------------------- | --------------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| Stop generating     | Stop pill in the name row; also in ⋮ | Only on the message currently generating                           | Any participant                         |
| Regenerate          | Quick action; ⋮             | Only the newest character message, once idle                                | Owner, or whoever owns that character   |
| Continue            | ⋮                           | Only the newest character message, if it has content                        | Owner, or whoever owns that character   |
| Edit                | Quick action; ⋮             | Any message, unless something is generating or it is hidden                 | Owner, or the persona/character's owner |
| Branch from here    | ⋮                           | Any message, unless something is generating                                 | Owner                                   |
| Select for summary  | ⋮                           | Any non-generating message                                                  | Any participant with session access     |
| Inspect run         | ⋮                           | Character or Narrator messages a pipeline run produced                      | Administrators                          |
| Prompt details      | ⋮                           | Character messages with recorded debug metadata, if context debugging is on | Anyone who can see the message          |
| Hide / Unhide       | ⋮                           | Any message                                                                 | Owner, or the persona/character's owner |
| Delete              | ⋮                           | Any message                                                                 | Owner, or the persona/character's owner |
| Swipe               | ‹ n / m › in the name row; ⋮ | The newest character message, or an eligible greeting                      | Owner, or whoever owns that character   |

The time shown on a turn is when it was last written: the moment it landed, or, for an edited or
regenerated reply, the moment of that change. **Show times** in the Messages panel's settings hides
the column.

### What Each Action Does

- **Stop generating** — only while that specific message is actively generating; cancels the in-flight LLM call.
- **Regenerate** — only on the most recent character message, and only once nothing else is generating. Clears the message and re-runs generation from scratch. Available to the session owner, or to whoever owns that specific character (so a guest who brought their own character into the session can regenerate its replies too).
- **Continue** — only on the most recent character message that already has content. Resumes generation, appending to the existing text instead of replacing it — useful when a response was cut off. Same owner-or-character-owner rule as Regenerate.
- **Edit** — swaps the prose for the composer so you can rewrite it in place; **Save** and a quiet **Cancel** replace the row's actions while editing, and the turn carries an ember outline. Disabled while any message is generating or while the message is hidden.
- **Branch from here** — opens a small modal asking for a new session title, then creates a copy of the session containing every message up to and including this one, and navigates you into the new session. **Owner-only**: a branch copies the whole history into a new session, unbounded by any rate limit, so a guest cannot grow the owner's storage with sessions the owner never asked for — a guest wanting their own copy starts a new session with the same cast. The server refuses a guest's branch at the write as well as at the button.

  What a branch copies, and what it deliberately leaves behind:

  | Copied | Not copied |
  | --- | --- |
  | the cast (active members, with their order, activity and visibility), the presences (personas), the guests, the tags | session-scope bindings — the branch resolves its subjects from the genre and preset afresh |
  | the messages up to and including the fork, each on its own channel, all settled | session-scope pipeline configuration overrides — a setting changed for the source session is the source's |
  | the genre, the preset and the genre's field values; the scenario, the reply strategy, the lorebook attachment | the layout — the branch opens in the preset's default layout |
  | | state anchored to messages (attribute and possession changes the ledger tied to a line) — the copies are new rows the ledger has never seen |
  | | the session's changes — the record of what was deleted, edited or swiped is the source's; the branch's first change is the fork itself |

  Members removed from the source are not copied at all: a removed row coming back as active in the branch would undo the removal.
- **Select for summary** — enters summarization selection mode (see below). Not shown while a message is generating.
- **Inspect run**. Administrators only, only on a reply a pipeline run produced, and only once it has finished generating. Opens the run inspector: one sentence saying what the run did, every stage in the order it ran, and for a selected stage the prompt it built, what it published, and which stop sequences went on the wire. See [Inspecting a run](./pipelines.md#inspecting-a-run).
- **Prompt details** — only shown with context debugging enabled and only once the message has recorded debug metadata; opens the same Prompt Details modal described under Statistics, scoped to that message's generation.
- **Hide / Unhide** — toggles `isHidden`; hidden messages are dimmed in the thread, marked with the ghost badge, and excluded from what gets sent to the model, without deleting them.
- **Delete** — opens a confirmation modal before permanently removing the message.

### Floors, built-ins and what each action emits

Every action that changes a message is a **built-in**: Serene Pub itself performs the write, as its
own small pipeline run, and it always records an event saying what changed and what was lost. The
write is receipted like a reply (the run inspector lists it under `core:spec/builtin-…`), an
administrator may put a review gate on it in the Pipelines panel — a delete that asks first — and the
event lands in the next reply's inlet as `sessionChanges`, so the pipeline knows the history it reads has
moved (see [What changed since the last reply](./pipelines.md#what-changed-since-the-last-reply)).

The actions fall into three groups, and a genre decides only the middle one:

| Group | Actions | A genre may… | What the write emits |
| --- | --- | --- | --- |
| **Floors** | Stop · Branch from here · Edit | nothing — present in every genre | `message-stopped` (how much text had arrived) · `session-branched` (on the new session, naming the fork) · `message-edited` (the previous text) |
| **Opt-in built-ins** | Delete · Hide / Unhide · Swipe | switch one off — never re-implement it | `message-deleted` (the content, role, speaker, channel and metadata lost) · `message-hidden` (which way) · `message-swiped` (the alternative that was showing, and the index now selected) |
| **Genre-declared content** | Regenerate · Continue · (a swipe's fresh alternative) | forbid `retry` or `continue`, and supply the pipeline that writes the text | `message-updated` with `verb: regenerate` / `continue` / `swipe` from the reply's own finishing write |

A genre switches an action off by declaring it in its `messageVerbs` (`{ delete: false }`); the
control is then absent from the ⋮ menu and the name row, and the server refuses the verb regardless,
naming the genre. A declaration that tries to switch off a floor is refused when the genre is
registered — a person can always stop a reply and rewrite a line, and a session's owner can always
branch it. A floor is a promise about the *genre*, not about who may act: branch is owner-only in
every genre, and the ownership rules under [Guest Permission Boundaries](#guest-permission-boundaries)
apply to a floor as to anything else.

**What a review may change.** An administrator who puts a review gate on a built-in sees a form for
the write, and the form offers only what the write declares as reviewable — the text of an edit, the
direction of a hide, the title of a branch, nothing at all for a delete. Which message the write is
about was settled when the person asked for it; the form never offers the message id, and a decision
that supplies one is refused with a sentence while the run stays parked. The write re-checks, as it
lands, that the person who asked may act on the row it is about to change.

**What a delete leaves behind, and for how long.** Deleting a line records an event carrying what the
line held — its content, role, speaker, channel and metadata — so the *next* reply can be told what
went; an edit and a swipe carry the text they replaced the same way, and a regenerate carries the
reply it discarded. That content exists for one reader. Once a reply has been handed the change, the
record keeps the event, the message id and the rest of what it carried, and lets the content go: the
session's history still says a line was deleted, without holding the line indefinitely. The run
that performed the write keeps what it published on its own receipt, under the receipt's retention.
A reply that fails or is stopped before it wrote anything is not that reader — the change waits for
the next reply that lands.

A reply that was stopped keeps the text that had arrived and wears a quiet **Stopped** mark in its
name row; regenerating or continuing it clears the mark, and so does swiping onto another
alternative — the stop belongs to the alternative that was streaming.

### While a reply is written

The speaker's name row shows an ember dot and the run's **status** — what the pipeline says it is
doing right now, in your language, with the speaker's name filled in: _Jasmine is thinking_ while
history and lore are read, _Jasmine is composing_ while the prompt is assembled, _Jasmine is
typing_ from the moment the model is called, and _waiting for the model_ or _loading the model_ if
the call is queued behind another or a managed backend is starting up and that wait lasts long
enough to notice — while the prose streams in below. A row whose run has not said anything yet
reads _working_. The ember dot is the only thing on the page that moves on its own. The same
status shows on the progress card and on the session's row in the sidebar; see
[Pipelines](./pipelines.md#every-reply-is-one-run) for where statuses come from. If the reply
fails, the message shows what went wrong in its own words (the connection, the code) with a
**Retry** link, rather than a red card.

### Scenes and the timeline

When a lorebook is attached, the conversation shows its history: a quiet centred date marks where a
history entry begins, and a scene begins with its name, set in the scene's colour with a film mark
(*open* beside it while the entry is still being written). Every turn inside a scene carries a thin
bar in that colour left of the gutter, and a turn a scene has already taken wears a film badge with
the scene's name. Clicking a date or a scene name opens it in the lorebook. **Show scenes and dates**
in the Messages panel's settings hides all of this.

### Swiping Through Alternate Replies

Character messages that are eligible support **swiping**: a left/right chevron pair (with an "N / total" counter) lets you cycle through alternate generations of that same message.

- **Swipe Left** steps back to a previously-generated variant (only enabled once you've swiped forward at least once).
- **Swipe Right** steps forward through already-generated variants if any exist ahead of your current position; once you're on the _newest_ variant, swiping right instead generates a brand-new alternate response and appends it to the swipe history.

Swipe controls only appear on the latest message from a character (or, for greeting messages, any greeting that comes after the last persona message) and follow the same owner-or-character-owner rule as regenerate/continue.

### Greeting Messages

A character's opening line — generated when they first join the conversation — is flagged as a **greeting** and shown with a small handshake icon next to their name. Greetings behave slightly differently from ordinary messages for swiping: you can page back and forth through a greeting's existing alternates (if the character has more than one greeting variant defined), but swiping right on a greeting never generates a brand-new one on the fly the way it does for a normal reply — you're only ever browsing variants that already exist for that character.

### Editing a Message

Edit replaces the prose with the same composer used for new messages (Markdown, same keyboard shortcuts), pre-filled with the current text. Save writes the change via `sessionMessages:update`; Cancel discards it. You can't start editing while any message in the session is generating.

### Selecting Messages for Summarization

Selecting a message for summarization switches the whole session into a multi-select mode: the composer area is replaced by a toolbar showing how many messages are selected, with **Select all**, **Select none**, **Cancel**, and three destination buttons — **Scene**, **World lore**, and **Character lore** — plus per-message **Select**, **Select all above**, and **Select all below** helpers. Messages already captured in an existing scene are locked out of selection (shown with the film badge naming the scene). Selecting **Scene** requires a _contiguous_ run of messages with no visible (non-hidden) gap between the earliest and latest picks — Serene Pub blocks the summarize action and explains why if you've skipped over an unselected, visible message. The actual summarization mechanics (what gets extracted and how it's stored) are covered in [Summarization](./summarization.md); how the result feeds RAG is covered in [Embeddings & RAG](./embeddings-and-rag.md).

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

Every change is also a delta against the state the model read: the session keeps a **state version** that every applied change moves by one, in turn order, and a proposal remembers the version it was made against. **Accept** compares. If the value it targets has not been touched since — however much else has changed — the change still holds and is applied. If that value *has* moved (you edited the bar yourself, or an earlier proposal on the same slot was accepted), the proposal is marked **superseded**: nothing is applied, and the line stays under its reply collapsed, *Superseded — Health changed since this was proposed*, with no buttons. A session that trusts the narrator gets the same rule at the write: a change whose value moved since the turn read it is refused on the run's receipt, naming the two versions, and the next turn's state-keeper proposes afresh against what it reads then. It is the one rule the questions above follow too: what the conversation, or the state, has moved past is superseded — never silently re-applied.

### Session settings

Three settings, on the session, under **Edit session**:

| Setting                | What it does                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Tone**               | Grounded, pulpy, grim or whimsical. The narrator's own instructions are written with it.                               |
| **Difficulty**         | Story, normal or hard. The planner reads it when it decides what a scene costs you.                                    |
| **Trust the narrator** | Off by default. On, the state-keeper's changes are applied as they are made instead of waiting for you to accept them. |

### Buttons

Four actions come with the genre, in the action row above the composer's tab strip:

- **Look**: the narrator describes where you are, from the lore and the world state. It changes nothing, and it is the button to start a new adventure with, because creating a session deliberately makes no model call and the opening scene is yours to ask for.
- **Rest**: the party stops. Stamina comes back, health comes back slowly and only somewhere safe, and the clock moves on.
- **Time passes**: the world clock steps on one notch, and the weather may turn with it.
- **Ask** (`/ask`): the narrator puts one question, with two to four choices, to one member of the cast — a decision that is theirs to make right now. The question lands as a narration with the choices under it, addressed to that character. If the character is your persona the buttons are yours; if the AI plays them, the genre's answer pipeline chooses for them as them and their answer lands as their line (see [Questions put to the cast](#questions-put-to-the-cast--forms)). **Answer** is the fifth action, the one the buttons fire — and only the buttons: it lives in the `form` venue, which no menu lists, so a question is answered where it was asked and nowhere else.

Rest and Time passes write no message at all. That is not a failure: a clock tick is a ledger line, not a paragraph, and Look is the button for the paragraph.

### What it needs

The **lorebook** is where the world lives, and an item somebody is carrying is an entry in it, so an adventure without one has nothing to describe or to hand out. The genre also makes several model calls per turn rather than one, so it is the genre to point at a local model you are not paying per token for. Each stage has its own connection and sampling settings in the pipeline panel, so the planner and the state-keeper can run on a small model while the prose runs on a large one.

## Writing Room

**Writing Room** is a co-writing session, and the only genre with **two channels that play different
parts**. `Main` is the conversation with your companion — what happens next, what is wrong with the
last page, who this character really is. `Manuscript` is the book itself: one text, grown in chunks.
The channel strip in the composer's footer is how you move between them.

The difference is not cosmetic. A message on `main` is a turn with a speaker, and the companion
answers it as itself. The manuscript is a **folio**: its messages are folded into one block of prose
with no names on them and put in front of the conversation, so the model reads the book as a book and
the chat as a chat. Writing on the manuscript therefore produces a **continuation** — the next part
of the text, with nothing announcing who is speaking — while writing on `main` produces a reply.

**Who answers.** With no character seated, your companion is the genre's envoy, the **Scribe** — a
plain writing partner with no fiction of its own. Seat one library character and the companion
becomes that person, in their own voice, with their card and example dialogue. One character at
most, and no persona: you are the author, not a participant.

**The bible.** The lorebook here is your story bible — places, people, rules, the things that must
stay true — and it is optional. It is read on every turn by keyword, and **Add to bible** is how it
grows: the model proposes one entry and holds it at the review gate, where you edit the name and the
content before anything is written.

**Session settings.** Four, and every one of them is read by a shipped prompt: **Point of view**
(first, close third, omniscient), **Tense** (past or present), **Chunk length** (roughly how many
words a continuation adds; 300 by default), and the **Author's note** — standing instructions for
the manuscript, read on every turn, so keep it short.

**Buttons.** In the composer: **Continue** (another chunk at the chunk length), **Brainstorm** (three
or four different things that could happen next), **Add to bible**, and **Export**. On a chunk of the
manuscript — its ⋮ menu, and only on the newest one: **Rewrite** (the same passage told another way),
**Expand** (the same beats with more room), **Tighten** (every beat kept, fewer words) and **Critique
this passage**, which answers in the conversation rather than over the prose. The three that rewrite
replace the chunk they were pressed on; nothing about a passage is lost, because **Delete is off on
the manuscript** — a paragraph of the book is not a paragraph of chat.

**Export** posts the whole manuscript as one Markdown block in the conversation, which you can select
and copy. It is not a file: Serene Pub has no download path for a session's own content yet, and one
is not invented here. A very long manuscript is refused rather than truncated — a message block holds
64 KiB.

**What it does not do yet.** The manuscript is not its own panel: the conversation and the book share
one log, switched by the channel strip, because the message log cannot yet be pointed at a single
channel. There is no word count. Both are noted where they are missing rather than faked.

## Lair

**Lair** turns Adventure inside out: you are the dungeon, and the party delving into it is the AI.
Nothing you type is a line of dialogue. The composer's text reaches the planner as **direction** from
whoever runs this place — *the torches gutter as they reach the stair*, *the cleric is more frightened
than she lets on* — and the reply is the dungeon's account of what the party did about it. There is no
persona in a Lair: the master is not in the scene. It takes at least one character (the party) and a
lorebook (the dungeon, one location entry per room, each naming its exits), and it writes to both the
lorebook and the timeline, because building rooms is the game.

**Two ways to take a turn.** The **Turn style** setting is read mid-session, so you can change it
between one room and the next. In **cast** style the planner decides what the party does, the
narrator writes the beat, and each character the planner named speaks in their own voice; the turns
are joined into one reply, as Adventure's are. In **narrator** style the party does not speak for
themselves: the one narrator writes the whole moment, dialogue included, which is exactly the thing
Adventure's narrator is told never to do.

**The party knocks.** When the planner sends the party through an exit that leads to a room the
dungeon does not have yet, the turn stops and puts the question to you instead of narrating a room
nobody built: **build this room**, or **let the narrator improvise** what lies beyond the door.
Either answer writes the room into the lorebook — improvise drafts it, build opens it empty in the
dungeon's own layout — and either way it stops at a review gate first, where you name it and edit
the text before it lands (put the exits in the text: *Exits: north → the Old Well*). **Build room**
in the composer is the same write without a knock. Lore is written here on purpose, and it is still
yours to approve, not the model's to file. Because the question is put to you, the room's buttons
can write to the world; a question put to a character never can.

**Steering.** Besides Build room, the action row has **Whisper** (a standing private note to one
character, read by that character's voice on its next turn — private the way a stage whisper is,
which is to say every agent that reads the scene's state can see it), **Nudge** (a direction the
planner reads next turn that produces no message at all), **Trigger trap** and **Reveal** (narrator-only
turns with a fixed brief). The party carries Adventure's **Health**, **Stamina**, **Mood** and
**Trust**; the world carries its **Location** and, new here, the **Floor** and the party's **Gold**.
The state-keeper proposes changes after each turn exactly as in Adventure, held for you to accept
unless **Trust the narrator** is on.

**What it does not do yet.** The right-hand column shows the world state rather than a map of the
rooms you have built; a map widget is pending. Whether an exit already leads somewhere is the
planner's judgement from the lore it was shown, so a wrong answer costs one knock, never a turn.

## Whodunit

**Whodunit** is a case, a room of suspects and one detective. You play the detective as your persona;
the suspects are at least two characters, and the case lives in a required lorebook: the scene, the
history, and what each suspect knows and will not volunteer. The narrator writes the scene in the third
person and never speaks for anyone; each suspect answers in their own voice.

**Hidden information is the genre.** A suspect's voice is built from the case's world lore, the
history, the conversation, their own card, and **their own private entries** — the character lore
bound to them — and never from the private entries of the other suspects. Nothing one suspect knows
reaches another through lore. Two things follow from how this is built today. A private entry that
is bound to nobody is treated as the world's knowledge, and the narrator sees it. And everything in
a suspect's **card** is visible to every voice, because the cast is rendered into every prompt; keep
what a suspect must not know about the others out of their card description and in the lorebook,
bound to them.

**Who did it is a fact before the first turn.** When the session is created, the culprit is picked
from the suspects by a rule keyed to the session, the way a shuffled deck is fixed once shuffled:
no model chooses, nothing is stored where a widget would draw it, and no suspect's voice is told
they are guilty. When you accuse, the same rule picks again, the two names are compared, and the
comparison decides **solved** or **failed** before any prose is written. The narrator is then told
the verdict and the culprit and writes the reveal. Adding or removing a suspect mid-case reshuffles
the deck, so settle the cast before the questioning starts.

**Buttons.** **Question** puts a question to one suspect you pick, and that suspect answers from what
they alone know. **Search** is a narrator turn over the scene that may turn up a clue; the world's
**Clues found** count rises through the state-keeper, held for you to accept unless **Trust the
narrator** is on. **Accuse** asks you to name a suspect, and is offered only while the **Case** is
open: your accusation is compared with the culprit and the case closes as **solved** or **failed**,
and the narrator writes the ending naming the culprit. Each suspect also carries a
**Suspicion** score the state-keeper moves as the questioning goes.

**Session settings.** **Tone** as Adventure's; **Candour**, which is how much a suspect volunteers —
*open* answers what you asked, *guarded* answers the narrowest reading of it and nothing more; and
**Trust the narrator**.

## Guide

**Guide** is the pure question-and-answer session type: no characters, no story, at most one persona, and one speaker the genre brings with it — Serene Pub's **Guide**, who helps you use the app and knows its documentation. Start one from the New Session picker (the **Guide** preset), ask anything about connections, characters, lorebooks or sessions, and the Guide answers, grounding itself in the documentation pages that best match what you asked and naming the page they came from. It is not a character: you will not find it in the Characters view, it cannot be edited there, and it never roleplays.

Under the hood the Guide is an **envoy** — see below — and its instructions are configuration: an administrator can tune what it is told in the Pipelines panel (**Guide reply → Envoy · Guide → System prompt**), and the change reaches the next answer without touching a prompt row.

## Envoys

An **envoy** is a speaker a **genre** brings with it: a cast member that exists nowhere in your library, declared by the genre (or by an action a plugin contributes) and seated in a session the way a character is. The Guide genre's mascot is the first. What follows from "a cast member":

- **Seating.** Creating a session seats every envoy the genre marks as its default, with no choice offered; a preset may pre-seat others. In **Edit Session → Participants**, an **Envoys** card lists the genre's envoys with a switch to seat or unseat each one (the session owner's; guests see it read-only — a refused toggle springs back with the reason). An envoy an action brings — a dice plugin's *Roll* reporting as "the Dice Master" — is seated the moment its action posts and has no switch. A **branch** keeps the seats the source had; a genre **upgrade** seats the defaults the new version brings, and never re-seats one you unseated. An envoy is not a character: a genre that admits no characters is satisfied with an envoy seated.
- **Turns.** An envoy that **replies in turn** is a candidate like any active character: when nobody else is due, it answers; with a mixed cast, the turn strategy may pick it. An envoy that speaks **on action** only ever posts through its action and is never picked for a turn — nor can it be asked to take one. If a session's genre admits no characters and no in-turn envoy is seated, sending a message tells you so: *This session has no one to answer — seat an envoy in Session settings.*
- **Messages.** An envoy's reply shows its name and image from the genre's declaration. It has no character page to open, and Regenerate, Continue and Swipe work on it as on any reply; the inspector's *Portrayed by* line shows it as, for example, **Guide · AI**. An envoy's line is the **session owner's** to edit, regenerate or delete — as narration is — never a guest's. Your own line written with no persona is **yours**: the person who wrote it, and nobody else, may change it. A message nothing names any more — a reply whose character was later deleted from the library, or a line whose author's account is gone (it shows as **Unknown**) — is the session owner's to edit, hide or delete, as narration is.
- **Its words are configuration.** An envoy's instructions are the genre's defaults, tuned in the Pipelines panel as a deviation — the step named **Envoy · <name>** on the pipeline that reads them — and reset by clearing the field. There is no separate schema, no prompt row and no "envoy editor": what the genre and the installed actions ship is what a session gets, and nobody authors an envoy for another genre.

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

## Sprites

When a character has [sprites](./characters.md#sprites), a session can show the face that fits each line.

**Choosing a sprite automatically.** After a character's reply is saved, Serene Pub compares the reply with the character's sprite labels and records the closest one on the line. This uses the local embedding model, not the reply's model, so it adds no model call to a turn. With no embedding model loaded, nothing is chosen and faces stay as they were. To stop a face flickering on every line, the last sprite is kept unless a new one fits clearly better. The session's settings show this step's controls beside the turn controls: **Choose sprites** turns it off for the session, **Stickiness** sets how much better a new sprite must fit, and **Minimum similarity** sets how close a line must be to any sprite before one is chosen.

**Changing a line's sprite.** The message menu's **Change sprite** lets anyone who can edit a character's line pick its face, or show none. The automatic choice never overwrites a sprite a person picked.

**Swipes.** Each alternative of a message keeps its own sprite, so swiping back and forth changes the face with the text.

**Where faces show.**

- The **Scene Portraits** widget, set to show the scene, draws each character's **current sprite**: the one on their newest line. Its **Show sprites** setting turns this off.
- The **Messages** widget's **Face beside each line** setting chooses between the character's avatar (the default) and the sprite that line showed. A line keeps the sprite set it was said in, so scrolling back past a change of outfit shows the old outfit on the old lines.
- The cast faces in the session header follow the current sprite too.

**Changing a character's sprite set for this session.** On a Scene Portraits face, the sprite-set menu shows the character in another of its card's sets for this session only, or returns to the set the story gives them. It appears when the card has more than one set. The session's owner or the character's owner can change it, and everyone in the session sees the change at once. Faces redraw straight away; new lines record the new set.

Sprites can also gate actions: a genre or plugin can offer a button only while a character shows a given sprite (`sprites.<name>.label`).

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

## Who portrays a participant this turn

Every turn starts by deciding, for each participant it concerns, whether a **person** speaks as them, the **AI** does, or **nobody** can — the participant's **portrayal**. The answer is pinned on the run's receipt before the first step runs and shown as the **Portrayed by** line in the run inspector (see [Pipelines](./pipelines.md#inspecting-a-run)); a member joining or leaving while a reply is being written changes the next turn's answer, never the one under way.

Participants are named by reference — `character:<id>`, `user:<id>`, `envoy:<slug>`, or a role word — and the rules are:

| Participant      | Who portrays them                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user:<id>`      | That person, if they are a member of the session (the owner or a guest). Otherwise nobody.                                                                                                                                                                                                                                  |
| `owner`          | The session's owner.                                                                                                                                                                                                                                                                                                         |
| `admin`          | The person who started the turn, if they are an administrator. Otherwise nobody.                                                                                                                                                                                                                                             |
| `participant`    | The person who started the turn, if they are a member. Otherwise nobody.                                                                                                                                                                                                                                                     |
| `run-owner`      | The person who started the turn.                                                                                                                                                                                                                                                                                             |
| `character:<id>` | A **person**, when the character is a member's own persona in this session (attached as theirs and owned by them — the same ownership rule that decides who may edit a persona's messages). Otherwise the **AI**, when the character is in the session's cast (benched characters included — being inactive keeps them out of the rotation, not out of the session) or is the turn's own speaker (a side character on a [Narrator Response](#narrator-response) speaks through the model for exactly that turn). Otherwise nobody: a character in the library but not in this session. |
| `envoy:<slug>`   | The AI — a speaker a genre brings with it is always the model's. (Envoys are not yet data; every well-formed slug answers this way until they are.)                                                                                                                                                                             |
| `item`           | Nobody, ahead of time: "whoever this message belongs to" is decided against the message itself, by the per-message ownership rule under [Guest Permission Boundaries](#guest-permission-boundaries).                                                                                                                              |

A turn asks about the speaker, every character in the cast, every member's own persona in the session, the owner and the person who started it. It is decided for every run in a session that reaches the model — a reply, a summarize, an event a pipeline subscribes to — and not for a preview that stops before the model is called (the composer's token count, the inspector's debug preview): nobody speaks on those, so nobody is portrayed. The answer names members and characters — exactly what the session's member list already shows — and never a connection; a participant nobody portrays is shown by reference, never by name. A persona attached to the session is never offered as a side character, because the model would be speaking as somebody's own presence.

## Statistics Tab & Prompt Details

If **context debugging** is enabled in [System Settings](./system-settings.md), the composer's **More** menu gains a **Statistics** panel showing a live token count and included/total message count for your current draft, plus a **Details** button that opens the full **Prompt Details** modal. That modal breaks down, for the most recently compiled prompt:

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

### Generation Statuses

While a message is generating, its name row carries the run's status — _Jasmine is thinking_ · _Jasmine is composing_ · _Jasmine is typing_ — and, when the call has to wait, _waiting for the model_ (queued behind another call) or _loading the model_ (a managed backend starting up), before the pipeline's own status returns once tokens stream. The former fixed stages (_queued · loading · generating_) are gone; a row written by an older server still reads them for one release.

### Failed Generations

If a generation errors out, the message shows the error text/code inline with a **Retry** button that re-runs regeneration in place, rather than silently failing or leaving a blank message.

### Guest Permission Boundaries

To recap the ownership rules scattered through this page: guests can send messages as their own persona and edit/hide/delete only their own persona's messages — all of that is unconditional. Branching is the owner's alone, in every genre. Regenerating, continuing, and swiping a _character_ message, though, isn't session-owner-only: it's available to the session owner **or** to whoever owns that specific character, so a guest who brought their own character into someone else's session can control that character's replies too, even though they can't touch anyone else's. Triggering a character out of turn (Trigger Character) and the round-robin Continue button are the ones actually unavailable to guests — not because of a server-side ownership check, but because the whole Extra Controls tab (along with Lore, Pinned Images, and Statistics) is hidden from guests client-side. Select for Summarization has no ownership restriction at all — any participant with access to the session can use it, on any message.

### Session Not Found

Navigating to a session you don't have access to (or that's been deleted) shows a dedicated "Session not found" state instead of an empty thread.

### Context Exceeded Warnings

Both the composer and the Statistics panel track your compiled prompt's token total against your active context limit. The composer's top-edge meter turns ember past 90%; over budget, the sentence "This draft pushes the prompt past the context limit. Older turns will be trimmed." appears under the field, the Statistics counter turns red, and the Prompt Details modal's token bar switches from success-green through warning-orange to error-red as it fills up — the modal also surfaces the specific truncation reason (for example, oldest messages being dropped) when one applies.

### Why Can't I Regenerate, Continue, or Swipe?

These three actions are available to the session's **owner**, or to whoever owns the specific character the message belongs to — this is enforced server-side (`checkMessageEditPermission`), not just hidden in the UI. If you're a guest and don't own that character, you'll be able to send messages as your own persona and manage your own persona's messages, but these controls won't take effect for you on someone else's character. Separately, Pick who speaks and the round-robin Continue in the Actions row are unavailable to any guest regardless of character ownership — but that restriction is purely client-side (the turn controls are hidden for guests), not a server-side ownership check like the other three.

### Why Isn't the "Ready to Continue" Line Showing?

The *ready to continue* line only appears when _all_ of the following are true: it's a group session with more than one active character, nothing is currently generating, you don't have unsent draft text, you aren't editing a message, the round-robin logic has a character queued up, and the session already has at least one message. Typing a draft or opening an edit hides the line until you clear it, and so does turning off **Show who is due next** in the Messages panel's settings.
