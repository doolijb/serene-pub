# BRIEF — perf-3 worker w2 — the rewind check reads what both verdicts share once (cut 3)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-3`. Report: your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build` — do not run it at all: an isolated app instance may be running. Run no git command that
changes the index or the working tree: no add, reset, checkout, restore, stash, commit.)

## Goal

`rewindStateOf` (`src/lib/server/sessions/rewind.ts` ~140) runs `turnUnitOf` twice — Back's verdict
(`includePersonLines: true`) and Regenerate's (`false`) — on every actions push (≈99 + 97 statements per push in the
Lair, profiled). The two verdicts differ, but most of what `buildTurnUnit` (~309–560) reads does not depend on
`includePersonLines` and is read twice:

| Read | Where in `buildTurnUnit` | ≈ statements per call |
|---|---|---|
| `replayStoryLane(db, sessionId)` | ~322 | 9 |
| `backStepOf(db, sessionId)` (also `rewindStateOf`'s own `step`) | ~330 | 1 |
| `replyRunOf(db, messageId)` → `turnRunOf` + `loadPublished(slug)` | ~409, ~440 | 9 each |
| `unitRuns` → `isCreateRun(db, runId)` → `loadPublished(slug)` | ~590–606 (called at ~462, ~483) | 9 each |
| `creatingRunOf(db, planRowId)` | ~467 | 1 |
| `turnYieldOf(db, runId)` (its rows, its own `rowNaming`, its `cardsNowAsSeatsRead`) | ~481 | 20 |
| `sessionHistorySettle`, `settledLineOf` | ~515–517 | 3 |
| `rowNaming(db, sessionId)` | ~520 | 1–2 (a whole narrator build in a genre with no fallback envoy) |
| `cardsNowAsSeatsRead(db, sessionId, ids)` | ~523 (and `rewindStateOf` ~175) | 16 |

Read each of these **once per `rewindStateOf`** and share it between the two verdicts, and build the row naming
once per `rewindStateOf` (both `buildTurnUnit`'s and `turnYieldOf`'s). Re-verify every line number first.

## Exact change

1. In `rewind.ts`, a module-private per-call read set, e.g. `function turnUnitReads(db, sessionId)` returning lazily
   memoised getters (each a `Map<key, Promise<…>>`, the promise stored on first ask): `replay()`, `backStep()`,
   `historySettle()`, `settledLine()`, `namingOf(sessionId)`, `replyRun(messageId)`, `createRun(runId)`,
   `published(slug)` (the `loadPublished(db, slug).catch(() => null)` both `replyRunOf` and `isCreateRun` make),
   `creatingRun(id)`, `turnYield(runId)`, `cards(ids)` (key: the id list as passed, joined). Each getter calls the
   existing function with exactly today's arguments; keep today's `.catch` postures exactly where they are.
2. `buildTurnUnit(db, sessionId, opts, at, reads = turnUnitReads(db, sessionId))`: every read in the table goes
   through `reads`. `replyRunOf` / `unitRuns` / `isCreateRun` take the read set as a parameter (module-private
   functions; no exported signature changes except item 4). `turnUnitOf` / `turnUnitAt` keep their exported
   signatures and pass nothing (a fresh read set per call — `buildTurnUnit` makes no write, so this is safe; say so
   after checking).
3. `rewindStateOf`: make one read set; `step` = `reads.backStep().catch(() => undefined)`; pass the set to both
   verdicts (call `buildTurnUnit` directly, or give `turnUnitOf` a module-private sibling — your choice, no new
   export); `personaCards` through `reads.cards(...)`.
4. `src/lib/server/sessions/turnYield.ts` `turnYieldOf(db, runId)` gains an optional third parameter
   `opts: { namingOf?: (sessionId: number) => ReturnType<typeof rowNaming> } = {}` and uses
   `(opts.namingOf ?? ((s) => rowNaming(db, s)))(rows[0]!.sessionId)` where it calls `rowNaming` today. Nothing else
   in `turnYield.ts` changes (`rowNaming` itself is untouched). Its other caller (`messages/verbs.ts:324`) is not
   touched.

**Before writing any of it, check that none of the shared functions writes** (`replayStoryLane`, `backStepOf`,
`turnRunOf`, `loadPublished`, `creatingRunOf`, `turnYieldOf`, `sessionHistorySettle`, `settledLineOf`, `rowNaming`,
`cardsNowAsSeatsRead`) and that **no caller mutates** what they return (arrays, maps, run rows) — a shared object
must be read-only to both verdicts and must never reach the push payload by reference where it could be mutated.
If one writes or one result is mutated, leave that read unshared and say so.

Touch nothing else. No new export, name, option or setting beyond item 4's parameter. Do not move code, rename, or
reformat lines you don't change. Short comments in house style where the read set is made and passed.

## What could invalidate it (say so in your report)

The set lives for one `rewindStateOf` (or one `turnUnitOf`/`turnUnitAt` call) and nothing writes inside it. A write
by another request between the two verdicts was seen by the second verdict before and is not now: the two verdicts
now share one snapshot of the shared reads. Nothing is kept past the call.

## Proof and tests

**A. Before/after capture (scratch, deleted after).** BEFORE editing anything, write a scratch test
`src/lib/server/sessions/perf3w2capture.int.test.ts` that builds worlds from the fixtures of
`src/lib/server/sessions/rewind.int.test.ts` (the Lair planned turn, ~1431; rows written straight, ~915) and
`src/lib/server/sessions/rewind.noFloor.int.test.ts` (Story, one message per press, with a greeting, a system row,
two players), adds a guest (`session_guests` row) to each, and at several points (after one turn, after two, after a
Back with one turn ahead, an archived session, a session with nothing yet) records for each world:
`JSON.stringify(await rewindStateOf(db, sid))`, `JSON.stringify` of both `turnUnitOf` verdicts, and
`JSON.stringify(res.rewind)` of `buildSessionActions(sid, uid, "main", { member: true, withRewind: true })` (from
`$lib/server/sockets/sessions`) for the owner and for the guest. Write the strings to
`/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/perf3/w2-before.json`. Run it, then make the change,
re-run it to `w2-after.json`, and show `cmp` of the two files: **byte-identical**. Then delete the scratch test.

**B. Permanent test** `src/lib/server/sessions/rewind.sharedReads.int.test.ts` (fixtures as in A, Story and Lair):
- `rewindStateOf` agrees with the two verdicts read separately (`back` = Back's refusal or null, `regenerate` =
  Regenerate's refusal or null, `backTakes.throughId` = max of Back's unit ids, `backTakes.names` from its rows).
- The owner's and the guest's pushed `rewind` are `toStrictEqual` to each other and to `rewindStateOf`.
- `rewindStateOf` issues fewer statements than the two `turnUnitOf` calls together (count by wrapping
  `db.$client.query`, as `src/lib/server/sockets/sessions.actionsOnce.int.test.ts` `counting` does).
- **A write between two checks is seen:** after a new reply row (or a Back), the next `rewindStateOf` reflects it.

`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`.

Run only as (one at a time, always at least one path; never pipe vitest into `head`):
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done; systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/perf-3-w2-<n>.log 2>&1"`

Done means green: the new file, `src/lib/server/sessions/rewind.int.test.ts`,
`src/lib/server/sessions/rewind.noFloor.int.test.ts`, `src/lib/server/sessions/turnYield.rowNaming.int.test.ts`,
`src/lib/server/sessions/archive.int.test.ts`, `src/lib/server/sockets/sessions.refreshPush.int.test.ts`,
`src/lib/server/sockets/sessions.actionsOnce.int.test.ts`; the capture byte-identical. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-3-w2-tsc.log 2>&1` — 0 errors.
Do not run the two baseline tests (the supervisor does).

## Rules (quoted from the lane's contract)

- "No behaviour change: every prompt fingerprint in both baseline tests stays byte-identical …; what any read
  returns, the order of writes and what every socket push carries are unchanged. No caching across runs."
- "`rewindStateOf` runs `turnUnitOf` twice (~300 statements per push): compute once per `rewindStateOf` and share;
  … compute the naming **once per `rewindStateOf`** … rather than per check. Assert the pushed rewind state is
  deep-equal before and after for Story and the Lair, owner and guest."
- Files you may edit: `src/lib/server/sessions/rewind.ts`, `src/lib/server/sessions/turnYield.ts` (item 4 only),
  the new test, the scratch capture (deleted after). Not `sockets/*`, not `messages/verbs.ts`, not `host*.ts`.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
  A read set made on `db` is never used inside a transaction callback.
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive" — server code here, plain `Map` is right.
- CLAUDE.md: "It is a **session**, never a *chat*." No new user-facing name.
- `npx prettier --check` only, **never `--write`** (the files are not prettier-clean today). House style: tabs,
  double quotes, no semicolons.

## Stop and ask when

A shared function writes or its result is mutated by a caller; the capture differs by one byte; a test fails for a
reason you cannot tie to your change.

## Report (final message, under ~350 words)

Changed files; what you checked (no writes, no mutation); which reads are shared; the capture result; tests with
results (log paths); tsc; prettier; noticed, not done.
