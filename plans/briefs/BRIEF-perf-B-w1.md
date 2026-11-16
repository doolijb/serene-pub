# BRIEF — perf-B-w1 — QuickJS plugin sandbox: a worker pool with per-plugin affinity and a `started` ack

Supervisor: lane `perf-B`. You are a `lane-worker`. Repository root: `/home/jody/github/serene-pub`. Another Claude
session and another worker are editing other files in this checkout at the same time: edit **only** the files listed
under Files owned. Use absolute paths. Line numbers are from 2026-11-13; re-read before editing.

## Goal

Today `src/lib/server/plugins/QuickJsSandbox.ts` runs every quickjs plugin's hook calls on **one** worker. A hook
spinning synchronously holds that worker, so a call on any other plugin waits behind it (head-of-line), and the
sandbox's wall-clock backstop (`timeoutMs + 1000`, armed at **post** time in `evaluate`) then kills calls that never
ran and terminates the worker with every bystander. Measured today: a 100 ms-budget call on plugin B behind a spinning
hook on plugin A settles at ~1,100 ms, failed. Fix it with:

1. **A pool of N workers** with per-plugin affinity.
2. **A `started` ack**: the backstop arms when the worker says a job actually began, never at post.
3. **The manager's overrun backstop** (`SandboxManager.ts`, `HOOK_DEADLINE_SLACK_MS`) also armed at start, for the
   same reason.

The pattern to port already exists and is the reference: `src/lib/server/pipelines/scripts/host.ts` — read its
`EVALUATOR_SOURCE` (`onStart`), `WORKER_SOURCE`, the `PendingJob` comment (the 2026-10-19 queued-kill bug), `arm`,
`breakWorker(reason, culprit)`, `post`, and the stale-worker guard `if (w !== worker) return`. Do not edit that file.

## Rulings that bind (owner 2026-11-13, quoted)

- "improvements **without sacrificing security**. The guest-to-host wall, plugin-to-plugin isolation, the interrupt
  and kill path, the memory cap, the grants and the storage transaction semantics stay exactly as they are. A fresh
  runtime + context per call stays (★P3 warm context is unruled: do not build it)."
- "Security posture statements in file headers are canon; update them where your change makes them stale, in the
  same edit."
- CLAUDE.md P1: "Deterministic, never hidden. Code decides what code can … Same inputs, same result."

## The design (decided by the supervisor — build exactly this)

**Pool size.** `export const QUICKJS_POOL_SIZE = Math.min(4, Math.max(2, Math.floor(availableParallelism() / 2)))`
(`import { availableParallelism } from "node:os"`). Rule: half the cores, at least 2, at most 4 — leaves the other
half to the main thread, the database and the script worker. Workers are spawned **lazily per slot**, on the first
job or load routed to that slot.

**Affinity.** `export function workerSlotFor(pluginId: string, size = QUICKJS_POOL_SIZE): number` — FNV-1a 32-bit
over the id's UTF-16 code units (`h = 0x811c9dc5; h ^= c; h = Math.imul(h, 0x01000193)`; then `(h >>> 0) % size`).
Deterministic, no bookkeeping, a plugin's calls always land on one worker, stable across respawns. Every call of one
plugin goes to its slot's worker.

