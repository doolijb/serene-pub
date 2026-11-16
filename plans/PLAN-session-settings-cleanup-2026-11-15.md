# PLAN (direction given 2026-11-15; lanes not yet briefed) — session settings: clean up, prompts for every owner, two views per section

Facts: `plans/INVENTORY-session-settings-2026-11-15.md` (re-verify file:line in each brief).

## Owner, 2026-11-15, in his words

- "Look at what session settings we have today and look for things that just aren't good. The worst example kept
  running into is turn order, auto-advance and who speaks next is decided by. Scripted as a dropdown option is
  stupid. Each script added to the genre would be an additional entry." "I envision a simple turn order select,
  and a toggle to allow auto-advance. So turn order always runs, but if auto-advance is off, the next response
  doesn't fire."
- "if one configuration setting is good for one genre, and not for the other, then it belongs as an explicitly
  written node, not a helper function." "We need to make sure we are designing our systems in a way where we
  don't need to teleport or hide settings as much as possible to get the options displayed when and where we want
  them."
- After weighing a lift of shared settings to the genre: "most of those changes appear to be mostly genre and
  pipeline settings not SDK logic. Instead, lets focus on just cleaning up the mess and making sure prompt
  choices are easilly accessible for all session owners in each of the sections/pipelines. For advanced
  users/admins, lets also give the sections two views, normal another toggle to display the settings in order of
  operation, sectioned in the card by their nodes. That way an advanced admin editing their session can make sense
  of what they are editing relative to what they also see in the admin."

So: **no lift of shared settings to the genre**; no new SDK logic where a genre or pipeline declaration does it.

