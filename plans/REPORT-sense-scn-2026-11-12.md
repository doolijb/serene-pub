# REPORT — build lane `sense-scn` — 2026-11-12 (saved by the lead; condensed from the supervisor's message)

Scene boundaries are a routine the genre registers. Built as briefed, with one stop item (★SCN-1). No migration,
no new column, no new `scene_cues` state.

## The rules as built

- **The scenes routine** — UI name *Find where scenes begin*, id `core:spec/scene-boundaries`, code only. Story
  (Living, Rule Based), the Lair and the Dungeon Crawler register it in their genre defaults on
  `everyNRounds({ n: 2 })` and declare `scenes.mode: 'automatic'` with the triggers they had. Story Minimal drops it
  as it drops the sweep. Chat and the Guide register nothing.
- **Each run reads only standing lines on `main` at least `depth` rounds old** (default 2). A line's age is the
  round in progress minus the line's own round. The boundary is placed at the line where the trigger fired.
- **The walk's start is derived, never stored:** after the latest of the channel's latest scene boundary, its
  latest scene cue that is not `pending`, and, on a branch, its last copied line (the largest id carrying
  `metadata.copyOf`; `sessions.branch_of_message_id` is an id in the source session). With none of these, it starts
  at the first line of round `cur − depth − every + 1` (the lane's addition, so an imported 0.5.3 session's first
  run places nothing in its past).
- **Per line, one read-only evaluator** applies today's per-trigger tests: `opening`, `timeAction` (a `pending`
  marker bound at the line), `dayCrossed`, `placeChanged`, `pause`, `length` (from the walk's own scene start),
  `narration`, and declared triggers. A declared trigger with `actionKey` never fires under the routine (no core
  or shipped document declares one).
- **The re-check:** `placeChanged` is kept only when the place at the walk's last line differs from the place the
  scene began in; `dayCrossed` always holds; the others have none. A kept line is the scene start for later lines.
- **Placing reuses `core:outlet/propose-scene-cue@1`**, which gains an optional `trigger` in-port (absent =
  `judged`, unchanged). Called once per item in line order (a sequential each, `max` 20). With a trigger it refuses
  a trigger the session lacks and `endedHere`; refuses a line inside a placed scene; on a line just opened records
  a second trigger as `placed`; skips while an `open` cue waits at an earlier line (cues at or after the line and
  `pending` markers never refuse); reuses a `pending` or `open` row for that line and trigger; then the mode
  decides (Suggested: the chip; Automatic: placed; Manual: nothing). Under Suggested a run stops at its first offer.
- **A round** is counted by `replayStoryLane` (`routines/moments.ts`), the turn tally's own rule replayed over the
  story's lines, as Back does. Rounds exist only on the story's channel, so the routine reads `main` only (★SCN-2).
- **The per-line hook** (`watchSceneBoundaries`) now only: binds a person's *End scene here* to the landed line and
  opens or offers at once; binds a time action's marker to the landed line and leaves it `pending` (never offered);
  runs the cast refresh. It fires no trigger and never opens `opening`. `noteTimeAction` leaves a marker only on
  `main` and only when `scenesRoutineOn`.
- Story's opening scene now arrives after round 2, not on the first line. Nothing toasts.

## Published names added (🚧, additive)

`core:cadence/every-n-rounds@1`, `EVERY_N_ROUNDS`, `coreCadences.everyNRounds`, `everyNRounds`;
`core:query/scene-boundaries@1` (`C.sceneBoundaries`), `SceneBoundary { at, trigger, reason }`, param `depth`
(default 2, 1–50); the optional in-port `trigger` on `core:outlet/propose-scene-cue@1`; `core:spec/scene-boundaries`,
`SCENE_BOUNDARIES_SPEC_ID`, `SCENE_BOUNDARIES_VERSION`, `sceneBoundariesSpec`; registration key
`every-n-rounds→scene-boundaries` (object key `scenes`); host `sceneBoundariesOf`, `scenesRoutineOn`,
`sceneBoundariesBindings`.

## Provisional copy 🚧

Cadence: "Every few rounds" · "Runs after every so many rounds of the session." · "Every how many rounds".
Query: "Where scenes begin"; `depth` "Rounds it waits" · "Only lines at least this many rounds old are read, so a
line that is swiped, retaken or taken back is never read." Spec: "Find where scenes begin"; "Where scenes begin" /
"Looking for where scenes begin"; "Where the scene begins", "What began it", "Why it began"; "Mark the new scene".
Scene settings: "Scenes here begin only when someone starts one: this session runs no Find where scenes begin
routine." Notes and refusals: "the scene mode is Manual, so a scene cue is never placed or offered" · "‹trigger› is
not a boundary trigger of this session" · "the scene at this line was already placed" · "a scene cue is already
waiting on this channel" · "this line's scene cue was already decided" · "this session places no scenes" · "scenes
are Manual here" · "no line is old enough yet" · "there is no session to look for scene boundaries in — the run is
not scoped to a session". Purpose sentence, not shown (★SCN-1): "Every few rounds, looks a couple of rounds back
for where the day or the place changed, or another moment chosen under Scenes, and begins a scene there, or
suggests one under Suggested. It asks no model."

## Changed files

SDK: `sdk/src/cadences.ts`, `contracts/src/queries.ts`, `contracts/src/outlets.ts`, new
`core-catalog/src/shared/sceneBoundaries.ts`, `core-catalog/src/index.ts` (outside the list: the `CORE_SPECS`
entry), `core-catalog/src/genres/defaults.ts`, `core-catalog/src/registry/genres.ts`, `core-catalog/src/seed/presets.ts`,
`core-catalog/src/genres/dungeon-crawler/summarizeScene.ts` (header), the guide; tests `cadences`,
`coreGenreDefaults`, new `coreSceneBoundaries`. App: `scenes/boundaryWatcher.ts`, new
`pipelines/runtime/sceneBoundaries.ts`, `pipelines/runtime/bindings.ts`, `pipelines/runtime/host.ts` (the
propose-scene-cue case), `pipelines/runtime/sessionEvents.ts` (comment), `SessionSceneSettings.svelte`, docs
(`sessions`, `genre-story`, `genre-lair`, `genre-dungeon-crawler`, `pipelines`), NOMENCLATURE (§4 cadence row, §4
charter row "scenes routine", §9, §25). New tests: `scenes/sceneBoundaries.int`, `pipelines/runtime/sceneBoundaries`,
`pipelines/routines/sceneBoundaries.routine.int`. Rewritten: `boundaryWatcher.int`, `boundaryWatcher.genre.int`,
`liveScenes.autoApply.int`, `sockets/scenes.cues.int`, `registrations/resolve.int`.

## Decisions

One optional in-port on the existing outlet, not a new outlet; one item per line and trigger; the no-anchor
window; `placeChanged` with no open scene compares against the place just before the walk; markers stay off
sessions without the routine; the judged check's code unchanged (it now waits out a bound time-action marker, up
to about four rounds).

