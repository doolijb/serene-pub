# REPORT — bench-L4b: seat facts on sessions:get; the delete path announces — 2026-11-11

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-bench-L4b-w{1,2}.md`.

## Changed
- **Goal A (★L4-1):**
  - `sessions/seats.ts`: `seatHasLines` is exported.
  - `sockets/sessions.ts` `withSessionExtras`: benched rows only get `hasLines` (from `seatHasLines`, using the stored card) and `fellInStory`. A seat is fallen when (a) the last core-annex `seatBenches` record for it has `to === true`, (b) the member's version in force is deceased (from existing reads), or (c) for player seats, the old rule. The block is in a try/catch, so the fields stay absent on error.
  - `shared/sockets/types.ts`: both fields on both seat row types.
  - Client unchanged (names already matched). **Lead:** the stale header comment in `benchedSeats.ts` is updated.
- **Goal B (Departure 1):**
  - `messages/store.ts`: `retractLoreOf` returns `SeatChange[]`; `deleteLegacy`/`deleteLegacyWhere` take `opts?: {seatChanges}`.
  - `sessions/retakeTurn.ts`: `deleteTurnYield` announces after commit (this covers the socket turn delete and `retakeTurn`).
  - `runtime/host.ts`: the deletion outlet announces.
  - `utils/generationStatus.ts`: the failed-reply retraction announces.
- **Tests:**
  - `sessions.benchedSeats.int`: 5 seat-fact tests;
  - `editSessionBench.dom`: 3 tests (Remove only on an unused seat; Skull on a fallen seat);
  - `setSeatBench.int`: 3 delete-path tests (unbench plus one `cast-changed`).

## Tests
- Targeted: 6 files, 78/78. Worker w2: 6 files, 108/108.
- `tsc`: 0 (heap 8192). `check`: 0 errors.

## Names for L5
`hasLines`, `fellInStory` (host-filled seat row fields, 🚧).

## Noticed, not done
- Rule (a) can mark a seat fallen after a genre bench, then a person's bring-back, then a person's re-bench. Rare; Back clears it.
- `discardForwardStack` doesn't collect seat moves (deliberate: Back already announced them).
- The new `withSessionExtras` block is indented one level off.
- Prettier warns on the tests.
- The announce cause is "settings".

## Cross-check review (L3/L4/L4b, 2026-11-11): no objection on P2 one-writer, P1 no-auto-bench, seat facts, announce-after-commit, client listeners/toasts
- **★ for the owner (P1 "shows its cause"):** `announceSeatChanges` labels every seat move `cause: {kind:"settings", userId}`, including a genre's bench through the port and every undo. A pipeline or undo cause would be truer. It must still never fire a turn, because "settings never fires a turn" is what stops a bench loop (`sessions.ts:~11898`).
- **Noticed:** the `seatPlayer` `held` branch (`seats.ts:~1007-1025`) could revive a live benched card-less seat without `setSeatBench` if called with a `castMemberId` and no `personaId`. No current caller reaches it.
