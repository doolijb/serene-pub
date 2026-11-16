# BRIEF perf-O — boot reads once (★R4-1 + [C16] [C17] [C19])

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `plans/PLAN-performance-2026-11-13.md` **Part 5** (the
measurements, the folded objections [C16]–[C20] and the lane table). Owner's go: "Go for it. Play nice" (2026-11-14).
At most 2 workers; workers get the rules below inline.

## Goal
The `pipelines` startup task (`bootstrapPipelines`) reads the 193-row `pipeline_definition_registry` 258 times, loads
each published document four to five times (~300 `loadDocument` calls for 79 specs) and runs `layoutByReference` 557
times. Make each read happen once per pass by **threading** what is already read through existing parameters. No cache
on the db handle, no module-scope cache, no new table/setting/event/name. Warm boot queries 6,228 → target under 1,500.

## What to change (measured call stacks are in the plan Part 5)
1. **Registry index once per loop.** `declarationsAndVariableKeys(db, specVersionId)`
   (`src/lib/server/pipelines/config/panel/declarations.ts:816`) and `chainNodesFor(db, specVersionId)`
   (`src/lib/server/pipelines/config/chainAddresses.ts:90`) each `select().from(pipelineDefinitionRegistry)` and build
   `byPin`. Add an **optional** trailing `byPin?: Map<string, any>` to both (and to `declarations()` at `:807`, which
   wraps the first); when passed, skip the read. Build it once in `reconcilePublishedConfigs`
   (`src/lib/server/pipelines/boot/seed.ts:419`, loop ~`:428`) and pass it to `reconcileConfigs` → both helpers
   (`src/lib/server/pipelines/config/named.ts:708,718` call sites; thread a param, do not change their other behaviour).
   In `scanContextTemplateFits` (`src/lib/server/pipelines/entities/contextTemplateFit.ts:331`) `byPin` is already built
   at ~`:344`: pass it to `declarations(db, …)` at ~`:356` and to `templateScopeDetailFor`.
   **[C16] order rule:** the registry's only writer in the task is `syncDefinitionRegistry` (runs at `bootstrap.ts:283`,
   before every reader) — the index may be built anywhere after it. Put that fact in a comment at the build site.
2. **Documents once per pass.** `loadDocument` (`src/lib/server/pipelines/boot/store.ts:1023`) is called 125× from
   `unservedPipelines` (`src/lib/server/pipelines/registrations/unserved.ts:156`, map rebuilt at ~`:163`) once per preset
   in `reconcilePresetBindings` (`src/lib/server/pipelines/boot/presetReconcile.ts:58`, loop ~`:98`, call ~`:163`). Add an
   optional `docs` map (the same shape `publishedDocuments(db, slugs, into)` / `DoorOptions.docs` already use,
   `src/lib/server/pipelines/registrations/door.ts:56-76`) to `unservedPipelines`, created once per
   `reconcilePresetBindings` run. Also let `declarationsAndVariableKeys` accept an optional `docOf` so
   `templateScopeDetailFor` (`declarations.ts:759`) reuses the document the scan already loaded (`contextTemplateFit.ts`
   ~`:363`).
   **[C16] order rule, verbatim for the code comment and a test:** pass 1 of `seedCoreSpecs` heals present versions in
   place (`seed.ts:345` `healNodeExpose` writes `pipeline_nodes.expose` `:616`; `seed.ts:349` `healClauseChains` writes
   `pipeline_clauses.parent_clause_chain` `:637`). A document map may only be created **after** pass 1
   (`reconcilePublishedConfigs`, the refit, the preset reconcile and the scan all are). Never hand one map across those
   steps from the top of `bootstrapPipelines`; one map per step is the shape.
