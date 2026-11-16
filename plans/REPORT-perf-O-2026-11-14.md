# REPORT perf-O — boot reads once (★R4-1 + [C16] [C17] [C19]) — 2026-11-14

Status: **done**. Every change is an optional parameter that runtime callers don't pass, so their behaviour is
unchanged. Nothing was cached on the db handle or at module scope. Nothing was committed.

## Measured: statements of a **second** `bootstrapPipelines(db)` on a seeded test db (79 published specs)

| measure | before | after |
|---|---|---|
| total statements | 6,050 | **3,840** (−37%) |
| full `pipeline_definition_registry` selects | 240 | **4** |
| `loadDocument` calls (counted by `from "pipeline_edges"`) | 295 | **173** |
| `pipeline_nodes … spec_version_id` selects | 695 | **573** |
| `pipeline_variable_templates` selects | 953 (557 `layoutByReference` + 333 `listVariableTemplates`) | **82** (0 per-row; 19 per-variable) |

- Method: a second drizzle handle with a `logger` over the same PGlite client, the same trick as
  `registrySync.queries.int.test.ts`. Both runs used the same file shape.
- The "before" run already included perf-P's in-progress `registrySync.ts` edits. Only the registry *write* path
  differed, so the read figures above are perf-O's alone.
- The total is **not** under the brief's 1,500 target, and it isn't pinned, because perf-P's write batching changes
  it too.
- What is left of the 173 document loads, attributed by stack:
  - 70 via `templateScopeDetailFor`: 35 from `reconcileConfigs` and 35 from the scan, whose own separate load is
    now shared.
  - 65 via `refitRegistrations` → `publishedDocuments`.
  - 38 via `unservedPipelines`. This was ≈125; the 38 that remain are the distinct pipelines across all presets.
- What is left of the 573 node selects:
  - 173 × `loadDocument`
  - 158 from `declarationsAndVariableKeys`: reconcile and scan, 2 per spec
  - 79 from `chainNodesFor`
  - 79 from the pass-1 `healNodeExpose`
  - 79 from `reconcilePlacedNodes`
- So the brief's "~2 node selects per published spec" can't be reached inside this lane's files. The test pins the
  measured count instead (see ★ / Noticed).

## Changed files (all under `src/lib/server/pipelines/`)

- `config/panel/declarations.ts`: `declarations` and `declarationsAndVariableKeys` take an optional
  `read: { byPin?: Map<string, any>; docOf?: () => Promise<SpecDocument> } = {}`. This is the same `read` shape
  `contextTemplateFitAt` already uses.
  - A passed `byPin` skips the registry select.
  - A passed `docOf` replaces the local lazy `loadDocument`.
- `config/chainAddresses.ts`: `chainNodesFor(db, specVersionId, byPinIn?)`. A passed index skips the registry
  select. The parameter is named `byPinIn` because the local `byPin` would otherwise shadow it.
- `config/named.ts`: only threading. `reconcileConfigs(db, specId, specVersionId, specSlug, byPin?)` passes the
  index to both helpers.
- `boot/seed.ts`: only `reconcilePublishedConfigs`. It builds the index once before the spec loop, with the [C16]
  comment saying that `syncDefinitionRegistry` is the registry's only writer in the task and runs before every
  reader.
- `entities/contextTemplateFit.ts`:
  - `scanContextTemplateFits` passes its existing `byPin` and a lazy per-spec `docOf` to `declarations`, so one
    document per spec serves both the declarations walk and the fit checks.
  - [C19] `variableLayoutOffersOf(db, variableIds, into = new Map())` does one select per distinct variable:
    `id, name, reference, isImmutable, withdrawnAt`, ordered by id, then stable-sorted with immutable rows first,
    exactly as `listVariableTemplates` sorts. It keeps the same result shape and order. "Not withdrawn" replaces
    the per-row `layoutByReference`, because `(variableId, reference)` is unique.
  - The memo is threaded through `contextTemplateChecking(…, offers?)` and through `contextTemplateFitAt`'s `read`
    as `offers`. The scan creates one map per run.
- `registrations/unserved.ts`: `unservedPipelines(db, pipelines, docs?)` passes the map to
  `publishedDocuments(db, names, docs)`. The local variable was renamed `published`.
- `boot/presetReconcile.ts`: one `docs` map per `reconcilePresetBindings` run, created before the preset loop. The
  [C16] comment (heals in pass 1; one map per step, never handed across steps) sits at the map. Adds
  `import type { SpecDocument }`.
