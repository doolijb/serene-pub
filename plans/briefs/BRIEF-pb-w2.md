# BRIEF pb-w2 — a provided book's upgrade carries its cast, bindings and stat values

Supervisor: lane **pb** (`plans/briefs/BRIEF-pb.md`, re-scoped by the lead 2026-11-05). You are a `lane-worker` (Sonnet). Work from `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`. Lane bf may run one meanwhile: if a test fails with an SDK dist import error, wait a minute and re-run.)

## Goal
Owner ruling 2026-11-05 (plan §24.10): a provided book re-imports when its shipped file changes. Lane pb-w1 already made a changed file at the same version take `upgrade()` (`src/lib/server/plugins/providedBooks.ts`). The gap: `upgrade()` diffs only `lorebook_entries`. A provided book's **cast** (embedded characters, `extensions.serenepub.characters`), its **bindings** (`extensions.serenepub.bindings`) and its **stat values** (`extensions.serenepub.stats.values`, format 2) never reach a book already installed. Seen live: the Mundi port added an Age value to every cast member of Porto Alto (`/home/jody/github/mundi-sp/assets/books/modern.lorebook.json`, read-only); a fresh pub got them, an older pub never did.

Carry them in `upgrade()` under the **existing "the person wins" rule**, per item: an item the person changed keeps theirs; an untouched item that changed upstream is updated; an item new upstream is added; an item gone upstream is left alone; a person's row is never deleted. All of it only under the book's write mode `full` (the existing Review/Off branch returns before any write and records `held` — leave that as is: Review/Off writes no cast or stats either).

## Design (decided by the supervisor — build this; deviations go in your report as questions, not code)

### Stored baselines (the mark is JSON; no migration)
`ProvidedBookMark` (`src/lib/server/plugins/providedMarks.ts`) gains two optional fields, beside `entries` and following its pattern:
- `cast?: Record<string, ProvidedCastMark>` — `ProvidedCastMark = { binding: number; character: number | null; hash: string; up: string }`.
- `stats?: Record<string, ProvidedStatMark>` — `ProvidedStatMark = { id: number; hash: string; up: string }`.
`hash` = what the row holds now (changes when a person edits it); `up` = the file's item that was written. `markedBook()` builds the mark field by field, so it MUST carry `cast` / `stats` through when they are objects (otherwise every save drops them). Doc comments in the file's voice.

### Cast identity (a stable key per file binding, like `fileEntriesOf`)
For each file binding (`serenepub.bindings[]`), find its embedded card (`characterLocalId` → `serenepub.characters[].localId` → `.card.data`). Key: `u:<uuid>` when `extractCharacterUuid(cardData)` (`sockets/characters.ts:881`) gives one; else `n:<card data.name trimmed>`; a binding with no card: `t:<bindingText>`; suffix `#1`, `#2` … when two share one (as `fileEntriesOf` does). Personas (`personaLocalId`) are out of scope: skip them and count them in your report.
- **cast hash** (now) = `hashCanonicalJson({ card: comparisonData, spriteSet, ownName, ownNickname })` — `comparisonData` from `buildExistingCharacterComparisonData(characterId, tx)` (`sockets/characters.ts:1158`), the binding row's three columns.
- **cast up** (file) = `hashCanonicalJson({ card: <card data without character_book>, spriteSet, ownName, ownNickname })` with the binding's three values read from the file exactly as `restoreBoundEntities` reads them (`sockets/lorebooks.ts` ~2690–2715: trimmed, length-capped by `LOREBOOK_IMPORT_LIMITS.maxNameChars`, `ownName` empty → null, `ownNickname` keeps `""`; null when no card). This is the same equality `matchEmbeddedCharacter` (~2890) uses for "unchanged", so `hash === up` means "the row holds exactly the file's item".

