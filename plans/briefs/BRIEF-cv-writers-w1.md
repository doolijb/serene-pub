# BRIEF cv-writers-w1 — the card editor, card import/export and the card creation sites in the two socket files

Worker (lane-worker, Sonnet) for lane **cv-writers** (supervisor: Opus). App root `/home/jody/github/serene-pub`. Today is 2026-11-05.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Other lanes (cv-time, cv-member) and another worker (w2) are editing files beside you right now. Edit ONLY the files under **Files owned**.

## Background (read; do not re-derive)

A card's content now lives on its **card versions** (table `character_versions`; a card version has `card_id`, `number` unique per card, `label`; the **current** version is the highest `number`). Each version holds one 🚧 **character profile** (`CharacterProfileV1`, `src/lib/shared/characters/profile.ts`): name, nickname, aliases, summary, description, personality, scenario, **greetings** `{text, groupOnly?}[]` (merged opener + alternates + group-only), exampleDialogues, postHistoryInstructions, **creatorNotes** `{text, lang?, variants}`, strokes, faceMediaId, likeness, timbre, spriteSet, extensions. Cast members (book people) have cast versions whose `follows[]` names fields read from a parent card version.

The `characters` row's **content columns are frozen** (plan §32 §8): only the versions module writes them, and only four ⏳ copies of the current version (`name`, `nickname`, `avatar_media_id`, `description`). Library facts stay on `characters` and are written as today: tags, folder, favourite, persona flags, default persona, creator, category, source, uuid, lorebookId, metadata, embedding columns. **Never write a `characters` content column yourself** (name, nickname, aliases, summary, description, personality, scenario, firstMessage, alternateGreetings, groupOnlyGreetings, exampleDialogues, postHistoryInstructions, creatorNotes, creatorNotesMultilingual, strokes, avatarMediaId, extensions, characterVersion) except through an `insert` of a new card via `insertCard`. Read card content from the version, not the row.

### The writer you call — `src/lib/server/characters/versions.ts` (read it; do NOT edit it)
Every function takes its handle first and never opens a transaction; the caller owns it.
- `insertCard(tx, values, {writtenBy?})` → `{card, version}`: inserts the `characters` row and its **v1** (made from the row; label = `values.characterVersion` else "1.0").
- `ensureCardVersion(tx, cardId)` → the current version row (writes v1 lazily for a card that has none; null for no card).
- `newCardVersion(tx, cardId, profile, {label?, writtenBy?})` → new version, number + 1; label `opts.label` when given (even "" / null), else the suggestion `nextVersionLabel(current.label)`. Writes the ⏳ copies.
- `updateCardVersion(tx, versionId, changes: Partial<CharacterProfileV1>)` → writes the given profile fields in place on ANY card version; writes the ⏳ copies only when it is the current version. It cannot change a label.
- `resolveFollows(tx, {cardId?, castMemberId?}, {detach?})`.

### The contract your supervisor wrote — `src/lib/server/characters/cardIO.ts` bottom section (read it; do NOT edit it; ask in your report if it needs a change)
- `CARD_CONTENT_COLUMNS`, `CardContentColumns`, `CardContentColumn`.
- `cardColumnsOfProfile(profile)` → the content columns (greetings split by `legacyGreetingsOf`, notes into `creatorNotes` + `creatorNotesMultilingual` with the main note under its `lang`, likeness/timbre back under `extensions.serenepub`, face as `avatarMediaId`).
- `cardAsOfVersion(cardRow, versionRow)` → the row with the version's profile as content columns and `characterVersion` = the version's label. **This is how every read in your files shows a card.**
- `profileOfCardColumns(columns)` → the profile a save's or a file's columns hold (the notes read losslessly, keeping `lang`).
- `creatorNotesOfCard`, `cardNotesColumns`.
- Note: `insertCard` makes v1 through `cardProfileOf`, which drops the notes' `lang`. After any `insertCard` whose columns carry creator notes, fix it: `const notes = profileOfCardColumns(values).creatorNotes; if (notes?.lang) await updateCardVersion(tx, version.id, { creatorNotes: notes })`. Put that in ONE local helper in `sockets/characters.ts` (e.g. `insertCardFromColumns`) and export it for `import.ts`.

