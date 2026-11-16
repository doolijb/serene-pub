# BRIEF perf-P-w2 — boot writes batched: attribute last-seen, prompts, presets, registrations, scripts

Supervisor: lane perf-P (`plans/briefs/BRIEF-perf-P.md`). Owner's go: "Go for it. Play nice" (2026-11-14).

## Goal
A cold boot issues single-row statements, each its own PGlite commit, in five places. Batch each **table by table**
without changing what is stored, which ids are assigned (sequence-assigned, never fixed, same order as today), the
result/report objects these functions return, or the second-boot no-op property.

## What to change
1. **`recordLastSeen`** (`src/lib/server/state/declarations.ts:308`; runs every boot, 73 `attribute_declarations`
   upserts + the sheets). Replace each per-declaration loop with **one multi-row upsert per table**: collect the values
   (same filter `decl.origin !== "code"` skipped, same `originOf`, same verbatim props), skip the statement when the
   list is empty, and use `onConflictDoUpdate({ target: …id, set: { origin: sql\`excluded.origin\`, props:
   sql\`excluded.props\`, lastSeenAt: sql\`excluded.last_seen_at\`, updatedAt: now }, setWhere: <same as today> })`.
   Check the real column names in `src/lib/server/db/schema.ts` (`attributeDeclarations` ~`:11084`, `attributeSheets`
   ~`:11214`). A multi-row `ON CONFLICT DO UPDATE` fails if one id appears twice in the statement: check whether
   `sdkAttributeSlots()`/`sdkAttributeSheets()` can yield a duplicate id (they read a registry map, probably not); if
   they can, keep the last one and say so. Returned `{ slots, sheets }` counts stay the number of declarations written.
   Touch nothing else in that file.
2. **Prompts** (`src/lib/server/pipelines/boot/seedPrompts.ts`, loop ~`:117-206`). Names depend on insertion order
   (`namesTakenBesides(poolNames, …)`, then `poolNames.push({ id: made!.id, name })`). Keep the same algorithm in the
   same order, but **in memory**: a planned new row is pushed onto `poolNames` with a placeholder id that can never equal
   a real row id (e.g. a negative counter), so `namesTakenBesides(poolNames, existing.id)` still sees it as taken. Then
   issue **one** insert (chunked at ~100 rows if needed) of all planned rows after the pool loop. Use `returning({ id,
   seedKey })` only if something reads the ids afterwards; if nothing does, omit `returning` and say so. If you do use
   ids, map them by `seedKey`, never by position. You may also replace the per-prompt `select … where seedKey = ?`
   with one `inArray(seedKey, allKeys)` read for the whole pass, mapped by `seedKey` (name this in your report). The
   refresh path (`update` of a drifted row) stays one statement per row. `created`/`present`/`refreshed` arrays are
   unchanged.
3. **Presets inside `saveDocument`** (`src/lib/server/pipelines/boot/store.ts:299-322`, inside an existing `tx`). Insert
   all `doc.presets` rows in **one** statement `returning({ id, slug })` (or full rows), map ids **by slug** (a unique
   index `pipeline_presets_version_slug_idx` holds `(spec_version_id, slug)`), then insert each preset's values exactly
   as today, in the same preset order. Skip the statement when there are no presets. Touch nothing else in `store.ts`.
4. **Registrations** (`src/lib/server/pipelines/registrations/write.ts`, `replaceRows` `:57-90`). Inserts in the loop
   have no dependency between them: collect them and issue **one** multi-row insert (when non-empty) after the loop,
   in loop order; updates stay per row as today (they keep `state: had.state`); the delete of `gone` and
   `invalidateRegistrations()` stay as they are; the `changed` boolean is computed as today. `upsertRow`, `deleteRow`,
   `clearScope` unchanged. **Do not** wrap `projectRegistrations` (`project.ts:81`) in one transaction: each genre and
   preset sits in its own try/catch ("Never throws for one bad declaration"), and in Postgres one failed statement
   aborts the whole transaction, so a wrap would turn one bad declaration into a failed projection. Leave `project.ts`
   unedited unless a test needs it.
