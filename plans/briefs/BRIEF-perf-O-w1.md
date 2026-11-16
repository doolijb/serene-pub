# BRIEF perf-O-w1 — thread the registry index (`byPin`) and the document (`docOf`) through the declaration helpers

Supervisor: lane perf-O (boot reads once). You are a `lane-worker`. Another worker (w2) edits
`entities/contextTemplateFit.ts`, `registrations/unserved.ts`, `boot/presetReconcile.ts` at the same time and will
CALL the signatures you add below — keep them exactly as written.

## Goal
The `pipelines` boot task reads the whole 193-row `pipeline_definition_registry` once per spec per helper (240×
on a second boot). Let callers that already hold the registry index pass it in, so each loop reads it once.
Thread what is already read through optional parameters. Runtime callers (≈25 call sites) pass nothing and keep
exactly their current behaviour.

## Exact changes (all paths under `/home/jody/github/serene-pub/src/lib/server/pipelines/`)
1. `config/panel/declarations.ts`
   - `declarationsAndVariableKeys(db, specVersionId)` (~:816) gains an optional third parameter, written exactly:
     `read: { byPin?: Map<string, any>; docOf?: () => Promise<SpecDocument> } = {}`
     (the same `read` shape `contextTemplateFitAt` in `entities/contextTemplateFit.ts` already uses).
     - When `read.byPin` is passed, skip `db.select().from(schema.pipelineDefinitionRegistry)` and use it.
     - When `read.docOf` is passed, use it instead of the local lazy `docOf` (~:859) that dynamically imports
       `boot/store` and calls `loadDocument`. Otherwise the local one stays as it is.
   - `declarations(db, specVersionId)` (~:807) gains the same optional `read` third parameter and passes it on.
   - Do not export a new named type for `read`; keep it inline.
2. `config/chainAddresses.ts` — `chainNodesFor(db, specVersionId)` (~:90) gains an optional trailing
   `byPin?: Map<string, any>`; when passed, skip the registry select. The `pipeline_nodes` select stays.
3. `config/named.ts` — ONLY thread a param: `reconcileConfigs(db, specId, specVersionId, specSlug)` (~:997) gains an
   optional trailing `byPin?: Map<string, any>`, passed to its `declarationsAndVariableKeys(...)` call (~:1005, as
   `{ byPin }`) and its `chainNodesFor(...)` call (~:1021). Change nothing else in that file (not
   `ensureDefaultConfig`, not the other `declarations(...)` callers).
4. `boot/seed.ts` — ONLY `reconcilePublishedConfigs` (~:419): build the index once before the `for (const spec of
   specs)` loop, the same way the helpers do
   (`new Map((rows as any[]).map((r) => [\`${r.definitionId}@${r.version}\`, r]))` over
   `db.select().from(schema.pipelineDefinitionRegistry)`), and pass it as the new last argument of `reconcileConfigs`.
   At the build site put a short comment stating this fact (rule [C16]): the registry's only writer in the
   `pipelines` task is `syncDefinitionRegistry`, which runs at the top of `bootstrapPipelines` before every reader,
   so one index read here is the registry every spec of this loop is reconciled against. Check `schema` and `asc`
   etc. are already imported there; add only what is missing.

## Files owned (edit nothing else)
`config/panel/declarations.ts`, `config/chainAddresses.ts`, `config/named.ts` (only item 3), `boot/seed.ts` (only item 4).

## Files readable
Anything under `src/lib/server/pipelines/`, `src/lib/server/db/schema.ts`.

## Out of scope — written down, never built
`boot/bootstrap.ts`, `startup/index.ts`, `boot/store.ts`, `boot/registrySync.ts`, `state/declarations.ts`,
`seedPrompts.ts`, `registrations/write.ts`, the three files w2 owns, the new test file. No cache on `db`, no
module-level memo, no invalidation hooks, no new setting, no SDK edit, no migration, no new exported name.

## Stop and ask (in your report, do not decide) when
A change would alter what a runtime caller (passing no new argument) observes; a new exported name seems needed;
anything outside the files above would need editing.

## Rules (quoted by the supervisor)
- CLAUDE.md P1: "Deterministic, never hidden" — thread, never cache on the handle; `bootstrap.ts:551` already
  refuses a module-scope cache for published lookups.
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Comment ratchet (`conformance/commentHistory`): comments say what the code does now; avoid "no longer",
  "used to", "previously", "deliberately not", "was being".
- Formatting: tabs, no semicolons, double quotes (match the file). Check with `npx prettier --check <file>` only;
  never `prettier --write` on a directory.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This task needs no sdk:build.)
- Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs): redirect to a log file, then grep it.
- Run tests inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files> > <log> 2>&1`.

## Done means
- `cd /home/jody/github/serene-pub && npx tsc --noEmit -p . 2>&1 | grep -E "config/panel/declarations|config/chainAddresses|config/named|boot/seed\.ts"` prints nothing
  (w2's files may show transient errors until both land; ignore those, do not touch them).
- Green (one capped run, log under the scratchpad
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perf-O-w1-*.log`):
  `src/lib/server/pipelines/boot/bootstrap.int.test.ts src/lib/server/pipelines/boot/seed.int.test.ts
  src/lib/server/pipelines/config/panel/index.int.test.ts src/lib/server/pipelines/config/panel/openRenders.test.ts
  src/lib/server/pipelines/config/panel/templateScopeFor.test.ts src/lib/server/pipelines/boot/declaredReadsCull.int.test.ts
  src/lib/server/sockets/pipelines.leftoverPicks.int.test.ts src/lib/server/sockets/presetFallback.int.test.ts`
  (if a failure also fails without your change — check by reading, not by stashing — say so and leave it).
- `npx prettier --check` on each changed file.

## Report
Return it as your final message: changed files with one line each, the exact new signatures, tests run with
pass/fail counts, any ★ question, and **Noticed, not done**.