### Rules (quoted from CLAUDE.md and the plan; they bind you)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." Anything that uses the global `db` (e.g. `applyTimbreUpdate(..., {db})`, `handleCharacterAvatarUpload`, `setDefaultPersona`, `processCharacterTags` without a handle) runs before or after the transaction, never inside.
- "Never add a top-level `await` to `src/lib/server/db/index.ts`." No static `$lib/server/db` import into a module a test mocks differently than today.
- "A change to stored data or ids ships with a forward migration or boot pass" — you change no schema and add no migration. If you think you need one, stop and say so.
- Owner rulings (2026-11-05): card editing → **"Any version, with a picker"** (Save writes the chosen version in place; it reaches that version's followers); **Save as new version** inserts number + 1, label prefilled by bumping the last number; the editor then says _3 cast members stay on v1.0_, each a link; **no bulk update, no Undo**. Import: **"Hash compare, ask to add version or save as new card if there's a diff"**; compare against the **current version only**; identical → unchanged; different → **Add as a new version** (label: the file's `character_version`, else the suggestion) or **Save as a new card**; **overwrite in place goes**. **Export writes the current version.**
- It is a **session**, never a chat. Every session has a lorebook — never write "no book" in any sentence.
- New user-facing sentences: plain, short, no jargon. List every new sentence verbatim in your report.

## Files owned
- `src/lib/server/sockets/characters.ts`
- `src/lib/server/sockets/import.ts`
- Tests: the existing `src/lib/server/sockets/characters.*.test.ts`, `src/lib/server/sockets/import*.test.ts`, `src/lib/server/sockets/imports.hardening.int.test.ts` (only where they now assert frozen columns), and a NEW `src/lib/server/sockets/characters.versions.int.test.ts`.

## Files readable (never edit)
`characters/versions.ts`, `characters/cardIO.ts`, `shared/characters/profile.ts`, `shared/sockets/types.ts`, `utils/index.ts`, `utils/characterCardParser.ts`, `characters/dowry.ts`, `characters/likeness.ts`, `characters/timbre.ts`, `sockets/lorebooks.ts`, `plugins/providedBooks.ts`, the cv-core tests `characters/versions*.test.ts` (for fixtures).

## Out of scope (do not build)
The client (wave 3), `shared/sockets/types.ts` (NOT yours: declare the new params/response fields as **local intersection types** in `sockets/characters.ts`, e.g. `type UpdateParams = Sockets.Characters.Update.Params & { cardVersionId?: number; saveAsNewVersion?: { label?: string | null } }`, and list each addition in your report for the lead to add to `types.ts`), `versions.ts`, `cardIO.ts`, the parser's export mapping (w2 does it), `characterBindingSync.ts`, the Update-a-member action, member writes, label editing of an existing version.

## Items

### 1. Reads show a version
- `buildCharacterGet(userId, characterId, cardVersionId?)`: the character as `cardAsOfVersion(row, version)` where version = the given id when it is one of THIS card's versions, else the current (`ensureCardVersion(db, id)`). Add to the reply: `cardVersionId` (the shown one), `currentCardVersionId`, `cardVersions: { id, number, label }[]` (by number ascending). `charactersGet` passes `params.cardVersionId` (local param type).
- `characterForBroadcast`: the current version's overlay (`cardAsOfVersion`), avatar join as today (the avatar join reads `avatarMediaId`, a ⏳ copy — fine).
- `buildCharactersList`: overlay `summary` and `creatorNotes` (the text) from each listed card's current version — ONE extra query (e.g. `select distinct on (card_id) … order by card_id, number desc`) for the listed ids; a card with no version keeps its row values. Reads of `character_versions` from this file are allowed (reads, never writes).
- `buildExistingCharacterComparisonData(characterId, dbOrTx, opts)` (exported; also used by `sockets/lorebooks.ts` and `plugins/providedBooks.ts` — keep its signature and return shape): build from `cardAsOfVersion(row, current)`.

### 2. The editor save (`charactersUpdate`, ~606–832)
- Local params: `cardVersionId?: number` (the version to write; default the current), `saveAsNewVersion?: { label?: string | null }`. A `cardVersionId` that is not this card's version refuses: "That version isn't one of this character's." (through the existing error path).
- Split the sent `data` into content (keys in `CARD_CONTENT_COLUMNS`, plus `characterVersion` which is ignored for an in-place save — say so in your report) and library facts (everything else that today's code lets through).
- The chosen version's columns: `prior = cardAsOfVersion(storedRow, chosenVersion)`; `merged = { ...prior, ...sentContent }`. Apply today's likeness (`params.likeness`), timbre (`applyTimbreUpdate(merged.extensions, prior.extensions, …)`, before the transaction) and provided-mark (`keepStoredProvidedMark(merged.extensions, storedRow.extensions)`) rules to `merged.extensions`, and today's strokes rule with the chosen version's strokes as "stored". `profile = profileOfCardColumns(merged)` keeping the chosen version's `faceMediaId`.
- One `db.transaction` (tx only): in place → `updateCardVersion(tx, chosen.id, profile)`; Save as new version → `newCardVersion(tx, cardId, profile, { label })` where `label` is `saveAsNewVersion.label` when the key is present, else omitted (the writer suggests). Then the library-fact update on `characters` (+ `isPersona` when made default, + the embedding clear when the CURRENT version's name or description moved — compare the current version before vs after). Default persona, tags, avatar after the transaction as today.
- Avatar (`params.avatarFile`): `handleCharacterAvatarUpload` (it writes the ⏳ copy itself — leave that), then `updateCardVersion(db, written.id, { faceMediaId: created.file.id })`; when the written version is not the current one, re-write the copies from the current: `updateCardVersion(db, current.id, { faceMediaId: current.faceMediaId })`.
- Reply (local response type): `character` = the current version's overlay (every listener expects the current card), plus `cardVersionId` (the written one), `currentCardVersionId`, `cardVersions`, and — on Save as new version only — `staying: { castMemberId, lorebookId, name, cardVersionId, label }[]`: the cast members in books **owned by the card's owner** with any cast version whose parent is a version of this card with a lower number than the new one (one row per member, its newest such parent). The count is its length (the client words it, wave 3: _3 cast members stay on v1.0_). No bulk update.
- `syncLorebookBindingsForCharacter(id)` and `autoEnqueueCharacter` as today.

### 3. Card creation sites onto `insertCard`
- `charactersCreate` (~555): `insertCard` inside a `db.transaction` (tx only), then default persona / tags / avatar as today after it; the avatar also sets v1's face (`updateCardVersion(db, version.id, { faceMediaId })`).
- `createCharacterFromParsedData` (~1075): through your `insertCardFromColumns` helper (with the notes-lang fix); `applyAvatarAndTags` sets the version's face after the upload (pass the version id in).
- `charactersDuplicate` (~2268): the copy's values = the original's library facts + `cardColumnsOfProfile(profileOf(originalCurrent))` + `characterVersion: originalCurrent.label`; the copy gets one version (v1). The avatar copy sets v1's face.
- `charactersSetAvatar` (~2141/~2175): the face goes to the current version (`updateCardVersion(db, current.id, { faceMediaId })`), not a direct `characters` update.
- `import.ts` ~986 (SillyTavern character) and ~1135 (persona): `insertCardFromColumns` / `insertCard`; the avatar writes at ~1028 and ~1169 become `updateCardVersion(db, version.id, { faceMediaId })`. ~1092 (`lorebookId`, a library fact) stays.
- `charactersDelete` is a soft delete — nothing changes. No path in your files hard-deletes a card; if you find one, `resolveFollows(tx, { cardId })` runs first.

### 4. Import (`importCardFile` ~1333, `charactersImportResolve` ~1444)
- **Canonical compare.** One local function `canonicalCardOf(data, userId, dbOrTx)` → `{ profile, facts }`: `profile` = `profileOfCardColumns` of `characterFieldsFromParsedData(data, planCardImport(data))` with the extensions passed through `importedLikenessChecked` (as creation does), minus `faceMediaId`; `facts` = `{ tags (sorted), creator, source, category, dowry: data.extensions?.serenepub?.dowry ?? null }` (today's hash covered the dowry deliberately — keep it). The existing side is the SAME function over the current version's export: `buildCharacterCardV3({ ...cardAsOfVersion(row, current), tags, dowry: await buildCardDowry(db, id) }).data` (minus `character_book`), so both sides pass one reader. Identical `hashCanonicalJson` → `unchanged`; else `conflict`.
- The conflict reply adds `currentVersion: { id, number, label }` and `suggestedLabel`: the file's `character_version` when non-empty and different from the current label, else `nextVersionLabel(current.label)` (from `shared/characters/profile`).
- **Resolve.** `action: "addVersion"` (new; local param type) adds a version; ⏳ the old client's `"overwrite"` is read as `"addVersion"` until wave 3 (overwrite in place is gone); `"createNew"` as today. Params gain optional `label?: string | null` (absent → the suggestion rule above).
- New exported `addCardVersionFromParsedData(existingId, data, avatarBuffer, userId, dbOrTx = db, warnings?, summary?, opts?: { label?: string | null })`: profile = the file's (as in the compare) with `faceMediaId` = the current version's; `newCardVersion(dbOrTx, existingId, profile, { label })`; library facts from the file (`creator`, `source`, `category`) on `characters`; the dowry as today's overwrite (`importCardDowry(..., { replace: true })`); tags as today; the avatar (when any) uploads and sets the NEW version's face. Returns the current overlay of the card. Reply adds `cardVersionId`.
- `overwriteCharacterFromParsedData` stays exported with the same signature as a ⏳ alias of `addCardVersionFromParsedData` (label: the suggestion rule) — `sockets/lorebooks.ts` (cv-member's) and `plugins/providedBooks.ts` (w3's) still call it; the in-place overwrite is gone. Say so in the report.

### 5. Export (`charactersExportCard` ~1674)
Build from `cardAsOfVersion(character, current)`; the PNG/CHARX avatar is the current version's `faceMediaId`. (w2 changes what `buildCharacterCardV3` writes for greetings and notes; you only feed it the current version's columns.)

### 6. Tests — NEW `src/lib/server/sockets/characters.versions.int.test.ts`
Follow the mock/DB pattern of `sockets/characters.import-export.int.test.ts` (PGlite test db, handler invoked with a fake socket). Every `it` that opens or migrates a DB gets a **60 s** timeout. Cover:
- the editor saves the current version in place (no new version; the version's fields change; the ⏳ copies follow; personality is read from the version, not the row);
- the editor saves an OLDER version (`cardVersionId` = v1 while v2 is current): v1 changes, v2 and the copies don't;
- Save as new version: number + 1; label suggested (`1.0` → `1.1`) and explicit; `staying` lists two members (made with `insertCastMember` from `versions.ts`, following v1) with their ids and lorebook ids; a member in another person's book is not listed;
- `characters:get` with and without `cardVersionId` (the shown version's content; `cardVersions` in order);
- import: the same file twice → `unchanged`; a changed file → `conflict` with `currentVersion` and `suggestedLabel`; resolve `addVersion` → a new version with the file's label, v1 untouched; resolve `createNew` → a new card with its own v1; ⏳ `overwrite` behaves as `addVersion`;
- export after Save as new version writes the new version's content;
- each creation site makes v1: create, duplicate (v1 = the original's current content), import (`createCharacterFromParsedData`), SillyTavern bulk character and persona (`import.ts`, if an existing test fixture makes that cheap — else say so).
Update existing tests in your owned test files that now fail only because they asserted a frozen `characters` column after a write — assert the version instead, and list each.

## Done means
- These pass (run them, never pipe vitest into `head`; run with `npx vitest run <files> --maxWorkers=4`): `src/lib/server/sockets/characters.versions.int.test.ts`, every `src/lib/server/sockets/characters.*.test.ts`, `src/lib/server/sockets/import*.test.ts`, `src/lib/server/sockets/imports.hardening.int.test.ts`, `src/lib/server/characters/cardIO.int.test.ts`, `src/lib/server/characters/versions.int.test.ts`.
- `npx tsc --noEmit -p .` shows no error in your files (the old `arrangeCanvas.dom` error is known).
- `npx prettier --check` on your files: report which were not clean before you started; format only your hunks.

## Stop and ask (write it in your report and stop that item) when
A new name you'd have to invent beyond those above; a migration; a change to a file you don't own; a test that fails for a reason outside your files; any ★ (user-facing behaviour not stated here).

## Report
Write `plans/REPORT-cv-writers-w1-2026-11-05.md`: names and signatures first; changed files; tests run with counts; the local type additions for `types.ts`; every new sentence verbatim; open questions; Noticed, not done. Then end.
