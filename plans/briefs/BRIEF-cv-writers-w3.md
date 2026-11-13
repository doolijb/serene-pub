# BRIEF cv-writers-w3 — starters, provided books and primers onto card and cast versions; one stale test file

Worker (lane-worker, Sonnet) for lane **cv-writers** (supervisor: Opus). App root `/home/jody/github/serene-pub`. Today is 2026-11-05.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Other lanes (cv-time, cv-member) are editing beside you. Edit ONLY the files under **Files owned**. If the Write tool refuses your report file, return the report as your final message instead.

## Background (read; do not re-derive)

Card content lives on **card versions** (`character_versions`: `card_id`, `number` unique per card, `label`; the current version is the highest number), each holding one 🚧 **character profile** (`CharacterProfileV1`, `src/lib/shared/characters/profile.ts`). A **cast member** (`lorebook_bindings` row) has **cast versions** (`cast_member_id`), the first one its **base** (main line, undated, no life point); a cast version names in `follows[]` the profile fields it reads from its parent card version (`parent_version_id`). A member's active card is its version's parent's card.

**Frozen columns** (plan §32 §8; a later guard test fails on them): the `characters` content columns (name, nickname, aliases, summary, description, personality, scenario, firstMessage, alternateGreetings, groupOnlyGreetings, exampleDialogues, postHistoryInstructions, creatorNotes, creatorNotesMultilingual, strokes, avatarMediaId, characterVersion, and the likeness/timbre in extensions), except four ⏳ copies of the current version written only by the versions module; and on `lorebook_bindings`: retold flags and retold text columns, `face_media_id`, `timbre`, `own_name`, `own_nickname`, `sprite_set`, `node_state`, `node_visibility`. Never write a frozen column except through an insert made by `insertCard` / `insertCastMember`; read the version instead. Library facts stay on the row and are written as today (tags, folder, creator, category, source, uuid, `lorebookId`, persona flags; `lorebook_bindings.name` is a synced copy, `binding`, `character_id` the link). The plugin **provided mark** (`characters.extensions.serenepub.provided`) is ownership metadata: it stays on `characters.extensions`, read and written as today.

