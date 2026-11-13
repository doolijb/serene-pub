# BRIEF — worker `sense-scn-w4` — rewrite the existing scene suites for the scenes routine

Supervisor: lane `sense-scn` (brief `plans/briefs/BRIEF-sense-scn.md`). You type; the supervisor decides. Report back
as your final message (no report file): changed files, each test you rewrote (old name → new name, one line on what
it now proves), tests run with results, anything you could not do, **Noticed, not done**.

## Goal

Scene boundaries moved from core's per-message watcher to a routine the genre registers (built; SDK built). The
existing scene suites still assert the old per-line behaviour and 21 tests now fail for that reason alone. Rewrite
them so they prove the **same behaviour where it now lives**, never weaker: every trigger, mode, refusal and wording
they proved before is still proved, through the routine's walk and outlet instead of the per-line hook. Where a
behaviour was deliberately removed (below), the test is changed to prove the new rule, not deleted silently: say so
in the report.

## What changed (the rules your tests must match)

The rule: "A genre that wants scenes handled registers a scenes routine: code only, no model. It runs every few
rounds (core genres: every 2). Each run looks only at lines that are at least a declared number of rounds old (core
genres: 2) and still standing, finds where a boundary trigger fired among them, checks it still holds, and places the
boundary there. A genre or preset that does not register it gets nothing: core no longer watches each message."