### `upgrade()` under `full`, inside its existing transaction (use only `tx`)
1. **Cast** — for each file binding key:
   - **known** in `mark.cast`: binding row gone → the person removed it, leave it. `hash(now) !== known.hash` → kept (`report.keptEdited++`). `known.up === up` → nothing. Else rewrite: `overwriteCharacterFromParsedData(known.character, cardData, undefined, adminId, tx)` (`sockets/characters.ts:1103`; check it keeps the existing avatar when `avatarBuffer` is undefined — say so in the report) and set the binding row's `spriteSet`/`ownName`/`ownNickname`; record the new hash.
   - **not known** (a book imported before this change has no `cast` map): find the book's existing binding by key — a binding whose character carries this plugin's provided mark (`markedCharacter`, `providedMarks.ts`) for this slug and whose name / uuid matches the key; a `t:` key matches the binding's `binding` text. Found and `hash === up` → record the baseline only. Found and different → **kept as the person's** (no baseline known; `report.keptEdited++`; record nothing, so it stays the person's). Not found → **new cast member**: `createCharacterFromParsedData(cardData, undefined, adminId, tx)` (`sockets/characters.ts:1054`), stamp the provided character mark exactly as `markBroughtCharacters` does (reuse it or factor its stamp out — inside `providedBooks.ts`), insert the `lorebook_bindings` row with `deriveNextBindingToken(book.id, tx)` (`utils/lorebookBindingToken.ts:31`) and the three columns, record the baseline; after the transaction commits, `syncLorebookBindingsForCharacter(characterId)` (`utils/characterBindingSync.ts:87`) for each new card (the importer's `afterImportCommit` does the same, ~4159).
   - Build `bindingLocalIdToRealId` (file `localId` → binding row id) for every file binding matched or created; the stats step uses it.
2. **Stat values** — `importedStatRows(serenepub, maps)` (`utils/lorebookImportMapper.ts:1132`) with: `lorebookId`, the cast map from step 1, `entryLocalIdToRealId` from this book's mark (find how the importer numbers an entry's local id — `insertLorebookEntries` / `RestoredEntryRefs` in `sockets/lorebooks.ts` — and build the same map from `fileEntriesOf` + the entry marks; if it can't be built reliably, leave `location` values out and say so), **empty** history/scene maps, `entryTypeIdByRealId` from the book's rows, `singleRefEntryTypes` as the importer's `singleRefEntryTypesOf` (copy its 4 lines if not exported). **Before** that, drop every file value whose `historyEntryLocalId` or `sceneLocalId` is a number (dated values are out of scope; empty maps would otherwise land them undated). Configs (`stats.configs`) are out of scope.
   - Key: `<ownerKind>|<owner key>|<slotId>` — owner key `book` for `lorebook`, the cast key for `cast_member`, the entry's mark key for `location`.
   - stat hash (now) = `hashCanonicalJson({ value: row.value, note: row.note })`; up = the same over the file row as `importedStatRows` maps it.
   - The live row: `attribute_values` where `ownerKind`, `ownerId`, `slotId` match and `sessionId`, `branchId`, `historyEntryId`, `sceneId`, `validFromMessageId` are all null (the template layer, on main). Check the table's columns and unique index in `src/lib/server/db/schema.ts` (~9771) and match them.
   - **known**: row gone → leave it. `hash(now) !== known.hash` → kept (`keptEdited++`). `known.up === up` → nothing. Else update `value`, `note` (and `updatedBy` from the file) and record the new hash.
   - **not known**: a live row with `hash === up` → baseline only; a live row that differs → kept as the person's, nothing recorded; no row → insert it (the importer's `insertImportedStats` shape, ~3205), record the baseline.
3. Count every cast/stat write into the existing `written` (so `queueImportedBook` runs) and save `cast` / `stats` in the mark the transaction already writes. Items gone upstream: leave them (add their count to `report.goneUpstream`).

### `importFresh()` records the baselines
After `importLorebookDocument`, compute the same keys against what landed (bindings of the book + their characters; template stat rows) and write `cast` / `stats` into the mark it already writes, so the next upgrade has baselines. Share one helper between fresh and upgrade for "the file's cast and stat items with keys and up-hashes" and one for "the live row and its now-hash" — inside `providedBooks.ts`.

### Second sync writes nothing
After any upgrade, a sync with nothing changed must write nothing (the same-file return covers it; your tests assert it anyway).