**Every worker holds every loaded bundle.** On spawn, a slot's worker is re-hydrated with everything in `loaded`
(as today's `ensureWorker` does). `load()` stores into the plugin's own slot worker (ensured, and its ack awaited, as
today) and posts the same `store` message, un-awaited, to every *other live* worker. `unload()` posts `drop` to every
live worker. `pendingLoads` entries remember their slot so a slot's break settles only its own load waiters.

**Pending entries** gain: `slot: number`, `job` (the full job object including `stopFlags`, so it can be re-posted),
`started: boolean`. The `killer` stays optional (absent on the inline path and until started).

**The started ack.** In `EVALUATOR_SOURCE`'s `run`, right after `const qjs = await (enginePromise || …)` and the
bundle lookup, and before the deadline is computed, call
`if (typeof module.exports.onStart === "function") module.exports.onStart(job)`. In `WORKER_SOURCE`, set
`module.exports.onStart = function (job) { parentPort.postMessage({ id: job.__msgId, started: true }) }` and pass the
message id in: `module.exports.run(Object.assign({}, msg.job, { __msgId: msg.id }))` (or equivalent — the inline
path must not define `onStart`, and nothing about the guest program changes). The host's message handler:
`started` → `arm(id)`; `outcome` → `settle(id, outcome)`. Guard every handler with the stale check: ignore a message
from a worker that is no longer the slot's current worker.

**arm(id).** Mark `started = true`; if the entry has no killer, set `killer = setTimeout(…, timeoutMs + 1000)` that
settles the job `{ killed: true, reason: \`timeout after ${timeoutMs}ms (worker killed)\` }` and calls
`breakWorker(slot, \`killed after ${timeoutMs}ms — the hook hung\`, id)`. Same sentences as today.

**breakWorker(slot, reason, culprit?).** Terminate only that slot's worker and empty the slot. For each pending entry
**on that slot**: the culprit (already settled by the killer) is skipped; an entry that has **not started** is
**re-posted** to a fresh worker of the same slot (clear its killer, keep its flags so `abort`/`kill` still reach it);
an entry that **had started** fails `{ ok: false, reason, kind: "error" }` exactly as today (a started hook is never
re-run — its fetches may already have gone out). With no culprit, every entry on the slot fails with `reason`. Settle
that slot's `pendingLoads`. Entries on other slots are untouched.

**The `error` event** on any worker keeps today's meaning (an environment problem): set `workerBroken = true`, warn
once with today's sentence, break **every** slot with no culprit; later calls run inline. **`dispose()`** breaks every
slot and sets `workerBroken`. **`kill`/`abort`** are unchanged (flags + settle) and keep working per job whichever
slot it is on; a job killed while still queued settles at once, and when its worker later starts it, `arm` finds no
entry and the evaluator's interrupt sees `STOP_KILL` at once.

**The inline path** (`SP_PLUGINS_INLINE=1`, or a broken pool) is unchanged.

**The manager.** `QuickJsSandbox.invoke(hook, opts, onStarted?: () => void)` — a third optional parameter (it stays
assignable to `PluginSandbox`; do **not** edit `types.ts`). The sandbox calls `onStarted` once: from `arm` on the
worker path, and immediately when the job is handed to the inline evaluator on the inline path. In
`SandboxManager.dispatch` (~line 915), arm the overrun timer from that callback when the call's sandbox is
`this.quickjs`; for SES arm it immediately, as today (it is inert there by construction). Build the invoke options
once in a `const` so both branches pass the same object. Guard the callback: if the call already settled (its
`finally` ran), arming must not happen — check that `this.active.has(callId)` (or equivalent) before setting the
timer, so no timer is left behind.

**Header and comment updates, same edit.** `QuickJsSandbox.ts` header: replace "one pooled worker holds the WASM
module warm" with the pool (size rule, per-plugin affinity, each worker holding the engine and every loaded bundle)
and say the backstop arms when a job starts and kills only that job's worker. The meaning of every security sentence
stays — isolation, fresh runtime + context per call, interrupt, memory cap, kill path. Update the `kill()` doc ("every
other job on the shared sandbox keeps running" — still true; mention per worker only if the sentence became false),
the `breakWorker` comment, and the `Pending` interface comments. `SandboxManager.ts`: the `HOOK_DEADLINE_SLACK_MS`
comment ("Armed for every call…") and the dispatch comment at ~917 must say the overrun is armed when the sandbox
reports the call started (quickjs) — a call queued behind another on its worker is never killed for the wait — and
that the starvation case it guards is now among calls sharing one worker of the pool. The header's "a single shared
QuickJS sandbox hosts every quickjs plugin" stays true (one sandbox, a pool inside); add the pool in a few words.

## Tests (in the owned test files)

Keep every existing assertion. Where an existing test's *precondition* was "two plugins share the one worker" (the
starvation test in `SandboxManager.test.ts` ~1070–1140, `"starved"` and `"hog"`), keep every assertion and change only
the fixture ids so the two land on one slot: pick the hog id by scanning `hog-0`, `hog-1`, … until
`workerSlotFor(id) === workerSlotFor("starved")`, and update the describe's comment (one worker *of the pool*). If any
test asserting isolation, kill or abort semantics would need an **assertion** changed to pass, stop and report it to
the supervisor instead.

Add, in `QuickJsSandbox.test.ts`:

- **(a) bystander latency:** two plugins on **different** slots (pick ids with `workerSlotFor`); warm both with one
  trivial call each; start a `for (;;) {}` hook on the first with `timeoutMs: 2000`; sleep ~50 ms so it is running;
  time a trivial call on the second with `timeoutMs: 100` — expect `ok: true` and elapsed `< 50` ms. Await the spinner
  (it ends `timeout`, not `error`). Test timeout 30 s.
- **(b) a queued job is not killed before it starts:** two plugin ids on the **same** slot; start a spinner on the
  first with `timeoutMs: 1500`; sleep ~50 ms; invoke a trivial hook on the second with `timeoutMs: 300` (armed at
  post, its backstop would fire at ~1,300 ms, before it ever ran, and take the spinner with it). Expect the queued
  call `ok: true`, and the spinner's outcome `timeout`. Test timeout 30 s.
- **(c)** `workerSlotFor` is deterministic and in range for sizes 2..4.

Add, in `SandboxManager.test.ts`, the manager-level twin of (b): two quickjs plugins on one slot, a spinner with
`timeoutMs: 1500` and a queued call with `timeoutMs: 300` — the queued call ends `ok: true`, not `killed` with "overran
its 300ms deadline". Test timeout 60 s.

## Files owned

`src/lib/server/plugins/QuickJsSandbox.ts` · `src/lib/server/plugins/SandboxManager.ts` ·
`src/lib/server/plugins/QuickJsSandbox.test.ts` · `src/lib/server/plugins/SandboxManager.test.ts`

## Files readable

Everything. Especially `src/lib/server/pipelines/scripts/host.ts` and `host.test.ts` (the pattern),
`src/lib/server/plugins/types.ts` (`PluginSandbox`, `InvokeOptions` — read, never edit), `hookGrace.ts`.

## Out of scope

Changing the guest program or input marshalling (another worker does that next — leave `buildProgram` and the drive
loop's `setTimeout(r, 1)` alone). Warm contexts. `SesWorkerSandbox.ts`, `types.ts`, `storageHost.ts`, `fetchHost.ts`.
Any new setting or environment variable. Any user-facing text change.

## Stop and ask when

A security statement in a header would change in meaning; a test asserting isolation or kill semantics needs an
assertion changed; anything not described above that you would have to decide (report it, don't decide it).

## Done means

```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/plugins/QuickJsSandbox.test.ts src/lib/server/plugins/SandboxManager.test.ts src/lib/server/plugins/sandboxAuthoring.contract.test.ts src/lib/server/plugins/engineHost.int.test.ts
```
all green (run them; never pipe vitest into `head`), `npx tsc --noEmit -p .` shows no error in your files (grep its
output for them), and `npx prettier --check` on each file you edited passes.

## Report

Reply with: changed files; the tests run and their results (counts); the three new tests' names and the measured
elapsed of (a); any assertion you could not keep; anything you noticed and did not do.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Never `prettier --write` a directory; only a file you edited. Never `git checkout`/`restore` anything.
