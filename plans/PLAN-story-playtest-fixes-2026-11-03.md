# Story playtest fixes — 2026-11-03

**Status: BUILDING the ready-now set (go 2026-11-04). Every §0 and ★ still open; see §Build status.** Source: the owner's 13-item playtest list (Story genre, develop @ 5110ebf8).
Each item was diagnosed read-only from code; no data was opened. "Not verified" lines say what a data check
would settle (§V0). Rulings needed are marked ★ with a recommendation; five items reverse an earlier ruling
and are listed first (§0).

> ⚠ **Before any cleanup by hand:** deleting a history entry **cascade-deletes every scene filed under it**
> (`db/schema.ts:4410-4414`, `scenes.history_entry_id … onDelete cascade`). Don't delete the duplicate history
> entries from item 3 until the fix lands; doing so can silently remove Scene 1 (see item 4b).

## Summary

| # | Item | Verdict | Size | Blocked on ★ |
|---|---|---|---|---|
| 1 | Ask can't be stopped | Bug: Stop never reaches an action run without a row | M | no (★ minor) |
| 2 | No scene at the first message | Gap: no rule opens a first scene | M | ★2a |
| 3 | Duplicate, pre-filled history entries | Two writers: sweep files one every run + scene open files an empty one | S/M → L | **§0-B**, ★3a |
| 4 | Next scene still says "Scene 1" | Follows from 2 (or a cascade delete); naming counts rows, not position | S | no |
| 5 | Scene name beside the speaker | Deliberate badge (polish L1); remove | S | §0-E (FYI) |
| 6 | Back removed several messages | By design (one exchange per press) + 3 latent bugs | S → M | **§0-A** |
| 7 | Narrator auto-turn toggle | Exists as *Narrator asides*, buried and narrow | M | ★7a–c |
| 8 | "Indexing 26 of 27" in the composer, lags | Race on an unscoped reply + trails by one; placement was ruled | S + M | **§0-C** |
| 9 | Lorebook Views counts don't refresh | Counts not re-asked on update/re-list/AI writes | S/M | ★9a |
| 10 | Can't edit cast name/nickname | By canon: a carded member's name is the card's; no way to reach the card | S → M | **§0-D** |
| 11 | Character turn opens "Narrator:" | Chat wire drops the name seed; narrator label never stopped or stripped | S (→ M) | ★11a |
| 12 | Rename to "Character Cards" | Scoped; ~25 labels, ~15 doc lines, ~8 canon rows | M | ★12a–f |
| 13 | "Time passes … not on the clock" | Model's own clock move collides with yours; refusal wording is wrong | M (copy S) | ★13a–c |
| 14 | Ask is posed by the narrator, not your persona | By design: Ask is the narrator's choices form (R-15 worked example) | M | **§0-F**, ★14a–c |
| 15 | Main Messages widget blank after settings change + layout reset | Likely a render error swallowed by the widget worker; resets keep settings/style | M + S | ★15a–b |
| 16 | Can't download/activate entity models | Dead end: the Entities loadout's finder needs a connection that doesn't exist yet | S (after 17) | your error text |
| 17 | Local ONNX connection built in, fixed name | Created by hand today; no built-in rows; naming is free | M (L with fold) | **§0-H**, ★17a–e |
| 18 | Channel / Channel lane fields start blank | Free-text fields whose blank is a real choice, never spelled out | M | ★18a |
| 19 | Messages area artificially narrow | Default **Line width: Column** (76ch ≈ 800px), ruled 10-24 | S | **§0-G** |
| 21 | Audit existing automatic behaviour against P1 (owner 2026-11-04) | List every automatic behaviour, its cause line, and which genre opts into it; anything no genre opts into is switched off | M | — |
| 20 | Search and download models in the sidebar, not a modal | **Get a model** is a dialog over the Models view; the view already has a detail pane | M | ★20a–b |

---

## §0 Earlier rulings these items reverse — which stands?

**A. Back (item 6).** Ruled 2026-10-23: *"introduce a back and forward button. If clicking back, rewind the
history"*; built 2026-10-24 as **one turn = your line and every reply that answered it** (NOMENCLATURE §24,
`docs/sessions.md:234`, pinned by `rewind.int.test.ts:571-597`). Now (2026-11-03): *"Back button removed several
messages, not just the latest one."* ★ Does Back take **one message** per press in Story, or keep the whole exchange?
Recommend **one message** in Story (option A below); Lair/Dungeon Crawler keep the whole turn.

**B. History entries (item 3).** Live scenes, built 2026-10-13 on recommendations: opening a scene files it under a
dated history entry, creating an empty one if none exists (`liveScenes.ts:525-557`). Now: *"should wait until scene
compilation."* ★ Should the entry not exist until compile (L, one migration), or keep the empty dated entry at open
and only stop the sweep's duplicates (S/M)? Recommend **wait until compile** — it is what you asked for and it
removes the "empty entry" class of confusion — accepting the L.

**C. Indexing notice placement (item 8).** Polish parity L1 (2026-10-24) and STYLE-GUIDE §6.21 (line 2075) put the
retrieval notice inline in the composer ("shows once, then collapses to an icon"). Now: *"a really weird place for
it."* ★ Recommend: progress moves to **Activity**; the composer keeps only notices you can act on (*no index* with
the setup link, *stale* with **Re-index**).

**D. Cast member names (item 10).** NOMENCLATURE.md:370: *"A carded member's **name** is still the card's"*, and
`docs/lorebook-cast.md:34`. Now: *"Can't edit character name or nickname in the lorebook."* ★ Recommend keep the
ruling and add a read-only name row with **Edit card** (S). Alternative: a book-only name that overrides the card
(M, reverses the canon line).

**F. Who asks (item 14).** Forms ruled 2026-09-15, built 2026-09-17 (plans/30 U5d, R-15); Adventure's **Ask** was
the worked example and moved to Story unchanged on 2026-10-19: *"the narrator puts a question, with choices, to
one of the cast"* (`core-catalog/src/genres/story/ask.ts:2, 52`). Now (2026-11-03): *"Narrator asked questions
meant for the character to answer, instead of the current persona of the user asking."* ★ Recommend **Ask becomes
your persona's question to a character**; the forms mechanism itself stays (the Lair's Roll uses it), and the
narrator's version survives only if you want it (★14b).

**G. Message width (item 19).** Polish parity ★R1, ruled 2026-10-24 for calm and readability: the Messages
widget's **Line width** defaults to **Column**, *"About 76 characters of story text a line, centred"*
(`widgets.css:133-165`; `widgets.ts:144-162`, *"Never a hidden cap: each is a value a person can see and change"*).
Now (2026-11-03): *"Messages/center area is artificially restricted in width."* ★ Recommend the default becomes
**Full**, with Column and Comfortable still on offer. Alternatively, keep Column and widen it (e.g. 96ch).

**H. Connections the app creates (item 17).**
- **Earlier rulings:**
  - `src/lib/server/db/defaults.ts:607-614`: *"Sampling defaults may be seeded; connection defaults NEVER… a
    connection is a thing only a person can add."*
  - The no-implicit-pickup rule (`capabilityTarget.ts:6`): *"pipelines will not automatically choose a saved
    connection just because it exists."*
  - The ONNX list is fetched only *"when a local ONNX endpoint exists… a boot that reaches out anyway would be a
    network call nobody asked for"* (`localOnnxModels.ts:1103-1105`).
- **Now (2026-11-03):** *"Local onnx connection should be created by default, and name unchangeable."*
- Managed KoboldCPP and audio.cpp rows are already created by the app, so the first ruling already has exceptions.
- ★ Recommend: the app creates the local ONNX rows (the managed precedent), but **never fills a loadout with
  them** (no-implicit-pickup stands). The list fetch is gated on a model on disk, or a loadout naming the row,
  instead of on the row existing.

**E. Scene badge (item 5) — FYI, no question.** Added in polish parity L1 (comment at
`SessionContainer.svelte:735-737`). Your note reverses it; the plan removes it.

---

## Lane S — Scenes and history (items 2, 3, 4, 5)

### Item 2 · No scene opens at the first message
- **Cause (high).** Every core boundary trigger compares a line with the one before it
  (`server/scenes/boundaryWatcher.ts:337` `if (prev) {…}`); with no trigger the watcher returns (`:556`). Nothing
  else opens a first scene (`openScene` is called only from `sockets/scenes.ts` and the watcher's cue/automatic
  paths). The sweep's judged check, with no scene yet, proposes one somewhere in the last 20 lines
  (`:976-1030`), so the opening stays outside any scene. The live-scenes proposal (§3–§4) never specified one.
- **Fix (server).** In `watch()` (`boundaryWatcher.ts:524`): when `prev` is null and the lane has never had a range
  scene, `openScene` at that line with `cause: system`. Record a cue with a new trigger **`opening`**, state
  `placed`, so a removed opening scene is never re-placed. Add `opening` to the head of `TRIGGER_ORDER` (`:115`) and
  words in `shared/sessions/sceneSettings.ts:70` ("the story began"). Seeded greetings already emit
  `message-completed` (`host.ts:7762-7770`), so the greeting opens Scene 1.
- **Tests** (`boundaryWatcher.int.test.ts`; nothing covers a first line today): first line opens Scene 1 under
  Suggested and Automatic; Manual per ★; removed opening scene not re-opened; greeting carries the scene; side
  channel gets nothing.
- **Docs.** `docs/sessions.md` §"Scenes: start and end them" (`:509`) and §"When a new scene begins" (`:513-520`);
  NOMENCLATURE scene-cue row (`:1908`) gains `opening` (+ §25 ledger).
- ★2a Open the first scene under **Suggested** too, not only Automatic? Under Manual? *Recommend: Suggested and
  Automatic yes, Manual no.*
- ★2b Existing sessions: backfill on the next message, or new sessions only? *Recommend new sessions only.*

### Item 3 · Duplicate history entries, filled too early
- **Cause A (high) — the sweep files a new entry every run.** *Look back over the story* runs every 5 turns
  (`core-catalog/src/genres/defaults.ts:234`); its *Summarize the story* duty is on by default
  (`contracts/src/tasks.ts:5264`) and asks for "what happened since the last summary, as a history entry"
  (`genres/story/reckon.ts:157`). The junction (`reckon.ts:483-517`) calls `rememberNote(… entryType:
  historyEntryType)` with no `match`, so `host.ts:10273-10300` inserts a fresh row each run, undated at the clock
  (Year 1 defaults, `server/utils/lorebookEntries.ts:361+`), title dropped.
- **Cause B (high, by design) — opening a scene creates an empty dated entry** (`liveScenes.ts:525-557`).
  Two writers file history in parallel. Checked and *not* causes: open-scene cast refresh (`:764-808`),
  `recordClose`, summarize-scene (stops before save, `sockets/scenes.ts:1280,1615`), the reckoning.
- **Fix.**
  1. **SDK:** remove the summary arm from Story's sweep (`reckon.ts:157`, the junction at `:483-517`, the sweep
     script's summary sorting, `summary` in `sweepDuties`). Scenes own history now. Re-pin spec hashes (registry +
     golden tests).
  2. **If §0-B rules "wait until compile":** make `scenes.history_entry_id` nullable (`db/schema.ts:4410-4414`) —
     one migration via `db:generate`, index above the applied max. Move `fileSceneUnder` from `openScene`
     (`liveScenes.ts:1040`) to `scenes:compile` (`sockets/scenes.ts:989`) and/or close. Update every reader of
     `historyEntryId`: `scenes:list`, the Chronicle, the history marker, compile's scene read, the graph builder.
     Keep the cascade only once the link exists.
  3. **Data:** offer (never auto-run) a cleanup of sweep-written history entries: history type, written by a
     pipeline, Year-1 default date, no scene filed under them. The no-scene condition is what makes it safe.
- **Tests.** `sessions.taskSweep.int.test.ts` has no summary/history test: a sweep run writes no history entry.
  If deferred: opening a scene creates no entry; compile creates and fills it; cleanup skips entries with scenes.
- **Docs.** `docs/genre-story.md:50` (drop *Summarize the story*), `docs/sessions.md:509`, `docs/summarization.md`,
  NOMENCLATURE sweep row (`:199`) and duty list.
- ★3a *Summarize the story*: **retire** (recommended; summarize-scene covers it), default off, or turn into
  "summarize the scene on close"?

### Item 4 · The next scene still says "Scene 1"
- **Cause (medium).** The divider shows the stored name (`sceneMarks.ts:185,212,220`, `SceneDivider.svelte:47`);
  the server names it `Scene ${prior.length + 1}` by counting the lane's scene rows (`liveScenes.ts:675-693`). A
  second open is correctly "Scene 2" (`scenes.live.int.test.ts:220`) and every open path pushes `scenes:list`, so a
  stale page is unlikely. "Scene 1" means no scene row existed yet:
  - **(a) item 2 (most likely):** the opening never had a scene, so your "next" scene was really the first;
  - **(b) the earlier row was gone:** *Remove boundary*, Back (`takeSceneBoundariesAt`, `:1563-1589`), or a
    deleted history entry cascading (a scene can be filed under a sweep-written entry, `liveScenes.ts:512-523`).
  - Latent: counting rows misnumbers when *Mark as scene* inserts an earlier scene, and repeats after a delete.
- **Fix.** Item 2 covers (a). In `sceneNameFor`, number by position: 1 + scenes on the lane that start before
  `at`. Renumber default-named scenes when one is inserted or removed; never touch renamed ones.
- **Tests** (`scenes.live.int.test.ts`): *Mark as scene* before the open scene → "Scene 1", later one renumbers;
  delete first then open → no duplicate number; after item 2, the first accepted cue is "Scene 2".
- **Docs.** `docs/sessions.md:509` — how default numbers are kept.
- ★4a Had you deleted a history entry or removed a boundary before the second scene? (Settles a vs b; §V0.)

### Item 5 · Scene name beside the speaker's name
- **Cause (high, deliberate).** `core-catalog/components/shared/messages/SessionContainer.svelte:742` passes
  `sceneName` to every line of a scene but its first; `SessionMessage.svelte:646-655` draws a film icon, a
  screen-reader "In scene:" and the name cut at 12 characters (`messageLayouts.css:206-211`).
- **Fix (SDK client).** Delete the badge block and the `sceneName` prop (`SessionMessage.svelte:36-40, 59,
  646-655`), stop passing it (`SessionContainer.svelte:742`), drop `messageLayouts.css:201-211`, regenerate
  `serene-pub-sdk/guides/widgets.md` (lists `messages.message-badge-scene`). Keep the row's `--sp-scene` colour and
  `data-scene`.
- **Tests.** SDK conversation test: a line inside a scene has no `messages.message-badge-scene`.
- **Docs.** Rewrite `docs/sessions.md:230`.

---

## Lane T — Turns and the reply prompt (items 7, 11)

### Item 7 · Let the narrator take turns by itself
- **What exists (high).** **Narrator asides** (`narratorInterjections`, boolean, off,
  `core-catalog/src/registry/genres.ts:242-250`) — only in **Edit session › Settings**; no client toggle anywhere.
  It puts the narrator at the head of the order **after the whole cast**, once a round, when someone answered your
  newest line and no narration followed it (`server/pipelines/runtime/speakerRotation.ts:763-823`). It fires by
  itself **only on Auto-advance › Whole round** after an automatic run (`sessions/autoAdvance.ts:191-215`); under
  *Next turn* or after a Continue it waits. Pinned by `sessions.taskVoices.int.test.ts:180-190`.
- **Silent failure.** `fireTurnEntry` routes the aside through `listSessionActions(userId)`
  (`sessions/fireTurn.ts:288-321`); if Narrate isn't enabled for that user it's refused as "action not enabled"
  with no notice. Not verified: a guest-started round likely always hits this (Narrate is owner-only,
  `group-sessions.md:123`).
- **Docs contradict it.** `docs/group-sessions.md:110`: a Narrator Response "never happens by itself".
- **Fix.**
  1. **SDK:** `narratorInterjections` becomes an enum `off · every round · every 2nd round · every 3rd round`, plus a
     position field `after the cast` (today) / `before the cast`. `UNPROMPTED_MODES_SCRIPT` maps old `true` →
     every round.
  2. **Server:** `unpromptedEntries` takes `{every, position}` (cadence = your lines on `main` since the newest
     narrator response ≥ `every`). Gate Narrate as the **session owner** for `via:'unprompted'`, and write a refusal
     to the receipt and Activity instead of dropping it.
  3. **Client:** a **"Narrator joins the round"** control on `TurnPicker.svelte`'s narrator row and the Turn order
     widget, writing the same setting (one source of truth). Owner-only.
