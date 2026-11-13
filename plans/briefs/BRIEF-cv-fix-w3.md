# BRIEF cv-fix-w3 — the missing version writers (G1–G4), the cross-card re-parent, label, notes' lang

Worker for lane **cv-fix** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context (read these first)
- `src/lib/server/characters/versions.ts` whole — the ONE writer of `character_versions` (a leaf: no static `$lib/server/db` import; callers own the transaction; other modules reached by `await import()`). Know `insertCharacterVersions`/`insertRows` (the only INSERT), `nextWriteOrder`, `ensureCardVersion`, `updateCardVersion`, `updateMemberToCardVersion`, `resolveFollows`, `memberProfileOf`, `applyChanges`, `updateInPlace`, `descendantReads`, `retireOrTakeVersions`, `writeCastVersion` (author path `authorWrite`, story path `storyWrite`). It changed today (lane cv-fix w1: `ensureMemberBase` now refuses; a NUL strip in `insertRows`/`updateCardVersion`/`updateInPlace`; a story write with no anchor is refused) — keep all of that.
- `plans/REPORT-cv-member-2026-11-05.md` §"Open ★ and blockers" item 1 (G1–G4) and `plans/REPORT-cv-writers-2026-11-05.md` §"Queued" (`versions.ts is missing three things`).
- `src/lib/shared/lorebooks/lineReading.ts` (`versionInForce`, `rowReadsOnLine`, `rowPassesSessionCut`), `src/lib/server/state/reading.ts` (`lineOfBook`), `src/lib/shared/characters/profile.ts`.
- Plan rules (§33.2, settled): _"One **retire mark** (`retired_order bigint`): Back, swipe, delete or an in-place change of a row some descendant reads (its cut passes it) marks the row retired (`retired_order` = the next write order) instead of deleting it; an in-place change then inserts the new row."_
- **Owner ruling 2026-11-06 (G3):** _linking or swapping a card-less member's card → "From the link date on"_ — versions dated from the link (or swap) onward follow the new card's current version (unretold fields `follows` per `memberProfileOf`); earlier versions stay as they were.
- Another worker (w4) runs at the same time on `shared/sockets/types.ts`, `sockets/characters.ts` and `plugins/providedBooks.ts`. Don't touch those. Wiring the new functions into their callers (`sockets/lorebooks.ts`, `sockets/amendments.ts`, `utils/forkHistory.ts`, `lorebooks/starterKits.ts`, `plugins/providedBooks.ts`, `sockets/characters.ts`) is the NEXT batch, not yours — make the signatures easy for them.

## Files owned (edit only these)
- `src/lib/server/characters/versions.ts`
- `src/lib/shared/characters/profile.ts` (`creatorNotesOf` only)
- tests: `src/lib/server/characters/versions.test.ts`, `versions.int.test.ts`, `versions.write.int.test.ts`, and a new `src/lib/server/characters/versions.authoring.int.test.ts`; the shared profile test if one exists (`grep -rln "creatorNotesOf" src --include=*.test.ts`). If a test elsewhere asserts the old `creatorNotesOf` output (no `lang`), update that expectation and list the file.
- **Do not edit `NOMENCLATURE.md`.** Propose §25 rows in your report.

## Build (all 🚧; every refusal in words, a provisional sentence you list in your report)

