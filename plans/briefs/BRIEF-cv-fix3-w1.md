# BRIEF cv-fix3-w1 — unlink from the book's present; a new dated card change stops at the next card change (2026-11-06)

Worker for lane **cv-fix3** (supervisor: Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

(No SDK change is needed in this brief; do not run `sdk:build`.)

## Goal — two owner rulings (2026-11-06)

1. **"Unlinking from the member page applies from the book's present too (versions from the present on become card-less keeping the card's words; earlier ones stay on the card)."** Owner: "Yes, from the book's present". No present → every version, as today.
2. **"A new dated card change stops at the next card change on its line (the bound removing already uses)."** Owner: "Stop at the next card change".

## Files owned (edit only these)
- `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts` — `reparentCastVersions`, `reparentFromBookPresent` and their doc comments only.
- `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.ts` — `moveCardFrom`, `writeCastChange`, `rewriteCastChange` (the `moveCardFrom` call), doc comments.
- `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.ts` — `writeMemberEdit` and its doc comment only (plus an import line if needed).
- Tests: `/home/jody/github/serene-pub/src/lib/server/characters/versions.authoring.int.test.ts`, `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.castVersions.int.test.ts`, `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.castVersions.int.test.ts` — **add** tests; never edit an existing expectation. If an existing test goes red, stop and report it.

Lane cv-readers is editing session-path files at the same time. Touch nothing else. Do not touch `NOMENCLATURE.md`, `docs/`, `plugins/providedBooks.ts` or `lorebooks/starterKits.ts` (they call these functions; keep their call shapes compiling unchanged).

## What to build

### Item 1 — unlink from the book's present

Today (`sockets/lorebooks.ts` `writeMemberEdit`, ~line 1420): `if (opts.unlink) await resolveFollows(tx, { castMemberId: member.id }, { detach: true })` — every version becomes card-less, keeping the card's words.

Build:
- `reparentFromBookPresent` (`characters/versions.ts` ~1084) takes `cardId: number | null`. With `null`:
  - **present** → write the same no-op carrier at main/present it already writes, then `reparentCastVersions(tx, id, { cardId: null, from: { branchId: null, date: present.date }, keepCardWords: true })`.
  - **no present** → `resolveFollows(tx, { castMemberId }, { detach: true })` (today's behaviour), answer `{ present: null, changed }`.
  - `follows` must not be passed with `cardId: null` (the function already refuses follows with no card).
- `reparentCastVersions` gets one new optional input `keepCardWords?: boolean`. Today's rule has "the one exception: when the target is card-less and the reference is card-less too, a field that stops following takes the reference's value, which restores the words a link replaced" (the `cardless` const and its use in the `set[field] = …` loop). With `keepCardWords: true` that exception is off: a field that stops following always takes the words it read from its old parent (`resolved[field]`). Why: the ruling says unlinked versions keep **the card's words**; without the flag, a link then an unlink at the same present (reference = the card-less version before the present) would put the pre-link words back. Document it in the JSDoc list. No other caller passes it.
- `writeMemberEdit`, on `opts.unlink`: call `reparentFromBookPresent(tx, member.id, { cardId: null, writtenBy: opts.writtenBy })` instead of `resolveFollows` (keep `resolveFollows` imported only if still used). Then mirror what the link path does with a present:
  - **With a present the base keeps the card it has** (it is undated, so it is "earlier" than the present): the form's other fields are read against that card — `card` = the base's parent version's profile, and `castChangesOfMemberEdit` is called with `characterId: member.characterId` on both sides (as `baseKeepsCard` does for a link).
  - **No present**: exactly today's behaviour (base detached by `resolveFollows`, `card` null, `characterId: nextCharacterId` (null)).
  - Update the doc comment ("An unlink … makes every followed field the member's own first") to say: from the book's present; no present → every version.
- The handler still writes `lorebook_bindings.character_id = null` itself (unchanged).

### Item 2 — a new dated card change is bounded

Today `moveCardFrom` (`sockets/amendments.ts` ~1159) calls `reparentCastVersions({ cardId, follows, from })` with no bound, so a card change at year 5 also re-parents the versions after a later card change at year 10.

Build: `moveCardFrom` takes a bound `{ onCard: number | null; until: StoryDate | undefined }` and passes both to `reparentCastVersions` (`onCard` key always present; `until` as given). Both callers compute it **before** the move, the way the undo does (`cardChangeAround`, ~line 198 — `nextChange` is "the date of the earliest later version on the row's own line whose card is not the row's"):
- `writeCastChange` (create path): after `writeCastVersion` returns `version` and before `moveCardFrom`: `const around = await cardChangeAround(tx, version, subject.lorebookId)`; pass `onCard: before.characterId`, `until: around.nextChange`.
- `rewriteCastChange` (fields path, with or without a re-date): after `updateCastVersion` and `moveSwitch(version)` and before `moveCardFrom`: `cardChangeAround(tx, version, subject.lorebookId)`; pass `onCard: before.characterId`, `until: around.nextChange`.
- Keep the `follows` argument logic as it is. Update `moveCardFrom`'s doc comment: "up to the next card change on its line (the bound the undo uses); versions on another card are left alone."

## Tests to add
In `lorebooks.castVersions.int.test.ts` (reuse `world`, `baseOf`, `storedRow`, `dated`, `writeCastVersion`; set a present with `storyClockYear: 100` as the existing "a member-page link at the book's present" test does):
- **Unlink at the book's present**: carded member, versions at 50 and 150 (150 retells e.g. `summary`), clock 100, `w.update({ characterId: null })` → base and the 50 version keep `parentVersionId` = the card version; the carrier at 100 is card-less (`parentVersionId` null, `follows` []), its `description` is "The card's description."; the 150 version is card-less, keeps its own summary and has the card's description in its own column; binding `characterId` null; `memberAsRead` at main reads card-less with the card's description (if reading at the present needs a reading arg, check `memberAsRead`'s signature).
- **A link then an unlink at the same present keeps the card's words** (the `keepCardWords` case): card-less member ("The innkeeper", its own description if `world` gives none, set one via `w.update`), clock 100, link `w.card.id`, then unlink → the carrier at 100 is card-less with "The card's description.", not the innkeeper's words.
- The existing "unlinking makes every followed field the member's own" test (no present) must still pass unchanged.

In `amendments.castVersions.int.test.ts` (reuse `world`, `otherCard`, `create`, `update`, `readAt`, `versionsOf`):
- **A new dated card change stops at the next card change**: card-less member; `create` 30 link C; `create` 40 `characterId: null`; `create` 50 `{ summary: "Last." }`; then `create` 20 link D → `readAt` 25 is D; 35 is still C; 45 and 55 are card-less (55 keeps "Last."). Before this fix 55 would read D.
- **A new dated swap leaves a later change on another card alone**: carded member (card A); `create` 40 link B; `create` 20 swap to D → 25 reads D, 45 reads B.
- **The fields path is bounded too**: card-less; `create` 20 `{ summary: "Twenty." }`; `create` 30 link C; `create` 40 `characterId: null`; `create` 50 `{ summary: "Last." }`; `update(w, { id: <20's id>, fields: { characterId: D } })` (check how the update handler takes `fields` — see the existing "a date and fields in one request" test) → 25 reads D, 35 reads C, 55 card-less.
- A re-date + fields case if cheap: same as above but also move 20 to 15 in the same request → 17 reads D, 35 reads C.

In `versions.authoring.int.test.ts`: one direct test of `reparentCastVersions` with `cardId: null`, a `from`, a card-less reference and `keepCardWords: true` → the moved version takes the old card's words; the same without the flag → the reference's words (pins today's exception).

## Rules your work depends on (quoted)
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently". Every function here runs on the caller's `tx`; never import or touch `db` in them.
- BRIEF-cv-common: "no static `$lib/server/db` import in modules tests mock"; `characters/versions.ts` stays a leaf — its `state/reading` and `cast/memberAsRead` imports are **dynamic**; keep it so (`resolveFollows` is in the same file).
- BRIEF-cv-common: "every session has a lorebook — never write 'no book'" (in comments and messages too).
- CLAUDE.md: "It is a **session**, never a *chat*."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." No new user-facing strings, settings or names beyond `keepCardWords`.
- multi-agent guide: "**Never pipe vitest into `head`**: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load." (these files already `vi.setConfig({ testTimeout: 60_000 })`).

## Done means
Run, from the repo root, with output to a file (no `head`):
`npx vitest run src/lib/server/characters/versions.authoring.int.test.ts src/lib/server/characters/versions.int.test.ts src/lib/server/characters/versions.write.int.test.ts src/lib/server/characters/versions.test.ts src/lib/server/sockets/amendments.castVersions.int.test.ts src/lib/server/sockets/amendments.int.test.ts src/lib/server/sockets/lorebooks.castVersions.int.test.ts src/lib/server/plugins/providedBooks.int.test.ts src/lib/server/characters/versionsWriter.guard.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-fix3-w1-run.log 2>&1`
— all green. `npx tsc --noEmit -p .` shows no error in the three owned source files or the three test files (others' in-flight errors: list, don't fix). `npx prettier --check` on the six files; format only your own hunks in files that weren't clean before.

## Report (your final message)
Changed functions with new signatures; the tests added (file + name); test results (counts, any failure verbatim); tsc lines touching your files; prettier; anything you couldn't do; Noticed, not done.