5. **Scripts** (`src/lib/server/pipelines/boot/seedScripts.ts:41-104`). Each script re-reads its type's name pool, so
   rows are not independent. Wrap the loop in **one** `db.transaction(async (tx) => …)` and use only `tx` inside (every
   select, update and insert). Comment at the wrap: one commit for the pass; a failing statement still throws out of the
   boot's `pipelines` task as before, and the transaction leaves no half-seeded set.
6. Comments say what the code does now (no "no longer", "used to", "previously", "deliberately not").

## Tests (files you own)
- `src/lib/server/state/declarations.int.test.ts` (around `:246`, where `recordLastSeen` is called): add a case if
  missing — a second `recordLastSeen(db)` adds no rows (row count equal) and a `stored`-origin row whose id collides
  keeps its props and origin. Check what the existing tests already pin before adding.
- `src/lib/server/pipelines/boot/seedPrompts.int.test.ts`, `seedScripts.int.test.ts`, `store.int.test.ts`: must stay
  green. If `seedPrompts.int.test.ts` has no case where a shipped name yields to a person's row of the same name
  ("(Built-in)" form) across two new rows in one pool, add one — that is the order-dependent path you are changing.
- `src/lib/server/pipelines/registrations/*.test.ts` (`derived.test.ts`, `door.int.test.ts`,
  `project.timelineDefault.int.test.ts`, `resolve.int.test.ts`, `resolve.test.ts`, `unserved.test.ts`) must stay green.

## Files owned
`src/lib/server/state/declarations.ts` (`recordLastSeen` only) + `src/lib/server/state/declarations.int.test.ts`;
`src/lib/server/pipelines/boot/seedPrompts.ts` + `seedPrompts.int.test.ts`; `src/lib/server/pipelines/boot/store.ts`
(the `pipelinePresets` insert only) + `store.int.test.ts`; `src/lib/server/pipelines/registrations/write.ts`,
`src/lib/server/pipelines/registrations/project.ts` + the registrations tests listed above;
`src/lib/server/pipelines/boot/seedScripts.ts` + `seedScripts.int.test.ts`.

## Files readable
Everything under `src/lib/server/pipelines/`, `src/lib/server/state/`, `src/lib/server/db/schema.ts`,
`src/lib/server/db/transactionGuard.ts`.

## Out of scope — never built
`registrySync.ts` (another worker owns it), `bootstrap.ts`, `startup/index.ts`, `seed.ts`, `config/**`,
`registrations/unserved.ts`, `presetReconcile.ts`, `entities/contextTemplateFit.ts`. No schema change, no migration, no
SDK edit, no new exported name, setting or event.

## Stop and ask (in your report) when
A change would alter a stored value, an id order, a returned report, or a name a row gets; or you would need to edit a
file outside Files owned.

## Rules (quoted from CLAUDE.md and the lane brief)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently;
  `db/transactionGuard.ts` throws in dev/test." Any helper called inside must take the handle as a parameter.
- "Never seed a row at a hardcoded id." Map returned rows by `seedKey`/slug, never by position.
- "A change to stored data or ids ships with … a test that a second boot changes nothing": `bootstrap.int.test.ts`
  ("changes nothing on the next boot", `:57`) must stay green.
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never pipe vitest into `head` (the SIGPIPE leaks PGlite temp dirs); redirect to a file under
  `/tmp/claude-1000/-home-jody-github-serene-pub/c46dc447-41a1-4f0c-98ce-0f42e7756232/scratchpad/perfP/` named `perfP-w2-*.log` and grep it.
- Run int tests as `cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G --quiet npx vitest run <files>`.
- Typecheck: `npx tsc --noEmit -p .` and report only errors in your files (other lanes have work in flight).
- Another lane (perf-O), another worker (registrySync.ts) and a peer session edit other files at the same time; never
  touch, revert or format their files.

## Done means
Green: the tests named above plus `src/lib/server/pipelines/boot/bootstrap.int.test.ts` (run it, do not edit it).
`tsc` clean for your files. `npx prettier --check` on your files.

## Report
Return as your final message: changed files, the shape chosen per item, tests run with results (added cases named),
anything you stopped on, and **Noticed, not done**.
