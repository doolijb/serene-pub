# BRIEF — lane `perf-K` — the ruled server items: entry wire, fetch cap, retention, one index migration, boot markers, thumb-is-source, dead code

**Supervisor:** read `.claude/guides/multi-agent.md` first, then `.claude/guides/review.md` §2. Plan:
`plans/PLAN-performance-2026-11-13.md` — Part 1, rows W5-a, W3-e, W3-g, W7-a, W7-b, W8-d, Part 3 **rulings table**
(★P4, P5, P6, P8, P9, P10, P11 are ruled), §4.2b row perf-K. Reports to build on: `REPORT-perf-C` (entries wire),
`REPORT-perf-B` (fetch/storage hosts, the dead files), `REPORT-perf-E` (thumbnails, `thumbnailCut`),
`REPORT-perf-G` (migration files memo). **This lane is the only one that runs `db:generate` this round.** Read
NOMENCLATURE §19 (schema and migrations), §18 (media), §12 (extensions), §8 (content), §24, and append every new
name to §25.

## Seven steps, one worker brief each (two workers at a time at most)

1. **★P6 entry wire.** `sockets/entries.ts` list select and `toListRow`: never the `embedding` vector; keep the
   model and the vectorised flag/timestamp the client reads (`bookPatches.ts`, `LorebooksWorkspace.svelte`
   `patchEmbeddings`). Check every reader of the list row (`grep -rn "embedding" src/lib/client/lorebooks`) and
   the SDK's entry row type if it names the field (then: the owner ruled it; note it in `docs/lorebooks.md`).
   **The peer session's edits in this file stay as they are:** `refuseIfEarmarked` remains the last await before
   the write in `updateEntryHandler`, and the `entryEarmarkHandler` block is untouched.
2. **★P4 fetch cap.** `plugins/fetchHost.ts:315` reads `res.text()` unbounded. Stream the body and stop at
   **4 MB** (a named constant, §24), refusing with one named sentence that tells the author to use `ctx.storage`
   for bigger payloads. Redirect hops already capped — keep. Test: a 4 MB + 1 body is refused, 4 MB − 1 passes, the
   masking still runs on what passed. Doc: the plugin docs page that describes `fetch` grants gets the number.
3. **★P5 retention.** `plugins/store.ts:170` inserts one invocation row per hook call. Prune like notifications
   (`notifications/store.ts:45`, `PRUNE_EVERY = 100`): every 100 inserts since boot, delete rows older than
   **30 days** and anything beyond the newest **50,000**, whichever cut is smaller. One query each, through the same
   `db` handle (never the outer `db` inside a `tx`). Test: inserts past both limits leave the right rows.
4. **★P8 one migration.** Indexes in `db/schema.ts` only: `(session_id, id)` on `session_messages` and
   `messages`; partial `started_at WHERE NOT is_preview` on `pipeline_runs`; `definition_id WHERE result='err'`
   on `pipeline_run_nodes`; partial `WHERE is_generating` on `session_messages`; `finished_at` on
   `plugin_hook_invocations`. Plus step 6's variant kind if it needs a column/enum change. Then **one**
   `npm run db:generate` → the new file must be `0158_*` (journal top is 0157). Drizzle may not express partial
   indexes in the schema DSL — if so, the generated file is edited by hand **once**, the custom statement is unique
   (memory `feedback_custom_migration_must_be_unique`), and the report says so. Test: a second boot changes nothing
   (the ledger test pattern used by `migrationLedgerRepair` / `dataUpgrades` tests). `0000`–`0093` untouched.
5. **★P9 done-markers.** `startup/index.ts` lists the tasks; the lane confirms which are truly one-shot
   (candidates: `dc-cairns`, `summaries-to-routine`, `seat-keys`, `seat-members`, `character-versions`,
   `deleted-card-members`, `kept-own-books`, `own-books`) and which must run every boot (`recovery`, `replies`,
   `spoken-pending`, `scene-summaries`, `pipelines`, `plugins`, `components`, `eventMap` — leave these). For
   each one-shot task: one `system_settings` key, written only after a clean run; the next boot skips it and logs
   one line saying so. A task that throws writes no marker. Test per task: first boot runs + writes the key; second
   boot skips; a cleared key re-runs; nothing changes on the second boot.
