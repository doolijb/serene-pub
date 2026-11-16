# BRIEF — lane `perf-G`, worker 1 — registry sync reads once; migration files read once per process

Repository root: `/home/jody/github/serene-pub`. Use absolute paths. Line numbers are from 2026-11-13; re-read before editing.

## Goal

Two "fewer times, not less work" changes on the boot path. Same rows, same hashes, same results afterwards — only fewer
queries and file reads.

### A. `syncDefinitionRegistry` reads its tables once (`src/lib/server/pipelines/boot/registrySync.ts:306–586`)

Today, per declared entry, it does `select … from pipeline_definition_registry where definition_id=? and version=?`
(`:339`), then `adoptCurrent` → `archiveDeclaration` does `select id from pipeline_definition_declarations where
definition_id=? and version=? and content_hash=?` (`:240`), and possibly more. ~150 entries ⇒ ~300+ sequential queries
every boot, even when nothing changed.

Build:
1. At the top of `syncDefinitionRegistry`, **one** `select()` of `pipeline_definition_registry` (all columns, all rows —
   the per-entry lookup is by `(definition_id, version)` regardless of owner) into a `Map<"id@version", row>`, and **one**
   select of `pipeline_definition_declarations` restricted to the three columns `(definitionId, version, contentHash)`
   into a `Set` of `` `${id}@${version}\0${hash}` `` (or equivalent exact key).
2. Replace the per-entry row select with a map lookup; change `archiveDeclaration` (module-private) to consult and
   **add to** the archive set instead of selecting (insert still happens when absent, exactly as now, with the same
   values). `adoptCurrent` passes the set through.
3. Keep the in-memory maps truthful as the loop writes: after an insert into the registry, put the new row's key in the
   map (so a duplicate pin in `entries`, if `snapshotRegistry` ever yields one, updates instead of violating the unique
   index — verify what `snapshotRegistry` does and say so). After archiving, add the key to the set.
4. All comparisons (`row.contentHash !== hash`, `slotsChanged`, `policyChanged`, … `row.release !== opts.release`) stay
   byte-for-byte the same logic; only where `row` comes from changes. Writes are issued only for differences, as now.
5. The reverse-diff block (`if (opts.complete)`, `:509–583`): keep its own query as is (simplest way to keep the
   `standing` count identical, since rows inserted/republished in this pass affect it). Do not restructure it.
6. Keep the function's signature, `SyncResult` and all doc comments' claims true. Update the "Idempotent by construction"
   comment only if a sentence becomes false.

Do **not** add the "skip the whole pass when build version + catalogue hash are unchanged" gate. It needs a stored hash
(a new row/setting — unruled ★P9 territory) and a version-only gate would leave a changed core list unsynced when a
plugin is installed/uninstalled between two boots of one version (`bootstrap.ts` filters `pluginDefinitionPins()` out of
the list). The supervisor is raising that as a ★. After your change an unchanged boot costs 3 reads and 0 writes, which
is what the skip would have bought.

Tests (`src/lib/server/pipelines/boot/registrySync.int.test.ts`, extend; or a new `registrySync.queries.int.test.ts`
beside it):
- **Measure first, before editing:** count the queries a second `syncDefinitionRegistry` over the same core list issues
  (use `[...allDefinitions(), ...allScriptKinds()]`, `{ release, complete: true }` — mirror `bootstrap.ts:283`) and the
  queries of a first sync into an empty registry. Count with a Drizzle logger: a second drizzle instance over the same
  PGlite client, e.g. `drizzle(db.$client, { schema, logger: { logQuery: (q) => queries.push(q) } })`. Record the
  numbers (total, and how many are insert/update) before your edit and after.
- New test: **a second sync issues no writes** — assert zero `insert`/`update`/`delete` statements in the logged queries
  of the second run, and that the read count is a small constant (assert `<= 3`, or whatever the final shape gives).
- New test: the rows after one sync are identical to what the old path produced — the existing suite already pins this
  behaviour; keep every existing test green. Also cover a pointer move (`republished`) and an insert on the same pass to
  prove the in-memory maps stay truthful (the existing "moves the pointer" test may already do it — check).
- Int tests that open a DB inside an `it` need a 60 s timeout. `createTestDb({ skipEntryTypes: true })` is the helper
  the existing suite uses (`src/lib/server/utils/testDb.ts`).

### B. Migration files read and hashed once per process (`src/lib/server/db/`)

Read sites today: `backup.ts:162–184` `hasPendingMigrations` → `readMigrationFiles({ migrationsFolder })` (called up to
twice per boot: `db/index.ts:665` and `backupBeforeMigrations` at `backup.ts:362`); `migrationLedgerRepair.ts:89–107`
`readJournalMigrations` → journal read + `readMigrationFiles` (called by the ledger repair at `:154` and by
`ledgerSplice.ts:124`); `migrationSet.ts:32–55` `readMigrationSet` (the production fingerprint, `db/index.ts:557`, and
`vite.config.ts` at build time). Each reads and sha256-hashes every `drizzle/*.sql`.

Build:
1. In `src/lib/server/db/migrationSet.ts`, add a memoised wrapper over drizzle's own `readMigrationFiles` (keep drizzle's
   reader — never reimplement its hash; the ledger repair's byte-identity guarantee for `0000`–`0093` rests on drizzle's
   hash being the one its migrator writes). Memo key: the resolved folder path + `meta/_journal.json`'s `mtimeMs`+`size`
   + each journal-listed `<tag>.sql`'s `mtimeMs`+`size` (stat, not read). Any change to the set ⇒ new key ⇒ fresh read.
   Keep only the latest result per folder (a small `Map<folder, {key, files}>`). Return a shallow copy of the array so a
   caller cannot alter the cache's order.
   ⚠ `migrationSet.ts` is imported by `vite.config.ts` at build time: **no `$lib` imports**; `node:*` and
   `drizzle-orm/migrator` only.
