# REPORT cv-time (2026-11-05)

Status question: none was relayed. Items 1, 2, 4 and 5 are built. My grouped targeted run is 33 files, 375/375 green. **Item 3 (a parent's own book outliving it) is not built: it needs a schema change, so it is ★cv-time-1 below.** The retired-row sweep from §33.2, which goes with item 3, is built and wired into `sessions:delete`.

## Names and signatures (all 🚧)

**`src/lib/server/characters/versions.ts`** (worker w1; three helpers added, nothing else in cv-core's file changed):
- `retireOrTakeVersions(tx, rows): Promise<{ taken; retired }>` — for each row a session wrote:
  - if a descendant session still reads it (the existing private `descendantReads`, through each descendant's session cut), it gets `retired_order = nextWriteOrder(tx)`;
  - otherwise it is deleted.
  - Rows are returned as they were. Rows with no source are skipped.
- `restoreVersions(tx, rows): Promise<number>` — what Forward and a failed replacement use. It does `INSERT … ON CONFLICT (id) DO UPDATE SET retired_order = NULL`, keeping ids and `write_order`. Its doc comment says it is the table's one other INSERT, because a restore never draws a new id.
- `sweepRetiredVersions(tx, sourceSessionIds): Promise<number>` — deletes retired rows of those sources that no live descendant reads.

**`src/lib/server/state/write.ts`** (only the retract/restore hunks):
- `retractLoreAnchoredTo` now also takes `character_versions` where `source_message_id IN ids` and `retired_order IS NULL`. When there are any, it takes `lockStateVersion(tx, sessionId)` first, then calls `retireOrTakeVersions`. It returns `castVersions`, which also counts toward `changed`.
- `RetractedState.castVersions?` is optional; records written before it have none. `retractStateAnchoredTo` fills it. `reviveRetractedState` revives it, and `restoreRetractedState` calls `restoreVersions`.
- `takenSummaryOf` is untouched, because it is an SDK outlet port's shape.

**`src/lib/server/sessions/branch.ts`** (`branchSession`):
- It takes the parent's `lockStateVersion` first. The mark is `nextWriteOrder - 1`, drawn from the sequence, so a retire drawn just before the fork counts as before it.
- It writes `branchAncestry: [{parent, mark}, ...parent.branchAncestry]` and `lineOnFirstWrite: parent.lorebookId != null`.
- Every copied line gets `originSessionId` and `originMessageId`, pointing at the root play through any copy of a copy.
- ★CV-14: `settleSeats(tx, branch, { seatMembers })` uses the parent's live seat members, keyed by card id.
- Each copied seat keeps the parent seat's seater.

**`src/lib/server/sessions/seats.ts`**:
- `seatCast({ seatedBy?: number | null })`:
  - on insert it writes the given value; if none is given, the card's owner (today's rule), or null for an envoy;
  - on revive it sets the value only when given, otherwise `coalesce(existing, card owner)`.
- `SeatBook.ancestorBooks: {lorebookId, mark}[]` is filled by `seatBookOf`.
- `findSeatMembers` now also looks in the ancestors' own books, after the attached book and the session's own book.
  - A member found there counts only if its first cast version's `write_order` is at or below that ancestor's mark. A member with no version counts. The private helper is `memberMadeBy`.
- `settleSeats` opts gains `seatMembers?: ReadonlyMap<cardId, memberId>`, which seeds its cache.
- `ResolvedSeat.actingUserId`: a character seat's `seated_by_user_id`, or a player seat's `user_id`.
- `seatActorOf(tx, sessionId, seat): Promise<number | null>`: `actingUserId`, else the owner of the member's active card, else the owner of the seat's own card.

**Acting-rights readers:**
- `messages/permissions.ts` `ownsSeatedCard` is now `seatActorOf(...) === userId`. A card no seat holds is still judged by the card's owner.
- `sockets/sessions.ts`, the fire-turn `ownsIt` hunk only, uses the same rule.
- `state/handEdits.ts`: a new `seaterOf` map. The player-role "character nobody plays" case now goes to the seater, else the card's owner.
- `seatName.ts`, `seatPortrait.ts` and `sockets/state.ts` judge only player seats, by `user_id` (I checked with grep), so §33.4 already holds there. They are unchanged.

**`src/lib/server/sockets/sessions.ts`**, delete hunk (mine): it reads the session's `branch_ancestry` before deleting the row. After the delete it runs `sweepRetiredVersions` for those ancestors in a transaction. This is best effort: a failure is logged and the delete still stands.

## Changed files
- `/home/jody/github/serene-pub/src/lib/server/characters/versions.ts` (three helpers)
- `/home/jody/github/serene-pub/src/lib/server/state/write.ts` (the retract/restore hunks)
- `/home/jody/github/serene-pub/src/lib/server/sessions/branch.ts`
- `/home/jody/github/serene-pub/src/lib/server/sessions/seats.ts`
- `/home/jody/github/serene-pub/src/lib/server/messages/permissions.ts`
- `/home/jody/github/serene-pub/src/lib/server/state/handEdits.ts`
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.ts` (the fire-turn `ownsIt` hunk and the delete hunk)
- New tests:
  - `/home/jody/github/serene-pub/src/lib/server/state/retractCastVersions.int.test.ts` (11)
  - `/home/jody/github/serene-pub/src/lib/server/sessions/branch.ancestry.int.test.ts` (5)
  - `/home/jody/github/serene-pub/src/lib/server/sessions/actingRights.int.test.ts` (5)
- Expectations moved:
  - `sessions/seatOf.int.test.ts`: `actingUserId: null` added to three deep-equals.
  - `sessions/branch.seatMembers.int.test.ts`: when the source has two live seats on one member, the branch now carries the same pair. ★CV-14 seeds the parent's member exactly; before, the branch resolved Bram afresh.
- `/home/jody/github/serene-pub/NOMENCLATURE.md` §25: three rows appended after cv-core's (lines 3301–3303): the retract/restore/sweep helpers; branch ancestry, mark, origins, ★CV-14 and `ancestorBooks`; acting rights with `seatActorOf` and `actingUserId`.
- Worker briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-time-w1.md` and `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-time-w2.md`.
- `messages/store.ts` and `sessions/rewind.ts` needed no change. The delete paths reach `retractLoreAnchoredTo` through `retractLoreOf`, and Back and Forward carry the versions through `rewind_taken`. Both are proven by tests.

## Tests
One grouped `npx vitest run --maxWorkers=4` over 33 files: **375/375 pass**. It covered:
- the three new files;
- `versions.write.int`, `versions.int`, `rewind.int`, `store.int`, `write.int`;
- `seats.int`, `seatOf.int`, `seatOf`, `seatMembers.int`;
- `branch.seatMembers.int`, `branch.state.int`, `branch.clock.int`, `branch.revision.int`;
- `fireTurn.seatedMember.int`, `handEdits.int`, `seatSites.int`, `creationModes.seatMember.int`;
- `ownBook.int`, `seatMemberNames.int`, `host.seatMembers.int`, `rowProjection.{playerSeats,seatCast}.int`;
- `sockets/sessions.seatCast.int`, `envoyRoad.int`, `sessionMessages.laneEnvoySwipe.int`, `durable.int`, `rewindMirror.int`;
- `sessionLine.int`, `reading.sessionCuts.int`, `settle.int`.

The brief's test list, item by item:
- Back then Forward restores a cast version, with the same id and `write_order`. This drives the real `rewindTurn`/`forwardTurn`, plus a JSON round-trip variant.
- Back with a branch reading the row retires it: the branch still reads it, the parent doesn't, and Forward clears the mark. A branch forked earlier doesn't keep it, so the row is deleted.
- A swipe of the fork message: the old row is retired, the parent reads its new write and the branch reads the old one, and a failed replacement puts the old row back.
- A delete of an anchored message: with no branch the row goes; with a branch reading it, the row is retired.
- Sweeping: directly, and through `sessionsDeleteHandler` deleting the last branch.
- A branch's ancestry, mark and origins, including a grandchild; ★CV-14 seats; `findSeatMembers` through the cut.
- Acting rights after a dated card change: `activeCardId` moves to C2 (X's), the seater G still acts, X does not. Plus the null-seater fallback and the hand-edit judge.

Other checks:
- `npx tsc --noEmit -p .`: no error in lane files. The four errors are elsewhere: `arrangeCanvas.dom` (old) and `sockets/characters.versions.int.test.ts` (cv-writers' file, in flight).
- `npx prettier --check` passes on the three new test files. I only formatted our own hunks.
- No `/tmp/serene-pub-vitest-*` dirs of ours are left. Four new ones showed up in a before/after listing, but they had already disappeared by the time I checked them; they were other lanes' live runs. I deleted nothing.
- No `sdk:build` was needed (no SDK change), and no dev server was up.

## Choices (inside scope)
- **Mark from the sequence.** It is `nextWriteOrder - 1`, not `max(write_order)`.
- **Locks.** The retraction takes the state lock only when there are anchored versions to take.
- **Retract query.** It matches on `source_message_id` only, with no session filter; message ids are global.
- **Restore is an upsert.** A row the sweep removed after Back still comes back on Forward.
- **Ancestors' members through the cut.** I used the first version's write order against the mark, because §32 does not define a cut for member rows. The edge case: a member whose base was written lazily after the fork is hidden from the branch.
- **Player seats.** They are now judged by `user_id` first in `canActOnMessage`. Before, it was the active card's owner. This is the §33.4 reading.
- **The ★CV-14 seed comes from live seats only.** When a card is in both a character seat and a player seat, the character seat's member wins.
- **The sweep after a delete is best effort.**

## Open ★
- **★cv-time-1 (item 3, blocked: it needs a migration). Deleting a parent while a branch rides its never-surfaced notes.**
  - **The block.** `lorebooks.session_id` is `ON DELETE CASCADE` (schema.ts ~1434). Deleting the session row deletes its own book whatever `purgeOwnBookOf` does, and the members in it go with it. Branch seats that point there (★CV-14) then lose their member (SET NULL).
  - **Why no path without a migration works.**
    - Re-pointing `session_id` to a descendant breaks the unique index: the descendant already has its own book.
    - Setting it to null surfaces the book in every listing (they filter on `session_id IS NULL`), and `overlayChainOf` stops finding it.
  - **Recommendation.** One generated migration that drops the FK on `lorebooks.session_id`, leaving a plain int like the origin ids. Nothing else changes:
    - listings still hide the book;
    - `overlayChainOf` still finds it through the deleted parent's id in the descendants' ancestry;
    - the unique index holds, because identity ids are never reused.
  - **What follows from it.**
    - `sessions:delete` (the only session-delete path; grep found one `delete(schema.sessions)`) purges the own book explicitly unless a live session's `branch_ancestry` names it.
    - The last patron's delete purges the kept books of its ancestors.
    - A boot pass sweeps own books whose session is gone and that no live ancestry names, with a second-boot no-op test.
    - A user delete still removes them through `lorebooks.user_id`'s cascade.
  - **Trade-off.** Session deletion becomes code-enforced rather than cascade-enforced. A future session-delete path that skips the purge would leave a hidden book behind; the boot sweep is the backstop.
  - **Alternatives.** A `sessions.deleted_at` tombstone, which every session query would have to filter. Or copying the parent's own-book people into the branch at the fork, which goes against "Fork what gets changed, when it gets changed".
- No other new ★. The new names (`retireOrTakeVersions`, `restoreVersions`, `sweepRetiredVersions`, `RetractedState.castVersions`, `SeatBook.ancestorBooks`, `ResolvedSeat.actingUserId`, `seatActorOf`, the `seatCast` option `seatedBy`, the `settleSeats` option `seatMembers`) are internal and 🚧. They are in the §25 rows and can be renamed.

## Queued for the lead and other lanes (not my files)
1. **The `seatedBy` caller sites.** These should pass `seatedBy: <acting userId>` to `seatCast`. Until they do, they write the held card's owner, which is today's rule, so nothing regresses:
   - `sockets/sessions.ts` ~1472/~1488 (create), ~6696 (update), ~7779 (add character);
   - `sockets/import.ts` ~1355/~1515 (cv-writers');
   - `pipelines/entities/envoys.ts` is for envoy seats only and doesn't matter.
2. **The origins mirror.** `messages/projectLegacy.ts` doesn't mirror `origin_session_id`/`origin_message_id` into `messages`. Only `session_messages` carries them; that is the table `sessionCutsOf` reads, so the cut is correct.
3. **`takeRunWritesElsewhere`** (rewind.ts, the elsewhere half) doesn't take cast versions anchored outside the rewound unit. The story-write anchor (the world's turn) falls inside the unit in the cases tested.
4. **The grouped run.** I didn't run the `sockets/sessions.dungeonCrawler*.int` and `sockets/scenes.compileLine.int` suites, which call `canActOnMessage`/`branchSession`. They belong in your grouped verification.

## Noticed, not done
- `branchSession` reads the parent, the copy set and the seats before its transaction opens. A write landing between those reads and the lock can be copied without being marked. This is not new; restructuring it was outside the brief.
- A branch of a session with doubled live seats now carries the pair, per ★CV-14; the boot pass merges it later. Skipping a member already taken would be a one-line change if you'd rather.
- The scratchpad is shared by every lane of this session, and another lane overwrote one of w2's helper scripts. Scratch files should carry the lane id, as the guide says.
- `state/handEdits.ts` is untracked in git, so there is no diff to review it against; review the file whole.
- I didn't run a `scope-reviewer`; per the guide that belongs to whoever accepts the lane.
- No `docs/*.md` change: nothing user-facing moved.

## Lead dispositions (2026-11-05 late)
- **★cv-time-1 → built in lane cv-fix as the lane recommends**, inside the owner's ruling ("the notes outlive the parent while any patron rides them"): `lorebooks.session_id` loses its FK (a plain int, like the origin ids) in **0146, regenerated** (still unapplied on any lasting database); `sessions:delete` purges the own book unless a live session's `branch_ancestry` names it; the last patron's delete purges its ancestors' kept books; a boot sweep removes own books whose session is gone and that no live ancestry names (second-boot no-op test). The mechanism is the lead's call; the behaviour is the owner's.
- `seatedBy` caller sites (create, update, add character in `sockets/sessions.ts`; `sockets/import.ts`) → lane cv-fix, after cv-writers lands.
- The rest (`messages` origins mirror, `takeRunWritesElsewhere`, Crawler/scenes suites) → the grouped verification and S4's later lanes.
