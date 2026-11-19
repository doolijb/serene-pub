# BRIEF — perf-1 worker w1 — per-run memo of the narrator name

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `perf-1`. Report path: `plans/REPORT-perf-1-w1.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build` at all: the SDK does not change in this task.)

## Goal

One Story reply runs `narratorNameFor` (a whole `buildWorld` of the narrate spec, 112 statements) 8 times;
one Lair turn 18 times. Every call in one run, for one session, gives the same answer: no write a run makes
reaches its inputs (pipeline config, prompts, presets, registrations, connections, the session's genre and
preset; checked: no host or binding writes any of those tables; `convert-ruleset` writes only
`sessions.ruleset_version`, which the resolver does not read). Memoise it **per host** (one host = one run),
exactly the way the existing per-host memos `diceHiddenBySession` / `shapingBySession` are built in
`src/lib/server/pipelines/runtime/host.ts` (around lines 770–815).

## Exact change

1. `src/lib/server/pipelines/runtime/host.ts`, next to `diceHiddenBySession` / `channelShaping`:
   - `const narratorNameBySession = new Map<number, Promise<string | null>>()`
   - `const narratorNameOf = (sessionId: number): Promise<string | null>` — returns the cached promise, else
     `narratorNameFor(db, sessionId, undefined)`, stores it, and **on rejection deletes the entry** (so a failed
     read is not remembered; the caller still gets the rejection, as today). `narratorNameFor`'s third argument
     is unused (`_userId`), so passing `undefined` changes nothing.
   - A doc comment in the house style (see the neighbouring ones): what it is, "once per host (one run)", and
     **what invalidates it**: nothing inside a run writes its inputs (name them as above); the next run builds a
     new host, so an edit between runs is always seen. No caching across runs.
   - Replace the narration call near line 3203 (`await narratorNameFor(db, sessionId, scope.userId)`) with
     `await narratorNameOf(sessionId)`.
   - Pass `narratorNameOf` to `readSessionCast` at the `session_cast` case (line ~2521) as a third argument.
2. `src/lib/server/pipelines/runtime/host.read.sessionCast.ts`: add the third parameter
   `narratorName: (sessionId: number) => Promise<string | null>` to `readSessionCast`, and use it at line ~469
   in place of `narratorNameFor(db, sessionId, undefined)`. Drop `narratorNameFor` from that file's import only
   if nothing else in the file uses it.

Touch nothing else in those functions. Do not move code, rename anything, or reformat lines you don't change.

## Test (new file)

`src/lib/server/pipelines/runtime/host.narratorNameMemo.int.test.ts`. Model it on
`nonCastLabels.int.test.ts` (it partial-mocks `./host.helpers`'s `narratorNameFor` and renames the seeded
narrate prompt's `narratorName` field in `pipelinePrompts`) and on `host.sessionCast.cardless.int.test.ts`
(how to build a session and call `createHost(db, { sessionId }).read!("session_cast", { sessionId }, castNode)`).
Use `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`. Cases:
- one host, two `session_cast` reads: the real `narratorNameFor` is called **once** (count the calls through
  the partial mock that delegates to the real one), and both reads carry the same `sessionNarratorName`;
- after renaming the narrate prompt's `narratorName` in the DB, a **new** host's `session_cast` read carries
  the new name (the next run sees the write: no caching across runs);
- a rejected `narratorNameFor` (mock throws once) is not remembered: the same host's next read calls it again.
If the fixture DB needs `bootstrapPipelines` for the narrate spec to resolve a name, call it the way
`nonCastLabels.int.test.ts` does.

## Rules (quoted from the lane's contract)

- "No behaviour change, prompts byte-identical." "This lane must not change what any read returns."
- "No caching across runs. No change to query results, ordering or timing of writes."
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently." The memo holds a promise built from the host's own `db`, exactly as the call it replaces; never
  call `narratorNameOf` from inside a transaction callback.
- CLAUDE.md: "It is a **session**, never a *chat*." No new user-facing names; the memo is a local constant.
- `npx prettier --check` only, **never `--write`**. No migration. Don't touch `routines/evaluate.ts` (another
  worker's) or any file outside **Files owned**. Run no git command that changes the index or the working tree
  (no add, reset, checkout, restore, stash, commit).

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (only the lines above), `host.read.sessionCast.ts` (only the
lines above), the new test file.

## Files readable

Anything under `src/`.

## Out of scope

Any other memo or cut; `runStatus.ts` / `dispatch.ts` / `sockets/sessions.ts` / `sessions/turnYield.ts`
callers of `narratorNameFor` (they are not in a host); `config/world.ts`.

## Stop and ask when

A change outside the files owned seems needed; a test shows the narrator name differs between two reads in
one run; CLAUDE.md §Decisions applies. Write the question in your report and stop.

## Done means

Run each command **one at a time**, each preceded by
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, from the repo root:

1. `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/host.narratorNameMemo.int.test.ts src/lib/server/pipelines/runtime/nonCastLabels.int.test.ts src/lib/server/pipelines/runtime/host.sessionCast.cardless.int.test.ts src/lib/server/pipelines/runtime/storyTimeRead.guard.test.ts src/lib/server/pipelines/runtime/loreWriteDate.guard.test.ts > plans/perf-1-w1-1.log 2>&1"` — all green.
2. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/perf-1-w1-tsc.log 2>&1` — report
   errors in the files you touched (0 expected; errors elsewhere belong to other lanes: list their count only).
3. `npx prettier --check <each file you changed>`.

Never pipe vitest into `head`. The supervisor runs the two prompt baselines itself; do not run them.

## Report

`plans/REPORT-perf-1-w1.md`: changed files with line ranges, the diff summary, tests run with results (log
paths), tsc result, prettier result, anything noticed but not done.