## Open ★

- **★SCN-1** no purpose line in the routines list: the SDK refuses `expose.purpose` on a step that calls no model.
  Options: (a) leave it; (b) a published `purpose` on `RegistrationDecl`; (c) let a pipeline that calls no model
  carry its purpose on its first step. Lane recommends (c); it loosens a published rule (the owner's call).
- **★SCN-2** side channels (the Lair's Sanctum, the Dungeon Crawler's parley, private channels) get no automatic
  boundaries: rounds exist only on `main`. A person's Start and End scene still work there.

## Noticed, not done

- A marker bound before a session drops or switches Off the routine stays `pending` forever and blocks the judged
  check.
- Comments in `boundaryWatcher.ts` and the judged path's note still say "lane" for a channel.
- `SessionSceneSettings.svelte` ~116 comment names the retired *new floor* moment.
- Story is Automatic in plain test worlds now.
- `watchSceneBoundaries` still accepts an unused `runIds`.

## Lead's follow-up (2026-11-12)

- Re-pinned with dated notes: `core:spec/story-create@2.2.0` → `2ccd9cc23d00f`, `core:spec/lair-create@1.0.0` →
  `13ccac77f5b4ce`, `core:spec/dungeon-crawler-create@1.0.0` → `26a9094a144b7`, new
  `core:spec/scene-boundaries@1.0.0` `bb370142425c8`; `core:outlet/propose-scene-cue@1` → `19c4d81108b06`, new
  `core:query/scene-boundaries@1` `12e77a18036ca5`; SDK digest → `7bdd67a656bb7ad0`; SDK `lair.test.ts` and
  `writes.test.ts` create pins.
- `EditSessionForm.svelte` passes `sessionId` to `SessionSceneSettings`; `shared/routines/cadenceWords.ts` words
  the new cadence ("Every 2 rounds"), with its test.

## Verification, scope review and fixes (lead, 2026-11-12)

Lead's wider run: 174 files, 1,487 of 1,500 tests pass. Caused by this programme and fixed: the outlet's new
`trigger` input was not listed as read in `pipelines/runtime/bindings.ts` (`declaredReads`); three comments tripped
the wording ratchet (`boundaryWatcher.ts` ×2, `lorebooks/ownBook.ts`); two Lair expectations in SDK `lair.test.ts`
lacked the new routine. Left, not this programme's: speech (`core:oracle/speak@1` unwired), the speech and
sheet-latitude fields in `genreFieldDefaults`, `placedNodeReconcile` failing to load, nine ratchet files. A leftover
of the clock work surfaced: `core:task/clock-step@1.unless` is an in-port no shipped pipeline supplies since the
reply tick went (a published input: the owner's call; queued).

The scope review found the build lane in scope (nothing removed or renamed, no new state) and raised four
correctness points, all fixed:

1. **An open cue nobody can see stopped the routine for good**, and sessions played under the old Suggested default
   usually hold one (an unanswered chip behind a later scene). The routine's "a cue is waiting" check now counts
   only cues the chip would show: after the channel's latest boundary and at a standing line. Test 7b.
2. **A time action's marker that the routine never reads stayed `pending` and switched the judged check off for
   good** (its line taken Back; a scene started past it; the trigger or the routine switched off). The judged
   check counts a `pending` cue only while it is unbound, which is what `pending` meant before this build lane.
   This changes the brief's "the judged check's refusal is unchanged": lead's sign-off. Test 7c.
3. **The walk had no bound**: more than 20 boundaries failed the whole each, and because the start is derived the
   run then failed forever. One run now returns at most 12; the next carries on. Test 7d.
4. The query's fallback for a missing `n` was 1 where the cadence's is 2: now 2.

Not changed, said plainly: an imported session's first run can still place boundaries in the last two rounds of
its imported lines; Forward emits no round end, so one run can be skipped. NOMENCLATURE §25 should also list
`sceneBoundariesOf` and `sceneBoundariesBindings` (queued with the leftovers). The mode's help copy still says a
scene "begins by itself at the line" without saying it happens a couple of rounds later (provisional copy).
