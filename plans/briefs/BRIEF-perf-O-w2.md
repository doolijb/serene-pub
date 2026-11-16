# BRIEF perf-O-w2 — documents and layout offers once per pass (scan, preset reconcile, unserved)

Supervisor: lane perf-O (boot reads once). You are a `lane-worker`. Another worker (w1) edits
`config/panel/declarations.ts`, `config/chainAddresses.ts`, `config/named.ts`, `boot/seed.ts` at the same time.
You CALL a signature w1 is adding; it is fixed as:

```ts
// config/panel/declarations.ts (w1 adds the third param)
declarations(db, specVersionId, read: { byPin?: Map<string, any>; docOf?: () => Promise<SpecDocument> } = {})
declarationsAndVariableKeys(db, specVersionId, read: { byPin?: …; docOf?: … } = {})
```
Until w1 lands, `tsc` may flag your call with 3 args; that is expected — do not edit w1's files.

## Goal
On a second boot the `pipelines` task loads each published document 4–5×, and `variableLayoutOffersOf` runs
`layoutByReference` 557× (one `select` per template row per variable per checked template). Thread what is already
read through optional parameters, so each read happens once per pass. Runtime callers pass nothing and keep their
current behaviour.

## Exact changes (all paths under `/home/jody/github/serene-pub/src/lib/server/pipelines/`)
1. `entities/contextTemplateFit.ts`, `scanContextTemplateFits` (~:331):
   a. `byPin` is already built at ~:344. Pass it to `declarations(db, spec.activeVersionId, { byPin, docOf })` (~:356).
   b. Move the `loadDocument(db, spec.activeVersionId)` (~:363) so the document is read at most once per spec and
      shared: build a lazy `docOf` per spec (`let docPromise; const docOf = () => (docPromise ??= loadDocument(db, id))`)
      before the `declarations` call, pass it there, and use `await docOf()` where `doc` is needed below. A spec with
      no `context-template-ref` slot should still not need its document loaded beyond what `declarations` itself does.
   c. **[C19] offers once per scan.** `variableLayoutOffersOf(db, variableIds)` (~:81) calls `listVariableTemplates`
      and then `layoutByReference` per row. `(variableId, reference)` is unique (`db/schema.ts` ~:6754-6757,
      `pipeline_variable_templates_variable_reference_idx`), so `layoutByReference(...) === row.id` only means "the
      row is not withdrawn". Rewrite it to one select per distinct variable over `schema.pipelineVariableTemplates`
      returning `id, name, reference, isImmutable, withdrawnAt` where `variableId = ?`, ordered by `id` asc, then the
      same stable sort `listVariableTemplates` applies (immutable rows first), keeping rows with a `reference` and a
      null `withdrawnAt`. Keep its result shape `Record<string, Array<{ reference: string; label: string }>>` and its
      order exactly. Give it an optional trailing memo `into: Map<string, Array<{ reference: string; label: string }>>`
      (the same idea as `publishedDocuments(db, slugs, into)` in `registrations/door.ts:66`): variables already in
      `into` are not read again; read ones are added to it.
      Thread that memo: `contextTemplateChecking(db, doc, nodeKey, describe)` (~:109) gains an optional trailing
      `offers?: Map<…>` passed to `variableLayoutOffersOf`; `contextTemplateFitAt`'s existing `read` object
      (~:175, `{ byPin?, doc? }`) gains `offers?: Map<…>` passed on to `contextTemplateChecking`.
      `scanContextTemplateFits` creates ONE such map per run (beside `byPin`) and passes it in its
      `contextTemplateFitAt(..., { byPin, doc, offers })` call (~:442). The imports of `listVariableTemplates` /
      `layoutByReference` there go if unused.
2. `registrations/unserved.ts` — `unservedPipelines(db, pipelines)` (~:156) gains an optional trailing
   `docs?: Map<string, SpecDocument | null>` passed as the third argument of `publishedDocuments(db, names, docs)`
   (which already fills and returns that map, `door.ts:63-66`). Nothing else changes.
3. `boot/presetReconcile.ts` — in `reconcilePresetBindings` (~:58) create one
   `const docs = new Map<string, SpecDocument | null>()` per run, before the `for (const preset of presets)` loop
   (~:98), and pass it to `unservedPipelines(db, regs.map(...), docs)` (~:163). Comment at the map, verbatim in
   substance (rule [C16]): pass 1 of `seedCoreSpecs` heals present versions in place (`healNodeExpose` writes
   `pipeline_nodes.expose`, `healClauseChains` writes `pipeline_clauses.parent_clause_chain`); this map is created
   inside this step, which runs after pass 1, and lives only for this run — one map per step, never one handed
   across steps from the top of `bootstrapPipelines`.
   Put an equivalent one-line note where the scan's per-run `offers` map is created only if it adds something;
   do not repeat the essay.

## Files owned (edit nothing else)
`entities/contextTemplateFit.ts`, `registrations/unserved.ts`, `boot/presetReconcile.ts`.

## Files readable
Anything under `src/lib/server/pipelines/`, `src/lib/server/db/schema.ts`.

## Out of scope — written down, never built
`boot/bootstrap.ts`, `startup/index.ts`, `boot/store.ts`, `boot/registrySync.ts`, `state/declarations.ts`,
`seedPrompts.ts`, `registrations/write.ts`, `entities/variableTemplates.ts`, w1's four files, the new test file
`boot/bootstrap.queries.int.test.ts` (the supervisor owns it). No cache on `db`, no module-level memo, no
invalidation hooks, no new setting, no SDK edit, no migration, no new exported type name (inline the map types).

## Stop and ask (in your report, do not decide) when
A change would alter what a runtime caller (passing no new argument) observes — e.g. the offers' order or content;
a new exported name seems needed; anything outside the files above would need editing.

## Rules (quoted by the supervisor)
- CLAUDE.md P1: "Deterministic, never hidden" — thread, never cache on the handle; `bootstrap.ts:551` already
  refuses a module-scope cache for published lookups.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Comment ratchet (`conformance/commentHistory`): comments say what the code does now; avoid "no longer",
  "used to", "previously", "deliberately not", "was being".
- Formatting: match each file (tabs, no semicolons, double quotes). Check with `npx prettier --check <file>` only.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This task needs no sdk:build.)
- Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs): redirect to a log file, then grep it.
- Run tests inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files> > <log> 2>&1`.

## Done means
- `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "contextTemplateFit|registrations/unserved|boot/presetReconcile"`
  prints nothing (the 3-arg `declarations` call may error until w1 lands; if it is the only error, say so).
- Green (one capped run, logs under the scratchpad
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-O-w2-*.log`):
  `src/lib/server/pipelines/entities/contextTemplateFit.int.test.ts src/lib/server/pipelines/registrations/unserved.test.ts
  src/lib/server/sockets/presetFallback.int.test.ts src/lib/server/sockets/presetEditor.variableLayouts.int.test.ts
  src/lib/server/pipelines/entities/variableTemplates.int.test.ts src/lib/server/pipelines/boot/bootstrap.int.test.ts`
  (if a failure also fails without your change — check by reading, not by stashing — say so and leave it).
- `npx prettier --check` on each changed file.

## Report
Return it as your final message: changed files with one line each, the exact new signatures, tests run with
pass/fail counts, any ★ question, and **Noticed, not done**.
