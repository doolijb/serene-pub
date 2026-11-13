# REPORT — bench-L4: benched seats, the Participants tab — 2026-11-11

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-bench-L4-w{1,2}.md`. A scope review ran inside the lane: no objection on substance.

## Changed
- **Server:**
  - `shared/sockets/types.ts`: `SetCastSeatEnabled { playerSeatId? }`.
  - `sockets/sessions.ts`:
    - `setCastSeatEnabled` has a player branch; both kinds go through `setSeatBench` → answer → `resendSession` → `announceSeatChanges`;
    - `addPersona` brings a benched persona back;
    - regenerate, swipe and failed-run restore announce seat changes.
  - `state/write.ts`: `retractSeatBenchesAnchoredTo` returns `changes`; `retractStateAnchoredTo` returns `seatChanges`; `restoreRetractedState(…, {seatChanges})`.
  - `sessions/rewind.ts`: Back and Forward announce after commit.
- **Client:**
  - `EditSessionForm.svelte` Participants tab:
    - seated and benched draft lists, split by `inPlay`;
    - Save sends one `setCastSeatEnabled` per changed seat, before `sessions:update`;
    - the switch, "The fallen" and "Removed" are gone;
    - Bench (Armchair) on saved rows;
    - a Benched section: Characters and Players, dnd pairs `character-seat`/`player-seat`, Bring back, ⋯ Reassign…/Remove;
    - focus and aria-live after a move;
    - fallen rows show a Skull, "Fell in the story" and the bring-back note;
    - the new header copy.
  - New: `BenchedSeatRow.svelte`, `benchedSeats.ts` (`seatFellInStory`, `seatHasNoLines`), their tests, and `editSessionBench.dom.test.svelte.ts` (22).
- **Tests:**
  - client: 11 files, 68/68;
  - server: 3 files, 17/17, plus every `restoreRetractedState` caller (11 files, 143/143);
  - `tsc`: 0; `check`: 0 errors.

## Departures
1. **The delete path isn't announced yet** (`messages/store.ts` `retractLoreOf`, `retakeTurn.ts`, `generationStatus.ts:243`, `host.ts:9839`). → follow-up lane bench-L4b.
2. Hand-applied prettier hunks in the script cause formatting-only churn (verified by the review).
3. The floors count seated plus benched (parity with the old switch).
4. The picker and Reassign exclude benched ids.

## ★ (lead decisions unless noted)
- **L4-1:** `hasLines` and `fellInStory` on `sessions:get` seat rows. **Yes (lead):** it implements ruled behaviour (Remove only on an unused seat; fallen character rows). → bench-L4b.
- **L4-2:** copy (toast title, link text, refusals, aria labels, grip tooltip). Kept as provisional 🚧 for the owner.
- **L4-3:** the Bench icon is `Armchair` (new §22 vocabulary for L5).
- **L4-4:** a guest sees Bring back on a carded benched row they don't own, and the server refuses in words. Kept (recommended).
- **L2-1:** the benched guest's composer, a proposal: *"You're on the bench — the owner can bring you back."* / an owner variant. **Asked of the owner.**

## Copy and names for L5
- **Ruled copy:** "Benched", the intro, "Characters"/"Players", "Bench", "Bring back", "More actions for ‹name›", "Reassign…", "Remove", "Fell in the story", the bring-back note, the aria-live lines, the header.
- **Retired copy:** "The fallen", "Removed", the toggle labels, "Character not enabled or disabled", the old header.
- **Names:** `setCastSeatEnabled { playerSeatId }`, `seatChanges`, `data-seat-action`, `BenchedSeatRow`, `seatFellInStory`, `seatHasNoLines`, zone types, icon `Armchair`.

## Noticed, not done
- `reconcileToMode` trims only seated lists.
- The lorebook link leaves the form with no unsaved-changes guard.
- Fallen rule (b) may be too broad for carded personas.
- `addPersona` `findFirst` can mask a benched row behind an older removed one.
- Old switch wording remains in the `setCastSeatEnabled` JSDoc and a refusal.
- `announceSeatChanges` cause is "settings" for undo moves.
- **Dragging isn't dom-testable, so a browser walk is owed.**
- Walk100 and the generated DC docs page still say "The fallen".

## bench-L4c: the benched-only composer (owner, 2026-11-11: "Yes, build it")
- `shared/sessions/playerSeat.ts`: `benchedOnly({seats, userId})`, plus constants `BENCHED_ONLY_GUEST` ("You're on the bench — the owner can bring you back.") and `BENCHED_ONLY_OWNER` ("You're on the bench — bring yourself back in Participants.").
- `sessionPageData.svelte.ts`: `isBenchedOnly` and `benchedOnlyReason`; the add-persona and take-seat CTAs are suppressed.
- `sessionPageProjections.ts`: `composer.closed["*"] = {reason, waits: false}` (a genre's per-lane closure still wins).
- `SessionHostViews.svelte` `noSeatReason` and `actionList` legend chips use the reason. No SDK change.
- Tests: `playerSeat.test.ts`, plus `composerClosedJoin.dom.test.ts` (new case). 2 files, 21/21. `tsc` clean.
- **Lead:** an owner benched while others play keeps live turn controls; only their composer closes. Kept (the owner still runs the session).
- Names for L5: `benchedOnly`, `BENCHED_ONLY_GUEST`, `BENCHED_ONLY_OWNER`.
