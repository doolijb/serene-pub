# BRIEF perf-P — boot writes batched (★R4-2 as corrected by [C18])

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `plans/PLAN-performance-2026-11-13.md` **Part 5**
(measurements, objections [C16]–[C20], lane table). Owner's go: "Go for it. Play nice" (2026-11-14). At most 2 workers.

## Goal
A cold boot issues ~1,000 single-row inserts at ~5 ms each (each statement outside a transaction is its own PGlite
commit): 207 `pipeline_definition_registry` + 207 `pipeline_definition_declarations` (`registrySync.ts`), 145
`registrations`, 73 `attribute_declarations` upserts (`recordLastSeen`, **every** boot), 63 `pipeline_prompts`, 44
`pipeline_scripts`, presets row by row inside `saveDocument`. Batch them **table by table** without changing what is
stored, which ids are assigned (sequence-assigned, never fixed), or the second-boot no-op property.

## What to change
1. **Registry sync in one transaction.** `syncDefinitionRegistry` (`src/lib/server/pipelines/boot/registrySync.ts:306`,
   loop ~`:345-640`, writes at `:367,:416,:498,:601`, declarations insert `:247`) runs on `db`. Wrap the write phase in one
   `db.transaction(async (tx) => …)` and use **only `tx`** inside. Its in-memory map is "kept truthful as the loop
   writes" (`:335-337`, duplicate pins): a multi-row insert is only correct after de-duplicating entries by pin, so
   either de-duplicate first and insert in batches, or keep per-row statements but inside the one transaction (one
   commit instead of ~400). Measure both if cheap; the one-transaction shape alone removes most of the cost. Keep
   `registrySync.queries.int.test.ts` truthful (update its expected counts with the reason in the test's comment).
2. **`recordLastSeen`** (`src/lib/server/state/declarations.ts:308`, upsert with `setWhere origin <> 'stored'` at
   `:337,:366`): two multi-row upserts (`onConflictDoUpdate` with `sql\`excluded.…\`` in `set`, same `setWhere`). Same
   rows result; a test asserts a second call writes nothing new and that a `stored`-origin row keeps its props.
3. **Prompts** (`src/lib/server/pipelines/boot/seedPrompts.ts` ~`:185-201`): names depend on insertion order
   (`namesTakenBesides(poolNames…)`, `poolNames.push({ id: made!.id … })`). Compute every name in memory first (same
   algorithm, same order), then one `insert … returning ({ id, seedKey })`; map rows back by `seedKey`, never by position.
4. **Presets** inside `saveDocument` (`src/lib/server/pipelines/boot/store.ts:302`): the only row-by-row insert left in
   that transaction; batch it (returning ids, map by slug) and keep preset values' insert as is.
5. **Registrations** (`src/lib/server/pipelines/registrations/write.ts:75,104`, called from `projectRegistrations`,
   `src/lib/server/pipelines/registrations/project.ts:81`): where the projection inserts row by row with no
   dependency between rows, collect and insert in one statement per table, or wrap the projection in one transaction.
   Keep the upsert/update paths' semantics exactly.
6. **Scripts** (`src/lib/server/pipelines/boot/seedScripts.ts:91`): batch only if trivially independent; otherwise one
   transaction around the loop.

Ids: none fixed (hard rule "never seed a row at a hardcoded id"); batching does not change that. Error shape: today a
failing row throws out of the `pipelines` task (`failsHealth`); a transaction keeps that and makes the partial state
cleaner. Say so in the code comment where you wrap.

## Files owned
`src/lib/server/pipelines/boot/registrySync.ts`, `src/lib/server/pipelines/boot/registrySync*.test.ts`,
`src/lib/server/state/declarations.ts` (`recordLastSeen` only) + its test, `src/lib/server/pipelines/boot/seedPrompts.ts`
+ `seedPrompts.int.test.ts`, `src/lib/server/pipelines/boot/store.ts` (the `pipelinePresets` insert only) + `store.int.test.ts`,
`src/lib/server/pipelines/registrations/write.ts`, `src/lib/server/pipelines/registrations/project.ts` + their tests,
`src/lib/server/pipelines/boot/seedScripts.ts` + `seedScripts.int.test.ts`.

## Files readable
Everything under `src/lib/server/pipelines/`, `src/lib/server/db/schema.ts`, `src/lib/server/db/transactionGuard.ts`,
`plans/PLAN-performance-2026-11-13.md`.

## Out of scope — written down, never built
`bootstrap.ts`, `startup/index.ts`, `seed.ts`, `config/**`, `entities/contextTemplateFit.ts`, `registrations/unserved.ts`,
`presetReconcile.ts` (lane perf-O owns the reads). No schema change, no migration, no SDK edit, no new name, setting or
event. Do not reorder startup tasks.

## Rules (quoted for workers)
- **Inside `db.transaction(async (tx) => …)` use only `tx`** — the outer `db` deadlocks PGlite silently;
  `db/transactionGuard.ts` throws in dev/test. Any helper called inside must take the handle as a parameter.
- Never seed a row at a hardcoded id; map returned rows by `seedKey`/pin/slug, never by position.
- "A change to stored data ships with a test that a second boot changes nothing": `bootstrap.int.test.ts:57` and
  `registrySync.queries.int.test.ts` must stay green and truthful.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (This lane needs no sdk:build.)
- Comment ratchet: comments say what the code does now; avoid "no longer", "used to", "previously", "deliberately not".
- Run int tests inside `systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`; a DB in `beforeAll` needs 60 s.

## Done means
- Green: `registrySync.int.test.ts`, `registrySync.queries.int.test.ts` (counts updated with reasons), `seedPrompts.int.test.ts`,
  `seedScripts.int.test.ts`, `store.int.test.ts`, `bootstrap.int.test.ts`, `registrations/*.test.ts`, the
  `state/declarations*.test.ts` that cover `recordLastSeen` (add the second-call-writes-nothing case if missing).
- `npx tsc --noEmit -p .` clean for owned files.
- Measured in the report: statement count and wall time of a **first** `bootstrapPipelines(db)` on a fresh test db before
  and after (same logger trick as `registrySync.queries.int.test.ts`).

## Report path
`plans/REPORT-perf-P-2026-11-14.md` — changed files, tests run with results, measurements, open ★, **Noticed, not done**.
If the harness refuses the write, put the full report in your final message; the lead saves it.
