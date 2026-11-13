# BRIEF cv-fix-w6 — wire the cross-card re-parent: link and swap, starter copies, provided books; the label on an in-place save

Worker for lane **cv-fix** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context
- `plans/REPORT-cv-member-2026-11-05.md` ("the link gap"), `plans/REPORT-cv-writers-2026-11-05.md` §"Queued" (`versions.ts is missing three things`).
- The writers in `src/lib/server/characters/versions.ts` (read their doc comments; **do not edit `versions.ts`** — say in your report if you need a change there):
  - `reparentCastVersions(tx, castMemberId, { cardId: number | null; follows?: readonly CharacterProfileField[]; from?: { branchId; date: StoryDate } | null }) → number` — moves the member's versions (`from` absent = every version) onto `cardId`'s **current** card version (null = card-less); `follows` given = every version in scope follows exactly those fields (each field that stops following first keeps the old card's words); absent = each keeps its own `follows`. Does not touch `lorebook_bindings.character_id` (the caller's link key).
  - `memberProfileOf(memberColumns, cardProfile) → { own, follows, mixedGreetings }` — the "which fields follow" rule.
  - `updateCardVersion(tx, versionId, changes, opts?: { label?: string | null })` — `opts.label` renames a card version.
- **Owner ruling 2026-11-06:** _linking or swapping a card-less member's card → "From the link date on" — versions dated from the link onward follow the new card's current version (unretold fields follow, per `memberProfileOf`); earlier ones stay as they were._ A link or swap from the member form is undated, so it is every version.
- **Owner ruling 2026-11-06 (already built by w4):** _Provided-book upgrade → "They stay, with the Update offer" — every member stays pinned._ Don't undo it.
- `src/lib/shared/sockets/types.ts` now declares `changeLaterVersions?` / `laterVersions?` on `Sockets.Lorebooks.UpdateBinding` (Params / Response).
- Another worker (w5) runs at the same time on `sockets/amendments.ts` and `utils/forkHistory.ts`. Don't touch those.

## Files owned (edit only these)
- `src/lib/server/sockets/lorebooks.ts` — `writeMemberEdit` (~1387) and the `updateBinding` handler's local types (~1981–1987, ~2326)
- `src/lib/server/lorebooks/starterKits.ts` — `ownCastCards` (~531–640) only
- `src/lib/server/plugins/providedBooks.ts` — the upgrade hunk where a member's card appears (~1160–1200) only
- `src/lib/server/sockets/characters.ts` — the `characters:update` in-place save (~1036–1050) only
- tests: `sockets/lorebooks.castVersions.int.test.ts`, `lorebooks/starterKitsVersions.int.test.ts`, `plugins/providedBooks.int.test.ts`, `sockets/characters.versions.int.test.ts`, and new files next to them
- **Do not edit `NOMENCLATURE.md` or `docs/`.** Propose §25 rows and doc lines in your report.

## Items

