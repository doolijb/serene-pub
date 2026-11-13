# REPORT cv-fix (2026-11-06)

No status question was relayed to me. All 17 items are built or settled.
- The grouped targeted run passed **196 of 197 files, 1871 of 1874 tests**. The 3 failures are all in one file outside this lane (details under Tests).
- `tsc` shows no errors in lane files.
- I ran no `sdk:build` (there was no SDK change), committed nothing and never used `git stash`.
- No `/tmp/serene-pub-vitest-*` dirs from my runs were left behind (I compared listings before and after), and I deleted none.

## Names and signatures (all 🚧)

**`characters/versions.ts`**
- `updateCastVersion(tx, versionId, { changes?, place? }) → VersionRow` (G1). It edits one cast version in place: an authored one, or one a session wrote (★CV-2).
  - When a descendant session reads the row, it retires it first and inserts the edited copy.
  - It refuses: moving the base, editing a retired row, a key clash, and an undated place on a line or at a life point.
- `deleteCastVersion(tx, versionId) → { taken, retired }` (G2). It refuses the base. A session's row goes through `retireOrTakeVersions`; an authored row is deleted.
- `reparentCastVersions(tx, castMemberId, { cardId, follows?, from? }) → number` (G3 and item 9, one function).
  - It moves versions onto `cardId`'s current card version, or makes them card-less with `cardId: null`.
  - `from` absent means every version. `from` given means versions dated at or after it, on every line where a version at that point reads.
  - `follows` given means every version in scope follows exactly those fields. Absent, each version keeps its own.
  - A field that stops following keeps the old card's words. It edits in place with no retire mark: authoring a link reaches every reader, the way a card edit reaches its followers.
- `repointVersionHistory(tx, fromEntryId, toEntryId, branchIds) → number` (G4).
- `updateCardVersion(tx, id, changes, opts?: { label? })` can now rename a card version.
- Private: a NUL strip (`stripNul` / `withoutNul`) runs in `insertRows`, `updateCardVersion` and `updateInPlace`.
- `ensureMemberBase` now refuses a member that holds no cast version.

**Other modules**
- `characters/versionsLift.ts`: `LiftNoteV1`, `LiftDifference`, `parseLiftNote`.
- `state/write.ts`:
  - `moveRidingProposals(tx, sessionId, from, to)`.
  - `bookWritePlace(…, { fork? })`, which stays private.
- `lorebooks/ownBook.ts`:
  - `loreWriteTargetFor(…, { fork? })`, default true.
  - `purgeOwnBookOf` now returns `Promise<boolean>`.
  - New: `purgeKeptOwnBooks(db, sessionIds?) → number`.
- `startup/index.ts`: a new boot task, `kept-own-books`. It is permanent, runs after `own-books`, and has no `failsHealth`.
- `shared/characters/profile.ts`: `creatorNotesOf` now keeps the main note's `lang`.
- `shared/sockets/types.ts`:
  - `Sockets.Characters.CardVersionSummary` and `StayingMember`, plus the version fields on `Get`, `Update`, `ImportCard` and `ImportResolve`.
  - `changeLaterVersions?` / `laterVersions?` on `Lorebooks.UpdateBinding` and on cast `Amendments.Create` / `Update`.
- `utils/index.ts`: `handleCharacterAvatarUpload({ …, cardVersionId? })`.

## Items
1. **The lift note is structured data.** It is stored as JSON in `note` on bases with `written_by='lift'`. No prose is stored; wave 3 words it.
2. **A story write with no anchor is refused** in words. With `messageId: null` the refusal comes before anything is written. When there is no open turn it comes after the overlay insert, and the caller's transaction rolls that back.
3. **The fork happens inside the write's transaction, after its checks** (`setValue`, `configure`, `recordToTimeline`).
   - A proposal never forks; the line forks when it is accepted.
   - When the line forks, the session's pending book-layer value proposals move onto the new line, so a second accept can't land on the parent's line. This was my call and was not in the lead's list.
   - `loreWriteTargetFor`'s other callers (`rulesets/ties.ts`, `runtime/host.ts`) still fork on the outer handle. They are not my files.
