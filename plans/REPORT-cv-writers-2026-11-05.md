# REPORT cv-writers (2026-11-05)

No status question was relayed. Wave 2's writers are built: the card editor, card import and export, and every card or member creation site in my files now write card versions (cast versions for members). The grouped targeted run passes **44 files, 541/541**. `tsc` shows only the old `arrangeCanvas.dom` error. My runs left no new `/tmp/serene-pub-vitest-*` dirs (I compared listings before and after) and I deleted none. I ran no `sdk:build`. I committed nothing.

Three workers ran: w1 (the socket files), w2 (card formats, library, applet, likeness, persona) and w3 (starters, provided books, primers). Their reports came back as messages because the Write tool refused report files. I checked each against its brief, re-ran their tests together, and confirmed that none of them touched `types.ts`, `versions.ts`, `profile.ts`, `sockets/lorebooks.ts` or `lorebookExportBuilder.ts`.

## Names and signatures

**`src/lib/server/characters/cardIO.ts`** (the contract section, which I wrote myself):
- 🚧 `CARD_CONTENT_COLUMNS`, `CardContentColumn`, `CardContentColumns`.
- 🚧 `cardColumnsOfProfile(profile)`: turns a profile back into the card's content columns. It is the inverse of `cardProfileOf`.
- 🚧 `cardAsOfVersion(row, version)`: the row shown as that version, with `characterVersion` set to the version's label.
- 🚧 `profileOfCardColumns(columns)`: the profile, with creator notes read without losing anything.
- `creatorNotesOfCard(text, multilingual)`: like `creatorNotesOf`, but it also keeps `lang`.
- `cardNotesColumns(notes)`.
- w2 added ⏳ `greetingsWithOpener(greetings, text)`, which replaces the first unmarked greeting (the opener).

**`src/lib/server/sockets/characters.ts`**:
- `insertCardFromColumns(tx, values, opts?)` → `{card, version}`: `insertCard`, then `updateCardVersion` to keep the notes' `lang`.
- 🚧 `addCardVersionFromParsedData(existingId, data, avatarBuffer, userId, dbOrTx = db, warnings?, summary?, opts?: {label?})`.
- ⏳ `overwriteCharacterFromParsedData(...)`: same signature, now an alias that adds a version. In-place overwrite is gone.
- `buildExistingCharacterComparisonData` keeps its signature and now builds from the current version.
- Types `CardVersionSummary {id, number, label}` and 🚧 `StayingMember {castMemberId, lorebookId, name, cardVersionId, label}`.
- Local helpers: `canonicalCardOf`, `suggestedLabelFor`, `cardVersionsOf`, `membersStayingBehind`.

Socket changes (declared as local types, see the queue below):
- `characters:get`
  - Takes `cardVersionId?`.
  - Answers `cardVersionId`, `currentCardVersionId` and `cardVersions`.
- `characters:update`
  - Takes `cardVersionId?` (any version of the card; default the current one) and `saveAsNewVersion?: {label?}`.
  - Answers `character` (the current version), `cardVersionId` (the one written), `currentCardVersionId`, `cardVersions`, and `staying` (on a new version only).
- `characters:importCard`
  - A conflict also carries `currentVersion` and `suggestedLabel`.
- `characters:importResolve`
  - Takes `action: "addVersion" | "createNew"` (a ⏳ `"overwrite"` is read as `addVersion`) and `label?`.
  - Answers `cardVersionId`.

**`src/lib/server/library/writes.ts`**: `CHARACTER_CHANGE_FIELDS` is now `name, description, personality, scenario, greetings, exampleDialogues`. `first_mes` and `mes_example` are removed (owner: "New names now, old removed"). Stored rows that still carry the old names keep working on Back and Forward (⏳).

## Changed files
- `/home/jody/github/serene-pub/src/lib/server/sockets/characters.ts`
- `/home/jody/github/serene-pub/src/lib/server/sockets/import.ts`
- `/home/jody/github/serene-pub/src/lib/server/characters/cardIO.ts`
- `/home/jody/github/serene-pub/src/lib/server/utils/characterCardParser.ts`
  - The export writes `data.group_only_greetings` and keeps a ⏳ copy in `extensions`.
  - It writes `data.creator_notes_multilingual`, with the main note filed under its `lang`.
