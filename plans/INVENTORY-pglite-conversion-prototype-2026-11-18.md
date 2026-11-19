# PGlite 0.2.17 → 0.5.15 conversion prototype: results (2026-11-18)

This was run on a copy of the owner's data directory, taken once with `rsync` while the app was running (crash-consistent).
This file holds only numbers and the names of tables, columns and types.
Every copy, converted directory, dump and JSON output has been deleted.

- Machine: Linux x86-64, Node 25.0.0.
- Engines: `pglite-old` = `@electric-sql/pglite@0.2.17` with `pglite-tools-old` = `@electric-sql/pglite-tools@0.2.4`; `@electric-sql/pglite@0.5.15` with `@electric-sql/pglite-tools@0.4.15` (peer pin `0.5.15`).
- Each engine ran in its own node process.
- Scripts are in `scripts/`:
  - `inspect.mjs`: inventory, catalog and hashes
  - `dumpA.mjs`, `dumpTrace.mjs`, `dumpPerTable.mjs`: Path A
  - `exportB.mjs` (old engine) and `importB.mjs` (new engine): Path B
  - `splitSql.mjs`
  - `compare.mjs`
  - `bench.mjs`
  - `openClose.mjs`, `drillTerm.mjs`, `copyWhole.mjs`, `settings.mjs`

## 1. Source (old engine, PG 16.4, 32-bit emscripten build)

| item | value |
|---|---|
| Directory size | 315 MB (`base/1` = template1 237 MB, `pg_wal` 65 MB) |
| Default database | `template1` (247.6 MB); `postgres` and `template0` are 7.3 MB each and empty |
| Encoding / collation | UTF8 / C / ctype C.UTF-8, provider libc. The new engine is identical |
| Schemas with tables | `public` (137 tables), `drizzle` (1: `__drizzle_migrations`) |
| Tables / rows / relation bytes | 138 / 25,549 / 234.5 MB |
| Sequences | 117 |
| Migrations ledger | `drizzle.__drizzle_migrations`: 171 rows, max id 174 |
| Indexes / constraints / columns | 468 / 538 / 1,695 |
| Enums / views / triggers / extensions / functions | 0 / 0 / 0 / `plpgsql 1.0` / 1 (`public.entry_keys_text(text[])`) |
| Generated / identity columns | 5 `GENERATED ALWAYS … STORED` / 116 identity `BY DEFAULT` / 1 `nextval` default |
| Column types | integer 583, text 563, timestamp 199, json 120, boolean 110, jsonb 72, timestamptz 16, real[] 6, text[] 5, bigint 5, real 5, uuid 5, varchar(256) 2, numeric 1, varchar(4000) 1, varchar(512) 1, integer[] 1. No bytea |
| Open / full inventory / content hashes | 0.17–0.21 s / 11.4 s / 4.6 s; peak RSS 906 MB |

The ten largest tables:

| table | rows | total MB (PG16) | total MB (PG18, after restore) | heap MB | largest row, text MB | largest row, stored MB | largest 100-row window, text MB | whole table as text, MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| public.pipeline_runs | 671 | 180.80 | 180.80 | 0.22 | 2.44 | 1.03 | **111.15** | 400.41 |
| public.message_parts | 235 | 16.49 | 0.44 | 5.92 | 0.00 | 0.00 | 0.12 | 0.19 |
| public.session_messages | 186 | 7.02 | 1.48 | 3.87 | 0.03 | 0.01 | 1.39 | 2.53 |
| public.pipeline_scripts | 44 | 1.75 | 0.63 | 0.02 | 0.08 | 0.04 | 1.03 | 1.03 |
| public.pipeline_run_nodes | 9411 | 1.52 | 1.67 | 1.04 | 0.00 | 0.00 | 0.01 | 0.84 |
| public.sessions | 5 | 1.48 | 0.10 | 1.23 | 0.00 | 0.00 | 0.01 | 0.01 |
| public.pipeline_nodes | 2594 | 1.16 | 1.30 | 0.92 | 0.00 | 0.00 | 0.05 | 0.93 |
| public.lorebook_entry_vectors | 102 | 0.99 | 0.64 | 0.02 | 0.01 | 0.00 | 1.24 | 1.27 |
| public.pipeline_edges | 5152 | 0.64 | 0.91 | 0.48 | 0.00 | 0.00 | 0.01 | 0.30 |
| public.pipeline_definition_declarations | 241 | 0.55 | 0.66 | 0.31 | 0.02 | 0.00 | 0.28 | 0.59 |

