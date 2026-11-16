# BRIEF — perf-B-w4 — point the §9 budgets and the abuse corpus at the production script host

Supervisor: lane `perf-B`. You are a `lane-worker`. Repository root: `/home/jody/github/serene-pub`. Another Claude
session and another worker are editing other files in this checkout at the same time: edit **only** the files listed
under Files owned. Use absolute paths.

## Goal (review row A4)

`src/lib/server/scripts/scripts.budgets.test.ts` (run by `npm run test:budgets`, config `vitest.budgets.config.ts`)
and `src/lib/server/scripts/abuse.test.ts` exercise `runScript` from `src/lib/server/scripts/run.ts` — an in-process
path **nothing in production calls**. Production runs every script through `runScriptSource` in
`src/lib/server/pipelines/scripts/host.ts` (a QuickJS worker with a wall-clock backstop; callers:
`pipelines/scripts/chains.ts`, `pipelines/routines/evaluate.ts`, `rulesets/scripts.ts`). Re-point both files at
`runScriptSource` so the gates measure and prove the code that runs.

## Rulings that bind

- Lane brief (quoted): "keep every corpus case, the regex-interrupt case must still pass on the worker path,
  thresholds stay §9's (the first budget measured a cold in-process context; on the worker path a round trip is
  included — if §9's 5 ms does not hold, report the number, do not loosen the threshold). **Do not delete**
  `scripts/run.ts`, `scripts/engine.ts` or `plugins/RuntimeManager.ts`: that is ★P11 and waits for the owner."
- The abuse file's own rule (quoted): "Every case asserts that a known trick fails **in the specific way it should** …
  A case removed here is a claim withdrawn, so removing one needs the same argument as adding one."
- Plan Part 1: "Nothing here changes *what* a turn, a save or a hook produces." You change **tests only**. Never edit
  `host.ts`, `run.ts`, `engine.ts` or `chains.ts`.

## How to re-point (decided by the supervisor)

`runScriptSource(opts)` takes `{ source, vars, extras?, seedLabel, nowMs, timeoutMs?, memoryLimitBytes?,
maxOutputBytes? }` and answers `{ ok: true, value, logs, durationMs } | { ok: false, reason, logs, durationMs }`.
`value` is `undefined` for a bare `return` (passthrough). Read `host.ts` and `host.test.ts` for its exact sentences.

**abuse.test.ts.** Rewrite the `run` helper over `runScriptSource` (`vars: { text: "hello" }` by default,
`seedLabel: "seed:abuse"`, `nowMs: 1_700_000_000_000`; map the old option names: `seed` → `seedLabel`, `startedAt` →
`nowMs`, `memoryBytes` → `memoryLimitBytes`, `input` → `vars`). Keep the `PINNED_ENGINE` import from
`scripts/engine` (a constant; the file stays). Then for each case:

- `r.result === "ok"/"err"` → `r.ok === true/false`; `r.value.text` stays.
- Where the claim is the same but the production host words it differently, adapt **only the matcher**, with a
  one-line comment: the interrupt is `timeout after <n>ms` on the production host (old matcher
  `/too long|interrupt/i`); the output ceiling is `output exceeds <n> bytes` (old `/over its ceiling of 1024/`); a
  bare return is `value === undefined` (old `passthrough: true, value: {}`). Keep every `not.toMatch` that guards the
  memory cases against the clock.
- A case whose **claim the production host does not meet** — expected candidates: the log-line cap (2,000 chars), a
  return carrying an undeclared key refused by name, a scalar refused for a transform, a verdict returned "and never
  merged", `new Date()` pinned to the run's start, `ctx.log` lines kept from a link that then failed — **first run it
  against `runScriptSource` to confirm**. If it fails: do not weaken it, do not delete it, do not change production
  code. Move it, unchanged in its assertions, into a separate
  `describe("run.ts contract — not (yet) true of the production host", …)` that still runs against `runScript` from
  `scripts/run.ts`, with a comment per case naming what the production host does instead, and check whether a
  production caller (`chains.ts` for declared I/O, verdict and transform semantics; receipts for log caps) enforces
  it one level up — say where, with file:line, in the report. Each such case is an open question for the owner.
- The "one context per evaluation" pollution cases, the escape cases, the clocks, the allocation bombs and the
  replay cases must all pass on `runScriptSource`; if one does not, stop and report it — that is a security finding,
  not a test to move.

**scripts.budgets.test.ts.** Re-point every budget at `runScriptSource`: warm up in `beforeAll` with one
`runScriptSource({ source: "return", vars: {}, seedLabel: "budget", nowMs: 0 })` (spawns the worker and compiles the
engine); the cold-instantiation budget times `runScriptSource({ source: "return", vars: {}, … })`; the stop-script
budget passes `vars: { text: tail }` and expects `r.ok`; the five-link chain passes `vars: { text }` and reads
`r.value?.text`. **Thresholds stay** (5 ms, 1 ms, 10 ms p95). Update the header's "What the first measurement found"
with a second row set for the production host (measured p95 of each, the date 2026-11-13, and that a worker round
trip is now included). Remove the `scriptEngine` import only if nothing uses it.

Run `npm run test:budgets` **three times** and report all p95s (log them from the test with `console.log` while
measuring, then remove the logging, or compute them in a scratch copy — your choice). If a budget fails on the
production host, keep the threshold, leave the test as it is, and report the measured number.

`vitest.budgets.config.ts` changes only if the worker path needs it (it should not); say if you touched it.

## Files owned

`src/lib/server/scripts/abuse.test.ts` · `src/lib/server/scripts/scripts.budgets.test.ts` ·
`vitest.budgets.config.ts`

## Files readable

Everything, especially `src/lib/server/pipelines/scripts/host.ts`, `host.test.ts`, `src/lib/server/scripts/run.ts`,
`src/lib/server/pipelines/scripts/chains.ts`.

## Out of scope

Any production code. Deleting `run.ts`/`engine.ts`/`RuntimeManager.ts` (★P11). `pluginBindings.ts`. New settings or
environment variables.

## Stop and ask when

A security-claim case (escape, pollution, clock, memory, replay) fails on `runScriptSource`; you would have to change
an assertion to make a case pass; you would have to decide anything not written above.

## Done means

```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/scripts/abuse.test.ts src/lib/server/pipelines/scripts/host.test.ts
cd /home/jody/github/serene-pub && npm run test:budgets
```
green (or a budget failure reported with its number, threshold unchanged); never pipe vitest into `head`;
`npx tsc --noEmit -p .` shows no error in your files (grep its output); `npx prettier --check` on each file you
edited passes (they were clean before you started).

## Report

Reply with: changed files; tests run and results (counts); the three budgets runs' p95s; every case you adapted (old
matcher → new) and every case you moved to the run.ts-contract block, with what production does instead and where
(if anywhere) a production caller enforces it; anything noticed and not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server".
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Never `prettier --write` a directory; only a file you edited. Never `git checkout`/`restore` anything.
