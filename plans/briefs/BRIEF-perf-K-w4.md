# BRIEF — perf-K worker 4 — boot markers for one-off startup tasks (★P9) and the 0158 second-boot test (★P8)

Supervisor: lane `perf-K` (`plans/briefs/BRIEF-perf-K.md`). Report to `plans/REPORT-perf-K-w4.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Owner rulings (2026-11-13) you are applying

- **★P9:** "One `system_settings` done-marker key per one-off boot task." Recommendation it ruled: "One key per
  task, written after the task's first clean run."
- **★P8:** "One generated index migration above the applied max; second-boot test."

## Already done by the supervisor (do NOT touch `db/schema.ts` or `drizzle/`)

`drizzle/0158_sweet_nightshade.sql` (generated) adds, among indexes:
`ALTER TABLE "system_settings" ADD COLUMN "boot_markers" jsonb DEFAULT '{}'::jsonb NOT NULL;`
→ `schema.systemSettings.bootMarkers: Record<string, string>` (marker key → ISO time written). `system_settings` is
a single-row table; every reader in the codebase addresses it `where id = 1` (`sockets/systemSettings.ts:44`,
`db/defaults.ts:621` seeds it).

The supervisor classified the startup tasks (`src/lib/server/startup/index.ts`, `startupTasks`). **One-shot — get a
marker:** `seat-members`, `character-versions`, `deleted-card-members`, `dc-cairns`. **Run every boot — leave
exactly as they are:** everything else, including `own-books`, `kept-own-books`, `seat-keys`,
`summaries-to-routine`, `dc-crawl-clock`, `messages`, `embedding`, `recovery`, `replies`, `spoken-pending`,
`scene-summaries`, `pipelines`, `plugins`, `components`, `eventMap`. If while working you find evidence that one
of the four is re-run by design (a live code path recreating what it fixes), **stop, list it in your report and
leave it unmarked** — do not decide it yourself.

## What to build

1. **New module `src/lib/server/startup/bootMarkers.ts`** (the name is fixed; module-local helpers are yours):
   - `readBootMarkers(db: Db): Promise<Record<string, string>>` — the `boot_markers` of the `id = 1` row; `{}`
     when there is no row.
   - `writeBootMarker(db: Db, key: string, at: Date = new Date()): Promise<void>` — merges one key into the row in
     **one statement** (`boot_markers = boot_markers || jsonb_build_object(key, iso)` on `id = 1`), never a
     read-modify-write.
   - `runWithBootMarker(db: Db, task: { name: string; doneMarker: string; run: () => Promise<void> }): Promise<void>`
     — if the key is present, log **one line** and return without calling `run`:
     `` `[${name}] skipped: done ${when} (boot marker ${key})` ``; otherwise `await run()` and, only if it returned
     without throwing, `writeBootMarker`. A throw propagates (the caller's existing catch handles it) and writes no
     marker. The task modules already throw when any unit failed ("after the loop a non-zero `failed` throws one
     error naming the count"), so "returned without throwing" is the clean run.
   - Takes `db` as a parameter, imports no database (so tests can hand it a test handle). Doc comment: what a
     boot marker is, that clearing a key re-runs its task on the next boot, and that a task that learns new work
     later must take a **new** key (e.g. `dc-cairns@2`) rather than reuse the old one.
2. **`startup/index.ts`**: add one optional field to `StartupTask`: `doneMarker?: string` with a doc comment
   ("One-shot: skipped once this boot marker exists; written after a clean run — `startup/bootMarkers.ts`, ★P9").
   Set it on exactly the four tasks above, value = the task's name (`"seat-members"`, `"character-versions"`,
   `"deleted-card-members"`, `"dc-cairns"`). In `runStartupTasks`, call
   `task.doneMarker ? runWithBootMarker(db, { name: task.name, doneMarker: task.doneMarker, run: task.run }) : task.run()`
   inside the existing `try`. Change nothing else in the file — not the order, not the comments of other tasks,
   not the failure policy. Add one sentence to each of the four tasks' doc comments: "One-shot: a boot marker
   skips it once it has run clean (★P9)."
3. Do not edit the task modules themselves (`sessions/seatMembers.ts`, `characters/versionsLift.ts`,
   `cast/deletedCardMembers.ts`, `sessions/dcCairns.ts`) — the marker check lives in the runner.

## Tests

A. `src/lib/server/startup/bootMarkers.int.test.ts` — on a migrated test DB (copy the setup used by an existing
   `*.int.test.ts` that gets a `db` handle; make sure the `system_settings` row exists, inserting it the way
   `db/defaults.ts:621` does if the fixture does not seed it — never pick an id other than the one that file uses):
   **per task** (`describe.each` over the four keys, each calling the REAL module function on the test handle, e.g.
   `run: () => dcCairns(db).then(() => {})`, wrapped in a `vi.fn` so calls can be counted):
   - first boot: `run` called once, key written (ISO string);
   - second boot: `run` not called, one skip line logged (spy `console.log`), `boot_markers` unchanged, and a
     cheap snapshot of the task's tables (row counts of what it writes) unchanged;
   - a cleared key (`UPDATE system_settings SET boot_markers = boot_markers - '<key>' WHERE id = 1`) re-runs it
     and writes the key again;
   - a `run` that throws writes no key and the error reaches the caller.
   Plus: `writeBootMarker` for two keys keeps both (merge, not overwrite).
B. `src/lib/server/db/indexes0158.int.test.ts` — the migration's own test, following
   `src/lib/server/db/valueStoryClock0154.int.test.ts` exactly (`migrationsFolderThrough("0157_legal_puppet_master")`,
   a fresh `PGlite`, `migrate` to 0157, insert a 0157-shaped `variants` row and `system_settings` row, then
   `migrate` the real `drizzle/` folder): the six indexes exist (query `pg_indexes` by name:
   `session_messages_session_id_id_idx`, `messages_session_id_id_idx`, `pipeline_runs_started_idx`,
   `pipeline_run_nodes_err_definition_idx`, `session_messages_generating_idx`,
   `plugin_hook_invocations_finished_idx`), the partial ones carry their `WHERE` (check `indexdef`), the
   0157 `variants` row survives with its path and `same_as_variant_id` null, `system_settings.boot_markers` is `{}`
   on the existing row, the `variants_same_as_check` refuses a row with neither path nor same-as; and **a second
   `migrate` changes nothing** (ledger hashes, index list and column list identical before/after, as the 0154 test
   does).

## Files owned (edit only these)

- new `src/lib/server/startup/bootMarkers.ts`, new `src/lib/server/startup/bootMarkers.int.test.ts`
- `src/lib/server/startup/index.ts` (the `StartupTask` field, the four `doneMarker`s and their one-sentence doc
  additions, the one call in `runStartupTasks` — nothing else)
- new `src/lib/server/db/indexes0158.int.test.ts`

**Files readable:** anything; especially the four task modules, `db/defaults.ts:610–630`,
`db/valueStoryClock0154.int.test.ts`, `utils/testDb.ts` (`migrationsFolderThrough`).

## Rules (quoted from CLAUDE.md and the lane brief — they bind you)

- "Never seed a row at a hardcoded id." (The one exception is the existing single `system_settings` row the app
  already seeds as `id: 1` in `db/defaults.ts`; tests mirror that, nothing new.)
- "Inside `db.transaction(async (tx) => …)` use only `tx`."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`." (Don't touch that file.)
- "Migrations are **generated**." Do not edit `db/schema.ts` or `drizzle/`.
- "0.6 is in users' hands: every stored-data change ships with its migration/boot pass **and** a second-boot test."
- P1: "markers and retention are deterministic (count- and date-based, no randomness, no timers)". P3: "no setting
  for any of this" — no screen, no socket, no env var for markers.
