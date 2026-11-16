# BRIEF perf-O2 — one document map after the heals (follow-up to perf-O; ★O-1 decided by the lead as implementation inside ★R4-1's go)

**Supervisor:** read `.claude/guides/multi-agent.md`, then `plans/PLAN-performance-2026-11-13.md` Part 5 ([C16], [C17]) and
`plans/REPORT-perf-O-2026-11-14.md` (what is already threaded, and the "Noticed, not done" list). perf-O and perf-P are
finished and scope-reviewed; their files are free. One or two workers.

## Goal
After perf-O a second boot still loads 173 documents (`loadDocument`, 6–7 statements each): 70 through
`templateScopeDetailFor` (35 from `reconcileConfigs` in pass 2 of `seedCoreSpecs`, 35 from the context-template scan),
65 in `refitRegistrations` (`registrations/fit.ts:172`, one `publishedDocuments` call), 38 in `reconcilePresetBindings`
(its own per-run map). Most are the same documents read by different steps. Make it **one map, created once after pass 1's
heals, threaded explicitly** to every later reader. Also one `pipeline_scripts` seed-key read per pass in `seedCoreScripts`.

## What to change
1. **One map, filled only after the heals.** `seedCoreSpecs(db)` returns `SpecSeedReport[]` (`seed.ts:259`), so do not
   change its return shape. Instead give it an optional second argument `{ docs }`: a `Map<string, SpecDocument | null>`
   keyed by spec **slug** (the shape `publishedDocuments(db, slugs, into)` / `DoorOptions.docs` already use,
   `registrations/door.ts:56-76`), created **empty** in `bootstrapPipelines` right before the call and **first filled in
   pass 2** (`reconcilePublishedConfigs`, `seed.ts:389`, after pass 1's `healNodeExpose`/`healClauseChains` `:345-349`
   and after publishing). Fill lazily through `publishedDocuments(db, [slug], docs)` so nothing loads a spec nobody asks
   for. Pass it into `reconcilePublishedConfigs` → `reconcileConfigs` (`config/named.ts:1006`, add `docOf` to the `read`
   option perf-O introduced on `declarationsAndVariableKeys`). The comment at the creation site states the rule: the map
   must hold nothing until pass 1 has run; the order test in `bootstrap.queries.int.test.ts` guards it.
2. **Thread it on.** In `bootstrapPipelines` (`src/lib/server/pipelines/boot/bootstrap.ts` ~`:443-534`) hand that map to
   `refitRegistrations` (new optional `docs` param; use it as `into` for its `publishedDocuments` call at
   `registrations/fit.ts:172`), to `reconcilePresetBindings` (`boot/presetReconcile.ts`: use the passed map instead of
   creating one; keep creating its own when none is passed, for runtime callers) and to `scanContextTemplateFits`
   (`entities/contextTemplateFit.ts`: its per-spec lazy document becomes `docs.get(slug)` filled through
   `publishedDocuments`). **Before** doing so, read `moveSpeakerRebinds`, `reprojectBindingSubjects`,
   `reconcilePlacedNodes` and `migrateLegacyToPipelines` (all between `seedCoreSpecs` and the scan in `bootstrap.ts`) and
   confirm none writes `pipeline_nodes`, `pipeline_edges`, `pipeline_clauses`, `pipeline_includes`, `pipeline_presets` or
   `pipeline_preset_values` of an **existing** version id, nor moves a spec's `active_version_id`. State the finding, with
   file:line, in the comment where the map is created and in the report. If one does write, the map must be rebuilt (or
   that slug evicted) right after it — say so and do that instead of sharing across it.
3. **Keep the [C16] order test** and fix the perf-O scope finding: in `bootstrap.queries.int.test.ts` drop the absolute node-select pin of 600 (keep `≤ 8 × published.length`, then lower it to what you measure), bound the per-variable pin by the distinct variables the scan sees rather than a fixed 25, and write every measured number and the reason for each pin in the test's comments. (`boot/bootstrap.queries.int.test.ts`) green and extend the document-load pin: on a
   second boot, `loadDocument` runs at most once per published slug (measure; pin with a small margin). Lower the node-select
   pin accordingly.
4. **Scripts** (`src/lib/server/pipelines/boot/seedScripts.ts` ~`:58`): one `select` of every core seed-key row before the
   loop, then look up in memory — same rows, same names, same transaction.

## Files owned
`src/lib/server/pipelines/boot/seed.ts`, `src/lib/server/pipelines/boot/bootstrap.ts` (only the threading lines between
`seedCoreSpecs` and the scan — do not reorder steps), `src/lib/server/pipelines/config/named.ts` (`reconcileConfigs`
signature/threading only), `src/lib/server/pipelines/config/panel/declarations.ts` (only if `read.docOf` needs a tweak),
`src/lib/server/pipelines/registrations/fit.ts`, `src/lib/server/pipelines/boot/presetReconcile.ts`,
`src/lib/server/pipelines/entities/contextTemplateFit.ts`, `src/lib/server/pipelines/boot/seedScripts.ts`,
`src/lib/server/pipelines/boot/bootstrap.queries.int.test.ts`, and existing tests of these files if a signature changes.

## Files readable
Everything under `src/lib/server/pipelines/`, `src/lib/server/db/schema.ts`, the two lane reports and worker briefs under `plans/`.

## Out of scope — written down, never built
`startup/index.ts` (a peer's `timeline-switch` task lives there), `registrySync.ts`, `store.ts`, `state/declarations.ts`,
`seedPrompts.ts`, `registrations/write.ts`. No cache on the db handle or module scope, no invalidation hooks, no setting,
event, migration or SDK edit. The 79 no-op `update pipeline_specs set name` statements and the 158 `pipeline_config_values`
selects stay as they are (list them under Noticed if you learn more).

## Rules (quoted for workers)
- P1 "Deterministic, never hidden": the map is a parameter, created at one named place after the heals, never a cache.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- "A second boot changes nothing": `bootstrap.int.test.ts:57` stays green.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Do not run `prettier --write` at all** (not on a directory, not on a file: on 2026-11-14 it reformatted another
  session's uncommitted hunks in the same file). Run `npx prettier --check <file>` and fix only your own hunks by hand.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No sdk:build needed.)
- Comment ratchet: say what the code does now; avoid "no longer", "used to", "previously", "deliberately not".
- Int tests inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`; DB in `beforeAll` → 60 s timeout.
  Another session runs small targeted vitest runs too: check `pgrep -af vitest` and wait if one is running.

## Done means
- Green: `bootstrap.int.test.ts`, `bootstrap.queries.int.test.ts` (pins lowered, reasons in comments), `seed.int.test.ts`,
  `seed.rebindMove.int.test.ts`, `presetReconcile*.test.ts`/`sockets/presetFallback.int.test.ts` (note: its "draw pictures"
  expectation already fails at baseline for an unrelated reason — report, don't fix), `registrations/*.test.ts`,
  `contextTemplateFit*.test.ts`, `seedScripts.int.test.ts`.
- `npx tsc --noEmit -p .` clean.
- Measured before/after: `loadDocument` calls and total statements of a second `bootstrapPipelines(db)`.

## Report path
`plans/REPORT-perf-O2-2026-11-14.md` — changed files, tests with results, measurements, the writer check from step 2, open ★, Noticed, not done.
