# REPORT — lane `perf-B` — plugin sandbox: pool, cheaper marshalling, one storage walk, tests re-pointed — 2026-11-13

**Written by the lead.** The lane's workers (w1–w4) built the code; its supervisor died on an upstream API error
during final verification and two relaunches died the same way before starting, so the lead re-verified from disk and
wrote this report. Nothing committed.

## What is built (from the diff, checked against BRIEF-perf-B.md)

| step | state | where |
|---|---|---|
| 1 Worker pool, per-plugin affinity, `started` ack | built | `QuickJsSandbox.ts`: `QUICKJS_POOL_SIZE` = half the cores, min 2, max 4; workers spawned lazily; evaluator posts `{started: true}` when a job begins; backstop armed on start; a broken worker fails only its culprit and re-posts not-yet-started jobs; header rewritten. `SandboxManager.ts` header updated ("a small worker pool inside"). |
| 2 Input through a guest global | built | `QuickJsSandbox.ts` ~530 and `pipelines/scripts/host.ts` ~120: job globals set with `newString` + `setProp`, parsed once in the program. SES worker unchanged (parity kept by behaviour, not by text). |
| 3 Storage walk once per transaction | built | `storageHost.ts`: disk measured once per call (header ~51), `projectedSize()` a running number updated by the buffered writes/removes. |
| 4 Budgets and abuse tests on the production host | built | `scripts/scripts.budgets.test.ts` imports `runScriptSource`; `scripts/abuse.test.ts` runs the corpus through `runScriptSource` (it still imports `runScript` for one pin check — the dead files themselves are ★P11 and were not deleted). |
| 5 Drive loop without the 1 ms timer | built | `QuickJsSandbox.ts` ~617–640: the loop yields until a fetch settles, a flag changes or the deadline, instead of polling. |

Changed files (all inside Files owned): `src/lib/server/plugins/{QuickJsSandbox,SandboxManager,storageHost}.ts` and
their `.test.ts`, `src/lib/server/pipelines/scripts/host.ts` + `host.test.ts`, `src/lib/server/scripts/abuse.test.ts`,
`src/lib/server/scripts/scripts.budgets.test.ts`. `vitest.budgets.config.ts` untouched. Worker briefs:
`plans/briefs/BRIEF-perf-B-w1..w4.md`.

## Done means (lead-run, 2026-11-13 02:20)

- `npx tsc --noEmit -p .` filtered to owned files: **clean** (the earlier `storageHost.test.ts:558` error is gone).
- `QuickJsSandbox.test.ts`, `SandboxManager.test.ts`, `storageHost.test.ts`, `sandboxAuthoring.contract.test.ts`,
  `pipelines/scripts/host.test.ts`, `scripts/abuse.test.ts`: **6 files, 171 tests passed**.
- `plugins/engineHost.int.test.ts`: **9 passed**.
- `npm run test:budgets`: the §9 script budgets (now on `runScriptSource`) **pass**; the one failure in the run is
  `src/lib/shared/utils/docsDist.budgets.test.ts` ("161 rendered pages total 4.43 MB, over the 3.00 MB budget"),
  which reads the rendered docs and is unrelated to this lane — see Noticed.

## Measurements (lead's bench scripts, same machine, no dev server)

| measure | before | after |
|---|---|---|
| three 100 ms-budget hook calls behind one spinning hook (another plugin) | settled at ~1,000 ms | settled at 3 / 6 / 9 ms |
| plugin hook, 8 KB bundle, 64 KB input | 4.45 ms | 3.45 ms |
| script step, 64 KB text in | 2.14 ms | 1.16 ms |
| plugin hook, tiny / 8 KB / 64 KB / 256 KB bundle | 1.9 / 2.7 / 7.2 / 22 ms | 1.9 / 2.6 / 7.0 / 21.8 ms (unchanged, as expected without ★P3) |

## Security posture

Unchanged by construction: fresh runtime + context per call, same grants and bridges, same interrupt/kill path and
memory cap; the pool shrinks a worker kill's blast radius from every plugin to the plugins on that worker.

## Open ★

★P3 (warm context, deferred), ★P4 (fetch cap), ★P5 (invocation retention), ★P11 (delete the dead files). None
touched.

## Noticed, not done

- `docsDist.budgets.test.ts` fails at the current tree (rendered docs 4.43 MB vs a 3 MB budget); not this lane's;
  the docs under `docs/` are being edited by the peer session.
- `scripts/abuse.test.ts` keeps one import of the dead `runScript` for the engine-pin case; it goes with ★P11.
- A scope review of this lane's diff by a `scope-reviewer` was not possible (Opus refused upstream); the lead compared
  changed files with Files owned (all inside) and read the headers.
