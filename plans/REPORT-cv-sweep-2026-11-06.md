# REPORT cv-sweep (2026-11-06)

No status question was relayed to this lane. All five items are built.
- **Tests:** one grouped targeted run passed, plus one re-run: **35 of 35 files and 447 of 447 tests** (`--maxWorkers=2`).
- **Typecheck:** `npx tsc --noEmit -p .` shows **0 errors** project-wide.
- **Rules kept:** no `sdk:build` (no SDK change), no commit, no `git stash`. I edited no cv-sdk file (`host.ts`) and no cv-client file.
- **Workers:** four Sonnet workers, never more than two at once. Briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-sweep-wcommon.md` and `-w1.md` through `-w4.md`.
- **Report file:** the harness refused my write to `plans/REPORT-cv-sweep-2026-11-06.md`. This message is the only copy; please save it there.

## Names and signatures (🚧)
- **`CAST_VERSION_TAG_COLUMNS`** in `characters/versions.ts`: the cast-version columns a cast tag can sit in. They are name, nickname, aliases, summary, description, personality, scenario, greetings, exampleDialogues, postHistoryInstructions and creatorNotes.
- **`writeCastVersionTagText(tx, versionId, set): Promise<void>`** in `characters/versions.ts`:
  - It writes in place, retired rows included, with no retire step.
  - Why: a tag rewrite renames a member for every line. Retiring the row would leave a branch reading a tag that names nobody.
  - It refuses a card version, an unknown id and any column not in the list. It strips NUL.
- **`castVersion`**: a new cast-tag site in `utils/castTags.ts`.
  - Its write goes through the writer above, by a lambda.
  - The site spec gained an optional `write` delegate (internal `CastTagSiteSpec` / `writeSite`). The rewrite and the undo both use it.
- **Exported for tests only:** `loadAdapterSession` (`pipelines/runtime/dispatch.ts`) and `getPromptSessionFromDb` (`sockets/sessions.ts`).
- **Private to their files:**
  - `putCardsNow(groups, { only?, avatar? })` in `sockets/sessions.ts`: lays each seat's card as `cardsNow` has it over the relational row, with one `cardsNow` call per read.
  - `BINDING_FROZEN_OFF` in `sessions.ts` and in `dispatch.ts`.
- **Removed:**
  - `CastTagRows.castAmendment`.
  - `castOverlaysFor` and `castMemberAt` in `state/entriesOnReading.ts`. Nothing called them, in product code or tests.

## Items
1. **Cast tags in versions (★cv-readers-1, restores A16).**
   - A merge rewrites the absorbed member's tags in every cast version of the book, retired rows included, and keeps undo notes.
   - A delete writes the member's name in place of the tags, in live versions and in the merge logs' saved `castVersions` too.
   - Undoing a merge puts the tags back by position. The restored member's own versions are resolved through the new `castVersion:` restored ids.
   - Card versions are never touched.
2. **A deleted card's followers (★27-6).**
   - `characters:delete` and the provided-book uninstall (`deleteProvidedBooks`) now run `resolveFollows(tx, { cardId })` in the same transaction as the soft delete. It only runs for a card that was actually deleted, so deleting someone else's card resolves nothing.
   - My decision: **no detach.** The versions keep their parent, so they stay consistent with `lorebook_bindings.character_id`, which a soft delete leaves pointing at the card. Only the words move.
   - The user cascade has nothing to do: users are soft-deleted and their cards stay.
   - The tests show the member reads the same words before and after, and the seat plays on.
3. **The `castAmendment` leftovers.** The `castAmendment:` key is gone from `narrativeGraph.ts`'s undo-merge, and the ⏳ `CastTagRows.castAmendment` is gone with it.
4. **Relational whole-card reads.**
   - The sessions list, `sessions:get`, the prompt session (live seats, removed seats and the book's bindings' cards) and the participant-sync name fallback now take card content from `cardsNow`. Ids, library facts and `spriteSets` stay on the relational read.
   - `avatarMedia` comes from the version's face.
   - The reassign path and `previewCastFor` are narrowed to `{ id, userId }` and `{ id }`.
   - `loadAdapterSession` reads its seats through `cardsNow`.
   - The two relational binding reads (prompt session and adapter session) leave out the 14 frozen binding columns.
   - w2 had added a `character` relation to the adapter session's bindings, which nobody asked for. I had it reverted, so that shape is unchanged.
   - The wire shapes are unchanged.
5. **The last `cast_amendments` reads.**
   - The `seat-members` boot pass's dated-card check now reads `character_versions`: a cast version in one of the session's books whose parent card version is of the seat's card.
   - I confirmed it agrees with `settleSeats` (`memberOfCard` / `cardTakenBy`). A second run changes nothing.
   - The `entriesOnReading.ts` header and the `cardMemberAt` JSDoc in `amendments.ts` no longer point at the removed functions.

## Changed files
- **Product code** (under `/home/jody/github/serene-pub/src/lib/server/`):
  - `characters/versions.ts`: the writer only.
  - `utils/castTags.ts`.
  - `sockets/narrativeGraph.ts`: `rewriteMergeLogCastTags` and the undo-merge restored rows.
  - `sockets/sessions.ts`: the listed sites, `putCardsNow`, and the `export` on `getPromptSessionFromDb`.
  - `sockets/pipelines.ts`: `previewCastFor`.
  - `pipelines/runtime/dispatch.ts`: `loadAdapterSession`.
  - `sockets/characters.ts`: `charactersDelete`.
  - `plugins/providedBooks.ts`: `deleteProvidedBooks`. I also merged a duplicate import a worker added.
  - `sessions/seatMembers.ts`.
  - `state/entriesOnReading.ts`.
  - `sockets/amendments.ts`: the JSDoc only.
- **New tests:**
  - `sockets/narrativeGraph.castVersionTags.int.test.ts` (5 tests)
  - `sockets/sessions.cardsNowReads.int.test.ts` (4 tests)
  - `pipelines/runtime/dispatch.cardsNow.int.test.ts`
- **Tests extended:** `sockets/characters.softDelete.int.test.ts`, `plugins/providedBooks.int.test.ts`, `sessions/seatMembers.int.test.ts`.
- **Fixtures only, no `expect` changed:**
  - `pipelines/runtime/dispatch.int.test.ts`: a `vi.mock` of `cardsNow` returning an empty map, because the fake db cannot serve the read.
  - `sessions/seatMembers.int.test.ts`: three `cast_amendments` dated cards are now cast versions.
  - `state/entriesOnReading.int.test.ts` (me): the member is made with `insertCastMember`, and the Y2 rename plus card swap is a dated cast version instead of a `cast_amendments` row. This was cv-readers fallout: 2 tests were red before this change.
- **`/home/jody/github/serene-pub/NOMENCLATURE.md` §25:** one row appended after cv-readers' row (line 3354). I re-read the file before the edit.

## Tests
- **The grouped run** (`--maxWorkers=2`) covered 35 files:
  - narrativeGraph `castVersionTags`, `deleteNode`, `mergeSnapshot` and `undoMergeVectorized`; `castTags` (unit and `lorebooks.castTags.int`);
  - the `versions` suites (`test`, `int`, `write.int`, `authoring.int`) and both guards;
  - the `sessions.*` files: `cardsNowReads`, `castBindings`, `fireTurn.seatedMember`, `listLastMessage`, `participantRemoval`, `participantWritesAnswer`, `seatCast`, `updateKeepsTags`;
  - `dispatch.int`, `dispatch.cardsNow.int`, `pipelines.previewRetrieval` and `previewRetrievalAdmin`, `seatCards` (unit and int);
  - `characters.softDelete`, `providedBooks`, the three `seatMembers` files, `castMemberLifecycle`, `amendments.int`, `amendments.castVersions.int`, `entriesOnReading.int`.
- **Result:** 34 files and 445 tests passed. The 2 failures were in `entriesOnReading.int`, the stale fixture described above. After the fix, that file passed 8 of 8.
- **The log** is `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-sweep-run.log`.
- **The cv-sdk load error is gone.** w2 saw four `sessions.*` suites fail at load with "core binds a handler to core:query/cast-member@1 … which no type in this build declares". All four passed in my run.
- **Temp dirs:** the `/tmp/serene-pub-vitest-*` listing was the same before and after (11 dirs, none mine), and I deleted none.
- **Prettier:** the new test files are clean. The product files were already unclean at the start, so only our own hunks were formatted. The `entriesOnReading.int.test.ts` file was already unclean too; my hunk matches prettier.
- **Not run:** a `scope-reviewer`. Per the guide, that belongs to the lead when accepting the lane.

## Open ★
None new.
- **Decided inside scope (named for the lead):**
  - No `detach` on a card delete.
  - Tag rewrites are in place, retired rows included.
  - The list of tag-bearing columns.
  - Test-only exports of the two loaders.
  - The `vi.mock` fixture in `dispatch.int`.
- **No docs line queued.** Nothing a user sees changes:
  - The tags follow members as A16 already documents.
  - A deleted card's members already read its words.
  - The card reads match the copies, because copies are kept current.

## Noticed, not done
- `library/writes.ts` `undoLibraryChange` hides a made card on undo without resolving its followers. A Forward can bring the card back, so resolving there needs a ruling: does Forward re-follow?
- The delete's `nameInProse` (`narrativeGraph.ts`, about line 3640) is the name written in place of a deleted member's tags. It reads `lorebook_bindings.name`, or else the card row, and not the member as read.
- Whole-card relational reads outside this brief:
  - `sessions/greetings.ts` lines 133, 139 and 267 (`with: { character | persona: true }`), which is on the session path;
  - `sockets/lorebooks.ts` line 1527.
  - The prompt session's live-seat relation still loads whole rows, though its content is overwritten from `cardsNow`.
- The prompt session's bindings carry `.character` and the adapter session's don't. This is as before, and now deliberate.
- The `cardMemberAt` JSDoc (`sockets/amendments.ts`) still says "or no book at all", which goes against "every session has a lorebook".
- `cast/memberAsRead.ts` line 139: a comment still says "already `castMemberAt`-resolved".
- `characters.embed_text_hash` is still unread (cv-readers' note).