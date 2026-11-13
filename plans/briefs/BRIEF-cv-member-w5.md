# BRIEF cv-member-w5 — follow-ups: tests that still write frozen cast data, and the graph build's member names

Worker (Sonnet) for lane **cv-member**. App `/home/jody/github/serene-pub`. Report as your final message (no report file), starting `# REPORT cv-member-w5 (2026-11-05)`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Other lanes are editing other files right now. Touch nothing outside **Files owned**.

## Background
Wave 2 of character versions moved cast members onto `character_versions`. Read `plans/REPORT-cv-core-2026-11-05.md` (short). Since this lane:
- `cast_amendments` and the member's **frozen columns** (retold text, `retold`, `own_name`, `own_nickname`, `face_media_id`, `timbre`, `sprite_set`, `node_state`, `node_visibility`) are no longer written or read by the app; their values live on cast versions (plan §32 §8: "`cast_amendments` and the retold columns freeze").
- `amendments:create` / `update` (cast) write cast versions through `writeCastVersion`'s author path; the cast list (`buildAmendmentsList`) lists versions (`id` = version id, `fields` = what differs from the version before). A **card change at a date** is refused: `"Changing the card a cast member is drawn with at a date isn't available yet."` (no writer re-parents a version yet).
- `cardMemberAt` (sockets/amendments.ts) and `membersAsRead` / `memberAsRead` (cast/memberAsRead.ts) read versions. `lorebooks/retold.ts`' `retoldMembersForSession` is legacy code with no caller outside tests (it reads the frozen columns and `cast_amendments`).
- Writer API (`src/lib/server/characters/versions.ts`, **read only**): `insertCastMember(tx, values)`, `writeCastVersion(tx, { member, changes, writtenBy: "user:<id>", at: { branchId, date, personalPosition } })`, `insertCharacterVersions(tx, rows)` (the one INSERT; test fixtures may use it directly to make a dated version whose `parentVersionId` is another card's version — that is how a test gets a **dated card**: a cast version on the line at the date with `parentVersionId` = the other card's version (`ensureCardVersion(tx, cardId)`), and `follows` = the fields it reads from it).

## Files owned (edit only these)
- `src/lib/server/lorebooks/retold.int.test.ts`
- `src/lib/server/sockets/castMemberLifecycle.int.test.ts`
- `src/lib/server/sprites/sprites.pipeline.int.test.ts` (fixtures only: replace `cast_amendments` inserts; don't change what a test asserts about sprites)
- `src/lib/server/sockets/narrativeGraph.ts` — only the build's member-name read (~1030–1060)

## Rules (quoted)
- CLAUDE.md P2 / `versions.ts`: "Nothing else inserts into or updates the table." Tests may call `insertCharacterVersions` / `writeCastVersion`; never raw-insert `character_versions` or write the frozen columns or `cast_amendments` in a test meant to show today's behaviour.
- Inside `db.transaction(async (tx) => …)` use only `tx`. DB-in-`it` needs a 60 s timeout. Never pipe vitest into `head`. Run only **Done means**. `npx tsc --noEmit -p .` clean for your files.
- Keep each test's **intent**; change only how it sets up data and where it reads results. Where the behaviour itself changed (a card change at a date is now refused; an amendment update now lists `fields` as a diff and leaves `cast_amendments` empty), assert the new behaviour and say so in the report.
- No new exported names. No `TODO`s.

## What to do
1. Failing now (run them first to see):
   - `retold.int.test.ts` › "retold fields are amendable at a date, and refused when malformed" (it reads through `retoldMembersForSession`; read through `memberAsRead(db, memberId, { sessionId })` or `membersAsRead` instead — the session's clock before/after the date), and › "a gallery image of a card the member is drawn with at a date may be worn there" (it made the dated card with `amendments:create`, now refused; make the dated card with `insertCharacterVersions` as above).
   - `castMemberLifecycle.int.test.ts` › "the one cast resolver answers for the dated card, drawn as the line reads" and › "a change that sets nothing a member can have at a date is refused" (~line 617 reads `cast_amendments.fields` by the listed id; assert the listed row's `fields` / the version instead). Check `amendCard` (~93, ~267) and every other direct `cast_amendments` insert in the file.
   - `sprites.pipeline.int.test.ts` › "resolves at the session's reading: its fork cut and its story clock (finding #39)" (~198) and › "a seat holding the dated card is drawn as the book has her at the session's point (A25)" (~265): their fixtures insert `cast_amendments`; write versions instead (a `spriteSet` change through `writeCastVersion` `at` the date/line; a dated card through `insertCharacterVersions`). Also replace the third insert (~241) even though it passes.
2. `narrativeGraph.ts` build (~1030–1060): the `bindings` query reads `ownName`, `ownNickname` (frozen) to substitute cast tags in scene summaries with display names. Read the members' own names from versions instead — the version in force at the build's line head (the file already has a private `storyStatesOf` helper reading `castVersionsInForce`; reuse or extend it privately) mapped with `memberColumnsOfVersion(version, { carded })` from `lorebooks/retold.ts` (`ownName`/`ownNickname`); a member with no version keeps its columns. Add one case to `src/lib/server/sockets/narrativeGraph.castVersions.int.test.ts` (yours to extend): a member whose own name lives only on its base version is shown by that name in the build's summary text.

## Done means
`npx vitest run --maxWorkers=4 src/lib/server/lorebooks/retold.int.test.ts src/lib/server/sockets/castMemberLifecycle.int.test.ts src/lib/server/sprites src/lib/server/sockets/narrativeGraph` — green. List `/tmp/serene-pub-vitest-*` before and after; delete only dirs your runs created, by name.

## Report
Changed files; each test changed and how; tests with counts; Noticed, not done.
