# BRIEF — worker `sense-scn-w5` — the scenes routine end to end, and the regression sweep

Supervisor: lane `sense-scn` (brief `plans/briefs/BRIEF-sense-scn.md`). You type; the supervisor decides. Report back
as your final message (no report file): changed files, tests run with results (per file: pass/fail counts), every
pin pair (recorded vs code) verbatim, each failure you did not fix with one line on its cause, **Noticed, not done**.

## Goal

The scenes routine is built (SDK built; app code in `src/lib/server/scenes/boundaryWatcher.ts`,
`src/lib/server/pipelines/runtime/sceneBoundaries.ts`, the `core:outlet/propose-scene-cue` case in `host.ts`). Prove
it end to end through the real routine machinery, and sweep the suites around it for regressions.

The rule: "A genre that wants scenes handled registers a scenes routine: code only, no model. It runs every few
rounds (core genres: every 2). Each run looks only at lines that are at least a declared number of rounds old (core
genres: 2) and still standing, finds where a boundary trigger fired among them, checks it still holds, and places the
boundary there. A genre or preset that does not register it gets nothing: core no longer watches each message."

What exists: `core:spec/scene-boundaries` (`SCENE_BOUNDARIES_SPEC_ID` from `@serene-pub/core-catalog`) is a
`maintenance` routine on `core:cadence/every-n-rounds@1` (`everyNRounds({ n: 2 })`), registration key
`every-n-rounds→scene-boundaries`, in the genre defaults of Story, the Lair and the Dungeon Crawler; Story's Minimal
preset drops it; Chat and the Guide have none; the three genres declare `scenes.mode: 'automatic'`. The routine runs
`core:query/scene-boundaries@1` (host walk `sceneBoundariesOf`) then `core:outlet/propose-scene-cue@1` per item with
its `trigger`. A round is as the turn order counts it (`turnTally.ts`, `replayStoryLane` in `routines/moments.ts`):
everyone seated has had a turn. Read `src/lib/server/scenes/sceneBoundaries.int.test.ts` (walk-level tests, green)
first; do not repeat its cases.

## Files owned

- NEW `src/lib/server/pipelines/routines/sceneBoundaries.routine.int.test.ts`
- Any other **test** file in the sweep below that fails **because of this lane's change** and is not owned by worker
  `sense-scn-w4` (W4 owns: `scenes/boundaryWatcher.int.test.ts`, `scenes/boundaryWatcher.genre.int.test.ts`,
  `scenes/liveScenes.autoApply.int.test.ts`, `sockets/scenes.cues.int.test.ts`, `state/clockTarget.int.test.ts`,
  `state/clockProposal.int.test.ts`, `state/clockMoves.int.test.ts`, `sockets/sessions.timePasses.int.test.ts`,
  `scenes/sceneCauses.int.test.ts`, `sockets/scenes.laneE.int.test.ts` — never edit those). Fix only an expectation
  that was true of the old per-line watcher or of the old routine/registration list and is now untrue by design (for
  example a list of Story Living's routines that now includes *Find where scenes begin*). Never loosen an assertion
  beyond that; never `skip`. Anything else: report, don't fix.
- **Never** edit `src/lib/server/pipelines/boot/specHashes.test.ts`, `registryHashes.test.ts` or any SDK pin: they are
  expected red; report each recorded-vs-code pair verbatim.
- No non-test file.

## The new test file

Model it on `src/lib/server/pipelines/routines/roundTick.int.test.ts` and `routines.int.test.ts` (real sessions, real
turns with a scripted model or landed lines plus the real moment path `noteLineLanded` / `emitSessionEvent`, real
routine evaluation and queue, `vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })`). Find in those files how
routines are switched on in tests (`routinesEnabled`) and how a test waits for the routine queue to drain. Cases:

1. **Cadence**: in a Story (Living) session, the scenes routine runs at the end of rounds 2 and 4 and not after rounds
   1 and 3 (count `pipeline_runs` rows with `trigger_family = 'routine'` and spec `core:spec/scene-boundaries`, or
   the routine log).
2. **One-to-one**: a person and one character. The story's day changes on a line in round 1 (or 2); after the round
   that makes that line two rounds old ends on an even round, the boundary is placed at **that** line (Automatic, the
   genre's mode): a scene opens there, its `scene_cues` row is `placed` with trigger `dayCrossed`. Before that run,
   nothing is placed for it.
3. **Three-seat group**: the same with three seats (a person and two characters, or as the turn order seats three),
   so a round is three lines.
4. **Story Minimal** (by its preset; find how existing tests start a session on a preset, e.g. by `seedKey`) and a
   genre with no scenes routine (Chat or the Guide, whichever keeps scenes; if neither writes scenes, say so and use
   Story Minimal only): after several rounds with a day change, no scene, no cue, and the first line opened no scene.
5. **A session already in play picks the routine up**: a Story session whose rows were created before the routine
   existed (simulate by deleting the genre-scope registration rows for `every-n-rounds→scene-boundaries` before the
   boot projection, or by the plainest route the boot tests use) → after `bootstrapPipelines` (the boot projection)
   its effective registrations hold the routine; a **second boot changes nothing** (compare the `registrations` rows
   before and after). Look at how `roundTick.int.test.ts` proves "a second boot changes nothing" and do the same.

## The sweep (run capped, a few files per run; report every file's counts)

`src/lib/server/scenes/judgedSceneCue.int.test.ts`, `scenes/liveScenes.castMembers.int.test.ts`,
`scenes/liveScenes.playerSeats.int.test.ts`, `scenes/liveScenes.rewind.int.test.ts`, `scenes/sceneNotes.int.test.ts`,
`scenes/sceneStartOf.test.ts`, `scenes/sceneBoundaries.int.test.ts`, `pipelines/runtime/sceneBoundaries.test.ts`,
every `sockets/scenes.*.int.test.ts` except W4's two, `src/lib/shared/sessions/sceneSettings.test.ts`, any
`src/lib/server/sessions/sceneSettings*.test.ts`, `sessions/settingsForm.int.test.ts`,
`sessions/presetEditor.int.test.ts`, `pipelines/routines/routines.int.test.ts`, `pipelines/routines/roundTick.int.test.ts`,
`pipelines/routines/clockOwners.int.test.ts`, `pipelines/registrations/resolve.int.test.ts`,
`pipelines/boot/specHashes.test.ts`, `pipelines/boot/registryHashes.test.ts`, `src/lib/shared/routines/cadenceWords.test.ts`,
`sockets/sessions.sanctum.int.test.ts`. For a failure, first decide whether this lane caused it: compare with what the
test asserts and with the change above (another build lane is editing a visual-novel layout and speech in this repo;
their failures are not yours: report them as "not this lane").

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
- Run only targeted test files, in a capped scope:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
  An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Do not start a dev server.
- Worker `sense-scn-w4` is rewriting its files at the same time: never edit them, and don't be surprised if they are
  red or changing while you run.

## Stop and ask when

The routine does not run at all in a real session (no `pipeline_runs` row) and the cause is not in a test; a round
cannot be counted in a three-seat session; making a case pass would need a non-test change.

## Done means

The new file green (all five cases); the sweep run with counts; every failure classified (fixed as this lane's
expectation / not this lane / needs the supervisor); pin pairs reported; prettier clean on files you changed;
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` shows no error in files you touched.