### 1. Link and swap (`sockets/lorebooks.ts` `writeMemberEdit`)
Today a link (card-less → card) or a swap (card A → card B) writes only `lorebook_bindings.character_id`; the member's versions keep their old parent, so the member still reads card-less or the old card ("the link gap", pinned in `lorebooks.castVersions.int.test.ts` ~253). In `writeMemberEdit`, when `nextCharacterId` differs from `member.characterId` and it is not an unlink (unlink keeps `resolveFollows({detach})`):
- **link** (was card-less): `reparentCastVersions(tx, member.id, { cardId: nextCharacterId, follows })` with `follows = memberProfileOf(<the member columns after the edit>, <the new card's current profile>).follows` — the member form's retold choices decide which fields follow;
- **swap** (card A → B): `reparentCastVersions(tx, member.id, { cardId: nextCharacterId })` (each version keeps its own `follows`: what followed A follows B);
- then the base edit (`castChangesOfMemberEdit` against the NEW card's profile, `writeCastVersion` author path at the base) as today, so the form's own fields land on the base. Make sure the order gives the base exactly what the form says (a field the form retells is own on the base; one it doesn't follows).
- Replace the "link gap" test with the fixed behaviour: after a link, the base and a later dated version name the card's current card version, the unretold fields follow, `memberAsRead(...).cardless` is false and `activeCardId` is the card. Add a swap test (A → B: followed fields now read B's text; own fields stay).
- Replace the local `changeLaterVersions?` / `laterVersions` declarations (~1981–1987, ~2326) with `Sockets.Lorebooks.UpdateBinding.*`.

### 2. Starter copies (`lorebooks/starterKits.ts` `ownCastCards`)
Today each copied member's `follows` is resolved first (`resolveFollows({cardId: oldId, castMemberId})`), then `character_id` moves to the copy, but the versions' `parent_version_id` still names the ORIGINAL card's version, so `activeCardId` reads the original card. Keep the `resolveFollows` (it keeps every member's reading exact), then `reparentCastVersions(tx, m.id, { cardId: copy.id })` for each member that bound the original (follows absent: they are all empty after the resolve, so nothing else changes) — every version then names the copy's v1. Test in `starterKitsVersions.int.test.ts`: after a kit copy, each copied member's versions' parent is a version of the copy, `memberAsRead(...).activeCardId` is the copy, and the read text is unchanged.

### 3. Provided books: a member whose card appears (`plugins/providedBooks.ts` upgrade hunk)
When the file now gives a recorded, card-less member a card (`createCharacterFromParsedData` in the `else` branch, then `.set({ characterId })`), the member's base stays card-less. After the binding gets its `characterId`, call `reparentCastVersions(tx, at.binding.id, { cardId: created.id, follows })` with `follows = memberProfileOf(<the member's columns with no retold flags, its own name / nickname / sprite set as the file gives them>, <the new card's profile>).follows` (the file carries no retold text, so everything the card has follows except what the file sets on the member). Members whose card is updated in place stay pinned (owner ruling; already built). Test it in `providedBooks.int.test.ts` (a card-less member gains a card on upgrade: its versions name the card's v1, it reads the card's description).

### 4. The label on an in-place save (`sockets/characters.ts` `characters:update`)
`updateCardVersion(tx, chosen.id, profile)` (~1046) ignores the label the editor sends, so a version can't be renamed. Find what the editor sends as the version's label on an in-place save (`params.character.characterVersion` — check the `Update.Params` type and `buildExistingCharacterComparisonData`/the get reply, which answer `characterVersion` as the shown version's label) and pass it as `opts.label` when it is a string. Don't change what `libraryFacts` writes to the `characters` row (providedBooks' `castHashNow` reads `characters.character_version`). Test in `characters.versions.int.test.ts`: an in-place save of v1 with a new label renames v1, not the current version.

## Rules (quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- "Members never see or touch model plumbing" (not touched here); "Every session has a lorebook — never write 'no book'"; NOMENCLATURE R3: _cast version_, _card version_ in prose.
- Tests: targeted only, `npx vitest run --maxWorkers=4 <files>`; **never pipe vitest into `head`**; DB-in-`it` tests need a 60 s timeout; list `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs left, by name.
- Prettier: your hunks only in old files; new test files pass `npx prettier --check`. `npx tsc --noEmit -p .`: no error in your files.

## Stop and ask (in your report; carry on) when
a ★ is unruled, a user-visible word is new, or a fix needs a file you don't own.

## Done means
Green: `sockets/lorebooks*.int.test.ts`, `lorebooks/starterKits*.test.ts`, `plugins/providedBooks*`, `providedPrimers.int`, `sockets/characters*.int.test.ts`, `characterAvatarAndUpdate.int`, `src/lib/server/characters/`, `src/lib/server/cast/`, `utils/characterBindingSync*`, `castMemberLifecycle*`.

## Report (your final message)
Changed files; behaviour per item; tests with counts; proposed §25 rows; open ★; Noticed, not done.