2. Memoise `readMigrationSet` on the same key shape (one fingerprint computation per process unless the set changes).
3. Point `backup.ts`'s `hasPendingMigrations` and `migrationLedgerRepair.ts`'s `readJournalMigrations` at the memoised
   reader. Change **only those read sites** in `backup.ts` — that file has uncommitted edits from another lane (the dump
   streaming in `backupDatabase`); leave every other line exactly as you find it. Same for `backup.int.test.ts`.
4. `src/lib/server/db/dataUpgrades/index.ts:286` and drizzle's own `migrate()` also read the set; they are **not your
   files**. List them in your report for the supervisor to queue.

Tests:
- `src/lib/server/db/migrationSet.test.ts` (extend): the memoised reader returns exactly drizzle's
  `readMigrationFiles` output (deep-equal, same hashes) for the real `drizzle/` folder; a second call does not re-read
  the SQL (spy on `fs.readFileSync`, or count via a temp folder); changing a file in a temp migrations folder (rewrite
  with different content **and** a different size, then also bump mtime with `fs.utimesSync`) yields the new hash on
  the next call; `readMigrationSet` memo returns the same fingerprint and refreshes after a change.
- Keep green: `migrationSet.test.ts`, `migrationLedgerRepair.test.ts`, `migrationLedgerRepair.int.test.ts`,
  `ledgerSplice.int.test.ts`, `backup.int.test.ts`, `staleBuildBoot.int.test.ts`.

## Files owned (the only files you may edit)

- `src/lib/server/pipelines/boot/registrySync.ts` (only `syncDefinitionRegistry`, `archiveDeclaration`, `adoptCurrent`)
- `src/lib/server/pipelines/boot/registrySync.int.test.ts`, or a new `src/lib/server/pipelines/boot/registrySync.queries.int.test.ts`
- `src/lib/server/db/migrationSet.ts`, `src/lib/server/db/migrationSet.test.ts`
- `src/lib/server/db/backup.ts` (the `hasPendingMigrations` read site and its import only)
- `src/lib/server/db/migrationLedgerRepair.ts` (`readJournalMigrations` read site and its import only)
- `src/lib/server/db/migrationLedgerRepair.test.ts` if a test needs it

## Files readable

Anything. Notably `src/lib/server/pipelines/boot/bootstrap.ts:250–310`, `src/lib/server/db/index.ts:540–700`,
`src/lib/server/db/ledgerSplice.ts`, `src/lib/server/db/dataUpgrades/index.ts`, `src/lib/server/utils/testDb.ts`,
`node_modules/drizzle-orm/migrator.js`.

## Out of scope

The skip gate (see A). `startup/index.ts`, `bootstrap.ts`, `db/index.ts`, `dataUpgrades/`, any migration, any schema
change, any new row/table/setting. Ranking files (another worker owns them).

## Rules you work under (quoted)

- Owner 2026-11-13: *"change how often, never what. Boot ends in the same state."*
- P1: *"a cache is keyed so a stale answer is impossible; name key and invalidation in the report, one test each."*
- CLAUDE.md Hard rules: *"Migrations are generated (`db:generate`)… Never seed a row at a hardcoded id. `0000`–`0093` are
  0.5.3's and byte-identical forever (ledger repair hashes them)."* — you write no migration and touch no SQL file.
- *"Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."*
- Decisions: implementation inside scope is yours — name each choice in the report. Anything a user sees, or a new
  name/setting/table/migration: stop and write it in your report as a question. Findings outside scope go under
  **Noticed, not done**, never fixed in passing.

## Stop and ask when

Keeping the same rows needs anything beyond the maps above; a test shows any row or hash differs from the old path;
a change outside the owned files seems needed.

## Done means

All of these green (run each targeted file with `npx vitest run <file>`; never the whole suite):
`src/lib/server/pipelines/boot/registrySync.int.test.ts` (+ your new file), `src/lib/server/pipelines/boot/registryHashes.test.ts`,
`src/lib/server/pipelines/boot/bootstrap.int.test.ts`, `src/lib/server/db/migrationSet.test.ts`,
`src/lib/server/db/migrationLedgerRepair.test.ts`, `src/lib/server/db/migrationLedgerRepair.int.test.ts`,
`src/lib/server/db/ledgerSplice.int.test.ts`, `src/lib/server/db/backup.int.test.ts`,
`src/lib/server/db/staleBuildBoot.int.test.ts`.
`npx prettier --check <each changed file>`; `npx tsc --noEmit -p . 2>&1 | grep -E "registrySync|migrationSet|backup|migrationLedgerRepair"` empty.

## Report

Return in your final message (do not write a report file): changed files; query counts before/after (first sync, second
sync; total and writes); the memo key and invalidation for B; tests run with pass counts; what `snapshotRegistry` does
with duplicate pins; read sites you could not change (queued); open questions; Noticed, not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should need none.)
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Inside `db.transaction(async (tx) => …)` use only `tx`.
- Never `git checkout`, `git restore` or `git stash`. Other uncommitted files in the tree belong to other lanes; never touch them.