- `/home/jody/github/serene-pub/src/lib/server/library/writes.ts`
- `/home/jody/github/serene-pub/src/lib/server/sockets/appletLibrary.ts`
- `/home/jody/github/serene-pub/src/lib/server/sockets/portrait.ts`
- `/home/jody/github/serene-pub/src/lib/server/utils/personaCard.ts`
- `/home/jody/github/serene-pub/src/lib/server/lorebooks/starterKits.ts`
- `/home/jody/github/serene-pub/src/lib/server/plugins/providedBooks.ts`
- `/home/jody/github/serene-pub/NOMENCLATURE.md`: §25, 5 rows appended after the cv-time rows (line 3304 on).
- Unchanged:
  - `sprites/charx.ts` already writes the card the builder made.
  - `plugins/providedPrimers.ts` only writes the provided mark.
- New tests:
  - `/home/jody/github/serene-pub/src/lib/server/sockets/characters.versions.int.test.ts` (21)
  - `/home/jody/github/serene-pub/src/lib/server/utils/characterCardParser.profile.test.ts` (9: V2, V3, PNG and CHARX round trips, empty greetings, group-only, notes with `lang`)
  - `/home/jody/github/serene-pub/src/lib/server/lorebooks/starterKitsVersions.int.test.ts` (2)
