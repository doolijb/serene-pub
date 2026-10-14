# Live scenes: selection, generation, history entries and story time with less LLM

Status: **PROPOSED 2026-10-12.** Nothing built. Rulings wanted are marked ★. Words are 🚧 until ruled (NOMENCLATURE §24; none collide with §23).

**2026-10-13 — owner: "Works for me" on §13 (genre owns its summarize pipelines; builder + fixed contracts + typed genre field; ★7/★8 closed, ★9 ruled yes). §11–§12 are superseded by §13. ★1–★6 remain open. Still a proposal: no go to build.**

## 1. What exists (facts, 2026-10-12)

**A scene is captured after the fact.** `scenes` rows hold `selectedMessageIds` (a JSON list), a
`historyEntryId` (NOT NULL), `name`, `summary`, cast in `scene_characters`, `branchId`. A person
ticks messages (*Select for summary*), picks *Scene*, picks or makes a history entry, and the
`core:spec/summarize-scene` pipeline runs. Rules enforced at the write (`sockets/scenes.ts`
`capturableMessageIds`): one unbroken run, a message in at most one of the session's scenes,
session-keyed advisory lock.

**Nothing marks a scene while it is being played.** There is no "current scene"; the Messages
widget's *Show scenes and dates* draws marks only for scenes already saved. The Chronicle widget
shows the clock, the entry the session is in ("Now"), that entry's scenes, *Summarize scene*
(starts the tick selection) and *Start new history entry* (`entries:iterateNext`: one calendar step
after the latest entry).

**Every scene costs 3–5 model calls.** `summarizeSpec` runs `draft` (per batch) → `synth` →
`naming` → `cast` (`core:oracle/extract-cast@1`) → `save`. *Compile to Entry* is another call;
*Build/Extend graph* more. Processing is manual and reviewed.

**A no-LLM cast proposal already exists and is unwired.** `utils/sceneCastProposal.ts`: senders
and the session roster are definitional (structural tier), names in text come from the NER lane's
`message_annotations` (textual tier), with evidence per row. Measured on five transcripts; header
says it is meant to pre-fill the review. `sceneMentions.ts` already derives *mentioned* from
annotations instead of storing it.