4. **The write-order contradiction** is settled by a §25 row: a story-write copy takes a new write order, and only a restored row keeps its own.
5. **No base is made at runtime.** Both write paths refuse with the lift's existing sentence. Six fixtures that relied on the lazy base now use `insertCastMember`:
   - `retold.int`
   - `amendments.int`
   - `lorebooks.mutationScoping.int`
   - `lorebooks.providedCast.int`
   - `narrativeGraph.updateScoping.int`
   - `sprites.pipeline.int`
6. **A parent's own book outlives it** (★cv-time-1, ruling §33.3).
   - **Schema and migration (my edit):** the FK on `lorebooks.session_id` is dropped in `schema.ts`, and **0146 is regenerated**.
     - The three files were backed up first to `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-fix-0146-backup/`.
     - No vite dev and no vitest were running.
     - The diff against the old 0146 is only `ALTER TABLE "lorebooks" DROP CONSTRAINT "lorebooks_session_id_sessions_id_fk"`.
     - The journal `when` is 1793964915000, above 0145's.
   - `sessions:delete` keeps the book while a live session's ancestry names the session. The last branch's delete purges its ancestors' kept books.
   - The boot sweep removes orphans. A test shows a second run is a no-op.
7. **`seatedBy` is now passed** at the create, update and add-character sites in `sockets/sessions.ts` (4 calls) and at both `sockets/import.ts` sites.
8. **The characters wire types moved into `types.ts`**, and the local types in `sockets/characters.ts` are dropped.
9. **The cross-card re-parent (G3), the label option and `lang` in `creatorNotesOf` are built.**
10. **U+0000 is stripped before the jsonb write.**
11. **The avatar upload sets the face through the versions module.**
    - The first version set the *current* version's face, and that broke "an older version's face stays its own".
    - I fixed it myself: `handleCharacterAvatarUpload` now takes `cardVersionId?`, and the editor's in-place save passes the version it writes. This removed a re-copy workaround in `sockets/characters.ts`.
12. **Book export writes each card as `cardAsOfVersion(row, current)`.** Only the card half; see Noticed.
13. **Nothing to build.** `users:delete` (`sockets/users.ts` ~875) is a **soft** delete. The only hard `delete(users)` is the attic's seed cleanup on a fresh restore. No card cascade happens, so `resolveFollows` has nothing to resolve.
14. **G1–G4 are built and wired.**
    - Link and swap in `sockets/lorebooks.ts` `writeMemberEdit`:
      - A link follows the fields the member form leaves unretold.
      - A swap keeps each version's own follows.
      - The form is undated, so it reaches every version.
    - In `sockets/amendments.ts`:
      - A dated card change re-parents from its date on.
      - Re-dating, editing a session-written change and removing a change all work.
      - The four provisional refusals and `assertSameCard` are gone.
      - I added one fix: a pure card change with **Change later versions too** on used to send an empty change to `writeCastVersion`, which throws. It now writes nothing more and answers `laterVersions` (test added).
    - `utils/forkHistory.ts` now calls `repointVersionHistory`.
    - `lorebooks/starterKits.ts` `ownCastCards`: copied members now name the copy's v1. This file wasn't in the brief's file list, but item 9 names `ownCastCards` as a user.
    - `plugins/providedBooks.ts`: a member whose card appears now follows it.
15. **Provided-book upgrades keep every member pinned.** The `updateMemberToCardVersion` move is removed. A test shows two upgrades in a row still treat the member as the plugin's.
16. **Done** (in `types.ts`). The local declarations in `lorebooks.ts` and `amendments.ts` are replaced.
17. **Confirmed, no change.** `canonicalCardOf` stays exported from `sockets/characters.ts`, and `sockets/lorebooks.ts` ~3387 uses it, so there is one compare rule.

## Changed files (all under /home/jody/github/serene-pub)
- **Source:**
  - `src/lib/server/characters/versions.ts`, `versionsLift.ts`
  - `src/lib/shared/characters/profile.ts`
  - `src/lib/server/state/write.ts`, `state/durable.ts`
  - `src/lib/server/lorebooks/sessionLine.ts`, `ownBook.ts`, `starterKits.ts`
  - `src/lib/server/db/schema.ts`
  - `drizzle/0146_character_versions.sql`, `drizzle/meta/0146_snapshot.json`, `drizzle/meta/_journal.json`
  - `src/lib/server/startup/index.ts`
  - `src/lib/server/sockets/sessions.ts` (the delete hunk and the seat sites), `sockets/import.ts`, `sockets/characters.ts`, `sockets/lorebooks.ts`, `sockets/amendments.ts`
  - `src/lib/shared/sockets/types.ts`
  - `src/lib/server/utils/index.ts`, `utils/lorebookExportBuilder.ts`, `utils/forkHistory.ts`
  - `src/lib/server/plugins/providedBooks.ts`
  - `NOMENCLATURE.md` §25: 7 rows appended at lines 3312–3318.