6. **★P10 thumb-is-source.** **Challenger [C6], accepted:** a pointer row must never *own* a path.
   `variants.ts:186-192` `removeVariant` unlinks `row.path` every time; `cull.ts:104` "Precondition 1" counts
   siblings, so a pointer row would count as a second copy and culling the original would unlink the only bytes;
   `backfill.ts:133` calls `removeVariant` on a stale thumb before re-cutting. So: the row carries **no path of its
   own** (null path + a reference to the source, or whatever §18/§24 names it), and `removeVariant`, cull
   precondition 1 and the backfill `stale()` re-cut all treat it as a pointer. Tests: culling either row and a stale
   re-cut leave the source bytes on disk; `deleteFile` (`media/index.ts:621`) still removes everything.
   A variant row whose bytes are the source's (name the kind per §24/§18 — grep
   `variants.ts` for the kind vocabulary; "display" and "thumb" exist). `deriveThumb` (perf-E's short-circuit)
   records it instead of returning the source each time; the media route serves it like any variant (ETag, Range
   already there). Test: a whole-frame WebP under the thumb edge gets a variant row pointing at the source file id
   and no second file on disk; a second request reads no source bytes beyond the route's normal path.
7. **★P11 deletions.** Delete `src/lib/server/scripts/run.ts`, `src/lib/server/scripts/engine.ts` and
   `src/lib/server/plugins/RuntimeManager.ts` (its header asks for it). Re-point the tests that still import them
   (`scripts/abuse.test.ts` keeps one `runScript` pin check — move that pin to `runScriptSource` or drop it with
   a sentence in the report; `grep -rn "RuntimeManager\|scripts/run\|scripts/engine" src ../serene-pub-sdk --include=*.ts`
   for the rest). `test:budgets` must still run (`package.json` script) against the production host.

## Rules you quote into every worker brief

- Hard rules: migrations are **generated**; the new index must exceed the applied max or it is silently skipped;
  never seed a row at a fixed id; inside `db.transaction` use only `tx`; never top-level `await` in
  `db/index.ts`. The schema column waits for `db:generate` (`feedback_schema_column_waits_for_generate`).
- 0.6 is in users' hands: every stored-data change ships with its migration/boot pass **and** a second-boot test.
- P1: markers and retention are deterministic (count- and date-based, no randomness, no timers beyond what
  notifications already do). P3: no setting for any of this.
- P2: `plugins/store.ts` owns invocation rows; the prune lives there. The media module owns variant rows.
- Sockets: `entries:*` events are scoped on `lorebookId`; nothing about that changes.
- NOMENCLATURE §25 append for: the fetch cap constant, the retention constants, each marker key, the variant kind.

## Files owned

`src/lib/server/sockets/entries.ts` (list select + `toListRow` only), `src/lib/server/plugins/fetchHost.ts` (+ tests),
`src/lib/server/plugins/store.ts` (+ tests), `src/lib/server/db/schema.ts` (indexes + the variant kind only),
`src/lib/server/db/migrations/0158_*.sql` + `meta/` as `db:generate` writes them, `src/lib/server/startup/index.ts`
and the one-shot task modules it calls (marker check only), a small marker helper beside `startup/` if one does not
exist (grep `systemSettings` helpers first), `src/lib/server/media/{variants,thumbnail,cull,backfill}.ts` (+ tests; cull/backfill only for the pointer rule),
`src/routes/media/[id]/+server.ts` only if the variant needs a branch, the three deleted files and the tests that
imported them, `docs/lorebooks.md`, `docs/plugins*.md` (fetch cap), `docs/media*.md` if it exists,
`NOMENCLATURE.md` §25 (append only).

## Out of scope

Anything in `runtime/`, `sockets/sessions.ts`, the SDK; a second migration; an admin UI for retention or markers;
re-adding the per-book id arrays (★P13 keep removed); changing what a thumbnail looks like.

## Stop and ask when

CLAUDE.md §Decisions applies; `db:generate` wants to emit anything beyond the indexes and the variant kind (stop,
show the diff); a task you believed one-shot turns out to be re-run by design (list it, leave it); a reader of the
`embedding` field exists on the client or in the SDK.

## Done means

Per step the tests named above; plus green: `sockets/content.interestGate`, `entries*.int`, `lorebooks*.int`,
`fetchHost*`, `plugins/store*`, `scripts.budgets`, `abuse`, `startup*`, `dataUpgrades/*` and
`migrationLedgerRepair*`, `migrationSet*`, `media/*`, `mediaRoute*`; `npx tsc --noEmit -p .` clean on touched
files; `npx prettier --check` on each. `npm run db:migrate` on a fresh test DB applies 0158 once and a second run
applies nothing.

## Report

`plans/REPORT-perf-K-2026-11-13.md`: per step changed files, tests with counts, the migration file name and its
statements, the marker keys, open ★, **Noticed, not done**.

Every worker brief carries verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)."