In `src/lib/server/scenes/boundaryWatcher.ts` (read it: module comment and the functions named here):
- `sceneBoundariesOf(db, sessionId, { depth, every })` — the routine's walk, **read-only**. Lines on `main`, live and
  standing, at least `depth` rounds old (rounds from `replayStoryLane`: with no seats in the turn order every turn
  line is its own round). Starts after the latest of: the channel's latest scene boundary, its latest scene cue that is
  not `pending`, a branch's last copied line; with none of those, only the last `every` rounds' window before the old
  lines (a young session: from its first line). Returns `{ boundaries: { at, trigger, reason }[], why? }` in line
  order. The per-trigger tests are the old ones, in ONE read-only evaluator (`firedTriggers`): `opening` (genre
  `first`), `timeAction` (a `pending` marker bound at that line), `dayCrossed`, `placeChanged` (vs the line before
  and vs the place the walk's current scene began in; with no scene open, the place just before the walk), `pause`,
  `length` (from the walk's scene start), `narration`, declared triggers (a declared trigger stating `actionKey`
  never fires under the routine). Re-check before keeping: `placeChanged` kept only when the place at the walk's last
  line differs from the place the scene began in; `dayCrossed` always; others none. A kept line becomes the scene
  start for later lines.
- `proposeJudgedSceneCue(db, { …, trigger })` — the outlet's commit. Without `trigger` (or `judged`): unchanged.
  With a boundary trigger: validated against the session's triggers (not `endedHere`); refused inside a placed
  scene; same line as a scene that opened there → recorded `placed` ("the scene at this line was already placed");
  skipped while an `open` cue waits at an earlier line ("a scene cue is already waiting on this channel"); a
  `pending`/`open` row for that line and trigger is reused, a decided one skips ("this line's scene cue was already
  decided"); `reason` stays NULL for non-judged cues; then Suggested (or `ask`) offers the chip, Automatic places
  (`openScene`, `markCuesAt(…, "placed")`, `afterBoundaryPlaced`), Manual skips.
- `watchSceneBoundaries` (the per-line hook) fires **no** trigger any more. It only: binds a person's pending
  *End scene here* cue to the landed line and opens (Automatic) or offers (Suggested) at once; binds a time action's
  pending marker to the landed line and leaves it `pending` (never offered); refreshes the open scene's cast
  (`castRefresh`), unchanged. It never opens or offers `opening`.
- `noteTimeAction` leaves a marker only on `main`, only when `scenesRoutineOn(db, sessionId)` (the session's effective
  registrations hold `core:spec/scene-boundaries`, not Off).
- `offeredSceneCues`, `decideSceneCue`, `sceneCueWording`, `followEndedScene`, `judgedSceneCheckOf`: unchanged.
- Read `src/lib/server/scenes/sceneBoundaries.int.test.ts` (new, green) for working fixtures: how it gives a session
  the scenes routine (real core genres after `defaults.sync()` + `bootstrapPipelines`; Story Minimal by its preset's
  `seedKey` for "no routine"), how it drives rounds, Back/Forward (`rewindTurn`, `forwardTurn`) and delete. Reuse
  that pattern; do not copy its cases (they already exist there).

## Files owned (edit only these; all under `/home/jody/github/serene-pub/src/lib/server/`)

- `scenes/boundaryWatcher.int.test.ts`
- `scenes/boundaryWatcher.genre.int.test.ts`
- `scenes/liveScenes.autoApply.int.test.ts` (only the test(s) that relied on the per-line hook placing a boundary:
  "closed by the boundary watcher in Automatic mode: applies" → closed by the scenes routine's placement in Automatic
  mode, Apply runs — this is the lane's "automatic Apply runs when the routine closes the old scene" proof)
- `sockets/scenes.cues.int.test.ts`
- and, only if they fail because `noteTimeAction` now needs the scenes routine or because the hook no longer fires
  triggers: `state/clockTarget.int.test.ts`, `state/clockProposal.int.test.ts`, `state/clockMoves.int.test.ts`,
  `sockets/sessions.timePasses.int.test.ts`, `scenes/sceneCauses.int.test.ts`, `sockets/scenes.laneE.int.test.ts`.
  Run each first; edit only the failing tests in them, and only for that cause.

Do NOT edit `boundaryWatcher.ts` or any non-test file. If a test cannot be made to pass without a code change, stop
on that test, leave it as it was, and report the failing assertion and why (the supervisor decides).

## How to rewrite

- A test that landed lines and called `watch(…)` expecting a cue or a boundary now: lands the lines (enough that the
  line is `depth` rounds old), calls `sceneBoundariesOf` and checks what it returns, then places each through
  `proposeJudgedSceneCue({ …, trigger })` in order (as the routine does) and checks the cue rows, the chip
  (`offeredSceneCues`) and the scenes, with the same expectations as before (same trigger keys, same reasons, same
  modes). Write a small local helper `runRoutine(sessionId, { depth = 2, every = … })` that does exactly that in the
  test file.
- A test that proved the hook does something per line that it no longer does (opening on the first line, a cue on a
  landed day-crossing line): keep one assertion that the hook now does nothing for it, and prove the behaviour
  through the routine.
- The three `opening` tests: the first line's opening is placed/offered by the routine's run, Manual nothing, a session
  that already has lines gets none, a removed opening never comes back, a genre without `first` none.
- G1 declared triggers: the floor/speaker/narration/stateKey predicates through the walk; the `actionKey` case now
  proves that such a trigger does not fire under the routine (and the hook fires nothing).
- `noteTimeAction`'s cause test: give the world the scenes routine, then the same assertions.
- Never loosen an expectation to make a test pass; never `skip`/`todo` a test.

## Rules (verbatim; binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to build: don't.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx`. It is a **session**, never a *chat*. Every session
  has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in tests or comments.
- Never write "lane" for a message channel in anything new you write (say "channel").
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Run only your targeted test files, in a capped scope, a few files per run:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Do not start a dev server.
- Another worker (`sense-scn-w5`) is writing a NEW routine test file and running other suites at the same time:
  never edit a file not listed above.

## Done means

Every test in the files above green (run them all at the end, capped, in two or three batches), the count of tests
per file not lower than before unless you say exactly which test was folded into which and why;
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` shows no error in the files you touched;
`npx prettier --check` on each changed file (report pre-existing differences, don't reformat whole files).