- **New tests:**
  - `characters/versions.authoring.int.test.ts`, `characters/versionsLift.test.ts`
  - `lorebooks/sessionLine.forkTiming.int.test.ts`, `lorebooks/keptOwnBooks.int.test.ts`
  - `sockets/seatedBy.int.test.ts`, `sockets/import.seatedBy.int.test.ts`
  - `utils/lorebookExportBuilder.currentVersion.int.test.ts`
- **Edited tests:**
  - `versions.test`, `versions.int`, `versions.write.int`, `versionsLift.int`
  - `ownBook.int` (it asserted the cascade), `db/characterVersions0146.int`, `media/avatarUpload.int`
  - `providedBooks.int`, `lorebooks.castVersions.int`, `starterKitsVersions.int`, `characters.versions.int`
  - `amendments.castVersions.int`, `amendments.int`, `forkHistory.versions.int`
  - The six item-5 fixtures listed above.
- **Worker briefs:** `plans/briefs/BRIEF-cv-fix-w1.md` … `-w6.md`.

## Tests
- **One grouped run** (`--maxWorkers=4`, 197 files): 1871 of 1874 pass. It covered:
  - `characters/`, `cast/`, `lorebooks/`, `sessions/`, `sprites/`, `annotations/`
  - the state durable, write, clockProposal, sessionLoreWrites, retractCastVersions and datedRows files
  - `sockets/{amendments,lorebooks,characters,import,seatedBy,sessions.seatCast,narrativeGraph}*`
  - `plugins/providedBooks*`, `providedPrimers`
  - `utils/{forkHistory,lorebookExportBuilder,characterBindingSync,characterCardParser,personaCard}*`
  - `db/characterVersions0146`, `media/avatarUpload`, `messages/permissions`
