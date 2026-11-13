# BRIEF — worker `sense-scn-w2` — the app half of the scenes routine (host code)

Supervisor: lane `sense-scn` (brief `plans/briefs/BRIEF-sense-scn.md`). You type; the supervisor decides. Report back
as your final message (no report file): changed files, tests run with results, which existing test suites now fail
and why (one line each), every string of copy or receipt note you added verbatim, anything you could not do,
**Noticed, not done**.

## Goal

Scene boundaries move from core's per-message watcher to a routine the genre registers. The SDK side is built and
`npm run sdk:build` has run: `core:spec/scene-boundaries` (`SCENE_BOUNDARIES_SPEC_ID`, `@serene-pub/core-catalog`) is
a `maintenance` routine on `core:cadence/every-n-rounds@1`, registered by Story (not its Minimal preset), the Lair
and the Dungeon Crawler at `n: 2`. It runs ONE query, 🚧 `core:query/scene-boundaries@1` (`C.sceneBoundaries`, in
`scope` + `routine`, param `depth` default 2, out `main: SceneBoundary[]` where `SceneBoundary = { at, trigger,
reason }` exported from `@serene-pub/contracts`), then calls `core:outlet/propose-scene-cue@1` once per item, in
order, with `{ at, channel: 'main', reason, trigger }` (the outlet's `trigger` in-port is new and optional; absent
means `judged`). You build the host side: the query's binding, the walk it runs, the outlet's new path, and the
reduced per-line hook. The whole rule, in four sentences:

> A genre that wants scenes handled registers a scenes routine: code only, no model. It runs every few rounds (core
> genres: every 2). Each run looks only at lines that are at least a declared number of rounds old (core genres: 2)
> and still standing, finds where a boundary trigger fired among them, checks it still holds, and places the
> boundary there. A genre or preset that does not register it gets nothing: core no longer watches each message.

## Files owned (edit only these; all under `/home/jody/github/serene-pub/`)