- **Tests.** `speakerRotation.unprompted.test.ts` (narrator-only, cadence N, before-cast);
  `sessions.taskVoices.int.test.ts` (Next turn waits, Off waits, guest-started round); DOM test for the toggle.
- **Naming.** Not "narrator seat" — *seat* already means player/character/widget seat (R1). Keep "the narrator's
  turn" (`via:'unprompted'`); update NOMENCLATURE's *unprompted turn* row (`:2970`) + §25. Fix `group-sessions.md:110`
  and `genre-story.md:62` ("Round" → the UI's "Whole round").
- ★7a Position: after the cast (recommended default), before, or both offered?
- ★7b Cadence: every N **rounds** (recommended) or every N turns?
- ★7c Under **Next turn**, should the narrator also speak after the character (two replies per send)?
  *Recommend no — Next turn means one reply.*

### Item 11 · A character's turn opens with "Narrator:"
- **Cause (high in code; medium that it's your wire).**
  1. Narration lines go into history as **assistant** turns labelled `Narrator: …`
     (`pipelines/prompt/contentProcessors.ts:195-198`). With asides on, the narrator is usually the newest
     assistant line before a character's turn — item 7 makes this worse.
  2. On the **chat wire** (the default, `connectionAdapters/wireMode.ts:108`) the `Aria:` seed is dropped
     (`pipelines/prompt/assemble.ts:946-952`, `labelSeed:"drop"`, the B2 cache-prefix change); the model only gets
     `[Your turn, Aria]` on the last user turn (`shared/utils/parseSplitChatPrompt.ts:245-261, 293-302`) and copies
     the newest assistant line's format. Text completion keeps an open `Aria:` prefill (`prompt/messages.ts:256-273`).
  3. The narrator's name is **never a stop and never stripped** in Story: `nonCastLabelsFor`
     (`runtime/dispatch.ts:464-484`) returns only the player label and declared envoys. So `replyView` keeps a
     leading `Narrator:` (`messages/replyView.ts:81-88`), `trimAtSpeakerBoundary` never cuts it
     (`connections/stops.ts:423-427`), and a runaway `\nNarrator:` isn't stopped.
  4. Latent: `prompt/endOnUserTurn.ts:90` prefers `speakerOf(end)` over `seedLabel`.
- **Fix (server).**
  1. `nonCastLabelsFor` adds the session narrator's name (`narratorNameFor`, `runtime/host.ts:672`) and distinct
     `metadata.narratorName` values from history. `ownLabels` already exempts the narrator's own turn
     (`stops.ts:241-244`). Gives a stop on `\nNarrator:` and strips a leading label.
  2. `replyView` re-anchor rule per ★11a.
  3. `endOnUserTurn.ts:90` → `seedLabel ?? speakerOf(end)`.
- **Tests.** `stops.test.ts` (narrator label is a stop, except on a narrate turn); `replyView.test.ts`
  (`"Narrator: wind.\n\nAria: Hi"` → ruled result); `endOnUserTurn.test.ts`; int test that `nonCastLabelsFor`
  returns a renamed narrator for a Story session.
- **Docs.** NOMENCLATURE non-cast labels / `strayLabels` row covers the narrator; one line in `docs/connections.md`.
- ★11a When a character's reply opens with narration: **keep the text, drop both labels** (recommended — narration
  inside a character's line is normal in Story), drop the narration, or split it into its own narration row?
- ★11b Restore a name prefill on chat connections that honour a trailing assistant turn (Ollama `/api/chat`,
  Anthropic), giving up B2's cache prefix on those turns? *Recommend: not now; ship 1–3, then re-test.*

---

## Lane A — Actions and the story clock (items 1, 13, 14)

### Item 1 · Ask can't be stopped
- **Cause (high).**
  1. Story's Ask (`core-catalog/src/genres/story/ask.ts`) calls the model (`generateJson`, *Posing a question*)
     before its `createMessage`, so the run never has a live row (`runtime/liveRow.ts:340`).
  2. It runs as kind `"action"` (`fireAction.ts:930-938`). The client draws a **waiting row** (id −1,
     `metadata.pendingReplyRun = runId`, `pendingReply.ts:97-130`), which shows the Stop buttons.
  3. Those Stops send `sessionMessages:cancel {id: -1}` (`turnFlow.svelte.ts:225-231`,
     `messageControls.svelte.ts:165-168`). `runRegistry.cancelSession` stops only a run whose live row was named,
     or a `kind === "reply"` run with no row (`runRegistry.ts:365-367`). An action run is skipped, yet the handler
     still answers "Cancelled 1 generating message(s)".
  4. The one Stop that works (the progress card's X, `pipelines:cancelRun`) is hidden once a waiting row exists
     (`SessionHostViews.svelte:467-473`, `RunProgressCard.svelte:304`, the 10-18 "four Stops" fix).
  - Same gap: **Rest** (`keeperAction.ts:263-271`), **Image**, and rules actions shaped the same way. Narrate and
    Side character open their row first, so they stop. Not verified: **Look** (streams, `look.ts:228-241`).
- **Fix (server + client, no SDK).** Add `runId?` to `Sockets.SessionMessages.Cancel.Params`
  (`shared/sockets/types.ts:7558`). When the Stop target is a waiting row, the client sends its `pendingReplyRun`
  (`handleAbortMessage`, `handleAbortLastMessage`, the `stop` verb in `pressRouting.svelte.ts:240-256`). Server:
  `runRegistry.cancelRunInSession(sessionId, runId, by)` — only if `handle.sessionId` matches and it isn't
  `lineBound`, through `stop()` (one-source rule). Report success only when something stopped. Keep
  `cancelSession`'s row scoping (`runRegistry.test.ts:329` needs an image render to survive a Stop on another reply).
- **Tests.** `runRegistry.test.ts` (named run with no row stops; another session's doesn't; unnamed render
  continues); int test `sessionMessages:cancel {runId}` on an Ask-shaped action → `stopped`, no message saved;
  `pendingReply.test.ts` (waiting row's stop target is its runId).
- **Docs.** `docs/sessions.md:56, :129` (Stop covers actions on their way); one line in `genre-story.md` Actions.
- ★1a Who may stop someone else's Ask/Rest/Image? *Recommend: the person who pressed it and the session owner.*

### Item 13 · "Time passes: 4 hours … · Time passes: 3 hours, not on the clock…"
- **Where the 3 hours came from (medium).** Story's Time passes is a single move (`core-catalog/src/shared/timePasses.ts`,
  `cause: 'action'`). The likely second mover is **Note what changed** (`shared/reckoning.ts:840-866`,
  `cause: 'keeper'`, `onRefusal: 'skip'`), whose model guessed 3 hours. The composer only refuses a press while a
  *reply* runs (`sockets/sessions.ts:2560-2565`), so your press can land while the previous round's reckoning is
  still thinking; its move then starts from 23:00. Not verified: the `state_proposals` clock row's
  `payload.cause` (`keeper` vs `tick`) — §V0.
- **Why refused (high).** The clock has a year and a time but no month/day. `advanceStoryTime` lets hours pile up,
  then refuses the first step past midnight with *"The clock stands at Year 1, 23:00, with no day to count days
  from."* (`serene-pub-sdk/sdk/src/storyTime.ts:599`) — talking about days when hours were asked.
- **Why it reads as nonsense (high).** Every skipped move prints `${head}, not on the clock. ${reason}`
  (`shared/state/ledgerLines.ts:527`); "not on the clock" was coined for the *no clock yet* case (G7), and the line
  ignores `cause`, so the model's guess looks like your own press.
- **Fix.**
  - **A (server, behaviour):** your press wins. In the advance-story-clock outlet (`host.ts` ~8985), drop a
    `keeper` move when an applied `action` move landed in that session after the keeper run started
    (`RunHandle.startedAt`). No ledger row; a note on the receipt.
  - **B (server + shared, data):** store why a move was skipped — `reason: 'no-clock' | 'refused'` on
    `ClockMovePayload` and `LedgerClockMove`, instead of string matching (`clockMoves.ts:89-96`).
  - **C (copy, STYLE-GUIDE §10):** keep "not on the clock" only for `no-clock`; otherwise *Time passes: 3 hours,
    not moved. {reason}*; for `cause: 'keeper'` name the source (*Note what changed suggested 3 hours, not
    moved…*) or hide it per ★13b. SDK `storyTime.ts:599` for an hour/minute step: *The clock has no date at
    Year 1, 23:00, so it can't run past midnight.*; for a days step: *The clock has no day at Year 1, so it
    can't count days.*
- **Tests.** SDK `sdk-tests` storyTime (hour step past midnight, dayless clock → new sentence);
  `ledgerLines.clockNote.test.ts` (no-clock/refused heads, keeper wording); host/`clockMoves.int.test.ts` (action
  then keeper in one round → keeper dropped); `sessions.timePasses.int.test.ts` (same in Story).
- **Docs.** `docs/lorebook-time.md:114`; `docs/sessions.md:191` is stale (says Story's Time passes waits for a
  state-keeper; it hasn't had one since 2026-10-19); NOMENCLATURE `:1930`, `:1935`.
- ★13a After a manual Time passes, the model's move is: **dropped** (recommended), added on top, or filed for review?
- ★13b A keeper's refused guess: show in the conversation, or **receipt only** (recommended)?
- ★13c A dayless clock crossing midnight: refuse (today), or **start counting days** (Day 1 → Day 2) the first time
  hours cross it (recommended)?

### Item 14 · The narrator asks, not your persona
- **Cause (high, by design).** Story's Ask (`core-catalog/src/genres/story/ask.ts`) collects no text: the inlet is
  read only for its scope (`:88-99`), so anything in the composer is ignored. The model gets the narrator's context
  (`buildNarratorContext`, `:107-113`) and writes `{ addressee, question, options }` (`STORY_ASK_SCHEMA`, `:30-48`).
  It is saved as **narration** (`createMessage { narration: true }`, `:181-185`), carrying a choices block addressed
  to a cast member. An AI-portrayed addressee answers by picking an option through the answer pipeline, posted as
  the option's label (`answer.ts:16-22, 58-61`). So the narrator asks, the character picks a short answer, and your
  persona isn't involved.
- **What already exists to fix it.**
  - `create-message`'s `role: 'user'` with `speaker` saves **a person's own message**: the presser's persona
    (`character:<id>`), their seat, or themselves. The host refuses a persona that isn't theirs. It fires
    `message-completed` under the person's cause, so turn order and auto-advance answer it as a send
    (`contracts/src/outlets.ts:261-272`, owner ruling 2026-10-15).
  - The action inlet carries `presser` as a participant reference (`contracts/src/inlets.ts:89, 143`).
  - Actions can collect composer text: Narrate's `collects.text`, *What should happen next?*
    (`story/narrate.ts:175-176, 240`).
  - The **mentioned** orderer moves characters named in your text to the front of the turn order
    (`speakerRotation.ts:609-658`). Not verified: whether Story's turn order uses it.
- **Fix (SDK spec, mostly).** Re-voice `story-ask`:
  1. `collects.text`, optional (*What do you ask?*).
  2. With text, save it verbatim as `role: 'user'`, `speaker: $.input.presser`. No model call.
  3. Without text, the model drafts the question **in your persona's voice** (a persona context, not
     `buildNarratorContext`), then saves it the same way.
  4. The addressee answers per ★14a. Free answer: no block; the turn order puts the addressee next. If Story's
     orderer doesn't use mentioned-first, the row names the addressee for the orderer to read. Choices: keep the
     block, addressed as today.
  5. New label and description, e.g. *"Ask a character a question, as yourself."*
  6. If ★14b keeps the narrator's version, it moves to its own action (e.g. **Offer a choice**), off the quick row.
     **Answer** stays with whichever action still writes a choices block.
- **Overlap with item 1.** With text there's no model call, so there's nothing to stop. The drafting path still
  needs item 1's fix.
- **Tests.**
  - SDK: `story-ask` spec/golden re-pins.
  - Int:
    - Ask with text saves a user row as the presser's persona, and the addressee replies next.
    - Ask with empty text drafts in the persona's voice.
    - A guest's Ask is voiced as the guest's persona.
    - A persona that isn't the presser's is refused.
    - Under Auto-advance, the reply is answered like a send.
- **Docs.** `docs/genre-story.md:68` (Ask/Answer); `docs/sessions.md:72` (*Form answers*), `:103`, `:169`. The
  NOMENCLATURE **form** row (`:483`) still names Adventure's Ask/Answer as the worked form; point it at what
  remains, and add a §25 ledger row.
- ★14a Does the character **answer freely** as their next turn (recommended), or pick from 2–4 choices as today?
- ★14b Keep the narrator's question-with-choices as a separate action (*Offer a choice*), or retire it from Story?
  *Recommend keep it, off the quick row; it's the only place Story uses forms.*
- ★14c With an empty composer, should the model draft your persona's question (recommended), or should Ask
  require text?

---

## Lane H — Back (item 6)

- **Cause (high): by design.** Back takes "the newest person's line and every row after it"
  (`server/sessions/rewind.ts:8-19`, applied `:258-269`, start from `replayStoryLane`'s last person line,
  `pipelines/routines/moments.ts:214-221`), plus each run's rows on other channels (`:343-352`). In Story one
  exchange is often 3–6 rows (you → A → B → narrator → note line), and Back takes your own line too. The button
  says **"Back one turn"** (`Header.svelte:117-118, 304`) while Story's docs say *every line is a turn*
  (`genre-story.md:56`, R51 in `moments.ts:15`) — so the wording itself promises one message. No count, no preview.
- **Latent bugs (fix regardless, S).**
  1. **Double press:** `rewindPresses` (`requests/rewindTurn.ts:30-35`) has no in-flight guard; a fast double
     click takes two exchanges (Forward would then say "2 turns ahead").
  2. **Speakers counted, not people:** the "table of players" rule (`rewind.ts:263-265`) counts distinct speaker
     keys; one person switching persona mid-round (or lines with/without a persona) makes the round span several
     of their lines. Medium-low confidence it bit you.
  3. **Run sweep too wide:** `unitRuns` (`rewind.ts:413-427`) doesn't filter `action='created'` and has no lower
     id bound.
- **Fix.**
  - Always: (1) pending flag on `rewindPresses`, cleared on `sessions:rewindTurn`/error; (2) add `userId` to
    `ReplayedLine` (`moments.ts:224, 230-237`) and count people; (3) filter `unitRuns` to `created` or bound by
    `id >= firstId`; (4) `backTakes: {count, names[]}` on `RewindState` (`shared/sessions/rewind.ts:37-43`), filled
    in `rewindStateOf`, shown in `Header.svelte` and `FullscreenExit.svelte` — *"Back: your line and 3 replies
    (Ash, Birch, the narrator)"*. May touch the SDK's `ConversationRewindV1` / `rewindStripState` (pin bump).
  - Per §0-A:
    - **A. One message per press (M, recommended for Story).** Genre declaration `history.back: 'line' | 'turn'`
      beside `history.settle`. Story `'line'`; Lair and Dungeon Crawler `'turn'` (planned turns can't split). In
      `buildTurnUnit`, `'line'` starts at the newest replayed line; trailing routine rows (Time passes, notes) and
      its run's yield go with it. Retraction/retally code unchanged. ⋯ *Regenerate the last turn* stays turn-wide.
    - B. Two steps (S-M): first press takes the replies, the next takes your line.
    - C. Keep the exchange (S): ship (4) and relabel *"Back one exchange"*.
- **Tests** (`rewind.int.test.ts`): persona switch mid-round takes only the newest exchange; a Continue chain
  U R1 R2 R3 → `'line'` takes R3, `'turn'` takes all four; routine row after a reply goes with it; an `updated`-only
  run doesn't widen the unit. `rewindStateOf.backTakes` equals `rewindUnitIds`. `rewindTurn.test.ts`: double press
  sends one emit. Header DOM test for the count.
- **Docs.** `docs/sessions.md:232-249`; `genre-story.md:56`; NOMENCLATURE §24 (unit + `history.back`, §25);
  `docs/genres.md` / `pipelines.md:91` for the declaration; release note.
- ★6a (if A) Should trailing routine lines (Time passes, notes) go with the message? *Recommend yes.*
- ★6b Genre-fixed, or a preset/session setting? *Recommend genre-fixed (like `history.settle`).*

---

## Lane L — Lorebooks (items 8, 9, 10)

### Item 8 · "Indexing 26 of 27 lorebook entries" in the composer, lagging
- **Where.** `ragNoticeSentence` (`client/components/sessionPage/ragNotice.ts:61-63`), drawn by `RagNotice.svelte`
  as the `retrieval-notice` host view (`SessionHostViews.svelte:170, 478-485`). Placement is ruled (§0-C).
- **Lag (high, from code).**
  1. **Race:** each `fetchStatus()` (`RagNotice.svelte:70-81`) subscribes to the bare
     `vectorization:checkRagStatus` key; the reply carries no `sessionId` (`sockets/vectorization.ts:352-476`), and
     the interest registry hands a reply to every subscriber (`interest.svelte.ts:206-212`). The first reply to
     land settles every pending fetch; the newer 27/27 reply finds nobody — stuck on 26/27 until the message count
     changes.
  2. **Trails by one:** the lane broadcasts `running` *before* each item (`indexing/lane.ts:903`); the
     after-item `itemUpdated` (`:962`) isn't listened to.
  3. **Non-admins get nothing live:** `vectorization:progress` is admin-only (`sockets/vectorization.ts:636-640`).
  4. One unthrottled ~5-query status check per item (makes 1 likelier). 5. Cross-tab crosstalk (no scope key).
- **Fix.**
  - Correctness (S): `sessionId` + `lorebookId` on `CheckRagStatus.Response`, event in `SCOPED_EVENTS`
    (`shared/sockets/interest.ts:~243`); one standing scoped interest in RagNotice with single-flight `fetchStatus`
    (dirty flag → re-ask once); refetch on scoped `vectorization:itemUpdated` and on `progress` `idle`; trailing
    ~500 ms throttle.
  - Placement (M, per §0-C): progress becomes an owner-scoped **Activity** card ("Indexing ‹book› · 26 of 27",
    SpProgress; new activity kind fed by the lane, via `activityStore` in `server/notifications/activity.ts`).
    Composer keeps only `none` (setup link) and `stale` (**Re-index**). Optional readout in Book settings → *What
    this book holds*.
- **Tests.** Pure single-flight/coalesce; `ragNotice.dom.test.ts` (out-of-order replies end on newest; other
  session's reply ignored; `itemUpdated` refetches); server int test (reply carries `sessionId`); Activity card test.
- **Docs.** `docs/embeddings-and-rag.md:151-159`; STYLE-GUIDE §6.21 (line 2075) + the L1 ledger row.
- ★8a Should non-admin book owners see indexing progress? *Recommend yes, for their own books.*

### Item 9 · Views counts don't update
- **What "Views" is.** The scope list in `LoreRail.svelte:120-128` (Everything, Cast, World lore, History,
  Scenes, Places, Items) with counts from `railScopes(counts)` (`LorebooksWorkspace.svelte:1236`). Reactivity is
  fine (whole-record `$state` replace).
- **Cause (high for archive, medium for the rest).** Counts are re-asked only on create/delete/scene writes/cast
  removal (callers at `:1899, 2010, 2034, 2091, 2103, 2131, 2427`). Missed:
  1. **Updates:** `handleEntryUpdated` (`:2013-2022`) — archive/unarchive (`EntryWorkspace.svelte:1337`; server
     count excludes archived, `sockets/entries.ts:1818`), type change (row also stays in the old type's list), move
     to another line.
  2. **Re-list cascades:** `handleEntriesList` (`:1961`) — amendments (`amendments.ts:1322`), graph merges
     (`narrativeGraph.ts:3392`), settle-imprint (`entries.ts:2072`), shared-book readers (`relayToBookReaders`).
  3. **AI-written lore:** pipeline lore writes emit no `entries:*` (`runtime/host.ts:~10275`,
     `scenes/liveScenes.ts:542`, `state/write.ts:898`) — these don't appear in an open book's *list* either.
  4. Minor: `entries:counts` reply has no `branchId`; a late reply for the line you left overwrites.
- **Fix.** Coalesced `refreshCounts()` from `handleEntryUpdated` and `handleEntriesList`; drop the row from the
  old type's list on type change; echo `branchId` and ignore stale replies; server: after a pipeline lore write
  commits, `relistEntries` (lazy, free with no interested tab).
- **Tests.** Workspace DOM test (by `loreRail.dom.test.ts`): `entries:update {archived:true}` re-asks counts; a
  burst of `entries:list` re-asks once; stale-branch reply ignored. Int test: a pipeline lore write reaches an
  interested tab.
- **Docs.** None (`docs/lorebooks.md:104` already promises live counts).
- ★9a AI-written lore appears live in an open book (list and counts)? *Recommend yes.*

### Item 10 · Can't edit a cast member's name or nickname
- **Cause (high): by canon (§0-D), with no way to the card.** `CastMemberForm.svelte:690` hides Name when
  `member.linked`; the shown name is the card's nickname → name (`castPool.ts:110-113, 128-129`); sync overwrites
  it (`server/utils/characterBindingSync.ts:55-60, 115`). Name isn't a retold field (`shared/lorebooks/retold.ts:17-25`).
  The *Character card* block (`:996-1029`) offers only Change and Unlink; aliases stay editable.
- **Fix (S).** For a linked member: read-only *"Name: ‹name› (nickname ‹nick›) · from the character card"*, plus
  **Edit card** (`panelsCtx.digest.characterId = id; panelsCtx.openView("characters", {toggle:false})`, as in
  `LibraryView.svelte:390`); for a card you don't own, **Open card** (`digest.viewCharacterId`) — needs `userId`
  added to the bindingList projection (shape not verified).
  If §0-D rules a book-only name (M): add `name` (and nickname) to retold fields, change the sync to respect an
  override, update NOMENCLATURE:370 and `lorebook-cast.md:34`.
- **Tests.** `CastMemberForm` DOM: linked member shows read-only name + Edit card, which sets `digest.characterId`
  and opens the view; a member with no card still shows the input.
- **Docs.** `docs/lorebook-cast.md:34` (Edit card).

---

## Lane W — Session layout (items 15, 18, 19)

### Item 15 · The main Messages widget shows nothing after a settings change and a layout reset
- **Symptom.** You changed Messages settings (Presentation among them), then pressed **Reset to genre default
  layout**. The main area went empty: no log, no composer, no chrome, no console errors noticed. The widget's own
  **Reset** didn't help. A second Messages copy added to the side draws normally.
- **What the resets actually do (high).**
  - **Reset to genre default** runs `startFrom(genreDefault.id)` (`SessionLayoutEditor.svelte:263`) →
    `sessions:panelLayout:startFrom` (`sessions.ts:3997-4027`) → `copyLayoutIntoSession`
    (`server/db/layoutPresets.ts:759-896`). It replaces the arrangement but keeps panel `p1` and widget id
    `messages`.
  - It replaces your settings only for widgets the layout brings settings for (`:855-894`). Story's default
    (`core-catalog/src/registry/layouts.ts:52-59`) brings none, so your `messages` settings survive.
  - It merges style pins (`:821-828`), so a style pinned on `messages` survives as well.
  - This is the intended rule (`sessions.layoutCopy.int.test.ts:395`). Only **Start from scratch** clears
    everything.
  - The widget's **Reset** clears its settings only, never its style (`WidgetSettingsPanel.svelte:114`).
- **Why the main copy stays blank (medium, not reproduced).**
  - **(i) Likeliest: a render error swallowed by the widget worker.**
    - The conversation mounts once and stays mounted (`SessionLayoutRender.svelte:341`). It remounts only when
      its module or `pageIds` change (`RemoteWidget.svelte:218`). Neither a settings change nor either reset
      remounts it.
    - The worker catches errors only at mount and in handlers (`component-client/src/workerRuntime.ts:594-630`).
      *This widget stopped* shows only for a failed mount or a refused change (`ComponentMount.svelte:316-340`).
    - So a throw while switching Presentation (the Folio/Rows branch, `SessionContainer.svelte:440`) or the
      composer leaves the widget blank, with nothing on screen.
    - A page reload remounts it fresh. If a reload doesn't fix it, (i) is ruled out.
  - **(ii) A style pinned on `messages`.** Neither reset touches it. The built-in styles don't hide parts of the
    widget, so this matters only for a custom style.
  - **(iii) Not verified: a race.** Every settings write also re-sends the whole arrangement
    (`sessionLayoutData.svelte.ts:100-106`), and a layout copy doesn't cancel those writes. A late settings write
    could put the old arrangement back over the reset.
  - **Ruled out.**
    - Hidden halves and the channel/lane setting: the widget's Reset cleared them. An unknown channel still draws
      an empty-log message (`SessionContainer.svelte:592-604`).
    - An unresolvable id: `messages` always draws (`sessionLayoutModel.svelte.ts:319-336`).
    - A shell mode hiding the middle panel (`sessionLayoutModel.svelte.ts:631-651`).
    - The Story default arrangement itself: `p1` in the middle holds `messages`.
    - Any other *Presentation* setting: none exists.
- **Recovery, nothing lost.**
  1. Reload the page.
  2. If it's still blank: in the editor's **Arrange** tab, drag the working side copy's tab (**Messages · 2**)
     into the middle panel, remove the old **Messages** tab, then **Done**.
     - Add the new tab before removing the old one: the middle panel can't be left empty.
     - Don't re-add plain **Messages** from the tray. It comes back as `messages`, with the old style pin.
  3. Stronger, but it resets every widget's settings and styles in this session: **Layouts › Start from
     scratch**, then **Reset to genre default layout**.
- **Fix.**
  1. **SDK:** wrap `MessagesWidget` (`core-catalog/components/shared/messages/Messages.svelte`) in
     `<svelte:boundary>`, which shows a visible *This widget stopped* and reports the error over the port as
     fatal. Catch worker-level `error`/`unhandledrejection` in `workerRuntime.ts`. Apply the same boundary to every
     core widget host, not only Messages.
  2. **Client:** add a **Reload widget** button to the stopped overlay that bumps a remount key
     (`ComponentMount.svelte`/`RemoteWidget.svelte`). Remount when a layout copy lands, keyed on
     `manager.seedCount`.
  3. **Find the actual throw:** an SDK test that switches a live widget Rows→Folio, classic→Page line, and
     Show messages/Show composer on and off, then asserts the log and composer are still there.
  4. **Race:** widget-settings writes stop carrying the arrangement (server accepts a settings-only write), or are
     cancelled while a copy is pending.
  5. Per ★15a/b: Reset to genre default clears your settings and style pins for the widgets it places; a widget's
     Reset clears its style pin too. Confirm wording says so.
- **Tests.**
  - `sdk-tests/coreConversationComponent.test.ts`: the live switches above; the boundary draws its message when a
    render throws.
  - `RemoteWidget`: remounts on `seedCount`.
  - `sessions.layoutCopy.int.test.ts`: the reset rule as ruled. `startFromPane.dom.test.svelte.ts`: confirm
    wording. `widgetSettingsPanel.dom.test.ts`: what Reset clears.
  - A settings write during a pending copy doesn't restore the old arrangement.
- **Docs** (`docs/session-layout.md`).
  - *Copy a layout in* and *Where settings are kept* (`:191-203, 246-256`): what a reset keeps.
  - *Settings* (`:236`): what a widget's Reset clears.
  - A *widget shows nothing* tip: reload, then **Reload widget**.
- ★15a Should **Reset to genre default layout** also clear your own settings and styles for the widgets it places?
  *Recommend yes: "reset" should mean back to how the genre ships it. **Copy a layout in** keeps today's merge.*
- ★15b Should a widget's **Reset** also clear its style? *Recommend no; give Style its own reset beside it.*

### Item 18 · The Channel and Channel lane settings should say their default
- **Current (high).** Both are free-text string fields with an empty default
  (`core-catalog/src/registry/widgets.ts:232-258`, Messages `channel` and `channelLane`). Empty is a real choice,
  not a missing value:
  - **Channel** empty means the **primary log**: every channel no other Messages widget shows, as tabs when
    there are two or more.
  - **Channel lane** empty means the whole channel.
  - The default channel's slug is **`main`**. Its first lane is the bare slug (`main` = `main:1`; NOMENCLATURE
    `:411`).
- **So prefilling the literal values would change behaviour.** Typing `main` pins the copy to the main channel
  alone, so other channels (the Lair's Sanctum, a phone thread, the dice `table`) drop off it. Typing `1` shows one
  lane instead of the whole channel.
- **Precedent for saying "unset" out loud.** Presentation's **Follow the channel** (`auto`, `widgets.ts:176-195`)
  is a named choice standing for "unset". "Pickers explain why" applies here too.
- **Fix.**
  1. Make both fields pickers filled from the session's channels (`SessionV1.channels[]`, by their declared labels),
     with the empty choice named first:
     - **Channel:** *Every channel not shown elsewhere* (default), then each channel by label (e.g. *Story*,
       *Sanctum*).
     - **Channel lane:** *The whole channel* (default), *Mine* (only on a channel of personal lanes), then *Lane 1*,
       *Lane 2*… as the log lists them (`channel-lanes`).
  2. A stored slug the session doesn't have stays shown, as *‹slug› (not in this session)*, so nothing is lost
     silently.
  3. Apply the same to the album's `channel` (`widgets.ts:1189-1194`) and **Show another channel inline**
     (`:262-273`).
  - Not verified: whether the widget-settings schema supports options filled from the session. It probably needs
    a new field shape in the SDK's widget settings and in `WidgetSettingsPanel.svelte`.
- **Tests.** Settings panel DOM test: Channel lists the session's channels with the default first; an unknown
  stored slug stays visible; picking the default stores empty. SDK test: the new field shape validates.
- **Docs.** `docs/session-layout.md` "What the Messages widget offers" and "A second Messages widget for one
  channel": name the defaults. NOMENCLATURE: the two choice labels, plus a §25 ledger row.
- ★18a Spell the default out as a named choice (recommended), or literally prefill `main` / `1`, which changes
  what the widget shows?

### Item 19 · The messages area is narrower than the panel
- **Cause (high).** The Messages widget's **Line width** defaults to **Column** (`MessagesWidget.svelte:92`).
  Column caps the rows and the composer at 76ch of story text plus a 3.5rem avatar gutter
  (`src/lib/client/styles/widgets.css:150-165`: `76 × 0.58 × 17px × prose scale` ≈ 750px + 56px ≈ 805px at
  default text size). It also centres the column on the whole session, not the panel
  (`--sp-stage-balance-start/-end`, STYLE-GUIDE 5.3). So on a wide screen the log sits in a strip with empty
  space on both sides.
  - This is ruled (§0-G). It's a setting you can change, not a hidden cap.
  - **Full** has no measure (`widgets.css:150-165` applies only to Column and Comfortable).
  - Not verified: whether anything outside the widget narrows the middle panel further. If **Full** still looks
    narrow, that's a second cap, and needs a look at the layout's middle zone.
- **Now.** Open the main Messages widget's settings and set **Line width › Full**.
- **Fix (per §0-G).** Change the default in `MessagesWidget.svelte:92` and `widgets.ts:144-162`. Existing sessions
  follow the new default unless the person set Line width themselves (only changed settings are stored). Or keep
  Column and widen its measure in `widgets.css:151` (and `columnInsetPx` in `sessionLayout/tuckedSides.ts`, its
  mirror).
- **Tests.** Settings default test, and the `tuckedSides` mirror test if the measure moves.
- **Docs.** `docs/session-layout.md` "What the Messages widget offers" (Line width); STYLE-GUIDE §3.4/§5.3 and the
  polish-parity R1 ledger row.

---

## Lane C — Connections and models (items 16, 17, 20)

### Item 16 · Can't download or activate entity models
- **Likeliest cause (medium-high): a dead end in the UI.**
  - A fresh pub has no `local-onnx-ner` row. The model finder only offers destinations that already exist as rows
    (`connections/finder.ts:236-238, 248-297`).
  - So the Entities loadout's **Get a model…** shows *"Nothing here can hold named entities yet. Add → A
    connection makes the local connection…"* with no button (`ModelFinderView.svelte:1145-1149`).
  - The working path is about six steps across two views, with nothing pointing the way:
    1. **Connections › Add › A connection › Local named entities (ONNX)**, type a name, **Save**.
    2. The new connection's Models tab lists only what's on disk (`OnnxEndpointView.svelte:29-32, 446-509`), so
       it shows *No models yet*: press **Get more…**.
    3. In the finder, press **Get**.
    4. Back on the connection, press **Use in Entities**.
- **The rest of the path checks out.**
  - **Catalogue:** all 5 entity model ids answer HEAD on `config.json`, `tokenizer_config.json` and
    `onnx/model_quantized.onnx` (307/302, no 404). The ids are the 2 built in (`server/ner/models.ts:73-92`) plus
    3 from the cached `ner.yaml`.
  - **Download:** goes through `AutoModelForTokenClassification` into `models/ner`
    (`localOnnxModels.ts:376-454`). `localOnnxModels.cacheDir.int.test.ts` passes.
  - **Gates:** `dtypeRefusal` accepts q8. `starRefusal` needs the files on disk (`starRefusal.ts:99-105`).
    `text->entities` is native (`manifest.ts:1206`).
  - **Activation:** the confirm commits at once on a first choice (`useStarConfirm.svelte.ts:170-192`).
- **On disk.** `~/.local/share/SerenePub/models/ner` doesn't exist, so no entity download ever reached its first
  file on this data dir. The logs (latest 10-28) have no `[onnx-download]` or `[ner]` lines.
- **Minor.** `local_models.filename` is still UNIQUE across modalities (`schema.ts:4326`), and rows are matched by
  filename alone (`localOnnxModels.ts:242-269`). The 10-05 C1 note "key it per modality" wasn't done. Harmless
  for today's ids.
- **Not verified.**
  - Your database: whether an entity connection exists.
  - A real download through transformers 4.2.0 against Hugging Face's new relative 307 → `/api/resolve-cache`
    redirect. The test's fake Hub doesn't cover it.
- **Settles it: the message you saw.** Each one points at a different place:
  - *Nothing here can hold…* → the dead end above.
  - *Local entity extraction is not available…* (`ner/index.ts:61`) → the runtime verdict.
  - *That model isn't downloaded yet…* (`starRefusal.ts:104`) → switched on before the download finished.
  - *Unknown entity model…* (`ner/index.ts:156`) → the loader doesn't know the id.
  - A stack trace, or *Download failed* with Hugging Face's message → the fetch itself.
- **Fix.**
  1. Item 17 removes the dead end.
  2. If 17 waits: the finder's empty card gets a button that creates the row and carries on.
  3. Key `local_models` per modality (one migration via `db:generate`).
  4. If your message points elsewhere, fix that place.
- **Tests.**
  - Finder unit test: `destinationsFor("entities")` is non-empty once the row exists.
  - DOM test for the empty card's button.
  - A download test against a Hub that answers with a relative 307.
- **Docs.** `docs/embeddings-and-rag.md:171`.

### Item 17 · The local ONNX connections are built in, with fixed names
- **Current (high).**
  - Two types: `local-onnx` (embeddings) and `local-onnx-ner` (entities) (`ConnectionTypes.ts:157, 199`). Both
    are created by hand from the New connection picker (`connectionServiceItems.ts:263-297`), or by the 0.5.3
    upgrade with an empty name (`attic/etl/connections.ts:478-485`).
  - Names are free and unique, ignoring case (`sockets/connections.ts:515-526, 656-668`).
  - `connections` has no built-in or managed flag (`schema.ts:532-645`).
  - Precedent, managed KoboldCPP and audio.cpp: the oldest row of the type is *the* row, inserted directly, plus a
    fold of extra rows (`koboldcpp/managedEndpoint.ts:26-97`, `audiocpp/managedEndpoint.ts`,
    `koboldCppManagedFold.ts`).
- **Fix (per §0-H).**
  1. **Create at boot.** `connections/localOnnxBuiltIn.ts` with `ensureLocalOnnxConnections(db)`, run from the
     local ONNX service's `reconcileOnBoot` (`services/register.ts:89-94`).
     - Only when `localOnnxAvailability().available`.
     - Look the row up by type and insert only if there is none (no fixed id, the same direct insert as
       `ensureManagedKoboldCppEndpoint`).
  2. **Existing rows (★17b).** Keep the row a loadout names, else the oldest. Fold the rest into it by generalising
     the KoboldCPP fold as `foldConnectionInto(tx, from, to)`: models mapped by id, foreign keys and pipeline slots
     repointed, then delete. Nothing re-embeds, since a local embedding's identity is the model id
     (`embedding/target.ts:306-312`). Running it twice changes nothing.
  3. **Name.** One map from type to name as an `I18n` value, read through `shared/i18n/i18nText.ts`.
     - Store the English in the NOT NULL `name` column, so exports and logs stay readable.
     - Project the name from the type in `buildConnectionsList` (`sockets/connections.ts:300-334`) and
       `resendConnection`.
     - Reserve both names in `connectionNameTaken`.
  4. **Server guards.**
     - `connections:update` refuses a rename of these types.
     - `connections:create` refuses a second row of the type.
     - `connections:delete` refuses the row (per-model **Remove files** already exists).
     - The New connection picker leaves both types out, as it does managed types (`connectionServiceItems.ts:272`).
  5. **UI.** The name field is read-only (`ConnectionsSidebar.svelte:1335-1341`), there's no Delete, and the
     finder's *Add → A connection…* branch goes.
  6. **List fetch.** Gate it on a model on disk or a loadout naming the row, not on the row existing (§0-H).
  7. **ONNX unavailable** (Android; Intel Mac if the 1.23.2 bundle fails): create nothing. Older rows stay and
     read *Unavailable*. The row appears on the first boot where the runtime loads.
- **Tests (int).**
  - First boot creates one row per type; the second boot writes nothing.
  - No rows when unavailable (mock the verdict).
  - An existing row is adopted.
  - Folding two extras keeps the loadout and pipeline slot and triggers no re-index.
  - Create, rename and delete are refused; the list carries the projected name.
  - Update `localOnnxModels.int.test.ts`'s create helper, and check the 26 test files that make ONNX rows.
- **Docs and naming.**
  - Docs: `docs/connections.md:305, :641-653`; `docs/embeddings-and-rag.md:34, :171`; `docs/connect-a-model.md`.
  - The canon word is the **managed** family ("a runtime this pub runs or hosts", NOMENCLATURE:694). "Built-in"
    is taken (§9:465, the action built-ins, R1). Interface prose may still say *built into Serene Pub*
    (§24.6).
  - NOMENCLATURE rows: §10, `:694`, `:1294`, plus a §25 ledger row.
- ★17a One row or two? You wrote "the local ONNX connection"; there are two types. *Recommend two rows now.*
  Merging into one type with a per-model modality (the Ollama 09-25 / OpenAI 10-05 precedent) touches
  `onnxModalityOf` across about 20 files (L).
- ★17b Fold extra local ONNX rows into the kept one? *Recommend yes.*
- ★17c Fill the Embeddings / Entities loadouts on a fresh install? *Recommend no.* Nothing is downloaded yet, and
  it would break no-implicit-pickup.
- ★17d Names? *Recommend **Local embeddings** and **Local named entities**.*
- ★17e Can the row be deleted? *Recommend no; remove a model's files instead.*

### Item 20 · Search and download models in the Models view, not a modal
- **Current (high).**
  - **Get a model**, the one finder (`ModelFinderView`, `finder.ts`), opens as a Dialog over the Models view
    (`sidebars/ModelsSidebar.svelte:184-204, 415-455`; comment *"The dialogs (never places)"*).
  - The plan of record (`plans/PLAN-model-library-2026-10-29.md` §1, D1) settled on *"one front-end surface for
    search + download"* (owner 10-29) and kept *"its dialog stays **Get a model** (canon :694)"*. The surface stays
    one; only the dialog form changes, so no ruling is reversed. Canon :694's "dialog" wording moves, with a §25
    row.
  - Every door already goes through one place: Loadouts' **Get a model…**, a runtime's or the ONNX endpoint's
    **Get more…**, and the toolbar all set `panelsCtx.digest.modelsFinder` → `openFinder(scope)` (`:286-300`). So
    moving the finder moves all of them at once.
  - Other dialogs on the same path:
    - **Add by name** (`addByNameOpen`, `:189`);
    - the **quant picker** (`QuantPicker.svelte:97`, a Dialog opened from the finder and `OnnxModelView`);
    - **Set up chat**, a Dialog stepper that embeds the finder (`SetupChatFlow.svelte:202-234`).
- **Fix (client only).**
  1. The Models view already splits list and detail (`PanelSplit` with `detail={detailPane}`, `:332-344`). Make
     its right-hand side a small union: `pane: { kind: 'model', … } | { kind: 'finder', scope } | { kind:
     'add-by-name' }`. `openFinder(scope)` sets `pane = { kind: 'finder', scope }` instead of opening the dialog.
  2. **Wide view:** list on the left, finder on the right, so you watch your library while you search. **Narrow
     view, or Dock:** the finder takes the view, with **Back** to the list, the same as a model's details. Pressing
     Get keeps the finder open; the downloads tray shows progress, as today.
  3. `ModelFinderView` fills its pane: drop the dialog's fixed `h-[min(90vh,760px)]` and give the finder one
     scroller. Its **Open connection** hand-off stops closing a dialog and opens the connection.
  4. **Quant picker:** shown inline on the chosen row (expand under it) instead of a Dialog. Its choice and the
     recommended pre-selection stay as ruled (D2). ★20a.
  5. **Add by name:** a pane like the finder, or a section at the foot of the finder. ★20a.
  6. **Set up chat:** ★20b.
  7. Optional: put the pane in the view's state (`?get=<scope>`), so Jump, a reload and Focus/Half keep the
     finder open.
  8. Delete the `<Dialog>` block (`:415-455`) and `finderOpen`.
- **Tests.**
  - `finder.dom.test.svelte.ts`: the finder renders in a pane, Back returns to the list, Get keeps the pane.
  - Each door (Loadouts, Get more…, toolbar) opens the pane with the right scope.
  - Quant choice works inline.
  - `finderViews.ssr.test.ts` updated.
  - An axe pass on the pane (no dialog role, focus moves to its heading).
- **Docs.** `docs/connections.md` "The model finder" (from a dialog to a pane of Models); STYLE-GUIDE: the
  Models view pane pattern (§ on list/detail, `PanelSplit`); NOMENCLATURE :694 (**Get a model**, a pane, not a
  dialog), :699 quant picker if it goes inline, §25.
- ★20a Do the **quant picker** and **Add by name** come out of dialogs too? *Recommend yes, both inline.* A modal
  inside a pane is the same interruption you're removing.
- ★20b **Set up chat** (the first-run stepper, a dialog that embeds the finder): move it into the Models view as a
  pane too, or keep it as a stepper over everything? *Recommend moving it: it would then be the same pane,
  starting at its Runtime step.*

---

## Lane N — Naming (item 12)

- **Current.** Rail, bottom bar, Views sheet, view header and Jump chip all say **Characters** (view key
  `characters`, `/characters`, `CharactersSidebar.svelte`); it holds personas too. The canon already supports the
  rename: §9 *Resolved collisions* — "`character` → a cast member"; §8 *cast member*; `docs/lorebook-cast.md:25`
  ("A **character card** is a starter… A **cast member** is that person in *this* story"). No canon row names the
  library item itself.
- **Proposed vocabulary.** STYLE-GUIDE §1.8/§10 require sentence case: **Character cards** (you wrote
  "Character Cards" — ★12a). One item: **character card**; bare **card** where the screen already says it.
  Inside a session or book, **character** stays ("Pick a character", the cast's Characters list). "Character Card
  V3" keeps its capitals (format name).
- **Change list.**
  - **A. The view's name and references (~25 strings, ~15 files):** `Layout.svelte:677` (rail/bottom bar/sheet/
    header title), `AccessibleShell.svelte:263`, `CharactersSidebar.svelte:534, 1357, 1504, 1541, 1582`,
    `jump.svelte.ts:99`, `routes/characters/+page.svelte` `<title>`, Home `routes/+page.svelte:1924, 1940`,
    Document View (`document-view/characters/+page.svelte:49`, `document-view/+page.svelte:243`, four "Back to
    Characters", `document-view/help/+page.svelte:67,71`), `StartSessionForm.svelte:737,748`,
    `PersonaSelectModal.svelte:142`, `LibraryDetail.svelte:133,148`, `UserSettingsTab.svelte:710`,
    `sockets/characters.ts:1643`.
  - **B. Other lists of library cards:** `AttachPicker.svelte:56`, `PersonDetail.svelte:78,182`; plugin permission
    label "your characters" (`declaredPermissions.ts:479`; key `applet:characters:*` stays).
  - **C. What an item is called inside the view (~115 strings, 13 files):** only actions on the *file* say "card"
    (Export, Copy, Share); text about the *person* stays "character".
  - **Docs (~15 lines, 11 files):** `characters.md:19,275`, `getting-around.md:12,18,206`,
    `coming-from-sillytavern.md:20,165`, `personas.md:16`, `tags.md:29`, `themes-and-settings.md:48`,
    `upgrading-from-0.5.md:40`, `importing-from-sillytavern.md:35`, `getting-started.md:131`,
    `document-view.md:47`, `genres.md:41`; `README.md:403` ("Your cast" — contradicts the canon). STYLE-GUIDE: 11
    mentions (§5.1:433, §6.4:872…).
  - **Canon:** ~8 rows in §26/§22/§8 that name the view; new §8 row **character card** ("a reusable library item;
    travels as a §16 card. ⚠ Not a cast member, not a character seat"); §25 ledger row (owner 2026-11-03; R1 —
    the library is the use that renames).
- **Stays (R4, wire protocol).** Tables `characters`/`character_folders`/`session_characters`, `characters:*`
  socket events, view key, jump kind `character`, localStorage keys, component names, `{{char}}`. Cast-member uses
  of "character": `StartSessionForm.svelte:1455` (pinned by `startSessionCast.dom.test`), `CharacterSelectModal`,
  `RulesetEntryTypesSection.svelte:388`, "Character lore", the variable shelf, `declaredPermissions.ts:138`,
  `sessions.md:20`, `group-sessions.md:66`, `genre-story.md:25`.
- **Risks.** Translations: English text is the key (`server/i18n/translate.ts`), so renamed strings show in English
  until re-translated on first view; no files to edit. Bottom bar: 64px buttons with 11px labels
  (`Layout.svelte:3378,3416`) — "Character cards" (~90px) wraps. "Card view" (tiles) toggle now sits inside
  "Character cards". `libraryDetail.wizardPick.dom.test.ts:91-106` asserts "In your characters". Docs anchors: the
  build fails on a broken anchor (`build-docs.js:457`), so nothing breaks silently. Stale screenshots:
  `characters-sidebar-cards.png`, `home.png`, `help-sidebar.png`, `mobile-nav-drawer.png`.
- ★12a **Character cards** (sentence case, recommended) or *Character Cards*?
- ★12b Scope: A + B (recommended), or also C?
- ★12c Phone bottom bar: short **Cards** with the full name in `aria-label` (recommended), or let it wrap?
- ★12d Route: keep `/characters` (recommended), or add `/character-cards` with a 308 from the old address (precedent:
  `routes/library/characters/+page.ts`)?
- ★12e Home's section heading and `docs/characters.md` H1 → "Character cards" (slug kept)? *Recommend yes to both.*
- ★12f Rail icon: keep `UsersRound` (recommended; `IdCard` is taken by the cast member's Member tab)?

---

## Item 21 · Audit automatic behaviour against P1

Ruled 2026-11-04 (CLAUDE.md §Principles P1): a new automatic behaviour is off in core until a genre opts in, and
existing ones are audited, not grandfathered.
- **Inventory** (read-only lane): every behaviour that acts without a press.
  - Known so far: routines on events/cadence (*Note what changed*, *Look back over the story*, *Picture each new
    scene*), scene boundary triggers and the automatic scene mode, clock moves (per-reply tick, keeper moves),
    auto-advance, narrator asides / speak-up, the AI answer to forms, indexing sweeps, open-scene cast refresh.
  - For each: what triggers it; whether core or a genre turns it on; whether it leaves a visible cause line; how
    to undo it or switch it off.
- **Then:** anything on in core with no genre opting in becomes off in core and on in the genres that want it.
  Anything without a visible cause or an off switch gets one.
- **Overlaps:** items 2 (opening scene: now a genre opt-in, Story's), 3 (sweep summaries), 7 (narrator), 13
  (keeper clock move) are decided by this audit's table.
- **Output:** a table in this plan; changes go through the lanes above.

### Audit result (read-only Plan agent, 2026-11-04) — 21 behaviours
Paths: `app/` = `src/lib`, `sdk/` = `../serene-pub-sdk`. Routines default to `full` when a registration names no mode (`sdk/sdk/src/registrations.ts:44-45`); every run is listed in *While you were away* and its mode is switchable Off/Review/Full per session, which counts as cause line + off switch.

| # | Behaviour | Trigger | Where on | Cause line | Off / undo | Verdict |
|---|---|---|---|---|---|---|
| 1 | *Note what changed* | after each round | Story opt-in, `full` (`defaults.ts:232`) | routine log; ledger rows | mode Off/Review; delete retracts | compliant |
| 1b | …its clock move | same | `cause:'keeper'`, `onRefusal:'skip'` (`reckoning.ts:855-866`) | `ledgerLines.ts:527` never reads `cause` → reads as your press | duty switch | **needs cause line** (item 13) |
| 2 | *Look back over the story* | every 5 turns | Story opt-in (`:234`); duties default on in **core** contracts (`tasks.ts:5264-5276`) | routine log; lore writes carry no "by the sweep" mark | mode; duties | **needs cause line** on history writes (item 3) |
| 2b | *Notice when the scene moves on* | in the sweep | duty on; placed only in Automatic (`boundaryWatcher.ts:1084-1137`) | `cause:system` but no cause column on `scenes` | duty; scene mode; delete | needs stored cause |
| 3 | *Picture each new scene* | `scene-opened` | Story, `off` | routine log | mode | compliant |
| 4 | *After a rest* | `rest-taken` (follows a press) | Story, DC, `full`, no model | ledger line, same :527 gap | mode | compliant; cause wording shared with 1b |
| 5–9 | Lair keeper (`review`), Castellan scratchpad, *File current room* (`off`), Chat *Remember things* (`off`), welcome a newcomer | various | genre opt-ins | routine log | mode | compliant |
| 10 | AI answers a form put to an AI participant | `form-addressed` | **core spine, every genre** (`defaults.ts:189-190`) | `form-answered` in changes | not found — spine has no `mode` | on-in-core; **verify an off switch** |
| 11 | Scene cues, Suggested | each line | core `suggested` | *New scene?* chip | Not here; triggers; Manual | compliant (an offer) |
| 12 | Automatic scene mode | each line | opt-in, never default | `cause:system` on watch, but `followEndedScene` opens with **no cause** (`:743-750`) | delete; mode | **needs cause line** |
| 13 | Scene open files an empty dated history entry | any open | core, always (`liveScenes.ts:525-557`) | none | delete entry | **needs cause + off/move** (item 3) |
| 14 | Open-scene cast refresh | every line, all modes (`:52-56, :480`) | core, always, no model | none | none | **needs cause line and off switch** (low stakes) |
| 15 | Per-reply clock tick | each reply | Story reply, By 0 = off | ledger line; `cause:'tick'` dropped at :527 | the param | compliant; share the wording fix |
| 16 | Auto-advance | `turn-order-changed` | core `next`, Story `round` | `auto:true` on every write; cap warning console-only | field Off; Stop | compliant; cap message should reach the receipt |
| 17 | Narrator asides | end of round | core off | none; refused silently when Narrate isn't enabled | field | **needs cause line** (item 7) |
| 18 | *Let others speak up* | same | off | `via:'unprompted'` | field | compliant |
| 19 | Embedding index sweep | boot + periodic | gated by a starred connection | composer chip | unstar | compliant (index, not a story write) |
| 20 | NER/annotation lane | boot + periodic | unconditional by design (`annotations/queue.ts:524-534`) | none | none | compliant: annotations only, suggestions are reads — **recorded as the design exception** |
| 21 | Turn-order recompute | every event | core, no model | n/a | n/a | compliant |

**Consequences for the plan.** Item 2: the opening scene lands as a cue under Suggested or a placement under Automatic, Story opting in through `shape.scenes`, never a core default; also fix `followEndedScene`'s missing cause and consider a stored cause/trigger on `scenes`. Item 3: retiring *Summarize the story* (★3a) satisfies P1 directly, else flip the core default off and have Story opt in; moving `fileSceneUnder` to compile removes row 13's automatic write altogether. Item 7: already off in core; the refusal must reach the receipt and Activity. Item 13: the ledger line must render `cause` (keeper / tick / action) — **built now in lane A** as the P1 cause line; fix A (drop the keeper move) needs a receipt note (★13a/b). New follow-ups, not in any lane: row 10 (confirm or add an off switch for the AI form answer), row 14 (cast refresh needs a note and a switch), row 16 (cap message to the receipt), row 12 (`followEndedScene` cause), a stale "Chat's fixed tick" comment at `boundaryWatcher.ts:58`.
**Not verified:** whether the spine's `form-addressed` can be set Off per session; whether the client shows an automatic marker for auto-advance rows; whether the DC welcome spec calls a model; whether the routine log names which duty wrote each lore entry.


## §V0 Read-only data checks (optional, before building)

Through the running app's socket (never a second PGlite handle). Each settles a "not verified":

| Check | Settles |
|---|---|
| Item 13: the `state_proposals` clock row for the 3-hour move — `payload.cause` | keeper (Note what changed) vs `tick` (per-reply advance) |
| Item 6: rows at the max `rewind_ordinal` — `role, user_id, persona_id, metadata->>'speaker'` (only if nothing was written since) | design gap vs speaker-count bug vs double press |
| Item 4: did the session's lorebook lose a history entry before Scene 2 was named "Scene 1" | item-2 cause vs cascade delete |
| Item 11: newest run receipt `nodes[].output.wire.request.body` | chat wire with no seed (confirms cause 2) |
| Item 7: the session's `narratorInterjections` and auto-advance mode | whether asides were on / silently refused |

## Build plan (when you say go)

Run under `.claude/guides/multi-agent.md` and `review.md`:
- a `plan-challenger` pass on this plan first;
- the item 21 audit (read-only) before lanes S, T and A, since it decides items 2, 3, 7 and 13;
- at most 2 `lane-supervisor`s at a time;
- lane ids `playtest-<letter>`, with briefs in `plans/briefs/BRIEF-playtest-<letter>.md`.

Eight lanes: **S** scenes/history (2, 3, 4, 5) · **T** turns/prompt (7, 11) · **A** actions/clock (1, 13, 14) · **H** Back (6) ·
**L** lorebooks (8, 9, 10) · **W** session layout (15, 18, 19) · **C** connections and models (16, 17, 20) · **N** naming (12).

- **Ready now, no ruling needed:** 1 (with ★1a default), 4 (position numbering), 5, 9 (client + branchId), 10 (S
  version), 11 steps 1 and 3, 13 B + C copy, 6 latent bugs 1–3 + count, 8 correctness.
- **Waits on a ruling:** 2 (★2a/b), 3 (§0-B, ★3a), 6 unit (§0-A), 7 (★7a–c), 8 placement (§0-C), 11 step 2
  (★11a), 12 (★12a–f), 13 A (★13a–c), 14 (§0-F, ★14a–c), 15 step 5 (★15a/b), 16 (your error text), 17 (§0-H,
  ★17a–e), 18 (★18a), 19 (§0-G), 20 steps 4–6 (★20a/b). Item 20 steps 1–3 and 8 are ready now.
- **Item 15 steps 1–4 are ready now** and come first: a widget that fails silently also hides the cause of
  every other UI bug.
- **Shared files — serialise or give one lane ownership:**
  - `runtime/host.ts`: A (clock outlet ~8985), L (relist after lore writes ~10275), S (sweep inserts ~10273).
  - `core-catalog/src/registry/genres.ts`: T (narrator field), H (`history.back`).
  - `sockets/sessions.ts`: A (cancel), H (rewind).
  - `NOMENCLATURE.md`: S, T, A, H, N each add rows; N owns §25 ordering.
- **SDK touches** (`../serene-pub-sdk`; edit there): S (reckon summary arm, SessionMessage badge), T (narrator
  field + script), A (`storyTime.ts` copy, `story/ask.ts` re-voice), H (genre declaration, rewind strip state). `npm run sdk:test` after,
  then `npm run sdk:build` — never while your dev server is on :5173. Spec-hash re-pins for S and T. SDK prerelease +
  pin bump before push.
- **Migration:** only if §0-B rules deferral (nullable `scenes.history_entry_id`), via `db:generate`, index above
  the applied max.
- **Verification:** one grouped run at the end — `npx tsc --noEmit -p .`, `npm run check`, `npm run sdk:test`,
  `npm test` in a capped scope, then a short Story playtest walking all 13 items.

## Build status (lead, 2026-11-04)

**Go:** the owner said "organize the plan into supervisors and begin". A go does not rule open ★s: only the
"Ready now, no ruling needed" set is being built, with ★1a's default. Every §0 reversal and every other ★ waits.

### Challenger round (review.md §1, 2026-11-04) — five objections, all accepted
1. **13 B/C:** old `state_proposals` rows have no `reason`; derive it on read (`skipped === NO_STORY_CLOCK_YET` → `no-clock`, else `refused`) with a test over an old-shape row. The keeper-source wording is held for ★13b and the item 21 audit.
2. **Item 4:** renumbering existing scenes reshapes stored names nothing marks as defaults (copied into Activity and the graph). Build position numbering for new names only. **★4b (new):** renumber via a `nameIsDefault` marker (migration) or number at render and store only custom names? Until ruled, "delete first then open" can still repeat a number.
3. **Item 5:** delete only `messageLayouts.css:201-205`; 206-211 is the shared badge-text clamp. Removing the published part `messages.message-badge-scene` is a clean break with a release-note line.
4. **Item 1:** smaller change — the waiting row's Stop emits the existing `pipelines:cancelRun {runId}`; widen that handler's check to the session owner (★1a default); fix the false "Cancelled N" reply. No new Cancel param, no `cancelRunInSession`.
5. **Item 6 latent 3:** bound `unitRuns` by `id >= firstId` only; the `created` filter would drop rewrites the docstring includes on purpose.
Also corrected: item 10's **Edit card** precedent is `TagsSidebar.svelte:389` (LibraryView:390 is Open card); item 8's three `emitToUser` arms must all carry the scope key; item 15's line refs are unverified and lane W confirms them first.

### Lanes and waves (two supervisors at a time; briefs in `plans/briefs/BRIEF-playtest-<id>.md`)
| Wave | Lane | Builds | Owns the shared file |
|---|---|---|---|
| 1 | **W** | 15 steps 1–4 | `sockets/sessions.ts` (panelLayout handlers) |
| 1 | **L** | 8 correctness, 9 client + branchId, 10 S | — |
| 2 | **A** | 1 (smaller shape), 13 B + C copy (keeper arm held) | `sockets/sessions.ts` (cancel handler) |
| 2 | **H** | 6 latent 1–3 + backTakes count | `docs/sessions.md` |
| 3 | **ST** | 4 position numbering, 5, 11 steps 1 + 3; applies A's queued doc lines | `docs/sessions.md` |
| 3 | **C** | 20 steps 1–3, 8 | `STYLE-GUIDE.md` (one paragraph) |
| — | lead | item 21 audit (read-only Plan agent, running); NOMENCLATURE §25 rows from every lane's "Canon rows needed"; grouped verification at the end | `NOMENCLATURE.md` |
Scope review (`scope-reviewer`) after each wave; `runtime/host.ts` and `core-catalog/src/registry/genres.ts` untouched this build.
Waiting on rulings (not started): 2, 3, 6 unit (§0-A), 7, 8 placement (§0-C), 11 step 2, 12, 13 A, 14, 15 step 5, 16, 17, 18, 19, 20 steps 4–7, ★4b.

### New ★ raised by the lanes (2026-11-04)
- **★W1** (lane W): the stopped-widget overlay still says *"Reload the page to try it again — …"* above the new **Reload widget** button. Recommend *"Reload it to try again — the extension's own message is in the browser console."*
- **★4b** (challenger, item 4): renumbering existing default-named scenes — a `nameIsDefault` marker (migration) or number at render and store only custom names? Until ruled, "delete Scene 1 then open" can repeat a number.
- **★13d** (lane A, item 13 C): the cause line for `keeper` and `tick` moves. `keeper` has five writers and the row can't name its source at read time; recommend stamping a `source` (the routine's/action's UI name) on the clock row at write, then *{source} suggested 3 hours, not moved. {why}*; ticks read *Each reply advances the clock by 10 minutes (…)* when applied. Three files outside lane A, one optional field, no migration.
- **★H1** (lane H): the "Back takes" words go stale after a plain reply, since `rewind` is sent only with the session; recommend re-sending `rewind` when a reply run ends (one session refresh per turn, or a small payload of its own). Touches `sockets/sessions.ts`.
- **★H2** (lane H): at a table of players the words still say "your line"; recommend a person-line count and *"2 lines and 3 replies (…)"*.
- **Lost files:** a parallel plans clean-up (06:29) deleted the W and L lane reports; the lead re-created them from its own context. Nothing else of this build was lost.


### Grouped verification (lead, 2026-11-04)
- `sdk:build` green (dist rebuilt; no dev server was up) · `npm run check` 0 errors · `tsc` one pre-existing error (`arrangeCanvas.dom.test.svelte.ts:11`, file unchanged since HEAD; svelte-check passes it) · `sdk:test` one pre-existing failure (`deriveDontSpell` on `shared/speakMessage.ts`, committed 2026-10-31, untouched).
- App suite (`vitest run --maxWorkers=3`, 20 G scope, 55 min): 1884 files, 20889 passed, 30 failed. **4 were this build's and are fixed:** `replyRoad.int` (cancel count), `commentHistory` (one comment in `pendingReply.ts`), `sessions.retake.int` (lane H's yield filter → creator rule), plus the `rewind`/cancel suites rerun green. **26 are pre-existing**, all in the speech / applet / migration-0139 area of the 10-31 commit and the SDK's uncommitted state, touching no file this build changed: `genreFieldDefaults`, `sessionGenres`, `publishedValues` (`sessionLanguage`, `speechNarratorVoice`), `presetFallback`, `sessionAdmin.presetActions` (`read-aloud`, `say-it-as`), `seedVariableTemplates` / `variableTemplates.parity` (`inflectionTag`), `0108_layering_registrations`, `atticStash` (0139), `allPipelines`, `placedNodeReconcile`, `sessions.forms` (`askedRunId`), `coreRow` (plugin frames), `wiring` / `paramsSlotWiring` (`core:oracle/speak`), `importBoundary` / `stopsWiring` (speech modules), `combos` / `probeCapabilities` / `capabilityGuard` (`text->audio`), `commentHistory` (`0137_loadout_voices.ts`, `managed/supervisor.ts`).

### Correctness review (review.md §2 `/code-review`, lead, 2026-11-04 — run after the owner asked whether the reviews were complete; it had been skipped)
Ten findings over the six lanes and the slash change. **Seven fixed in place** (ledger row *playtest build, correctness review*):
1. **W** `sessionLayoutData` — a copy ask with no answer outlived the session (`reset()` kept it), so every later widget write was held and never sent. `LayoutCopyAsks.abandon()` in `reset()`; test added.
2. **W** the conversation remounted on every `sessions:view` reply (Edit session's save, an envoy-seat refusal), losing scroll and widget state. `remountKey` now follows `SurfaceManager.copiesLanded` (`noteCopyLanded()` on a landing), not `seedCount`; `docs/session-layout.md` no longer says saving settings restarts it.
3. **Slash** a bare `/narrator` still opened the modal: the shipped Narrate declares optional text, so it routes `fire` with no text, and `narrateDirectly` returned null for that. Returns `""` now; the test uses the real collects.
4. **H** creators' yields were unfloored, so a plan row from an earlier turn pulled that turn's rows into Back. Floored like the runs — **amended the same afternoon** (lane playtest2-H's scope review caught that the floor broke the Lair's first-turn retake): the opening run's own yield is never floored; only other creators' yields are.
5. **H** `backTakes.count` / `names` counted every non-person row (dice, ledger, other channels). Story-lane rows only.
6. **ST** `sceneNameFor`'s `previous` was the newest scene by id, not the scene before by position, so a scene opened between two others compared days with the wrong one. Fixed; numbering duplicates stay ★4b.
7. **A** `recordClockMove`'s `reason` input and `ClockMovePayload.reason` had no caller (built "for later"); dropped, the kind is derived from the sentence for every row. `clockSkipKindOf` takes the sentence only.
8. **L** the rail asked `entries:counts` twice on every book open / line switch (the open's direct ask, then the list burst's window). A window opened within 150 ms of a direct ask is skipped; a direct ask closes a waiting window.

**Rolled to open items, unbuilt (owner's call):**
- **★A2** (item 1, finding 4): the waiting row's Stop goes through `pipelines:cancelRun`, which only the run's starter or the session owner may use, while a generating row's Stop (`sessionMessages:cancel`) is any member's; and it stops that run alone, not the session's other generating rows. In a shared session member B's Stop on a reply A's line started is refused with *Not your run.* ★ Recommend: `pipelinesCancelRun` grants the session right on `hasAccess` for a reply run (not line-bound, not an action), matching the row rule "fence on state, not on who clicked"; or the client sends both events. Permission change, so not built.
- **Perf** (item 12/14, finding 7): `nonCastLabelsFor` runs a session-wide distinct scan of `metadata->>'narratorName'` plus a world build on every dispatch of a session that has narrated. Correct, but grows with history; a per-session cache or reading the names once per run would do. Not built (no ruling needed, but outside the plan's size).
- **★4b** stands (finding 6's second half: two scenes can share a number).

## Rulings (owner, 2026-11-04, asked question by question after the build) — every §0 and ★ is now ruled

**§0 reversals**
- **A Back:** one message per press in **Story**; Lair and Dungeon Crawler keep the whole turn. Trailing routine lines (Time passes, notes) go with the message. **Genre-fixed** (declared like `history.settle`), no setting.
- **B History entries:** **wait until compile** — no history entry exists until the scene compiles (L, one migration). Item 3's *Summarize the story* routine is **retired** (summarize-scene covers it).
- **C Indexing notice:** progress moves to **Activity**; the composer keeps only notices you can act on (*no index* + setup link, *stale* + Re-index). Non-admin book owners see progress for their own books.
- **D Cast member names:** **book-only override** — a lorebook member carries its own **name, nickname and portrait** over the card's; the override is book data and travels with the book on export/import. Reverses NOMENCLATURE.md:370 and `docs/lorebook-cast.md:34`; lane L's read-only row + Edit card is superseded.
- **F Ask:** **retired from Story.** The forms mechanism stays (the Lair's Roll, Adventure's Ask). ★14a–c fall away.
- **G Message width:** default **matches the container width** (Full); Column and Comfortable stay on offer.
- **H Connections the app creates:** the app creates the local ONNX rows, **never fills a loadout** with them (no-implicit-pickup stands); the list fetch is gated on a model on disk or a loadout naming the row.

**Items**
- **1 Stop:** a waiting **reply** may be stopped by **any session member** (★A2; the cancel handler grants the right on session access for reply runs). Actions (Rest, Image) and speech lines: **presser or owner** (★1a as built).
- **2 First scene:** opens under **Suggested** (a cue) and **Automatic** (a placement), never Manual; **new sessions only**, no backfill; Story opts in through `shape.scenes`, never a core default.
- **4 Scene numbers (★4b):** **number at render; store only custom names** (a marker or null name for defaults; one migration).
- **6 Back title (★H1, ★H2):** refresh `rewind` when a reply run ends; count person lines at a table (*2 lines and 3 replies (…)*). In Story the one-message title names the message's author.
- **7 Narrator turn:** **after the cast, every N rounds**; not a second reply under Next turn.
- **8/9 Lorebook:** owners see indexing progress for their own books; AI-written lore appears live in an open book's lists and figures.
- **11 Narrator label:** keep the text, **drop both labels**; **no name prefill** on chat connections.
- **12 Rename:** **Character cards** (sentence case), scope A+B (labels, docs, canon rows); phone bar shows **Cards** with the full name in `aria-label`; route `/characters` kept; rail icon kept.
- **13 Clock:** after a manual Time passes the model's own move is **dropped**; a keeper's refused guess **shows in the conversation ledger** beside the reply (not receipt only); a dayless clock **starts counting days** at midnight (Day 1 → Day 2). **★13d (source on the row): no.**
- **15 Resets:** Reset to genre default layout **clears your settings and style pins** for the widgets it places; a widget's own Reset **keeps style** (Style gets its own reset beside it).
- **16 Entity models:** the message seen was *Nothing here can hold named entities yet…* — the finder's dead end; item 17 removes it. Also key `local_models` per modality (step 3).
- **17 ONNX rows:** **two rows**, **Local embeddings** and **Local named entities**, **undeletable** (remove a model's files instead); extra hand-made rows **fold into** the kept one (the one a loadout names, else the oldest); fresh installs fill no loadout.
- **18 Lane default:** a **named choice** *Default (main)*; a stored blank still means default.
- **20 Models view:** quant picker and Add by name **inline**; **Set up chat stays a dialog**.
- **21 audit:** the AI form answer and the open-scene cast refresh are **off in core until a genre opts in**, each showing its cause and switch (Story opts into the cast refresh through its shape; the form answer is moot for Story once Ask is retired, the Lair's Roll opts in).
- **★W1 overlay copy:** *Reload it to try again — the extension's own message is in the browser console.*
- **Perf note** (`nonCastLabelsFor` per-dispatch scan): no ruling needed; open as a follow-up.

**Not yet built.** Everything above is ruled, not built; a build needs a go. Rough sizes: L — §0-B (compile-time history entry, migration), §0-D (book-only member override: name/nickname/portrait, export), item 17 (+16); M — §0-A one-message Back + genre declaration, item 2, item 7, item 12, item 13, ★4b (migration), item 15, item 20; S — §0-C, §0-F retire Ask, §0-G default, item 11, item 18, ★A2, ★H1/★H2, ★W1, audit opt-ins.

### Reconciliation with the applet / Mundi programme (M2d/M2e, `plans/PLAN-sdk-creation-seams-2026-10-30.md` §16–§19) — sent to its lead session 2026-11-04, one round, answers pending
Overlaps the ruled set has with that programme (the proposal in each is mine; the M2 lead answers accept / reject / needs owner):
1. **§0-D cast member override** vs ★34/★M2e-1 immutable provided/primer books: override refused on a provided/primer row, lives on the person's clone; the diff upgrade never carries it.
2. **★A2 stop right** vs ★B one decider: build as a `personMay` capability; retire lane A's `cancel(…, { ownedSessionId })` per-handler check.
3. **§0-H ONNX rows** vs ★47 seeded sampling config: same `seedKey` boot pass in `db/defaults.ts`, no id, second-boot test; the "connection defaults NEVER" comment amended once.
4. **Item 12 "Character cards"** vs C1 Apps view (`CONTENT_ORDER`, `rightNavOrder`) and the applet-card vocabulary: NOMENCLATURE "card" stays the character file; "applet card" always qualified; "Cards" only as the phone-bar short label.
5. **§0-A one-message Back** needs a GenreDecl field (working name `history.back`); lane D owns the SDK; ★43 (Back on a Guide-made lorebook) re-checked for the Guide's genre.
6. **§0-B compile-time history entry** + retired *Summarize the story*: does Mundi's `visitEndedHandler` / Next chapter read the entry scene-open used to create?
7. **P1 opt-ins** (first scene, open-scene cast refresh, AI form answer): Mundi (M3) and the Crawler applet (M4) must opt in through shape if they rely on them.
8. **Item 15 layout reset** clearing widget settings/style pins: does a session-mounted applet frame hold per-widget settings this would wipe?
9. **Files in flight**: the client/shared/server files this build edited today in trees the M2e lanes own are listed in the message; this plan's builders stay out of `server/plugins/**`, providedMarks, lorebook list rows, AppsSidebar and `/apps` until the M2e reports land.

## Build plan 2 — the ruled set (go: owner 2026-11-04 "Okay get to work"; the M2e lead has the same go in parallel)
Rules: `.claude/guides/multi-agent.md` + `review.md`. Two supervisors at a time, ≤2 workers each; `plan-challenger` on this section first; `scope-reviewer` + `/code-review` after each lane; one grouped verification by the lead at the end. Lane ids `playtest2-<letter>`; briefs `plans/briefs/BRIEF-playtest2-<letter>.md`; reports `plans/REPORT-playtest2-<letter>-2026-11-04.md`. NOMENCLATURE §25 rows are written by the lead from each report.
**Reconciliation with M2e (answers received 2026-11-04, all nine accepted):** files are claimed by name, never by tree; every file is re-read immediately before an edit. Until both `plans/REPORT-m2e-D-2026-11-04.md` and `REPORT-m2e-C-2026-11-04.md` are FILLED IN (Changed files + Tests run, not "(pending)") or the M2e lead (session serene-pub-e3) says they landed, no lane edits: `src/lib/shared/sockets/types.ts` (lane D's file; type lines are queued to the lead), `server/plugins/providedBooks.ts`, `providedMarks.ts`, `starterKits*`, the lorebook list/picker/attach server readers, `sessions/settingsForm.ts`, `appletDoor.ts`/`appletCause.ts`, `db/defaults.ts`, `core-catalog/src/loadouts.ts`, `shared/sessions/declaredFieldRefusal.ts`, `client/**/navigation.ts`, the plugin page, the admin Starter lorebooks page. The four new shape fields (`history.back?: 'message' | 'turn'` default `turn`; `scenes.first`, `scenes.castRefresh`, `forms.modelAnswers`) are added by the LEAD in one SDK pass (descriptors.ts, one sdk-tests re-pin, Story's declaration lines, one sdk:build) only after `plans/REPORT-m2e-D-2026-11-04.md` lands — lane m2e-D (under session serene-pub-e3) is editing `descriptors.ts` now. Until then every lane reads the fields from the shape as `unknown`. The "immutable row" predicate is `server/plugins/providedMarks.ts` (`markedBook`, `isDisabledProvidedBook`, `shownLorebook`), never `extra_json.provided` raw. ★A2 is a `personMay` thing kind `{ kind: "reply-run", sessionId, runId }` with op `"write"`; no fourth op, no `stop` string. Compile rule (§0-B): *a scene compiles into the history entry of its date when one exists on the book, else creates that dated entry; scene open creates nothing.* Opt-in shape fields 🚧: `scenes.first`, `scenes.castRefresh`, `forms.modelAnswers`; absent = off; Story sets the first two.

| Lane | Wave | Owns (by name) | Builds |
|---|---|---|---|
| **A** actions · clock | 1 | `server/auth/actingPerson.ts` (the `reply-run` thing), `pipelines/runtime/runRegistry.ts`, `sockets/pipelines.ts` (cancel), `pipelines/runtime/dispatch.ts`, `pipelines/prompt/endOnUserTurn.ts`, `state/clockMoves.ts` + the reckon/keeper writer of the model's move, the narrator-cadence files (item 7, located by the lane), SDK `sdk/src/storyTime.ts`, `core-catalog/src/genres/story/ask.ts` + its registration, the form-answer spine file(s) + `forms.modelAnswers` reading; client `turnFlow.svelte.ts` / `messageControls.svelte.ts` only if the Stop path needs it; docs `genre-story.md`, `lorebook-time.md` | ★A2 any member stops a waiting reply (via `personMay`; retire the `ownedSessionId` check); (item 7 moved to lane T, wave 3); item 11 keep text, drop both labels, no prefill; 13a the model's move dropped after a manual Time passes in the same turn; 13c dayless clock starts counting days at midnight; §0-F Ask retired from Story; the AI form answer gated on `forms.modelAnswers` (off in core, cause on the line) |
| **H** Back | 1 | `server/sessions/rewind.ts`, `shared/sessions/rewind.ts`, `client/.../requests/rewindTurn.ts`, `Header.svelte`, `FullscreenExit.svelte`, `sockets/sessions.ts` (one block: the rewind refresh when a reply run ends), `docs/sessions.md` § Back | §0-A one message per press when the genre's `history.back === 'message'` (read from the shape, default `turn`; routine lines filed on the message go too); ★H1 refresh `rewind` when a reply run ends; ★H2 person-line count at a table; title words per step size |
| **S** scenes · history | 2 | `server/scenes/liveScenes.ts`, `boundaryWatcher.ts`, the compile writer, `sceneNameFor` + the scenes name storage, SDK `sdk/src/sceneSettings.ts` + `descriptors.ts` scenes block (the two opt-ins), `core-catalog/src/genres/story/*` (Story's opt-ins, the *Summarize the story* routine), migrations via `db:generate` (★4b), `docs/sessions.md` § Scenes, `docs/lorebook-time.md` | §0-B compile rule above + no entry at open; *Summarize the story* retired; item 2 first scene under `scenes.first` (Suggested → cue, Automatic → placement, new sessions only); open-scene cast refresh under `scenes.castRefresh` with its cause on the line; ★4b default names computed at render, only custom names stored |
| **W** layout · UI copy · rename | 2 | `styles/widgets.css` + SDK `core-catalog .../widgets.ts` (Line width default), `sessionLayout/*` (reset), `sessionPage/sessionLayoutData.svelte.ts`, the Channel/Channel lane field components, the stopped-widget overlay, the Characters view labels + phone bar + `docs/characters.md` + Home heading (item 12), `docs/session-layout.md`; queued for lane C of M2e: `CONTENT_ORDER`/`rightNavOrder` label text | §0-G default = container width; item 15 layout reset clears settings + style pins for placed widgets, widget Reset keeps style + a Style reset beside it; item 18 *Default (main)* named choice; ★W1 copy; item 12 "Character cards" (sentence case, A+B, "Cards" on the phone bar with full `aria-label`, route + icon kept) |
| **T** narrator cadence (item 7) | 3 (after M2e-D is filled) | `core-catalog/src/registry/genres.ts:242-250` (`NARRATOR_INTERJECTIONS_FIELD` → the cadence choice `off · every round · every 2nd · every 3rd`, no position field: after the cast is ruled), `factories/turnOrder.ts:71`, `TurnPicker.svelte` / the Turn order widget (the one control, P4 sentence), a read of old boolean values (`true` → every round, `false` → off; test) | item 7: the narrator speaks after the cast every N rounds; never a second reply under Next turn; cause on the line |
| **L** lorebooks | 3 (after M2e reports) | cast member schema columns (override name/nickname/portrait → `db:generate`), `lorebooks/cast/*`, cast readers (`castPool.ts`, the prompt's cast names), the lorebook export/import of the override, the RAG notice (`ragNotice.ts`, `RagNotice.svelte`) + Activity feed writer, `docs/lorebook-cast.md`, `docs/embeddings-and-rag.md` | §0-D book-only override, refused on a `markedBook` row with the PROVIDED_BOOK sentence family; §0-C indexing progress to Activity, composer keeps *no index* + *stale* only; owners see progress for their own books |
| **C** connections · models | 3 (after ★47 lands in `defaults.ts`) | `db/defaults.ts` (ONNX seed rows, after ★47), `connections/*` fold + undeletable rule, `localOnnxModels.ts` fetch gate, `connections/finder.ts`, `ModelFinderView.svelte` + `ModelsSidebar.svelte` (quant picker + Add by name inline), `docs/connections.md`, `docs/embeddings-and-rag.md:171` | item 17 two rows *Local embeddings* / *Local named entities*, `seedKey` no id, second-boot test, extras folded in, undeletable, no loadout filled, never the active one per modality by seeding; item 16 closes with it + `local_models` keyed per modality; item 20 quant picker + Add by name inline, Set up chat stays a dialog |

Not in this build: the `nonCastLabelsFor` per-dispatch scan (follow-up), ★13d (ruled no), Set up chat (stays), admin starter kits (M2e's), anything on the M2e stay-out list above.
**Challenger round on Build plan 2 (2026-11-04, one round) — five objections, all accepted (one in part):** (1) the M2e gate is "report filled in or the M2e lead's word", not "file exists"; `shared/sockets/types.ts` joins the stay-out list, type lines queue to the lead. (2) Item 7 needs M2e lane D's files (`registry/genres.ts`, `factories/turnOrder.ts`, `settingsForm.ts`) → moved out of lane A into lane T (wave 3), cadence as the plan's enum, old boolean mapped and tested. (3) "reply run" is `runKindOf === "reply"`, never a negation; `personMay(db, person, op, thing)` argument order fixed; a member-cannot-stop-a-routine test added. (4) 13c: accepted in part — the behaviour is ruled, the representation (a day with no month, `storyTime.ts:412`, `formatStoryTime`, `compareDates`) is a stop-and-ask inside lane A before any edit; old dayless rows read unchanged. (5) ★H1 uses the existing `sessions:runEnded` broadcast, no new event; `history.back` is the lead's after M2e-D.

### Wave 1–2 status (lead, 2026-11-04 afternoon)
- **H** built (one-message Back, title words); scope review no objection; ★H1 decided (rides `sessions:actions`, built by the lead after M2e-D). Code review (A+H, 10 findings): fixed — the hand-move check now covers the turn since the previous reply (not the same anchor), the one-message unit floors the opening run too and describes its first row, a late cancel reports `found:false`, a malformed keeper step is never "dropped", `replyView` imports `stops.ts`'s label helpers; as ruled — the form gate is off for every genre until one opts in; pending the SDK pass — `history.back`; follow-ups — `rewindStateOf`'s repeated reads, the cancel handler's double decision; the other programme's — `frameCause` plumbing. The retake red was the lead's own morning floor; fixed (opening run's yield never floored).
- **A** built except 13c (→ lane A2, Proposal A accepted) and ★A3 (owner: the cause on an AI form answer — build when the first genre opts in). Lane's own scope review: no objection.
- **S** built the first scene + cast refresh opt-ins and retired *Summarize the story*; §0-B + ★4b → lane S2 (★S-1 accepted: one migration, `name_is_default` marker); ★S-2 leave old entries; ★S-3 Manual is the off switch; ★S-4 (owner): where a scene's cause shows; S-B2 (owner): Compile by date UI. `story-sweep` hash re-pinned.
- **W** built all five; ★W2 lane default label → *Default (whole channel)* (lead); ★W3 (owner): an SDK "named unset" field option so the Album's fields derive too.
- **Lead pass after M2e landed (13:xx):** the four shape fields declared (`history.back` on `GenreDecl.history`; `scenes.first`, `scenes.castRefresh`; `forms.modelAnswers`), Story declares all three + `back: 'message'`; `sweep-duties` loses `summary` (binding reads + `dutyModes` follow; the boot gate had tripped); `types.ts` gains `rewind?` on the actions push and `clearPlacedWidgets?`; ★H1 built; the sweep spec re-pinned; scope reviews S (5, answered; ★S-3 → owner) and W (3, fixed) closed; docs renamed to *Character cards* (W's queue); STYLE-GUIDE §1.11, §3.4, §12 updated. Open for the owner: ★S-3, ★S-4, S-B2, ★A3, ★W3, the Mundi date-rule export. Pending: lanes S2, C building; L and T queued; `specHashes` five `*-create` pins are M2e's to re-pin.
- **Cross-programme code review (M2e lead, 13:30):** two findings taken — a form addressed to an AI-portrayed participant in a genre without `forms.modelAnswers` no longer stalls: the press door treats it like W4's "nobody" (the owner may answer; a guest's press is refused with the sentence); `scheduleCounts("list" | "change")` skips only a re-list inside a direct ask's window, never a change. Tests added in `sessions.forms.int` and `lorebooksWorkspace.counts.dom`. The Lair's forms are owner-addressed, so Roll was never affected.
- **S2 landed (13:50):** migration 0142, compile-time filing, render-time names; 217 tests green. **★S2-1 (owner, user-visible):** the Chronicle shows a session's new scenes only once compiled until S-B2's *Not yet compiled* group ships — recommend ruling S-B2 now (a *Not yet compiled* group at the top of the History lens, scenes by date, one **Compile** per date) so S-B1 and S-B2 ship together. ★S2-2: where an unfiled scene opens from TimeLens/Graphs (with S-B2). Lane L started; C building; T queued.

### Open for the owner after build 2 (collected 2026-11-04 afternoon; asked in one batch at the end)
- **★S2-1 / ★S2-3 / S-B2 (user-visible, blocks shipping §0-B):** the Chronicle lists only compiled scenes, so a session's new scenes are invisible until compiled; lane S3 lets a day's entry compile its unfiled scenes, but the *Not yet compiled* group (scenes by date at the top of the History lens, one **Compile** per date, which creates the dated entry) is S-B2 — recommend ruling it now so S-B1 and S-B2 ship together. ★S2-2 rides with it (where an unfiled scene opens from TimeLens/Graphs).
- **★S-3:** Scenes › How scenes begin = Manual is the cast refresh's off switch; reverses the live-scenes G3 line (2026-10-13, built on recommendations: "in every mode, Manual included, since a person's own scene has a cast too"). Recommend keep (the ruling asked for a switch and no new setting).
- **★S-4:** nothing shows why a scene opened or its cast changed (audit rows 12/14; predates the build). Recommend `scenes:list` rows carry `openedBecause` + `castCause`, `ConversationSceneV1` the same, the divider shows them. Needed before release for P1.
- **★A3:** the cause on an AI form answer (`FormAnswered.byModel?`, *Answered by the AI · Tom*). Recommend build when the first genre opts in (none does today).
- **★W3:** the Channel/Channel lane named-default control is host-side for the `messages` widget (P5 exception). Recommend an SDK field option for a string's named "unset" choice so the Album's fields derive too — a new published SDK name.
- **★C-4:** the two local ONNX rows are deletable where the runtime can't load (nothing re-creates them there; an *Unavailable* row would stay forever) vs the ruling's bare *undeletable*. Recommend keep.
- **★C-5:** the ONNX list is still fetched on the first admin open of Connections/Models (`connections:list` → `localModelStates` → `catalogMapFor`), ≤ once per 24 h, though the boot warm is gated as ruled. Recommend (a): the list uses the cached/built-in catalogue unless a model is on disk or a loadout names the row.
- **Mundi (M3):** the §0-B date-match rule (`historyEntryOfDate`) must be exported from the SDK (pure function or core task) for the port's `diary-into` to delete its copy; today the two rules differ (Mundi prefers the empty entry of the date, core the highest position).
- **★S2 docs/attic:** a Back/Forward scene snapshot saved before 0142 restores as a custom name (noticed, not checked).
- **★L-2:** the member's face does not travel in the book file (no pictures in the format; a version bump) — recommend wait for export's return. **★L-3:** an own Name drops the card's nickname unless the book gives one — recommend keep. **★L-4:** *not indexed yet* keeps **Prioritize in queue** beside the setup link — recommend keep (actionable).
- **★T-1 (P1, user-visible):** the cause on the narrator's own line — a `turnCause: { via: "unprompted", every: n }` metadata key stamped at insert, drawn by the SDK's `SessionMessage.svelte` as *Narrator's turn (every 2nd round)*, a press opening the turn picker. Needs `host.ts`, `runTurn.ts`, an SDK component, two new names. Also: a *Spoke up* badge for *Let others speak up* lines? members see the badge with the press refused, or not at all? **★T-2:** rename the label *Narrator asides* → *Narrator's turn* with it. Recommend both.
- **Lanes landed 15:xx:** S3 (review name, Compile gate; filing at Apply → S4), T (narrator cadence; cause → ★T-1), L (own names, Activity indexing; readers → L2). Building: L2, C2. Queued: S4. Then: `/code-review` over W, S2, S3, C, L, T, L2, C2, S4 diffs; the grouped verification (tsc, check, sdk:build + sdk:test, npm test, build; re-pins: `coreCatalog` golden `680a98aec32065c7`, `story-create@2.2.0` `12c47aecb2baa0`, `sweep-duties@1` current; the attic upgrade int files for 0142/0143).
- **Code review over the landed lanes (lead, 16:xx; `/code-review high`, 32 source files, 10 findings):** fixed by the lead — a recount landing after the lane's `idle` no longer re-raises an indexing card (`idleGeneration`, test added); `connectionNameTaken` reserves the two fixed names only against a NEW claim (a pre-existing other-type row named *Local embeddings* keeps saving); the stray `import type { Db }` in `castOwnNames.ts` (ambient type) removed. Handed to lane S4 (in flight): one helper for the scene-day → entry rule (compile, Apply, count, export; grouped by (branch, day); a `BranchRefusal` skips a group); the count follows the entry's own line; filing on `acted` by rule, ids as a hint; `sceneReplyRow` and the graph builder's prompt read display names. Owner: ★S-4 (the cast refresh's cause shown nowhere — the review re-raised it). Recorded, not fixed: `foldConnectionInto`'s blind FK repoint can collide on a unique key that includes `connection_id` (e.g. `logit_bias_tokens`); the fold then rolls back, logs, and leaves the duplicate row (safe) — a per-table duplicate pre-delete like `connection_scripts`' is the fix, with the fold's next change. Known limit (S4 Noticed): a compile activity lost to a restart leaves that compile's scenes unfiled though the entry was saved; the next compile re-reads them.

### Grouped verification, build 2 (lead, 2026-11-04 evening)
- `sdk:build` green (no dev server) · `sdk:test` 4136 tests, 1 pre-existing red (`shared/speakMessage.ts` spelling allowance, the speech programme's) after re-pinning the moved golden/create/`sweep-duties` hashes and the data-path count 172→169 with dated notes · `npm run check` 0 errors of this build's (1 remaining: M2e's `admin/sections/plugins/IdPage.svelte:304`) · `tsc` 1 pre-existing (`arrangeCanvas.dom.test.svelte.ts:11`) · `npm run build` green.
- App suite (`vitest run --maxWorkers=3`, 20 G scope, 73 min): 1921 files, 21148 passed, 137 failed in 43 files — then rerun against the current tree: **the twelve int files the `defaults.ts` import chain had broken all pass** (the M2e lead's structural fix, `utils/androidWrapper.ts`); fixed by the lead since the run: the two picker tests (the ONNX types are no longer offered), `sessions.enabledWhen.int` (its genre opts into `forms.modelAnswers`), `registryHashes` `sweep-duties` pin, `resolve.int` (Ask retired, `summary` gone), `specHashes` `story-sweep` pin. **Three are the M2e lead's** (told): `socketEgress` (two raw `starterKits:list` emits in `plugins.ts`/`starterKits.ts`), `onnxRuntime.test` + `embedding/index.test` (their barrel mocks of `isAndroidWrapper` miss the new leaf). **Pre-existing** (red before build 2, speech/applet/M2 area, none in this build's files): `importBoundary` ×4, `wiring` ×2, `paramsSlotWiring` ×2, `stopsWiring`, `combos`, `capabilityGuard`, `probeCapabilities`, `allPipelines`, `presetFallback`, `sessionAdmin.presetActions`, `commentHistory`, `coreRow` ×2, `placedNodeReconcile`, `genreFieldDefaults` ×3, `sessionGenres.int`, `publishedValues.int`, `seedVariableTemplates`, `variableTemplates.parity`, `sessions.forms.int` (the parked-action R-b case), `scoreLedAllocation.int` (★47's seeded sampling window, M2e's). Five app-side `*-create` spec pins are re-pinned by the M2e lead.
- Migrations this build: **0142** scenes unfiled + default names, **0143** lorebook_bindings own names, **0144** local_models per-modality key; each with a second-boot test; the attic `fresh.int` green.

## Rulings, round 2 (owner, 2026-11-04 evening — the ★s build 2 raised)
- **S-B2 → build now, ship with §0-B:** a *Not yet compiled* group at the top of the History lens, scenes by date, one **Compile** per date that creates the dated entry if none exists; ★S2-2 (where an unfiled scene opens from TimeLens/Graphs) decided with it.
- **★S-4 → on the scene divider:** scene rows carry `openedBecause` + `castCause`; `ConversationSceneV1` the same (optional); the divider shows them under its name and in the faces' title.
- **★T-1 + ★T-2 → build the badge and rename:** a `turnCause` metadata key stamped at insert on an unprompted narrator line, drawn by the SDK's `SessionMessage` as *Narrator's turn (every 2nd round)*, a press opening the turn picker; the setting's label becomes **Narrator's turn**. Members see the badge; the press is theirs only if they may change the setting.
- **★C-5 → gate the list projection too:** `connections:list` uses the cached/built-in catalogue unless a model is on disk or a loadout names the row.
- **★C-4 → "only the default onnx connection, not the model":** the two app-made connection ROWS are undeletable everywhere (the lane's "deletable where the runtime can't load" exception is reversed); models are what a person deletes (Delete from disk).
- **★L-2 → wait for export; the face override stays in the app** (no format change now).
- **★L-3 → the card's nickname stays unless the book gives one** (reverses lane L's rule): `nickname = ownNickname ?? card.nickname`; a renamed member shows by the card's nickname until the book gives or clears one.
- **★L-4 → keep both** (*Set up search by meaning* and *Prioritize in queue*).
- **★A3 → when the first genre opts in** (not now). **★W3 → add an SDK field option for a named "unset" choice**, so the Album's Channel and Show another channel inline derive it too. **★S-3 → keep** (Manual is the off switch). **★C2-1 → keep** the bulk-delete wording.

## Build plan 3 — round-2 rulings (lead, 2026-11-04 evening; same rules as Build plan 2; M2e's lanes have landed, their reports filled — the stay-out list is lifted except `defaults.ts`'s import rule: nothing that reaches the utils barrel or `media/`)
| Lane | Wave | Owns (by name) | Builds |
|---|---|---|---|
| **S5** scenes · lorebooks UI | 1 | `sockets/scenes.ts` (compile-by-date, `create: true`), `shared/sockets/types.ts` (`Compile.Params` by date; scene row `openedBecause`/`castCause`), `scenes/unfiledScenesByEntry.ts` (read), `client/lorebooks/sections/*` (the *Not yet compiled* group), `time/TimeLens.svelte`, `GraphsWorkspace.svelte` (★S2-2), `CompileHistoryEntryModal.svelte`, `scenes/boundaryWatcher.ts` + `sessionEvents.ts:284` (the cast cause reaches the row), SDK `contracts` `ConversationSceneV1` + `core-catalog .../SceneDivider.svelte`, docs `lorebook-time.md`, `sessions.md` § Scenes | S-B2 + ★S2-2 + ★S-4 |
| **T2** narrator cause | 1 | `pipelines/runtime/host.ts` (the insert stamp; `via` on the scope), `runTurn.ts`, SDK `sdk/src/widgets.ts` (`MessageMetadataV1.turnCause`), `core-catalog .../SessionMessage.svelte` (the badge part), `core-catalog/src/registry/genres.ts` (the label), `TurnPicker.svelte` (the press target), docs `genre-story.md` | ★T-1, ★T-2 |
| **C3** connections | 2 | `sockets/connections.ts` (the delete gate; `localModelStates` → the catalogue gate), `localModels/onnxCache.ts` callers, `connections/modelManagement.ts` `connectionComesWithApp`, `sidebars/ConnectionsSidebar.svelte`, `admin/.../IdPage.svelte`, `Page.svelte`, tests, `docs/connections.md` | ★C-4 reversal (undeletable everywhere), ★C-5 |
| **W4** SDK field option | 2 | SDK `sdk/src/descriptors.ts` (the string field's named-unset option), the server form deriver (`sessions/settingsForm.ts` draws it), `sessionLayout/WidgetSettingsPanel.svelte` (drop `CHANNEL_FIELDS`; derive), `ChannelDefaultField.svelte`, `core-catalog/src/registry/widgets.ts` (Messages + Album fields declare it), tests, `docs/session-layout.md` | ★W3 |
| **L3** nickname rule | 2 | the eight tests pinned on the old rule (`castPool.test`, `retold.int`, `castOwnNames.int`, `sessionPageProjections.castNames.test`, `rowProjection.castNames.int`, `memberIdentity.test` done), `docs/lorebook-cast.md` sentence, `CastMemberForm.svelte` help line if it states the rule | ★L-3 (the rule itself is changed by the lead in `memberIdentity.ts`) |
Challenger first; scope review + `/code-review` per lane; one grouped verification at the end.
**Challenger round on Build plan 3 (2026-11-04, one round) — five objections, all accepted:** (1) the Chronicle half leaves S5 (its contract `HistoryEntriesV1` has no unfiled-scenes field; a new SDK name) → **★S2-1b (owner):** does the Chronicle get the *Not yet compiled* group too? (2) T2 stamps only the NARRATOR's unprompted line (a *Let others speak up* side-cast pick shares `via`), strips a spec-supplied `turnCause` like `answersForm`, negative tests added. (3) W4's option is `unset: { label; other }` on `FieldDecl` (`settings.ts`), string fields only, the box's placeholder = `description`, no `help`; `interleave` is the Messages widget's. (4) L3 never promises "clear the nickname" — a blank reads as the card's → **★L-3b (owner):** is a stored book-level "no nickname" wanted (a stored-data change)? (5) S5 derives `castCause` at read in `liveScenes.ts` (no second writer, P2), `sessionEvents.ts` untouched; paths fixed (`sessionDossier.ts`; `localModelStates` in `onnxCache.ts`; C3's gate in `localModels/` taking `db`).
- **Round-2 follow-ups ruled (owner, 2026-11-04 evening):** **★S2-1b → yes**, the Chronicle lists the *Not yet compiled* group too (a *Not yet compiled* section under Now with the same Compile per date; one optional field on `HistoryEntriesV1`) → **lane S6** after T2 releases `sdk/src/widgets.ts`. **★L-3b → "just give the name fields a *Use from card* toggle"**: Name and Nickname each carry a **Use from card** toggle — on = the card's reads through (stored NULL), off = the book's own value, which may be blank (an own empty nickname = no nickname in this book; stored `""`, no longer normalised to NULL) → lane L3 widens to the form, `normaliseOwnNames`/`ownNameValue` semantics and the readers' tests.
- **Build 3 status (late evening):** T2 landed (badge + rename; member sees words, owner a button — ★T2-1 applied), S5 landed (group, Compile by date, divider causes; render sites wired by the lead), S6 landed (the Chronicle's *Not yet compiled* section; **★S6-1 (owner):** its per-day **Compile** needs a new request kind `compile-history-entry { date }` — a published SDK name; alternative: the button opens the History lens; **★S5-1 (owner, copy):** *Began by itself: ‹…›* + its title; **★T2-2 (owner, low):** a `title` sentence on the narrator badge). Building: C3, W4. Queued: L3. Then scope reviews (T2, S5, S6, C3, W4, L3), `/code-review` over build 3, grouped verification round 2.
- **Build 3 code review (lead, `/code-review high`, 26 files, 10 findings):** fixed by the lead — the summary transcript and the scene cast proposal name a member by its plain name (own name applied), never nickname-first (`memberNames(...).name`); `connections:update` refuses a type change to or from a local ONNX type. Handed to lane S7 (resumed): `relistEntries` in `afterBoundaryPlaced`; `compileReplyTo` pruned on acted/discard; the modal's Undated stand-in + narrowed adoption; one `sceneStartOf`; the dead `castRefreshed`. New lane **A4**: the `forms.modelAnswers` gate suppressed every `form-addressed` registration, not only core's answer — the event dispatches again, core's answer spec halts without opt-in. Recorded as follow-ups (perf): `unfiledScenesByEntry`'s per-group `historyEntryOfDate` re-reads on every relist; `sceneDisplayNames` quadratic + `sceneCauses` sequential context reads on whole-book lists. Scope reviews T2, S5, S6, C3, W4, L3: all in scope; their fixes applied. Owner ★s raised by build 3: ★S6-1 (Compile in the Chronicle needs a request kind `compile-history-entry`), ★S5-1 (divider copy), ★T2-2 (badge title), ★W4-1/★W4-2 (two labels, two descriptions), ★L-3b-a (placeholder *No nickname in this book*), ★L-3b-b (the two switches' opposite "on").
- **Rulings, round 3 (owner, 2026-11-04 night):** ★S5-1 keep; ★W4-1/2 keep; ★L-3b-a build the placeholder *No nickname in this book* (done by the lead); ★L-3b-b keep both switches as built; **★S6-1 → "maybe trigger the lorebooks compile pipeline?"** — read as: the Chronicle's per-day Compile sends a host request that starts the by-date compile run directly, no modal (the review activity arrives as for any compile); a published request kind, named in its build → **follow-up lane S8**. Recorded follow-ups: ★S7-2 (Undated adoption echo), ★T2-2 (badge title), the perf notes, the lore-writes/post-commit windows.

### Grouped verification, build 3 (lead, 2026-11-04 night)
- `sdk:build` green · `sdk:test` 4149 tests, 1 pre-existing red (`shared/speakMessage.ts`, the speech programme's) after re-pinning the golden (`18bf38bb12b441f6`) and story-create (`1251225374524a`, both moved by the narrator label and the `unset` option) · `npm run check` **0 errors** · `tsc` 1 pre-existing (`arrangeCanvas.dom.test.svelte.ts:11`) · `npm run build` green.
- App suite (`vitest run --maxWorkers=3`, 20 G, 58 min): 1934 files, 21372 passed, 30 failed in 23 files — **every one pre-existing or settled**: the speech/applet/M2 set (`importBoundary` ×4, `wiring` ×2, `paramsSlotWiring` ×2, `coreRow` ×2, `commentHistory`, `combos`, `capabilityGuard`, `probeCapabilities`, `stopsWiring`, `allPipelines`, `presetFallback`, `sessionAdmin.presetActions`, `genreFieldDefaults` ×3, `sessionGenres.int`, `publishedValues.int`, `seedVariableTemplates`, `variableTemplates.parity`, `placedNodeReconcile`, `atticStash`, `0108_layering_registrations`, `scoreLedAllocation.int` — M2e's ★47 window), `sessions.forms.int` (the parked-action R-b case; another lane's `askedRunId`), and `specHashes` story-create re-pinned (`1251225374524a`, agreed with the M2e lead). The twelve import-chain files stay green.
- Reviews: challenger (5/5 accepted), scope reviews T2, S5, S6, C3, W4, L3, S7, A4 (all in scope; fixes applied), one `/code-review` over build 3 (10 findings: 4 fixed by the lead, 5 by lane S7, 1 by lane A4).

## Build plan 4 — the open items (owner, 2026-11-04 night: "start on whatever is left open"; same rules as Build plan 2)
Not built, as ruled: ★A3 (the AI form answer's cause mark — when the first genre opts in), ★L-2 (faces in the book file — with export's return). Everything else:
| Lane | Wave | Owns (by name) | Builds |
|---|---|---|---|
| **S8** Chronicle compile · adoption | 1 | SDK `sdk/src/widgets.ts` (one request kind), the Chronicle component + its test, `sessionPage/requests/index.ts` (the handler), `utils/activityStore.ts` (`byDate?` on the compile activity), `src/app.d.ts` (`CompileEntryState.byDate?`), `sockets/scenes.ts` (echo the ask on the activity), `CompileHistoryEntryModal.svelte` (adoption by the echoed ask), `docs/sessions.md` Chronicle paragraph, the widgets guide regen | **★S6-1** (owner: "trigger the lorebooks compile pipeline"): 🚧 request kind `compile-history-entry { date: StoryTime \| null }` — the Chronicle's per-day **Compile** (`chronicle.unfiled-compile`) sends it; the page's handler starts the by-date `scenes:compile` run directly for the session's line at now, no modal; the review arrives through the compile activity as for any compile. **★S7-2:** the by-date ask echoed on the activity (`byDate?`, memory only) and carried into `CompileEntryState`; the modal adopts only an activity whose ask matches |
| **P1** scene perf | 1 | `scenes/unfiledScenesByEntry.ts`, `scenes/historyEntryOfDate.ts` (a pure picker both share), `scenes/liveScenes.ts` (`sceneDisplayNames`, `sceneCauses`), tests | the two recorded perf notes: the day→entry resolution reads the line and the history rows once per call and matches groups in memory (one rule kept: `historyEntryOfDate` and the batch path call the same pure picker); `sceneDisplayNames` linear (per (session, channel) lane, sorted starts, a Set); `sceneCauses` reads scene contexts in parallel |
| **C4** connection fold | 2 | `connections/connectionFold.ts` + test | the recorded fold hazard: before repointing an FK table whose unique key includes the connection (or model) id, delete the source's rows that would collide with the target's (the `connection_scripts` pre-delete generalised by introspecting unique indexes); test with a `logit_bias_tokens`-style collision |
| **Lead** | — | SDK `SessionMessage.svelte` | **★T2-2:** one `title` sentence on the narrator badge |
Challenger first; scope review + `/code-review` per lane; one grouped verification at the end.

**Challenger (build 4, 2026-11-04 night) — five objections, all applied to the briefs:** (1) the request kind is `'core'`, not `'any'` — `WIDGET_REQUEST_ASKERS` names which *widget* may ask, every lorebook-writing sibling is `'core'`, and narrowing later would be a break; (2) `scenes:compile:error` is a shell-handled event the modal alone listens to, so a Chronicle refusal would vanish — the request is settled on its own reply through a `requestId` on the by-date ask (the existing wire pattern), echoed on the error, and the modal ignores another ask's refusal; (3) `Layout.svelte` maps compile activities field by field and would drop `byDate` — added to S8's files (that mapping only); (4) P1 keeps the line **per scene** (`lineOfBook` once per distinct scene branch, memoised), never per call, with a fork-only-entry fixture; (5) P1's numbering keeps the strict-earlier count so tied starts share a number. No objection to C4 (Drizzle exposes unique indexes; SQL/partial ones are skipped with a warning) or to ★T2-2's titles.

**Lane status (build 4):** P1 **DONE** (report `plans/REPORT-playtest4-P1-2026-11-04.md`; scope review: no objection; §25 row written; note: the eight scene int files need `--maxWorkers=2` inside a 6 GB scope).
C4 **DONE** (report `plans/REPORT-playtest4-C4-2026-11-04.md`, saved by the lead; scope review: no objection — notes: composite PKs/column-level unique counted too, decided within scope; no model-id-loop collision test because no table has such a key today; §25 row written). ★T2-2 **DONE** (lead; §25 row).
S8 **BUILT** (report `plans/REPORT-playtest4-S8-2026-11-04.md`, saved by the lead; scope review pending; §25 row written, S6/S7 rows amended; queued doc lines added by the lead: `docs/session-layout.md` Chronicle row, STYLE-GUIDE §6.16). **Open for the owner:** ★S8-1 copy — dated title *Compile this day's scenes into the history entry of ‹day›, making it if there is none*, Undated title *Compile the undated scenes into the newest dated history entry, making one if there is none*, refusal *only the lorebook's owner compiles its history* (lane recommends keep); ★S8-2 helper names — `ChronicleView.unfiled[].compile`, `compileEntryStateOf`, `answerCompileHistoryEntry`/`CompileHistoryEntryDeps`/`compileByDate` (recommend keep; alternative: the widget reads dates from `answer.unfiledDays` by index, copying the filter rule).
S8 scope review: no breach; four low notes — `compileByDate` near-copies `awaitReply` (→ lane R), the new `modals/compileEntryState.ts` is ★S8-2's, the fallback sentence *the day's scenes could not be compiled* and the module-local names (`ByDateAsk`, `CompileFrame`, `sameDay`, `BAD_DATE`, `absentOrWhole`, `sameAskedDay`, `askedRequestId`) added to ★S8-1/★S8-2 below.

**Build 4 code review (medium, 10 findings) — triage:** fixed in lane **R** (`plans/briefs/BRIEF-playtest4-R.md`): a by-date window drops its own refusal when the entry is not yet known (F1); a window adopts another window's or the Chronicle's run of the same day, then flips to error on its own *already in progress* (F10 — the activity's `byDate` now echoes the ask's `requestId`, the one key both adopt on); `openScene` lost `fileSceneUnder`'s line check (F3 — re-added, old sentence); the by-date `waiting` filter rewrites the scene-day rule (F4 — `sceneDay` exported, one rule); a blanked name is rebuilt from the pre-update scene (F9); `compileReplyTo` holds the pressing socket (F5 — user-scoped emitter, as `afterBoundaryPlaced`); sequential independent scene reads (F7 — `Promise.all`). **★ for the owner:** ★R-1 a by-date compile makes the dated entry at the press, so a failed, stopped or discarded run leaves an empty entry (F2) — ★ recommend: the run that made the entry removes it when it clears with nothing filed and no content (deterministic, shows nothing new; alternative: make the entry at Apply, which moves S-B2's creation point); ★R-2 `relistEntries` runs on every scene boundary, rebuilding the history list and the per-line unfiled counts (F6) — ★ recommend: send only the changed `unfiledSceneCount`s and gate the full relist on interest (perf, no behaviour change; medium); ★R-3 the indexing activity cannot be cancelled but can be dismissed, and comes back under a new id on the next tick (F8) — ★ recommend: dismiss refused as cancel is (it ends by itself), the card says so. Noted, not done: F6/F7 remainder (per-scene `placed.filter` in `sceneCauses`, cue-wording awaits).
**★S8-1 (copy) adds:** the fallback *the day's scenes could not be compiled*. **★S8-2 (names) adds:** `ByDateAsk` (in `CompileHistoryEntryDeps`' signature), module-local `CompileFrame`, `sameDay`, `BAD_DATE`, `absentOrWhole`, `sameAskedDay`, `askedRequestId`.
R **BUILT** (report `plans/REPORT-playtest4-R-2026-11-04.md`, saved by the lead; all 8 items; scope review pending; §25 row written).
R scope review: no objection (stand-in socket safe — both paths read only `user.id`/`isAdmin`; `activity:update` is a bare interest key; `askedRequestId` per ask; one nit, the prune comment, fixed by the lead).

### Grouped verification, build 4 (2026-11-04 night)
- `sdk:build` done once by S8 (no dev server at that moment; the M3b isolated server on :5241 came up later — no rebuild needed since, R and the lead's badge title predate it and the dist carries the title) · `sdk:test` 4163 tests, **2 reds, both other programmes'**: `shared/speakMessage.ts` spelling allowance (speech, recorded in builds 2–3) and `every export is tagged` on `CREATE_SESSION_PERSONA_{NAME,DESCRIPTION}_MAX` (M3b's new constants in `sdk/src/widgets.ts`, untagged).
- `svelte-check` **0 errors** (8 warnings, pre-existing) · `tsc` 1 pre-existing (`arrangeCanvas.dom.test.svelte.ts:11`) after the lead fixed two test-typing slips of this build (`CompileHistoryEntryModal.dom.test` `hour` on a `StoryDate` fixture → cast; `unfiledScenesByEntry.int.test` Map value typed by `StoryDate`) · `npm run build` green. Both checks need `NODE_OPTIONS=--max-old-space-size=10240` now; the default heap OOMs.
- App suite (`vitest run --maxWorkers=3`, 20 G, 64 min): 1937 files, 21446 passed, 31 failed in 26 files — 23 files are build 3's recorded pre-existing set (speech/applet/M2 + `sessions.forms.int` R-b); `specHashes` is green. New since build 3: `historyUnfiledGroup.dom` — **this build's**, the History lens's by-date ask now carries a per-press `requestId` (S8/R, by design); the test now expects `expect.any(String)` → green. `branch.clock.int` and `pluginVariables.int` (ENOTEMPTY on the temp data dir at teardown) and `scripts/host.test` (a wall-clock `> 2000 ms` assertion) are load artefacts: all three pass in isolation (4 files / 32 tests green).
- **Build 4 DONE.** Open for the owner: ★S8-1, ★S8-2, ★R-1, ★R-2, ★R-3 (above); ★A3 and ★L-2 wait as ruled.
