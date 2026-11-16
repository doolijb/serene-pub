# BRIEF — perf-B-w3 — QuickJS plugin evaluator: input through a guest global, and a drive loop without the 1 ms timer

Supervisor: lane `perf-B`. You are a `lane-worker`. Repository root: `/home/jody/github/serene-pub`. Another Claude
session and another worker are editing other files in this checkout at the same time: edit **only** the files listed
under Files owned. Use absolute paths. Re-read the file before editing: a previous worker just added a worker pool
and a `started` ack to it (keep all of that as it is).

## Rulings that bind (owner 2026-11-13, quoted)

- "improvements **without sacrificing security**. The guest-to-host wall, plugin-to-plugin isolation, the interrupt
  and kill path, the memory cap, the grants and the storage transaction semantics stay exactly as they are. A fresh
  runtime + context per call stays."
- "Security posture statements in file headers are canon; update them where your change makes them stale, in the
  same edit."
- Lane brief: "Byte-for-byte identical behaviour for the hook" and stop on "anything that would make the two backends
  observably differ". The SES backend (`SesWorkerSandbox.ts`, not yours) keeps its program as it is, so the QuickJS
  guest must not be able to observe any new name.
- Lane brief, A7: "wait on whichever settles first of the open fetches, a flag change, or the deadline, instead of
  `setTimeout(r, 1)`. If that complicates the kill/abort guarantees, skip it and say so."

## Task 1 — input and annex through guest globals (review row A3)

In `src/lib/server/plugins/QuickJsSandbox.ts`, `buildProgram` embeds the hook input as
`'var __input = JSON.parse(' + JSON.stringify(inputJson) + ');\n'` and the annex start as
`JSON.parse(' + JSON.stringify(annexJson) + ')` — the JSON is escaped twice and parsed twice. Measured on this
machine: an 8 KB bundle with a 64 KB input costs 4.40 ms per call today vs ~2.7 ms with a tiny input.

Change:

- In `run`, after `runtime.newContext()` and the bridges, before `context.evalCode(program)`: set the global string
  `__spInputJson` = `job.inputJson`, and **only when `job.grants.annex`**, `__spAnnexJson` = `annexJsonOf(job)`, each
  via `const h = context.newString(value); context.setProp(context.global, name, h); h.dispose()`. If that throws
  (memory cap on a huge input), return `classifyFailure(<the error>, flags, job.timeoutMs)` or an equivalent
  `{ ok: false, reason, kind: "error" }` from inside the existing `try` so every `finally` still runs — never let it
  escape as a worker crash.
- In `buildProgram`, keep each parse **at the exact place** its literal was, and delete the global right after it,
  without introducing any new local variable name (the bundle runs in this scope and could see one):
  `'var __input = JSON.parse(__spInputJson);\ndelete globalThis.__spInputJson;\n'` and
  `'ctx.annex = __makeHookAnnex(JSON.parse(__spAnnexJson));\ndelete globalThis.__spAnnexJson;\n'`.
  `buildProgram`'s parameters lose `inputJson`/`annexJson` accordingly.
- Everything else byte-identical: seed, clock, ctx keys and order, prelude, return shape, reasons.

## Task 2 — the drive loop waits instead of polling (review row A7)

At the bottom of the drive loop in `run` (`await new Promise(function (r) { setTimeout(r, 1) })`), the loop spins
every 1 ms while a hook awaits. After `executePendingJobs` has drained the queue and the promise is still pending,
only three things can change anything: a host-held fetch deferred settles (`bridgeFetch`), the stop flags change
(`abort`/`kill` on the host), or the deadline passes. (Storage, package and crypto bridges are synchronous; there is no
guest timer.) Wait on whichever comes first:

- A per-call `wakeUp` slot (`let wakeUp = null`). `bridgeFetch` gets one more argument, a `notify` function, called
  after `deferred.resolve(h)` / `deferred.reject(h)` (only on the paths where it settles, i.e. after the `alive()`
  check). `notify` calls `wakeUp` if set.
- Replace the 1 ms sleep with: compute `left = Math.max(0, deadline - Date.now()) + 1`; await a promise that resolves
  once (`fin`, idempotent, clears its timer and nulls `wakeUp`) on the first of: `wakeUp` being called;
  `setTimeout(fin, left)`; `Atomics.waitAsync(flags, 0, f, left)` where `f` is the flags value this iteration already
  read — if `waitAsync` returns `{ async: false }` (the value already changed), call `fin` at once, else
  `.value.then(fin)`.
