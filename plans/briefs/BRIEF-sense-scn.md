# BRIEF — build lane `sense-scn` — scene boundaries are a routine the genre registers

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then
`plans/DESIGN-e-scenes-2026-11-12.md` (background, and the owner's answers at its end; **this brief replaces its
design items: there are no waiting cues, no preset scenes layer and no change to `DEFAULT_SCENE_SETTINGS` here**);
`plans/REPORT-sense-b2-2026-11-12.md` ("The rule as built": automatic Apply runs when a scene closes); **Story's
sweep as the pattern to copy**: a `C.routine.v1()` routine on a cadence
(`../serene-pub-sdk/core-catalog/src/genres/story/sweep.ts` ~37, registered at `core-catalog/src/genres/defaults.ts`
~242, dropped by Minimal at `core-catalog/src/seed/presets.ts` ~62), whose judged check already calls
`propose-scene-cue` at a past line (`genres/story/reckon.ts`). The round tick is **not** a routine (an event
pipeline; the routines list skips it): use it only as an example of a code-only spec and of a host query binding
(`src/lib/server/pipelines/runtime/roundWorth.ts`);
`../serene-pub-sdk/INTEGRATING.md` (the steps on declaring a node and on routines: read by section) and
`../serene-pub-sdk/guides/genres-presets-and-routines.md`; CLAUDE.md Principles (P1, P2, P5), Hard rules, "0.6 is
in users' hands"; NOMENCLATURE §1, §4, §23, §24, §25; `docs/sessions.md` ~505–520.
`plans/briefs/BRIEF-sense-clk.md`'s **Verbatim rules** bind you and your workers.

Words: a **build lane** is this stream of work; a **channel** is a session's message channel. Never write "lane"
for a channel in anything you add.

## Rulings (owner; verbatim where quoted)

- 2026-11-11: "These will be genre/preset responsibilities, not magic core behavior. I think scenes should be
  closed/created after several messages once the contextual/time/location/presence boundaries are clear. Not right
  on the latest round of messages." Scenes are "Automatic unless off in the session or settings elsewhere. The
  minimal story preset is probably the only example where we will not automatically handle scenes".
- 2026-11-12: "Core does nothing unless declared"; "Existing sessions follow their genre"; "Presence as a trigger,
  later"; "Have core genres detect 2 rounds"; asked whether these are routines, then: "Boundary detection probably
  should be, maybe one the fires every few rounds for efficiency?"
- On an earlier draft: "You're over complicating it." Build the smallest thing that does the items below; where
  two shapes work, take the plainer one and say so in the report.

## The rule to build, in four sentences

A genre that wants scenes handled registers a **scenes routine**: code only, no model. It runs every few rounds
(core genres: every 2). Each run looks only at lines that are at least a declared number of rounds old (core
genres: 2) and still standing, finds where a boundary trigger fired among them, checks it still holds, and places
the boundary there. A genre or preset that does not register it gets nothing: core no longer watches each message.

## Challenger round (2026-11-12)

