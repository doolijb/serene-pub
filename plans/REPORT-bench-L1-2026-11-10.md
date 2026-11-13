# REPORT — bench-L1: benched seats, the data half — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-bench-L1-w{1,2}.md`. Stopped **ready to generate**. Full-project `tsc` was clean. No vitest ran (the int tests need the migration first).

## Changed files
- **`db/schema.ts`:** `sessionPersonas.isActive boolean NOT NULL DEFAULT true`.
- **`sessions/seats.ts`:**
  - **`setSeatBench(tx, {sessionId, kind, seatId, benched})`** → `{ok, changes} | {ok:false, refusal}`. It replaces `setSeatEnabled` (deleted), writes only `is_active`, refuses no-such, envoy and removed seats, and is a no-op when nothing changes.
  - `SeatChange` gains `"enabled"` and `value`. `announceSeatChanges` emits `cast-changed {change:"enabled", value}`.
  - **`unseat` now:** a seat in play → benched; a benched seat with no lines → soft-removed; a benched seat with lines → refused. "Has lines" is the private `seatHasLines` (follows `speakerSeatOf`).
  - `seatPlayer({isActive})`: revive sets active.
- **`sessions/seatName.ts`:** retire → `setSeatBench`; `editCardlessPlayerSeats` remove → the new `unseat`.
- **`sessions/branch.ts`:** copies `is_active` for player seats.
- **`sockets/sessions.ts`:**
  - `setCastSeatEnabled` → `setSeatBench`;
  - `removeGuest` benches the guest's player seats (one transaction);
  - `reassignRemovedParticipant` accepts benched seats;
  - `emitCastChanged` deleted.
- **Data upgrade (temporary name `dataUpgrades/benchedSeats.ts`):**
  - Removed rows become benched, keeping `removed_name`.
  - Skips merge victims, envoys, rows with neither card nor member, rows with no lines, and members a live seat holds.
  - Never deletes.
- **Tests:**
  - new: `sessions.benchedSeats.int`, `benchedSeats.int` (4 converts, 8 skips, second boot with `seatMembers` ×2);
  - updated: `seats.int`, `seatName.mint.int`, `branch.cardlessSeats.int`, `seatChangesOfTurn.int`, and the `participantRemoval`/`seatEvents`/`seatCast`/`seatMemberEdits`/`castMemberIds`/`playerSeats`/`cardsNowReads` int tests (a first remove now benches), plus DC Walk100 and Walk2 (a retire benches).

## Continuation (lead)
1. Run `db:generate`; it must produce only the one column, at index > 0151.
2. Rename the upgrade and its test to the tag, and fix the import.
3. Add the `index.ts` entry.
4. Run the targeted tests listed in the hand-back.

**Expected red until L2:** Walk2 around :566-570, because the speaker readers still pick the benched seat.

## Open ★
- **L1-1:** Remove on a seat in play benches it; "has lines" only gates removing a benched seat. Recommended: keep it.
- **L1-2:** refusal copy:
  - "That seat is not in this session."
  - "An envoy isn't benched: switch it off instead."
  - "That seat has left this session. Seat them again to bring them back."
  - "‹name› has lines in this session, so they can be benched but not removed."
- **L1-3:** the upgrade counts a live seat of either table, characters first, newest id first. Recommended: keep it.

## Queued
1. **L2 (must land with L1):** `seatName.ts` `cardlessPlayerSeatOf` and the `mine` pick, `shared/sessions/playerSeat.ts` `isCardlessPlayerSeat`/`isOwnPlayerSeat`, and `messages/store.ts` `speakerSeatOf` all still count benched seats.
2. **L4:** `sessions:setCastSeatEnabled` gets a `playerSeatId` param and player branch (`shared/sockets/types.ts`).
3. **L4:** `sessions:addPersona` refuses to re-add a benched persona. It should bring the seat back (★).
4. **L5 names:** `setSeatBench` (`setSeatEnabled` retired), `SeatChange "enabled"`, `seatPlayer({isActive})`, `session_personas.is_active`, `unseat`'s new meaning, the upgrade tag.
5. **L3:** `set-seat-bench@1` calls `setSeatBench` and announces its changes.

## Noticed, not done
- A "has lines" refusal in `sessions:update` comes after earlier writes have committed (that handler isn't one transaction).
- `seatCast`/`seatCardlessMember` revive a benched row without reporting "enabled".
- Reassigning to the same member is refused by the merge rule.
- The `seat-keys` pass may rekey converted seats on first boot.
- A `branch.ts` comment is stale.
- Prettier drift in `seats.ts`.

## Continuation (lead + worker bench-L1b, 2026-11-10)
- **Migration `drizzle/0152_overjoyed_magik.sql`** (only `session_personas.is_active`). Coordinated with the variable-templates session, which generated 0151 first.
- **Upgrade:** renamed to `dataUpgrades/0152_overjoyed_magik.ts` (+ test) and registered after 0151. Log prefix `[upgrade 0152]`. `atticStash` lists 0152.
- **Test-only fixes (no source bug found):**
  - `seats.int`: `seatedBy`;
  - the 0152 test's merge-victim seed (unique pk);
  - `participantRemoval`: a second remove before the branch;
  - Walk2 Q1-2: the retired seat is seeded benched.
- **Results:** 29 files, 290 tests. Green except two reds owned by L2's readers:
  - Walk2 Q0-2 `:570` (the speaker picks the benched old seat);
  - W3 A9 `:542` (the owner's old seat resolves to the new one, so fate reads "alive").

## Scope review (2026-11-10): no scope objection; findings
1. **Medium:** the upgrade's `held` set used stored `cast_member_id` only, which is NULL on a pr-6 upgrade, so it missed clashes. Being fixed (hist-L1c): `held` now uses the same resolution as the candidates, plus a test.
2. **Low:** the second-boot log filter matched the old prefix. Being fixed (L1c).
3. **Low:** new names (`SeatChange "enabled"/value`, `seatPlayer({isActive})`, private `seatHasLines`) were acknowledged by the lead and passed to L5.
4. **Low:** 0.5.3 removed seats never become benched, because attic ETL runs after 0152 and copies `removedAt`. **★ for the owner.**
5. **Low:** stale comments. The `sockets/sessions.ts` call-site comment is being fixed (L1c). The `seatName.ts` `editCardlessPlayerSeats` JSDoc is queued until L2 releases the file.

## 0.5.3 import (owner, 2026-11-10: "Yes, same rule"), worker bench-L1d
- The 0152 per-session conversion is factored into an exported `benchRemovedSeatsWithLines(tx, sessionIds?)`. The upgrade's `run()` calls it unchanged.
- `attic/etl/sessions.ts` calls it for the imported chats after their messages are restored.
- `attic/upgrade.int.test.ts`: the 0.5.3 removed seat now arrives benched (`is_active=false`, `removed_at` null, `removed_name` kept). It was verified by the upgrade log line. The final run was blocked by bench-L3's in-flight binding; **re-run after L3's sdk:build.**
- `seatName.ts` `editCardlessPlayerSeats` JSDoc is reworded (review finding 5).
- **Re-run after L3's sdk:build (lead, 2026-11-11):** `attic/upgrade.int.test.ts` + `0152_overjoyed_magik.int.test.ts`: 2 files, 58/58 green (the 0.5.3 removed seat arrives benched).
