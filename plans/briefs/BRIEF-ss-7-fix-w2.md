# BRIEF — worker `ss-7-fix-w2` — one rule for who may stop a run; a line-bound run is its starter's and an administrator's

Supervisor: lane `ss-7-fix` (report to it through your final message). App `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: you do not need `sdk:build`. Never `git checkout` / `restore` in either repo; never `prettier --write`; never
`kill -9`; no migration. Another worker runs at the same time on SDK files: every test run goes through the lane's
lock (below) so only one runs at a time. To know which `/tmp/serene-pub-vitest-*` dirs are yours, list them just
before and just after each run; delete only ones that appeared during your run, after it has exited; if unsure,
leave them and list them in your report.

## Rules (quote; do not reinterpret)

- `auth/actingPerson.ts` ~10–13: *"It is no second rights table: handlers that decide the same question call it
  (M2d, ★B)."* CLAUDE.md P2: *"A module owns its data and every write to it … Two writers of one thing is a bug."*
  Today two rules decide who may stop a run: `personMay`'s `reply-run` case (~146–158, unused) and `mayStopRun`
  (`pipelines/runtime/runsInProgress.ts` ~148–167), which `pipelinesCancelRun` (`sockets/pipelines.ts`
  ~5937–5985) calls. There must be one: `personMay`.
- Who may stop which run (lane ss-7 brief C, owner 2026-11-16, and this fix lane):
  - the run's **starter**: always;
  - an **administrator**: any run;
  - a **line-bound** run (speaking one line; `lineBound` on the handle): **only its starter and an administrator**
    — as before lane ss-7 (the owner may NOT stop another person's spoken line);
  - any **member of the session** (`checkSessionAccess(...).hasAccess`): a run of kind `reply`, `action` or
    `routine` that is not line-bound;
  - the session's **owner** (`isOwner`): any other run of the session that is not line-bound (`maintenance`);
  - nobody else; a run the registry does not hold, or one with no session, is nobody's but its starter's and an
    administrator's.
  - Stopping takes back nothing that already landed.
- Comments state the rule, not the story (CONTRIBUTING §Comments: no "used to", "previously", "before the lane",
  bug history; `src/lib/shared/conformance/commentHistory.test.ts` counts such phrases and only lets the count go down).
- Every function takes `db`; inside `db.transaction(async (tx) => …)` use only `tx`.

## Goal

1. **`auth/actingPerson.ts`**: replace the `reply-run` thing with `{ kind: "run"; runId: string }` (the session is
   read from the registry; R1: a name that covered only replies would lie). The `run` case answers the rule above
   for op `write` and `delete` (stopping is the only write a run takes); op `read` answers session access (the
   starter and an administrator too). Reasons: `"Not your run."` for a refusal, `NOT_FOUND.session` when the person
   has no access to the run's session. Read the handle once from `runRegistry.active()` (or the existing
   `runKindOf` / `runSessionOf` / `runLineBoundOf` plus the starter). Export one pure helper for the member clause,
   `membersMayStopRun(run: { kind: string; lineBound?: boolean }): boolean` (kinds `reply` · `action` · `routine`,
   not line-bound), used by the `run` case. Update the file header (~1–17) and `personMay`'s doc (~96–99: an
   administrator is a super-user here also for stopping a run) to state the rule.
2. **`pipelines/runtime/runsInProgress.ts`**: delete `MEMBER_STOPPABLE`; `mayStopRun` becomes
   `async mayStopRun(db: Db, runId: string, person: ActingPerson): Promise<boolean>` returning
   `(await personMay(db, person, "write", { kind: "run", runId })).ok`, with a one-line doc that it is the
   frames' name for that rule. `runsInProgressFor` builds the viewer's `ActingPerson` (`userId`, `isAdmin` from the
   row it already reads, `via: "view"`) and calls it per handle. The two broadcast sites (`runFrameFacts` ~96 and
   `announceNow` ~299–302), whose `mayStop` is what every hearer may do, call `membersMayStopRun(handle)`. Fix the
   doc comments that describe the old rule (~83–87, ~144–150). Watch for an import cycle
   (`actingPerson.ts` already imports `runRegistry`; it must not import `runsInProgress.ts`).
3. **`sockets/pipelines.ts` `pipelinesCancelRun`** (that handler only): keep `cancel(runId, userId)` as the
   starter's fast path and the `found` / late-cancel handling; for anyone else resolve
   `actingPersonFor(db, { via: "press", userId })` and ask `personMay(db, person, "write", { kind: "run", runId })`
   (no `checkSessionAccess` / `mayStopRun` here). Refusal text stays `"Not your run."`. Update its comment.
4. **`pipelines/runtime/runRegistry.ts` ~35–38** (comment only, the `routine` bullet): say what now waits for a
   routine — swipe, regenerate, retake (*Regenerate the last turn*), Back and delete (the held re-run actions,
   `$lib/shared/sessions/runsInProgress`) — and what never does: it never makes the session generating, never
   greys Send, and sending a line, Continue, Edit and Forward never wait for it; a message's Stop never reaches it.

## Tests

- `src/lib/server/auth/actingPerson.int.test.ts`: replace the `reply-run` describe (~97–129) with `run`: starter;
  administrator (any kind, line-bound included); a member (guest) stops a reply / action / routine; a member
  cannot stop a `maintenance` run, the owner can; **the owner cannot stop another person's line-bound run, an
  administrator and its starter can**; a stranger gets `"Session not found."`; a run not in the registry →
  `"Not your run."`. Check whether the test has an admin person; add one in its setup if not (same file).
- `src/lib/server/sockets/sessions.runsInProgress.int.test.ts` ~512: *"the owner stops a member's line-bound run,
  and the first page's mayStop agrees with the door"* becomes: the owner cannot (door refuses `"Not your run."`,
  first page `mayStop: false`), an administrator can; keep ~498 and ~550 green.
- `src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts`: keep green (adjust only an expectation the rule
  above changes, and say which).

## Files owned (edit only these)

`src/lib/server/auth/actingPerson.ts`, `src/lib/server/auth/actingPerson.int.test.ts`,
`src/lib/server/pipelines/runtime/runsInProgress.ts` (the stop rule parts only),
`src/lib/server/sockets/pipelines.ts` (`pipelinesCancelRun` only), `src/lib/server/pipelines/runtime/runRegistry.ts`
(the comment only), `src/lib/server/sockets/sessions.runsInProgress.int.test.ts`,
`src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts`.

## Out of scope

Docs and NOMENCLATURE (the supervisor writes them); frames' status words, announcing runs, the held door
(another worker after you); `bindings*.ts`; any other permission.

## Stop and ask when

The rule above cannot be expressed without a further new name; another caller of `mayStopRun` or `reply-run`
exists that is not named here; a test needs a file not owned.

## Done means

From `/home/jody/github/serene-pub`, through the lane lock, one run at a time:

`flock plans/ss-7-fix.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/auth/actingPerson.int.test.ts src/lib/server/sockets/sessions.runsInProgress.int.test.ts src/lib/server/sockets/pipelines.cancelRunAction.int.test.ts > plans/ss-7-fix-w2-tests.log 2>&1"` — all pass
(also run any other `src/lib/server/auth/actingPerson*.test.ts` that exists).

`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/ss-7-fix-w2-tsc.log 2>&1` (through the lock
too): no errors in files you touched (the other worker's SDK edits may not be built yet; name any error outside
your files rather than fixing it). `npx prettier --check` each changed file. Never pipe a test run into `head`.

Report: changed files with line numbers, each command with its result, anything not done, anything noticed
outside scope (not fixed).