- Host side: in `abort()` and `kill()`, after `Atomics.or(...)`, call `Atomics.notify(job.entry.flags, 0)` so a parked
  evaluator wakes at once. Nothing else in `abort`/`kill` changes; `kill` still settles the host side immediately.
- Keep the comment's point that the await is where a concurrent job on this worker gets its turn (still true — the
  loop now yields until something happens).
- If you find any way this makes an abort, a kill, a timeout or a fetch settle **later** than today, or leaves the
  runtime undisposed, stop: revert Task 2 only, and report why.

## Header

`QuickJsSandbox.ts`'s header paragraph on the drive loop ("the loop pumps the job queue in the gaps") stays true;
add half a sentence that it waits for a fetch, a stop flag or the deadline rather than polling. Nothing else in the
header changes meaning.

## Tests (in `src/lib/server/plugins/QuickJsSandbox.test.ts`)

Add:
1. The guest cannot see the globals: a `task` hook returning
   `[typeof __spInputJson, typeof globalThis.__spAnnexJson, Object.getOwnPropertyNames(globalThis).filter(function (k) { return k.indexOf("__sp") === 0 }).length].join(",")`
   answers `"undefined,undefined,0"`; and the same with a kind that is granted the annex (see `hookCtx.ts` /
   `HOOK_CTX_KINDS` for which kinds get `annex`; skip that half if no kind can be invoked without a host-side annex
   job — say so).
2. A 64 KB input string with quotes, backslashes, newlines, U+2028 and an emoji round-trips byte-identically.
3. A parked hook (`await new Promise(function () {})`) with `timeoutMs: 300` ends `timeout` within ~300–600 ms (the
   deadline wakes the loop; it does not hang to the backstop).
4. `abort` wakes a parked hook promptly: the existing "ctx.signal wakes a hook parked on an await" test covers it —
   add an elapsed bound (< 100 ms from the `abort` call to the result) to a **new** test rather than changing that one.

Existing assertions all stay. Run also (read-only, do not edit): `src/lib/server/plugins/fetch.int.test.ts`,
`src/lib/server/plugins/fetchHost.test.ts`, `src/lib/server/plugins/engineHost.cancel.int.test.ts` — they exercise
the fetch wake and the abort path.

## Measure

After both tasks, run the lane's bench and paste its output in your report:
`cd /home/jody/github/serene-pub && npx tsx /tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-B-bench.mts`
(before this lane: 8 KB 2.71 ms · 64 KB 6.77 ms · 256 KB 22.87 ms · 8 KB bundle + 64 KB input 4.40 ms). Run it twice
and report both. Do not edit the bench.

## Files owned

`src/lib/server/plugins/QuickJsSandbox.ts` · `src/lib/server/plugins/QuickJsSandbox.test.ts`

## Files readable

Everything. `SesWorkerSandbox.ts` (the other backend — read for parity, never edit), `prelude.ts`, `hookCtx.ts`,
`types.ts`, `pipelines/scripts/host.ts` (the script host already does Task 1's pattern — mirror it).

## Out of scope

Warm contexts; the SES backend; `SandboxManager.ts`; anything about the pool; any new setting or environment variable.

## Stop and ask when

Any existing assertion must change; a security sentence would change in meaning; the guest could observe a new name;
Task 2 weakens a stop guarantee (revert it, report).

## Done means

```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/plugins/QuickJsSandbox.test.ts src/lib/server/plugins/SandboxManager.test.ts src/lib/server/plugins/sandboxAuthoring.contract.test.ts src/lib/server/plugins/engineHost.int.test.ts src/lib/server/plugins/engineHost.cancel.int.test.ts src/lib/server/plugins/fetch.int.test.ts src/lib/server/plugins/fetchHost.test.ts src/lib/server/plugins/storageHost.test.ts
```
green (never pipe vitest into `head`), `npx tsc --noEmit -p .` shows no error in your files (grep its output), and
`npx prettier --check` on both files passes (both were clean before you started; format only what you changed).

## Report

Reply with: changed files; tests run and results (counts); the new tests' names and their measured elapsed for 3
and 4; both bench runs; anything you reverted and why; anything noticed and not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Never `prettier --write` a directory; only a file you edited. Never `git checkout`/`restore` anything.
