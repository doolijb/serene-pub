# BRIEF — worker `ss-7-fix-w3` — the page is told about every run that holds re-runs; swipe, regenerate and delete let a turn settle first

Supervisor: lane `ss-7-fix` (report to it through your final message). App `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: you do not need `sdk:build`. Never `git checkout` / `restore` in either repo; never `prettier --write`; never
`kill -9`; no migration. Run every test through the lane lock (below), one run at a time. To know which
`/tmp/serene-pub-vitest-*` dirs are yours, `ls -d /tmp/serene-pub-vitest-*` just before and just after each run;
delete only ones that appeared during your run, after it has exited; if unsure, leave them and list them.
Sockets: `sessions:runStatus` is in `SCOPED_EVENTS`: every frame carries `sessionId` or `emitToUser` sends
nothing; frames go through `broadcastToSessionUsers` as today; no new event, no second channel (P2).

## Rules (quote; do not reinterpret)

- Owner 2026-11-16: *"the button would still be disabled. But have the user manually stop what ever is running
  first"*. The held re-run actions (swipe, regenerate, retake = *Regenerate the last turn*, Back, delete) are held
  by a run for which `runHoldsReruns` (`src/lib/shared/sessions/runsInProgress.ts`) is true: a registered run of
  the session (`since` set) of kind `reply` · `action` · `routine`, not line-bound, not parked. The page greys
  the same buttons from the frames it holds (`rerunWaitsForOf`, `sessionPageProjections.ts` ~718).
- The defect: the server holds the buttons for runs the page was never told about. Frames leave only on a status
  (`createStatusRelay.show`, `runStatus.ts` ~386), on a park/unpark (`announceRun`), and for a routine only
  after `QUEUE_STATUS_DELAY_MS` (400 ms, `showRoutineRun`, `routines/run.ts` ~170–219). A status cleared mid-run
  sends `status: null` (`clearShown`, `runStatus.ts` ~411–425), which the page's store reads as the run's end
  (`mergeRunStatus`, `src/lib/client/sessions/store/sessionStore.svelte.ts` ~398–408) while the server still
  counts the run.
- The fix, as the lane lead ruled it: **every run that holds the re-run actions is announced to the page when it
  starts holding and when it stops, whether or not it has status words; a holding run with no status shows its
  name and *working* (🚧); a run whose status is cleared mid-run stays listed until it ends.** And: **swipe,
  regenerate and delete first wait for the turn's own background runs to settle exactly as retake and Back do**.
- Comments state the rule, not the story (CONTRIBUTING §Comments; `commentHistory.test.ts` only lets the count of
  "used to" / "previously" phrases go down). Every function takes `db`; inside a transaction only `tx`.

## Goal

1. **One status for a holding run with nothing to say.** In `src/lib/shared/sessions/runsInProgress.ts` add one
   🚧 constant for the words, `RUN_WORKING_WORDS = "working"`, and use `{ i18n: { en: RUN_WORKING_WORDS } }` as
   the frame status of a holding run that has no status of its own — replacing the `${name} is running` defaults
   in `runsInProgressFor` (`runtime/runsInProgress.ts` ~213), `announceNow` (~293) and `routineRunStatus`
   (`routines/run.ts` ~153, keep the function, it returns the working status; its name argument may go).
2. **Announced when it starts holding.** A holding run with a socket server to send on gets its frame at
   registration, not at its first status: find where each holding kind is registered and where its io is
   noted (`createStatusRelay` → `noteRunIo`, `runStatus.ts` ~317–320, its only caller `runTurn.ts` ~863; routines
   `routines/run.ts` ~402–418; check actions via `fireAction.ts` and lineage child runs). Use `announceRun`.
   Caution: `announceNow` deletes the note when the handle is not yet registered — announce only once the handle
   exists, never lose the note. **Routines**: `showRoutineRun` sends its start frame at once (no 400 ms timer),
   marks `fact.shownAs`, and its `clear()` sends the end frame as today (the page keeps a routine record until an
   end frame carrying `routine`). A routine must not get a second start path whose end frame lacks `routine`.
3. **Stays listed until it ends.** In `clearShown` (relay), a clear that is not the run's end, for a run that
   holds re-runs (read its handle: `runHoldsReruns({ kind, since: startedAt, lineBound, parked })`), sends the
   working status instead of `null` (the registry status still clears; the live row is untouched). The end (from
   `end()`) still sends `null` when anything was shown or announced. A run that is not holding (parked,
   line-bound, unregistered) keeps today's `null`.
4. **The first page lists them.** `runsInProgressFor`'s filter also keeps a handle that holds re-runs, status or
   not (routines: `shownAs` is now set at once).
5. **Swipe, regenerate and delete settle first.** `src/lib/server/sockets/sessions.ts`: the four
   `heldRerunRefusal(…)` calls at ~9398 (delete), ~9576 (regenerate), ~10008 (swipe left), ~10166 (swipe right)
   pass `true` as retake (~11477) and Back (~11589) do. Update `heldRerunRefusal`'s doc (~9316–9328) so
   `settle` reads as every held press's. Touch nothing else in that file.

## Tests

- `src/lib/server/sockets/sessions.runsInProgress.int.test.ts`: (a) an action run registered with a socket server
  and never given a status reaches the page as a frame with `sessionId`, `since`, the working status and
  `mayStop`, is listed by `sessions:get`'s `runsInProgress`, and its end sends `status: null`; (b) a holding run
  whose status is cleared mid-run sends the working status, not `null`; a parked run's clear still sends `null`;
  (c) a swipe (and regenerate, delete) pressed right after a turn, while a child action run of that turn is about
  to end (well under 8 s), succeeds instead of being refused (model the existing retake/Back settle test if one
  exists; read how the held-door describe at ~574 builds its runs).
- `src/lib/server/pipelines/routines/run.frames.test.ts`: the start frame leaves at once with the working status;
  "a run that ends before the delay sends no frame" becomes: it sends its start and its end frame. Keep the rest.
- Client (`src/lib/client/sessions/store/sessionStore.svelte.test.ts` and/or
  `src/lib/client/components/sessionPage/runsInProgress.projection.test.ts`): a holding action frame with the
  working status and `since` is listed by `runsInProgressOf` (status *working*) and greys (`rerunWaitsForOf`
  gives the sentence); a later working frame keeps it; the end frame removes it. Change client code only if a test
  shows it is needed (and then stop and say why first in your report if it goes beyond these two files).

## Files owned (edit only these)

`src/lib/shared/sessions/runsInProgress.ts`, `src/lib/server/pipelines/runtime/runStatus.ts`,
`src/lib/server/pipelines/runtime/runsInProgress.ts` (announce, defaults, first page filter — the stop rule there
was just rewritten by another worker: leave `mayStopRun` / `membersMayStopRun` use as is),
`src/lib/server/pipelines/routines/run.ts` (`routineRunStatus`, `showRoutineRun` only),
`src/lib/server/sockets/sessions.ts` (the four call sites and that one doc comment only), and the test files named
above. If the start announcement needs an edit in `runTurn.ts` or `fireAction.ts`, keep it to the one call and say
so in the report.

## Out of scope

Docs and NOMENCLATURE (the supervisor writes them); the Turn line and Composer; who may stop a run; event pipelines
(unregistered: not this lane); `bindings*.ts`; anything else in `sessions.ts`.

## Stop and ask when

A holding run cannot be announced at start without registering something new; the fix would change what the page
does for a reply's own row or for `session.generating` beyond keeping a reply listed while it runs; a test needs a
file not owned; any new name beyond `RUN_WORKING_WORDS`.

## Done means

From `/home/jody/github/serene-pub`, through the lane lock, one run at a time:

`flock plans/ss-7-fix.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/sessions.runsInProgress.int.test.ts src/lib/server/sockets/sessions.editedLineRerun.int.test.ts src/lib/server/pipelines/routines/run.frames.test.ts src/lib/client/sessions/store/sessionStore.svelte.test.ts src/lib/client/components/sessionPage/runsInProgress.projection.test.ts src/lib/client/components/sessionPage/requests/stopRun.test.ts > plans/ss-7-fix-w3-tests.log 2>&1"` — all pass.

`flock plans/ss-7-fix.lock bash -c "NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/ss-7-fix-w3-tsc.log 2>&1"` — 0 errors.
`npx prettier --check` each changed file (warnings that exist at HEAD are known; say if you made one worse).
Never pipe a test run into `head`.

Report: changed files with line numbers, where each holding kind is now announced at start, each command with its
result, anything not done, anything noticed outside scope (not fixed).
