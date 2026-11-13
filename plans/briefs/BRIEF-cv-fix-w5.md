# BRIEF cv-fix-w5 — wire the version writers into dated changes and fork history

Worker for lane **cv-fix** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context
- `plans/REPORT-cv-member-2026-11-05.md` (what `sockets/amendments.ts` does today and why four actions are refused).
- The new writers in `src/lib/server/characters/versions.ts` (read their doc comments; **do not edit `versions.ts`** — if you need a change there, say so in your report):
  - `updateCastVersion(tx, versionId, { changes?: CastVersionChanges; place?: { branchId; date: StoryDate | null; historyEntryId?; personalPosition } }) → VersionRow` — edits one cast version in place, an authored one or one a session wrote (★CV-2); retires first and inserts the edited copy when a descendant session reads it; refuses moving the base, an undated line place, a key clash, a retired row.
  - `deleteCastVersion(tx, versionId) → { taken; retired }` — refuses the base; a session-written row is retired or taken; an authored row is deleted.
  - `reparentCastVersions(tx, castMemberId, { cardId: number | null; follows?: readonly CharacterProfileField[]; from?: { branchId; date: StoryDate } | null }) → number` — moves the member's versions from `from` on (on every line where a version at that point reads, dated at/after it; absent = every version) onto `cardId`'s current card version (null = card-less); `follows` given = every version in scope follows exactly those fields; absent = each keeps its own. Does not touch `lorebook_bindings.character_id`.
  - `repointVersionHistory(tx, fromEntryId, toEntryId, branchIds) → number` — `branchIds` is `pointOnto`'s `group`.
- **Owner ruling 2026-11-06:** _linking or swapping a card-less member's card → "From the link date on" — versions dated from the link onward follow the new card; earlier ones stay as they were._
- `src/lib/shared/sockets/types.ts` now declares `changeLaterVersions?` / `laterVersions?` on `Sockets.Amendments.Create` / `Update` (Params / Response).
- Another worker (w6) runs at the same time on `sockets/lorebooks.ts`, `lorebooks/starterKits.ts`, `plugins/providedBooks.ts`, `sockets/characters.ts`. Don't touch those.

## Files owned (edit only these)
- `src/lib/server/sockets/amendments.ts`
- `src/lib/server/utils/forkHistory.ts`
- tests: `src/lib/server/sockets/amendments.castVersions.int.test.ts`, `sockets/amendments*.int.test.ts`, `src/lib/server/utils/forkHistory.versions.int.test.ts`, new test files next to them
- **Do not edit `NOMENCLATURE.md` or `docs/`.** Propose §25 rows and doc lines in your report.

## Items

