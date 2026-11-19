# BRIEF io-1-w1 — the lorebook round-trip test, its column guard, and the old-format fixture

Repo `/home/jody/github/serene-pub`. Supervisor: lane `io-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build` at all: the SDK is not touched.)

## Goal

A test that seeds one rich lorebook, sends it through **export → import as a new book**, through **duplicate**, and through **overwrite**, and compares the books **field by field after mapping ids**, listing every difference by table, row label and column. Plus a guard that fails when a lorebook-owned table gains a column the comparison does not classify. Plus a fixture: today's export file of the seeded book, captured **before anyone changes the export writer** (nobody has yet; you change no production code at all).

This phase is **measurement**. The round-trip test is expected to report differences today. Do not fix any production code. Your report must list every difference the round trip, duplicate and overwrite comparisons print, verbatim.

## Files owned (the only files you may create or edit)

- `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts` (new)
- `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json` (new; the captured export)
- a temporary capture test `src/lib/server/sockets/io1-capture.tmp.int.test.ts` if you need one to write the fixture; **delete it** before you report.
- scratch/log files under `plans/` named `io-1-w1-*`.

## Files readable (read, never edit)

- `src/lib/server/utils/lorebookExportBuilder.ts` — `buildLorebookExportData(lorebookId, userId, options)`: the export writer. Export's socket handler is paused (owner ruling 2026-09-28) and throws; the builder is the real writer (the import's unchanged-vs-conflict check, the character-card embed and `library/writes.ts` Back/Forward all use it).
- `src/lib/server/utils/lorebookExportMapper.ts` — the file format (`LOREBOOK_FORMAT_VERSION = 2`).
- `src/lib/server/sockets/lorebooks.ts` — `lorebookImportHandler` (~5661), `lorebookImportResolveHandler` (~5959, `action: "createNew" | "overwrite"`), `lorebooksDuplicateHandler`, `createLorebookFromParsedCard`, `insertLorebookEntries`, `restoreNarrativeGraph`, `overwriteLosses`.
- `src/lib/server/lorebooks/tableRegistry.ts` — `LOREBOOK_TABLES`: every table whose rows belong to a book (with `notCopied` reasons).
- `src/lib/server/lorebooks/tableRegistry.test.ts` — how the registry guard walks `schema` with `getTableConfig`: copy that technique.
- `src/lib/server/sockets/lorebooks.duplicate.int.test.ts` — `seedRichBook` (~185) and `snapshot` (~585): the closest existing pattern (seeding branches, amendments, presences, both link endpoint kinds, scenes with cast, tags, calendar and clock, stats; labelling ids). Copy freely; do not edit that file.
- `src/lib/server/sockets/lorebooks.import-export.int.test.ts` — `dormantExport` (~74): how tests drive the builder and serialise the file (`JSON.stringify(specBookWithGraph, null, 2)`); the test-DB `vi.mock` / `beforeAll` / `releaseDataDir` boilerplate to copy.
- `src/lib/server/lorebooks/entryKnowledge.ts` — **another lane owns it; never edit it.** You may call `setEntryCommonKnowledge` and `writeKnowledgeTie` to seed, or insert the rows directly (knowledge tie = a `narrative_relationships` row from a cast member (`from_node_id`) to an entry (`to_entry_id`), `knowledge_kind` in `was_told | knows | has_been_there | kept_from`, `relationship_type` equal to the kind, `reverse_relationship_type` NULL; CHECK `narrative_relationships_knowledge_check`).
- `drizzle/0167_entry_knowledge.sql` — `lorebook_entries.not_common_knowledge`, `narrative_relationships.knowledge_kind`.
- `docs/lorebooks.md` §"Creating, importing, duplicating and deleting" (~332–353).

## Build

### 1. Seed (`seedRoundTripBook(ownerId)`)

One book owned by `ownerId`, every label unique, holding at least:
- book row: description, `extraJson` (`scanDepth`), a `storyCalendar` (2+ months), the main clock (`storyClockYear/Month/Day`), a non-Freeform `primaryRuleset` the test DB actually has (find one the import tests use — `importedBookRules` falls back to Freeform when the pub lacks it), `loreWriteMode` set to a non-default value, a tag (`lorebook_tags`), and a cover (`coverMediaId`) if the duplicate test's media pattern (`pngBytes`, `fileForOwner`) makes that cheap — otherwise say so.
- **two lines with a branch point**: a branch (`lorebook_branches`) with `forkYear/forkMonth/forkDay` and its own clock.
- entries: world lore, character lore anchored to a cast member, a history day (history entry) on main, a history day on the branch, an entry on main with a Beginning (`year`/`month`/`day`), an entry living on the branch (`branch_id`), an entry filed under another (`anchorEntryId`), one marked **not common knowledge**, an archived one, an item, two **places** (location entries) joined by a **way** (an entry↔entry `narrative_relationships` row with a `title` and `reverse_relationship_type`).
- an **entry version** (`entry_amendments` row) on main and one on the branch.
- **links**: a cast↔cast link on main dated by the main history day (`history_entry_id`), a link on the branch (`branch_id`) dated by the branch history day, and one **knowledge tie of each of the four kinds** from a cast member to an entry (one of them dated).
- **cast**: a member with a card the owner owns, a background member (no card), each with a base `character_versions` row (see `insertCastMember` in `$lib/server/characters/versions`), a member version on the branch, a presence (`cast_presences`).
- **scenes**: a scene with a summary and cast filed under the main history day; a scene not yet compiled (no history entry) with an opened story clock.
- **stats**: an attribute value and configuration on the book, a cast member and a place (template layer: `session_id` NULL, main).

