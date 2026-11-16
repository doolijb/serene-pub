# REPORT perf-O2 — one document map after the heals — 2026-11-14

Status: **done**. Nothing committed. Every new parameter is optional, so runtime and test callers that don't pass one get a per-run map, as before.

## Measured: a second `bootstrapPipelines(db)` on the counting handle (79 published specs)

| measure | before | after |
|---|---|---|
| total statements | 3,840 | **2,973** (−867, −23%) |
| `loadDocument` calls (`from "pipeline_edges"`) | 173 | **66** |
| `loadDocument` calls seen by the test's `vi.mock` / distinct version ids | 138 / 66 | **66 / 66** (no version loaded twice) |
| `pipeline_nodes … spec_version_id` selects | 573 | **466** |
| `pipeline_scripts` selects by `seed_key` | 112 | **69** (−43 = 44 core scripts − 1) |
| per-variable offer selects | 19 (19 variables) | 19 (19 variables) |

- "Before" was measured with the same counting handle, on the tree after perf-O/perf-P and before this lane's edits. Both lines are in the scratchpad file `perf-O2-measure.txt`.
- 66 is under 79 because the map only loads slugs that some step asks for.
- The 35-load gap between the edges count and the mocked count before the change came from the default `docOf` in `declarationsAndVariableKeys`. It closed once that path went through `publishedDocuments`. This was not investigated further.

## Changed files (all under `src/lib/server/pipelines/`)

- `boot/seed.ts`:
  - `seedCoreSpecs(db, opts: { docs? } = {})` keeps its return shape and passes `opts.docs` on.
  - `reconcilePublishedConfigs(db, docs = new Map())` builds one lazy `docOf` per spec: `publishedDocuments(db, [slug], docs)`, falling back to `loadDocument(db, activeVersionId)` where the map holds null.
  - The fallback keeps today's behaviour for an active version that isn't `published`, and for a load that throws (`publishedDocuments` swallows the throw; the fallback throws it again into the existing try/catch).
  - `docOf` is passed to `reconcileConfigs`.
- `config/named.ts` (threading only): `reconcileConfigs(…, byPin?, docOf?)` passes `{ byPin, docOf }` as `declarationsAndVariableKeys`'s `read`. It adds `import type { SpecDocument }`. `declarations.ts` is untouched.
- `boot/bootstrap.ts` (threading only, no step reordered):
  - `const docs = new Map<string, SpecDocument | null>()` sits right before `seedCoreSpecs(db, { docs })`, with the rule comment and the writer check below.
  - The map is passed to `refitRegistrations(db, undefined, docs)`, `reconcilePresetBindings(db, docs)` and `scanContextTemplateFits(db, docs)`.
- `registrations/fit.ts`: `refitRegistrations(db, names?, docs?)` uses `docs` as `into` for `publishedDocuments`. The local result is renamed `published` and passed to the door as `docs: published`. `refitAfterChange` passes no map.
- `boot/presetReconcile.ts`: `reconcilePresetBindings(db, docs = new Map())`. The local map is gone and the comment says what the parameter is.
- `entities/contextTemplateFit.ts`: `scanContextTemplateFits(db, docs = new Map())`. The per-spec lazy document reads through `publishedDocuments` with the same fallback.
- `boot/seedScripts.ts`: one `tx.select()` of every core seed-key row (`inArray(seedKey, CORE_SCRIPTS.map(…))`) before the loop, looked up from a `Map`.
  - The per-script `pool` select by `type_id` stays, because names depend on insertion order.
  - It is the same transaction.
  - The 44 `CORE_SCRIPTS` have 44 distinct seed keys, and `seed_key` is unique, so the prefetch is equivalent.