A cold review raised five objections; all are accepted and folded in below: the sweep is the pattern, not the round
tick; there is no stored "last looked", the start is derived; the walk carries its own scene start and each
trigger has its own re-check; the opening scene belongs to the routine; and the existing cue refusal is handled
explicitly (item 2's last block).

## Build

Begin by re-reading the cited code and listing, in your first worker brief: how the round tick is declared,
registered, dropped by a preset and run; how `watch` (`src/lib/server/scenes/boundaryWatcher.ts` ~676) is called
(`pipelines/runtime/sessionEvents.ts` ~275) and what each trigger in `firedTriggers` (~348) reads; what
`proposeJudgedSceneCue` (~1315) and the outlet `core:outlet/propose-scene-cue` (`pipelines/runtime/host.ts` ~9411)
do; how a round is counted (`ROUND_ENDED_EVENT`, the turn tally).

1. **A cadence "every N rounds"** (`../serene-pub-sdk/sdk/src/cadences.ts`, beside `EVERY_N_TURNS` ~592 and
   `AFTER_EACH_ROUND` ~625): wakes on the round-ended event, option `n`. Additive; propose the id and names through
   NOMENCLATURE §24 (🚧 `core:cadence/every-n-rounds@1`, `everyNRounds`).
2. **The scenes routine** (🚧 `core:spec/scene-boundaries`; a `maintenance` spec like the round tick): one query
   that returns the boundaries to place, then the existing scene-cue outlet for each.
   - The query (🚧 `core:query/scene-boundaries@1`, host binding beside `roundWorth.ts`; **a query writes
     nothing**) walks the channel's standing lines up to the newest line that is at least `depth` rounds old (a
     declared param, default 2), and evaluates the session's enabled triggers line by line with the **same**
     per-trigger tests `firedTriggers` has (extract them so there is one copy).
   - **Where the walk starts is derived, never stored** (a routine's cadence state is the cadence's alone, and
     neither a branch nor a session already in play has any): after the latest of the channel's latest scene
     boundary, the channel's latest `scene_cues.at_message_id`, and `sessions.branch_of_message_id`. So an old
     session's first run and a branch's first run place nothing in the past.
   - **The walk carries its own scene start.** Today's tests read the open scene as it is now (`placeChanged`
     ~446, `length` ~464); in a walk, a boundary it returns becomes the scene start for the lines after it, so a
     second boundary in one run is judged against the first.
   - **The re-check, per trigger:** a place change is kept when the place at the walk's last line differs from
     the place the scene began in (out to B and back to A: nothing; A to B to C: both); a day crossing always
     holds; the others have no re-check. Each returned item is `{ at, trigger, reason }`, in line order.
   - A declared genre trigger that reads the **live run's action** (`actionKey`, `actionOf(runId)` ~537) cannot be
     answered two rounds later. No core genre declares one. Do not build a recorder for it: say in the report what
     such a trigger does under the routine, and list it under "Stop and ask" only if a shipped document uses it.
   - Placing reuses what the judged check does at a past line: extend `core:outlet/propose-scene-cue@1`
     additively so a cue may carry its trigger (today always `judged`), and let the scene mode decide as it does
     now (Suggested: the chip; Automatic: placed). The outlet is called once per item, **in order**
     (`.each(…, { mode: 'sequential' })`, `sdk/src/builder.ts` ~961–977).
   - **Cues that already exist must not stall it.** `proposeJudgedSceneCue` refuses while any cue on the channel
     is `open` or `pending` (~1384–1391). For the routine's own placements: a cue already at that line for that
     trigger (a time action's bound marker) is the one that becomes placed or offered, not a second row; the
     "a cue is waiting" refusal ignores cues at or after the line being placed; under Suggested a run stops at its
     first offer, and because the start is derived from the latest cue, the next run continues after the person
     answers. The judged check's own refusal is unchanged.
   - Rounds are counted on the routine's channel by what the turn order already counts. If a session cannot count
     a round, stop and report; do not invent a counter.
3. **The core genres register it** (`core-catalog/src/genres/defaults.ts`): Story, the Lair and the Dungeon
   Crawler, at `everyNRounds({ n: 2 })`, depth 2, and declare `mode: 'automatic'` in their `scenes`
   (`core-catalog/src/registry/genres.ts` ~604, ~1300, ~1653) with the triggers they have today. Story's
   **Minimal** preset drops the routine the way it drops the sweep (`core-catalog/src/seed/presets.ts` ~62). Chat
   and Guide register nothing.
4. **Core stops watching each message.** `watch` no longer fires triggers on a landed line. What stays on the
   per-line hook is only what is not boundary detection:
   - **End scene here** keeps today's whole path (bind to the line, then open or offer, ~872–875, ~931): a
     person's own act is immediate;
   - **a time action's marker** (`noteTimeAction` ~814) is bound to the next landed line **without being
     offered**: its `at_message_id` is set and its state stays `pending` (no new state); the routine reads it as
     the time-action trigger at that line;
   - the cast refresh (`castRefresh`).
   **The opening scene (`first`) moves to the routine**: the first line opens a scene only in a session whose
   routines include the scenes routine, so Story Minimal's first line opens nothing by itself.
   A person's Start scene, End scene and Mark as scene stay immediate. The model-judged check stays as it is.
5. **Shown, with its cause and its undo (P1).** A boundary the routine placed says which trigger placed it on its
   divider (the cue's reason, already carried) and keeps the divider's existing "not a scene" action. The routine
   has a name and one sentence of purpose in the routines list, where it is switched off. The session's scene
   settings (`client/components/sessionForms/SessionSceneSettings.svelte`) say, when the session's genre or preset
   registers no scenes routine, that scenes here begin only when a person starts them; the mode and trigger
   choices stay and are what the routine reads. All copy is provisional 🚧; list every string in the report.
   Nothing toasts for a boundary the routine places.
6. **Existing sessions follow their genre.** No data pass: registrations come from the genre's defaults at boot as
   the round tick's did (check how `sense-clk2`/`sense-st2b` made the Lair register the round tick for sessions
   already in play, and do the same; a second boot changes nothing). A session's stored scene settings are kept
   and read by the routine. Cues already offered stay offered.
7. **Docs and ledgers in the same change:** `docs/sessions.md` ~505–520 (also remove the Lair's "new floor"
   trigger it still cites), `docs/genre-story.md`, `docs/genre-lair.md`, `docs/genre-dungeon-crawler.md`,
   `docs/pipelines.md` if it lists routines, `../serene-pub-sdk/guides/genres-presets-and-routines.md`, the stale
   header in `core-catalog/src/genres/dungeon-crawler/summarizeScene.ts` ~7, NOMENCLATURE rows (a charter row for
   the routine: purpose, why, owns, does not own) and §25.

## Files owned

SDK: `sdk/src/cadences.ts` (the new cadence), the contracts file(s) where the new query and the outlet's new
optional input are declared (`contracts/src/…`: find the judged cue's outlet and a sibling query as patterns), a
new `core-catalog/src/shared/sceneBoundaries.ts` (the spec), `core-catalog/src/genres/defaults.ts` (the three
registrations), `core-catalog/src/registry/genres.ts` (the three `scenes.mode` declarations),
`core-catalog/src/seed/presets.ts` (Story Minimal drops it), the summarize-scene header comment, SDK tests for
each, the guide. App: `src/lib/server/scenes/boundaryWatcher.ts`, a new binding file under
`src/lib/server/pipelines/runtime/` for the query, the lines of `pipelines/runtime/host.ts` at
`core:outlet/propose-scene-cue` (~9411–9440) and where bindings are wired, `pipelines/runtime/sessionEvents.ts`
(the hook), `SessionSceneSettings.svelte`, the app's pin and conformance tests the new names move, tests beside
each, the docs above.

## Out of scope

Scene summaries and history compilation entirely (the next build lane: a compile routine "6 rounds deep");
presence as a trigger; scene summaries in the reply's prompt; a scenes layer on presets; changing
`DEFAULT_SCENE_SETTINGS`; automatic Apply's rule; the write mode; settle triggers; what a scene is, Mark as scene,
Close out; tables, columns, migrations; `scene_cues` states.

## Stop and ask when

A migration or a new column is needed; a published SDK name would be removed or renamed, or an existing node's
required inputs would change (optional additions are fine); a round cannot be counted from what exists; the
per-trigger tests cannot be shared between the watcher and the query without changing what a trigger means; a
preset cannot drop the routine the way Minimal drops the sweep; sessions already in play cannot be made to pick
the routine up at boot without a data pass you would have to design.

## Pins

New and changed catalogue documents move spec hashes, registry hashes and the SDK catalogue digest. **Report each
recorded-vs-code pair; do not re-pin**: the lead re-pins once, in
`src/lib/server/pipelines/boot/specHashes.test.ts`, `registryHashes.test.ts` and the SDK pin tests. Those pin tests
are expected red at hand-back for that reason and no other.

## Done means

Tests for every numbered item, including: each core genre and each shipped preset registers or does not register
the routine as stated; the routine runs on every second round end and not between; a place change at a line is
placed as a boundary at that line by the first run in which the line is two rounds old, in a one-to-one session
and in a three-seat group; nothing is placed for a line newer than that; a line swiped, regenerated, deleted or
taken Back before it is two rounds old places nothing, and a line brought Forward is read on the next run; place A
to B and back to A inside the window places nothing; day 2 then day 3 two lines apart places two boundaries in
order; a time action's marker is placed by the routine and never shows a chip under Automatic; a person's "End
scene here" is immediate; a cue already offered does not stall later boundaries once it is answered; under
Suggested the chip appears, nothing is placed, and the next run continues after the answer; with no routine
registered (Story Minimal, a plugin-style genre) a landed line that crosses a day places and offers nothing, and
the first line opens no scene; an existing session's first run places nothing in its past; a branch's first run
places nothing in the copied lines; a person's Start scene is immediate; the judged check is unchanged; a session
already in play picks the routine up, and a second boot changes nothing; automatic Apply runs when the routine
closes the old scene. The existing scene suites (`boundaryWatcher*`, `judgedSceneCue`, `liveScenes.*`,
`sockets/scenes.*`, `sceneSettings*`, `liveScenes.autoApply`) pass, rewritten where the watcher's job moved to the
routine, never weakened. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean;
`NODE_OPTIONS=--max-old-space-size=12288 npm run check` shows no new error in files you touched. Tests run only
inside `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run
--maxWorkers=3 …"`. After the last SDK edit: `pgrep -af "vite dev"` and `pgrep -af "vitest|tsx --test"` show
nothing else live, then one `npm run sdk:build`; the SDK's own tests for the files you changed pass.

## Report

**Return the full report as your final message**, after every worker has finished (the lead saves it as
`plans/REPORT-sense-scn-2026-11-12.md`): the rules as built in sentences a person could read; how a round is
counted; the published names added; every pin pair that moved; what the per-line hook still does; provisional
names and every string of copy verbatim; changed files in each repo; tests and results; open ★; **Noticed, not
done**.
