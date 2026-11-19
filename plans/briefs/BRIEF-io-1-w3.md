# BRIEF io-1-w3 — the round-trip test, part 3: a realistic seed and classified allowances

Repo `/home/jody/github/serene-pub`. Supervisor: lane `io-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

Formatting: hand-format, or check with `npx prettier --check`. Do not write prettier's output over any file (not even through a scratch copy), so no file is ever reformatted wholesale.

## Context

`src/lib/server/sockets/lorebooks.roundTrip.int.test.ts` (workers w1, w2; read it whole) seeds a book (`seedRoundTripBook`, frozen: the fixture was exported from it; then `extendSeed`), compares books after export → import as new, duplicate, overwrite and an old file, and asserts each difference list against `ROUND_TRIP_ALLOWED`, `DUPLICATE_ALLOWED`, `OVERWRITE_ALLOWED`, `OLD_FILE_ALLOWED`, all reasoned `"measured 2026-11-16, unclassified"`. Last run: `plans/io-1-w2-4.log`. Still **no production code changes** in this phase.

## Files owned

- `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`
- logs `plans/io-1-w3-*`

Never edit the fixture `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json` or `seedRoundTripBook`'s writes.

## Build

### 1. `extendSeed` realism (these differences are the seed's, not the app's)

- The link with `status: "ended"`: `ended` is not a status (`RELATIONSHIP_STATUSES` in `src/lib/shared/lorebooks/linkVocabulary.ts`: active, resolved, broken, evolved). Use `resolved`.
- Dragon rumour: `useRegex: true` beside `matchMode: "word"` is a stale legacy flag (the matcher reads `matchMode` first: `readsAsRegex`, `src/lib/shared/entries/runawayPattern.ts`). Make it consistent: `matchMode: "regex"`, `useRegex: true`, keys that are valid patterns.
- `rulesetVersion: "1.0.0"`: the importer keeps a version only when this pub keeps it (`importedBookRules`, `sockets/lorebooks.ts` ~5095). Set it to the version the pub actually has for that ruleset (read it the way `importedBookRules` does).
- Rook, the card-less member: a card-less member has no own name, own nickname or retold flags (`memberColumnsOfVersion`, `src/lib/server/lorebooks/retold.ts` ~236: `ownName`/`ownNickname`/`retold` only when carded), and its row and base version must agree (the base version is authoritative; the export reads the base). Make Rook through `insertCastMember` (`$lib/server/characters/versions`) with his profile (name, nickname, description, personality, scenario, greetings, example dialogues, timbre, face, node state and visibility, post-history instructions, creator notes) on his base version, the row agreeing.
- Give the **carded** member (Maren) what only a carded member has: an own name and own nickname, and retold fields (her base version with `follows` missing some fields, those fields holding her own text: description, personality, scenario), through the app's writer if one exists (`writeMemberEdit` / `insertCastMember`), keeping row and base version in agreement.
- Snapshot: `binding_suggestions.exampleSourceId` names an entry when `exampleSourceKind === "entry"`; label it through the entry labels then (the duplicate already remaps it: `tableRegistry.ts` ~1097). Raw otherwise.

### 2. Classify every allowance

Replace each `"measured 2026-11-16, unclassified"` with one of these reasons (put them in `const`s and reference them). Group a family of differences under one allowance where one pattern covers it cleanly (e.g. every `missing in b` row labelled on a line, `@North road` / `@Ambush`); keep patterns free of ids.

**By design** (text to use verbatim as the reason):
- `D_LINES` — "by design: a file carries main only — docs/lorebooks.md 'it lists what the file can't bring back (such as branches, dated changes and scenes captured from sessions)'; lorebookExportBuilder.ts header. ★ owner: the programme asks to carry lines". Covers: `lorebook_branches` rows and every row on a line (entries, history days, scenes and their cast, links, versions, presences, stats), and the consequences on main: an entry's `position` within its type shifting because a line's entry of that type is not in the file.
- `D_DATED` — "by design: dated changes stay with the book — docs/lorebooks.md 'such as branches, dated changes …'; counted by overwriteLosses (amendments, presences)". Covers: `entry_amendments`, `cast_amendments`, dated `character_versions` (a year or a life point), `cast_presences`, and `character_versions.writeOrder` / `retiredOrder` rank shifts that follow from them.
- `D_EDIT_HISTORY` — "by design: docs/lorebooks.md 'The edit history belongs to the lorebook and never travels: … a lorebook file carr[ies] none'". Covers `lore_redlines`.
- `D_MERGE_UNDO` — "by design: a merge's undo record is the original's (tableRegistry.ts bindingMergeLogs: 'an undo record of the original's rows'; docs/lorebooks.md 'the undo of a past merge stays with the original')". Covers `binding_merge_logs` (and, on overwrite, the kept log whose survivor went with the cast: tableRegistry.ts 'Not purged by an overwrite either').
- `D_INDEXING` — "by design: derived; docs/lorebooks.md 'An imported book is queued for search indexing straight away.'" Covers `lorebook_entry_vectors`, `entry_annotations`.
- `D_SHEETS` — "by design: overwriteLosses statsNoFileCarries — 'every stat sheet assigned to the book … that no file carries, whatever its format'". Covers `owner_sheets`.
- `D_NEW_BOOK` — "by design: docs/lorebooks.md 'It always makes a new book'". Covers `lorebooks.kind` (`starter_kit` → `book`).
- `D_IMPORTER_WRITES` — "by design: the import writes each member's base version as the importing person (writtenBy user:N)". Covers `character_versions.writtenBy`.
- `D_ST_MIRROR` — "by design: the file's SillyTavern mirror keys are re-derived from the row on every export (lorebookExportMapper.ts mapEntry: 'The row is authoritative'); the import keeps the entry's whole foreign bag". Covers an entry's `extraJson` gaining `match_whole_words` / `selectiveLogic`.
- `D_DUP_SCENE` — "by design: a copy has no session (docs/lorebooks.md 'Scenes in the copy keep their summaries but not the session messages they were captured from'; tableRegistry.ts scenes '★4b: … custom from here on')". Covers, on duplicate, `scenes.selectedMessageIds` and `nameIsDefault`.
- `D_HELD` — "by design: a held amendment is one session's own change on another book's entry: a copy never carries it (tableRegistry.ts entryAmendments)". Covers the `entry_amendments` row with `base` set, on duplicate (and on the file paths, where `D_DATED` also covers it — use whichever matches).
- `D_FROZEN_SEED` (old-file test only) — "the frozen base seed's own artefact, not a loss: provenance 'model' is not one this app writes (ENTRY_PROVENANCES); scene cast is numbered per role (writeSceneCast)".

**Unclear, left for the owner** (reason prefix `★ unclear:`):
- `U_IMAGES` — "★ unclear: images are not in the file (cover, a member's face, sprite sets and sprites, gallery files)".
- `U_TAGS` — "★ unclear: tags are not in the file".
- `U_WRITE_MODE` — "★ unclear: the book's Writes from sessions (loreWriteMode) is not in the file".
- `U_ANNEX` — "★ unclear: the annex is not in the file".
- `U_UNFILED_SCENE` — "★ unclear: an unfiled scene goes out under a synthetic empty history entry (lorebookExportBuilder.ts §0-B), which the import writes as a real history day; its opened story clock is not in the file". Covers the extra empty history entry and the scene's `historyEntryId` / `openedStoryClock*` differences.
- `U_DERIVED_FROM` — "★ unclear: an entry's library origin (derivedFrom) is not in the file".
- `U_DISMISSED_SUGGESTIONS` — "★ unclear: dismissed duplicate pairs and binding suggestions are not in the file".
- `U_RULES_RUN` — "★ unclear: a link's rules run (rulesRunId) is not in the file".

**Lost, to be fixed in the next phase** (reason `L_PENDING` — "lost: fixed by io-1-w4; this allowance goes then"):
- member `aliases` on a carded member (row and base version);
- a member's sheet: description, personality, scenario, first message / greetings, example dialogues, timbre, nickname, post-history instructions, creator notes, and a carded member's retold fields (row and base version);
- anything else the realistic seed now shows that none of the reasons above covers: give it `L_PENDING` **and list it in your report** so the supervisor can classify it.

If a difference fits none of the reasons and is not plainly a loss, leave it `"measured 2026-11-16, unclassified"` and list it.

## Rules you must follow (quoted from CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- "It is a **session**, never a *chat*."
- "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs."

## Running tests

One run at a time, after waiting for other lanes' runs (note the brackets: an unbracketed pattern matches the waiting shell itself):

```
until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "[s]dk:build" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/lorebooks.roundTrip.int.test.ts > plans/io-1-w3-<n>.log 2>&1"
```

Type-check with `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`, filtered to your file.

## Stop and ask when

A seed value needs production code; a difference's classification is not obvious (list it). CLAUDE.md §Decisions applies.

## Done means

All tests in the file green; every allowance carries one of the reasons above (or is listed as unclassified in your report); `tsc` clean for the file; `prettier --check` passes; fixture untouched.

## Report

Final message: each test's difference list after the realistic seed, verbatim, each line with the reason constant that covers it; every `L_PENDING` and unclassified line called out; tests run with results.