Seed through the app's writers where the duplicate test does, raw inserts otherwise. Never insert a row at a hardcoded id.

### 2. Snapshot and diff

- `snapshotBook(bookId)`: every row of the book in every table of `LOREBOOK_TABLES` plus the `lorebooks` row, each row given a **label** from its content (branch by name; cast member by card name or own name; entry by type + title, or content prefix for a history entry, + its line label; scene by name; a link by its two end labels + relationship type + line). Never label by position or id alone. Every id column is replaced by the label of the row it points at (`FOREIGN:<id>` when it points outside the book).
- `diffSnapshots(a, b)`: a list of strings, one per difference: `table @label: column a=… b=…`, `table @label: missing in b`, `table @label: extra in b`. Rows match by label.
- **Column classification**: one `const` object, for `lorebooks` and every table in `LOREBOOK_TABLES`, mapping **every** column (drizzle property name) to either `"compare"` or a string reason it is not compared (own id, timestamps, embeddings/vectors and their hashes, which an import recomputes; `uuid`/`userId`/`name` per path is handled in the tests, not here). `diffSnapshots` compares exactly the `"compare"` columns.
- **Guard test** (no DB needed): for `lorebooks` and every table in `LOREBOOK_TABLES`, every column from `getTableConfig(table).columns` is classified, and every classified column exists. A new column fails it by name.

### 3. Tests

1. **Round trip**: seed for user A; `buildLorebookExportData(bookId, A)` → `JSON.stringify(…, null, 2)` → `lorebookImportHandler.handler(fakeSocket(A), { lorebookJson })` (returns `status: "conflict"` because A owns the uuid) → `lorebookImportResolveHandler.handler(fakeSocket(A), { action: "createNew", heldImportId, existingId })`. Snapshot both books, diff, `console.log` the list, and `expect(diff).toEqual([])` (it will fail today — that is the point of this phase).
2. **Duplicate**: `lorebooksDuplicateHandler.handler(fakeSocket(A), { lorebookId })`; same diff; the registry's `notCopied` tables (`cast_amendments`, `lore_redlines`, `binding_merge_logs`) are expected empty in the copy — compare the rest; log the list.
3. **Overwrite**: change the source after export (edit an entry's content, add an entry), then import the file over it (`action: "overwrite"`). Assert what the docs promise: the conflict's `losses` counts name the book's branches, dated changes (amendments) and presences; after the overwrite, the book's main content equals the file's (compare against a snapshot taken right after the export, main line only). Log any difference.
4. **Old file**: import `fixtures/lorebook-format2-2026-11-16.json` as a fresh user (status `created`), snapshot, diff against a fresh seed's snapshot; log the list. Leave the expectation as `toEqual([])` for now.

### 4. Capture the fixture (do this before anything else that could touch the writer)

With the seed written, export the seeded book with today's `buildLorebookExportData` and write it, pretty-printed, to `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json` (a temporary capture test is fine; delete it after). Check the file states `"formatVersion": 2`.

## Rules you must follow (quoted from CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- "`$state(new Set())` …" does not apply (server test).
- "It is a **session**, never a *chat*."
- "Never `kill -9` the dev server." "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs."
- "An int test that opens a DB inside an `it` needs a 60 s timeout under load."
- Test names and labels are test-local; introduce no new exported names in production code (you edit none).

## Running tests

Only this way, one run at a time, after waiting for other lanes' runs:

```
until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "sdk:build" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/lorebooks.roundTrip.int.test.ts > plans/io-1-w1-<n>.log 2>&1"
```

Then read the log with the Read tool or `grep`. Type-check your file with `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and filter the output to your file (other lanes' in-flight files may show errors: not yours). `npx prettier --check` your files.

## Stop and ask when

You would need to change production code; a seed row needs a writer that does not exist; a column's classification is not obvious (mark it `"compare"` and list it). CLAUDE.md §Decisions applies.

## Done means

- The guard test passes. The round-trip, duplicate, overwrite and old-file tests run to completion (they may fail on their `toEqual([])`), each printing its difference list.
- The fixture exists, captured from today's unmodified writer; the temporary capture test is deleted.
- `tsc` shows no error in your file; `prettier --check` passes.

## Report

Write it as your final message: the files you made; the full difference list of each of the four tests, verbatim; any seed row you could not make and why; how you classified each non-`"compare"` column (one line per table); tests run with results.
