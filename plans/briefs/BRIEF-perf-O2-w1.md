# BRIEF perf-O2-w1 — thread one document map from after the heals to every later boot reader

Supervisor: perf-O2 (lane brief `plans/briefs/BRIEF-perf-O2.md`). You are a lane-worker. All paths below are under
`/home/jody/github/serene-pub/src/lib/server/pipelines/` unless absolute.

## Goal
A second boot loads ~173 spec documents (`loadDocument`, `boot/store.ts:1032`, 6-7 statements each), mostly the same
documents read by different steps. Make it **one** `Map<string, SpecDocument | null>` keyed by spec **slug** (the shape
`publishedDocuments(db, slugs, into)` in `registrations/door.ts:72-102` and `DoorOptions.docs` already use), created
**empty** in `bootstrapPipelines` right before `seedCoreSpecs`, **first filled in pass 2** (`reconcilePublishedConfigs`),
and handed explicitly to every later reader. Fill it lazily, only through `publishedDocuments(db, [slug], docs)`, so
nothing loads a spec nobody asks for.

## Exact changes
1. `boot/seed.ts`
   - `seedCoreSpecs(db: Db, opts: { docs?: Map<string, SpecDocument | null> } = {})` — return shape unchanged
     (`SpecSeedReport[]`). Pass `opts.docs` to `reconcilePublishedConfigs` at `:389`.
   - `reconcilePublishedConfigs(db, docs = new Map<string, SpecDocument | null>())` (runtime and test callers pass none
     and get their own per-run map). Per spec in the loop, build a lazy `docOf` and pass it to `reconcileConfigs`:
     ```ts
     let docPromise: Promise<SpecDocument> | undefined
     const docOf = () =>
         (docPromise ??= publishedDocuments(db, [spec.slug], docs).then(
             (m) => m.get(spec.slug) ?? loadDocument(db, spec.activeVersionId)
         ))
     ```
     The `?? loadDocument(...)` fallback keeps today's behaviour exactly where the map holds null (an active version
     whose status is not `published`, or a load that threw — `publishedDocuments` swallows the throw into null; the
     fallback throws it again, into the existing try/catch). Import `publishedDocuments` and `loadDocument` the way the
     file already imports neighbours (dynamic `await import(...)` if a static import would create a cycle — check).
2. `config/named.ts` — **signature/threading only**: `reconcileConfigs(db, specId, specVersionId, specSlug, byPin?,
   docOf?: () => Promise<SpecDocument>)`, passing `{ byPin, docOf }` as the `read` option of
   `declarationsAndVariableKeys` (`:1006`). `read.docOf` already exists there (`config/panel/declarations.ts:820,865`);
   do not edit `declarations.ts` unless something truly does not fit (then stop and say why in your report).
3. `boot/bootstrap.ts` — **only threading lines between `seedCoreSpecs` (`:443`) and the scan (`:534`); do not reorder
   any step.** Create the map right before `report.specs = await seedCoreSpecs(db)`, call `seedCoreSpecs(db, { docs })`,
   `refitRegistrations(db, undefined, docs)`, `reconcilePresetBindings(db, docs)`, `scanContextTemplateFits(db, docs)`.
   Put this comment (tighten wording if you like, keep every fact and file:line) at the creation site:
   ```
   // One document map for the rest of this task, by spec slug, and it holds
   // nothing until pass 1 of `seedCoreSpecs` has run: pass 1 heals present
   // versions in place (`healNodeExpose` writes `pipeline_nodes.expose`,
   // `healClauseChains` writes `pipeline_clauses.parent_clause_chain`), so the
   // first entry lands in pass 2 (`reconcilePublishedConfigs`). The order test
   // in `bootstrap.queries.int.test.ts` guards that.
   // Every step after pass 1 that reads a document takes this map. None of the
   // steps between writes a document table (`pipeline_nodes`, `_edges`,
   // `_clauses`, `_includes`, `_presets`, `_preset_values`) or moves a spec's
   // `active_version_id`:
   //   seedSessionPresets — session_presets (seed.ts:495,527,554);
   //   projectRegistrations — session_presets, registrations
   //     (registrations/project.ts:143,157; registrations/write.ts:73-83);
   //   refitRegistrations — in-memory verdicts only;
   //   reconcilePresetBindings — session_preset_notices (presetReconcile.ts);
   //   moveSpeakerRebinds — pipeline_node_rebinds (seed.ts:821,827,843);
   //   reprojectBindingSubjects — pipeline_bindings (bindingSubjects.ts:82,97,101);
   //   reconcilePlacedNodes — pipeline_config_notices (placedNodeReconcile.ts:143,172);
   //   migrateLegacyToPipelines — configs, config values, prompts, selections
   //     (migrate/migrateLegacy.ts:331,359).
   // A step added here that writes one of those must evict the slugs it wrote.
   ```
   **Re-verify each line number** with `grep -n` after your edits (seed.ts lines move when you edit it) and correct them.