### A. Drop the four provisional refusals (`amendments.ts` ~128–139) and do the actions
1. **A dated card change** (`CARD_CHANGE_UNAVAILABLE`, raised by `assertSameCard` in `writeCastChange` / `rewriteCastChange`): `fields.characterId` differs from the card the version in force has. Outcome to reach, inside the existing locked transaction: the version at that place (line, date, life point) reads the NEW card's current card version as its parent; its `follows` are `memberProfileOf(<the member columns after the change, characterId = the new card>, <new card's profile>).follows` (the "unretold fields follow" rule — `castChangesOfMemberEdit` / `memberProfileOf` in `lorebooks/retold.ts` and `characters/versions.ts` already compute this; reuse, don't copy); its own fields are the change's; and every version from that point on (`reparentCastVersions(tx, memberId, { cardId: newCardId, follows, from: { branchId, date } })`) follows the new card too, with the same `follows` when the member was card-less before, and their own `follows` (omit the option) when it swaps one card for another. `characterId: null` at a date (drawn with no card from then on) → `cardId: null` from that point. Keep `assertCardFree` (the card must be one the person may use). Earlier versions are untouched.
2. **A re-date / move** (`REDATE_UNAVAILABLE` in `amendmentsUpdateHandler` ~1504): pass the new date as `place` to `updateCastVersion`, after `assertDateLands` under `lockBookCalendar` (as the entry half of the handler does; merge a partial date over the stored one exactly as the entry half does — year-only keeps month/day; clearing the month clears the day). The version keeps its line and life point. Its `historyEntryId` becomes null when the date moves unless the request names one (check the params type) — say which you did.
3. **Editing a version a session wrote** (`SESSION_WRITTEN_UNAVAILABLE` ~1506, ★CV-2): `rewriteCastChange` today writes through `writeCastVersion`'s author path, which can only land on an authored row. Make it write through `updateCastVersion(tx, row.id, { changes })` for every row (authored and session-written), so a session-written row is edited in place (or retired + copied when a branch reads it). A fields edit and a re-date in one request is one `updateCastVersion` call with both. Keep `writeToLaterVersions` (★CV-13) after it as today.
4. **Removing an authored change** (`REMOVAL_UNAVAILABLE` ~1644): `amendmentsDeleteHandler` calls `deleteCastVersion(tx, row.id)` for every cast change (it routes a session-written one through retire-or-take itself), in a transaction under `lockBookCalendar`.
- Delete the four constants and `assertSameCard` if nothing uses them any more. Remove the local `ChangeLaterVersions` / `WithLaterVersions` / `LaterVersions` types (~1343–1346) in favour of the `Sockets.Amendments.*` types (keep a local alias only if the code reads better; no duplicate shape).
- Update the doc comments that say "no writer … yet".

### B. Fork history re-points cast versions (`utils/forkHistory.ts` `pointOnto` ~353–355)
Replace the "⚠ Cast versions … are NOT re-pointed here" comment with `await repointVersionHistory(tx, from, to, group)`. Update the test that pins the gap in `forkHistory.versions.int.test.ts` (cv-member: "a cast version on a second or later fork that is dated by a copied history entry keeps the original entry's id") to the fixed behaviour.

## Tests
Change every test that pins a provisional refusal to the new behaviour (grep `isn't available yet`, `can't be edited here yet` in `src/lib/server/sockets/*.test.ts`). Cover, through the socket handlers (`amendmentsCreateHandler`, `amendmentsUpdateHandler`, `amendmentsDeleteHandler`):
- a dated card change on a card-less member at D: versions before D stay card-less; the change and the later versions follow the new card (read through `memberAsRead` at a moment after D: `activeCardId` = the new card, a followed field reads the card's text); before D reads as before;
- a dated swap from card A to card B keeps each later version's own follows;
- re-dating a change (and refusal of a date the calendar refuses);
- editing a session-written change (in place; with a branch reading it: retired, branch still reads the old words);
- removing an authored change; removing the base is refused (the Changes list never lists the base, so call it by id);
- `changeLaterVersions` still answers `laterVersions` on create and update.
Run and keep green: `sockets/amendments*.int.test.ts`, `utils/forkHistory*.test.ts`, `state/datedRows.versions.int.test.ts`, `src/lib/server/characters/`, `src/lib/server/cast/`, `annotations/versionNames.int.test.ts`, `calendarInvariants*`.

## Rules (quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Sockets: "one domain context per event family … is the only listener, and the only place that toasts; views … never call `toaster`." Server emits stay as they are.
- NOMENCLATURE R3: _cast version_, _card version_ in prose, never a bare _version_; "It is a **session**, never a *chat*"; "Every session has a lorebook — never write 'no book'".
- Tests: targeted only, `npx vitest run --maxWorkers=4 <files>`; **never pipe vitest into `head`**; DB-in-`it` tests need a 60 s timeout; list `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs left, by name.
- Prettier: your hunks only in old files; new test files pass `npx prettier --check`. `npx tsc --noEmit -p .`: no error in your files.

## Stop and ask (in your report; carry on) when
a ★ is unruled, a user-visible word is new (list refusal sentences you add as provisional), or a fix needs a file you don't own.

## Report (your final message)
Changed files; behaviour per item; tests with counts; proposed §25 rows; proposed lines for `docs/lorebook-cast.md` / `docs/lorebook-time.md` if a user-visible action now works that the docs call unavailable (grep them); open ★; Noticed, not done.
