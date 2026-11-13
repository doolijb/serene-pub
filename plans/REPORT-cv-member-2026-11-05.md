# REPORT cv-member (2026-11-05)

Status question: none was relayed. Wave 2's member side is built. Member saves, the name and alias sync, the Changes list, new dated changes, the narrative graph, the book copy, the calendar's dated rows, the entity vocabulary and the seat payloads now read and write cast versions. Nothing in the lane writes `cast_amendments` or the frozen member columns any more.

Three things are still blocked, all for the same reason: `characters/versions.ts` (cv-time's file this wave) has no function to re-parent a version onto a card, or to delete or move a version written by hand. Until it does, those actions refuse in provisional words.

My last grouped targeted run passed: **104 files, 1022/1022**. `npx tsc --noEmit -p .` shows nothing beyond the old `arrangeCanvas` error. My runs left no `/tmp/serene-pub-vitest-*` dirs (I compared listings before and after), and I deleted none. I ran no `sdk:build` and no dev server.

## Names and signatures (all private helpers unless listed here)
- `src/lib/server/lorebooks/retold.ts`:
  - 🚧 ⏳ `memberColumnsOfVersion(version, { carded }) → MemberColumnsOfVersion` (an exported interface). It turns a cast version back into the member row's column names; a field counts as retold when it is not in `follows`. The client reads this until wave 3.
  - 🚧 `castChangesOfMemberEdit(before, after, card) → CastVersionChanges | null`. It is the one mapping from those column names to version changes. It runs `memberProfileOf` and only emits fields the edit touched.
- 🚧 Wire, typed locally because `shared/sockets/types.ts` isn't mine:
  - param `changeLaterVersions?: boolean` on `lorebooks:updateBinding` and on cast `amendments:create` / `amendments:update`;
  - reply `laterVersions: { changed, kept }` on the same three.
- `insertBackgroundBinding(…, opts?: { writtenBy? })` gains an optional 4th parameter.
- The calendar's dated-row key for a cast change is now `castVersion:<id>`. Nothing parses the key prefix; the only consumer is a Svelte each-key.

## What changed
- **`sockets/lorebooks.ts`**
  - **Inserts:** all four member insert sites go through `insertCastMember`.
  - **Reads:** the cast list, `bindingsForCharacter` and the replies to `updateBinding` and `createBinding` show the member's base version through `memberColumnsOfVersion`.
  - **`updateBinding`:** writes the base version through `writeCastVersion` (author path, at the base) inside its existing locked transaction. Frozen keys no longer go to the binding row. The provided-book check, the face check and "own names changed" compare against the base version.
  - **Unlink:** runs `resolveFollows({ detach })` first, so the member keeps the card's words as its own.
  - **★CV-13 option:** with `changeLaterVersions`, the same changes go onto the member's later hand-written versions on main. Versions a session wrote keep their own words.
  - **Other paths:** `createBinding`'s extra fields and the import's graph restore write versions too. `listMemberFaces` now reads faces from versions.
- **Lead's request, done:** the embedded-card import calls `addCardVersionFromParsedData`, after a comparison with the card's current version.
  - To compare the same way the card import does, I made `canonicalCardOf` exported in `sockets/characters.ts`. **That is a one-word edit in cv-writers' file.** Without it, `matchEmbeddedCharacter`'s raw-hash compare called an unchanged card "different", so every import would add a version (`lorebooks.import05` caught it: `charactersRewritten` was 1, should be 0). Please confirm or move it.
- **`utils/characterBindingSync.ts`** (`syncLorebookBindingsForCharacter` only): reads own names from the base version, and writes the merged aliases to the base as well (`user:<card owner>`). This closes cv-core's "new members read with no aliases".
- **`sockets/amendments.ts`**
  - **List:** the cast half lists non-base, non-retired cast versions. Each row's `fields` is what differs from the version before it, in the old column names (★CV-20).
  - **Create:** writes through `writeCastVersion` (author path at the date, line and life point).
  - **Update:** edits the fields of a hand-written version in place.
  - **Delete:** a version a session wrote goes through `retireOrTakeVersions`.
  - **`cardMemberAt`:** reads versions, with the same signature and return shape.
  - No `castAmendments` reference remains in the file.
- **`sockets/narrativeGraph.ts`**
  - **State reads:** node state and visibility come from the version in force at the head of the build's line (Main's head for the list).
  - **Writes:**
    - A new member from a proposal, and the undo-merge re-insert, go through `insertCastMember`.
    - A state update is an author write at the key of the version in force.
    - A filled summary keeps the base in step.
  - **Merge / undo:** a merge saves the absorbed member's versions, and undo puts them back.
  - **Links:** `memberIsLinked` also counts a dated version.
  - **Display names:** the build's display names read own names from versions.