- `boot/bootstrap.queries.int.test.ts` (this lane's file from perf-O):
  - The absolute 600 node pin is dropped. Node selects are pinned at ≤ 6.5 × published (466 / 79). The comment accounts for 461 of the 466: 5 per spec (`declarationsAndVariableKeys` ×2, `chainNodesFor`, `healNodeExpose`, `reconcilePlacedNodes`) plus 66 loads. 5 are unexplained.
  - New document-load pins:
    - edges count ≤ published.length;
    - edges count = mocked loads;
    - no version id is loaded twice.
  - Scripts by seed key: ≤ 75 (measured 69).
  - Per-variable offers: the logger records params, and the pin asserts the number of offer selects equals the number of distinct `variable_id` params (19 = 19, guarded > 0). This replaces the fixed 25.
  - Full-registry selects ≤ 6 and per-row `layoutByReference` = 0 are kept.
  - The [C16] order test body is unchanged. Its comment now describes the shared map: created empty before `seedCoreSpecs`, first filled in pass 2, handed to the refit, the preset reconcile and the scan.
  - Measured numbers and reasons are in the comments. The header comment is updated.

These are exactly the brief's **Files owned**. Worker briefs: `plans/briefs/BRIEF-perf-O2-w{1,2,3}.md`.

## Writer check (step 2): nothing between pass 2 and the scan writes a document table or moves a pointer

None of the steps below writes `pipeline_nodes`, `_edges`, `_clauses`, `_includes`, `_presets` or `_preset_values`, or `pipeline_specs.active_version_id` / `pipeline_spec_versions`. So no rebuild or eviction is needed. The same list, with file:line, is in the comment at the map's creation in `bootstrap.ts`.

| step | writes only | where |
|---|---|---|
| `seedSessionPresets` | `session_presets` | `seed.ts:512,544,571` |
| `projectRegistrations` | `session_presets`, `registrations` | `registrations/project.ts:143,157`; `registrations/write.ts:73-83` |
| `refitRegistrations` | nothing in the db (in-memory verdicts) | |
| `reconcilePresetBindings` | `session_preset_notices` | `presetReconcile.ts` |
| `moveSpeakerRebinds` | `pipeline_node_rebinds` | `seed.ts:838,844,860` |
| `reprojectBindingSubjects` | `pipeline_bindings` | `bindingSubjects.ts:82,97,101` |
| `reconcilePlacedNodes` | `pipeline_config_notices` | `placedNodeReconcile.ts:143,172` |
| `migrateLegacyToPipelines` | `pipeline_configs`, config values, prompts (`entities/prompts.ts`), selections | `migrate/migrateLegacy.ts:331,359` |

- `reconcileConfigs` itself writes configs, values and notices only.
- `loadDocument` (`store.ts:1032`) reads exactly the six document tables, plus `pipeline_specs` and `pipeline_spec_versions`.
- **Shared-object check:** a grep of `registrations/door.ts`, `registrations/unserved.ts`, `config/panel/declarations.ts` and `entities/contextTemplateFit.ts` found no in-place mutation of a document. The only `.sort` calls are on copies (`unserved.ts:83,223`; `contextTemplateFit.ts:105` sorts `[...rows]`). This rests on a grep, not a line-by-line read.

## Tests run

- w1, one capped run (`--maxWorkers=3`): 11 of 12 files and 95 of 96 tests pass. Files:
  - `boot/bootstrap.int.test.ts` (the second-boot-changes-nothing test is green)
  - `boot/seed.int.test.ts`
  - `boot/seed.rebindMove.int.test.ts`
  - `boot/nonCoreSpecConfigs.int.test.ts`
  - `entities/contextTemplateFit.int.test.ts`
  - `registrations/*.test.ts` (6 files)
  - `sockets/presetFallback.int.test.ts`

  The one failure is the known one in `presetFallback.int.test.ts`, "the boot reconcile records one notice…". It gets "needs a model that can speak". It was reported, not fixed. Log: scratchpad `perf-O2-w1-test.log`.
- w2: `boot/seedScripts.int.test.ts` 3/3 (`perf-O2-w2.log`).
- w3: `boot/bootstrap.queries.int.test.ts` + `boot/bootstrap.int.test.ts` together, 2 files and 10 tests green (`perf-O2-w3-3.log`). The [C16] test fails when its final assertion is inverted (`perf-O2-w3-inv.log`); the assertion was restored.
- `npx tsc --noEmit -p .`, my run after all workers: 1 error, `src/lib/server/lorebooks/redlines.ts(474,11)` TS2769. That is the peer session's area; nothing of this lane's.
- Prettier:
  - The queries test passes `--check`.
  - The edited source files are flagged, as their HEAD versions already were. Our own hunks are clean. `--write` was never run.
  - w3 brought the test file into line by copying prettier's printed output over it. The file is this lane's own and untracked, so no other session's hunks were touched.

Scratchpad logs live in `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/`. My baseline runs left no `/tmp/serene-pub-vitest-*` dirs behind.

## Open ★

None. The map's creation point and threading were decided by the lead inside ★R4-1's go (★O-1).

## Relayed status question

None received.

## Noticed, not done

- 5 of the 466 node selects aren't accounted for in the test comment. Untraced.
- The remaining node selects are 5 per spec. `declarationsAndVariableKeys` (reconcile and scan) and `chainNodesFor` read the same version's nodes back to back inside `reconcileConfigs`. `healNodeExpose` and `reconcilePlacedNodes` each read them again. Threading a node map is the next cut (≈ −316 statements), under the same [C16] rule.
- 68 `pipeline_scripts` seed-key selects are `scriptIdFor` from `refDefaults` (`config/named.ts`), once per spec. One read per boot would remove them. This is the split w3 wrote; it was not verified line by line.
- `seedCoreScripts` still reads the `pool` by `type_id` once per script (44). That is needed for name order as written, though one read per type kept up to date in memory would also work.
- From perf-O, unchanged: 79 no-op `update pipeline_specs set name`, and 158 `pipeline_config_values` selects by config.
- `presetFallback.int.test.ts` still has the baseline "speak" expectation failure.
- `lorebooks/redlines.ts:474` TS2769 belongs to the peer.