- **Risk:** no single row exceeds 16 MB (the largest is 2.44 MB).
- One table, `pipeline_runs`, has a 100-row window of 111 MB in heap order, which is about 7× the ~16 MB result limit.
- Every other table stays under 1.4 MB per 100 rows.
- Shrinkage on restore is dead-tuple bloat dropping out: `message_parts` 16.5 → 0.44 MB, `session_messages` 7.0 → 1.5 MB, `sessions` 1.48 → 0.10 MB.

## 2. Path A: `pgDump` (pglite-tools 0.2.4) from the old engine

| attempt | result |
|---|---|
| `pgDump({pg})` on the on-disk instance (`new PGlite(dir)`) | **fails immediately**: `pg_dump: error: query failed: unexpected response from server; first received character was "R"` on its first query `SELECT pg_catalog.set_config('search_path', '', false)`. The socket-file handshake breaks on NODEFS: the second packet is read as a startup packet. It also fails with `--schema-only` |
| Same, after copying the instance into memory (`dumpDataDir('none')` → `new PGlite({loadDataDir})`) | Full dump **traps** with `RuntimeError: unreachable` inside pg_dump after about 658 round trips (0.32 s, while fetching `public.pipeline_nodes`), before reaching `pipeline_runs`. The Postgres instance still answered afterwards. Wall 1.97 s, peak RSS 1.62 GB |
| Full dump with `--exclude-table-data=public.pipeline_runs` | Same `unreachable` trap at round trip 660 (now in the next table). The trap appears to depend on how many round trips one pg_dump run has made, not on the table |
| `--schema-only` | **OK**: 375 KB, 0.18 s |
| One `pgDump -a -t <table>` call per table, in one process | 137 of 138 tables OK (12.0 MB of INSERT text, 8.3 s, peak RSS 1.62 GB, largest response 1.38 MB) |
| The same for `public.pipeline_runs` | **Traps the old Postgres**: `memory access out of bounds` on a 17.76 MB `FETCH 100` response. The instance is dead afterwards (every later statement fails the same way). In the first per-table run this cascaded to all 57 tables after it |

**Verdict:** Path A does not work. It still fails with every workaround, because of `pipeline_runs`.

## 3. Path B: schema from pg_dump, data by byte-bounded COPY through `/dev/blob`

**`/dev/blob` support:**
- On 0.2.17, `COPY … TO '/dev/blob'` works and is **not** subject to the 16 MB limit. The whole of `pipeline_runs` went out in one statement: 405.5 MB in 1.9 s, RSS 1.08 GB.
- On 0.5.15, `COPY … FROM '/dev/blob'` works.

**Options used:**
- Schema: `pgDump({ pg: inMemoryClone, args: ['--section=pre-data'] })`, then `['--section=post-data']`. pglite-tools forces `-U postgres --inserts -j 1`.
- Data, per table:
  - Use the non-generated columns only.
  - Read `ctid` and `octet_length(t::text)` per row in `ctid` order, and group rows into pages of at most 4 MiB.
  - For each page, run `COPY (SELECT <cols> FROM t WHERE ctid >= '(b,o)'::tid AND ctid <= '(b,o)'::tid) TO '/dev/blob'`.
  - Check that the page row count matches the expected count.
  - Grouping by heap *block* instead of by row gave a 28.9 MB page, because toasted rows share a block. Use rows.