- **New** `boot/bootstrap.queries.int.test.ts`. It runs a second `bootstrapPipelines` on the counting handle and
  pins:
  - full-registry selects ≤ 6 (measured 4);
  - node selects ≤ 600 and ≤ 8 × published specs (measured 573);
  - per-row `layoutByReference`-shaped selects = 0 (the same regex matched 557 on the baseline run);
  - per-variable offer selects ≤ 25 (measured 19).

  It has a separate [C16] order test:
  - it damages an active version's `pipeline_nodes.expose` to null, picking a version that boot actually loads;
  - it records every `loadDocument` through a pass-through `vi.mock` of `boot/store`;
  - it asserts that every document of that version read during the boot carries the healed `expose`, and that the
    row is healed.

  The worker confirmed the order test fails when its assertion is inverted.

The 8 files above are exactly the brief's **Files owned**. Worker briefs are
`plans/briefs/BRIEF-perf-O-w{1,2,3}.md`.

## Tests run

- Grouped capped run (`--maxWorkers=3`). Log:
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-O-final.log`.
  Result: **12 of 13 files, 144 of 145 tests pass.** Files run:
  - `boot/bootstrap.int.test.ts` (the second-boot-changes-nothing test is green)
  - `boot/bootstrap.queries.int.test.ts`
  - `boot/seed.int.test.ts`
  - `boot/declaredReadsCull.int.test.ts`
  - `entities/contextTemplateFit.int.test.ts`
  - `registrations/unserved.test.ts`
  - `config/panel/index.int.test.ts`
  - `config/panel/openRenders.test.ts`
  - `config/panel/templateScopeFor.test.ts`
  - `entities/variableTemplates.int.test.ts`
  - `sockets/presetFallback.int.test.ts`
  - `sockets/presetEditor.variableLayouts.int.test.ts`
  - `sockets/pipelines.leftoverPicks.int.test.ts`
- **The one failure was already there; perf-O didn't cause it.** It is `sockets/presetFallback.int.test.ts` › "the
  boot reconcile records one notice, and republishing clears it".
  - The test expects every non-stale notice to read `/…draw pictures/`, but one reads
    "Unavailable: needs a model that can speak."
  - I confirmed it still fails with the shared docs map taken out of `presetReconcile.ts` (temporary edit, now
    restored). w1's files aren't on that path.
  - Most likely another lane's speech registration is now offered by the Story preset, and the test expects only the
    picture actions.
- `npx tsc --noEmit -p .`: **0 errors** across the whole project.
- `commentHistory.test.ts` fails on 9 files outside this lane (modelsList, leaveDestination, 0137_loadout_voices,
  indexingActivity, honorModeRetired, settings, localOnnxModels, activityStore, androidWrapper). None of them is a
  perf-O file, and the added comments contain none of the ratchet phrases.
- `npx prettier --check`: the new test file passes. All 7 edited source files are flagged, but their HEAD versions
  are already flagged too, so nothing was reformatted.

## Open ★

- **★O-1 (target):** the brief's "≤ ~2 `pipeline_nodes` selects per published spec" and "warm boot under 1,500"
  aren't reachable inside perf-O's files. The rest is listed under Noticed. Recommendation: accept the measured pins
  (4 / 573 / 0 / 19) for this lane. If the owner wants the next cut, the cheapest next steps are:
  1. thread a docs map through `reconcileConfigs`, which is `named.ts` and beyond this lane's "byPin only" licence
     (−35 loads ≈ −230 statements);
  2. pass one `docs` map into `refitRegistrations` (−65 loads ≈ −420 statements, if some of those are repeats).

  Trade-off: both widen the files that hold a document map, under the same [C16] order rule.

## Relayed status question
None received.

## Noticed, not done

- `presetFallback.int.test.ts` expectation (above) needs a "speak" case or a narrower filter; it belongs to whoever
  added the speech registration.
- `reconcileConfigs` still loads each document once through `templateScopeDetailFor` (35); a `docOf` from a
  per-loop map in `reconcilePublishedConfigs` would remove it (named.ts threading beyond the brief).
- `refitRegistrations` (`registrations/fit.ts:172`) still loads 65 documents through `publishedDocuments`. Not
  checked whether these are distinct.
- 237 unordered `pipeline_nodes` selects come from `healNodeExpose` (seed pass 1), `chainNodesFor` and
  `reconcilePlacedNodes` (`placedNodeReconcile.ts:95`), one each per spec. `declarationsAndVariableKeys` and
  `chainNodesFor` read the same nodes for the same version back to back inside `reconcileConfigs`.
- Other per-spec repeats in the remaining 3,840 statements:
  - `pipeline_scripts`: 112 by seed key
  - `pipeline_prompts`: 82 by seed key
  - `pipeline_config_values` by config: 158
  - `update pipeline_specs set name` (79 no-op updates every boot)

  The `pipeline_scripts` and `pipeline_prompts` reads are perf-P's area. The other two are outside both lanes.
- `ensureDefaultConfig` and three other `declarations(...)` callers in `named.ts` still read the registry per call.
  On a warm boot they don't run on the boot path.
- The prettier baseline is dirty in all 7 edited source files at HEAD.
