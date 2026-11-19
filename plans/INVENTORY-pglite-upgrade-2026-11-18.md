# PGlite upgrade research — Serene Pub (2026-11-18)

Read-only research. Nothing in either repo was changed, installed, built or tested.
Package tarballs were downloaded into the scratchpad only, to read version strings and `.d.ts` files.

Note: the GitHub repo `electric-sql/pglite` has been renamed to **`electric-sql/electric-pglite`**. Old URLs redirect.

## 0. Primary sources used

- npm registry: https://registry.npmjs.org/@electric-sql/pglite (publish dates and dist-tags; `latest` = 0.5.16 when checked)
- Changelog (main): https://github.com/electric-sql/electric-pglite/blob/main/packages/pglite/CHANGELOG.md
- Upgrade doc: https://pglite.dev/docs/upgrade (source: docs/docs/upgrade.md)
- API doc: https://pglite.dev/docs/api · pglite-tools doc: https://pglite.dev/docs/pglite-tools
- v0.4 announcement (2026-03-25): https://electric.ax/blog/2026/03/25/announcing-pglite-v04
- pglite-tools on npm: https://registry.npmjs.org/@electric-sql/pglite-tools
- Embedded Postgres versions: verified by reading the `PostgreSQL 1x.y` string in each published `*.wasm` (0.2.17 from the app's node_modules; 0.3.16, 0.4.6, 0.5.0 and 0.5.16 from npm tarballs)
- GitHub issues and PRs, linked inline below

## 1. Release lines since 0.2.17

| Line | First → last (npm dates) | Postgres | Notes |
|---|---|---|---|
| 0.2.x | 0.2.17 = **2025-02-12**, the last 0.2 release | **16.4** (wasm string; owner data dir `PG_VERSION` = `16`) | The app is pinned here. Default database is **`template1`** (`PGDATABASE=${r.database??"template1"}` in dist/index.js). The owner's data is in `base/1` = template1 (237 MB). |
| 0.3.x | 0.3.0 2025-04-24 → 0.3.16 2026-03-10 | 17.4 (0.3.0), **17.5** from 0.3.6 (2025-07-28) | 0.3.0 "upgrade to postgresql 17.4". 0.3.2: "automatic fallback from `cma` data transfer container to `file` for large queries, and fix errors that could result in a 'memory access out of bounds' error" (this is the ~16 MB trap the attic works around). 0.3.8: MessageContext memory leak fixed ([#779](https://github.com/electric-sql/electric-pglite/issues/779), reported on 0.3.7). 0.3.11–0.3.16 add contrib extensions. 0.3.13: pg_dump rebuilt with emscripten. |
| 0.4.x | 0.4.0 2026-03-17 → 0.4.6 2026-05-25 | **17.5** (wasm string of 0.4.6) | 0.4.0: "New simplified PGlite with separate initdb … Breaking changes: 'postgres' is the default database instead of 'template1'". 0.4.3: default database, user and role all `postgres`; `initialMemory`; background workers disabled. 0.4.4: "Disable checkpointer" ([PR #970](https://github.com/electric-sql/electric-pglite/pull/970)); fixed [#965](https://github.com/electric-sql/electric-pglite/issues/965) (0.4.0–0.4.3 "stops working after exceeding some amount of data"). 0.4.6: ICU, `copyToFs()`, `postgresqlconf`. `connection multiplexing` is in **pglite-socket**, not core (see §4). |
| 0.5.x | 0.5.0 2026-06-02 → **0.5.16 2026-11-09** (npm `latest`) | **18.3** (0.5.0) → **18.6** from 0.5.9 (2026-10-12; 0.5.16 wasm string = 18.6) | 0.5.0: "Upgrade to Postgres 18.3; move other extensions to their own npm packages" (`vector` is no longer in the core package). 0.5.17 ("upgrade to PostgreSQL 18.7") is in the changelog on main but **was not on npm** when checked. Open [PR #1225 "PG19 stable"](https://github.com/electric-sql/electric-pglite/pull/1225) (2026-11-16): the next line will probably change the Postgres major again. |

0.5.x fixes that matter to a long-running Node server:
- 0.5.5: protocol parser reset after a malformed message ([#1052](https://github.com/electric-sql/electric-pglite/issues/1052)); operations through a closed transaction handle are rejected; `close()` keeps the host's `process.exitCode`.
- 0.5.8: "Do not set process.exitCode at all".
- **0.5.9**: fixed [#1115](https://github.com/electric-sql/electric-pglite/issues/1115), where every failed statement permanently used up part of the stack-depth budget. After about 1,800 errors every statement failed with "stack depth limit exceeded". It was reported on 0.5.8. **I could not verify whether 0.2.17 has the same bug.**
- 0.5.10 / 0.5.11 / **0.5.13**: `close()` waits for queries, execs and transactions issued before it. This fixed [#1084](https://github.com/electric-sql/electric-pglite/issues/1084) and the [#1058](https://github.com/electric-sql/electric-pglite/issues/1058) comment, where `close()` during an in-flight query hung the event loop on ≥0.4.0 (it was a clean reject on 0.3.16). 0.5.11 also fixed premature ReadyForQuery after extended-query errors.
- 0.5.12: initdb runs with `TZ=UTC`, and tar mtimes are fixed. For the app this is low impact: the owner's 0.2.17 `postgresql.conf` has `#timezone = 'GMT'` (the default).
- 0.5.14: "do not copy parsers on each query", a per-query JS overhead change.
- **0.5.15** (2026-11-03): "Reject with `TransactionAbortedError` when committing an aborted transaction rolls it back instead of silently resolving" ([#1179](https://github.com/electric-sql/electric-pglite/issues/1179)). It also lowered initdb memory use.
- 0.5.16 (2026-11-09): describeQuery serialisation ([PR #1206](https://github.com/electric-sql/electric-pglite/pull/1206)), `infinity` date parsing, identifier quoting, a raw-stream callback reset, and asset exports. **None of these touch the app's code path**: drizzle overrides the timestamp, timestamptz, interval and date parsers, and the app uses no describeQuery, template helpers or raw streams.

Breaking-change checklist matched against the app's usage (§5):
- Default database `template1` → `postgres` (0.4.0). This matters only to the conversion: the old engine must dump template1. No app code names a database.
- Extensions moved out (0.5.0). The app loads none, which `scripts/prune-dist.js` rule 17 states.
- New dist assets `initdb.wasm`, `initdb.js` and `pglite.data` (0.4+). Prune rule 17 deletes only `dist/*.tar.gz`, so these survive. `pg_stat_statements.tar.gz` is pruned, which is harmless.
- `TransactionAbortedError` (0.5.15) is a behaviour change. A drizzle `db.transaction` whose body catches and swallows a statement error used to resolve with the transaction rolled back. **Verified in 0.2.17's dist**: `transaction()` sends `"COMMIT"` and discards the result. That is silent data loss on today's engine. On 0.5.15 the same code throws. Transaction bodies that `.catch()` a statement need an audit.
- `relaxedDurability`, `dumpDataDir(compression)`, `loadDataDir`, `clone()`, `waitReady` and `close()` are all still present in the 0.5.16 `.d.ts`. `dumpDataDir` returns `Promise<File | Blob>`, the same as before.
- Live queries: unused by the app (many live fixes in 0.3–0.5).

## 2. On-disk compatibility

- **No newer line can open a 0.2.17 directory.** 0.3 and 0.4 are PG17 and 0.5 is PG18. Postgres refuses a data directory from another major version.
  - In 0.5.16 the path is: `PG_VERSION` exists → "pglite: found DB, resuming" → `postgres --single` exits → `Error("PGlite failed to initialize properly")`. Read from `dist/chunk-XZUEO4BZ.js`.
  - Postgres checks `PG_VERSION` before it writes anything, so the directory should be untouched. **I did not verify this empirically.**
  - In the app this error would land on the "database unopenable" recovery page. Every backup offered there is also PG16, so the loop needs its own handling (§6).
- **Maintainers' rule:** even within one Postgres major, every PGlite minor line can break the format.
  - pglite.dev/docs/upgrade is headed "Upgrading between minor versions" and says "minor version upgrades might introduce breaking changes … The upgrade path is to use pg_dump … from the previous version of PGlite and then import into a new instance".
  - tdrz (maintainer), [#932](https://github.com/electric-sql/electric-pglite/issues/932), 2026-03-25: "Recreating or migrating … should only be needed between minor or major versions … from 0.3.x to 0.4.x you should recreate or migrate." That issue showed 0.4.1 failing to open 0.3.15 data.
  - Patch releases within a line are meant to stay compatible.
- **`dumpDataDir` does not cross versions.** API doc: "The datadir dump may not be compatible with other Postgres versions; it is only designed for importing back into PGlite." It is a raw tar of the directory. **The app's existing backups (`backups/*.tgz`) and the 0.5.3 fixtures (`src/lib/server/db/fixtures/0.5.3/*.tgz`) are PG16 and cannot be loaded by the new engine.**
- **There is no pg_upgrade.** `@electric-sql/pglite-tools` exports only `./pg_dump`.
- **Recommended tool pairing:**
  - pglite-tools 0.2.1–0.2.4 have no peer dependency and devDepend on pglite 0.2.17. 0.2.4 is a WASI build of **pg_dump 16.4**, labelled "Alpha" in its 0.2.1 changelog.
  - From 0.2.5, pglite-tools pins one exact pglite version (0.4.15 ↔ 0.5.15, 0.4.16 ↔ 0.5.16).
  - The documented recipe installs the newer engine under an npm alias, e.g. `npm install pglite-04@npm:@electric-sql/pglite@0.4.0`.
  - The doc's "full example" link, branch `tudor/upgradePathPGlite` in electric-sql/electric, **is dead (404)**.
- **pgDump mechanics (pglite-tools 0.2.4 source):**
  - It forces `-U postgres --inserts -j 1 -f /tmp/out.sql`.
  - It answers the startup packet itself and runs every query on the instance's existing session, so it dumps whatever database the 0.2.17 instance is connected to (template1).
  - It runs synchronously inside `runExclusive`, which blocks the event loop.
  - It collects the whole dump in memory and returns a `File`. Restoring is a single `pg.exec(dumpText)`.
  - **Risk:** with `--inserts`, pg_dump 16 reads each table with `FETCH 100 FROM _pg_dump_cursor` (verified in REL_16_STABLE `pg_dump.c:2348`). The app's attic documents that 0.2's wasm traps once one result passes about 16 MB (`src/lib/server/attic/context.ts:84`). 100 message rows at hundreds of KB of `debug_meta` each can pass that, so pg_dump may crash the OLD engine on large real installs. That trap was fixed only in 0.3.2. **I have not tested this. Prototype it against a copy of a real data directory.**
- **Crash safety did not improve:**
  - The 0.5.16 `defaultStartParams` still begin `["--single","-F",…]`, and `-F` means fsync is off.
  - [#1107](https://github.com/electric-sql/electric-pglite/issues/1107) (open, against 0.5.8): NodeFS has no fsync or fdatasync, and `syncToFs` is empty.
  - The WAL-repair PR [#994](https://github.com/electric-sql/electric-pglite/pull/994) was closed unmerged on 2026-05-25. Maintainer: "this should be a separate tool."
  - There is still no data-directory lock: [#1106](https://github.com/electric-sql/electric-pglite/issues/1106) and [#892](https://github.com/electric-sql/electric-pglite/pull/892) are open, and the maintainer suggests app-level locks, which the app already has.
  - [#884](https://github.com/electric-sql/electric-pglite/issues/884) (`Aborted()` on reopen, open) is attributed by one reporter to two openers.
  - **Keep the never-SIGKILL rule.**
- WAL and checkpointing: the checkpointer was disabled in 0.4.4 ("not needed in single mode"). The owner's 0.2.17 dir has `max_wal_size = 64MB` and `pg_wal` = 65 MB. I found no issue reporting unbounded WAL in any line. **Not verified further.**

## 3. Stability and performance

- **Support policy.** tdrz, [#1200](https://github.com/electric-sql/electric-pglite/issues/1200), 2026-11-07: "0.4.6 … is quite an old version which we don't support anymore. Could you please try with the latest 0.5.15?" Only the current line is supported, and 0.2.17 is three lines behind.
- **Open issues relevant to one long-lived Node instance:**
  - [#1068](https://github.com/electric-sql/electric-pglite/issues/1068): a multi-row `INSERT … ON CONFLICT` under churn never returns (JIT spin, needs SIGKILL). Reported on 0.4.3 with pgvector and a GIN tsvector. Not reproduced on 0.5.x and unknown on 0.2.
  - [#1058](https://github.com/electric-sql/electric-pglite/issues/1058): `execProtocolRawSync` spins forever if the backend exits mid-message (a genuine wasm trap).
  - [#1200](https://github.com/electric-sql/electric-pglite/issues/1200): empty reads after a roughly 977k-statement transaction (0.4.6 with drizzle 0.45.2; not isolated to PGlite).
  - [#1158](https://github.com/electric-sql/electric-pglite/issues/1158) (closed): a fresh initdb peaks at about 709–849 MB RSS against about 306–363 MB to open an existing directory (0.5.11). 0.5.15 reduced initdb memory, and `@electric-sql/pglite-prepopulatedfs` roughly halves it.
- **Transaction mutex:** unchanged by design (single connection). The app's `transactionGuard` still applies. 0.5.5 adds rejection of operations on a closed `tx` handle.
- **Per-statement performance:**
  - **No published cross-version measurement.** The benchmarks page (docs/benchmarks.md) dates from 2024-08, the 0.2 era, with one typo fix in 2025-07.
  - The only signals are changelog entries: 0.5.14 "do not copy parsers on each query", plus open PRs [#1226](https://github.com/electric-sql/electric-pglite/pull/1226) (resolve parsers once per column) and [#1196](https://github.com/electric-sql/electric-pglite/pull/1196) (less text decoding).
  - **Unverified.** Measure with the app's own budgets (`npm run test:budgets`, about 1.3 ms per simple statement today) before committing.

## 4. Multi-connection

- **What 0.4's "connection multiplexing" is:** the v0.4 blog says "multiplexes concurrent connections over PGlite's single connection". It lives in **pglite-socket** (`--max-connections`, default 1). All socket clients' messages are serialised onto the one single-user backend.
- **What it is not:** real concurrency. The blog says PGlite "runs in Postgres single-user mode, which means a single connection" and lists "true multi-connection support" as future work. Open bugs: [#1046](https://github.com/electric-sql/electric-pglite/issues/1046) (extended-protocol batches interleave across connections; one throw stalls the queue), with fix PRs #977, #1094 and #1222 open. It is irrelevant to an in-process app.
- **Real multi-session status:** draft [PR #1054](https://github.com/electric-sql/electric-pglite/pull/1054) "Multi-session/connection support with a Worker-backed PGlite postmaster" by samwillis. It runs one Node Worker and one wasm instance per backend, behind an opt-in `PGlitePostmaster.create()`. Opened 2026-07-15, last updated 2026-07-27, unmerged, no ETA. The blog gives no timeline for the multi-instance or threads work.

## 5. The app's stack and PGlite surface

`package.json`: `"@electric-sql/pglite": "^0.2.17"` (installed 0.2.17; the pin is unchanged since commit 8c525228 "Migrate to pglite"), `"drizzle-orm": "^0.45.3"` (installed 0.45.3), `"drizzle-kit": "^0.31.11"`.

- **drizzle-orm**
  - 0.45.3 / 0.45.4: peer `@electric-sql/pglite >=0.2.0`, but devDep (what it is tested on) `^0.2.12`.
  - 1.0.0-rc.5 (2026-10-21): peer `>=0.2.0`, devDep `^0.5.8`.
  - Real-world evidence of drizzle 0.45.2 on pglite 0.4.6: #1200.
  - The driver uses only `new PGlite(path|opts)`, `client.query(sql, params, {rowMode, parsers})` and `client.transaction()`. All of these are stable public API.
- **drizzle-kit 0.31.11** (latest, 2026-09-21): no pglite dependency or peer; devDep `^0.2.12`. With `driver: "pglite"` (`src/lib/server/db/drizzle.config.ts`) it loads the project's pglite for `migrate` and `studio`. `generate` does not open the database. Compatibility with 0.5 is **unverified** (no known break).
- **SDK repo** (`/home/jody/github/serene-pub-sdk`): no PGlite use (grep found none outside node_modules and dist).

Every PGlite API and extension the app uses:

| Where | API |
|---|---|
| `src/lib/server/db/index.ts:380-385, 864` | `drizzle(dbConfig.dbPath | "memory://", { schema })` from `drizzle-orm/pglite`. Drizzle calls `new PGlite(path)` with no options and no extensions. `migrate` from `drizzle-orm/pglite/migrator`. `$client.close()`, `$client.waitReady`. |
| `src/lib/server/db/transactionGuard.ts` | Wraps `client.query`, `client.exec` and `client.transaction` (public API). |
| `src/lib/server/db/backup.ts:217-241` | `client.waitReady`, `client.dumpDataDir("gzip")` |
| `src/lib/server/db/recovery.ts:1196-1215` | A child process runs `PGlite.create({ dataDir, loadDataDir: Blob })`, `waitReady`, `query`. It resolves the engine entry with `createRequire(...).resolve("@electric-sql/pglite")` (lines 1256-1279). |
| `src/lib/server/utils/testDb.ts:52, 224, 240` | `new PGlite()` (memory), `new PGlite({ loadDataDir })`, `dumpDataDir("none")` |
| `scripts/db-recover.entry.ts:193` | `new PGlite(path)` plus drizzle |
| `src/lib/server/db/postgres.ts` | `new PGlite(path)`. This file appears to have no importers. |
| tests (`attic/upgrade.tiny`, `attic/restorePath`, …) | `new PGlite(path)` |

- **Extensions: none.** No `CREATE EXTENSION`, no vector, pg_trgm or fuzzystrmatch. Similarity is computed in JS.
- **Not used:** live, listen, worker, relaxedDurability, clone, execProtocol*.
- **Lock, heartbeat and recovery:** app-owned (`lock.js`, `shutdownMarker.ts`, `recovery.ts`, `unopenablePage.ts`) and independent of the PGlite version. The recovery probe (`inspectArchive`) checks that `PG_VERSION` exists in a tar but **not its value**.

## 6. Recommendation and plan

**Target: `@electric-sql/pglite` 0.5.15** (2026-11-03, 15 days old, on the current supported line, PG 18.6). Pair it with `@electric-sql/pglite-tools` 0.4.15 if pg_dump is needed on the new side.

- 0.5.16 is 9 days old. Its fixes do not touch the app's path, so it is a drop-in patch after it ages.
- Do not target 0.3 or 0.4: both are unsupported and both still need the same dump and restore.
- "Stay on 0.2.x latest patch" means staying on 0.2.17, because there is no later 0.2.x. That keeps:
  - the ~16 MB result trap,
  - the silent rolled-back COMMIT,
  - an unknown status for the stack-depth leak and the MessageContext leak,
  - no upstream support.

  It is zero work today, but it is debt that grows: every later line, PG19 included, needs the same conversion anyway.

The plan has two parts: what happens on a fresh install, and how an existing 0.6 data directory is converted.

**Fresh install:** the new engine only; data lives in database `postgres`.
- First-boot initdb peaks at about 700–850 MB RSS (0.5.11 numbers, lowered in 0.5.15). Check this against the smallest supported machine.
- `pglite-prepopulatedfs` would be a new dependency, so it is a ★ decision, not an assumption.
- Bundling: keep `initdb.wasm`, `initdb.js` and `pglite.data` (prune rule 17 already spares them).

**Existing 0.6 (and 0.5.3) data directory:** engine conversion, PG16 → PG18.

1. **Detect.** In `db/index.ts`, after `acquireDatabaseLock()` and before `drizzle()`, read `<dbPath>/PG_VERSION` with a plain fs read and no wasm:
   - `16` → convert.
   - `18` → normal boot.
   - missing → fresh.
   - anything else → refuse with words.

   Upstream draft [PR #1214](https://github.com/electric-sql/electric-pglite/pull/1214) "Test for PG_VERSION existence without module instantiation" is unmerged, so do this in the app.
2. **Ship both engines** as aliased dependencies, the documented recipe: `"pglite-0-2": "npm:@electric-sql/pglite@0.2.17"` and `"pglite-tools-0-2": "npm:@electric-sql/pglite-tools@0.2.4"`. The old engine is never used for serving.
3. **Never touch the original.** Copy `serene-pub.db` → `serene-pub.db.convert-src` and open only the copy. After an unclean shutdown the old engine replays WAL on open, which writes to whatever it opens.
4. **Child process A (old engine)** opens the copy, reusing recovery.ts's child pattern with the alias entry, and records per-table row counts and sequence values.
   - Option 1: `pgDump({ pg })` (maintainers' path; dumps template1; full schema plus drizzle ledger). Risks: the FETCH-100 × large rows trap, the whole dump held in memory, and a synchronous run.
   - Option 2 ★: `pg_dump --schema-only` (small), then a byte-budgeted per-table data copy reusing the attic's `STATEMENT_BYTES` and `insertBatched` discipline, or per-table `COPY … TO '/dev/blob'` → `COPY … FROM '/dev/blob'` (both engines support `/dev/blob`), then `setval` on the sequences.

   Prototype both on a copy of the owner's 315 MB directory.
5. **Child process B (new engine)** opens a new directory `serene-pub.db.convert-new`.
   - Restore the dump, splitting the statements rather than running one giant `exec`.
   - Reset `search_path`, because pg_dump sets it to `''`.
   - Verify every table's row count, the sequences and the `drizzle.__drizzle_migrations` rows against step 4.
   - Run a probe query, then `close()` cleanly.
6. **Swap** with same-filesystem renames: `serene-pub.db` → `serene-pub.db.pg16-<date>`, then `convert-new` → `serene-pub.db`. Record each stage in meta.json so a crash mid-conversion resumes or restarts deterministically.
7. **Keep the PG16 directory** until the next successful boot at minimum. Whether to keep it longer, and where it is shown, is a ★ decision for the owner.
8. **On failure** at any stage: delete `convert-*`, leave the original byte-identical, and boot to a recovery page saying the database could not be converted and nothing was changed. Never fall back to the unopenable/restore flow, whose backups are PG16 too.
9. **Backups and recovery:**
   - `recovery.ts` must read the `PG_VERSION` *contents* from the tar (it already walks the headers) and route a `16` archive through steps 4–5.
   - The pre-migration backup of a PG16 directory is the PG16 directory itself (step 7), or a `dumpDataDir` taken with the old engine.
10. **0.5.3 users:** the engine conversion runs first, then the attic exactly as now. Both 0.5.3 fixtures (PG16 tgz) become conversion fixtures.
11. **Tests:**
    - conversion on the tiny and big fixtures, and on a real-data copy;
    - injected failure at each stage leaves the original intact;
    - **a second boot changes nothing** (standing rule).
12. **Code audit for 0.5.15:** transaction bodies that swallow statement errors will now throw `TransactionAbortedError`.

**Attic precedent** (`src/lib/server/attic/index.ts`): 0.5.3 → 0.6 moved rows *inside one database on one engine*.
- `dataUpgrades/0095` stashes the old tables into schema `attic_0_5_3`, the 0.6 schema is built on empty tables, and `restore.ts` puts rows back in one transaction and marks `__restored`.
- `finish.ts` wires configs and drops the schema.
- Presence of the schema is the single "upgrade pending" signal.
- It is a precedent for the *resumable, signalled, byte-budgeted copy*, but not for crossing engines: it never needed two PGlite versions.

**Size and risk:**
- Stay on 0.2.17: 0 work; risk grows.
- Engine bump plus conversion: medium-large. It touches the db boot, recovery, backup, fixtures, packaging and a migration path for users' data. Highest risks: the old-engine export of large rows, memory with two engines, and backups made before the upgrade.
- 0.5.15 alone without conversion: **not possible** for any existing install.
