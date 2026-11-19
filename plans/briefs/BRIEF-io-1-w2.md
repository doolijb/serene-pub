# BRIEF io-1-w2 — the round-trip test, part 2: full seed coverage and named allowances

Repo `/home/jody/github/serene-pub`. Supervisor: lane `io-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: the SDK is not touched.)

## Context

Worker w1 wrote `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts` (seed `seedRoundTripBook`, `snapshotBook`, `diffSnapshots`, the column classification and its guard, four tests) and captured `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json` from today's writer, from that seed. Read the test file whole first. Its last run (`plans/io-1-w1-5.log`) found these differences on export → import: cover, `loreWriteMode`, the branch and everything on it, entry versions (`entry_amendments`) on main, presences, tags, member aliases, an unfiled scene filed under a new empty history entry with its opened clock lost, item provenance, scene-cast ordinal, base versions' `writtenBy`. Duplicate: none.

Two of those are the seed's own doing, not losses:
- `provenance: "model"` is not a provenance this app writes (`ENTRY_PROVENANCES` in `src/lib/server/utils/lorebookEntries.ts`: `human`, `summarizer`, `graph-builder`, `pipeline`); the importer rightly keeps only those.
- `scene_characters.ordinal` is numbered **per role** from 0 by the app's writer (`writeSceneCast`, `src/lib/server/utils/sceneCast.ts` ~177); the seed numbered across roles.

This phase is still **measurement**: change no production code.

## Files owned (the only files you may edit)

- `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`
- logs under `plans/` named `io-1-w2-*`

**Never edit the fixture** `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json`: it is the file an earlier build wrote.

## Files readable

Everything w1's brief listed (`plans/briefs/BRIEF-io-1-w1.md`), plus `src/lib/server/utils/sceneCast.ts`, `src/lib/server/utils/lorebookEntries.ts`, `src/lib/server/db/schema.ts` (column defaults). `src/lib/server/lorebooks/entryKnowledge.ts` belongs to another lane: never edit it.

## Build

### 1. Freeze the base seed

`seedRoundTripBook` is now the seed the fixture was captured from. Do not change what it writes. Say so in its doc comment ("the fixture `lorebook-format2-2026-11-16.json` was exported from exactly this; never change it").

### 2. `extendSeed(ownerId, bookId)` on top of it

Used by the round-trip, duplicate and overwrite tests (base, then extend); never by the old-file test. It:
- corrects the two seed artefacts above on the full seed (the item's provenance to `pipeline`; the scene cast ordinals per role);
- gives **every compared column of every table** a non-default value in at least one row where the app can hold one: book `kind`, `annex` / `annexAudiences` / `annexVersions`, `extraJson.tokenBudget` / `recursiveScanning`; entries' `matchMode`, `recursionDepth`, `decayRate`, `secondaryKeys` + `selectiveLogic`, `constant`, `caseSensitive`, `fields`, `extraJson`, `derivedFrom`; links' `description`, `visibility`, `status`, `reason`; members' own columns (`ownName`, `ownNickname`, `spriteSet`, `timbre`, `faceMediaId`, `retold`, frozen columns such as `description`/`personality` on a background member, `parentNodeId`, `sceneId`/`historyEntryId`); scenes' `nameIsDefault`, `channel`, `closedStoryClock*`, `summaryStatus`, `summaryOrigin`, `notes`, `graphed`; stats' `note`, `updatedBy`, `historyEntryId`, `sceneId`; sprite sets and sprites, a member file (`cast_member_files`), a dismissed duplicate pair, a binding suggestion, an owner sheet, an entry's edit history row (`lore_redlines`) and a binding merge log, entry vectors and annotations. Copy the duplicate test's patterns (`seedRichBook` in `lorebooks.duplicate.int.test.ts`) for the ones it already seeds. Never insert at a hardcoded id.

### 3. Coverage check

A test (or an assertion inside the round-trip test on the source snapshot) that every `"compare"` column holds, in at least one row of the full seed, a value that is not null, not the column's own default (`getTableConfig(table).columns` → `column.default` when it is a plain value), and not `""`, `[]`, `{}`, `false` or `0` — unless the column is named in a `NOT_SEEDED` object with the reason (for example a session-only column on a book-layer row). A table with no rows fails every column, so every table is seeded or each of its columns is in `NOT_SEEDED`.

### 4. Real paths

- **Round trip**: export the full seed, take the source snapshot **right after the export**, then make one change to the source that the file comparison sees (e.g. the book's description), so the re-import answers `status: "conflict"`, and resolve with `action: "createNew"`. Compare the new book with the snapshot taken after the export. Drop the uuid-deletion fallback; if the import still answers anything but `conflict`, fail with that status.
- Duplicate and overwrite as now, on the full seed.
- Old file: import the fixture as a fresh user (status `created`), diff against a snapshot of a fresh **base** seed (no `extendSeed`).

### 5. Named allowances instead of `toEqual([])`

Each test asserts its difference list against an allowance list: `{ match: RegExp; reason: string }[]`. Every difference must match an allowance, and every allowance must match at least one difference (no stale allowance). For this phase, write **one allowance per distinct difference** you see, with the reason `"measured 2026-11-16, unclassified"`: the supervisor classifies them afterwards. Keep the allowance lists as named `const`s near the top of the test section so they are easy to edit (`ROUND_TRIP_ALLOWED`, `DUPLICATE_ALLOWED`, `OVERWRITE_ALLOWED`, `OLD_FILE_ALLOWED`). Use patterns without user or row ids (a `writtenBy` of `user:N` matches `user:\d+`).

## Rules you must follow (quoted from CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- "It is a **session**, never a *chat*."
- "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs."
- "An int test that opens a DB inside an `it` needs a 60 s timeout under load."

## Running tests

Only this way, one run at a time, after waiting for other lanes' runs:

```
until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "sdk:build" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/lorebooks.roundTrip.int.test.ts > plans/io-1-w2-<n>.log 2>&1"
```

Type-check with `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and filter to your file. `npx prettier --check` your file.

## Stop and ask when

You would need to change production code; a seed value has no writer and no plausible raw insert; a column cannot be given a non-default value for a reason you are unsure of (put it in `NOT_SEEDED` with your reason and list it). CLAUDE.md §Decisions applies.

## Done means

All tests in the file green with the measured allowances; the coverage check green with its `NOT_SEEDED` list; `tsc` clean for the file; `prettier --check` passes; the fixture untouched (`git diff --stat` shows nothing for it; it is untracked, so check its mtime is unchanged from before you started).

## Report

Final message: every difference each of the four tests now prints, verbatim (grouped by test); the `NOT_SEEDED` list with reasons; tests run with results.