- Sequences: read `last_value` and `is_called` from each of the 117 sequences.

| export (old engine, one process) | value |
|---|---|
| Data COPY | 4.3 s, 209 pages, largest page 4.05 MB, 415.6 MB of COPY text (`pipeline_runs` is 405.5 MB in 122 pages) |
| Inventory + catalog + sequences | 0.4 s |
| Content hashes | 4.8 s |
| In-memory clone for pg_dump | 1.3 s (331 MB tar) |
| Schema dumps | 0.3 s (pre 194 KB, post 182 KB) |
| Total wall / peak RSS | 11.4 s / **1.57 GB** |
| Data only (no hashes, no clone) | 4.65 s / 870 MB |

## 4. Restore with the new engine (0.5.15, PG 18.6, database `postgres`) into a new directory

The steps, in order:
1. pre-data, split into statements and run one at a time;
2. COPY FROM per page, one transaction per table, with a row-count check per page;
3. `setval` × 117;
4. post-data, split the same way;
5. `RESET ALL; ANALYZE`.

| phase | time |
|---|---|
| Open (initdb of a new directory) | 1.19 s |
| pre-data: 413 statements, 413 OK | 0.28 s |
| data: 25,549 rows | 8.58 s |
| sequences | 0.03 s |
| post-data: 726 statements (302 indexes, PK/UK/FK), 726 OK | 0.51 s |
| ANALYZE / close | 0.21 s / 0.07 s |
| **Total wall / peak RSS** | **10.9 s / 1.13 GB** |
| Resulting directory | **450 MB**: `base/5` (postgres) 211 MB, **`pg_wal` 225 MB** |

- **Required fix found:** pglite-tools 0.2.4 fakes the server's startup reply without `client_encoding` or `standard_conforming_strings`.
- As a result, pg_dump writes `SET client_encoding = 'SQL_ASCII'` and `SET standard_conforming_strings = off` into the dump.
- It still copies server-generated expressions verbatim in `scs=on` form. Five literals with backslashes are affected: the `GENERATED ALWAYS` hash expressions (`embed_text_hash`, `annotation_text_hash`, …).
- Restored as written, 1 pre-data statement failed and the restore cascaded into 819 errors. Worse, an expression that does parse would silently mean something else.
- Fix: rewrite those two header lines to `UTF8` and `on`. pg_dump's own literals use `E'…'` whenever they hold a backslash, so this is safe. With the fix there were 0 errors.

## 5. Verification (old copy and converted directory, both computed in SQL the same way)

| check | result |
|---|---|
| Tables | 138 = 138, none missing or extra |
| Row counts | all 138 equal (25,549 = 25,549) |
| Row hash per table (`md5(string_agg(md5(t::text), '' ORDER BY 1))`, order-independent) | **138/138 equal** |
| Column hash per column (1,695 columns, text form of each value) | **1,695/1,695 equal** |
| Sequences (`last_value`, `is_called`) | 117/117 equal |
| Migrations ledger (`id:hash:created_at`, ordered) | equal (171 rows) |
| Indexes (`indexdef`) | 468/468 identical |
| Columns (type, nullability, default, generated, identity) | 1,695/1,695 identical |
| Constraints | 538/538 identical. PG18 adds **1,035 `*_not_null` rows** to `pg_constraint` (NOT NULL is now catalogued as a constraint). This is expected and not a difference in the data |
| Enums / views / triggers / extensions / function bodies / sequence ownership | identical (0 / 0 / 0 / plpgsql / 1 / 117) |
| Types used | identical set |

- **Text forms that differ between PG16 and PG18:** none in this data.
- That covers json, jsonb, timestamp, timestamptz (TimeZone is GMT on the old engine and UTC on the new one; both print `+00`), real, real[], numeric, uuid, text[] and integer[].
- `extra_float_digits` is 1 on both. There is no bytea.
- Generated columns were recomputed by PG18 and hash equal.

## 6. Boot check and speed (each engine on its own directory, two runs each, 1,000 statements after 100 warm-up)

