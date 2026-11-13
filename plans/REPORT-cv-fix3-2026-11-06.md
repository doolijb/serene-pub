# REPORT cv-fix3 (2026-11-06)

No status question was relayed to this lane. Both owner rulings are built and all 223 targeted tests pass.
- `tsc` shows no errors in lane files.
- I ran no `sdk:build`, since there was no SDK change. I committed nothing and never used `git stash`.
- One Sonnet worker (w1) did the typing. I re-checked its diff against its brief and the rulings, then re-ran the tests myself.
- This message is the only copy of the report; please save it to `plans/REPORT-cv-fix3-2026-11-06.md`.

## Names and signatures (🚧)
In `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts`:
- **`reparentFromBookPresent(tx, castMemberId, input)`**, changed. `input` is now `{ cardId: number; follows?; writtenBy } | { cardId: null; follows?: undefined; writtenBy }`.
  - `cardId: null` is the **unlink**. With a present, it writes the same no-op carrier at main/present, then calls `reparentCastVersions({ cardId: null, from: { branchId: null, date: present }, keepCardWords: true })`.
  - With no present it calls `resolveFollows(…, { detach: true })`, which is today's behaviour, and answers `{ present: null, changed }`.
  - Existing callers (`plugins/providedBooks.ts`, link and swap) are unchanged and still compile.
- **`reparentCastVersions(…, { …, keepCardWords?: boolean })`**: one new optional input. When it is true, the "card-less target from a card-less reference restores the reference's words" exception is off, so a field that stops following always takes the words it read from its old card.
  - **Why the flag exists:** without it, a link then an unlink at the same present would use the card-less version before the present as the reference and bring back the pre-link words. The ruling says the card's words are kept.
  - Only the unlink passes it.

In `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.ts`:
- **`moveCardFrom(…, wasCardless, bound: { onCard: number | null; until: StoryDate | undefined })`**: the new last parameter is passed through to `reparentCastVersions`.

## Items
1. **Unlink from the member page applies from the book's present** (owner: "Yes, from the book's present").
   - `writeMemberEdit` now calls `reparentFromBookPresent({ cardId: null })` in place of `resolveFollows`.
   - With a present:
     - The versions from the present on become card-less and keep the card's words.
     - Earlier dated versions and the undated base stay on the card.
     - The form's other fields are read against the base's card. `baseKeepsCard` is true and `characterId` stays the same on both sides, as the link does with a present.
   - With no present, nothing changes. The existing no-present unlink test passes unchanged.
   - The handler still sets `lorebook_bindings.character_id = null` itself.
2. **A new dated card change stops at the next card change** (owner: "Stop at the next card change").
   - Both `writeCastChange` (create) and `rewriteCastChange` (a fields edit, with or without a re-date) bound the move the way the undo does:
     - `onCard` is `before.characterId`, the card in force before the change.
     - `until` is `cardChangeAround(tx, version, lorebookId).nextChange`.
   - The bound is read after the version is written (in `rewriteCastChange`, after `moveSwitch`) and before the move.
   - A later change on another card is left alone. A later return to the earlier card (for example C, then card-less, then a card-less version) is not overrun.

## Changed files
- `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts`: `reparentCastVersions` (option and JSDoc) and `reparentFromBookPresent`.
- `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.ts`: `moveCardFrom`, plus its two call sites in `writeCastChange` and `rewriteCastChange`.
- `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.ts`: `writeMemberEdit` and its doc comment. The now-unused `resolveFollows` import is removed.
- Seven tests added; no existing expectation was edited:
  - `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.castVersions.int.test.ts`:
    - "an unlink at the book's present: earlier versions stay on the card; the present and later ones become card-less keeping the card's words"
    - "a link then an unlink at the same present keeps the card's words"
  - `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.castVersions.int.test.ts`:
    - "a new dated card change stops at the next card change"
    - "a new dated swap leaves a later change on another card alone"
    - "the fields path is bounded too"
    - "the fields path with a re-date is bounded too"
  - `/home/jody/github/serene-pub/src/lib/server/characters/versions.authoring.int.test.ts`:
    - "keepCardWords: unlinking from a date keeps the old card's words; without it a card-less reference's words come back". The second half pins today's exception.
- `/home/jody/github/serene-pub/NOMENCLATURE.md` §25: one row inserted right after the cv-fix2 row (line 3352). I re-read the file before the edit, and the `|` inside the signature is escaped.
- Worker brief: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-fix3-w1.md`.

## Tests
- **Vitest:** `npx vitest run … --maxWorkers=2` on:
  - `versions.authoring.int`, `versions.int`, `versions.write.int`, `versions.test`
  - `amendments.castVersions.int`, `amendments.int`, `lorebooks.castVersions.int`
  - `providedBooks.int`, `starterKitsVersions.int`, `versionsWriter.guard`
- **Result: 10/10 files, 223/223 tests pass.** The log is `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-fix3-run.log`. The worker's own run was 9 files, 221 tests, all green.
- **`tsc --noEmit -p .`:** no lines in `characters/versions*`, `sockets/amendments*` or `sockets/lorebooks*`.
- **Prettier:** `versions.ts` and the three test files are clean. `amendments.ts` and `lorebooks.ts` were already not clean at the start, in hunks outside this lane, so only our own hunks were formatted.
- **Temp dirs:** I compared a before/after listing. The only new dir is `/tmp/serene-pub-vitest-RMnezk`, created at 07:06:53, after my run had ended. Another session's `vitest run sockets/components.int` was live then, so it isn't this lane's dir and I deleted nothing.
- **Scope:** the only files changed since the worker brief are the six owned files and NOMENCLATURE. The one exception is `plans/briefs/BRIEF-cv-client-w1.md`, which belongs to another lane. I didn't run a `scope-reviewer`; per the guide that's for the accepting lead.

## Open ★
None new. One choice inside scope for the lead to confirm: **`keepCardWords`** is an internal option name and appears in the §25 row. The alternative was to restrict the "restore the reference's words" exception to undo callers. I rejected that because the create path now also passes `onCard`, so it would have changed behaviour beyond the brief.

## Queued (not my files)
- **`docs/lorebook-cast.md` / `docs/lorebook-time.md`.** Add to cv-fix2's queued link line:
  - "Unlinking a card from the member page also applies from the book's present: that change and every later one keep the card's words as their own and no longer follow it; earlier changes stay on the card. A book with no present yet unlinks all of them."
  - "A new dated card change applies up to the next card change after it; later changes on another card stay as they are."

## Noticed, not done
- **The member form after an unlink at a present.** This mirrors cv-fix2's note for the link.
  - The base stays carded, following the card with empty own columns, while `lorebook_bindings.character_id` is null.
  - `withBaseColumns` projects the base with `carded: false`, so the member page form shows the followed fields blank until wave 3's client reads versions. The read path (`memberAsRead`) is correct: card-less, with the card's words.
  - A save then writes only touched fields.
  - This is worth a look for whichever lane owns `withBaseColumns` / wave 3.
- **The worker's note** that `reparentFromBookPresent({ cardId: null })` writes a carrier even for a member with no card is moot. The handler's `unlinking` flag requires `existingBinding.characterId != null`.
- **The dated-unlink edge.** A dated unlink written at the same key as a dated link (the create path, reference card-less) still uses the restore exception, so it gets the pre-link words back. That works like an undo and is unchanged by this lane.
- **The "next card change" bound looks only at the change's own line.** This is the same limitation as the undo, already in cv-fix2's notes.