- Do what was asked, at the size asked. Findings go under **Noticed, not done**. Introduce no name beyond
  `bootMarkers.ts`, `readBootMarkers`, `writeBootMarker`, `runWithBootMarker`, `doneMarker` and the four keys.

## Hygiene (verbatim)

- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You should not need `sdk:build`.)
- "Never pipe vitest into `head`. Run int tests in a capped scope: `systemd-run --user --scope -p MemoryMax=6G npx vitest run <files>`."
- "Never run `prettier --write` on a directory; only on the files you edited, and only if they were prettier-clean before your edit (`git stash` is banned — check with `git diff --stat`)." `startup/index.ts` is not prettier-clean at HEAD: do not `--write` it.
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- Use absolute paths; the repo is `/home/jody/github/serene-pub`.

## Done means

Green in a capped scope: both new test files, `src/lib/server/startup/*.test.ts`,
`src/lib/server/db/dataUpgrades/*.int.test.ts`, `src/lib/server/db/migrationLedgerRepair*.test.ts`,
`src/lib/server/db/migrationSet*.test.ts`. `npx tsc --noEmit -p .` shows no error in your files (filter by path).
`npx prettier --check` on each new file.

## Report (`plans/REPORT-perf-K-w4.md`)

Changed files; the four marker keys; anything you found that suggests a marked task re-runs by design; tests with
pass counts; **Noticed, not done**.