4. `registrations/fit.ts` — `refitRegistrations(db, names?, docs?: Map<string, SpecDocument | null>)`; use it as the
   `into` of the `publishedDocuments` call at `:172` (`publishedDocuments(db, pipelinesNamed(...), docs)`; the existing
   default `new Map()` covers the undefined case). `refitAfterChange` passes none.
5. `boot/presetReconcile.ts` — `reconcilePresetBindings(db, docs = new Map<string, SpecDocument | null>())`; delete the
   local `const docs = new Map(...)` at ~`:104` and rewrite the comment above it to say what it is now: the boot passes
   the task's map (created in `bootstrapPipelines` after pass 1, see the comment there); a caller passing none gets a
   map for this run only.
6. `entities/contextTemplateFit.ts` — `scanContextTemplateFits(db, docs = new Map<string, SpecDocument | null>())`. Its
   per-spec lazy document at ~`:386-392` becomes:
   ```ts
   let docPromise: Promise<SpecDocument> | undefined
   const docOf = () =>
       (docPromise ??= publishedDocuments(db, [spec.slug], docs).then(
           (m) => m.get(spec.slug) ?? loadDocument(db, versionId)
       ))
   ```
   (same fallback reason as in seed.ts). Keep everything else in the scan as it is.
7. Check, and say in your report with file:line, that no consumer of a shared document mutates it in place
   (`registrations/door.ts`, `registrations/unserved.ts`, `config/panel/declarations.ts` `openRenders` /
   `templateScopeDetailFor`, `entities/contextTemplateFit.ts`). A first grep found none; confirm by reading the paths
   that receive `doc`. If one does mutate, stop and report — do not fix it.

## Files owned (edit only these)
`boot/seed.ts` (only `seedCoreSpecs`'s signature/the one call, and `reconcilePublishedConfigs`), `boot/bootstrap.ts`
(threading lines + the comment only), `config/named.ts` (`reconcileConfigs` signature/threading only),
`registrations/fit.ts`, `boot/presetReconcile.ts`, `entities/contextTemplateFit.ts`. Existing tests of these only if a
signature change breaks one (optional params should break none).

## Files readable
Everything under `src/lib/server/pipelines/`, `src/lib/server/db/schema.ts`.

## Out of scope — never touch
`boot/bootstrap.queries.int.test.ts` (another worker owns it next), `boot/seedScripts.ts` (another worker, running now),
`startup/index.ts`, `sockets/entries.ts`, `lorebooks/`, `db/schema.ts`, `registrySync.ts`, `store.ts`,
`state/declarations.ts`, `seedPrompts.ts`, `registrations/write.ts`, `registrations/door.ts`, `registrations/unserved.ts`.
No cache on the db handle or at module scope, no invalidation hooks, no setting, event, migration or SDK edit.
Do not touch the `update pipeline_specs set name` statements or `pipeline_config_values` selects.

## Rules
- P1 "Deterministic, never hidden": the map is a parameter, created at one named place after the heals, never a cache.
- Inside `db.transaction(async (tx) => …)` use only `tx`.
- "A second boot changes nothing": `boot/bootstrap.int.test.ts:57` stays green.
- Comment ratchet: say what the code does now; avoid "no longer", "used to", "previously", "deliberately not".
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- **Do not run `prettier --write` at all**, on anything. `npx prettier --check <file>` only, and fix only your own hunks
  by hand (the files' HEAD versions are already flagged; leave other hunks alone).
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No sdk:build is needed.)
- Int tests only inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`; before each run
  check `pgrep -af "vitest run"` and wait if another session's run is up. Never pipe vitest into `head`; redirect to a
  log file under `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/`
  named `perf-O2-w1-*.log` and grep it.
- Never `git checkout`/`restore`/`stash` anything.

## Stop and ask (in your report) when
CLAUDE.md §Decisions applies, a name is new beyond the parameters above, a migration seems needed, or a step between
`seedCoreSpecs` and the scan turns out to write a document table.

## Done means
- `npx tsc --noEmit -p .` clean (report any errors in files you did not touch separately, as pre-existing).
- Green, in one capped run: `src/lib/server/pipelines/boot/bootstrap.int.test.ts`,
  `src/lib/server/pipelines/boot/seed.int.test.ts`, `src/lib/server/pipelines/boot/seed.rebindMove.int.test.ts`,
  `src/lib/server/pipelines/boot/nonCoreSpecConfigs.int.test.ts`,
  `src/lib/server/pipelines/entities/contextTemplateFit.int.test.ts`, `src/lib/server/pipelines/registrations/*.test.ts`,
  `src/lib/server/sockets/presetFallback.int.test.ts` (its "the boot reconcile records one notice…" test already fails
  at baseline on a "needs a model that can speak" notice — report it, don't fix it). Use `--maxWorkers=3`.

## Report
Return as your final message: changed files with a one-line summary each, the line numbers you put in the bootstrap
comment (re-verified), the mutation check from step 7, tests run with pass/fail counts and log path, tsc result,
anything you noticed but did not do.
