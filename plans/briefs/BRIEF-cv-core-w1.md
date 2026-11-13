# BRIEF cv-core-w1 — the one writer's core: card versions, cast-member creation, `resolveFollows`, and three creation sites

Worker (Sonnet) for lane **cv-core**; the supervisor is the cv-core lane-supervisor. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-core-w1 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
Create 🚧 `src/lib/server/characters/versions.ts`, **the one writer** of `character_versions` (plan §32 §8, §33), with everything except the session write (`writeCastVersion` comes in a later brief, in the same file — leave a clearly marked place at the end of the file, no stub function). Then move three creation sites onto it.

Another worker is building the reader (`cast/memberAsRead.ts`, `state/reading.ts`, `utils/castMemberCards.ts`) at the same time. Don't touch those files.

## Files owned (edit only these)
- `src/lib/server/characters/versions.ts` (new)
- `src/lib/server/characters/versions.int.test.ts` (new)
- `src/lib/server/characters/versions.test.ts` (new, pure units)
- `src/lib/server/utils/characterBindingSync.ts` — `findOrInsertBinding` only (~276–309)
- `src/lib/server/utils/summarizer/availableSceneCast.ts` — `resolveOrCreateBindingByName`'s insert only (~640–655)
- `src/lib/server/pipelines/testing/fixtures.ts` — `insertCharacterRow`, `insertPersonaRow`, `insertLorebookBindingRow`, and the unbound insert in `insertNarrativeNodeRow` (~485/503/541/579) only
- tests next to those three files if a test there needs a change (say which and why)

Not `NOMENCLATURE.md` (the supervisor writes §25). Not `src/lib/shared/characters/profile.ts` (the supervisor wrote it; import from it; if it lacks something, stop and say so). Nothing else.

## Files readable
- `src/lib/shared/characters/profile.ts` — `CharacterProfileV1`, `CHARACTER_PROFILE_FIELDS`, `CharacterProfileField`, `isCharacterProfileField`, `profileOf`, `followedProfile`, `mergeGreetings`, `creatorNotesOf`, `nextVersionLabel`, `emptyCharacterProfile`.
- `src/lib/server/db/schema.ts` ~9345–9570 (`characterVersions`, its CHECKs and indexes), ~1552–1720 (`lorebookBindings`), ~2272–2420 (`characters`).
- `src/lib/server/cast/memberAsRead.ts` `layerMemberAsRead` (~150–265): **today's read**, which the member base below must reproduce.
- `src/lib/shared/lorebooks/memberIdentity.ts` (`memberNames`, `memberFaceMediaId`, `ownNameValue`), `src/lib/shared/lorebooks/retold.ts` (`RETOLD_FIELDS`, `RetoldFlags`), `src/lib/server/lorebooks/retold.ts` `splitExampleDialogues`, `src/lib/shared/characters/timbre.ts` `timbreOfExtensions`, `src/lib/shared/characters/likeness.ts` `likenessOfExtensions`.
- `src/lib/server/db/characterVersions0146.int.test.ts` and `src/lib/server/utils/testDb.ts` (`createTestDb`, `createTestUser`, `releaseDataDir`) for how int tests open a database.

