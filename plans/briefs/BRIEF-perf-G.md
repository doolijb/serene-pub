# BRIEF — build lane `perf-G` — boot reads its own tables once, and retrieval compiles its gazetteer once per book

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then: `plans/PLAN-performance-2026-11-13.md`
Part 1, W4-b (as amended by [C3]) and W7-c/d; `plans/REVIEW-performance-2026-11-13.md` rows C3, E3, E5; CLAUDE.md
Principles, Hard rules (migrations are generated; never seed a row at a fixed id; the chain `0000`–`0093` is
byte-identical forever) and "0.6 is in users' hands". Line numbers are from 2026-11-13; re-read before editing.
Rows marked **S** are sweep findings: re-verify at their lines first.

## Rulings that bind

- Owner 2026-11-13: change how often, never what. Boot ends in the same state; retrieval ranks the same entries.
- P1: a cache is keyed so a stale answer is impossible; name key and invalidation in the report, one test each.
- ★P8 (indexes) and ★P9 (done-marker rows for one-off boot tasks) are unruled: no migration, no new row, no new
  table. W7-c and W7-d below need neither.
- **Not your files:** `src/lib/server/pipelines/runtime/host.ts` and `bindings.ts` (peer session `serene-pub-c4`,
  lane `lore-match`, live now). The gazetteer cache lives in `ranking/keywordQuery.ts` and `ranking/entities.ts`;
  if the call site in `bindings.ts` must change, queue the exact line in your report instead.

## Build

1. **Registry sync reads once and skips when unchanged** (E3, **S**). `pipelines/boot/registrySync.ts:335–367`,
   `:404–405`; called from `bootstrap.ts:283` every boot, not version-gated. Load the registry table and the
   declarations' hashes once into maps, compare in memory, write only the differences; and skip the whole pass when
   the stored build version and the catalogue hash (the same inputs `db/index.ts:741` gates the seed sync on — read
   how) are unchanged. Same rows afterwards; a test that a second boot issues no writes.
2. **Migration files read and hashed once per boot** (E5, **S**). `db/migrationSet.ts:37–46`, `db/backup.ts:164`,
   `db/migrationLedgerRepair.ts:93`: one read of the set per process, passed along or memoised by file list + mtimes.
   Same hashes; the ledger repair's byte-identity guarantee for `0000`–`0093` is unchanged.
3. **Gazetteer and document-frequency profile cached per lorebook** (C3). `ranking/keywordQuery.ts:501–526`
   (`buildGazetteer`), `ranking/entities.ts:547–563` (the alternation regex), `:1221–1228` (`buildEvidenceProfile`'s
   DF). Cache the compiled regex and the DF map per lorebook, keyed on the exact inputs they are built from (the entry
   names and texts' content hash, or the book's `max(updated_at)` + row count if that is what the call site already
   has — say which, and why it cannot serve a stale answer). The scan itself (which takes `params.retrieval`, the
   current character and cast member) stays uncached ([C3]). Bounded LRU by book. Invalidation test: an entry write
   changes the ranking on the next call.

## Files owned

`src/lib/server/pipelines/boot/registrySync.ts`, `src/lib/server/db/{migrationSet,backup,migrationLedgerRepair}.ts`
(the read sites only), `src/lib/server/pipelines/ranking/{keywordQuery,entities}.ts`; tests beside each.

## Out of scope

★P8, ★P9. `startup/index.ts` one-off task markers. `runtime/host.ts`, `runtime/bindings.ts`. Any migration.

## Stop and ask when

A step needs a migration, a new row, a setting or a name; the registry skip would leave a changed declaration
unsynced in any case you can construct; the gazetteer key cannot be made exact.

## Done means

Existing tests for the touched files (`registrySync*.test.ts`, `migrationSet*`, `backup.int`, `migrationLedgerRepair*`,
`keywordQuery*.test.ts`, `entities*.test.ts`, `boundedPattern.test.ts`) green plus the three new tests above.
Measure and report: boot-time `registrySync` query count before/after (count with a Drizzle logger in the test), and
`keywordQuery` p50 over 50 calls on a 200-entry book before/after. `npx prettier --check` on changed files; `npx tsc
--noEmit -p .` filtered clean.

## Report path

`plans/REPORT-perf-G-2026-11-13.md`: per step verified/built, numbers, tests, "Queued for the runtime owner", open ★,
**Noticed, not done**.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You should need none.)
- Never pipe vitest into `head`. An int test that opens a DB inside an `it` needs a 60 s timeout. Inside `db.transaction(async (tx) => …)` use only `tx`.
- At most 2 workers at once. Workers get these rules inline.
