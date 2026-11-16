# REPORT — lane `perf-G` — boot reads its own tables once; retrieval compiles its gazetteer once per pool — 2026-11-13

Supervisor's report, relayed to disk by the lead (the harness refused the supervisor's own write). All three steps
built; the registry **skip gate** not built (★G1). 16 targeted test files, 301 tests green; filtered `tsc` clean.
Nothing committed. Worker briefs: `plans/briefs/BRIEF-perf-G-w1.md`, `-w2.md`.

## Step 1 — registry sync reads once (E3)

Confirmed: every declaration cost two queries per boot (`registrySync.ts:339`, `archiveDeclaration` `:240`). Now the
registry table is read once into a map (`id@version` → row) and the archive once into a set; inserts/updates use
`.returning()` and write back into the map; comparisons and write conditions unchanged. Drizzle-logger counts on the
core list with `complete: true` (the `bootstrap.ts:283` call):

| run | before total / writes | after total / writes |
|---|---|---|
| first sync, empty registry | 825 / 412 | 415 / 412 |
| second sync, unchanged | 413 / 0 | **3** / 0 |

The 3 reads: registry, archive, and the reverse-diff's own query (kept: its `standing` count must see rows written
earlier in the pass). Duplicate pins in `snapshotRegistry` now find their twin in the map (tested).

**★G1 — skip gate not built.** Nothing stores a catalogue hash today (`db/index.ts:741` gates the seed sync on
`dev || versionChanged || treatAsFreshInstall`; only `meta.version` is stored), and a version-only gate would miss a
plugin install/uninstall between two boots of one version (core's declared set changes, the version does not). An
exact skip is the comparison the pass now does for 3 reads. Recommend: not built; revisit only with ★P9.

## Step 2 — migration files read once per process (E5)

Confirmed: `hasPendingMigrations` (called twice on a matching-version boot), `readJournalMigrations` and
`readMigrationSet` each read and sha256'd the whole `drizzle/` folder. Now `readMigrationFilesMemo(folder)` wraps
drizzle's own reader, memoised on the resolved folder + `mtimeMs:size` of `meta/_journal.json` and of each listed
`<tag>.sql` (stat'ed, not read); `readMigrationSet` memoised on the same key; callers get copies. Hashing stays
drizzle's; output deep-equals `readMigrationFiles` on the real folder (tested); the `0000`–`0093` byte-identity
guarantee is untouched. `migrationSet.ts` still has no `$lib` import (`vite.config.ts` imports it). Known gap: a
same-size same-nanosecond rewrite is unseen.

## Step 3 — gazetteer and term profile cached per pool (C3 / W4-b)

Built in `ranking/{keywordQuery,entities}.ts`; the scan stays uncached ([C3]). `buildPoolTermProfile(entryTexts)` is
the conversation-independent half of `buildEvidenceProfile`, split out; two 16-slot LRUs, `gazetteerFor` and
`poolTermProfileFor`. Keys are the **whole input**: gazetteer = JSON of `[ref.kind, ref.id, name]` in order; pool
profile = sha256 over `entryTexts.length` and every `name keys content`, and the cache keeps a copy of the texts and
checks length and every element with `===` on a hit, so even a hash collision cannot serve a stale answer. Shared
structures are read-only (`matchAll` clones the regex; nothing mutates `byName`, the sets or maps).
`resetPoolCaches()` test-only. 200-entry book, 10 cast refs, 20 messages, 50 calls:

| shape | before p50 / p90 | after p50 / p90 |
|---|---|---|
| same input each call | 5.52 / 8.41 ms | 4.14 / 5.68 ms |
| messages change, pool does not (the per-turn case) | 6.32 / 6.77 ms | 4.61 / 4.84 ms |

## Changed files

`pipelines/boot/registrySync.ts` (+ new `registrySync.queries.int.test.ts`), `db/migrationSet.ts` (+ `.test.ts`),
`db/backup.ts` (import + the read in `hasPendingMigrations` only; perf-E's streaming edit untouched),
`db/migrationLedgerRepair.ts` (import + read), `ranking/entities.ts`, `ranking/keywordQuery.ts` (⚠ a worker's
prettier reflowed 4 unrelated blocks, whitespace only; the file was unclean at HEAD and is clean now),
`ranking/keywordQuery.test.ts`. `registrySync.ts` and `migrationLedgerRepair.ts` were unclean at HEAD and stay so
apart from the lane's own lines.

## Tests

Registry/migrations: `registrySync.int`, `registrySync.queries.int` (new: unchanged sync = 0 writes, ≤ 3 reads; one
pass with an insert, a pointer move and doubled pins), `registryHashes`, `migrationSet` (memo output = drizzle's; no
re-read; a rewrite with new size/mtime re-hashes; `readMigrationSet` refreshes), `migrationLedgerRepair` (+ int),
`ledgerSplice.int`, `backup.int`, `staleBuildBoot.int`. Ranking: `keywordQuery` (+4: hit = cold incl. fresh string
identities; cast-name change invalidates; entry edit invalidates; forced key collision rejected), `entities`,
`boundedPattern`, `entitySearch`, `mentions`, `keyProposal`, `keylessCorpus`. 16 files / 301 tests.

## Queued

- `db/dataUpgrades/index.ts:286` still calls drizzle's `readMigrationFiles` directly; `readMigrationFilesMemo` would
  remove one more read per boot. Drizzle's own read inside `migrate()` cannot be changed.
- `runtime/bindings.ts`, `runtime/host.ts`: nothing (`keywordQuery`'s signature is unchanged).

## Noticed, not done

- `annotations/index.ts:545` builds its gazetteer without the cache; unmeasured.
- The reverse-diff could reuse the registry map (one more read) if its `standing` count tracked this pass's writes.
- `keywordQuery.ts`: the function's doc comment sits above `MAX_RECURSION_DEPTH` (pre-existing).
- `/tmp/serene-pub-vitest-{4cT1bh,kKTIDR,p3Hc1p,vpnNyh}` exist; owner unknown, left alone.


---

## Lead's acceptance note (after scope review)

In scope; three low findings. (1) The whitespace reflow of four unrelated blocks in `keywordQuery.ts` is **accepted**:
the file is now prettier-clean, the hunks are whitespace only, and no other lane owns it. (2) `PoolTermProfile` /
`buildPoolTermProfile` recorded in NOMENCLATURE §25 as the retrieval **pool**, distinct from the turn pool. (3) The
`QUERYCOUNT` console.log in `registrySync.queries.int.test.ts` deleted. The three correctness checks (map-backed
registry pass, migration memo key, exact cache keys and a `matchAll`-only regex) found no objection.