- **`lorebooks/tableRegistry.ts`:** registers `character_versions`.
  - It copies through `insertCharacterVersions`, remapping member, line and history entry. It keeps the parent card version, the write order and the retire mark, and nulls `validFromMessageId`.
  - Purge is the default delete by book. `tableRegistry.test` is green again.
- **`utils/forkHistory.ts`:** the history-keeping reads now include cast versions (reads only; the re-point gap is below).
- **`state/storyTime.ts` `datedRowsOf`:** lists dated cast versions with the same label as before (_Amendment to …_), and no longer lists `cast_amendments`.
- **`annotations/index.ts` `amendedNamesOf`:** the cast half reads the versions' own names and aliases.
- **`sessions/rowProjection.ts` `sessionsWithMemberWords`:** one EXISTS over the member's versions (own name, nickname or face, or any version that isn't the base).
- **`NOMENCLATURE.md` §25:** 3 rows appended at the end of the table (now lines 3309–3311): the member save and its two helpers; `changeLaterVersions` / `laterVersions`; the Changes list as versions.
- **`castOwnNames.ts`:** doc comment only.

## Changed files (all /home/jody/github/serene-pub/src/lib/server/…)
- **Source:**
  - `lorebooks/retold.ts`
  - `lorebooks/castOwnNames.ts`
  - `sockets/lorebooks.ts`
  - `utils/characterBindingSync.ts`
  - `sockets/amendments.ts`
  - `sockets/narrativeGraph.ts`
  - `lorebooks/tableRegistry.ts`
  - `utils/forkHistory.ts`
  - `state/storyTime.ts`
  - `annotations/index.ts`
  - `sessions/rowProjection.ts`
  - `sockets/characters.ts` (only `export` added to `canonicalCardOf`)
- **New tests:**
  - `lorebooks/retold.test.ts`
  - `sockets/lorebooks.castVersions.int.test.ts`
  - `sockets/amendments.castVersions.int.test.ts`
  - `sockets/narrativeGraph.castVersions.int.test.ts`
  - `lorebooks/tableRegistry.versions.int.test.ts`
  - `utils/forkHistory.versions.int.test.ts`
  - `state/datedRows.versions.int.test.ts`
  - `annotations/versionNames.int.test.ts`
- **Updated tests** (fixtures move to versions; asserts move from frozen columns to versions or reads):
  - `castOwnNames.int`, `lorebooks.import-export.int`, `lorebooks.import05.int`, `lorebooks.providedCast.int`, `lorebooks.duplicate.int`
  - `amendments.int`, `retold.int`
  - `castMemberLifecycle.int`, `sprites/sprites.pipeline.int`
  - `narrativeGraph.rebuildRelationships.int`
  - `annotations/amendedNames.int`
  - `rowProjection.{seatCast,batch,castNames,playerSeats}.int`
- **Where the behaviour changed, the tests assert the new behaviour:**
  - a dated card change is now refused;
  - a cast list row's `fields` is a diff;
  - `cast_amendments` is never written.
- **Worker briefs:** `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-member-w1.md` … `-w5.md`.

## Tests
The grouped run (`--maxWorkers=4`) covered:
- `retold.test`, `retold.int`, `castOwnNames.int`, all `sockets/lorebooks.*`
- `characterBindingSync*`, `src/lib/server/characters`, `src/lib/server/cast`, `tableRegistry*`
- `forkHistory.versions`, all `sockets/amendments*`, `datedRows.versions`, `calendarInvariants`
- `src/lib/server/annotations`, `rowProjection*`, all `sockets/narrativeGraph*` (23 files)
- `castMemberLifecycle`, `src/lib/server/sprites`, `lineSql.int`, `sockets/characters*`

**104 files, 1022/1022 pass.**

## Open ★ and blockers (for the lead and owner)
1. **★cv-member-1, the missing writers in `characters/versions.ts`.** These are the only file-gated blockers. Suggested signatures:
   - **G1** `updateCastVersion(tx, versionId, { changes?, place?: {branchId, date, historyEntryId, personalPosition} })`: edits one version in place. It also covers a version a session wrote (★CV-2), and retires the row first when a descendant reads it (§33.2).
   - **G2** `deleteCastVersion(tx, versionId)`: deletes a hand-written version and refuses the base. (`retireOrTakeVersions` skips rows with no source session.)
   - **G3** re-parenting a member, or one version, onto another card (link, card swap, dated card change). This one needs a ruling first, **★cv-member-2**: when a card-less member is linked or swapped, do its later dated versions follow the new card too? My recommendation is base plus versions whose parent was the old card or none, with follows from `memberProfileOf`. Trade-off: later versions stop keeping their own words for unretold fields, which is today's behaviour.
   - **G4** `repointVersionHistory(tx, from, to, branchIds)`, for `forkHistory`'s copied history entries.
   - cv-writers also queued a cross-card re-parent helper to cv-fix. **G3 and that helper are probably one function.**