### G1 `updateCastVersion(tx, versionId, { changes?, place? })` → `Promise<VersionRow>`
Edits ONE cast version in place — an authored one or one a session wrote (★CV-2) — the edit an author makes from the member's **Changes** list.
- `changes?: CastVersionChanges` (same meaning as `writeCastVersion`'s, through `applyChanges`); `place?: { branchId: number | null; date: StoryDate | null; historyEntryId?: number | null; personalPosition: number | null }` (a re-date / move).
- Refuse: an unknown id; a card version; nothing to change (no changes and no place, or a place equal to the row's); moving the **base** (the member's undated, main, no-life-point, no-source version — compare `isBaseVersion` in `sockets/amendments.ts` ~141) anywhere; an undated place on a line or at a life point (reuse `authorWrite`'s sentence: "An undated cast version can only be on main with no life point, so a version on a line or at a life point needs a date."); a place where the member already has another live authored version at exactly that key (branch, date, life point, no source, not retired) — say so in words.
- When the row has a `sourceSessionId` and a descendant session still reads it (`descendantReads`), **retire** it (`retired_order = nextWriteOrder(tx)`) and insert the edited copy (new id, new write order, same provenance: source session/message, `validFromMessageId`, `writtenBy`, `note`); answer the new row. Otherwise update the row in place (profile/follows/node fields via the same rules as `updateInPlace`; place columns when moved) and answer it. A session-written row keeps its source and anchor either way, so Back still takes it.
- Calendar checks (`assertDateLands`) and the book lock stay the caller's.

### G2 `deleteCastVersion(tx, versionId)` → `Promise<{ taken: VersionRow[]; retired: VersionRow[] }>`
- Refuse an unknown id, a card version, and the member's **base** (words: the base is who they are; removing the cast member is how they go).
- A row a session wrote goes through `retireOrTakeVersions` (retired when a descendant reads it, else deleted). An authored row (no source) is deleted. Answer the rows as they were, like `retireOrTakeVersions` does, so a caller could restore them.

### G3 + item 9: `reparentCastVersions(tx, castMemberId, { cardId, follows?, from? })` → `Promise<number>` (one function; the cross-card re-parent)
Re-parents a member's cast versions onto another card's **current** card version (`ensureCardVersion(tx, cardId)`), or makes them card-less (`cardId: null`). It serves: a link of a card-less member, a card swap, a dated card change, a starter copy (versions pointing at the original card's versions move onto the copy's v1), a provided-book member whose card appears.
- `from?: { branchId: number | null; date: StoryDate } | null` — absent/null: **every** version of the member (an undated link or swap). Given: the versions that come at or after that point on its timeline — those on a line where a version placed at (`branchId`, `date`) reads (`lineOfBook` per line of the book + `rowReadsOnLine`), dated at or after `date` (`compareDates`); undated versions never count for a dated `from`. ("From the link date on" — earlier versions stay.)
- `follows?: CharacterProfileField[]` — given: every version in scope ends up following exactly these fields; absent: each version keeps its own `follows` (a swap: what followed the old card follows the new; a card-less version then follows nothing).
- For each version in scope, one rule: first resolve every field it followed and will **not** follow afterwards into its own column from its OLD parent (as `resolveFollows` does: `followedProfile`), then set `parent_version_id` to the target (null when `cardId` is null), set `follows`, and hold the empty value in the own column of each newly followed field (as `memberProfileOf` does: "Fields that follow hold the empty value in `own`"). `cardId: null` must give the same result as `resolveFollows({castMemberId}, {detach: true})` for that scope.
- In place, no retire mark (book authoring reaches every reader of the member, as a card edit reaches its followers) — say this choice in the doc comment. Retired rows are included. Run `checkFollows` on each result. Answer how many versions changed.
- It does not touch `lorebook_bindings.character_id` (the caller's link key) — say so.
- Keep `updateMemberToCardVersion` (same card, older → newer) as it is.

### G4 `repointVersionHistory(tx, fromEntryId, toEntryId, branchIds)` → `Promise<number>`
For `utils/forkHistory.ts`'s `pointOnto` (read ~320–372, and its `ofGroup` helper): the cast versions dated by history entry `from` on the group's lines move to `to`, its copy on the fork. Mirror exactly the predicate `pointOnto` uses for `castAmendments` (`ofGroup(c.branchId, null, group, sessionIds)` — read `ofGroup` and take the same arguments it needs, e.g. `group` and `sessionIds`, if it needs both). Cast versions only (`cast_member_id IS NOT NULL`). Answers how many.

### Item 9b: a label option on `updateCardVersion`
`updateCardVersion(tx, versionId, changes, opts?: { label?: string | null })`: when `opts.label !== undefined`, write the version's `label` too (an in-place save can rename a version). Only the label; `characters.character_version` is not one of the ⏳ card copies — don't write it. A call with only a label and no profile change still writes the label.

### Item 9c: `creatorNotesOf` keeps `lang` (`shared/characters/profile.ts`)
Today it drops the main note's language key. Make it lossless exactly as `creatorNotesOfCard` in `src/lib/server/characters/cardIO.ts` ~512 does (`lang` = the first multilingual key whose text IS the main note; that entry not repeated in `variants`; `lang` omitted when none). Don't edit `cardIO.ts` (note the duplicate under Noticed). `cardProfileOf` and the lift go through `creatorNotesOf`, so they pick it up.

## Tests (new `versions.authoring.int.test.ts`, plus pure ones in `versions.test.ts`; reuse the fixtures of `versions.write.int.test.ts`)
- G1: edit an authored dated version's fields in place; move it to another date / life point; refuse the base move, an undated line place, a key clash; edit a session-written version no branch reads (in place, source kept, Back still takes it via `retireOrTakeVersions`); edit one a branch reads (old row retired, the branch still reads the old one, the parent reads the new one).
- G2: delete an authored version; refuse the base; a session-written one is taken, or retired when a branch reads it.
- G3: link a card-less member (undated) → every version's parent is the card's current version and the given fields follow; a dated card change on main at D → versions before D unchanged, at/after D re-parented; on a branch line the main versions after D are untouched; a swap with `follows` absent keeps each version's follows; `cardId: null` equals `resolveFollows` detach; a field that stops following keeps the old card's words.
- G4: versions on the group's lines dated by `from` move to `to`; others don't.
- 9b label; 9c `creatorNotesOf` with a matching multilingual key → `lang`, no duplicate in `variants`.
- Run, and keep green: `versions.test.ts`, `versions.int.test.ts`, `versions.write.int.test.ts`, `versionsLift.int.test.ts`, `versionsLift.test.ts`, your new file, `src/lib/server/cast/`, `src/lib/server/characters/`, `utils/characterCardParser*`, `sockets/characters.versions.int.test.ts`, `sockets/amendments.castVersions.int.test.ts`, `sockets/lorebooks.castVersions.int.test.ts`, `utils/forkHistory.versions.int.test.ts`.

## Rules (quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." `versions.ts` never opens a transaction and never imports the db statically.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**." "Nothing 'for later': no option, hook or extension point nobody asked for."
- NOMENCLATURE §24: grep each new name first across `src`, `../serene-pub-sdk` and the schema; R3 qualify (never a bare _version_ in prose: _cast version_, _card version_); "It is a **session**, never a *chat*"; "Every session has a lorebook — never write 'no book'".
- Tests: targeted only, `npx vitest run --maxWorkers=4 <files>`; **never pipe vitest into `head`**; DB-in-`it` tests need a 60 s timeout; list `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs left, by name.
- Prettier: your hunks only in `versions.ts` (check it first); new test files pass `npx prettier --check`. `npx tsc --noEmit -p .`: no error in your files.

## Stop and ask (in your report; carry on) when
a ★ is unruled, a user-visible word is needed beyond a refusal sentence (list those as provisional), a schema change would be needed, or a fix needs a file you don't own.

## Report (your final message)
Exact exported signatures first (the next batch wires them); changed files; tests with counts; proposed §25 rows; provisional sentences; open ★; Noticed, not done.
