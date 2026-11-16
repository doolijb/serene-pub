# REPORT — lane `perf-K` — entry wire, fetch cap, retention, one index migration, boot markers, same-as variant, dead code — 2026-11-13

(Supervisor's report, saved to disk by the lead; the harness refused the supervisor's write. Worker briefs `plans/briefs/BRIEF-perf-K-w1..w4.md`, worker reports `plans/REPORT-perf-K-w1..w4.md`. Lead's acceptance note at the end.)

## Headline

All seven steps built. One migration, `drizzle/0158_sweet_nightshade.sql` (+ `meta/0158_snapshot.json`, journal idx 158); `prevId` matches 0157; partial indexes expressed in the schema DSL (`.where(sql…)`), so the file was **not** hand-edited; a dry run against a scratch copy of `drizzle/` showed no drift before the lane's edits; `0000`–`0093` untouched. `db/schema.ts` last edited 2026-11-13 17:04:12 -0800; perf-I's migration is `0159`.

## Step 1 — ★P6 entry wire
`sockets/entries.ts`: module-local `loadDefaultVectorMarks` selects only `entryId`, `model`, `vectorizedAt`; `listEntryRows` and `toListRow` use it; `entries:list` and the targeted `entries:create`/`entries:update` rows carry `embedding: null`, `embeddingModel` and `vectorizedAt` kept. Peer constraint holds: `refuseIfEarmarked` still the last await before the write (`entries.ts:1271`), `entryEarmarkHandler` untouched (scope reviewer verified). No client or SDK reader of the vector. New `sockets/entries.listWire.int.test.ts`.

## Step 2 — ★P4 fetch cap
`plugins/fetchHost.ts` exports `FETCH_RESPONSE_MAX_BYTES = 4 * 1024 * 1024`, spliced into `FETCH_HOST_SOURCE`. A declared `Content-Length` over the cap is refused before reading; otherwise the body streams through a `TextDecoder` and is refused (reader cancelled) the moment it passes the cap. Refusal on both backends: `fetch: the response is larger than 4 MB — keep bigger payloads in ctx.storage`. Masking still runs on what passed. Tests in `plugins/fetch.int.test.ts` (cap+1 refused with/without length header; cap−1 intact; secret echo masked). `docs/plugins.md` network bullet updated.

## Step 3 — ★P5 retention
`plugins/store.ts`: `INVOCATION_RETENTION_DAYS = 30`, `INVOCATION_MAX_ROWS = 50_000`, local `PRUNE_EVERY = 100`. `pruneInvocations(db, now?, opts?)` (overrides documented test-only) deletes rows older than 30 days and rows beyond the newest 50,000 (`finished_at DESC, id DESC`); `writeInvocation` prunes on the first write after boot and every 100th after; failure caught and logged in one line. Backed by `plugin_hook_invocations_finished_idx`. New `plugins/store.retention.int.test.ts`.

## Step 4 — ★P8 one migration (0158)
```
ALTER TABLE "variants" ALTER COLUMN "path" DROP NOT NULL;
ALTER TABLE "system_settings" ADD COLUMN "boot_markers" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "variants" ADD COLUMN "same_as_variant_id" integer;
CREATE INDEX "messages_session_id_id_idx" ON "messages" USING btree ("session_id","id");
CREATE INDEX "pipeline_run_nodes_err_definition_idx" ON "pipeline_run_nodes" USING btree ("definition_id") WHERE "pipeline_run_nodes"."result" = 'err';
CREATE INDEX "pipeline_runs_started_idx" ON "pipeline_runs" USING btree ("started_at") WHERE NOT "pipeline_runs"."is_preview";
CREATE INDEX "plugin_hook_invocations_finished_idx" ON "plugin_hook_invocations" USING btree ("finished_at");
CREATE INDEX "session_messages_session_id_id_idx" ON "session_messages" USING btree ("session_id","id");
CREATE INDEX "session_messages_generating_idx" ON "session_messages" USING btree ("session_id") WHERE "session_messages"."is_generating";
ALTER TABLE "variants" ADD CONSTRAINT "variants_same_as_check" CHECK (("variants"."path" IS NULL) = ("variants"."same_as_variant_id" IS NOT NULL));
```
The `is_generating` partial index is on `session_id` (serves the boot's derelict scan and per-session reads). Test `db/indexes0158.int.test.ts` (0154 pattern): from a 0157 install, migrates the real folder; six indexes with their WHERE clauses; an 0157 variant row survives with its path; `boot_markers = {}`; CHECK refuses neither/both; a second `migrate` changes nothing. Manual: `npm run db:migrate` twice on a scratch data dir — 159 ledger rows, 159 distinct hashes, second run applied nothing.

**★K-1:** `system_settings` is a one-row table of columns, not key/value, so "one `system_settings` key per task" lives inside one jsonb column `boot_markers`. The first 0158 (indexes + same-as only) was deleted unapplied and regenerated to include it, to keep the round at one migration. Undo: drop the column, delete the 0158 trio, regenerate before perf-I generates, revert w4's runner hook.

## Step 5 — ★P9 boot markers
New `startup/bootMarkers.ts`: `readBootMarkers`, `writeBootMarker` (one `boot_markers || jsonb_build_object(...)` statement on `id = 1`, never read-modify-write), `runWithBootMarker(db, task)` (present → one log line `[<task>] skipped: done <ISO> (boot marker <key>)`; else run, write only if it returned; a throw writes nothing). `startup/index.ts`: optional `StartupTask.doneMarker`, set on `seat-members`, `character-versions`, `deleted-card-members`, `dc-cairns`. Left running every boot, with reasons: `summaries-to-routine` (converts sessions that gain the routine later), `seat-keys` (live writers still produce card form until S5), `own-books` (re-syncs `overlay_of`; no live writer found), `kept-own-books` (documented permanent backstop). Test `startup/bootMarkers.int.test.ts` per key: first boot runs + writes; second boot skips with one line and changes nothing; cleared key re-runs; throw writes no key; two keys merge.

## Step 6 — ★P10 same-as variant ([C6] honoured)
`variants.ts`: both `deriveThumb` short-circuits call `recordSameAs` — a `thumb` row with the source's mime/bytes/hash/size, `path: null`, `same_as_variant_id` = source row, `cache: true`, `fidelity: reduced`, `onConflictDoNothing`; still returns the source. `ensureVariant` resolves a same-as row to its source (source gone → drop stale row, derive again). `locateVariant` returns the source row/path as `stored` (route streams it with ETag/Range, no new branch). `removeVariant` never unlinks through a same-as row and drops same-as rows naming a removed row. `cull.ts`: culling a same-as row allowed, frees 0; precondition 1 counts only rows with a path; `cullableDerived` and `storedBytesByFile` exclude same-as rows. `backfill.ts` `stale()` never selects a same-as row. `media.int.test.ts` one `!`. New `media/sameAsVariant.int.test.ts` (10 cases, incl. culling either row keeps the source; backfill never re-cuts; `deleteFile` removes everything; CHECK refuses both/neither; cache off writes nothing). **★K-2:** the name "same-as variant" / `same_as_variant_id`, ledgered 🚧 with a ⚠ against the display pointer.

## Step 7 — ★P11 deletions
Deleted `scripts/run.ts`, `scripts/engine.ts`. `scripts/abuse.test.ts` keeps the engine pin (`PINNED_ENGINE = "0.32.0"` local). Six cases in the block "run.ts contract — not (yet) true of the production host" were removed with `run.ts`; they are production-host gaps (**★K-3**): log-line cap; refuse a return with an undeclared key; refuse a scalar transform; verdict scalar never merged; pin `Date.now()` **and** `new Date()` to the run's start (`pipelines/scripts/host.ts:357` pins only `Date.now` — a P1 gap); keep `ctx.log` lines from a link that then failed (`:352` has no cap). `plugins/RuntimeManager.ts` not deleted by the lane (`pipelines/runtime/pluginBindings.ts:58` imported its type) — **done by the lead**, see acceptance note.

## Tests (capped scope)
Combined run after all four workers: 102 files — 100 passed, 1 skipped, 1 failed; 799 tests — 796 passed, 2 skipped, 1 failed. The failure: `db/dataUpgrades/0108_layering_registrations.int.test.ts` — its dropped-key list now contains `speak-message#read-aloud→speak-message` and `speak-message#say-it-as→speak-message` from the speech catalogue; this lane changed no registration/spec/catalogue. `test:budgets`: script budgets pass; `docsDist.budgets` 4.45 MB vs 3 MB (unrelated). `tsc`: no error in perf-K files. Prettier: new files clean, as are `variants.ts`, `backfill.ts`, `fetchHost.ts`, `abuse.test.ts`; `schema.ts`, `cull.ts`, `store.ts`, `fetch.int.test.ts`, `entries.ts`, `startup/index.ts` were unclean at HEAD or carry other sessions' lines — hunks clean, no `--write`.

## Queued changes (files outside the lane) — all applied by the lead 2026-11-13
1. `!` on the nullable `variants.path` in `attachments/tray.int.test.ts:533`, `messages/attachments.int.test.ts:75`, `sockets/mediaSpoken.int.test.ts:145`.
2. `sockets/media.ts:340`: admin `storedBytes` skips same-as rows (agrees with `storedBytesByFile`).
3. `sockets/systemSettings.ts:44`: `bootMarkers: false` so markers never reach a browser.
4. `pipelines/runtime/pluginBindings.ts` + `.int.test.ts` → `SandboxManager`; `plugins/RuntimeManager.ts` deleted.
5. (left) `shared/entries/types.ts:327` `embedding: number[] | null` is always null on this wire — could become optional after checking server retrieval readers.

## Open ★
★K-1 `system_settings.boot_markers` column · ★K-2 "same-as variant" name · ★K-3 the six withdrawn abuse cases (make true of `runScriptSource`, or keep visible as `it.todo`?).

## Noticed, not done
`session_messages_session_id_idx` / `messages_session_id_idx` are now prefixes of the new composite indexes (a later migration could drop them). `deriveFitted` returns the source with no row when an image already fits (same-as would suit it; outside ★P10). `dc-crawl-clock`, `messages`, `embedding` read as one-shot but were not candidates. `db/defaults.ts:627` seeds `system_settings` at `id: 1` (long-standing singleton exception). Docs dist over budget. `bootMarkers.int.test.ts` second-boot "tables unchanged" is weak on a near-empty DB.

## Scope review — folded
In scope, no high-severity. (1) six abuse cases → reported + ★K-3; (2) `sockets/media.ts` double count → queued, now applied; (3) `embedding: null` vs removed → queued 5; (4) reasons for unmarked candidates → added; (5) `pruneInvocations` overrides → documented test-only.

## Changed files
`db/schema.ts`, `drizzle/0158_sweet_nightshade.sql`, `drizzle/meta/0158_snapshot.json`, `drizzle/meta/_journal.json`, new `db/indexes0158.int.test.ts`; `media/{variants,cull,backfill}.ts`, `media/media.int.test.ts`, new `media/sameAsVariant.int.test.ts`; `plugins/{fetchHost,store}.ts`, `plugins/fetch.int.test.ts`, new `plugins/store.retention.int.test.ts`; `sockets/entries.ts`, new `sockets/entries.listWire.int.test.ts`; deleted `scripts/run.ts`, `scripts/engine.ts`; `scripts/abuse.test.ts`; new `startup/bootMarkers.ts` + `.int.test.ts`; `startup/index.ts`; `docs/plugins.md`; `NOMENCLATURE.md` §25 subsection "performance round 2".

## Lead's acceptance note
Accepted 2026-11-13. ★K-1 is accepted as ★P9's own storage (the ruling named `system_settings`; it has no key/value shape, and one jsonb column is the smallest faithful form) — the owner may still reverse it before 0158 reaches a user. ★K-2 accepted (grepped, distinctive, ledgered). ★K-3 goes to the owner. Queued items 1–4 applied by the lead; item 5 stays queued. The `0108` test failure is not this lane's (speech catalogue keys) and is checked in the grouped verification.
