# REPORT cv-guards (2026-11-06)

No status question was relayed to me.

All 11 items are built, and both guard tests pass.
- **Tests:** one grouped targeted run covered 286 files: 282 passed and 4 failed (9 tests). All four failures were members inserted raw in test setup; they now pass after worker w5 switched them (26 of 26).
- **Typecheck:** `npx tsc --noEmit -p .` shows no errors at all.
- **Rules kept:** no `sdk:build` (there was no SDK change), no commit, no `git stash`.
- **Workers:** five Sonnet workers, never more than 2 at once. The lane brief says one worker and your launch message says at most two; I stayed within the two.

**Most important open question:** ★cv-guards-1. About 65 spots on the session path still read a card's current name, nickname, avatar or description. The guard lets them through for now, pending your ruling.

## Names and signatures (🚧)
- `insertCastMemberCopy(tx, values): Promise<MemberRow>` in `characters/versions.ts`. It inserts one member with no base version. Only the book copy (`tableRegistry.ts`) uses it, because the member's versions are copied right after.
- `isBaseVersion(v)` is exported from `versions.ts` (it was the private `isBase`). `sockets/amendments.ts` now uses it instead of its own copy.
- **Removed:**
  - From `lorebooks/retold.ts`: `retoldMembersForSession`, `retoldByCard`, `castIdentityExtras`, `applyRetold`, `RETOLD_MEMBER_COLUMNS`, `asRetoldMember`, `RetoldMember`, and `retellsAnything` (it had no caller in product code).
  - From `characters/cardIO.ts`: `creatorNotesOfCard`. `creatorNotesOf` is the only one now.
  - From `ties.ts`: the `branchId` field of `Routing`.
- **Test helper** (w2, beyond the brief; keep or drop): `insertDatedCardVersion(db, memberId, cardId, year)` in `pipelines/testing/fixtures.ts`. It replaced about 15 copy-pasted `castAmendments` fixture inserts.
- **Guards:**
  - Guard 1: `characters/versionsWriter.guard.test.ts`. Nothing outside `versions.ts` may insert into `characters`, `lorebook_bindings` or `character_versions` (raw `INSERT INTO` SQL included). The attic and test files are out of scope. Its allowlist is empty.
  - Guard 2: `characters/frozenColumns.guard.test.ts`, the frozen-column sets from §31 §8, with session-path rules for the four card copies.
  - Both use one shared scanner, `characters/guardScan.ts`, built on the TypeScript compiler API. Its allowlists are checked both ways, so an entry that no longer matches anything fails too.
  - Blind spots, stated in the headers: spreads, whole-row selects, relational `with:`, and table handles passed as parameters.

## Items
1. **Insert guard.** It passes; the one site it found (the book copy) now goes through `insertCastMemberCopy`.
2. **Frozen-column guard.** It passes with these allowlist entries:
   - The provided mark on `characters.extensions`, read in `providedBooks`, `providedPrimers`, `appletLibrary`, `seatBookCast` and `sockets/characters.ts` (`keepStoredProvidedMark`). The same mark is written by `stampProvidedCharacter` in `providedBooks` and `providedPrimers`. Both follow your 2026-11-05 cv-writers ruling.
   - `castHashNow`'s read of `characterVersion`, which was already ruled.
   - The session-path card-copy list, pending ★cv-guards-1.
3. **The old read is gone.**
   - `membersAsRead` now leaves out a member with no version that reads on the reading. It logs `console.error` once per member, with one sentence for "no version at all" and another for "versions, but none reads here".
   - `MEMBER_COLUMNS` is now `id`, `lorebookId` and `characterId` only.
   - `layerMemberAsRead` stays, only for the boot lift to compare against.
4. **Sites the guard found, all fixed:**
   - Every "a member with no version keeps its columns" fallback is gone: `amendments.ts` (now throws the existing lift sentence, so the provided-book check never runs blind), `sockets/lorebooks.ts` `wornStored`, four spots in `narrativeGraph.ts`, and `characterBindingSync.ts`.
   - Card aliases and the card's summary/description fallback now come from the card's current version.
   - `forkHistory.ts` no longer re-points `cast_amendments` (the FK is SET NULL, so nothing is stranded).
   - **The ruleset's cast-state landing wrote the frozen `node_state`, so a ruleset's state change was lost.** It is now a story write through `writeCastVersion`: Back takes it, and it writes nothing when the member already reads that state.
   - Media access to member faces reads versions (only faces the version holds itself; retired rows included).
   - `jump.ts` session search by a member's own name matches any of that member's versions.
   - The graph context and graph links read `membersAsRead`, not `castMemberAt` over the frozen columns.
   - `sideCharacter`, `cardAction`, `illustrateScene` and `resolveVoice` read likeness, timbre, personality and description from the card's current version.
