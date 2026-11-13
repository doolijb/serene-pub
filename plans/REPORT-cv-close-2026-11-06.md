# REPORT cv-close (2026-11-06)

Status question: none was relayed.

All seven items are done. Every failing test the brief names now passes, svelte-check reports 0 errors, and `tsc` reports 0 errors. I made one product change, the retire step in `updateMemberToCardVersion`. The other fixes were in fixtures, test mocks, comments and one docs sentence. I ran no migration and added no new export, name or setting. This report was not saved to `plans/REPORT-cv-close-2026-11-06.md`: the harness blocks report files from a subagent, so this message is the only copy.

## Names and signatures
- `updateMemberToCardVersion(tx, castMemberId, cardVersionId): Promise<number>`: the signature is unchanged. It now gets the retire step (§33.2).
- New private helper in `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts`: `retireAndCopyCastVersion(tx, row, member, own: Partial<CharacterProfileV1>, follows: CharacterProfileField[], parentVersionId: number | null): Promise<void>`. It is not exported. It is the retire-then-copy block taken out of `reparentCastVersions`, which now calls it with the same arguments as before. The existing authoring tests still pass. Because the helper is private, it gets no §25 row.

## What changed, item by item
1. **svelte-check:** in `CharacterForm.svelte` line 254, the call now passes `{ characterId: askFor }` (already narrowed to a number) instead of `characterId`, which can be undefined.
2. **Interest-gate mocks (test files only, no product change):**
   - `cast.interestGate.test.ts`: the fake db gains three things:
     - `transaction(cb)`, which calls `cb` with the same fake;
     - `execute`, which `drawIds` needs;
     - a `select` answered by the table passed to `from()`. A `character_versions` select returns a version row, which is what `setAvatar` needs: it now reads the face through `ensureCardVersion` and `updateCardVersion`.

     No assertion label changed.
   - `sessions.interestGate.test.ts`: the fake gains `selectDistinctOn`, which `cardsNow` needs to read the persona. One query label changed: `"characters.findFirst(persona)"` is now `"cardsNow(persona)"` at all four assertion sites, because the product issues `cardsNow` instead of `characters.findFirst`. The assertions themselves are unchanged ("not read when nobody wants it", "read once", "persona gone").
   - `sessionAdjacent.interestGate.test.ts`: a `character_versions` select now answers `[]`, so `pickVersions` gets no rows and the build reaches its log entry.
3. **Fixtures that predate versions (my call: the products were right).** In production every card has a version: `insertCard` makes one, and the `character-versions` boot pass gives older cards their v1.
   - `shares.int.test.ts` "characters and lorebooks shared with the asker are found": the test inserted the card raw, so it had no version, and `jumpSearch` inner-joins the current card version. The fixture now uses `insertCard`.
   - `sprites.int.test.ts` "deleting a sprite deletes its file, unless the file is also the avatar": the test set the avatar raw on the frozen `characters.avatar_media_id` column. `releaseSpriteFile` correctly keeps a file that any version holds as its face. The test now sets the avatar through the `charactersSetAvatar` handler.
4. **Parity harness `session/decorated-lore`:** the cause was the fixture.
   - It inserted the cast member raw (a `lorebook_bindings` row with no base version).
   - The pipeline host names a member from `membersAsRead` (`host.ts` around lines 4260–4295), so the member read as absent and `{{char:1}}` stayed unresolved.
   - The legacy path reads `characters.name` directly, which is why it named Alice.
   - The fixture now uses `insertCastMember`. The harness gate is green.
5. **Comment-history ratchet:** I reworded one comment line in each of five files, keeping the meaning and stating the rule:
   - `castVersionRead.ts` line 129
   - `guardScan.ts` lines 98–99
   - `ownBook.ts` line 1339
   - `seatCards.ts` line 18
   - `vectorizationQueue.ts` line 781

   None of the five is on the ratchet's failure list now. The test still fails on 15 other programmes' files, which I left alone.
6. **`updateMemberToCardVersion`:**
   - Only rows that are not retired are in scope; retired rows are never touched.
   - A row that a session forked from still reads (`descendantReads`) is retired. A copy is inserted on the new parent with the same provenance, its own profile unchanged and its own `follows`.
   - Every other row is re-parented in place.
   - It returns the count of both kinds.
   - The member is loaded only when a retire is needed, so an unknown member still answers 0 rather than throwing.
   - The two refusals are kept.
   - New test in `versions.int.test.ts`, with three rows on card v1, then an update to v2:
     - a row a branch reads is retired, and exactly one copy exists on v2 with the same provenance;
     - a row no branch reads moves in place;
     - a row that was already retired is unchanged (the whole row is compared).
     - The test also checks the returned count.
7. **`docs/sessions.md` line 54:** the last sentence now reads: "If the old session's lorebook is its own **Session notes**, they become a shared lorebook first (what **Share as a lorebook** does), and both sessions read it." This matches `sockets/sessions.ts` around line 907.

