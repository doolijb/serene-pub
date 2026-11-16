# BRIEF — perf-B-w2 — storage host measures once per transaction; script host passes input through a guest global

Supervisor: lane `perf-B`. You are a `lane-worker`. Repository root: `/home/jody/github/serene-pub`. Another Claude
session and another worker are editing other files in this checkout at the same time: edit **only** the files listed
under Files owned. Use absolute paths. Line numbers are from 2026-11-13; re-read before editing.

Two independent tasks. Do them in order; run each one's tests before starting the next.

## Rulings that bind (owner 2026-11-13, quoted)

- "improvements **without sacrificing security**. The guest-to-host wall, plugin-to-plugin isolation, the interrupt
  and kill path, the memory cap, the grants and the storage transaction semantics stay exactly as they are."
- "Security posture statements in file headers are canon; update them where your change makes them stale, in the
  same edit."
- Plan Part 1: "Nothing here changes *what* a turn, a save or a hook produces. A lane that finds itself changing an
  answer rather than how often it is computed has left its brief and stops."

## Task 1 — `storageHost.ts`: walk the directory once per transaction (review row A5)

`STORAGE_HOST_SOURCE` (`src/lib/server/plugins/storageHost.ts`, a JS source string evaluated inside the eval
workers — plain ES5-ish JS, `var`, no TS) computes `projectedSize()` by walking the whole plugin directory
(`diskSize(root)`: `readdirSync` + `statSync` per file) on **every** `usage()`, `receipt()` and quota check in
`bufferWrite` — so a hook that writes 1,000 files does ~2,000 directory walks.

Change it to: measure the disk **once per transaction, lazily** (on the first call that needs the size), then keep the
projected size as a **running number** updated by `bufferWrite` and `bufferRemove`. `usage()`, `size()`, `receipt()`
and the quota check read the number. Design (build this):

- `var diskIndex = null` (a `Map` full path → bytes, of every non-directory entry `diskSize` would count, built by one
  walk with the same rules as today's `diskSize`: `readdirSync(dir, { withFileTypes: true })`, recurse into
  directories, `statSync(fp).size` for everything else, swallow a `statSync` error as today, **include** top-level
  `.sptmp-` temps as `diskSize` does) and `var projected = 0`.
- `function measure()` — if `diskIndex` is null: build it, then set `projected` from the formula below evaluated over
  the index against the **current** `writes`/`removes`. The formula must equal today's `projectedSize()` exactly:
  an index entry counts when `covered(entry)` is false (note `covered` already sees a remove of `root` itself) **and**
  neither the entry nor any ancestor directory of it strictly below `root` is in `writes` — that is exactly what
  `diskSize`'s top-down `if (writes.has(fp) || covered(fp)) continue` skips (it never checks `writes.has(root)`) —
  plus `b64Bytes(v)` of every buffered write. Write one helper `counts(e)` for this and use it everywhere below.
- `projectedSize()` becomes `measure(); return projected;`.
- `bufferWrite(full, b64)`: keep the `existing` computation and the refusal check **exactly** as today
  (`projectedSize() - existing + incoming > quota` → `null`; the single `existsSync`/`statSync` of `full` stays — it
  is one stat, not a walk). On acceptance, before mutating `writes`/`removes`: if `diskIndex` is built, subtract the
  disk bytes at or under `full` that currently count (fast path: `diskIndex.has(full)` means a file — just that
  entry if it counts; otherwise scan index entries `=== full` or `under(e, full)`), subtract the old buffered value
  of `full` if any, add `incoming`. Then mutate as today.
- `bufferRemove(full)`: if `diskIndex` is built, subtract the buffered writes it drops (`doomed`) and the counted
  disk bytes at or under `full`, both computed **before** mutating. Then mutate as today.
- If `diskIndex` is not built yet, the mutators only mutate; `measure()` later computes from the current state.
- Leave `bytesAt`, `projectedFiles`/`walkFiles` (`files.list`, `delete`'s freed bytes, `deleteAll`) and `list` alone —
  they need names and mtimes, and `storageHost.test.ts` is the contract for their output.
- Update the comment above `usageFrom` (it describes the old walk cost) and add one sentence to the header's
  "Read-your-writes" section: the disk is measured once per call, when the store is first asked its size, and the
  projection is kept as a running number after that.

`src/lib/server/plugins/storageHost.test.ts` is the contract: **every existing test must pass unchanged.** Add tests:
(1) a transaction writing many files (say 200) calls `readdirSync` on the root once — spy on `fs.readdirSync` the way
the file's existing setup allows (read how it evaluates `STORAGE_HOST_SOURCE`; if it passes a `require`, wrap `fs`
there), or if spying is impractical, assert identical `usage()`/receipt numbers against a reference computed by a
fresh walk; (2) usage and receipts stay exact through a mix of: write over an existing disk file, write a new file,
overwrite a buffered write, remove a directory holding disk files and buffered writes, write under the removed
directory again, `deleteAll(prefix)` — each step's `usage().usedBytes` equal to what a **fresh** host opened on the
same directory after an equivalent commit would report (or computed by hand from the bytes; say which in the test).
(3) the quota refusal point is unchanged: a write that lands exactly on the quota is accepted, one byte over refused.