- `src/lib/server/scenes/boundaryWatcher.ts`
- NEW `src/lib/server/pipelines/runtime/sceneBoundaries.ts` (the binding; copy `roundWorth.ts`'s shape)
- `src/lib/server/pipelines/runtime/bindings.ts`: ONE import line and ONE spread line beside `...roundWorthBindings()` (~4140). Nothing else.
- `src/lib/server/pipelines/runtime/host.ts`: ONLY the `case "core:outlet/propose-scene-cue":` block (~9411–9440).
- `src/lib/server/pipelines/runtime/sessionEvents.ts`: ONLY the (b5) comment above `watchSceneBoundaries` (~270–275) so it is true.
- NEW `src/lib/server/scenes/sceneBoundaries.int.test.ts`
- NEW `src/lib/server/pipelines/runtime/sceneBoundaries.test.ts` (the binding, mocked db call; optional but wanted)

Do NOT edit any existing test file (another worker rewrites them after you; you report what broke). Do NOT edit
`src/lib/server/db/schema.ts`, any socket file, `liveScenes.ts`, `sessions/sceneSettings.ts`, or anything else.

## Files readable

Anything. Read first, in full or by range: `src/lib/server/scenes/boundaryWatcher.ts` (all of it: you are reshaping
it), `src/lib/server/pipelines/runtime/roundWorth.ts`, `src/lib/server/pipelines/routines/moments.ts` ~230–330
(`replayStoryLane`), `src/lib/server/pipelines/routines/turnTally.ts` ~1–150 (what a round is),
`src/lib/server/pipelines/routines/log.ts` ~140–190 (`effectiveRegistrations` use), `src/lib/server/sessions/sceneSettings.ts`
~70–115 (`SessionSceneContext`), `src/lib/server/sessions/branch.ts` ~440–480 (a branch's copied lines carry
`metadata.copyOf`; `sessions.branch_of_message_id` is the **source** session's id, so it is not comparable with the
branch's own message ids), `src/lib/server/db/schema.ts` ~5055–5100 (`scene_cues`: unique per session, channel,
line, trigger; one `pending` row with no line per session, channel, trigger; `reason` is documented "NULL for every
other trigger" than `judged`; `at_message_id` cascades on delete), the SDK contract
`/home/jody/github/serene-pub-sdk/contracts/src/queries.ts` (search `sceneBoundaries`) and `outlets.ts` (search
`proposeSceneCue`), `/home/jody/github/serene-pub-sdk/core-catalog/src/shared/sceneBoundaries.ts`.

## What to build

### A. The walk: `sceneBoundariesOf` (in `boundaryWatcher.ts`, exported)

`export async function sceneBoundariesOf(db: Db, sessionId: number, opts: { depth: number; every: number }): Promise<{ boundaries: SceneBoundary[]; why?: string }>`

Read-only: **a query writes nothing** (no insert, no update, no delete anywhere on this path).

1. `ctx = sessionSceneContext(db, sessionId)`; return `[]` with a `why` when `!ctx || !ctx.mayPlace` ("this session
   places no scenes") or `ctx.settings.mode === "manual"` ("scenes are Manual here").
2. The channel is `"main"` (rounds exist only on the story's channel; the routine fires only on its round end).
3. **Rounds, as the turn order counts them**: `const { tally, lines } = await replayStoryLane(db, sessionId)` (dynamic
   import from `$lib/server/pipelines/routines/moments`). `cur = tally?.round ?? 1` (the round in progress). A line's
   age is `cur - line.round`. `end` = the largest replayed line id with `round <= cur - opts.depth`; none → `[]`, why
   "no line is old enough yet". (Non-turn lines such as a greeting or a system line are not in the replay; they are
   still walked when their id is ≤ `end`.) Do not invent any other counter: if a round cannot be counted this way,
   stop and report.
4. **Where the walk starts is derived, never stored.** `anchor` = the largest of:
   - the channel's latest scene boundary: `max(opened_at_message_id, closed_at_message_id)` over the session's scenes on
     `main` with an opening line;
   - the channel's latest `scene_cues.at_message_id` whose `state` is **not** `pending` (a time action's marker is
     `pending` and bound to a line now: it must not move the start past itself);
   - for a branch (`sessions.branch_of_session_id` not null): the largest id of the session's own lines whose
     `metadata ->> 'copyOf'` is not null (its last copied line).
   If `anchor > 0`, walk lines with `anchor < id <= end`. Otherwise (a session with no scene, no decided or offered
   scene cue and not a branch) the walk starts at the first replayed line of round `cur - depth - every + 1`; when that
   round is ≤ 1, from the session's first line. (Why: an old session, such as one carried over from 0.5.3, has no
   scene and no cue; without this its first run would walk its whole past. The supervisor chose this; keep it exactly.)
5. **The lines walked**: live standing lines on `main` (`liveLinesWhere(sessionId, "main")`, already in the file:
   live, not hidden, not generating), `id` in the range, ascending, with `LINE_COLUMNS`; plus the one live standing
   line just before the first one, as its `prev`.
6. **The walk carries its own scene start.** Before the first line: if an open scene exists on `main`, `scene = { start:
   its opened line, place: placeKey ? stateAt(placeKey, opened) : null }`; else `scene = { start: sceneStartOf(...)
   (the line after the latest closed scene, else 0), place: null }`.
7. **Per line, the same per-trigger tests `firedTriggers` has today, extracted into ONE read-only evaluator** (so
   there is one copy; `firedTriggers` and its writes go away — the hook in C does the two bindings). For line `L` with
   `prev` (`t = ctx.settings.triggers`; `stateAt` = one `worldStateReader` per walk, as today):
   - `opening`: `ctx.first && isOpeningLine(db, sessionId, "main", L.id)` (unchanged function);
   - `timeAction`: `t.timeAction` and a `scene_cues` row on `main` with `trigger = 'timeAction'`, `at_message_id =
     L.id`, `state = 'pending'` exists (read it; never write it);
   - with `prev`: `dayCrossed` (`crossesDay(clockOf(prev), clockOf(L))`), `placeChanged` (`before = stateAt(key, prev.id)`,
     `now = stateAt(key, L.id)`, `before && now && before !== now`, and `scene.place === null || scene.place !== now`
     where `scene.place` is skipped when `scene.start === L.id`), `pause` (as today), `length` (as today, counting live
     standing lines from `scene.start` inclusive to before `L`);
   - `narration` (as today);
   - the genre's declared triggers: those `on`, naming no channel or naming `main` (`namesLane`), with every stated
     predicate holding as today — **except a trigger that states `actionKey` never fires under the routine** (the run
     that wrote a line two rounds ago cannot be asked; no core genre declares one; leave `actionKeysOf` and
     `runRegistry` imports out if they become unused).
   Order the fired keys with `triggerOrder(ctx.declaredTriggers)` as today. `endedHere` is never evaluated here.
8. **The re-check, per trigger, before keeping a line's triggers**: `placeChanged` is kept only when
   `scene.place === null || stateAt(placeKey, end) !== scene.place` (out to B and back to A: nothing; A to B to C: both);
   `dayCrossed` always holds; the others have no re-check.
9. **When a line keeps any trigger**: push one `{ at: L.id, trigger, reason }` per kept trigger, in trigger order;
   `reason` is that trigger's words: `(await sceneCueWording(ctx.declaredTriggers, [{ trigger, reason: null }])).reason`
   (one wording, the chip's). Then `scene = { start: L.id, place: placeKey ? stateAt(placeKey, L.id) : null }`, so a
   second boundary in one run is judged against the first.
10. Return the items in line order.

### B. The binding (NEW `src/lib/server/pipelines/runtime/sceneBoundaries.ts`) and its wiring

`export function sceneBoundariesBindings(): Bindings` with `"core:query/scene-boundaries@1": reads<typeof C.sceneBoundaries>(async (input) => …, { ports: ["scope", "routine"], params: ["depth"] })`
(check how `reads` options name params in `bindings.ts`'s `core:task/sweep-duties@1` and follow it):
- no `input.scope.sessionId` → `halt("…a sentence…")` as `roundWorth.ts` does;
- `depth` = a whole number ≥ 1 from `input.params.depth`, else 2; `every` = a whole number ≥ 1 from
  `input.routine?.cadence?.options?.n`, else 1;
- `db` by `(await import("$lib/server/db")).db` (as `core:task/sweep-duties@1` does), then `sceneBoundariesOf`;
- `return ok({ main: result.boundaries })`.
Module doc comment in `roundWorth.ts`'s style: what it is, that it writes nothing, ⚠ not the judged scene check.
Wire it in `bindings.ts`: import, and `...sceneBoundariesBindings(),` right after `...roundWorthBindings(),`.

### C. The per-line hook (`watch`, called by `watchSceneBoundaries` from `sessionEvents.ts`)

`watch` no longer fires triggers on a landed line. Keep its gates (context, `mayPlace`, not Manual, the line live and
settled, `watchesLane`). What stays, and only this:
- **End scene here** keeps today's whole path: the `pending` `endedHere` cue on the line's channel is bound to this
  line (`at_message_id = line.id`, `state = 'open'`), then Automatic opens the scene there (`openScene`, cause
  `{ kind: "system" }`, `markCuesAt(…, "placed")`, `afterBoundaryPlaced`) or, failing that or under Suggested,
  `pushSceneCues`; the `WatchResult` says `triggers: ["endedHere"]`. A person's own act is immediate.
- **A time action's marker** (`noteTimeAction`): the `pending` `timeAction` row with no line on this line's channel
  gets `at_message_id = line.id` and **stays `pending`** (never `open`, never offered, no push). If a `timeAction`
  row already exists at this line (a regenerate re-fires the event), delete the unbound pending row instead of
  binding it (the unique index would refuse the update).
- The cast refresh (`followOpenSceneCast` in `watchSceneBoundaries`): unchanged.
- **The opening scene moves to the routine**: the hook never opens or offers `opening`. Story Minimal's first line
  opens nothing by itself.
Rewrite the module's top doc comment (lines 1–63) so it says this: where scene boundaries come from now (the scenes
routine reads lines a couple of rounds old, `sceneBoundariesOf`; the outlet places them, `proposeJudgedSceneCue`), what
the per-line hook still does, and that a session whose genre or preset registers no scenes routine gets no
automatic boundary. Update `watchSceneBoundaries`' doc comment likewise. Keep exported names and signatures that
other files import (`watchSceneBoundaries`, `noteTimeAction`, `followEndedScene`, `offeredSceneCues`,
`sceneCueWording`, `decideSceneCue`, `pushSceneCues`, `judgedSceneCheckOf`, `proposeJudgedSceneCue`, `openSceneIds`,
`crossesDay`, `ENDED_HERE_TRIGGER`, `OPENING_TRIGGER`, `WatchResult`, …): grep `src` for each before removing
anything, and remove nothing another file imports.

### D. `noteTimeAction`

Two changes, nothing else: markers are left only on `main` (the routine's channel; drop the "every channel with an
open scene" set), and only when the session **has the scenes routine on**. Add and export
`scenesRoutineOn(db, sessionId): Promise<boolean>`: `effectiveRegistrations(db, sessionId)` (dynamic import from
`$lib/server/pipelines/registrations/resolve`, as `log.ts` does) → some `effective` registration with
`trigger.family === "routine"`, `pipeline === SCENE_BOUNDARIES_SPEC_ID` (import from `@serene-pub/core-catalog`) and
`(mode ?? "full") !== "off"`. False on any error. (Why: a marker left in a session without the routine would stay
`pending` for ever, and the judged scene check refuses while any cue is `pending`.)

### E. The outlet's new path (`proposeJudgedSceneCue` + the `host.ts` case)

Add an optional `trigger?: string` to `proposeJudgedSceneCue`'s params. Absent, blank or `"judged"` → **today's path,
byte-for-byte the same behaviour** (the judged check's own refusal is unchanged). Otherwise, in order:
1. the same context gates and skipped notes (no scenes; Manual);
2. the trigger must be one of `triggerOrder(ctx.declaredTriggers)` and not `ENDED_HERE_TRIGGER`; else
   `{ outcome: "refused", note: "‹trigger› is not a boundary trigger of this session" }`;
3. the same live-line check;
4. the boundary: `at < boundary` → refused as today ("already inside a placed scene"); `at === boundary` and a scene on
   the channel **opened at** `at` → this is the same boundary: record this trigger's cue as `placed` (reuse a
   `pending`/`open` row at that line for that trigger, else insert one; `decided_at` now) and return
   `{ outcome: "placed", cueId, note: "the scene at this line was already placed" }`; `at === boundary` otherwise →
   refused as inside;
5. **waiting**: an `open` scene cue on the channel at a line **before** `at` → `{ outcome: "skipped", note: "a scene cue
   is already waiting on this channel" }`. Cues at or after `at`, and `pending` markers, never refuse. (Under
   Suggested this makes a run stop at its first offer; the next run continues after the person answers, because the
   walk starts after the latest decided or offered cue.)
6. **the cue row**: a row at `(session, channel, at, trigger)` in `pending` or `open` is the one used (set `state =
   'open'`); in any decided state → `{ outcome: "skipped", note: "this line's scene cue was already decided" }`; none
   → insert `{ …, trigger, state: "open" }`. **`reason` stays NULL** for every trigger but `judged` (the column's
   documented rule; the chip and the divider word it from the trigger).
7. the mode decides exactly as the judged path does from here (Suggested or `ask` → `pushSceneCues`, `suggested`;
   Automatic → `openScene` cause system, refusal → cue waits, `refused`; placed → `markCuesAt(…, "placed")`,
   `afterBoundaryPlaced`, `placed` with the scene ids). Nothing toasts: confirm `afterBoundaryPlaced` only pushes
   socket state (read it in `sockets/scenes.ts`, do not edit it) and say so in the report.
In `host.ts`, read `p.trigger` (a trimmed string, else undefined) and pass it through; keep every existing halt and
the `record(…)` call. Update the case's doc comment by one sentence.

## Rules (verbatim; binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to build: don't.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx`. It is a **session**, never a *chat*. Every session
  has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments or tests.
- Never write "lane" for a message channel in anything you add (say "channel"); existing identifiers and strings that
  already say it stay.
- No migration, no new column, no new `scene_cues` state, no new setting. If you think you need one, stop and report.
- Core runs the SDK executor and never reimplements the scheduler: you write a binding and host functions only.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything; line numbers are approximate.
- Run only your targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Do not start a dev server.

## Tests you write (NEW `src/lib/server/scenes/sceneBoundaries.int.test.ts`)

Use the fixtures style of `src/lib/server/scenes/boundaryWatcher.int.test.ts` (a test DB via `vi.mock("$lib/server/db")`,
a user, a lorebook, a session, `insertLegacy` lines, `setDay`). With no seats in the turn order every turn line is its
own round (check that in `turnTally.ts` and say so in the test's comment), which keeps rounds easy to control. Call
`sceneBoundariesOf`, `proposeJudgedSceneCue({ …, trigger })` and `watchSceneBoundaries` directly. Cases (each its own
`test`):
1. day 2 at a line: nothing returned while the line is newer than `depth` rounds; returned (`dayCrossed`, at that
   line) once it is `depth` rounds old;
2. day 2 then day 3 two lines apart → two boundaries, in line order; placing them under Automatic opens two scenes;
3. place A → B → A inside the window → nothing; A → B → C → two (use the genre place the way
   `boundaryWatcher.genre.int.test.ts` G2 sets one up);
4. a line deleted, or taken Back (rewound), before it is old enough → nothing; brought Forward → returned by the next
   call (use the existing rewind helpers the scene tests use; if Back/Forward cannot be driven at this level, say so
   and test delete only);
5. a time action's marker: `noteTimeAction` (with the scenes routine on) then a landed line → the row is bound and
   `pending`, no chip (`offeredSceneCues` empty); the walk returns `timeAction` at that line; placing it under Automatic
   reuses that row (one row, `placed`) and shows no chip;
6. End scene here at the newest line, then a landed line → the next scene opens at once (Automatic) / the chip
   (Suggested), through the hook;
7. Suggested: the first boundary is offered (one `open` cue, no scene), a second boundary in the same walk is skipped
   ("waiting"); after the person dismisses or accepts the first, the next walk starts after it and the second is
   offered;
8. no routine: a session whose registrations hold no scenes routine: a landed line that crosses a day places and
   offers nothing through the hook, `noteTimeAction` leaves no marker, and the first line opens no scene;
9. an existing session with lines and no scene, cue or branch: the walk returns nothing older than the last
   `every` rounds' window, even where days changed in its past; with a dismissed cue at line N, nothing at or before N;
10. a branch: lines copied with `metadata.copyOf` and a day change among them → nothing in the copied lines;
11. the judged path unchanged: `proposeJudgedSceneCue` without `trigger` still refuses while any cue is `open` or
    `pending` (one assertion is enough; the existing `judgedSceneCue.int.test.ts` stays as the full proof).
For "has the scenes routine": either write the session's registrations the way the existing registration tests do
(search `src` for a test that inserts `registrations` rows or sets a session's preset/genre so `effectiveRegistrations`
returns a routine), or give the session a real core genre whose defaults register it (Story) versus Story Minimal.
Pick the plainer that works and say which.

## Run (in this order)

1. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report only errors in files you touched (and
   existing tests that now fail to compile because of your change: list them, do not edit them).
2. Your new test files, capped.
3. Then, capped, these existing suites, to report (not fix): `src/lib/server/scenes/boundaryWatcher.int.test.ts`,
   `src/lib/server/scenes/boundaryWatcher.genre.int.test.ts`, `src/lib/server/scenes/judgedSceneCue.int.test.ts`,
   `src/lib/server/sockets/scenes.cues.int.test.ts`, `src/lib/server/sockets/scenes.laneE.int.test.ts`,
   `src/lib/server/scenes/liveScenes.autoApply.int.test.ts`. `judgedSceneCue.int.test.ts` must stay green; if it goes
   red, that is yours to fix in your code.
4. `npx prettier --check` on each file you changed (pre-existing unformatted lines elsewhere in a file: report, don't
   reformat the file).

## Stop and ask when

A migration, column, `scene_cues` state or setting seems needed; a round cannot be counted with `replayStoryLane`; the
per-trigger tests cannot be shared without changing what a trigger means; an exported name another file imports would
have to go; anything outside the files above would have to change.

## Done means

A–E built; tsc clean in the files you touched; your new tests green; `judgedSceneCue.int.test.ts` green; the other
listed suites run and each failure explained in one line for the next worker.
