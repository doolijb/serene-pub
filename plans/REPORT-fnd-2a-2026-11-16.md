# REPORT — lane `fnd-2a` (2026-11-16): `pipelines/runtime/bindings.ts` split by area

Saved by the lead from the supervisor's report (condensed). All seven steps landed, each verified before the next.
Mechanical moves by one script that refuses to write unless every moved block is byte-identical in the new file
and `bindings.ts` changed nowhere else.

| Step | New file (lines) | `bindings.ts` after |
|---|---|---|
| 0 | — | 10,363 |
| 1 | `bindings.shared.ts` (376) | 10,023 |
| 2 | `bindings.prompt.ts` (2,088), `promptBindings(run)` | 7,982 |
| 3 | `bindings.retrieval.ts` (2,188), `retrievalBindings()` | 5,842 |
| 4 | `bindings.turnOrder.ts` (393), `turnOrderBindings()` | 5,491 |
| 5 | `bindings.providers.ts` (949), `providerBindings()` | 4,579 |
| 6 | `bindings.outlets.ts` (902), `outletBindings(run)` | 3,710 |
| 7 | `bindings.summarize.ts` (1,748), `summarizeBindings(run)` | 2,009 |

Checks after every step: `tsc` 0 errors; the target tests (only the 3 standing failures); 143 `reads<…>()`
registrations summed, unchanged; the readsPairing proof (a broken pairing in the new file fails the test naming
that file); the key-set proof (171 sorted keys and every handler's `readsOf` identical to the pre-split
baseline; every handler's compiled source identical apart from one bundler rename). Final: `tsc` 0, `npm run
check` 0 errors, 101 target tests pass.

No `bindings.*.ts` imports `./bindings`; `bindings.relationships.ts` reads `castEntityRefs` from
`./bindings.shared`. Every public name is still importable from `bindings.ts`. `readsPairing.test.ts` lists all
seven new files. Contributor note: `src/lib/server/pipelines/README.md`.

What stays in `bindings.ts` (2,009 lines): imports, inlets, session history, turn plan, relationship queries,
channel lane, session cast, annexes, session settings, merge, eligibility, scripts, rulesets, concat, query
windows, rank-semantic, context budget, rank-hybrid, graph scenes, `SHARED_CORE_HANDLERS`.

Lead: redistributed `src/lib/shared/conformance/commentHistory.ratchet.json` (`bindings.ts` 16 → 2; prompt 6,
retrieval 5, summarize 2, shared 1; total unchanged).

## Noticed, not done

- `bindings.pluginStorage.ts` is not in readsPairing's `FILES` (1 registration unchecked); predates the split.
- The `grep -c 'Unsupplied<' bindings.ts` recipe in `bindingTypes.ts` should cover `bindings*.ts`.
- `coreBindings`'s `@param run` doc says only two nodes read it; outlets and summarize nodes read it too.
- `bindings.relationships.ts`'s header still says "four thousand lines".

## Lead check (2026-11-16)

Every test under `src/lib/server/pipelines` and `src/lib/shared/conformance` (`plans/lead-fnd2a.log`): 395 files, 10 failed, all in the standing list, none new. A full run follows with the next lane.

## Grouped verification (lead, 2026-11-16)

- Full vitest run 11 (`plans/lead-full11.log`, 61.4 min): 22 files failed: the standing 21 plus one pinned sentence (`sessions.dungeonCrawlerWalk2.int.test.ts` expected the old retake refusal *wait for the reply to finish*; the held re-run actions now answer *Wait for the reply to finish, or stop it first.*). The lead updated that expectation; the file passes 14/14.
- `npm run build`: exit 0. `tsc --noEmit`: 0 errors. `npm run check`: 0 errors, 9 warnings.