5. **The book export's member half** writes each member's base version, read once for the whole book through `memberColumnsOfVersion`.
6. **`insertCard` strips U+0000** from every string, array or object value before the insert. A test covers it.
7. **Redundant writes and duplicate helpers.**
   - The follow-up face writes are gone in create, import (it now passes `cardVersionId` to the upload), duplicate, `personaCard` and `starterKits`.
   - The `creatorNotes` rewrite in `ownCastCards` is gone.
   - `creatorNotesOfCard` and the duplicate `isBaseVersion` are merged into one each.
8. **The line forks inside the write's transaction.**
   - `ties.ts` routes without forking; `rowForSide` forks with `ensureSessionLine(tx)` and stamps the row with the line that call answers.
   - In `host.ts`, `create-lore-entry` and `link-lore-entries` fork at the start of their write transaction; a refusal rolls the fork back.
   - `update-lore-entry` refuses a first write from a session still riding its parent's line before any fork (`pendingLineFork`).
   - Fork-timing tests: the new `host.forkTiming.int` and additions to `ties.int`.
9. **The dead readers in `retold.ts` are retired.** The tests that used them as an oracle now carry the literal values those functions produced.
10. **The book copy uses `insertCastMemberCopy`**, and the `castAmendments` copy is marked `notCopied` (§32 §8: "moves onto versions").
11. **Fixtures.**
    - `insertNarrativeNodeRow` now sends frozen fields to the member's base through `updateCastVersion`.
    - `sprites.pipeline` `scene()` and `retold.int` `cast()` already used `insertCastMember`, so nothing changed there.
    - Deleting the old read broke 40 test files that inserted members raw. They now use `insertCastMember`; w2's report lists them all. The last four were `relationshipSearch.int`, `relationshipsRendered.int`, `eligibilityGates.int` and `sessionPlaces.int`.

