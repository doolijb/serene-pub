# BRIEF cv-writers-w2 — greetings and notes both ways in card files; the library, applet, likeness and persona writers onto card versions

Worker (lane-worker, Sonnet) for lane **cv-writers** (supervisor: Opus). App root `/home/jody/github/serene-pub`. Today is 2026-11-05.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Other lanes (cv-time, cv-member) and another worker (w1, who owns `sockets/characters.ts` and `sockets/import.ts`) are editing beside you right now. Edit ONLY the files under **Files owned**.

## Background (read; do not re-derive)

A card's content now lives on its **card versions** (table `character_versions`; `card_id`, `number` unique per card, `label`; the **current** version is the highest number). Each holds one 🚧 **character profile** (`CharacterProfileV1`, `src/lib/shared/characters/profile.ts`): name, nickname, aliases, summary, description, personality, scenario, **greetings** `{text, groupOnly?}[]`, exampleDialogues `string[]`, postHistoryInstructions, **creatorNotes** `{text, lang?, variants}`, strokes, faceMediaId, likeness, timbre, spriteSet, extensions.

The `characters` row's **content columns are frozen** (plan §32 §8): only the versions module writes them (four ⏳ copies of the current version: `name`, `nickname`, `avatar_media_id`, `description`). Library facts stay on `characters` and are written as today: tags, folder, favourite, persona flags, creator, category, source, uuid, lorebookId, metadata, embedding columns. The plugin **provided mark** (`extensions.serenepub.provided`) is ownership metadata: it stays on `characters.extensions`, read and written as today. **Never write any other `characters` content column** (name, nickname, aliases, summary, description, personality, scenario, firstMessage, alternateGreetings, groupOnlyGreetings, exampleDialogues, postHistoryInstructions, creatorNotes, creatorNotesMultilingual, strokes, avatarMediaId, extensions' likeness/timbre, characterVersion) — write the version. Read card content from the current version, not the row.

### The writer you call — `src/lib/server/characters/versions.ts` (read; do NOT edit)
Every function takes its handle first and never opens a transaction.
- `insertCard(tx, values, {writtenBy?})` → `{card, version}` (the row + its v1, made from the row).
- `ensureCardVersion(tx, cardId)` → the current version row (lazily writes v1; null when no card).
- `newCardVersion(tx, cardId, profile, {label?, writtenBy?})` → number + 1; label given (even null) or the suggestion.
- `updateCardVersion(tx, versionId, changes: Partial<CharacterProfileV1>)` → writes the given fields in place; the ⏳ copies when it is the current version.
- `cardProfileOf(cardRow)`; `profileOf(versionRow)` (shared).