## Changed files
All under `/home/jody/github/serene-pub/`:
- `src/lib/client/components/characterForms/CharacterForm.svelte`: one line.
- `src/lib/server/sockets/cast.interestGate.test.ts`, `src/lib/server/sockets/sessions.interestGate.test.ts`, `src/lib/server/sockets/sessionAdjacent.interestGate.test.ts`.
- `src/lib/server/sockets/shares.int.test.ts`, `src/lib/server/sockets/sprites.int.test.ts`.
- `src/lib/server/pipelines/parity/harness.int.test.ts`.
- `src/lib/server/characters/versions.ts`: the helper, `updateMemberToCardVersion`, and the `reparentCastVersions` call site.
- `src/lib/server/characters/versions.int.test.ts`: the new test.
- Comment lines only in `src/lib/client/lorebooks/cast/castVersionRead.ts`, `src/lib/server/characters/guardScan.ts`, `src/lib/server/lorebooks/ownBook.ts`, `src/lib/server/pipelines/prompt/seatCards.ts` and `src/lib/server/embedding/vectorizationQueue.ts`.
- `docs/sessions.md`: line 54's last sentence.
- Worker briefs: `plans/briefs/BRIEF-cv-close-w1.md`, `plans/briefs/BRIEF-cv-close-w2.md`.

Every changed file is inside its worker's owned set. I did not run a `scope-reviewer`; that is left to you.

## Tests
Logs are in `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/`.

- **Supervisor's grouped run** (`cv-close-sup-final.log`, `--maxWorkers=2`): **31 files, 370/370 pass.** It covered:
  - the three interest-gate files;
  - `shares.int` and `sprites.int`;
  - the parity harness;
  - `versions.int`, `versions.authoring.int`, `versions.test`, `versions.write.int` and `versionsWriter.guard`;
  - `lorebooks.updateMemberToCardVersion.int`, `amendments.castVersions.int`, `lorebooks.castVersions.int`, `castMemberLifecycle.int` and `narrativeGraph.castVersions.int`;
  - `client/components/characterForms`.
- **Workers' runs:**
  - w1's gate group: 76/76, in `cv-close-w1-gate.log`. This includes `content.interestGate` and `index.interestGate`.
  - w2's groups:
    - `shares.int` and `sprites.int`: 16/16 (`cv-close-w2-ab.log`)
    - the parity harness: 7/7 (`cv-close-w2-parity.log`)
    - the versions group: 89/89 (`cv-close-w2-versions.log`)
- **svelte-check** (12 GB heap, `cv-close-svelte.log`): **0 errors** across 11039 files. The 8 warnings are the same as before.
- **`npx tsc --noEmit -p .`** (`cv-close-sup-tsc.log`): 0 errors.
- **Ratchet** (`cv-close-sup-ratchet.log`): none of this lane's five files is listed. 15 other programmes' files remain, listed under Noticed, not done.
- **Prettier:**
  - Clean on: `versions.int.test.ts`, `sessionAdjacent.interestGate.test.ts`, `castVersionRead.ts`, `guardScan.ts` and `seatCards.ts`. Also clean on `cast.interestGate.test.ts` and `sessions.interestGate.test.ts`: w1 rewrote these two whole after its edits broke formatting that was clean at `HEAD`.
  - Still flagged, but not on lines this lane wrote:
    - `CharacterForm.svelte`, `ownBook.ts`, `vectorizationQueue.ts` and `docs/sessions.md` were already unformatted at `HEAD`.
    - `shares.int.test.ts`, `sprites.int.test.ts` and `harness.int.test.ts` are flagged only on lines this lane did not touch.
    - `versions.ts` is flagged at lines 2171 and 2176, which are not this lane's lines.
- **Temp dirs:** I compared the `/tmp/serene-pub-vitest-*` lists before and after every run (w1, w2 and my own). No new dir remains, so nothing was deleted.

## Open ★
None from this lane.

## Noticed, not done
- **Parity harness count.** The harness file has 7 tests. The verification log's "1/10 fixtures" counts the fixtures of the corpus, not the tests. Nothing is wrong; I note it because w2's brief said "10".
- **The ratchet's remaining 15 files, from other programmes:**
  - `leaveDestination.ts`
  - `0137_loadout_voices.ts`
  - `indexingActivity.ts`
  - `managed/supervisor.ts`
  - `providedBooks.ts`
  - `honorModeRetired.ts`
  - `sessions/seats.ts`
  - `sessions/settings.ts`
  - `sockets/amendments.ts`
  - `sockets/characters.ts` (5 against a ratchet of 4)
  - `sockets/entries.ts` (4 against 3)
  - `localOnnxModels.ts`
  - `state/write.ts`
  - `activityStore.ts` (2 against 1)
  - `androidWrapper.ts`

  Some of these (`sessions/seats.ts`, `sockets/amendments.ts`, `sockets/characters.ts`, `state/write.ts`) may hold story phrases written by the versions programme too. The brief scoped this lane to five files, so I did not check.
- **Other fixtures that predate versions but still pass.** I left these alone because they pass:
  - `shares.int.test.ts` still inserts cards raw at about lines 64, 119 and 195.
  - `sprites.int.test.ts`'s `setup()` inserts the card raw, and its gallery test (about line 297) sets `avatar_media_id` raw.

  They depend on `ensureCardVersion`'s lazy v1 or don't depend on the face.
- **Unused fake in `sessions.interestGate.test.ts`.** The old `characters.findFirst(persona)` fake is still there, unused.
- **A stray command.** Both workers ran `mkdir -p /tmp/x; rmdir /tmp/x`. The directory already existed with someone else's contents, so `rmdir` failed and nothing was removed.