# BRIEF ss-7-w1 — server: runs in progress, Stop for whoever a run blocks, re-run actions wait for a quiet session

Lane `ss-7`, worker 1 of 2 (the other, w2, builds the SDK widgets and the page; you do not touch its files).
App repo `/home/jody/github/serene-pub`. You edit only app server files listed below. Read CLAUDE.md first.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You should not need `sdk:build` at all.)

Never `git checkout / restore / stash` in either repo. Never `kill -9`. Never `prettier --write`. No migration. Inside
`db.transaction(async (tx) => …)` use only `tx`. Comments state the rule, not the story. No other product's name in any
file. It is a **session**, never a *chat*.

## Goal

1. The `sessions:runStatus` frame tells the page, for every registered run: its shown **name**, **since** (start time),
   **readsMessageId** (when a reply's line caused it), **parked** (waiting at review) and **mayStop**. The session's
   first page carries every run in progress, seeded from the run registry. No second channel.
2. `pipelines:cancelRun` lets **whoever a run blocks** stop it: any member of the session may stop a routine or action
   run (non-line-bound), as any member already may stop a waiting reply; administrators may stop anything.
3. While a run that holds re-runs is in flight, the server **refuses swipe (left and right), regenerate, retake, Back
   and delete** with one sentence. Edit, Forward, sending a line and Continue are unchanged.
4. `src/lib/server/sockets/sessions.editedLineRerun.int.test.ts` loses its `it.fails`.

## Rulings (quote them; do not reinterpret)

- Owner 2026-11-16 (programme 0.9): "Shouldn't need to automatically stop/backtrack the routines etc if the activity is
  properly surfaced in the activity/turn bar"; then: "no, the button would still be disabled. But have the user
  manually stop what ever is running first". Nothing is cancelled or taken back automatically.
- R13, 2026-10-20: "a routine never makes the session busy: a person's work goes ahead of it, never behind it"
  (`runRegistry.ts` ~33–37). The owner's 2026-11-16 words rule for the five held actions **only**. A routine still never
  makes `session.generating` true, never greys Send, never makes a person's line or Continue wait.
- R-15, 2026-09-15: "a person can always stop a reply, branch a session and rewrite a line". **Edit is NOT refused.**
- "a run parked at review keep[s] the session pressable" (`sockets/sessions.ts` ~3178; `docs/pipelines.md` ~338):
  a parked run does not hold anything.
- Owner 2026-10-29: line-bound runs (speaking one line) show only on their line; they hold nothing.
- Today's rule stays: "a waiting reply is the room's to stop" (any member, `sockets/pipelines.ts` ~5953).
- Members never see model plumbing: names and status words only — never a model, connection, loadout or prompt name.
- Sockets: an event in `SCOPED_EVENTS` must carry its scope key (`sessionId`) in the payload, or `emitToUser` silently
  sends nothing. One domain context per event family is the only client listener; you add no client code.

## The shared contract (exists; do not change its exports)

`src/lib/shared/sessions/runsInProgress.ts` (written by the supervisor): `runHoldsReruns({ kind, since, lineBound,
parked })`, `waitForRunSentence(name)` → `Wait for ‹name› to finish, or stop it first.`, `REPLY_RUN_NAME` (`the reply`),
`RUN_KINDS_HOLDING_RERUNS`. Use these for the server door; w2 uses the same ones on the page.

## What to build

### 1. The run registry (`src/lib/server/pipelines/runtime/runRegistry.ts`)
- `RunHandle` gains `name?: string` (the shown name, when the starter knows it), `readsMessageId?: number`, `parked?: true`.
- `start()` accepts `name?` and `readsMessageId?`.
- `setParked(runId, on: boolean)`; `runOfSignal(signal: AbortSignal): RunHandle | undefined` (a registered run's signal
  is its handle's controller's signal — the review gate is handed only the signal).
- Doc comments on each, stating the rule.

### 2. Parking (`src/lib/server/pipelines/runtime/reviewGate.ts`, `createReviewer` only)
When a review parks: if `scope.signal` belongs to a registered run (`runOfSignal`), `setParked(runId, true)` and announce
the run (step 3). When the review is decided or cancelled: `setParked(runId, false)` and announce again (only if the
run is still registered). A run that parks at two gates: parked while any of its reviews waits (count, not a boolean,
if needed — your call, say which).

### 3. One new server module: `src/lib/server/pipelines/runtime/runsInProgress.ts`
- `runFrameFacts(runId)` → `{ name, since, readsMessageId?, parked?, mayStop }` read off the registry handle; `{}` for
  an unregistered run (a preview, a summarize run that was never registered). `since` = `handle.startedAt` and is
  present **exactly** on registered runs. Frame-level `mayStop` = what every person who hears the frame may do: true
  when the run is not line-bound and its kind is `reply`, `action` or `routine` (every recipient of a session broadcast
  is the owner or a guest, i.e. a member); false otherwise.
- `runShownName(db, handle)`: `handle.name`; else a routine's name (`routines/runs.ts` fact); else for `reply`
  `REPLY_RUN_NAME`; else the pipeline's shown name (`pipeline_specs.name` by slug, cached per process), else the spec id.
  Never a model, connection or prompt name.
- `heldBy(sessionId)` → the first registered handle of the session for which `runHoldsReruns` holds (oldest first;
  skip aborted handles), and `quietRefusal(db, sessionId): Promise<string | null>` → `waitForRunSentence(name)` or null.
- `runsInProgressFor(db, sessionId, viewerUserId)` → `RunStatusFrame[]` for the session's first page: every registered
  run of the session that a page should show (routines once shown, as `routineRunFramesOf` decides today; other runs
  once they have a status or are parked), with a status (the handle's last status, else `<name> is running`), the
  facts above, and `mayStop` computed **for this viewer**: admin → true; the run's starter → true; line-bound → starter
  only; `reply`/`action`/`routine` → any member; else the session's owner.
- `announceRun(runId)`: send this run's current frame now (used on park / unpark). It needs the socket server: keep a
  per-run `{ io, sessionId }` note, set by the status relay when it is created and by the routine run when it starts,
  dropped when the run finishes (no leak: cleared on `finish` or the relay's `end`). Send through
  `broadcastToSessionUsers` like every other `sessions:runStatus` frame.

### 4. Frames carry the facts
- `src/lib/server/pipelines/runtime/runStatus.ts`: `RunStatusFrame` gains `name?: string`, `since?: number`,
  `readsMessageId?: number`, `parked?: true`, `mayStop?: boolean` (doc each). The relay's status and end frames spread
  `runFrameFacts(runId)`; the relay notes its io for `announceRun`.
- `src/lib/server/pipelines/routines/run.ts`: start the registry handle with `name` (the routine's label) and
  `readsMessageId: cause.messageId` when the cause names one; the routine's start/end frames and
  `routineRunFramesOf` carry the facts. **On park** the routine no longer clears its frame: it announces itself parked
  (it shows as waiting for review until its end frame). The queue still moves on when it parks (unchanged).
- `src/lib/server/pipelines/runtime/fireAction.ts` (the `runRegistry.start` at ~1054 only): pass `name` = the action's
  shown name when the chosen declaration has one (its label in `en`, or the action key's words), else leave it unset.
- `src/lib/shared/sockets/types.ts`: `Sockets.Sessions.RunStatus.Response` gains the five fields (doc each). In
  `Sockets.Sessions.Get.Response`, **replace** `routineRuns` with 🚧 `runsInProgress?: Array<RunStatus.Response>`
  ("every run in progress, from the run registry, each as its current frame with `mayStop` for the asker; first page
  only; absent when none"). The page side (w2) reads `runsInProgress`.
- `src/lib/server/sockets/sessions.ts` ~6025–6037 (the first-page seed): `runsInProgress = await
  runsInProgressFor(db, sessionId, userId)` in place of `routineRunFramesOf`.

### 5. Stop: the existing door (`src/lib/server/sockets/pipelines.ts`, `pipelinesCancelRun` ~5930–5985 only)
Starter: as today. Not the starter: administrator (`socket.user.isAdmin`) → may stop any run; a non-line-bound `reply`,
`action` or `routine` → any session member (`checkSessionAccess(...).hasAccess`); anything else (line-bound, a
`maintenance` run) → the session's owner only. "Not your run." stays the refusal. Stopping takes back nothing that
already landed. Update `src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts`'s "any member stops a waiting
reply, nothing else" case to the new rule (a member now stops an action; a member still cannot stop a line-bound run).

### 6. The busy door: the five held actions (`src/lib/server/sockets/sessions.ts`, the guard lines only)
In `sessionMessagesSwipeLeftHandler`, `sessionMessagesSwipeRightHandler`, `sessionMessagesRegenerateHandler`,
`sessionMessagesDeleteHandler`, `sessionsRetakeTurnHandler` and the `rewindTurn` press of `rewindPressHandler` (NOT
`forwardTurn`): once the session is known and access is checked, and **before** the handler waits on the session's
generation lock, `const wait = await quietRefusal(db, sessionId); if (wait) refuse(wait)` with that handler's existing
refusal shape. For retake and Back, first `await settleBackgroundRuns(db, sessionId)` (as retake already does, so a
press a beat after a turn still waits for the turn's children to settle — PLAN-dc-after-walk2 Q1-4), then the guard.
Keep each handler's existing order of other refusals; the guard may go first only where the existing check would wait
in the lock. Check whether any of the five can also be reached through `sessions:fireAction` (a core verb fired with a
`messageId`, e.g. `core#retry`, `core#swipe`, `core#delete`, `core#retake`) or another road; if so, guard that road at
its one shared place too, and name it in your report. **Do not touch** send (`sendPersonaMessage`), Continue
(`sessions:fireTurn`), Edit (`sessionMessages:update`), `extend`, Forward, hide, branch.

### 7. Tests (one test run at a time across the lane: see Commands)
- `src/lib/server/sockets/sessions.editedLineRerun.int.test.ts`: the race case becomes a plain `it`: while the sweep
  (a routine) is held running, the swipe is **refused** with `waitForRunSentence(<the sweep's name>)`; then (a) release
  the gate, settle, swipe again → succeeds and nothing filed from the replaced reply outlives it; and add (b) a second
  plain `it` that stops the routine instead (`pipelinesCancelRun.handler` as the owner, with the routine's run id from
  the registry) → the swipe succeeds after it. Keep the file's other cases as they are.
- New `src/lib/server/sockets/sessions.runsInProgress.int.test.ts` (mock the db with `testDbModule(db)` from
  `src/lib/server/utils/testDb.ts`, see `CONTRIBUTING.md` line ~81; 60 s timeouts on any `it` that opens a db; mock
  `broadcastToSessionUsers` to record frames):
  - the frames carry `sessionId`, `kind`, `name`, `since`, `mayStop`; a routine's carry `readsMessageId` when its cause
    named a line; a parked run's frame carries `parked: true` and its end frame clears it;
  - `sessions:get`'s `runsInProgress` lists a reply, an action and a routine run in progress, and gives a second
    member (a guest of the session, `sessionGuests`) and the owner the right `mayStop` (a member: true for a routine and
    an action; false for someone else's line-bound run);
  - Stop per kind through `pipelinesCancelRun`: the owner stops an action and a routine; **a member stops a routine
    that blocks them**; a non-member cannot (`Not your run.`); an admin stops anything;
  - each of swipe right, swipe left, regenerate, delete, retake and Back is refused with the sentence while a routine
    run and while an action run are registered and in flight, and goes through (no such refusal) after they finish;
  - not refused while the only run is parked at review (`setParked`) or line-bound;
  - Edit (`sessionMessages:update`), Forward, sending a line and Continue are **not** refused while a routine runs
    (they keep today's behaviour);
  - you may register fake runs with `runRegistry.start` / `finish` for the door cases (the real routine path is covered
    by the editedLineRerun file). Clean up with `runRegistry._reset()` between cases.
- Run also the existing files your edits touch: `pipelines.cancelRunAction.int.test.ts`,
  `src/lib/server/pipelines/routines/*.test.ts` that cover `run.ts` frames, `src/lib/server/pipelines/runtime/` tests
  that cover `runStatus.ts`, `reviewGate`, `runRegistry` (find them with grep), `sessions.retake.int.test.ts`, and any
  test asserting `routineRuns` on `sessions:get`.

### 8. Docs (same change)
- `docs/sessions.md` (~145–160, the composer's Send/Stop line and the turn line paragraph; and wherever it says who may
  stop what): say exactly what waits — while an action, a routine or a reply is running, swipe, regenerate, Regenerate
  the last turn, Back and delete wait (greyed, saying *Wait for ‹name› to finish, or stop it first.*); Edit, Forward,
  sending and Continue never wait; a run waiting for review holds nothing; who may stop what (any member: a waiting
  reply, an action, a routine; the person who started it or the owner: speaking a line; administrators: anything).
  Remove "background work never stops you writing" only where it is now untrue (writing a line is still never held).
  The Turn line's own paragraph is w2's: do not rewrite the turn line's description beyond the sentence about Stop.
- `docs/pipelines.md` ~338 (and any Stop description there): the same rule, briefly.
- Do NOT edit `NOMENCLATURE.md`, `INTEGRATING.md`, `docs/session-layout.md` or `STYLE-GUIDE.md` (w2 / the supervisor).

## Files owned (edit only these)

`src/lib/server/pipelines/runtime/runRegistry.ts` · `src/lib/server/pipelines/runtime/reviewGate.ts` (`createReviewer`) ·
`src/lib/server/pipelines/runtime/runsInProgress.ts` (new) · `src/lib/server/pipelines/runtime/runStatus.ts` ·
`src/lib/server/pipelines/routines/run.ts` · `src/lib/server/pipelines/routines/runs.ts` (only if the routine fact needs
a name field) · `src/lib/server/pipelines/runtime/fireAction.ts` (the `start` call's `name`; and the guard road of step 6
if one exists there) · `src/lib/server/sockets/pipelines.ts` (`pipelinesCancelRun` only) · `src/lib/server/sockets/sessions.ts`
(the seed at ~6025 and the guard lines of step 6 only) · `src/lib/shared/sockets/types.ts` (the two Response shapes only) ·
the test files named above and new ones beside them · `docs/sessions.md` · `docs/pipelines.md`.

## Files readable

Anything. Especially: `src/lib/server/pipelines/runtime/sessionEvents.ts` ~994–1008 (event runs are NOT registered;
**do not register them** — the supervisor reports that design first), `src/lib/server/pipelines/entities/publishedValues.ts`
(`sessionGenerating`, `settleBackgroundRuns`), `src/lib/server/auth/actingPerson.ts`, `src/lib/server/utils/sessionAccess.ts`,
`src/lib/server/sockets/utils/broadcastHelpers.ts`, `src/lib/server/pipelines/routines/queue.ts` (read only).

## Out of scope (never built)

Registering event pipelines; cancelling or taking back anything automatically; changing `session.generating`,
`generatingOf`, `answering` in `sessions:fireAction`, send, Continue, Edit, Forward; routine groups; the time-limit
switch; `bindings*.ts` (do not touch any); client code; the SDK repo.

## Stop and ask when (put it in your report and stop that part)

CLAUDE.md §Decisions applies; a new name beyond those in this brief; a kind of run you cannot stop through
`pipelines:cancelRun`; anything needing a table or migration; the guard would refuse sending a line or Continue in a
case that works today; a file outside **Files owned** needs a change (name it and the change).

## Commands

- Every test run, in this exact capped and serialized form (one at a time across the lane — the lock is shared with w2):
  `cd /home/jody/github/serene-pub && flock /tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/ss-7-tests.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-7-w1-<name>.log 2>&1"`
  then read the log (strip ANSI). Never pipe vitest into `head`.
- Type check: `cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (wrap in
  the same `flock`). Report only errors in your files; w2 is editing client files at the same time.
- Standing failures you must not fix: the files listed failing in `plans/lead-full10.log` (strip ANSI).

## Done means

The new and updated test files pass (`sessions.runsInProgress.int.test.ts`, `sessions.editedLineRerun.int.test.ts` with
no `it.fails`, `pipelines.cancelRunAction.int.test.ts`, and the existing tests of every file you edited); tsc has no
error in your files; `npx prettier --check` on each edited file.

## Report (your final message)

Changed files; for each step what you built and any choice you made; tests run with pass/fail counts and log paths;
any road of step 6 you found through `fireAction`; the exact frame fields and the `sessions:get` field as built (w2
depends on them); anything under Stop-and-ask; **Noticed, not done**. Under 600 words.