## Changed files (product code, under `src/lib/server/`)
- `cast/memberAsRead.ts`, `characters/versions.ts`, `characters/cardIO.ts`
- `lorebooks/retold.ts`, `lorebooks/tableRegistry.ts`, `lorebooks/starterKits.ts`
- `pipelines/testing/fixtures.ts`, `pipelines/prompt/seatCards.ts` (a comment only)
- `pipelines/runtime/host.ts`, `pipelines/runtime/cardAction.ts`, `pipelines/runtime/illustrateScene.ts`, `pipelines/entities/sideCharacter.ts`
- `sockets/amendments.ts`, `sockets/lorebooks.ts`, `sockets/narrativeGraph.ts`, `sockets/characters.ts`, `sockets/jump.ts`
- `utils/characterBindingSync.ts`, `utils/forkHistory.ts`, `utils/lorebookExportBuilder.ts`, `utils/personaCard.ts`, `utils/graphContextFormatter.ts`, `utils/graphEntryLinks.ts`
- `rulesets/ties.ts`, `media/access.ts`, `speech/resolveVoice.ts`
- New: `characters/guardScan.ts`, `characters/versionsWriter.guard.test.ts`, `characters/frozenColumns.guard.test.ts`
- New tests: `host.forkTiming.int`, `media/access.memberFace.int`
- Edited tests: about 55 files, listed in the worker reports.
- `NOMENCLATURE.md` §25: one row appended at line 3350, in the character-versions table.
- Worker briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-guards-w1.md` through `-w5.md`

## Tests
- **Grouped run** (`--maxWorkers=2`), 286 files: the 160 files that insert members raw (all 160 passed before the change), plus `cast/`, `characters/`, `lorebooks/`, `rulesets/`, `media/`, `speech/`, plus every test file of each touched socket, util and runtime module, plus every test that imports `insertNarrativeNodeRow`, `graphContextFormatter` or `graphEntryLinks`.
  - Result: 282 of 286 files and 2693 of 2702 tests passed.
  - The 4 failing files (9 tests) were raw-member fixtures; they pass after w5's fix (26 of 26).
- **Guards:** 8 of 8 pass.
- **Prettier:** the new files are clean. In old files only our own hunks were formatted, because several owned files weren't prettier-clean before this lane.
- **Temp dirs:** another session's full `vitest run --maxWorkers=3` was running the whole time. The `/tmp/serene-pub-vitest-*` dirs created during my runs are gone. The ten from 03:39 predate this lane, and the four from 06:05 belong to that live run. I deleted none.

## Open ★
- **★cv-guards-1: about 65 session-path spots still read the card's current name, nickname, avatar or description.** They are in 25 files: seats, `turnPlan`, `rowProjection`, `dispatchSpeech`, `chains`, `rewind`, `handEdits`, `resolve`, `write`, `zones`, `ties`, `sprites`, `sockets/sessions` (6), `state`, `pipelines`, `jump`, and others. There are also 5 whole-row `select().from(characters)` reads in `host.ts`.
  - None of them is stale: the copies are kept in step with the current card version. But they read the card rather than the seated cast member, and §31 §8's guard says the session path never reads them.
  - Moving them would change what users see (a seat or speaker shows the member's own or evolved name instead of the card's), and it is a lane-sized job.
  - What I did: they are listed in `SESSION_COPY_READS` in the guard, so no new one can be added. **My recommendation:** a follow-up lane moves them onto `membersAsRead`.
- **Provisional internal error sentences (🚧):**
  - "A cast member's state is written in a session." (`ties.ts`; every caller passes an anchor today)
  - "That cast member hasn't been moved onto character versions yet; restart the server so the upgrade lifts them." (`amendments.ts`, reusing the existing lift sentence without the member's name)
- **Choices for you to confirm:**
  - The guards leave test files out of scope.
  - In `host.ts` the fork sits at the start of each write transaction rather than after the checks; a refused write still forks nothing.
  - The `illustrateScene` and `cardAction` card halves call `ensureCardVersion` once per card.
  - The graph context's legendary layer reads every member of the book in one batched call.

## Queued (not my files)
- `shared/characters/profile.ts`: `creatorNotesOf`'s doc comment still says it drops the language key. It keeps it now.

## Noticed, not done
More code still reads the old frozen data. The guard can't see these (whole rows, generic table handles, `cast_amendments` reads), so dated changes written as versions are invisible to all of them. I recommend fixing them in the same follow-up lane as ★cv-guards-1:
- `castMemberAt` / `castOverlaysFor` still fold `cast_amendments` over whole member rows in:
  - `state/lorebookState.ts` (~121–136)
  - `pipelines/runtime/host.ts` (~4215, ~5051)
  - `pipelines/entities/sideCharacter.ts` `lorebookNames`
- `cast/seatedCast.ts` `sessionsDrawingCard` finds sessions through `cast_amendments.fields->>'characterId'`. It feeds session access, `conversations/store.ts` and `sessions/backdrop.ts`, and `conversations/store.ts` ~1160 has the same `EXISTS` check. So a card change dated through a version doesn't count there; w2 kept the old amendment rows in those tests so they still pass.
- `utils/castMemberCards.ts` still reads dated cards from `cast_amendments` (lines 40–221). The `{{char:N}}` tag reader takes member names from `cast_amendments`, and `utils/castTags.ts` lists `cast_amendments` as a tag site; w4 had to keep one amendment row in `promptAtReading.int` because of that.
- `narrativeGraph.ts` ~4795: undoing a merge re-inserts `cast_amendments` rows from the saved snapshot. It is a faithful restore of the old rows, but it is a write the guard can't see.
- `forkHistory.ts` ~229 and ~473 still read `cast_amendments` (they keep entries and lines alive; harmless).
- `lorebooks/imprints.ts`: a stored member `nodeState` imprint, if ever undone, would write the frozen column. Nothing creates such imprints any more.
- `graphContextFormatter.ts` still applies `ruleFedOverlayOf(...).castStates` (★5). The cast-state landing is now a story write, so I couldn't confirm anything still writes that overlay.
- `narrativeGraph.ts` `withStoryStates` has a dead `else row` branch.
- The member-sheet test now shows the first greeting as the opener (`firstMessage` / `alternateGreetings` split differently). That is the versions read, and the assertion was updated.