## Tests — append ONE `describe` at the end of `src/lib/server/plugins/providedBooks.int.test.ts`
Reuse its helpers (`seedPlugin`, `putFile`, `grant`, `bump`, `provided`, `entriesOf`). Build a fixture book file in format 2 with `extensions.serenepub` (`formatVersion: 2`, `characters`, `bindings`, `stats: { configs: [], values: [...] }`) — copy the shape from `/home/jody/github/mundi-sp/assets/books/modern.lorebook.json` (read it with a short `python3 -I` or `node -e` print, never edit it) and from an existing import int test (`src/lib/server/sockets/lorebooks.import-export.int.test.ts`). Use any slot id string (`test:slot/age@1`), cast_member and lorebook owners. Every `test(...)` takes `60_000`; set the book's `loreWriteMode` to `"full"` as the existing Full test does. Cases:
1. **Fresh import records baselines**: the mark has `cast` with one key per member and `stats` with one key per value.
2. **Upgrade (same version, changed file) under Full**: member A's card description changed upstream and untouched → updated; member B's card edited by the person in the DB AND changed upstream → the person's kept; new member C (card + binding) → added, its card carries the provided mark, its binding has a `{{char:N}}` tag and a name after sync; A's value changed upstream, untouched → updated; B's value edited by the person → kept; a new value for B (the "Age" case) → inserted; a value gone upstream → still there.
3. **A book imported before this change** (delete `cast` and `stats` from the mark after the fresh import, as an old pub's book would be): the upgrade adds the new member and the new values, keeps a value that differs (no baseline), and records baselines for matches.
4. **Second sync writes nothing**: snapshot book row, entries, bindings, the cast's character rows, template attribute rows and the plugin row's `provided`; sync again; all deep-equal.
5. **Review**: a changed file writes no binding, character or attribute row.
Keep every existing test as it is.

## Files owned (edit only these)
- `src/lib/server/plugins/providedBooks.ts`
- `src/lib/server/plugins/providedMarks.ts` (additive: the two types, `markedBook` carrying them)
- `src/lib/server/plugins/providedBooks.int.test.ts` (append only)
All are dirty at HEAD and other programmes edit this tree: re-read the exact region immediately before each edit, additive hunks, never reformat, never `prettier --write`.

## Files readable (never edit)
`src/lib/server/sockets/lorebooks.ts` and `src/lib/server/utils/lorebookExportBuilder.ts` (lane bf is editing them now — read only; if something you need there isn't exported, copy no more than a few pure lines into `providedBooks.ts` and name it in your report; anything bigger, stop and report), `sockets/characters.ts`, `utils/characterBindingSync.ts`, `utils/lorebookImportMapper.ts`, `utils/lorebookBindingToken.ts`, `db/schema.ts`, `providedPrimers.ts`.

## Out of scope — never built
No SDK edit; no migration or schema change; no edit outside the three files; personas, stat configs, dated stat values, the narrative graph, the book's rules field (lane bf's; a later step), the plugin page text (`providedBooksOf`), docs, NOMENCLATURE. Findings go under **Noticed, not done**.

## Rules you work under (quoted)
- CLAUDE.md P2: "A module owns its data and every write to it; peers use its contract … never its tables or internals. Two writers of one thing is a bug." The importer (`insertImportedStats`, `restoreBoundEntities`) already writes these tables directly on import; the upgrade follows the same import path's pattern, reusing exported functions (`createCharacterFromParsedData`, `overwriteCharacterFromParsedData`, `importedStatRows`, `deriveNextBindingToken`, `syncLorebookBindingsForCharacter`) rather than re-implementing them.
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'." · "Say each assumption when you make it."
- CLAUDE.md standing ruling: "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." (The new mark fields are optional and filled on the next import/upgrade; test 4 is that test.)
- Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." (Pass `tx` to every helper that takes `dbOrTx`; call `syncLorebookBindingsForCharacter` only after the transaction.) "Never seed a row at a hardcoded id." "`$state(new Set())` …" does not apply (server).
- NOMENCLATURE R1 one word, one meaning; R3 qualify, never the bare noun. Name in comments: **cast member**, **binding**, **stat value**; the file's hash is "the file's sha256", never "content hash" (§5 owns that).
- Tests: targeted files only. "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load."

## Done means
Run each on its own, never piped into `head`:
- `npx vitest run src/lib/server/plugins/providedBooks.int.test.ts` — all green except the one known pre-existing failure ("M2e: … delete is refused …", line ~161, `provided` now also has `pluginName` — another programme's change; leave it).
- `npx vitest run src/lib/server/plugins/providedBooksPubWide.int.test.ts`
- `npx vitest run src/lib/server/plugins/providedPrimers.int.test.ts`
- `npx tsc --noEmit -p . 2>&1 | grep -E "plugins/provided"` shows nothing.
Remove any `/tmp/serene-pub-vitest-*` dir your runs left, by exact name (list before and after).

## Report
`plans/REPORT-pb-w2-2026-11-05.md`: changed files with hunk line ranges, each assumption, what you copied from where, the avatar check, the entry local-id finding, personas skipped count, tests with pass/fail counts, Noticed-not-done.