Standing rulings that bound this: members never see or touch model plumbing (connections, models, sampling,
loadouts; a **prompt** is not in that list and is the owner's to choose); genres expect, never lock; P1–P6; 0.6
is in users' hands (stored-data changes ship a forward migration or boot pass, second boot changes nothing); one
socket listener per event family; **Show advanced controls** is per user and off by default.

## Lanes (lead's proposal; each = brief → cold review → build → scope review)

### S1. Turn controls (Story, Chat, the Lair, Dungeon Crawler declarations)

- One **Turn order** select per session, shown with the other turn settings (not on a separate advanced card):
  the strategies the genre's turn-order spec offers, each by its own name.
- "The model decides" becomes an entry of that select in Story; the setting **Who speaks next is decided by**
  and the helper flag behind it go.
- The generic **Scripted** entry goes: a genre that orders turns by script places a named strategy step for it,
  which is its own entry. **Manual** goes (it is Auto-advance off).
- **Auto-advance** is a toggle. The order is always prepared and shown; off = nothing fires until Continue.
- ★S1-a How far "on" runs (today: *Next turn* / *Whole round*): lead recommends the genre or preset states it
  (Chat: one reply; Story: the round) and the person gets on / off. Alternative: keep three values.
- Stored values (`genre_fields.autoAdvance`, `turnMode`, session rebinds naming `turn-scripted` / `turn-manual`)
  get a boot pass.

### S2. One store and one writer for a session's pipeline values

- Today `registrations.values` and `pipeline_node_overrides` both hold session-scope values and the Prompt
  picker writes both (`settingsForm.ts` ~731–804; `panel/write.ts` ~480–503; registration values win,
  `world.ts` ~1025 before ~1066). Pick one store per kind of value, one write door, a boot pass that folds the
  loser, and remove the duplicate control.
- `genre_fields` and `rigour`: one write door each (`sessions:updateSetting`); the other writers call it.
- The summaries policy lives once (the routine's mode), `metadata.scenes` reads it.

### S3. Prompt choice on every section, for every session owner

- Each pipeline's section in the session Settings tab shows its **Prompt** choice(s) first, for the session
  owner, whether or not advanced controls are on, with the same control and wording everywhere.
- A section with several model calls shows one Prompt row per call, named as Admin › Pipelines names the agent.
- Model, Sampling, Loadout and On / Off stay administrator-only (standing ruling).
- The settings-form header comment and docs that say prompts never appear there are corrected.

### S4. Two views per section (advanced controls on)

- **Normal** (default): the section as S3 leaves it, grouped by purpose.
- **In order of operation** (a toggle on the section, remembered per user): the same settings listed in the
  order the pipeline runs, under a sub-heading per step, each step named exactly as Admin › Pipelines names it,
  including steps with no settings as plain rows so the sequence reads whole.
- Same values, same write door; only the arrangement differs. No setting exists in one view only.
- ★S4-a the toggle's label and whether it is per section or one switch for the whole tab (lead: one switch for
  the tab, so sections never disagree).

### S5. Locks say what they do

- A locked setting is shown read-only to the session owner with its cause (*Set by the preset* / *Set by the
  genre*), as the docs already say; it is not hidden.
- A lock on a pipeline value is honoured at run time (`values.ts` ~128–134 throws it away today).

### S6. Small repairs

- **How strict**: the server narrows the choices by ruleset as the form and creation do.
- **On revision**: the description names moving the clock back too.
- Docs promise Tone "Before you start"; either a genre declares it or the docs stop saying it (★S6-a; lead: fix
  the docs).
- Dead settings (`sessions.world_attributes`, `session_attribute_picks`, `on_revision_default` on user / system
  settings, `sessions.session_type` writable from the client, the never-produced "Needs a story clock" status):
  remove each with a generated migration, or state why it stays (★S6-b per item).
- Half the tab saves on **Save** and half at once: ★S6-c (lead: everything in the Settings tab saves at once
  with the existing saved mark; name, scenario and tags keep **Save**).

### S7. The **Line** row

Owner, 2026-11-15: "Lets also remove the Line: Main genre setting from our genre or shipped from the SDK". Fact:
it is neither a genre setting nor the SDK's; it is core's hand-built card
(`client/components/sessionForms/SessionLorebookReading.svelte` ~231–260, placed by `EditSessionForm.svelte`
~3406–3427 and `StartSessionForm.svelte`), shown read-only as *Line Main* to everyone with advanced controls off.
**Ruled, 2026-11-15:** "I don't see a use for it. If a modder wants a setting like that, they can add it. I
don't think there's a real use." So the Line row and picker are removed everywhere: the start form and the
session's Settings tab, read-only and editable, whatever lines the lorebook has. What stays: the stored line
(`sessions.lorebook_branch_id`), which a session keeps from how it began (Main, or the line its branch made); the
story clock's own row; the line chip elsewhere in the app. Brief must inventory: every other place a person can
set a session's line, what a new session on a lorebook with several lines starts on, and the docs that describe
the picker (`docs/sessions.md`, `docs/lorebooks.md`, `docs/lorebook-time.md`). No migration.

## Noted, not in this plan

- A preset's values are copied into the session at creation and on switch, so later preset edits do not reach
  running sessions. Changing that is a behaviour change with its own ruling.
- The timeline stance typed in the SDK (owner, 2026-11-15) is its own lane.
- Lifting shared settings to the genre: declined above.

## Order

S2 first (everything else writes through it), then S3 + S4 together (one form), S1, S5, S6.

## Cold review, 2026-11-15: corrections that rule over the lanes above

**S1 (turn controls).**
- Only Story offers a Turn order select today (`genres/story/turnOrder.ts` ~25); Chat, the Lair, the Guide and
  Dungeon Crawler pin one strategy and show none.
- "The model decides" cannot be a swap as the SDK stands: a swap must be the same kind with the same ports and
  slots (`sdk/src/descriptors.ts` ~2562–2586, R28), and the model path is an oracle with model slots
  (`contracts/src/oracles.ts` ~74–111), wired as a junction on `turnMode` (`factories/turnOrder.ts` ~296–318);
  core reads `turnMode` in `host.ts` ~614–624. ★S1-b: (a) relax swap fit so an oracle strategy may fill the slot
  (SDK work), or (b) keep the junction and show its control directly beside the select (two controls).
- Dungeon Crawler pins `C.turnScripted` with its own round script: **Scripted and Manual leave Story's list
  only**; `C.turnScripted` stays published. `turn-manual` is written by the attic
  (`attic/finish.ts` ~39–42) and the import (`utils/sillyTavernParsers.ts` ~384–391): map *manual* to
  Auto-advance off at those sources, keep the handler registered for stored rows, boot pass re-keys, second-boot
  test covers an attic import.
- Published names this removes or changes (the owner's call): `TURN_MODE_FIELD`, `turnOrderSpec({ advise })`,
  `turnStrategyNode({ advise })`, `C.turnManual` from Story's swaps, `AUTO_ADVANCE_FIELD` members `next` /
  `round` (if ★S1-a goes on / off), node keys `decide.*`.

**S2 (one store).** The real defect: two pickers on one address, and the panel and the run disagree on which
wins (panel layers registration values *under* the override, `config/panel/read.ts` ~87–160; the run takes them
*first*, `config/world.ts` ~1025 before ~1071), so the Pipelines card can show a value the run ignores. Survivor:
`registrations.values` (the code already marks overrides "old home", `settingsForm.ts` ~598). Readers and writers
to fold: `sessions/settings.ts` ~139–158, `routines/sessionRoutines.ts` ~78–86, `sockets/loadouts.ts` ~110–120,
`panel/read.ts`, `world.ts`, and the attic writer (`attic/finish.ts` ~278, ~384). Overrides are per spec, values
per registration key: the fold must say where a per-spec value lands. `genre_fields`: not "everything calls
`sessions:updateSetting`" (it serves a viewer's form and refuses other addresses); instead one module-owned
writer (🚧 `writeGenreFields(tx, sessionId, patch)`) that the form door, the preset switch, `authorsNote.ts` and
`resolveVoice.ts` call inside their own transaction.

**S3 (prompts).** A prompt choice already exists twice: the Pipelines card (everyone, but behind advanced
controls) and R54's `expose.promptReach: 'owner'` field (2026-10-21, `settingsForm.ts` ~574, ~739–806). The lane
consolidates them into one Prompt row per model call. ★S3-a: the owner's prompt choice is core's default for
every model call (then `promptReach` is redundant: a published name, the owner's call), or every shipped model
step declares `promptReach` (spec re-pins; plugins must opt in). Keep the hidden-prompt filter
(`pipeline_prompts.hidden`). Correct the form header and refusal text that call prompts plumbing.
**Rulings on both sides (surface to the owner):** memory 2026-10-12 "never propose a member-facing surface for …
prompts, in any form"; owner 2026-10-09 "Pick only"; R54 2026-10-21; owner 2026-11-15 "making sure prompt choices
are easilly accessible for all session owners". The 11-15 words are the latest and name session owners.

**S4 (two views).** Names come from the Canvas's step names (Admin's Configure tab names *agents*, one block per
model call, which is a different list). A junction's branches are shown as labelled alternatives. Settings that
belong to no step (Auto-advance, the genre's own) sit under a **Session-wide** heading in the ordered view. The
order already exists: declarations arrive in spine order (`config/panel/declarations.ts` ~1101–1129); steps with
no settings come from `pipeline_nodes.position`.

**S5 (locks) — ASK FIRST.** Hiding a locked setting from the owner is ruled, not a defect: A10 / R32, 2026-10-20:
"a locked setting shows its value, read-only, to admins, and **nothing to the owner**." The code does that
(`settingsForm.ts` ~644); the docs drifted (`docs/sessions.md` ~448, ~586; `docs/pipelines.md` ~19). Against it,
owner 2026-11-15: "we don't need to teleport or hide settings as much as possible". Either the docs are fixed
(R32 stands) or R32 is reversed. The run-time lock repair stays in either case.

**S6.** `on_revision_default` is read at session creation (`sockets/sessions.ts` ~1525, `sessions/revision.ts`
~71–81) and has no writer: "read, never writable", not dead.

### S8. The Turn line shows all activity; the Composer's Send can be hidden

Owner, 2026-11-15: "in our default layouts, we have the activity/turn indicator right above the composer. This
needs to be updated to show all activity because a lot of background tasks/routines have NO indicator, along with
a stop and reply button for any pipeline/event/routine running in that session. With that, we should also be able
to hide the send/stop button in the composer (with a show toggle in it's settings)."

Facts: the widget is the **Turn line** ("what the last run did and who is next", `docs/session-layout.md` ~48,
~128; one setting, **Who is due next**); routine runs are only listed after the fact in **While you were away**;
**Runs** is administrator-only; the Composer's forms are listed at `docs/session-layout.md` ~137.

Lead's reading (to confirm):
- The Turn line lists **every run in progress in this session**, whatever started it (a reply, an action, an
  event's pipeline, a routine), each by its pipeline's shown name and current status words, each with **Stop**.
- It carries a **Reply** control that fires the next due turn (what Continue does today), so a session can be
  played with the Composer's own button hidden.
- The Composer gains one setting, 🚧 **Show the Send button** (on by default); off hides Send / Stop in every
  Composer form; Enter still sends.
- No model plumbing in the line: names and status words only.

Brief must inventory: what the client is told about runs in progress today (sockets, the session-runs and
turn-order widgets in `core-catalog/src/shared/ui/`), the cancellation path per trigger family, who may stop
what today, how many runs can be in flight at once, and the widget contract for a setting toggle.

★S8-a who may stop a run that is not the reply to their own line (lead: the session's owner and administrators
stop anything; any member stops the reply to their own send, as today). ★S8-b whether a finished background run
stays visible for a moment with what it did (lead: yes, briefly, the way the last run shows today). ★S8-c
"reply": read as the control that fires the next turn; alternative reading "retry" (stop and run again).

### S9. Routine groups: sequential or async (to be defined with the owner)

Owner, 2026-11-15: "Routine groups also need to have a sequential/async setting". Facts: no "routine group"
exists today (no such name in the SDK, NOMENCLATURE or docs); routines are listed flat under **Routines**; firings
queue per session behind every action and event run, one at a time (`INTEGRATING.md` §1i); each routine has
**Allow stacking** and caps. Open: what forms a group, and what *async* frees (each other, or the person's next
turn).
- **Defined, 2026-11-15:** "A routine group would be a set of routines set to fire under the same conditions".
  So a group is derived, not declared: the routines of a session whose trigger (cadence and its options, `when`)
  is the same. Lead's proposal for the rest (unruled): **Sequential** runs the group's routines one after another
  in their listed order (today's behaviour, the default); **Async** starts them side by side; each routine's
  writes stay its own undoable record; the group still finishes before the session's next queued work. The
  genre or preset states the default per group; an administrator changes it in the session's **Routines**. Not
  included: letting a group run while the person's next turn generates.
  Brief must inventory: how "same conditions" is compared (cadence kind + options + `when`), the routine queue
  (`pipelines/routines/`), the per-host model lanes that make side-by-side real, and what two routines writing
  the same entry at once do.
- **Owner, 2026-11-15 (later):** "We can move the routine triggers to the "group" rather than the pipelines." So
  the group is the thing that is declared: it owns the trigger (cadence, its options, the condition) and the
  sequential / async setting, and routines are placed in it. This replaces "derived from equal triggers" above.
  Lead's proposal for what moves (unruled): to the group: the trigger, cadence options, **Allow stacking**, the
  run caps and idle pause, sequential / async; stays on each routine: its place in the group's order, its mode
  (off / how it writes) and its own step settings. Today's `register(cadence, pipeline, opts)`
  (`INTEGRATING.md` §1i; `registrations.cadence_options`, `allow_stacking`, `caps`) becomes a group declaration
  holding routines; stored registrations get a boot pass that makes one group per distinct trigger. A published
  SDK shape changes: the owner's call, given here.
- "Good." (2026-11-15) to the group / routine split above.

### S10. A charter for turn order and Auto-advance (P6)

Owner, 2026-11-15: "the purpose for turn order/auto continue should be properly defined since we currently have
it as an SDK built-in. (Unless you think it should be decoupled): "Turn order and continue determine how the
session responds to a user sending a message, it doesn't determine when routines and custom events fire", (i.e.
if a session continues while the user is away, though we should list the core events that it does
control/block)".

Lead: keep it core's (not decoupled). Core owns the turn-order state and the listener that fires the next turn;
the genre owns the pipeline that prepares the order. Charter to write into NOMENCLATURE and `docs/sessions.md`
with S1, after verifying each line in code:
- **Purpose:** how the session answers a person's message: who replies, in what order, and whether the next
  reply starts by itself.
- **Owns:** the session's turn order (`sessions.turn_order`); firing the next due turn (`message-respond` for
  the head entry) on Continue, Pick, a narrator's turn, or by Auto-advance after `turn-order-changed` (at most
  12 per send); the *your move* notice; the Turn line's "who is next".
- **Does not own:** when routines fire (their group's trigger does); custom events; scene boundaries; read
  aloud; vectorization. A routine takes no turns and never fires one.
- **What it touches indirectly (to state plainly):** each reply it fires lands a line; lines landing are what
  end a turn and a round (`turn-ended`, `round-ended`), so groups triggered by turns or rounds follow from
  replies, however those were started. Groups on idle, real time, story time, a scene or a value do not.
- **What it blocks:** while a reply is being written the session's generation lock is held: a session-level
  action is refused, and routine groups and event pipelines wait in the queue behind it.

**S1, ruled further (owner, 2026-11-15):** "Lets make sure we decouple all the turn order options so genres have
to opt in to the ones they want or add their own. Turn order scripts should be per genre for now."
Lead's reading for the brief:
- No turn-order option is implied. The factory (`core-catalog/src/factories/turnOrder.ts`) stops supplying a
  default strategy; each genre lists the options it offers and which one is its default. Round robin, by user,
  random, narrator replies and the model path are each a separate option a genre names.
- A genre may add its own option: a strategy step it defines, shown in the select by its own name.
- A script-ordered option belongs to the genre that ships it (Dungeon Crawler's round script stays Dungeon
  Crawler's); no shared "Scripted" entry and no cross-genre turn-order script catalogue for now.
- The select shows whenever a genre offers more than one option; a genre offering one shows none.
- Core's silent Auto-advance default (`next` when undeclared, `sessions/autoAdvance.ts` ~196–204) goes: a genre
  states it.

## Ruled, 2026-11-15 (evening): "Yes, I agree with you."

Said in answer to the lead's list of open recommendations and the S1 reading. Lead's reading, stated back to the
owner: all five are ruled as recommended —
1. S5: a locked setting is shown **read-only with its cause** to the session's owner. This **reverses A10 / R32
   (2026-10-20, "nothing to the owner")**.
2. ★S1-b: the SDK's swap-fit rule is relaxed so a model-backed strategy can fill the turn-order slot; "The model
   decides" is one entry of the select.
3. ★S1-a: Auto-advance is on / off; the genre or preset states how far "on" runs.
4. ★S3-a: the session owner's prompt choice is on by default for every model call (`promptReach` becomes
   redundant; a published name: the owner's call, given).
5. ★S8-c: the Turn line's "reply" is the control that fires the next turn.
And the per-genre turn-order table (only Story shows a select at first; behaviour unchanged).

### S11. Running while nobody is playing: one setting

Owner, 2026-11-15: "Allowing routines and events to fire when idle is another session/app wide setting. Show only
when it's detected when a routine/group is added that could fire when idle, with a time limit (that can't exceed
the systems configured, though I think we more or less already have this in place.)"
Facts: caps are min(system, user, registration); real-time routines pause after the idle timeout (three days
unless set lower) and after 12 runs in a row; after a restart they resume only on interaction
(`routines/interaction.ts` ~110–151; `docs/pipelines.md` ~71). Lane: one session setting (🚧 *Keep running while
nobody is playing*, with *for at most ‹time›*, bounded by the system's limit), shown only when the session holds
a group whose trigger can fire with nobody playing (real time, idle, story-time schedule, an event that does not
come from a person's line); the pub-wide limit stays in Admin. Inventory first: what exists already and whether
this is a new setting or the existing idle pause given one clear control.
