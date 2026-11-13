# REPORT cv-fix2 (2026-11-06)

No status question was relayed. All five scope-review findings are built, and the 0146 journal check needed no change.
- Targeted tests: 220 of 221 pass. The one failure is a stale-allowlist check in `frozenColumns.guard`, caused by lane cv-readers' in-flight work, not this lane (details under Tests).
- `tsc` shows no errors in lane files.
- I ran no `sdk:build` (there was no SDK change), committed nothing and never used `git stash`.
- Two Sonnet workers ran one after the other: w1 on `versions.ts`, then w2 on the sockets and provided books.
- The harness refused to let me write `plans/REPORT-cv-fix2-2026-11-06.md` ("subagents return findings as text"), so this message is the only copy. Please save it there.

**0146 journal `when`: generated, not hand-set.** cv-fix's transcript (11:35:12Z) shows what happened:
- A node script only *removed* the idx-146 entry.
- `npx drizzle-kit generate --name character_versions` then wrote the new entry. Its `when` is 1793964915000, 03:35:15 PST, exactly the second the command ran; the round thousand is a coincidence.

I didn't regenerate it.

## Names and signatures (🚧)
In `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts`:

**`reparentCastVersions(tx, castMemberId, { cardId, cardVersionId?, follows?, from?, onCard?, until? }) → number`** (changed).
- **Follows, version by version (finding 2).** `follows`, when given, is the set of fields that *may* follow. Each version follows a field from that set only when it already followed it, or when its own value deep-equals the value of the **reference**. The reference is the version in force just before the move point (with `from`: the version in force on that line strictly before `from.date`; without `from`: the base), read once before any update.
- **Going card-less** from a card-less reference gives each field that stops following the reference's words back. This is how an undone link gets its old words.
- **Retire step (finding 4).** A session's row that a branch still reads (`descendantReads`) is retired, and the re-parented copy is inserted with the same provenance. Retired rows are never touched.
- `cardVersionId` names the exact card version to land on.
- `onCard` (the key present; null means card-less) and `until` (exclusive) limit which versions an undo moves.

**`reparentFromBookPresent(tx, castMemberId, { cardId, follows?, writtenBy }) → { present, changed }`** (new).
- The book's present is main's story clock, else its newest dated history entry (private `bookPresentOf`).
- With a present, it writes a no-op **carrier** version at main/present (`writeCastVersion`; an authored version already at that key is updated in place), then re-parents from that date.
- With no present, it re-parents every version.

In `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.ts`: the private `cardChangeAround(tx, row, lorebookId) → { prev, rowCard, prevCard, nextChange }`.

## Items
1. **Removing or re-dating a dated card change (HIGH).**
   - **Remove:** the versions the change had moved go back onto the **exact** card version the earlier version has: `cardVersionId` = prev's parent, so a pinned member stays pinned. This runs from the change's date, only for versions still reading the change's card, up to the next card change on its line. Undoing a dated *unlink* gives back prev's `follows`, under the version-by-version rule.
   - **Re-date later:** the versions between the old and new dates go back the same way.
   - **Re-date earlier:** the versions between the new and old dates that were on the earlier card come onto the change's card version. When the change was a link, they follow by the change's own `follows`.
   - Everything happens in the same transaction, after `lockBookCalendar`.
2. **Version-by-version `follows` (HIGH)** as above. Every caller that passes `follows` gets it: the member-page link, a dated link, the provided-book "card appears" path, and a re-date's redo.
3. **"The book's present" (HIGH; owner 2026-11-06).**
   - `writeMemberEdit` now calls `reparentFromBookPresent` for a link and for a swap, which the same day's ruling, *"linking or swapping … 'From the link date on'"*, covers. The provided-book "card appears" path calls it too.
   - With a present, the base keeps its card, and the form's other fields land on the base read against that card. The client sends only `{ characterId }` on a link (`CastWorkspace.svelte` `pickCharacter`), so in practice nothing else is written.
   - With no present, it behaves as before. All existing link tests run on a book with no present and pass unchanged.
4. **Retire step for re-parents (MEDIUM)** as above.
5. **A re-date keeps `historyEntryId` (MEDIUM).** `rewriteCastChange` now passes `row.historyEntryId`. The update handler's comment says so.

## Changed files
- `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts`: `reparentCastVersions` rewritten; new `reparentFromBookPresent`, `bookPresentOf`, `stableJson`; it imports `versionInForce`. It stays a leaf: the `state/reading` and `cast/memberAsRead` imports are dynamic.
- `/home/jody/github/serene-pub/src/lib/server/sockets/amendments.ts`: `cardChangeAround`, the delete handler's undo, `rewriteCastChange`'s `moveSwitch` and history entry, and the update handler's comment.
- `/home/jody/github/serene-pub/src/lib/server/sockets/lorebooks.ts`: `writeMemberEdit` and its imports only.
- `/home/jody/github/serene-pub/src/lib/server/plugins/providedBooks.ts`: the card-appears block and its import only.
- Tests, with no existing expectation edited:
  - `src/lib/server/characters/versions.authoring.int.test.ts`: 8 new tests.
  - `src/lib/server/sockets/amendments.castVersions.int.test.ts`: 5 new.
  - `src/lib/server/sockets/lorebooks.castVersions.int.test.ts`: 2 new.
  - `src/lib/server/plugins/providedBooks.int.test.ts`: 1 new.