## Task 2 — `pipelines/scripts/host.ts`: vars and extras through a guest global (review row A3)

Today `buildProgram` embeds `JSON.stringify(JSON.stringify(opts.vars))` and the same for `extras` as string literals
in the program, so the JSON is escaped twice and parsed twice (once by the parser, once by `JSON.parse`). Measured:
64 KB input 1.35 → 0.90 ms as a guest global.

Change: the job carries the two JSON strings beside the program, the evaluator hands them to the guest as global
strings before `evalCode`, and the program `JSON.parse`s them once and **deletes the globals before any user code
runs**, so a script cannot observe them:

- `EvalJob` gains `globals: Record<string, string>` (names → string values). The evaluator, after
  `runtime.newContext()` and inside its `try`, for each entry: `const h = context.newString(value);
  context.setProp(context.global, name, h); h.dispose()`. If setting them throws (memory cap on a huge input), return
  `{ ok: false, reason: <the message> }` as the `evalCode` error path does, never let it escape as a worker crash.
- `runScriptSource` builds `globals: { __spVarsJson: JSON.stringify(opts.vars), __spExtrasJson:
  JSON.stringify(opts.extras ?? {}) }`.
- `buildProgram` replaces the two literal lines with
  `var __parsed = JSON.parse(__spVarsJson); var __extras = JSON.parse(__spExtrasJson);`
  followed immediately by `delete globalThis.__spVarsJson; delete globalThis.__spExtrasJson;` — both before `ctx`,
  `Math.random`, `Date.now` and the user's function body, exactly where the literals were.
- Everything else byte-identical: same seed handling, same bindings, same return shape, same reasons.
- The header says "the whole job crosses as strings" and "zero-callback" — both stay true (still strings, still no
  host function); adjust the wording only if a sentence became false.

Add to `src/lib/server/pipelines/scripts/host.test.ts`: (1) a script cannot see the globals:
`return [typeof __spVarsJson, typeof globalThis.__spExtrasJson, Object.getOwnPropertyNames(globalThis).filter(function (k) { return k.indexOf("__sp") === 0 }).length].join(",")`
returns `"undefined,undefined,0"`; (2) a 64 KB string var round-trips byte-identically (including quotes, backslashes,
` `, a lone surrogate is fine to skip); (3) the inline path (`SP_SCRIPTS_INLINE=1`, see the existing "one
evaluator, two hosts" test) answers the new cases identically.

## Files owned

`src/lib/server/plugins/storageHost.ts` · `src/lib/server/plugins/storageHost.test.ts` ·
`src/lib/server/pipelines/scripts/host.ts` · `src/lib/server/pipelines/scripts/host.test.ts`

## Files readable

Everything. `src/lib/server/plugins/QuickJsSandbox.ts` and `SesWorkerSandbox.ts` splice `STORAGE_HOST_SOURCE` in —
read how, never edit them (another worker owns `QuickJsSandbox.ts` right now).

## Out of scope

`bytesAt`/`files.list`/`list` performance; the plugin sandbox's own program (`QuickJsSandbox.ts`); `scripts/run.ts`,
`scripts/engine.ts`, `plugins/RuntimeManager.ts` (never edit or delete); any new setting or environment variable.

## Stop and ask when

An existing `storageHost.test.ts` or `host.test.ts` assertion would have to change to pass; a security sentence in a
header would change in meaning; you would have to decide anything not written above (report it, don't decide it).

## Done means

```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/plugins/storageHost.test.ts src/lib/server/pipelines/scripts/host.test.ts src/lib/server/plugins/QuickJsSandbox.test.ts src/lib/server/plugins/sandboxAuthoring.contract.test.ts
```
green (QuickJsSandbox's own test may be mid-edit by the other worker: if it fails in a way unrelated to storage,
say so and move on), `npx tsc --noEmit -p .` shows no error in your files (grep its output for them), and
`npx prettier --check` on each file you edited passes.

## Report

Reply with: changed files; tests run and results (counts); the new tests' names; any assertion you could not keep;
anything noticed and not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Never `prettier --write` a directory; only a file you edited. Never `git checkout`/`restore` anything.