### The writer — `src/lib/server/characters/versions.ts` (read; do NOT edit). Handle first; never opens a transaction.
`insertCard(tx, values, {writtenBy?})` → `{card, version}` · `ensureCardVersion(tx, cardId)` → current version · `newCardVersion(tx, cardId, profile, {label?})` · `updateCardVersion(tx, versionId, changes)` · `insertCastMember(tx, values, {writtenBy?})` → `{member, base}` (the base is made from the member row's values — including its own name / nickname / sprite set at insert) · `updateMemberToCardVersion(tx, castMemberId, cardVersionId)` (re-parents the member's versions whose parent is an OLDER version of the SAME card; answers how many) · `resolveFollows(tx, {cardId?, castMemberId?}, {detach?})` (copies each followed field from the parent into the version's own value and clears `follows`; its doc: "Runs first on every delete path the app owns: card unlink (`detach`), card delete, Copy-from, starters (lead decision…)") · `writeCastVersion(tx, {member, changes, writtenBy, at: {branchId: null, date: null, personalPosition: null}})` — the **author path**: edits the member's version at exactly that key (the base) in place; `changes` are `{field: value | {follow: true}}` over profile fields, a follow refused in words for a card-less member.
Read helpers: `profileOf` (shared), `memberAsRead` / `castVersionsInForce` in `cast/memberAsRead.ts`.

### Lane helpers (read; do not edit)
- `src/lib/server/characters/cardIO.ts` (bottom section): `cardColumnsOfProfile(profile)`, `cardAsOfVersion(row, version)` (a row shown as a version), `profileOfCardColumns(columns)`.
- `src/lib/server/sockets/characters.ts`: `insertCardFromColumns(tx, values, opts?)` (insertCard + keeps the creator notes' language), `createCharacterFromParsedData(...)` (makes the card and v1), `overwriteCharacterFromParsedData(...)` (⏳ now ADDS a new card version — overwrite in place is gone; owner: "overwrite in place goes"), `buildExistingCharacterComparisonData(id, db)` (built from the current version).

### Rules (CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- "A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." Provided-book marks store **hashes** (`castHashOf`) in `lorebooks.extra_json`: a hash computed from a different source must give **the same value** for an unchanged member, or every installed provided book reports "kept edited" on its next upgrade. Test that.
- It is a **session**, never a chat. Every session has a lorebook — never write "no book". List any new user-facing sentence verbatim.

## Files owned
- `src/lib/server/lorebooks/starterKits.ts`
- `src/lib/server/plugins/providedBooks.ts`
- `src/lib/server/plugins/providedPrimers.ts`
- `src/lib/server/sockets/characterAvatarAndUpdate.int.test.ts` (only the four assertions below)
- Tests: `lorebooks/starterKits.int.test.ts`, `plugins/providedBooks.int.test.ts`, `plugins/providedBooksPubWide.int.test.ts`, `plugins/providedPrimers.int.test.ts`; new test files beside them if cleaner.

## Out of scope
`versions.ts`, `cardIO.ts`, `sockets/characters.ts`, `sockets/lorebooks.ts`, `lorebooks/tableRegistry.ts` (cv-member copies `character_versions` with a book), the client, NOMENCLATURE.

## Items

### 1. `starterKits.ts`
- **Kit cast** (`writePrimerInto`, ~888 card / ~896 member): `insertCard(tx, {userId, name, description})` and `insertCastMember(tx, {...})` — same values as today.
- **`ownCastCards`** (~519–622): the copy of each foreign card is made from the original's **current version**: values = the original's library facts (as today's destructure keeps them, minus the content columns) + `cardColumnsOfProfile(profileOf(current))` + `characterVersion: current.label` + `extensions` without the provided mark (as today: `withoutProvidedMark`), through `insertCardFromColumns` (or `insertCard`). Before the binding is re-pointed at the copy, run `resolveFollows(tx, { cardId: oldId, castMemberId })` for each member of the copied book bound to `oldId` (lead decision: starters resolve follows first), so no member reads through another person's card. The members' versions still name the original's version as parent (there is no helper that re-parents across cards) — **do not write `character_versions` yourself**; say in your report exactly which member versions keep a foreign parent.
- `avatarFromMediaId` = the original's current version's `faceMediaId`. The post-commit avatar step (whatever sets the copy's avatar after the transaction — find it) sets the copy's **version** face: `updateCardVersion(db, (await ensureCardVersion(db, copyId)).id, { faceMediaId })` instead of a direct `characters` write, if it writes one.

### 2. `providedBooks.ts`
- **New member** (~1132): `insertCastMember(tx, { ... same values ... })`.
- **Recorded member, upstream changed** (~1060–1105):
  - the card update goes through `overwriteCharacterFromParsedData` (now a new version). Then move THAT member onto the new current version: `updateMemberToCardVersion(tx, bindingId, newCurrent.id)` — the plugin's upgrade reaches its own unedited member as the in-place overwrite did (the "person edited it → person wins" hash check already ran before);
  - the member's `spriteSet` / `ownName` / `ownNickname` go to the member's base through `writeCastVersion(tx, { member, changes, writtenBy: \`plugin:${pluginId}\`, at: { branchId: null, date: null, personalPosition: null } })` — only fields that differ from what the base holds now: `spriteSet` → `spriteSet`; `ownName` → `name` (null → `{ follow: true }` for a carded member); `ownNickname` → `nickname` (null → `{ follow: true }`; `""` is an own empty nickname — keep it own). No write to the frozen binding columns.
  - `characterId` changing (a member that had no card gets one, or another card): keep writing the link column as today, but say in your report that the member's versions are not re-parented (no helper) — do not invent one.
- **`castHashNow`**: read `spriteSet`, own name and own nickname from the member's **base** version instead of the frozen binding columns, mapped back to today's meaning (own name = the base's `name` when `name` is not in `follows`, else null; same for nickname; the sprite set as held). For a member with no base yet, fall back to the binding columns (a lift straggler). Test: for a member made by today's import path, the hash before and after this change is identical; an edited member still reads as edited.
- `liveCastOf` reads `characters.name` (a ⏳ copy) and `extensions` (the mark) — leave.
- Provided-mark writes on `characters.extensions` (~996, ~1423) stay.

### 3. `providedPrimers.ts`
The mark write (~202) stays. Check that nothing else writes a frozen column; change only what does.

### 4. `sockets/characterAvatarAndUpdate.int.test.ts`
Four tests assert frozen `characters` columns after an update (lines ~576, ~704, ~783, ~834: `row.strokes`, `row.strokes`, `row.extensions`, `row.extensions.serenepub.likeness`). Change those assertions to read the card's current version (`character_versions` where `card_id` = id, highest `number`), keeping what each test means. Change nothing else in the file.

### 5. Tests
Each creation site makes v1 / a base (kit cast; provided book new member); `ownCastCards` copy's v1 equals the original's current version content and the copied members read the same text as before the copy; a provided-book upgrade adds a card version, moves its unedited member onto it, and leaves a person-edited one; the hash-stability test above. Fix existing assertions in your owned tests that read a frozen column after a write — list each. 60 s timeouts on every `it` that opens a DB.

## Done means
`npx vitest run <files> --maxWorkers=4` (never pipe into `head`) passes for: `src/lib/server/lorebooks/starterKits.int.test.ts`, `src/lib/server/plugins/providedBooks.int.test.ts`, `src/lib/server/plugins/providedBooksPubWide.int.test.ts`, `src/lib/server/plugins/providedPrimers.int.test.ts`, `src/lib/server/sockets/characterAvatarAndUpdate.int.test.ts`, plus any new test file. `npx tsc --noEmit -p .` clean on your files (the `arrangeCanvas.dom` error is known). `npx prettier --check` on your files: say which were unclean before; format only your hunks.

## Stop and ask (in your report; stop that item) when
A helper you'd need in a file you don't own; a new name beyond those above; a migration; a test failing for a reason outside your files; any user-visible behaviour not stated here (★).

## Report
Write `plans/REPORT-cv-writers-w3-2026-11-05.md` (or return it as your final message if the write is refused): names and signatures first; changed files; tests with counts; new sentences verbatim; open questions; Noticed, not done.