**Time moves only by hand.** Sessions have their own clock (`sessions.story_clock_*`); the Chronicle
steps it. The outlet `core:outlet/advance-story-clock@1` is built in the host, but **no core spec
calls it**. Adventure's *Time passes* asks the keeper model for `values,inventory` changes and never
touches the clock. Messages carry **no story time**: a conversation cannot say which lines happened
on which story day. The prompt's `HISTORY` block is `{date: entry text}` plus `DATE: the current
date is …`.

**History entries are dated by hand too.** A scene's date is only its entry's date. A *New* entry
from the summarize window is dated where the session stands; *Start new history entry* steps one
unit past the latest entry regardless of where the clock is.

## 2. The problem, in one sentence

Scenes, entries and the clock are three hand-driven ledgers that nothing connects while playing, so
the only automation on offer is the expensive one (the model writes everything after the fact).

## 3. The shape: a scene is opened, not selected

Turn the capture inside out. A scene **opens at a message and stays open**; the conversation from
its first line to the newest is the **open scene** 🚧. Closing it fixes its last message. Selection
disappears for scenes: a scene is always the run between two boundaries, so "unbroken" and
"one scene per message" hold by construction. Tick selection stays for World and Character lore
(those may skip lines).

Three things happen at a boundary, all deterministic:

1. **The scene is filed** under the entry the session reads *Now* (newest entry on the line dated
   ≤ the clock). If the clock has stepped past that entry's date, the boundary **creates the next
   entry dated at the clock** (not one unit past the latest). No model.
2. **The scene is stamped** with the clock as it stood when it opened and when it closed.
3. **The scene gets a name and a cast** without a model: name `Scene N` (or `Scene N · <place>`
   where the genre's state has a place; `<date>` when the day differs from the previous scene);
   cast from `sceneCastProposal` with its evidence shown, person-editable.

The **summary** is the only step that needs a model. It becomes a *mode*, not a chore (§5).

## 4. Where boundaries come from: manual, suggested, automatic

A session setting **Scenes** 🚧 with three values, the genre choosing the default:

| Value | What happens at a trigger |
| --- | --- |
| **Manual** | Nothing. The person uses *Start scene here* / *End scene here* on a message, or the Chronicle's *Close scene*. |
| **Suggested** (proposed default) | A quiet chip appears at the boundary line: *New scene? — the day changed* with **Yes** / **Not here**. One tap. Dismissed suggestions are remembered for that trigger instance. |
| **Automatic** | The boundary is placed; a divider appears; it can be dragged or removed afterwards. |

Triggers, none of which ask a model, each a checkbox under the setting:

- **The clock crossed a day** (or a coarser unit if the clock is coarse). On by default.
- **A time action ran** (*Time passes*, *Rest*, or `advance-story-clock` from any spec). On.
- **The place changed** (Adventure/Lair state key the genre names as its place). On where the genre has one.
- **A system or narrator message was posted** (*Narrate*, a greeting after a reset). Off.
- **Length**: more than N lines or M tokens since the scene opened. Off; it is the SillyTavern
  reflex and the weakest signal.
- **A long pause**: the next message arrives more than X real hours after the last. Off.

Suggested mode is the default because every trigger above is a *proxy* for a scene change, and a
one-tap confirmation costs far less than an undo while costing nothing in model calls.

## 5. Generation: the model does one job, when asked, in bulk

- **Summary modes** (per session, under the same setting): **On close** (the scene's summary runs in
  the background the moment it closes, cast and name already filled), **On request** (the Chronicle
  shows *Summarize* on each unsummarised scene, and *Summarize all (3)*), **Never**. Default **On
  request**: the person decides when to pay.
- The `cast` oracle node leaves the scene spec; `sceneCastProposal` feeds `scene_characters` at
  open and refreshes while the scene is open (senders arrive structurally; NER annotations arrive
  from their lane). The review shows evidence instead of asking a model.
- `naming` runs only when the person asks for a model name (*Name it*). Deterministic names are
  good enough for a ledger and never wrong.
- **Compile to Entry** gains a no-model form: the entry's content becomes its scenes' summaries in
  play order, under their dates, written as the entry's text with a marker so the next compile
  replaces only that block. The model rewrite stays as *Compile with the model*.

Net effect per scene: 0 calls by default, 1–2 when summarised (`draft`+`synth`, one when the scene
fits a batch), versus 3–5 today.

## 6. Time and date tracking

- **Stamp each message with the story clock** at send: `session_messages.story_clock_*` (or one
  `story_instant` when DESIGN-story-time P2's `day_index`/`time_index` lands; ★2). The Messages
  widget's day marks become live, drawn from the stamps, not from saved scenes. A message's menu
  gains *Set the time here…* for corrections; later lines re-stamp only if they carry the old value.
- **Clock moves without a model**:
  - Core composer quick action **Time passes…** 🚧 for every genre: a stepper (minutes · hours ·
    days · months · years, forward/back) that calls `core:outlet/advance-story-clock@1`. Adventure's
    *Time passes* keeps its keeper prompt but gains the same stepper field so the amount is the
    player's, not the model's.
  - A reply spec **option** *Each reply advances the clock by …* (Chat, off by default): a fixed
    tick is honest and cheap; the "advance a minute per reply" case from DESIGN-story-time §5.
- **If the model may propose time at all** (★3), it does so the way the keeper proposes state: a
  `clock` field in `ADVENTURE_KEEPER_SCHEMA` landing as a **proposal** the person accepts, never an
  automatic write. Chat gets no model-driven time.
- **History entries follow the clock**, not the other way round: the boundary rule in §3.1 creates
  the next entry at the clock's date. *Start new history entry* in the Chronicle keeps working but
  dates at the clock when the clock is ahead of the latest entry, and only steps one unit when it is
  not. The entry's date remains editable in the lorebook; entries are still the lorebook's rows.

## 7. UI, by surface

**Messages widget.** A **scene divider** 🚧 line at each boundary: swatch, name, date, cast faces,
line count; click to rename, drag to move (snaps between messages), ⋯ for *Remove boundary*,
*Summarize*, *Open in lorebook*. The open scene's divider reads *Scene 4 · since Day 12 · 9 lines*.
Message menu: *Start scene here*, *End scene here* (closes at this message, opens the next one
after it), *Set the time here…*. Suggested-mode chips render in the same slot as the divider.

**Chronicle widget.** Head unchanged (clock). Then an **Open scene** card: name, since-when, lines,
proposed cast with evidence pills, **Close scene** and **Close and summarize**. Then *Now* entry and
its scenes as today, each with its summary state (dot: none · running · done) and *Summarize*;
*Summarize all (N)*. Settings: the Scenes mode and triggers, the summary mode.

**Session settings › The story.** The same Scenes and summary settings for people who do not place
the Chronicle widget.

**Lorebook History / Scenes.** Unchanged except scenes show their clock stamps and the compile's
no-model form.

## 8. Data

- `scenes`: add `openedAtMessageId`, `closedAtMessageId` (NULL = open), `storyClock*` at open and
  close (or two instants, ★2), `summaryStatus`. `selectedMessageIds` is **derived** from the range
  at close and kept for readers (sceneMentions, process, parity) until they read the range; then
  retired (§23 entry). One open scene per session, enforced by a partial unique index.
- `session_messages`: `story_clock_*` stamp (★2).
- Session setting `scenes` 🚧 `{ mode: 'manual'|'suggested'|'automatic', triggers: {...},
  summary: 'onClose'|'onRequest'|'never' }` on the session's extension data, genre default via
  `SessionShape`.
- `SessionShape.writes.scenes` already gates whether a genre may write scenes; Dungeon Crawler
  (no lorebooks) gets Manual-only and no entries.

## 9. Phases

| | What | Model calls touched |
| --- | --- | --- |
| **P1** | Open scene + boundaries: range columns, one-open-scene rule, dividers, *Start/End scene here*, Chronicle Open scene card, deterministic names, filing + entry-at-clock rule | none |
| **P2** | Cast from `sceneCastProposal` with evidence; `cast` node leaves the spec | −1 per scene |
| **P3** | Message story stamps; live day marks; *Time passes…* core action; reply-tick option | none |
| **P4** | Scenes mode + triggers (Suggested default); summary modes incl. *On close* and *Summarize all* | summaries become optional |
| **P5** | No-model Compile to Entry; keeper `clock` proposal (if ★3 yes) | −1 per compile |

P1 alone removes the selection chore and the "already in a scene" refusal; P1+P3 give time
tracking with zero model involvement.

## 10. Rulings wanted

- ★1 **Default mode Suggested**, triggers *day changed* + *time action* + *place changed* on? Or Manual, as today's spirit?
- ★2 **Stamp shape**: five `story_clock_*` columns on messages and scenes now (matches the three dated tables), or wait for DESIGN-story-time P2's instant columns and stamp then?
- ★3 **May a model ever move or propose the clock?** Proposal: Adventure keeper may *propose*; Chat never; nothing writes without a person or a fixed tick.
- ★4 **Deterministic names** acceptable as the stored name, or stay NULL until a person/model names it (Chronicle shows *Scene N* as a placeholder)?
- ★5 **Retire `selectedMessageIds`** once readers use the range, or keep it as the derived cache forever?
- ★6 Does the no-model **Compile** form belong as the default button, or beside the model one?

## 11. Channels and lanes: what a summary gathers (asked 2026-10-13)

**Today nothing genre-level decides.** Verified:

- A picked list is taken as given, lane and all (`host.ts` `summarize_source`). The list comes from
  whichever Messages copy the person selected in: a copy shows one channel, or the primary log
  (every channel no other copy claims). So which lanes enter a scene depends on widget layout.
- "Everything" (no ids) is one channel, hidden rows filtered, ≤ 5000 rows by id. The summarize
  request carries no channel, so it is always `main`. A bare slug spans all its lanes; `slug:n` is one.
- Scenes are channel-blind: `capturableMessageIds` checks membership and overlap only; `scenes`
  has no channel column. The gap check runs over the whole session list, so a selection on a side
  channel with interleaved `main` lines is likely refused as a gap (not run; read from
  `scenesFlow.svelte.ts`).
- The only channel policy anywhere is on the reply path: `core:query/session-history@1` takes
  `channel`, `talkOnly`, `unplayedOnly` from the genre's spec params (Lair reads the Sanctum as
  talk). `ChannelDecl` says role (`conversation` | `folio`), voice, label, verbs; nothing says
  whether a channel is story, aside or unrecorded.
- One shared `core:spec/summarize-scene`, hardcoded in `sockets/scenes.ts`; its inlet binds no
  genre. A genre can re-prompt and re-sample its steps, nothing more.

**Ruling proposed: the genre owns the gathering policy, not the pipeline.**

- `ChannelDecl.record` 🚧 `'story' | 'aside' | 'off'`. *story*: the channel's lines are the scene.
  *aside*: gathered as context by the story scene's span, rendered as a labelled block after the
  story line they follow (*Meanwhile, in the Sanctum*), never as story lines. *off*: never read by a
  summary (a dice log). A `folio` channel marked *story* summarises its text block. Default `main`
  = story, every other channel = off, which is today's behaviour byte for byte.
- Lanes inherit their channel's policy. A scene opens on one channel lane; one open scene per story
  channel lane (the partial unique index in §8 is keyed on `(sessionId, channel)`).
- `core:query/summarize-source@1` gains `channel` and `asides` ports; the host reads the story rows
  by range, then aside rows whose ids fall inside it. `batches` keeps an aside block attached to
  the story line it follows so a cut never strands it.
- The four summarize specs stay core and shared. Reasons: they are prompt/sampling namespaces
  already configurable per step; five genres × four specs would multiply admin surface for no new
  behaviour; the policy is one word on a declaration the genre already writes; and "no magic in
  core" is kept because the spec reads the policy through an explicit port, as `session-history`
  does.
- Escape hatch, not now: a genre contributing its own summarize action spec would need the socket
  to resolve a spec by role instead of by hardcoded id. Deferred to a ruling (★7).

★7 Should a genre be able to replace the summarize spec outright (spec by role), or is the
`record` policy enough? Recommendation: **policy only** for 0.6; revisit if a plugin genre asks.

## 12. What a channel means, for the summarizer (asked 2026-10-13)

The Lair's own prompts carry the Sanctum's meaning in their text ("Talk with the player since the
last turn — plans, not facts"). A shared summarize spec cannot, so the meaning arrives as data,
written once by the genre author, and the transcript is built from it with no model.

- **`ChannelDecl.meaning`** 🚧 (`I18n`): how a reader should take this channel's lines, one or two
  sentences. Sanctum: _The dungeon master's private counsel with the Castellan, outside the
  story. Plans and corrections, not events; nothing said here has happened._ A phone channel:
  _Text messages between the people named in the lane._ A folio: _The manuscript the conversation
  is about; its text is the work, not talk._ Absent: the label alone, and a role-derived default
  (_conversation_ / _the text being written_).
- **Lanes carry no prose.** A lane's meaning is computed: the channel's label plus the lane's
  participants (the genre's, per the channel-lanes ruling): _Phone · Mara and Kira_. Nothing
  stored.
- **Rendering (deterministic, a core task).** The scene transcript opens with a **Channels** block
  listing every channel that appears in the span: label, meaning, and how its lines are marked.
  Story lines render as today. An aside renders inline where its ids fall, under a heading that is
  the lane's computed name (_Meanwhile, in the Sanctum_), the meaning on its first appearance only.
  `batches` keeps a heading with its block so a cut never strands one.
- **The drafting prompt** gains `{{#if channels}}` and one rule: _lines under a heading are what
  the heading says they are; never write an aside as something that happened_. Genres still
  re-prompt per (pool, spec) as today, so a genre may say more; it never has to.
- **Not now:** per-session channel notes written by a person. The genre's sentence plus the
  computed lane name covers every core genre; a plugin genre writes its own `meaning`.

### 12.1 Revised (owner 2026-10-13): a transcript template from the genre, not a sentence

`meaning` prose is dropped. The meaning of a channel is **how its lines are written into the
transcript**, and that is a template's job, which the house rule already prefers (explicit
template, no magic in core; `prompt/adventureContext.ts` is the in-core counterexample).

- **`record` stays.** It is a read policy: which rows the host fetches by the scene's span. A
  template cannot widen a query, so the structural half stays structural.
- **Scene transcript template** 🚧: a context template of a new kind, _transcript_, that the genre
  ships (`SessionShape.transcript`, or the seed's `createdForGenre`), Liquid like every other.
  Variables: `scene` (name, place, clock at open and close), `channels[]` (slug, label, role,
  record, `lanes[]` with participants), `lines[]` (speaker, text, channel, lane, clock,
  attachments), `cast`. Core ships **Default**: story lines as `Name: text`, an aside as a heading
  block under the lane's name, a Channels preamble naming each channel by its label. The Lair's
  template says in its own words what the Sanctum is ("plans, not facts") and renders the
  Castellan's talk accordingly; a phone genre renders a lane as a thread.
- **Rendered by `core:task/render-transcript@1`** in the summarize spec before `batches`, which
  cuts over rendered chunks and keeps a heading with its block. The template is chosen on that
  step like any context template (Admin › Context templates, kind _transcript_; duplicate and
  edit; `templateCheck` flags unknown variables). The shipped prompts stay as they are: the batch
  they receive is text instead of `{speaker, text}` JSON (a prompt-side change in the drafting row,
  one line).
- **One new resolution rule.** Prompts default per (pool, spec), not per genre, so a shared spec
  has one default today. The transcript template defaults per **(spec, genre)**: the session's
  genre picks the shipped template when the admin has not chosen one. Named here because it is
  the only piece that is not already a mechanism.
- **Fallback.** The shipped Default's `{% else %}` branch renders any channel it was not written
  for as a labelled aside, so a plugin genre that adds a channel and no template still reads
  sensibly.

★8 Transcript template defaults per (spec, genre): is that rule acceptable, or should the
template be a genre field read by the step directly (no admin picker)? Recommendation: **picker,
default per (spec, genre)**, so an admin can retune a genre's transcript without a plugin change.

### 12.2 Storage, query order, and batching with a template (asked 2026-10-13)

**Where the template lives.** A `pipeline_context_templates` row, like every context template:
`node_definition_id = core:task/render-transcript`, `engine` handlebars (the table's default),
`source`, `created_for_spec_id` → the summarize-scene spec, `seed_key` for shipped rows
(`context-template:core:task/render-transcript:default`, `…:lair`), `is_immutable` for shipped,
`owner_plugin_id` for a plugin genre's. The summarize spec's render node declares
`template: slot.template()` exactly as `chat/respond.ts` does, so the admin picks it on that step.
Resolution: the config's chosen template, else the shipped row for (node, session's genre), else
the shipped Default. The per-genre default is one nullable `default_for_genre` on the seed row
(★8); nothing else in the table changes.

**Query and order.** Two reads in the host, both by **message id**, which is already the order
key of every session read (`asc(sessionMessages.id)`); no model and no timestamp heuristics.

1. Story rows: `session_id = ? AND channel = <the scene's lane, exact> AND id BETWEEN openedAt AND
   closedAt AND is_hidden = false ORDER BY id`. One lane, so no interleaving to repair.
2. Aside rows: `session_id = ? AND id BETWEEN openedAt AND closedAt AND is_hidden = false AND
   (channel prefix-matches any channel whose record = aside) ORDER BY id`. Each aside row attaches
   to the story line with the greatest id below it ("after the line it follows"). Several lanes in
   one gap: `byLaneThenTime` within the gap, one block per lane, blocks in order of first id.
   Asides before the scene opened are not read; `asideLookback` (rows, default 0) is the knob if a
   genre wants the planning that preceded the scene.

**Batching.** The template renders **units, not one string**, so a cut can never split a heading
from its block. Three named sections in one template: `preamble` (scene header, Channels block;
rendered once), `line` (one story line with its attached `asides`), `aside` (a partial `line` calls).
`core:task/render-transcript@1` → `{ preamble, units: [{ messageId, text, tokens }] }`.
`core:task/batch-messages@2` cuts over units with today's budget and `minBatchMessages` rule, never
inside a unit, and prefixes every batch with the preamble (counted in its budget). A unit larger
than the budget ships alone (today's floor of one). The drafting prompt receives text; `synth` and
`naming` are untouched. Order inside a batch is unit order, which is story id order. The template
sees `line.clock` and `line.dayChanged` (from the message stamps, §6), so a day divider is the
template's to draw.

## 13. Supersedes §11–§12: the genre owns its summarize pipelines (owner 2026-10-13)

Owner: the policy-plus-template layering was convoluted; the genre should own the pipeline, with
a standard shape so modders can maintain it. Rulings ★7 and ★8 close as **genre owns**.

**What the genre owns.** Its summarize-scene spec (and, by the same rail, world, character and
history summaries): `core:spec/lair-summarize-scene`, `…/chat-summarize-scene`, a plugin's
`acme.phone:spec/summarize-scene`. Each is its own namespace: prompts seed per spec already (the
Rest / Time passes precedent in `keeperAction.ts`), so every genre's spec gets its own drafting,
synth, naming and cast prompt rows and its own sampling with no new mechanism. The transcript
template is simply that spec's default on its render step; the per-(spec, genre) rule in §12.1 is
gone, as is `ChannelDecl.record`: which channels are story and which are asides is the spec's
query params, as `session-history` already works.

**How it stays maintainable (the standard).**

1. **One builder, the explicit graph behind it.** `summarizeScene(id, { genre, version, channels:
   { story: 'main', asides: ['sanctum'] }, transcript })` in `@serene-pub/sdk`, compiling to the
   same nodes `summarizeSpec` builds today (source → render → batches → draft map → synth → naming
   → cast → save). A helper that expands to an explicit spec is the house rule (no magic in core);
   a modder who wants more than the options ejects to the graph it emits, as with `keeperAction`.
2. **Fixed contracts at both ends.** The inlet shape (`summarizeRequest`: scope, range or ids,
   history entry, kind) and the outlet (`save` → a `scenes` row with name, summary, cast) are
   core's and versioned. The UI, the Chronicle and the scene row never learn which genre's spec
   ran; the scenes socket resolves the spec, not the UI.
3. **Resolution is a typed genre field, not a search.** `genre(id, { …, summarize: { scene:
   lairSummarizeScene, world?, character?, history? } })`. The scenes socket asks the session's
   genre for `summarize.scene`; absent, core's default spec runs, so a new genre summarizes on day
   one with nothing written.
4. **Core's genres eat their own cooking.** Chat, Adventure, Guide, Lair and Dungeon Crawler each
   declare their spec through the builder; the Lair's is the one that names the Sanctum. The
   builder's defaults are Chat's.
5. **Conformance.** `@serene-pub/conformance` gains a summarize fixture: a genre's spec must accept
   the inlet, emit the outlet, survive an empty span and a span with an unknown channel, and render
   a transcript whose units carry message ids. A modder runs it with `sdk:test`.
6. **Pipelines view.** Admin › Pipelines lists each genre's summarize specs under the genre, as the
   actions already are; prompts, sampling and the transcript template are edited there per spec.

**Cost.** Five core specs where there was one, each a dozen lines of builder call; one new genre
field; one builder; one conformance fixture. The scenes socket loses its hardcoded id.

★7, ★8 closed. ★9 **RULED yes 2026-10-13 (owner "works for me")**: Does the builder also carry the open-scene boundary **triggers** (§4), so a
genre declares "a Sanctum narration closes the scene" in the same place? Recommendation: **yes**,
as `boundaries: [...]` on the builder, read by core's boundary watcher; triggers stay deterministic.

**Reprocess from the lorebook (asked 2026-10-13).** Unchanged for the person: *Process* /
*Reprocess* in History or Scenes still calls `scenes:process`, and the socket resolves the spec,
not the view (standard item 2). It resolves through the scene's session: `scenes.session_id →
sessions.genre → summarize.scene`. A scene whose session is gone cannot be reprocessed today
either (its messages went with it; `scene has no linked messages`), so nothing is lost. Two
details: the scene row records `processed_by_spec_id` for the receipt and the Activity card, and a
genre whose plugin is no longer installed falls back to core's default spec with a note in the
review ("Summarized with the default pipeline: the Lair's is not installed").

## 14. Build plan (owner "Go build", 2026-10-13)

Assumptions: ★1–★6 were never questioned, so they are built on their recommendations (Suggested
default; five `story_clock_*` columns on messages and scenes; keeper may propose the clock, Chat
never; deterministic names stored; `selectedMessageIds` kept as a derived cache this round, retired
later; no-model Compile as default). Scope this round: the **scene** summary moves to the genre
(§13); world/character/history summaries stay on the shared specs.

### Lanes

**A — SDK: the genre-owned summarize-scene** (`../serene-pub-sdk`)
- `sdk/src/genres.ts`: `GenreProps.summarize?: { scene?: string }` (a spec id), validated in
  `genre()` (id format), carried on `GenreDecl.summarize`.
- `contracts`: `core:query/summarize-source@2` (in: scope, request `{ sceneId?, messageIds?,
  channel?, asides?: string[], openedAt?, closedAt?, limit? }`; out: `messages`, `asides`);
  `core:task/render-transcript@1` (in: messages, asides, cast, scene; slot `template`; out:
  `preamble: string`, `units: { messageId, text, tokens }[]`); `core:task/batch-messages@2` (in:
  preamble, units, sampling, params batchTokens/minBatchMessages; out `batches: string[]`).
- `core-catalog/src/shared/summarize/summarizeScene.ts`: `summarizeScene(id, { version, genre,
  channels: { story: 'main', asides?: string[] }, transcript?: string })` → `compile(spec…)`:
  inlet `summarizeRequest` → `source` (@2) → `render` → `batches` (@2) → `drafting` map → `synth`
  → `naming` → `cast` → `save`. Same prompts pool/seed pattern as `summarizeSpec`; drafting prompt
  variant that takes `{{batch}}` as text.
- Shipped Default transcript template (handlebars, three sections `preamble` / `line` / `aside`);
  the Lair's names the Sanctum.
- Core genres declare `summarize.scene`: `core:spec/chat-summarize-scene`, `adventure-`, `guide-`,
  `lair-` (asides `['sanctum']`), `dungeon-crawler-`. Register the specs in the catalogue.
- `conformance`: a summarize-scene fixture (accepts inlet, emits outlet, empty span, unknown
  channel, units carry message ids). `sdk:test` green; NOMENCLATURE §25 ledger rows.

**B — App server: scenes as ranges, resolution by genre** (`src/lib/server`)
- Schema: `scenes` + `channel text not null default 'main'`, `opened_at_message_id`,
  `closed_at_message_id` (null = open), `opened_story_clock_*` ×5, `closed_story_clock_*` ×5,
  `summary_status text` (`none|running|done|failed`), `processed_by_spec_id text`; partial unique
  `(session_id, channel) where closed_at_message_id is null`. `session_messages` + `story_clock_*`
  ×5 (stamp at write from the session's clock). ONE migration via `db:generate`.
- Host bindings: `summarize-source@2` (story rows by range on one lane; aside rows by range,
  prefix-match, attached to the preceding story line, `byLaneThenTime` within a gap),
  `render-transcript@1` (handlebars render → units), `batch-messages@2`.
- `sockets/scenes.ts`: `scenes:open { sessionId, channel, atMessageId }`, `scenes:close { sceneId,
  atMessageId? }`, `scenes:moveBoundary { sceneId, openedAt?|closedAt? }`; filing rule (newest
  entry on the line dated ≤ clock, else create next entry dated at the clock); deterministic name
  `Scene N` (+ ` · <place>` when the genre state names one, + date on day change); cast from
  `sceneCastProposal` into `scene_characters` at open and close; `selectedMessageIds` derived from
  the range at close. `scenes:process` resolves the spec: session → genre → `summarize.scene`,
  fallback `core:spec/summarize-scene`; records `processed_by_spec_id`; `summary_status`.
- Keep `scenes:create` (tick selection) working for the transition. Targeted tests only.

**C — Client: dividers and boundaries** (after A+B)
- Messages widget (`core-catalog` widget + app bridge): scene divider rows at boundaries (swatch,
  name, date, cast faces, line count; open scene reads *since …*), message menu *Start scene here*
  / *End scene here*, divider menu (Remove boundary, Summarize, Open in lorebook). Page requests
  `scene-open`, `scene-close`, `scene-move`. Day marks from message stamps.

**D — Time, modes and the Chronicle** (after A+B)
- Core composer quick action *Time passes…* (stepper → `advance-story-clock`); Chat reply option
  *each reply advances the clock by …*; keeper `clock` proposal (Adventure).
- Session setting `scenes { mode, triggers, summary }` (genre default via `SessionShape`);
  boundary watcher (server): day crossed · time action · place changed → Suggested chip / Automatic
  boundary. Summary modes (On close / On request / Never), *Summarize all (N)*.
- Chronicle: Open scene card (Close scene, Close and summarize), summary state dots.

**Verification** once, after all lanes: `npm run sdk:build` (no owner dev server), `npx tsc
--noEmit -p .`, `npm run check`, `npm test`, `npm run sdk:test`; real-data upgrade check on a
scratch copy. Then docs: `docs/summarization.md`, `docs/sessions.md`, `docs/lorebook-time.md`,
`docs/session-layout.md`; NOMENCLATURE §25.

### 14.1 Build ledger (keep current)

| Lane | State | Notes |
| --- | --- | --- |
| A — SDK | BUILT 2026-10-13 | `summarizeScene` builder + `DEFAULT_TRANSCRIPT_TEMPLATE`; `genre.summarize.scene`; contracts `summarizeSource.v2`, `renderTranscript`, `batchMessages.v2` (combined exports, suite refuses `…V2` names); `S.transcriptUnits`; chat/adventure/guide/lair specs (Dungeon Crawler genre does not exist in core-catalog yet); conformance C34. **Deviation:** cast extraction stays OFF (2026-09-08 ruling in `scene.ts`); session-cast read keyed `roster`. sdk:test 3012/3013, the 1 failure is another lane's renamed `openCharacter.test.ts` name pinned in INTEGRATING §5. |
| B — server | BUILT 2026-10-13 | migration `0113_jittery_maggott`; `scenes/liveScenes.ts`; `scenes:open/close/moveBoundary`; host read `summarize_span`; `runtime/transcript.ts`; messages stamped at insert (`insertLegacy`; importer `insertLegacyMany` does not stamp); partial unique index also requires `opened_at_message_id IS NOT NULL` so tick scenes don't collide. Place suffix stubbed (no genre exposes a place). `summary_status` goes `done` on run, before Review & Save. 11 + 138 targeted tests pass. |
| R — reconcile | BUILT 2026-10-13 | bindings use `C.summarizeSource.v2` / `C.batchMessages.v2`; summarize-batch@1 takes a string `batch` (`buildTranscriptBatchPrompt`, `{{batch}}` substituted; array path unchanged, parity green); attachments port on render-transcript@1, `line.attachments` byte-identical to @1's names; `transcript.ts` imports `DEFAULT_TRANSCRIPT_TEMPLATE` (hand copy gone); pins chat `655ef144e49ad`, adventure `13274d70ec4b86`, guide `d0c7ff2c75ec2`, lair `159e471ba7353a` + 3 registry pins. Open: aside attachments not named; `messageV1.test.ts` fixture lacks the five `storyClock*` fields (tsc error, fix in final pass). |
| C — Messages | BUILT 2026-10-13 | `SceneDivider.svelte`, `sceneMarks.ts`; day marks from `MessageV1.storyClock*`; dossier flag `sceneBoundaries`; message menu Start/End scene here; selection bar *Mark as scene* first, tick path kept as *Scene summary*; request kinds `scene-open/close/move/rename/remove` + `summarize.sceneId`; events gated by `sessionId`; Remove boundary = `scenes:delete` with confirm. Tests: 111 + 584 + 138 app, SDK 194/195 (same `openCharacter` census pin). |
| E — server follow-ups + chip | BUILT 2026-10-13 | No migration. (1) `scenes:moveBoundary { closedAt: null }` reopens (refused while a later range scene is on the lane); `scenes:merge` (`mergeScene`) joins a live scene to the one before on its lane (range extends, later row and its summary go, survivor `summaryStatus` → `none`); divider *Remove boundary* merges when a scene precedes it (`sceneBefore`), else deletes; confirm wording via `removeSceneBody(scene, into)`; divider also gets *Reopen scene*. (2) `scenes:open { closeAt }` opens closed in one tx (run before the open scene leaves it open; captured-by-selection line in the run refuses); *Mark as scene* is one `scene-open { closeAt }`, offered by `runOffer`; its close records to the timeline and runs *On close*. (3) `liveRangeLineIds`: `scenes:scenedMessageIds` and `capturableMessageIds` (create/update) include live ranges, open scene to newest line. (4) `scenes:update`/`scenes:delete`/`scenes:merge` echo `requestId` (reply + refusal); Layout: `scenes:merge:error` in HANDLED_ERROR_EVENTS, update/delete in new `HANDLED_WHEN_ASKED_ERROR_EVENTS` (skipped only when the refusal carries `requestId` — the lorebook's own edit/delete send none and keep their toast). (5) `scenes:list` projects cast (`readSceneCasts`); dossier `ConversationSceneV1.cast` (`ConversationSceneCastV1`, named from the owner's member list); faces read it (open scene adds loaded speakers; guests keep speakers). (6) every move/reopen/merge resets `summaryStatus` to `none` (running kept), text kept; `hasSummary` → divider *Summary out of date*; `scenes:update` with a summary sets `done`/`none`. (7) *End scene here* (`scenes:close` naming a line) → `followEndedScene`: Automatic opens at the following line (`LiveSceneReply.openedScene`), Suggested records cue trigger `endedHere` there, Manual nothing; at the newest line a `pending` cue the watcher binds on the next line. (8) `SceneCueChip.svelte` in the divider slot (*New scene? — reason*, Yes / Not here, owner only); divider *Summarize* hidden under `never`. (9) drag: new host element `sp-drag-handle` (vocabulary **1.4**, app `SpDragHandle.svelte`, rows carry `data-drag-key`) → `scene-move { openedAt }`; keyboard twin *Move start up/down one line*; refusals inline. (10) Chronicle open-scene count already reads `scenes:openScenes` `lineCount` (`historyEntries.ts`, pinned by its test) — no change. (11) `asideAttachments` (second history-attachments@1 over asides; new optional in-port on `render-transcript@1`); Default + Lair `aside` sections render `{{{attachments}}}`. Pins: chat `d6d9936a441b`, adventure `150185e62c94a9`, guide `69c16d2df4303`, lair `d410ef541cb80`, render-transcript `b55f743862a8b`, golden `dda557977b636127`, vocabulary 1.4 shape. Tests: lane E int 11/11, app targeted 99+, SDK targeted all green (see report). Open: Chronicle dot reads stale text as summarized (`summaryStatusOf`); *Summarize all* skips out-of-date scenes. |
| D — time/modes/Chronicle | BUILT 2026-10-13 | Scene settings: `SessionShape.scenes` (SDK `sceneSettings.ts`, validated in `genre()`/`register()`), session override on `sessions.metadata.scenes` (no column), *The story › Scenes* in Edit session. Boundary watcher `scenes/boundaryWatcher.ts` on `message-completed` (in `emitSessionEvent`); time actions noted by an action run's advance-story-clock and a person's step/set. **Scene cues** table, migration `0115_workable_calypso`; sockets `scenes:cues` (gated, page inbox) · `scenes:decideCue` · `scenes:processAll` · `scenes:openScenes`; *On close* from every close. *Time passes…*: `collects.clockStep` (stepper), inlet `clockStep`, `core:task/clock-step@1`; `core:spec/chat-advance-time` + `lair-advance-time`, Adventure's keeper gains the stepper + clock after commit. Chat reply tick (`tick` + `clock`, By 0 = off). Chronicle: Open scene card, summary dots, Summarize, Summarize all (N); request kinds `summarize-scenes`, `decide-scene-cue`; dossier `sceneCues` (chip **not drawn** — lane C's widget). **Not built here:** keeper `clock` proposal (built by lane F; ★3: needs a `clock` proposal kind — `state_proposals.kind` CHECK, decide/describe/retract paths; shape reported), genre-declared trigger keys (★9 — refused for now, shape reported), reply tick in the session's own settings (exposed steps not shown there yet, as sprites). |
| F — keeper clock proposal (★3) | BUILT 2026-10-13 | **Keeper**: `ADVENTURE_KEEPER_SCHEMA.clock` is a required LIST `[{ by, unit }]` (empty = ordinary turn) — not an optional object: the GBNF converter and OpenAI strict mode refuse optional keys. Prompt rows *Adventure state keeper* / *Adventure rest* / *Adventure clock* hold three lists (keeper: only when events took meaningful time, never dialogue; Rest: how long it took; Time passes: leave empty). **Wiring**: a new `clock` in-port on `resolve-state-changes@1` (wired `keeperWrite.json` / `write.json`), NOT a third `path` arm — a preset `path` never reaches an install that already wrote its config. Out: the clock line `{ kind: 'clock', by, unit }` on `changes` + a `clock` out-port. Forward only, `clockStepRefusal` bounds, dry-run `clockMoveProblem` (no book / no present → sentence on `refused`); first entry only. **Seam confirmed**: reviewed → `set-state` propose writes `state_proposals` kind `clock`; trusted → `set-state` apply passes the line over and `keeperStep` (`clock-step@1`) → junction `commit.trusted.keeperClock` → *Advance story clock* (the Time passes outlet). Respond's `keeperStep` has `unless: input.messageId` (a re-driven reply never moves the clock twice). Rest wires it; Time passes never reads the keeper's clock. **Readers**: `decideProposal` → `decideClockProposal` (accept = `advanceSessionStoryClock(tx)` under the state-version lock, never superseded, clock refusal keeps it pending; reject drops); `state:decide` announces an accept (session row, `session-updated` storyClock with `edit` cause, `noteTimeAction` — the one boundary-watcher call, from `sockets/state.ts`); `describeProposal` → *Time passes: 3 hours*; `ProposalRow.kind` `value \| clock`; retract/retake/fork/member-story/table registry are payload-agnostic (no owner → `pendingChangesFor` never picks it) — unchanged. Migration **`0116_little_hiroim`** (CHECK `IN ('value','clock')`). Pins: specs adventure-respond `1185045ca49580`, adventure-rest `1466f141e5dc14`, adventure-advance-time `1b7157728a8132`; registry resolve-state-changes `a842049002c95`; SDK catalog digest `bb89315ed694e3f9`. Tests: app `clockProposal.int.test.ts` 14, adventure int +3, ledgerLines +2; SDK `keeperClock.test.ts` 8. **Not done**: a trusted *reply's* clock move is not a time action (the outlet's rule: action runs only); an accepted clock move writes no ledger line (no attribute row); an accepted move is not taken back by a later swipe. |
| V — verification fixes | BUILT 2026-10-13 | requestId expectations; aside-attachments step labelled *Transcript aside attachments*; **Default transcript** / **Lair transcript** seeded as context-template rows (seed keys `pipeline-context-template:core:transcript-default` / `-lair`, pool default by seed key); reply-tick receipts asserted; live scene with status `none` reads `none` in the Chronicle and is queued by *Summarize all*. Pins: chat `5d20235baeafd`, adventure `1f6c4b2f5ee94d`, guide `9c19042ad22a0`, lair `14ef483fc1f337`. |

**Verification 2026-10-13 (pass 1, before V):** sdk:build ok; tsc 0; check 0 errors/7 warnings; sdk:test 3097/3098 (census pin, fixed); npm test 17531 pass / 9 fail — 5 ours (fixed by V), 4 other sessions' in-flight work (`lorebook_shares` table registry, `characters:get` interest gate, conversations/characters:share socket events, comment ratchet in conversations/characters/schema files).

**Not built, by decision:** genre-declared boundary triggers (★9 shape proposed by lane D, deferred); place-changed trigger fires never until a genre exposes a place; Dungeon Crawler summarize spec (genre not in core-catalog yet); a trusted reply turn's clock move is not a time action; accepted clock moves write no ledger line and a later swipe does not undo them.

**Verification 2026-10-13 (pass 2, final):** npm test 17540 pass / 4 fail, all four other sessions' in-flight work (table registry `lorebook_shares`; `characters:get` interest gate; conversations/characters:share socket events; comment ratchet in conversations/characters/schema files). sdk:test 3097/3098: the one failure was a flaky divider test (the composer's `draft` ask racing the press under test), fixed in `sdk-tests/coreConversationScenes.test.ts` with a `lastAsk` helper that leaves `draft` out; that file now passes 11/11 and 5/5 reruns. tsc 0; check 0 errors.


## 15. Gap fixes (owner "Fix all the gaps", 2026-10-13)

| # | Gap (from §14.1) | Lane |
| --- | --- | --- |
| G1 | ★9 genre-declared boundary triggers (ruled yes; lane D proposed `boundaries: [{ key, label, when }]`) | G — **BUILT 2026-10-13**: `summarizeScene(…, { boundaries })` → `contributes.boundaryTriggers` (SDK `BoundaryTriggerDecl`, `boundaryTriggerFindings`/`boundaryTriggersOf`/`declaredTriggerStates`; predicates `channel`·`narration`·`speaker`·`actionKey`·`stateKey`, AND); watcher reads the session's spec's (`sessionBoundaryTriggers`), cue reason = label; switches in *Scenes* (`triggers[key]`, on by default); the Lair declares `newFloor` (`floor` changed on main). |
| G2 | Place: no genre exposes one, so place-changed never fires and names carry no place | G — **BUILT 2026-10-13**: `SessionShape.scenes.place: { stateKey }` (refused in `genre()` unless a declared slot), Adventure + Lair `location`; `scenePlaceOf` reads the ledger as of the line (`ValueQuery.asOfMessageId`), *place changed* = differs from the line before and from the open scene's opening; names `Scene N · <place>`. No write-site hooks: the ledger read sees every write path. |
| G3 | An open scene's stored cast is written only at open and close | G — **BUILT 2026-10-13**: `refreshOpenSceneCast` on every `message-completed` (all modes), written through the open/close write only when the card participants moved; `scenes:list` pushed when it did. |
| G4 | A trusted keeper clock move on a reply turn is not a time action | H — **BUILT 2026-10-13**: `advance-story-clock@1` takes a literal `cause` in-port (`action` · `keeper` · `tick`, unwired = `action`) set by every core spec and handed to `noteTimeAction({ cause })` (G's rule drops `tick`); no inlet inference; accept → `keeper`, hand move → `person`. |
| G5 | Accepted / applied clock moves write no ledger line, and a swipe or retake does not undo them | H — **BUILT 2026-10-13**: every move is a `state_proposals` clock row (`applied` · `accepted` · `skipped`, migration `0117_fluffy_captain_marvel`), drawn as *Time passes: 3 hours (… → …)*; delete, swipe, regenerate and retake step the clock back by it on `tx` (`state/clockMoves.ts`), a tick kept on swipe/regenerate, refused in words when the calendar cannot place it; Adventure's `keeperStep` now skips only an extend. |
| G6 | Adventure's keeper prompt steps time of day one notch and ignores the player's amount | H — **BUILT 2026-10-13**: `build-keeper-context@1` gains a `clockStep` in-port spelled as `{{clockStep}}` (`3 hours`, `1 day back`); Adventure's Time passes wires `input.clockStep`, and the *Adventure clock* row turns the time of day and weather over that span. |
| G7 | Adventure with no dated present: the clock step halts the run after the keeper's changes landed | H — **BUILT 2026-10-13**: `onRefusal: 'skip'` on Adventure's three clock outlets: nothing moves, the receipt's `skipped` and a ledger line say *This story has no clock yet: set one in the lorebook to track time.*, the keeper's changes stand. |
| G8 | `summary_status` goes `done` when the run produces a summary, before Review & Save; a discarded review leaves `done` with no summary | I — **BUILT 2026-10-13**: new status `review` (no migration, plain text); process `running` → `review`/`failed`, Apply → `done`, discard/dismiss restores `summaryStatusBefore` (regenerate inherits it), cancel as before, boot task `scene-summaries` settles derelict `running`/`review`; divider + Chronicle *Ready to review* open the waiting review; *Summarize all* skips `review`. |
| G9 | Divider and day-mark dates are spelled free-form: the dossier carries no calendar | I — **BUILT 2026-10-13**: `SessionDossierV1.storyCalendar` from `sessions:storyClock` (read per session+book, refreshed by Chronicle reads); dividers, day marks and history markers spelled via `storyDayLabelIn` → `sceneMarks({ dayLabel })`. |
| G10 | No test of the success path where a genre's declared summarize spec is published | I — **BUILT 2026-10-13**: `scenes.summaryReview.int.test.ts` publishes the catalogue (`bootstrapPipelines`) and asserts Chat → `core:spec/chat-summarize-scene`, Lair → `core:spec/lair-summarize-scene` (response, `processed_by_spec_id`, `pipeline_runs.spec_slug`). |
| G11 | Session settings do not draw a spec's `expose.session` steps (reply tick; the same gap as sprites) | I — **BUILT 2026-10-13**: **step settings** (`sessions:stepSettings` / `setStepSetting`, `SessionStepSettings.svelte`), owner-only; reply tick under *The story › Story clock*, sprite picker on a *Step settings* card; plumbing filtered (no model-call step, `params` only, plain controls); session-scope `pipeline_node_overrides`, reset-is-delete. |
| — | Dungeon Crawler summarize spec: folded into the Dungeon Crawler draft (the genre does not exist yet) | next |
| — | ★5 `selectedMessageIds`: kept as the derived cache, not a gap (tick-captured scenes still need it) | — |

### 15.1 Gaps surfaced by lane H (queued for lane J, after G and I)

| # | Gap | Lane |
| --- | --- | --- |
| G12 | Chat's reply tick and Chat's / Lair's Time passes still halt when the story has no clock (G7 covered Adventure only) | J — **BUILT 2026-10-13**: `onRefusal: 'skip'` on chat-respond's tick and `shared/timePasses.ts` (Chat + Lair); every core clock outlet skips (`keeperClock.test.ts` table); pins chat-respond `1ce32d3e6de41a`, chat-advance-time `1397c71709d413`, lair-advance-time `7e1eaa16ea91a`, golden `fdf6db9e0c86f24b`. |
| G13 | Time passes pressed before any message anchors to nothing: no ledger line | J — **BUILT 2026-10-13**: the anchor was already the newest line (a greeting counts — now pinned); with no line at all the row stays unanchored and is drawn as the **ledger head** at the head of the conversation (the ledger already sorted a no-anchor row first; the Chronicle had no ledger): `ledgerHeadLines`, `sessionState().ledgerHead()`, dossier `ConversationStateV1.head`, `MessageStateLedger head` on the empty log / above the first line when `!hasOlder`. Clock rows only. |
| G14 | Swipe / regenerate do not broadcast `state:changed` after their retract (pre-existing for values) | J — **BUILT 2026-10-13**: `retractStateAnchoredTo` returns `changed`; both handlers broadcast `state:changed` to session users after it commits (`sessions.retractAnnounce.int.test.ts`). |
| G15 | A fork copies clock rows but does not recompute the forked session's clock (pre-existing) | J — **BUILT 2026-10-13**: (the branch copied no clock rows either) `copyClockMovesToBranch` carries applied/accepted/skipped clock rows ≤ the fork, re-anchored; `stepBranchClockToFork` steps the branch's clock back by every move after the fork (`stepBackSessionStoryClock`); a parent following its present gives none (`branch.clock.int.test.ts`, both cases). Hand moves since the fork are unrecorded and stay. |
| G16 | A keeper clock suggestion that cannot ride (no clock) is dropped with its reason on the receipt only | J — **BUILT 2026-10-13**: resolve puts a well-formed unrideable ask on `changes` as `{ kind: 'clock', by, unit, skipped }` (never `clock`); `set-state` writes the skipped clock row in either mode (`recordClockMove` `cause: 'keeper'`, `messageId`/`once`), `main.skipped` → `stateMoved` announces. |
| G17 | The transcript preamble's `scene.place` is never filled (the name carries it; §12.1 declares the variable) | J — **BUILT 2026-10-13**: `sceneHeaderOf` fills `place` via `scenePlaceOf` at the opening line (a tick scene's first line); Default (*, at …*) and Lair (*, in …*) preambles already render it; no spec hash moved (request only). |
| G18 | `validate()` does not re-check `contributes.boundaryTriggers` on hand-written spec documents | J — **BUILT 2026-10-13**: `validate()` runs `boundaryTriggerFindings` (the builder's sentences) as document-level findings, law `boundary triggers`; the app's publish (`assertValidates`) refuses one (`store.int.test.ts`, SDK `sceneSettings.test.ts`). |

Lane G decision recorded: no watcher hooks on state writes; every write appends to the ledger, so a place or state-key trigger lands on the next line either way.
| G19 | Step settings read only `sessionPipelines` (reply + enabled actions); event-bound specs (turn order) don't surface their non-plumbing parameters | J — **BUILT 2026-10-13**: `eventBoundSpecs` adds every spec bound to the genre's session events (turn order); same filter, plus rule 3 now refuses `list: true` fields (the envoy list leaked as `string`); turn order offers `pool` (Characters/Personas/Envoys) and `mentioned` (Messages scanned), never `decide.model.advise`. |
| G20 | `boundaryWatcher.genre.int.test.ts(206,46)`: TS2503 Cannot find namespace 'sdk' (tsc + svelte-check) | J — **BUILT 2026-10-13**: already fixed in the tree when lane J started (the line reads `BoundaryTriggerDecl[]` from a type import); tsc 0 and check 0 errors confirm. |

**Verification 2026-10-13 (after §15 gap fixes, final):** sdk:build ok; tsc 0; check 0 errors / 7 warnings; sdk:test 3113/3115 → both fixed after (stale `guides/widgets.md` regenerated; `writes.test.ts` Adventure create pin `2b63bc55e3597`, moved by G2's place declaration); npm test 17608 pass / 4 fail + 1 unhandled error, none ours (table registry `lorebook_shares`; `characters:get` interest gate; conversations/characters:share events; comment ratchet in conversations/schema/media-access files; `document is not defined` from `connectionsList.dom.test`). Preamble no longer repeats a place or date the scene's name already says (`sceneHeaderOf`). G1–G20 BUILT. Remaining by decision: Dungeon Crawler summarize spec (with the DC draft); `selectedMessageIds` kept as the tick-capture cache; no watcher hooks on state writes (lane G).