2. **What happens until those writers exist:**
   - **Linking or changing a member's card** writes only `lorebook_bindings.character_id`, so the member keeps reading card-less, or the old card. This is pinned by "the link gap…" in `lorebooks.castVersions.int.test.ts`.
   - **Dated changes:** a card change at a date, a re-date, editing a version a session wrote, and removing a hand-written change are refused. **★cv-member-3, provisional words (🚧):**
     - "Changing the card a cast member is drawn with at a date isn't available yet."
     - "Moving a cast member's change to another date isn't available yet."
     - "Changes a session wrote can't be edited here yet."
     - "Removing a cast member's change isn't available yet."
   - **Fork history:** on a line delete, a cast version on a second or later fork that is dated by a copied history entry keeps the original entry's id. That entry now stands on the first fork's line. This is pinned in `forkHistory.versions.int.test.ts`.
3. **★cv-member-4: card-less members in the entity vocabulary.** The brief asked to include them, but that needs a new `EntityRef` kind (for example `cast_member`) and a matching annotation key and storage. That is a new name, so I didn't build it, and card-less members stay out as today. Recommendation: `{kind: "cast_member", id}` with key `cast_member:<id>`. Trade-off: `message_annotations.character_id` can't hold it, so it needs a column or the key alone.
4. **The `canonicalCardOf` export** in `sockets/characters.ts`: confirm it, or move it to cv-fix.
5. **Choices I accepted, inside scope:**
   - The member page edits the base, and the graph writes state at the version in force at the build line's head.
   - Undated versions a session wrote are not in the Changes list, because the wire's `year` is a number.
   - On a dated change to a carded member, `name` is the member's own name in this book (`ownName`).
   - A restored version whose parent card version is gone comes back card-less with `follows` emptied, because an insert can't point at a missing row.

## Queued for other lanes or files (not mine)
- **`shared/sockets/types.ts`:** add `changeLaterVersions?` and `laterVersions` to `Lorebooks.UpdateBinding` and `Amendments.Create/Update` (wave 3 client, or cv-fix).
- **cv-guards:**
  - The member copy in `tableRegistry.ts` (~355) still inserts `lorebook_bindings` raw, on purpose: `insertCastMember` would add a second base beside the copied one. It needs an exception, or a helper that inserts a member without a base.
  - `retold.ts`'s `retoldMembersForSession`, `retoldByCard`, `castIdentityExtras`, `applyRetold` and `RETOLD_MEMBER_COLUMNS` have no caller outside tests and read frozen columns. Retire them in the guards step.
- **`lorebookExportBuilder.ts`** (~195) exports own names, sprite set and so on from the frozen columns. cv-writers also queued its card side to cv-fix.
- **`utils/castTags.ts` `CAST_TAG_SITES` and `rewriteMergeLogCastTags`** don't know cast versions, so a `{{char:N}}` tag inside a version's text is not rewritten when a member is deleted, nor resolved on undo.
- **`state/entriesOnReading.ts` `castMemberAt`** still reads the old overlay path; its docstring is marked ⏳.
- **Fixtures** that insert members raw with no base still exist across the suite (`insertNarrativeNodeRow`, `scene()` in `sprites.pipeline`, `cast()` in `retold.int`). Once the straggler read is deleted, they will need `insertCastMember`.
- **Docs:** no `docs/*.md` change. The refusals in ★cv-member-3 are user-visible, so `docs/lorebook-cast.md` / `docs/lorebook-time.md` need a line in wave 3 once the words are ruled.

## Noticed, not done
- `annotations/index.ts` `EMPTY_VOCABULARY`'s doc says "a session with no lorebook", which predates this lane and breaks the always-a-lorebook wording.
- `tableRegistry.ts`'s `remapAmendedFields` doc and the `castAmendments` spec still describe the table as live (it is frozen, and only copied).
- The 0.5 import keeps a `node_state` of `"dormant"` (not one of the four states) on the version, as it did on the column. There is no validation there, before or now.
- Most owned files were not prettier-clean at HEAD. Only our hunks are formatted, and the new test files are clean.
- I didn't run a `scope-reviewer`; per the guide that belongs to whoever accepts the lane.