- Extended tests: `cardIO.int`, `writes.int`, `appletLibrary.int`, `portrait.int`, `personaCard.int`, `providedBooks.int`.
- Existing assertions moved from frozen columns to the version: `characters.timbre.int` (7), `characters.importWords.int` (1), `characterAvatarAndUpdate.int` (4 named plus 2 in the same test), `providedBooks.int` (1 fixture), `writes.int`, `appletLibrary.int`, `personaCard.int`.
- Worker briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-writers-w1.md`, `-w2.md`, `-w3.md`.

## Tests
- One grouped run, `--maxWorkers=4`: **44 files, 541/541 pass**. It covered:
  - `sockets/characters*`, `characterAvatarAndUpdate.int`, `sockets/import*`, `imports.hardening.int`, `appletLibrary.int`
  - all of `server/characters/` (cv-core's versions tests included)
  - `utils/characterCardParser*`, `personaCard.int`, `sprites/charx.int`, `library/writes.int`
  - `lorebooks/starterKits*`, `plugins/providedBooks*`, `providedPrimers.int`
- Not run: any other lane's files.
- `tsc`: clean except the known `arrangeCanvas.dom` error.
- Prettier:
  - Most owned files were unclean before this lane; only our hunks are formatted.
  - The three new test files are clean.
  - `NOMENCLATURE.md` was not reformatted.

## Open ★ (my calls inside scope, for the owner to confirm)
1. **★cv-writers-1: a persona file over an existing persona adds a new version** instead of overwriting in place. I applied "overwrite in place goes" to personas too. `overwritePersonaFromParsedData` keeps its name for `sockets/lorebooks.ts`.
2. **★cv-writers-2: a provided book's upgrade moves the plugin's unedited member onto the new card version** (`updateMemberToCardVersion`). That keeps today's behaviour, where an upstream card change reached the member. A member the person edited stays put.
3. **★cv-writers-3: the suggested label on an import.** It is the file's `character_version`, unless that is empty or equals the current label; otherwise it is `nextVersionLabel`. This follows plan §31 §9's refinement of "the file's, else the suggestion".
4. **★cv-writers-4: what the import compare covers.** It hashes the profile (face aside) plus tags, creator, source, category and the dowry, as today's hash did. So a dowry-only change is still a conflict.
5. **★cv-writers-5: `staying` lists only members in the card owner's own books**, because only those can be linked. Members of other people's books are not counted.

## Queued for the lead and other lanes (not my files)
- **`shared/sockets/types.ts`** needs these additions; today they are local intersection types in `sockets/characters.ts`:
  - `Get.Params.cardVersionId?`.
  - `Get.Response`: `cardVersionId?`, `currentCardVersionId?`, `cardVersions?`.
  - `Update.Params`: `cardVersionId?`, `saveAsNewVersion?: {label?: string|null}`.
  - `Update.Response`: `cardVersionId`, `currentCardVersionId`, `cardVersions`, `staying?: StayingMember[]`.
  - `ImportCard.Response.conflict`: `currentVersion: {id, number, label}`, `suggestedLabel: string|null`.
  - `ImportResolve.Params.action: "addVersion" | "createNew"`, with ⏳ `"overwrite"` kept until the wave 3 client changes, plus `label?`.
  - `ImportResolve.Response.cardVersionId?`.
- **`versions.ts` is missing three things:**
  - **A cross-card re-parent helper.**
    - Starter copies: `ownCastCards` resolves `follows` first, but the copied members' versions keep the original card's version as parent, so `activeCardId` still names the original card.
    - A provided-book member whose card changes or newly appears is not re-parented, so its base stays card-less.
    - Copy-from will need the same helper.
  - **A label option on `updateCardVersion`.** An in-place save ignores `characterVersion`, so the editor can't rename a version's label.
  - **`creatorNotesOf` in `profile.ts` should record `lang`.** Today the lift and `cardProfileOf` drop the main note's language key. My lane fixes this only on the import and creation paths. Cards already lifted export without that key.
- **NUL regression.** `character_versions` profile fields are `jsonb`, and the old `characters.extensions` was `json`. A card whose extension strings contain U+0000 now fails the whole write. The fix belongs in the versions writer or in import sanitising.
- **`utils/index.ts` `handleCharacterAvatarUpload`** still writes `characters.avatar_media_id` (a ⏳ copy) directly. Every caller in my files now also sets the version's face right after.
- **`utils/lorebookExportBuilder.ts`** still feeds `buildCharacterCardV3` and `buildPersonaExportCard` the raw row. It should use `cardAsOfVersion(row, current)`; until then, likeness and content in book exports are stale.
- **cv-member (`sockets/lorebooks.ts`)**
  - Switch from the ⏳ `overwriteCharacterFromParsedData` to `addCardVersionFromParsedData`.
  - Make sure it compares before calling, since every call now adds a version.
- **cv-guards: reads of frozen columns that stay on purpose:**
  - `providedBooks.castHashNow` reads `characters.character_version` (`|| ""`), so installed books' stored hashes stay stable. Switching to the version label would flag every installed book as "kept edited". A test pins this.
  - The provided mark is still read from and written to `characters.extensions`, as ownership metadata.
  - `buildCharactersList` overlays `summary` and `creatorNotes` from the version. A card that has no version falls back to the row's values.
- **V-sdk (wave 3):** `contracts/src/outlets.ts` `update-character@1` should use the profile names, and the docs that name `first_mes` / `mes_example` need the same change.
- **V-client (wave 3):**
  - The version picker.
  - The import dialog's **Add as a new version** (send `addVersion`).
  - The words _3 cast members stay on v1.0_.
  - `docs/characters.md`. I made no docs change, since nothing user-facing moves until the client ships.

## Noticed, not done
- A Review-mode library proposal still pending with `first_mes` or `mes_example` is refused on Accept; only Back and Forward map the old names.
- `ensureCardVersion` on the get and broadcast read paths writes v1 lazily for a card that has none. This is the lazy lift cv-core designed.
- `addCardVersionFromParsedData` does not clear the embedding. The queue re-embeds on the text hash.
- `extensions.depth_prompt` takes part in the compare. A hand-made file carrying our uuid but no `depth_prompt` would read as a conflict.
- Deleting a user account hard-deletes their cards through the FK cascade, and nothing runs `resolveFollows` for members of other people's books that follow those cards. That code is in the admin path, not mine.
- P2: `sockets/characters.ts` reads `character_versions` directly for the picker list, the `staying` query and the list overlay. These are reads only, but they could move into the versions module.
- New user sentences, verbatim:
  - "That version isn't one of this character's."
  - "'greetings' is a list of greetings, each with its text."
  - "'exampleDialogues' is a list of text."
  - "The changes are an object of the card's fields." (it was "…the card's text fields.")
## Lead dispositions (2026-11-05 late)
- ★cv-writers-1 (a persona file over an existing persona adds a version), -3 (import label), -4 (compare covers the dowry, as today), -5 (`staying` counts members in the card owner's own books) → accepted. ★cv-writers-2 (a provided book's upgrade moves the plugin's unedited member onto the new card version, keeping today's reach) → accepted, and listed for the owner's next batch with ★cv-writers-1.
- Queued → lane **cv-fix**: the `types.ts` additions (characters get/update/importCard/importResolve); in `versions.ts` a cross-card re-parent helper (starter copies, provided-book member card changes, Copy-from), a label option on `updateCardVersion`, `creatorNotesOf` keeping `lang` (and the lift); NUL sanitising before the jsonb profile write; `handleCharacterAvatarUpload` writing the version's face through the versions module; `lorebookExportBuilder.ts` exporting `cardAsOfVersion(row, current)`; the user-delete path running `resolveFollows` for other books' members.
- → cv-member (sent): switch to `addCardVersionFromParsedData`, comparing first. → cv-guards: the allowlisted frozen reads (`castHashNow`'s `character_version`, the provided mark in `extensions`, the list overlay's fallback). → wave 3: V-sdk `update-character@1` profile names; V-client the picker, the import dialog's **Add as a new version**, _3 cast members stay on v1.0_, `docs/characters.md`.