## Rules you work under (quoted)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." Every function here takes its handle first (`tx: Db`) and never opens its own transaction; the caller owns it.
- **`versions.ts` must stay a leaf**: it must not statically import `$lib/server/db`, nor any module that does (directly or transitively). Its static imports are only `drizzle-orm`, `$lib/server/db/schema`, `$lib/server/db/rawRows`, and `$lib/shared/*`. Reason, quoted from `characterBindingSync.ts`: "THIS MODULE MUST NOT STATICALLY IMPORT `$lib/server/db`. It is imported by db/defaults.ts, whose sync() runs at module scope of db/index.ts" — and `characterBindingSync.ts` will import `versions.ts`.
- CLAUDE.md: "Never seed a row at a hardcoded id." The `write_order` column is `NOT NULL` with no default: "the writer sets it from the id on insert, a copy inherits its source's". Pre-draw each id with `nextval(pg_get_serial_sequence('character_versions', 'id'))` and insert both `id` and `write_order` (= that id, unless the caller passes the write order of the row it copies).
- The writer's rule (lead, cv-schema scope review): "a version with `follows` has a parent" is enforced by the writer, not a CHECK — refuse a `follows` that is non-empty with no parent, and refuse any `follows` entry that is not in `CHARACTER_PROFILE_FIELDS`, each with a sentence (`throw new Error("…")`).
- A card version has a `number`, no `follows`, no parent, book, line, date, life point, source or node fields (`character_versions_card_version_check`). A cast version has no number, has `lorebook_id` (the member's book), and has `node_state` and `node_visibility` (`character_versions_cast_version_check`). An undated cast version with no source must be on main with no personal position: that is the **base**, at most one per member (`character_versions_base_idx`).
- An int test that opens a DB inside a test needs a **60 s timeout**; never pipe vitest into `head`; targeted tests only; `tsc` clean on your files; prettier clean on your files (run `npx prettier --write` on files you create; on the three existing files, format only your hunks — if prettier would reformat unrelated lines, leave them and say so).
- Names: use exactly the names in this brief. Do not invent any other **exported** name, prop or type. Private helpers are fine. If you need another export, stop and say so.

## What to build in `versions.ts`

Header comment: what the module is (the one writer of `character_versions`; plan §32 §8, §33), the leaf rule, and that callers own the transaction.

### Pure conversions (exported)
1. **`cardProfileOf(card)`** → `CharacterProfileV1` from a `characters` row (`typeof schema.characters.$inferSelect`, or a structural subset): `name`, `nickname`, `aliases`, `summary`, `description`, `personality`, `scenario`; `greetings = mergeGreetings(firstMessage, alternateGreetings, groupOnlyGreetings)`; `exampleDialogues` (the json `string[]`); `postHistoryInstructions`; `creatorNotes = creatorNotesOf(creatorNotes, creatorNotesMultilingual)`; `strokes`; `faceMediaId = avatarMediaId`; `likeness` = `likenessOfExtensions(extensions)` or null when it has no keys; `timbre` = `timbreOfExtensions(extensions)` or null when it has no keys; `spriteSet: null`; `extensions` = the card's extensions with `serenepub.likeness` and `serenepub.timbre` removed (and `serenepub` itself removed when that leaves it empty). Don't mutate the input.
2. **`memberProfileOf(member, card)`** → `{ own: CharacterProfileV1; follows: CharacterProfileField[]; mixedGreetings: boolean }`. `member` is a binding-shaped row (`name`, `aliases`, `summary`, `description`, `personality`, `scenario`, `firstMessage`, `alternateGreetings`, `exampleDialogues` (ONE `<START>` text), `faceMediaId`, `retold`, `ownName`, `ownNickname`, `timbre`, `spriteSet`); `card` is the parent card version's profile or null (card-less). It must reproduce **today's read** (`layerMemberAsRead`) field for field:
   - **Card-less** (`card` null): every field is own; `follows` = []. `name` = `ownName` (trimmed, non-empty) else `member.name`; `nickname` = `ownNickname` when it is a string (`""` → null) else null; description/personality/scenario/summary as stored; `greetings = mergeGreetings(member.firstMessage, member.alternateGreetings, [])`; `exampleDialogues = splitExampleDialogues(member.exampleDialogues)`; `faceMediaId`, `timbre`, `spriteSet` as stored; `aliases` the member's; everything else empty (`emptyCharacterProfile()` values).
   - **Carded**: own = `aliases`, `summary`, `spriteSet` (always the member's), and:
     - `name` own when `ownName` is non-empty after trim, else follows; `nickname` own when `ownNickname` is a string (`""` own → null, meaning "no nickname here"), else follows (the `memberNames` rule);
     - `description` / `personality` / `scenario` own (`?? ""`) when `retold[field] === true`, else follow;
     - `exampleDialogues` own (`splitExampleDialogues`) when `retold.exampleDialogues`, else follows;
     - **greetings**: neither `retold.firstMessage` nor `retold.alternateGreetings` → follows. Both → own `mergeGreetings(member.firstMessage ?? "", member.alternateGreetings, [])` (today drops the card's group-only greetings once either is retold). **Exactly one (mixed)** → own full list: the retold half from the member and the other half from `card`'s solo greetings (opener = first unmarked, alternates = the other unmarked), no group-only ones; `mixedGreetings: true` (owner, 2026-11-05 late: "Mixed greetings at the upgrade → 'Own list, noted'": "the member gets its own full list (its retold opener + the card's current others)").
     - `faceMediaId` own when `retold.face === true` and `member.faceMediaId` is a number (`memberFaceMediaId`), else follows;
     - `timbre` own when `member.timbre != null`, else follows;
     - `postHistoryInstructions`, `creatorNotes`, `strokes`, `likeness`, `extensions` follow (members have none of their own today).
   - Own fields that follow hold the empty value in `own` (the reader ignores them).
   - Write `memberProfileOf`'s doc to say it is the one conversion the base insert, the boot lift and its verify step share.

### Writes (exported; each takes `tx: Db` first)
3. **`insertCharacterVersions(tx, rows)`** → the inserted rows (`typeof schema.characterVersions.$inferSelect[]`), in input order. `rows` are `Omit<typeof schema.characterVersions.$inferInsert, "id" | "writeOrder"> & { writeOrder?: number }`. The one INSERT of the table: validates `follows` (see Rules), pre-draws ids, sets `write_order`. Every other function here inserts through it. Its doc says so ("the one INSERT; the boot lift calls it too").
4. **`nextWriteOrder(tx)`** → `number`: one `nextval` of the same sequence — the value a **retire mark** takes (§33.2: "`retired_order` = the next write order"). Exported for the session writer (later brief).
5. **`ensureCardVersion(tx, cardId)`** → the card's **current** card version row (highest `number`), inserting **v1** from the `characters` row when the card has none: `number: 1`, `label: characters.characterVersion || "1.0"`, profile `cardProfileOf(row)`, `writtenBy: "lift"`. A soft-deleted card still gets one. A card id with no row → `null`. Race-safe: the insert skips on conflict on `(card_id, number)` and re-reads.
6. **`insertCard(tx, values)`** → `{ card, version }`: inserts the `characters` row (`typeof schema.characters.$inferInsert`), then its v1 exactly as `ensureCardVersion` would (label from `values.characterVersion`, else "1.0"; `writtenBy` from an optional `opts.writtenBy`, default null).
7. **`insertCastMember(tx, values, opts?)`** → `{ member, base }`: inserts the `lorebook_bindings` row, then its **base**: `castMemberId`, `lorebookId` = the member's book, no branch, no date, no source, `personalPosition: null`; `parentVersionId` = `ensureCardVersion(values.characterId)`'s id when the member has a card (null when card-less or the card is gone); profile + follows from `memberProfileOf(memberRow, parent ? profileOf(parent) : null)`; `nodeState` / `nodeVisibility` = the member row's; `writtenBy: opts?.writtenBy ?? null`. **An overlay row (`values.overlayOf` set) gets no base** (`base: null`): it holds only a session's writes, written later by the session writer; say so in the doc.
8. **`newCardVersion(tx, cardId, profile, opts?: { label?: string | null; writtenBy?: string | null })`** → the new row: `number` = current + 1 (current = `ensureCardVersion`), label = `opts.label` when given (even ""), else `nextVersionLabel(current.label)`. It becomes the current version → write the ⏳ card copies (below).
9. **`updateCardVersion(tx, versionId, changes: Partial<CharacterProfileV1>)`** → the updated row: writes those profile fields in place on a CARD version (refuse a cast version id, or an unknown id, in words). Any version, not only the current one (owner: "Card editing → any version, with a picker (Save writes the chosen version; it reaches that version's followers)") — followers read it by `follows`, so nothing else is written. When it is the current version, write the ⏳ card copies.
   - **⏳ card copies** (plan §31 §8: "The card-field columns on `characters`, except four kept as ⏳ copies of the **current** version, written only by the versions module: name, nickname and avatar_media_id, for library screens; description, which `embed_text_hash` is generated from"): set `characters.name`, `nickname`, `avatarMediaId`, `description` from the current version's profile (`name ?? ""`, `description ?? ""` — both are NOT NULL). One private helper, used by 8 and 9.
10. **`updateMemberToCardVersion(tx, castMemberId, cardVersionId)`** → the number of versions re-parented: re-parents only that member's cast versions whose parent is an **older** version (`number` <) **of the same card** as `cardVersionId` (plan §32 §9: "Update is authoring. It re-parents only that member's versions whose parent is an older version of the same card"). Refuse a cast version id given as the target, in words.
11. **`resolveFollows(tx, scope: { cardId?: number; castMemberId?: number }, opts?: { detach?: boolean })`** → the number of versions changed. For every cast version with a non-empty `follows` whose parent is a version of `scope.cardId` (when given) and/or which belongs to `scope.castMemberId` (when given; at least one must be given): copy each followed field's value from the parent card version into the version's own column, then clear `follows`; `detach: true` also clears `parent_version_id` (the member is now card-less). A version with `follows` and no parent (a cascade removed it) gets the empty values and `follows` cleared. Doc: "runs first on every delete path the app owns: card unlink (`detach`), card delete, Copy-from, starters" (lead decision, cv-schema scope review).

### The session write
At the end of the file leave a comment block `// ── The session write (writeCastVersion) — next brief ──` and nothing else there.

## The three creation sites
- `characterBindingSync.ts` `findOrInsertBinding`: replace the `tx.insert(schema.lorebookBindings)` with `insertCastMember(tx, { lorebookId, binding: token, characterId })` and return `{ row: member, created: true }`. Keep everything else (the deleted-card refusal, the doc). Add one doc line that the member is born with its base version.
- `availableSceneCast.ts` `resolveOrCreateBindingByName`: the insert becomes `insertCastMember(tx, { lorebookId, characterId: null, binding: token, name: trimmed })`; return `{ id: member.id, created: true }`.
- `fixtures.ts`: `insertCharacterRow` and `insertPersonaRow` go through `insertCard(db, …)` and return the card row (same return shape as today); `insertLorebookBindingRow` and the unbound branch of `insertNarrativeNodeRow` go through `insertCastMember(db, …)` and return the member row. (Fixtures pass `db`; that is fine for tests.)

## Tests
- **`versions.test.ts`** (pure): `cardProfileOf` (greetings merged, empty opener skipped, empty alternate kept, group-only marked; notes with an identical variant dropped; likeness/timbre lifted out and `serenepub` removed when emptied, other keys kept); `memberProfileOf` for card-less, carded with nothing retold (everything follows but aliases/summary/spriteSet), each retold field, own name / own nickname `""`, face retold without a face id (follows), timbre own, both greetings retold, and both mixed cases (`mixedGreetings: true`, the list as specified).
- **`versions.int.test.ts`** (real DB, `createTestDb`, 60 s per test): `insertCard` writes v1 with the label; `ensureCardVersion` is idempotent and lifts a card inserted raw; `insertCastMember` writes a base with the parent and follows, none for an overlay row, a card-less base with no parent; `insertCharacterVersions` refuses follows without a parent and an unknown follows field (by message), and `write_order` equals the id unless given; `newCardVersion` numbers 2 with the bumped label and writes the four card copies; `updateCardVersion` on v1 when v2 exists leaves the card copies alone, and on the current one writes them; `updateMemberToCardVersion` re-parents only versions on older versions of the same card (a version parented on another card stays); `resolveFollows` by card and by member (values copied, follows cleared; `detach` clears the parent; a parentless follower gets empties).
- Run the existing tests of the touched sites: find them with `grep -rln "findOrInsertBinding\|resolveOrCreateBindingByName\|insertLorebookBindingRow\|insertCharacterRow\|insertPersonaRow" src --include=*.test.ts`, plus `src/lib/server/sessions/seats.int.test.ts` and `src/lib/server/sessions/seatMembers.int.test.ts`. Report each file's pass/fail. A failure that comes from the reader still reading the binding columns is expected only if the test then edits the binding's columns directly; report it with the test name — do not change the test unless it is in a file you own.

## Out of scope
`writeCastVersion`, `ensureSessionLine`, `anchorFor`, the reader, the boot pass, every other insert site (wave 2), NOMENCLATURE, docs, the schema.

## Stop and ask (in your report) when
An export beyond this brief seems needed; `profile.ts` lacks something; a rule above conflicts with what the code does; anything needs a file you don't own.

## Done means
```
cd /home/jody/github/serene-pub && npx vitest run src/lib/server/characters/versions.test.ts src/lib/server/characters/versions.int.test.ts <the site test files you found>
```
green (run them; never pipe into `head`); `npx tsc --noEmit -p . 2>&1 | grep -E "characters/versions|characterBindingSync|availableSceneCast|testing/fixtures"` empty; `npx prettier --check` clean on your new files. Before and after the run, `ls -d /tmp/serene-pub-vitest-* 2>/dev/null` — delete by name only dirs that appeared from your runs.

Report: names and signatures, changed files, test results (counts per file), anything you disagreed with, Noticed-not-done.