- **The 3 failures are all in `sessions/genreFieldDefaults.int.test.ts`, not this lane.** The Lair defaults now also carry `ownerSheetLatitude`, `sessionLanguage`, `speechNarratorVoice` and `speechReadAloud` (genre/speech fields), and the test's expectation lacks them.
- **After the amendments fix:** `amendments.castVersions.int` and `amendments.int` pass 63 of 63.
- **`tsc`:** errors only in `src/lib/client/sessionLayout/*` (another lane's in-flight files).
- **Prettier:** the new test files are clean. Old files were already unclean, so only our hunks are formatted.

## Open ★ and provisional words (for the owner's batch)
- **★cv-fix-1: where the lift note is stored.** I kept it as JSON in the existing `note` text column, with no schema change; it lives as long as the lift does. The alternative is a `jsonb` lift-note column, which 0146 could still take cheaply now. Recommendation: keep it as is.
- **Provisional refusal sentences (🚧):**
  - "A session's change to a cast member needs the turn it belongs to, and this one names none; an author's change uses a place on the member's line instead."
  - "There is nothing to change in that cast version."
  - "The first cast version is who they are from the start, so it cannot be moved to another date or line."
  - "The first cast version is who they are, so it cannot be removed; remove the cast member to remove them."
  - "‹name› already has a change of their own at that date and place, so this one can't be moved there; edit that one instead."
  - "That cast version has been replaced by a later change, so it can't be edited." This is w3's guard on retired rows.
  - "Character version N is a card version, not a cast member's; card versions are changed from the card."
  - "Card N does not exist, so ‹name› cannot be moved onto it."
  - "A cast version cannot follow ‹fields› with no card to read them from."
- **Choices made inside scope, for the lead to confirm:**
  - G3 edits in place with no retire mark.
  - A re-date clears `historyEntryId`, because `Amendments.Update.Params` has no field for it.
  - An empty or whitespace label on an in-place save is ignored.
  - A pure dated card change writes a no-op `nodeState` carrier version at that date.
- ★cv-core-1 (the lift note's wording) moves to the wave-3 admin list.

## Queued (not my files)
- **`docs/sessions.md` "Delete a session" (~335):** "Deleting a session removes its Session notes too, unless a branch of it still reads them; the notes then stay, hidden, until the last branch is deleted."
- **`docs/lorebook-cast.md` / `docs/lorebook-time.md`:**
  - "Changing a card at a date: the change and every later change of that member follow the new card; when the member had no card, the fields they didn't retell follow the card from that date on; earlier changes stay as they were."
  - "A change can be moved to another date, and a change a session wrote can be edited or removed from the Changes list."
  - "Linking a card to a member makes it read the card, except for fields you retell; switching a member's card keeps what you retold and reads the rest from the new card."
- **`docs/characters.md`:** "Saving a card version in place with a changed version label renames that version." This needs the wave-3 client.
- **`rulesets/ties.ts` and `pipelines/runtime/host.ts`** still call `loreWriteTargetFor` on the outer handle. They fork before their writes, and two first writers can race.
- **The `genreFieldDefaults.int` expectation** belongs to whoever added the four genre fields.
- **Scope review:** I didn't run a `scope-reviewer`; per the guide that is the accepting lead's. Files outside the brief's lists:
  - `lorebooks/starterKits.ts` (item 9 names `ownCastCards` as a user)
  - the six item-5 fixtures
  - `media/avatarUpload.int`, `ownBook.int`, `characterVersions0146.int`

## Noticed, not done
- **Book export, member half:** the export still writes own names and sprite set from the frozen binding columns (`lorebookExportBuilder.ts` ~190).
- **Provided books:** the "card appears" branch is rarely reached. The member's file key changes from `t:` to `u:`/`n:` when a card appears, so a plain upgrade treats it as a new member.
- **Avatar callers:** callers of `handleCharacterAvatarUpload` (characters create, duplicate and import, `personaCard`, `starterKits`) still do their own follow-up face write, which is now redundant.
- **Duplicates that could be merged:**
  - `creatorNotesOfCard` (`cardIO.ts`) now duplicates `creatorNotesOf`.
  - `ownCastCards` still re-writes `creatorNotes` for `lang`, which is now redundant.
  - `amendments.ts` `isBaseVersion` duplicates a private `isBase` in `versions.ts`.
- **NUL in card columns:** `insertCard`'s own `characters` text columns aren't NUL-stripped, so a NUL in a card field still fails the card insert.
- **Re-date plus fields edit:** a combined request computes its changes against the version before the old date.
- **Setavatar emit:** setavatar's `characters:update` emit carries only `{character}`, while `Update.Response` now requires the three card-version fields. A wave-3 listener should treat them as optional on that event.
- **Pre-existing "no lorebook" wording:** the `schema.ts` doc on `lorebooks.session_id` ("when it has no lorebook") and `annotations` `EMPTY_VOCABULARY` predate this lane.
- **0146 regeneration:** it assumes 0146 isn't applied on any lasting database (the lead's statement). A database that ran the old 0146 would re-run it under the new `when`.

## Scope review (lead, 2026-11-06) — in scope; five findings → lane cv-fix2 (after cv-guards)
1. HIGH removing or re-dating a dated card change leaves the card switch on later versions (the carrier is removed/moved, the re-parent stays) → remove re-parents later versions back to the card in force before it; re-date moves the re-parent to the new date; same transaction; tests.
2. HIGH `reparentCastVersions` applies one `follows` set to every version, wiping later versions' own words (★CV-13: later versions keep their own words) → `follows` worked out per version: a field follows the new card only where that version did not write it itself.
3. HIGH a member-page link carried no date and reached every version (the lead's brief glossed "undated = from the start") → **owner 2026-11-06: "The book's present"** — a link from the member page applies from the book's present; earlier versions keep their own words; the provided-book "card appears" path the same.
4. MEDIUM G3 edited in place with no retire mark (against §33.2) → rows a descendant reads go through the retire-then-copy step, retired rows untouched.
5. MEDIUM a cast re-date cleared `historyEntryId` → keep it (the entries rule).
Also: the journal `when` (…000) — confirm it was generated; one line in the report.