3. **[C19] Offers once per scan.** `variableLayoutOffersOf` (`contextTemplateFit.ts:81`) calls `layoutByReference` per
   template row; `(variableId, reference)` is unique (`schema.ts:6754-6757`), so the check only means "not withdrawn".
   Compute the offers once per `scanContextTemplateFits` run with one select per distinct variable returning
   `withdrawnAt`, and pass the result into `contextTemplateChecking` (`:100`). Keep `variableLayoutOffersOf`'s result
   shape; runtime callers keep working.

## Files owned
`src/lib/server/pipelines/config/panel/declarations.ts`, `src/lib/server/pipelines/config/chainAddresses.ts`,
`src/lib/server/pipelines/config/named.ts` (only threading the `byPin` param through `reconcileConfigs`),
`src/lib/server/pipelines/boot/seed.ts` (only `reconcilePublishedConfigs`), `src/lib/server/pipelines/registrations/unserved.ts`,
`src/lib/server/pipelines/boot/presetReconcile.ts`, `src/lib/server/pipelines/entities/contextTemplateFit.ts`,
new `src/lib/server/pipelines/boot/bootstrap.queries.int.test.ts`, and existing tests of those files if a signature
changes (optional params should not break any).

## Files readable
Everything under `src/lib/server/pipelines/`, `src/lib/server/state/declarations.ts`, `src/lib/server/db/schema.ts`,
`plans/PLAN-performance-2026-11-13.md`, `src/lib/server/pipelines/boot/registrySync.queries.int.test.ts` (the
query-count test to copy the shape of: a second drizzle handle over the same `$client` with a `logger`).

## Out of scope — written down, never built
`bootstrap.ts`, `startup/index.ts` (the peer's `timeline-switch` task lives there), `boot/store.ts`,
`boot/registrySync.ts`, `state/declarations.ts`, `seedPrompts.ts`, `registrations/write.ts` (lane perf-P owns the
writes). No cache on `db`, no module-level memo, no invalidation hooks, no new setting, no SDK edit, no migration.
Runtime call sites of the two helpers (34 in all) keep their current behaviour: the new params are optional.

## Rules (quoted for workers)
- CLAUDE.md P1: "Deterministic, never hidden" — thread, never cache on the handle; `bootstrap.ts:551` already refuses a
  module-scope cache for published lookups.
- Inside `db.transaction(async (tx) => …)` use only `tx`; the outer `db` deadlocks PGlite.
- "A change to stored data … ships with a test that a second boot changes nothing" — `bootstrap.int.test.ts:57` already
  does; keep it green.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This lane needs no sdk:build.)
- Comment ratchet (`conformance/commentHistory`): comments say what the code does now; avoid "no longer", "used to",
  "previously", "deliberately not".
- Run int tests inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`; an int test that
  opens a DB in `beforeAll` needs a 60 s timeout.

## Done means
- New `boot/bootstrap.queries.int.test.ts`: counts statements of a **second** `bootstrapPipelines(db)` on a seeded test
  db (same handle trick as `registrySync.queries.int.test.ts`), asserts the full-registry select
  (`from "pipeline_definition_registry"` with no `where`) happens at most a handful of times (state the number you
  measured and pin it with a small margin), and that the number of `from "pipeline_nodes" where … spec_version_id`
  selects is at most ~2 per published spec. Also one test pinning the [C16] order (a document map is created only after
  the heals: e.g. a version healed in pass 1 is seen healed by the reconcile that follows).
- Green: `bootstrap.int.test.ts`, `presetReconcile*.int.test.ts` / `registrations/*.int.test.ts` that exist,
  `contextTemplateFit*.test.ts`, `config/panel/*.test.ts` touching declarations, `chainAddresses*.test.ts`, the new test.
- `npx tsc --noEmit -p .` clean for the owned files (report the count of pre-existing errors elsewhere, don't fix them).
- Measured: before/after statement count of a second `bootstrapPipelines` in the report.

## Report path
`plans/REPORT-perf-O-2026-11-14.md` — changed files, tests run with results, measured counts, open ★, **Noticed, not done**.
If the harness refuses the write, put the full report in your final message; the lead saves it.