### The contract your supervisor wrote — `src/lib/server/characters/cardIO.ts` bottom section (you own cardIO.ts, but **do not change** the functions in that bottom section without asking in your report; you may add to the file)
`CARD_CONTENT_COLUMNS`, `cardColumnsOfProfile(profile)`, `cardAsOfVersion(row, version)`, `profileOfCardColumns(columns)`, `creatorNotesOfCard(text, multilingual)` (keeps the main note's `lang`), `cardNotesColumns(notes)`.

### The format rules (plan §32 §2 with the §33.1 delta, owner rulings 2026-11-05) — quoted
- Owner: _"Reconcile what we have for character cards. API should start with the same shape, can update both with what's best. We should also make sure we merge together any fields where there's an arbitrary duplicate like greeting and additional greetings."_
- **Greetings import.** Unmarked greetings are `[first_mes, ...alternate_greetings]` — an empty `first_mes` is skipped (today's `buildCharacterFirstSessionMessage`), **empty alternates are kept** (today's swipes). `group_only_greetings` become marked greetings; both the spec location (`data.group_only_greetings`) and `data.extensions.group_only_greetings` are read (spec first). (This half already exists: `characterFieldsFromParsedData` in `sockets/characters.ts` + `mergeGreetings`.)
- **Greetings export.** The first unmarked greeting becomes `first_mes`, the other unmarked ones `alternate_greetings`, the marked ones `data.group_only_greetings` (the V3 spec location). Today the export writes them only under `extensions` (`characterCardParser.ts` ~1176–1180), so it **keeps a ⏳ copy there**. The import puts unmarked greetings first, so a round trip is stable.
- **Notes.** In: `text` = `creator_notes`; `variants` = the multilingual map minus the entry identical to `text`, whose key becomes `lang`. Out: both fields — `creator_notes` and `creator_notes_multilingual` (the main note under its `lang`, plus the variants). Today's export drops the multilingual notes (~1208). CHARX goes through the same builder.

### Rules (CLAUDE.md, quoted; they bind you)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." `handleCharacterAvatarUpload` uses the global db: never inside a transaction.
- "Never add a top-level `await` to `src/lib/server/db/index.ts`." Keep modules a test mocks importing the db the way they do today.
- "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." You add no migration; if you think you need one, stop and say so.
- "Removing or renaming a published SDK name is the owner's call" — ruled for `update-character@1`: **"New names now, old removed"** (owner, 2026-11-05). The SDK contract itself changes in wave 3 (V-sdk); you change only the app side.
- It is a **session**, never a chat. Every session has a lorebook — never write "no book". List every new user-facing sentence verbatim in your report.

## Files owned
- `src/lib/server/utils/characterCardParser.ts` (the export builder)
- `src/lib/server/characters/cardIO.ts` (not its bottom contract section — see above)
- `src/lib/server/sprites/charx.ts` (only if needed)
- `src/lib/server/library/writes.ts`
- `src/lib/server/sockets/appletLibrary.ts`
- `src/lib/server/sockets/portrait.ts` (`charactersSetLikenessImage`)
- `src/lib/server/utils/personaCard.ts`
- Tests: existing `utils/characterCardParser*.test.ts`, `characters/cardIO.int.test.ts`, `sprites/charx.int.test.ts`, `library/writes.int.test.ts`, `sockets/appletLibrary.int.test.ts`, `characters/portrait.int.test.ts` (if it covers the likeness socket), `utils/personaCard.int.test.ts`; and NEW `src/lib/server/utils/characterCardParser.profile.test.ts` (pure round trips) and, if a DB is needed for CHARX, `src/lib/server/sprites/charx.profile.int.test.ts`.

## Files readable (never edit)
`characters/versions.ts`, `shared/characters/profile.ts`, `sockets/characters.ts` (w1 is editing it; import `characterFieldsFromParsedData` from it in tests only), `sessions/greetings.ts`, `characters/likeness.ts`, `characters/timbre.ts`, `shared/sockets/types.ts`, `../serene-pub-sdk/contracts/src/outlets.ts` (the `update-character@1` contract, ~2062–2087).

## Out of scope
The client; `sockets/characters.ts` / `sockets/import.ts` (w1); `plugins/providedBooks.ts`, `plugins/providedPrimers.ts`, `lorebooks/starterKits.ts` (a later worker); the SDK contract; member writes; NOMENCLATURE (your supervisor writes the §25 rows — list any term you think needs one).

## Items

### 1. The export builder (`buildCharacterCardV3`, `characterCardParser.ts` ~1116–1224)
- `CharacterCardV3Input` gains `creatorNotesMultilingual?: Record<string, string> | null`.
- `data.group_only_greetings` when non-empty (spec location) **and** the ⏳ `extensions.group_only_greetings` copy (keep today's).
- `data.creator_notes_multilingual` when non-empty.
- Callers feed it `cardAsOfVersion(row, current)` columns (w1 does the socket callers), so the greetings arrive already split. Keep empty alternates as they are.
- `utils/lorebookExportBuilder.ts` is NOT yours — it still passes the raw row; list it in your report.

### 2. The import plan (`planCardImport`, `cardIO.ts`)
Drop `group_only_greetings` from the foreign extensions it keeps (it is read into the greetings, and the export rebuilds the key) — so the profile's `extensions` never holds a duplicate of the greetings. Nothing else in the import changes.

### 3. CHARX
Confirm `buildCharx` writes the card the builder made (no second mapping); change nothing unless it maps greetings or notes itself.

### 4. Round-trip tests — NEW `utils/characterCardParser.profile.test.ts` (pure where possible)
Reader path: `parseCharacterCard(bytes)` → `getRobustSpecV3Data(card)` → `characterFieldsFromParsedData(data)` (import it from `$lib/server/sockets/characters`; if importing that module drags the db in and the test can't mock it cheaply, say so and test at `profileOfCardColumns` over hand-built columns instead) → `profileOfCardColumns(...)`. Writer path: `cardColumnsOfProfile(profile)` → `buildCharacterCardV3({...columns, uuid, ...})`. Cases:
- a **V2** JSON card (`spec: "chara_card_v2"`), a **V3** JSON card, and a PNG with a `chara` chunk, each with `first_mes` "Hi", `alternate_greetings` `["Hello", ""]` (the empty one kept), `group_only_greetings` in `data` for V3 and only in `extensions` for V2 → profile greetings `[{text:"Hi"},{text:"Hello"},{text:""},{text:"G",groupOnly:true}]`; exported again → `first_mes`, `alternate_greetings`, `data.group_only_greetings` and the ⏳ extensions copy; read again → the same profile (stable);
- an empty `first_mes` with alternates `["A", ""]` → `[A, ""]` (stable on a second round);
- notes: `creator_notes` "Hello", `creator_notes_multilingual` `{ en: "Hello", fr: "Bonjour" }` → `{ text: "Hello", lang: "en", variants: { fr: "Bonjour" } }`; exported → `creator_notes_multilingual` still has `en` and `fr`;
- `extensions.group_only_greetings` is not in the profile's `extensions`;
- **CHARX**: `buildCharx` then `parseCharacterCard` of the zip gives the same profile (DB test if `buildCharx` needs one; follow `sprites/charx.int.test.ts`; 60 s timeouts on any `it` that opens a DB).

### 5. `library/writes.ts` — the `update-character` / `create-character` library writes
- `CHARACTER_CHANGE_FIELDS` become the profile names: `name`, `description`, `personality`, `scenario`, `greetings`, `exampleDialogues`; `first_mes` / `mes_example` removed (owner: "New names now, old removed"). `changesOf` judges each by the profile's types: text (name non-empty) for the four text fields; `greetings` an array of `{ text: string, groupOnly?: boolean }`; `exampleDialogues` an array of strings. Refusal sentences in today's style; list them.
- `writeCardFields` writes the card's **current version** (`ensureCardVersion` + `updateCardVersion`), in a transaction if it writes more than one statement; the strokes rule (`applyStrokesToCard`) runs over the version's description/personality as today; the embedding clear on `characters` stays (library column) when the current name or description moved.
- `cardFieldsOf` reads the current version's profile.
- **Stored rows:** `state_proposals` rows already written carry `before.fields` / `input.changes` with `first_mes` / `mes_example`. Back (undo) and Forward (redo) of such a stored row map them ⏳ (`first_mes` → the opener of `greetings`: replace the first unmarked greeting, or insert one first; `mes_example` → `exampleDialogues` split on `<START>`), so Back keeps working on data already in users' hands. A NEW request with the old names refuses with the "not a field" sentence.
- `create-character` keeps calling `createCharacterFromParsedData` (w1 moves it onto `insertCard`); `cardDataOf` unchanged.

### 6. `sockets/appletLibrary.ts`
- `runUpdateCharacter`: reads name/description from the current version; writes through `updateCardVersion` on the current version (`firstMessage` → the greetings' opener, as in item 5's mapping); the embedding clear and the provided-mark ownership check as today (the mark is read from `characters.extensions`). The reply/push as today.
- `runLibraryCharacters` reads `name` and `avatarMediaId` — ⏳ copies; leave it.

### 7. `sockets/portrait.ts` `charactersSetLikenessImage`
The likeness lives on the current version: read it from the version (`profileOf(current).likeness`), write `updateCardVersion(db, current.id, { likeness: { ...stored, imageMediaId } })`. No direct `characters` write.

### 8. `utils/personaCard.ts`
- `createPersonaFromParsedData`: `insertCard` (inside the given handle; no transaction of your own if `dbOrTx` may already be one); the likeness via the insert's `extensions` as today (it becomes v1's likeness).
- `overwritePersonaFromParsedData`: an import must not overwrite in place (owner, card import: "overwrite in place goes") → it adds a **new version**: the current version's profile with the persona card's fields laid over (name, description, aliases, summary; likeness when the file carries one), `newCardVersion(dbOrTx, id, profile)` (suggested label); `creator`/`category` on `characters` (library facts). Keep the function name and signature (`sockets/lorebooks.ts`, another lane's, calls it).
- `applyPersonaAvatar`: after the upload, set the face on the current version (`updateCardVersion(dbOrTx, current.id, { faceMediaId })`).
- The persona export (`buildPersonaExportCard`, if it reads content columns from a row it is handed): leave the signature; say in your report where it is fed from.

### 9. Tests for items 5–8
Extend the owned int tests: an `update-character` library write lands on the current version (not on the row's frozen columns) and Back restores it; a stored row with `first_mes` in `before.fields` still undoes; a new request with `first_mes` refuses; the applet update writes the current version; set-likeness-image writes the version; a persona create makes v1 and a persona overwrite adds v2 (v1 untouched). Fix existing assertions in your owned tests that read a frozen column after a write — list each.

## Done means
These pass (`npx vitest run <files> --maxWorkers=4`; never pipe vitest into `head`): the new `characterCardParser.profile.test.ts` (and `charx.profile.int.test.ts` if made), `utils/characterCardParser*.test.ts`, `characters/cardIO.int.test.ts`, `sprites/charx.int.test.ts`, `library/writes.int.test.ts`, `sockets/appletLibrary.int.test.ts`, `characters/portrait.int.test.ts`, `utils/personaCard.int.test.ts`. `npx tsc --noEmit -p .` shows no error in your files (the old `arrangeCanvas.dom` error is known). `npx prettier --check` on your files: say which were not clean before; format only your hunks.

## Stop and ask (in your report; stop that item) when
A new name beyond those above; a migration; a change to a file you don't own; a test failing for a reason outside your files; any user-visible behaviour not stated here (★).

## Report
Write `plans/REPORT-cv-writers-w2-2026-11-05.md`: names and signatures first; changed files; tests run with counts; every new sentence verbatim; open questions; Noticed, not done. Then end.