- `/home/jody/github/serene-pub/NOMENCLATURE.md` §25: one row appended right after the cv-guards row (line 3351).
- Worker briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-fix2-w1.md` and `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-fix2-w2.md`.

**The brief's six tests, and where they are:**
- **Remove a dated card change:** later versions go back on the earlier card. `amendments.castVersions.int`: the link, swap-at-exact-version and spared-later-change tests.
- **Re-date it:** the re-parent moves. `amendments.castVersions.int`: later then earlier.
- **A later version's own description survives a link.** `versions.authoring.int`, two tests, plus the year-150 version in `lorebooks.castVersions.int`.
- **A member-page link at the book's present** leaves an earlier dated version alone. `lorebooks.castVersions.int`, link and swap.
- **A re-parent of a row a branch reads** retires it. `versions.authoring.int`.
- **A re-date keeps `historyEntryId`.** `amendments.castVersions.int`.

## Tests
- I ran `npx vitest run … --maxWorkers=2` on these files:
  - `versions.authoring.int`, `versions.int`, `versions.write.int`, `versions.test`;
  - `amendments.castVersions.int`, `amendments.int`, `lorebooks.castVersions.int`;
  - `providedBooks.int`, `starterKitsVersions.int`;
  - `versionsWriter.guard`, `frozenColumns.guard`.
- Result: 10 of 11 files and **220 of 221 tests** pass. The log is at `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-fix2-run.log`.
- **The 1 failure is `frozenColumns.guard` › "every allowlist entry still has its site".** It lists 19 stale `SESSION_COPY_READS` entries in session-path files (`turnPlan`, `turnYield`, `sprites`, `handEdits`, `resolve`, `write` and others). Lane cv-readers is moving those reads right now. None of the entries is in a cv-fix2 file. cv-readers or the lead should trim the allowlist when that lane lands.
- **`tsc`:** one error, at `sockets/narrativeGraph.ts:5946` (TS2353 `castAmendment`). It isn't a lane file; probably cv-readers' work in flight.
- **Prettier:** `versions.ts`, `versions.authoring.int` and both castVersions test files are clean. In `amendments.ts`, `lorebooks.ts`, `providedBooks.ts` and `providedBooks.int`, which weren't clean before, only our own hunks were formatted.
- **Temp dirs:** my runs left no `/tmp/serene-pub-vitest-*` dirs, and I deleted none. Another session's full `vitest run --maxWorkers=3` was running the whole time, and the new dirs are its own.
- **Scope review:** I checked both workers' diffs against their briefs myself. I didn't run a `scope-reviewer`; per the guide, that belongs to the accepting lead.

## Open ★ (for the owner's batch)
- **★cv-fix2-1: unlinking from the member page.** It still reaches every version (`resolveFollows` detach). The 2026-11-06 rulings name linking and swapping only. **Recommendation:** unlink applies from the book's present too, for symmetry, using the same carrier + `reparentCastVersions({ cardId: null, from })`. The trade-off: earlier versions then stay carded under a binding that names no card.
- **★cv-fix2-2: a *new* dated card change has no upper bound.** In the create path (`writeCastChange` → `moveCardFrom`), a card change at year 5 also re-parents the versions after a later card change at year 10, overrunning it. **Recommendation:** bound it as the undo is bound (`onCard` = the card in force before it, `until` = the next card change on its line). This changes what users see, so it waits for a go.
- **Two new refusal sentences, from `reparentCastVersions` (internal callers only today):**
  - "Character version N is not a version of card M."
  - "Character version N belongs to a card, so it cannot be used to make ‹name› card-less; give the card it belongs to."
- **Choices inside scope, for the lead to confirm:**
  - "A field the version did not write itself" is read as *differs from what the member read just before the move point*, not *differs from the version just before it*. So words an in-between version wrote carry forward: a year-10 copy of a year-5 retelling keeps the retelling.
  - The carrier's `historyEntryId` is the history entry at the present only when that entry's date equals the present; otherwise it is null. With no clock, the present *is* the newest entry, so it is always that entry's id.
  - With a present, a link combined with other form fields writes those fields to the base only. Following ★CV-13, the carrier and later versions keep their own words unless **Change later versions too** is on.
  - The undo's "next card change" looks only at the change's own line. On a branch line, versions after a C→D→C round trip could be caught.

## Queued (not my files)
- **`docs/lorebook-cast.md` / `docs/lorebook-time.md`** (these replace cv-fix's queued link line):
  - "Linking a card to a cast member, or switching their card, from the member page applies from the book's present: the change at the present and every later one read the new card for the fields you don't retell, and a later change keeps the words it has of its own; earlier changes stay as they were. A book with no present yet applies it to all of them."
  - "Removing a dated card change puts the changes after it back on the card they had before, up to the next card change; moving it to another date moves where the switch happens. A moved change keeps its history entry."
- **`frozenColumns.guard.test.ts` `SESSION_COPY_READS`:** 19 stale entries, for cv-readers or the lead.

## Noticed, not done
- **The member page's form reads the base.** After a link at the present, the base stays card-less while `lorebook_bindings.character_id` names the card. `withBaseColumns` then shows the base as carded with every field retold and an own name until wave 3's client reads versions. The Changes list does show the carrier row, with "characterId" as its change.
- **`syncLorebookBindingsForCharacter`** (`utils/characterBindingSync.ts`) still writes the merged aliases to the undated base after a link, even when the link applies only from the present.
- **Card hops in one request.** `rewriteCastChange` with both a re-date and a fields card change runs the switch move first, then `moveCardFrom` from the new date with no bound (see ★cv-fix2-2).
- **Duplicate work.** `reparentCastVersions` reads the book's lines twice under `from`: once for the reference and once for the scope. It is harmless.