# BRIEF perf-P-w1 — registry sync: one transaction, batched inserts

Supervisor: lane perf-P (`plans/briefs/BRIEF-perf-P.md`). Owner's go: "Go for it. Play nice" (2026-11-14).

## Goal
`syncDefinitionRegistry` (`src/lib/server/pipelines/boot/registrySync.ts:306`, loop ~`:345-640`) issues one statement per
row on `db`: on a fresh install 192 `pipeline_definition_declarations` inserts (`archiveDeclaration`, `:247`) and 192
`pipeline_definition_registry` inserts (`:367`), each its own PGlite commit. Make it **one transaction** and **batch the
two insert streams**, without changing what is stored, which ids are assigned, the `SyncResult` arrays, or the
second-run no-op property.

## What to change
1. Wrap the body from the two initial reads through the reverse-diff in **one** `db.transaction(async (tx) => { … })`
   and use **only `tx`** inside, including in `archiveDeclaration` and `adoptCurrent` (they already take the handle as
   a parameter: pass `tx`). The early `return result` of the reverse-diff guard returns from the callback. Add a comment
   at the wrap saying what it does now: one commit for the whole sync; a failing statement still throws out to the
   caller (the boot's `pipelines` task fails health as before) and the transaction leaves no half-written registry.
   Callers: `bootstrap.ts:283` (outer db), `plugins/install.ts:323`, `plugins/packageEntryTypes.ts:49`,
   `utils/testDb.ts:105`, and `attic/restore.ts:92` which passes a `tx` already — a drizzle `tx.transaction` there is a
   savepoint, which is fine; confirm `Db`'s type lets you call `.transaction` on it (tsc).
2. **Archive inserts batched.** `archiveDeclaration` keeps its `archived` set logic and its boolean return, but pushes
   the values onto a pending list instead of inserting. Flush the list with multi-row inserts (chunk at ~100 rows) at
   the end of the loop, before the reverse-diff. Values keep loop order, so the sequence-assigned ids come out in the
   same order as today. First check `schema.ts` (~`:7802`) and the registry table for a foreign key between the two
   tables; if one exists, flush before any registry insert that needs it and say so.
3. **Registry inserts batched.** A new pin (no row) pushes its values (same object as today) onto a pending-insert list
   and records `result.inserted.push(pin)` as today. Keep `rowsByPin` truthful: put a pending marker under the pin.
   When the loop meets a pin whose row is still pending (a duplicate pin in `entries`; see the queries test), **flush
   the pending inserts first** (`insert … values([...]).returning()`), set each returned row into `rowsByPin` **by
   `${definitionId}@${version}` from the row, never by position**, then continue with the real row. Flush the rest
   after the loop (chunked). Every other path (pointer move, heal update, reverse-diff updates) stays one statement per
   row, as today, but on `tx`.
4. Comments say what the code does now (no "no longer", "used to", "previously", "deliberately not"). Update the
   existing comment at `:335-337` about the maps being kept truthful so it describes the pending-flush rule.

## Tests (files you own)
- `src/lib/server/pipelines/boot/registrySync.queries.int.test.ts`: keep both tests truthful. Add to the first test an
  assertion on the **first** run: the registry and archive inserts are each a handful of statements (e.g.
  `writes(first.qs).filter(q => /insert into "pipeline_definition_registry"/i.test(q)).length` ≤ ceil(n/chunk)), with a
  comment giving the reason (one multi-row insert per chunk). If the transaction changes the read counts (drizzle's
  logger does not log PGlite's BEGIN/COMMIT, so it probably does not), update the bound with the reason. The
  duplicate-pin test must still pass unchanged in its expectations.
- `src/lib/server/pipelines/boot/registrySync.int.test.ts`: must stay green; adjust only if it asserted per-row shape.
- If cheap, time the first sync in the queries test once with per-row-in-transaction and once batched (temporary
  `performance.now()` you remove afterwards) and put both numbers in your report.

## Files owned
`src/lib/server/pipelines/boot/registrySync.ts` (the `syncDefinitionRegistry` function and the two archive helpers only),
`src/lib/server/pipelines/boot/registrySync.queries.int.test.ts`, `src/lib/server/pipelines/boot/registrySync.int.test.ts`.

## Files readable
Everything under `src/lib/server/pipelines/`, `src/lib/server/db/schema.ts`, `src/lib/server/db/transactionGuard.ts`.

## Out of scope — never built
Any other function in `registrySync.ts` (e.g. the preset/plugin sync around `:1100`), `bootstrap.ts`, `startup/index.ts`,
`seed.ts`, `config/**`. No schema change, no migration, no SDK edit, no new exported name, setting or event.

## Stop and ask (in your report) when
A change would alter a stored value, an id order, or a `SyncResult` array; a foreign key forces a different order than
above; or you would need to edit a file outside Files owned.

## Rules (quoted from CLAUDE.md and the lane brief)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently;
  `db/transactionGuard.ts` throws in dev/test." Any helper called inside must take the handle as a parameter.
- "Never seed a row at a hardcoded id." Map returned rows by pin, never by position.
- "A change to stored data or ids ships with … a test that a second boot changes nothing": the queries test's
  "an unchanged sync reads each table once and writes nothing" must stay green and truthful.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never pipe vitest into `head` (the SIGPIPE leaks PGlite temp dirs); redirect to a file under
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perfP/` named `perfP-w1-*.log` and grep it.
- Run int tests as `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`.
- Typecheck: `npx tsc --noEmit -p .` and report only errors in your files (other lanes have work in flight).
- Another lane (perf-O) and a peer session edit other files under `src/lib/server/pipelines/` at the same time; never
  touch, revert or format their files.

## Done means
Green: `registrySync.queries.int.test.ts`, `registrySync.int.test.ts`, `bootstrap.int.test.ts` (run it, do not edit it).
`tsc` clean for `registrySync.ts`. `npx prettier --check` on your files.

## Report
Return as your final message: changed files, the shape you chose (and the FK finding), tests run with results, timings
if taken, anything you stopped on, and **Noticed, not done**.
