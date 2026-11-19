# BRIEF — perf-1 worker w2 — per-run memo of the `session_cast` read

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-1`. Report path: `plans/REPORT-perf-1-w2.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build` at all: the SDK does not change in this task.)

## Goal

One Story reply's run host reads `session_cast` 5 times with the same arguments (three retrieval lanes at
`bindings.retrieval.ts:497`, `bindings.ts:949`, `bindings.relationships.ts:416`), ~53 statements each, with no
write in between. Memoise that read **per host (one run)**, keyed by session id, the way the existing per-run
memos in `src/lib/server/pipelines/runtime/host.ts` are built (`narratorNameBySession` / `narratorNameOf`
just added beside `diceHiddenBySession`, ~line 806; and `lorebookReads`), with this invalidation:

- **Every `host.commit` and every `host.call` clears the memo, both when it starts and when it ends**
  (`finally`). Commits are the outlets (seat bench, messages, lore, clock …); calls include the generate
  step, whose live row writes messages. Clearing at start and end means a read that overlapped a write is never
  served after it.
- A failed read is not remembered (on rejection delete the entry; the caller still gets the rejection).
- No caching across runs: the next run builds a new host.

What the read depends on (checked): `q.sessionId ?? scope.sessionId`, the host's fixed `scope`
(`scope.channel`, `scope.userId`), and DB state. `node` is used only by `assertScoped` (an error's wording).

## Exact change (host.ts only)

1. Beside `narratorNameBySession`: `const sessionCastReads = new Map<number, Promise<unknown>>()`, with a doc
   comment in the house style saying what it is, "once per host (one run)", and **what invalidates it**
   (above), and why a hit is a copy (next point).
2. `case "session_cast"` (~line 2542): compute `sessionId = q.sessionId ?? scope.sessionId`; call
   `assertScoped(node, q.sessionId, scope.sessionId)` **before** the memo lookup (so a misuse is refused on every
   call, as today); when `sessionId === undefined` call `readSessionCast(...)` exactly as now (no memo).
   Otherwise take or start the memoised promise of
   `readSessionCast({ db, scope, host, node, q }, channelShaping, narratorNameOf)` and return
   **`structuredClone(await pending)`** to every caller, the first included: each caller keeps getting a fresh
   object it may mutate, as before, and the memo's copy is never touched.
3. In the wrappers at the end of `createHost` (~lines 7555–7580: `host.call = async (...)`,
   `host.commit = async (...)`), clear `sessionCastReads` at the start and in a `finally`. Keep the existing
   `try/catch` + `plain(e, node)` behaviour exactly; do not touch `host.read`'s wrapper.

Touch nothing else. Do not move code, rename anything, or reformat lines you don't change.

## Test (new file)

`src/lib/server/pipelines/runtime/host.sessionCastMemo.int.test.ts`. Model fixtures on
`host.sessionCast.cardless.int.test.ts` (session + seats, `createHost(db, { sessionId }).read!("session_cast",
{ sessionId }, castNode)`) and the bench commit on `setSeatBench.int.test.ts` (`host.commit!({ seat, benched },
BENCH)` with the `core:outlet/set-seat-bench` node). Count statements by wrapping `db.$client.query` the way
`unknownEntries.reply.int.test.ts` does (`reply()`, ~line 177). `vi.setConfig({ testTimeout: 60_000,
hookTimeout: 60_000 })`. Cases:
- one host, two reads: the second issues **0** statements and `toStrictEqual`s the first;
- `structuredClone` keeps the value: `expect(structuredClone(first)).toStrictEqual(first)` on a read whose fixture
  has a character seat, a player seat and a lorebook (so dates, nulls, arrays are present);
- mutating the first read's result (push onto `sessionCharacters`, change a name) does not show in the second;
- **a write in the same run is seen by the next read**: read, then `host.commit` the seat-bench outlet on one
  seat, then read again on the same host: the seat reads `enabled: false`;
- a direct DB change made between two runs is seen by a **new** host (no caching across runs);
- a rejected read is not remembered (e.g. make the first read throw by spying, or skip this case if it needs a
  mock of `readSessionCast` that the module layout makes awkward, and say so).

## Rules (quoted from the lane's contract)

- "No behaviour change, prompts byte-identical." "This lane must not change what any read returns."
- "A read repeated within one run with the same arguments → memoise on the run's host object the way the
  existing per-run memos are … a memo must be dropped or bypassed after a **write** in the same run that could
  change its answer."
- "No caching across runs. No change to query results, ordering or timing of writes."
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently." The memo holds a promise built from the host's own `db`, as the read it replaces; never read it
  from inside a transaction callback.
- CLAUDE.md: "It is a **session**, never a *chat*." No new user-facing names.
- `npx prettier --check` only, **never `--write`** (host.ts was already not prettier-clean before this lane:
  report it, don't fix it). No migration. Don't touch `routines/evaluate.ts` or any file outside **Files
  owned**. Run no git command that changes the index or the working tree.

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (only the lines above), the new test file.

## Files readable

Anything under `src/`.

## Out of scope

`host.read.sessionCast.ts` internals; `sessions/settings.ts` (its `readCast` makes a host of its own: not
this task); any other memo.

## Stop and ask when

A consumer turns out to depend on object identity across reads; `structuredClone` changes a value
(`toStrictEqual` fails); a change outside the files owned seems needed; CLAUDE.md §Decisions applies. Write the
question in your report and stop.

## Done means

Each command **one at a time**, each preceded by
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, from the repo root:

1. `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/host.sessionCastMemo.int.test.ts src/lib/server/pipelines/runtime/host.narratorNameMemo.int.test.ts src/lib/server/pipelines/runtime/setSeatBench.int.test.ts src/lib/server/pipelines/runtime/host.sessionCast.cardless.int.test.ts src/lib/server/pipelines/runtime/host.sessionCast.storyTime.int.test.ts src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts src/lib/server/pipelines/runtime/storyTimeRead.guard.test.ts src/lib/server/pipelines/runtime/loreWriteDate.guard.test.ts > plans/perf-1-w2-1.log 2>&1"` — all green.
2. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-1-w2-tsc.log 2>&1` — errors in
   your files: 0 expected; elsewhere: count only.
3. `npx prettier --check <your new test file>`.

Never pipe vitest into `head`. The supervisor runs the two prompt baselines; do not run them.

## Report

`plans/REPORT-perf-1-w2.md`: changed files with line ranges, the diff summary, tests with results (log paths),
tsc, prettier, anything noticed but not done.