| query | old 0.2.17 | new 0.5.15 |
|---|---:|---:|
| open | 179–207 ms | 175–176 ms |
| count session_messages ⨝ sessions | 16–19 ms | 13–15 ms |
| count pipeline_run_nodes ⨝ pipeline_runs | 8–15 ms | 5.5–8 ms |
| count pipeline_edges ⨝ pipeline_nodes ×2 | 7–10 ms | 6–8 ms |
| count message_parts ⨝ messages | 2.5–3.3 ms | 1.8–2.5 ms |
| text length of all pipeline_runs (400 MB detoast) | 1.68–1.77 s | 1.54–1.62 s |
| `select 1` per statement | 0.40–0.50 ms | 0.05–0.13 ms |
| PK read, pipeline_run_nodes, id only | 0.47–0.57 ms | 0.11–0.16 ms |
| PK read, pipeline_run_nodes, all columns | 0.52–0.58 ms | 0.15–0.21 ms |
| PK read, session_messages, 2 columns | 0.49–0.58 ms | 0.12–0.17 ms |
| RSS after the run | 440–466 MB | 425–428 MB |

All join counts were equal across the engines. Simple statements on the raw client were **about 3.5–4× faster** on 0.5.15. These measurements exclude drizzle; the app's figure of about 1.3 ms includes it.

## 7. Failure drills

**What opening does to a directory.** The old and new engines behave alike.

| action | files changed |
|---|---|
| Old engine, open and close a crash-consistent copy | 5: one `base/1` page (WAL replay), 2 files in `global/` (including `pg_control`), one `pg_wal` segment, `postmaster.pid` |
| Old engine, open and close again (already cleanly closed) | 3 every time: `global/pg_control`, one `pg_wal` segment, `postmaster.pid` |
| Old engine, open and run read-only queries (the step-1 inventory) | 26: plus 21 catalog/relation files under `base/1` (hint bits) and `pg_internal.init` |
| New engine, open and close the converted dir (×2) | 2 every time: `global/pg_control`, one `pg_wal` segment |

Opening is never read-only, so the original must never be opened.

**SIGTERM:**
- SIGTERM during the data phase of the export (sent at 2.0 s): the handler closed the instance, and the process exited with code 143 after 9.0 s, waiting for the in-flight statement.
- The work copy changed only as reading changes it (catalog hint bits, `pg_control`, WAL).
- On reopening, all hashes, counts, sequences and the ledger equalled step 1.
- SIGTERM at 10.5 s, during the in-memory clone and pg_dump (synchronous): handled after the synchronous section returned, with exit 143 after 0.46 s.
- The pristine copy's file hash was identical before and after all experiments: `2172ee85…e2ca`.

**Restore twice into the same directory:**
- 1,059 errors: `already exists` ×840 (594 objects and 246 constraints), `multiple primary keys` ×131, data `duplicate key value violates unique constraint` ×88 (every non-empty table, each rolled back).
- 0 rows were added, so the counts were unchanged. Every non-empty table has a PK, which is the only reason nothing was duplicated.
- A rerun is not idempotent, so the target must always be a fresh, empty directory.

**WAL:**
- The converted directory carries 225 MB of `pg_wal` (16 segments) after the bulk load.
- `CHECKPOINT`, and `ALTER SYSTEM SET max_wal_size='64MB'`, `min_wal_size='32MB'` followed by reopen and `CHECKPOINT`, both left all 16 segments in place.
- This was not investigated further.

## Totals for a 315 MB directory

Export 11.4 s (4.7 s without hashes) + restore 10.9 s + verification on the new side about 5 s (counts and hashes) ≈ **25–30 s** end to end.

Peak RSS: 1.57 GB in the old-engine process (from the in-memory clone pg_dump needs; 870 MB without it) and 1.13 GB in the new-engine process. The two processes run one after the other.

Disk during the conversion: source copy 315 MB + export files 398 MB + new directory 450 MB.
