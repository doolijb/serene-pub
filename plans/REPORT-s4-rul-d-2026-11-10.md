# REPORT — lane s4-rul-d (2026-11-10): boot fill for seats of cards deleted earlier

Saved by the lead from the supervisor's final message.

**Status:** built and green. At boot, every live seat whose card is soft-deleted, with no member, and whose card neither the attached nor the own book knows, gets a member minted from the soft-deleted card and made card-less with its content, as at delete time. A second boot changes nothing (no rows written, no session re-selected). No migration, schema change, event, `SeatChange` or SDK change. No `sdk:build`, commit or stash. No `/tmp/serene-pub-vitest-*` dirs left. No relayed status question.

## What was built
- `findOrInsertBinding(tx, book, card, opts = {})` (`utils/characterBindingSync.ts` ~352–391): 🚧 option `mintDeleted` (mint for a soft-deleted card); off by default.
- `resolveSeatMember(..., { mint, mintDeleted })` (`sessions/seats.ts` ~366–420): passes it to both `findOrInsertBinding` calls; book choice stays in one place.
- `fillSeatsBeforeCardDelete(tx, cardId, { mintDeleted })` (`seats.ts` ~1420–1520): JSDoc paragraph; returns 🚧 `mintedMemberIds` and 🚧 `filledSessions` (both delete paths ignore them, unchanged); one-sentence exception in the module header (~50–54).
- `sessions/seatMembers.ts` step 1, before settling: one query (`deletedCardSeats`, `union all` over character and player seats) with `takes` (attached may mint, or own book exists — same test as `seatBookOf` / `ownBookOf`). Per card with a `takes` row, one transaction: the fill with `mintDeleted: true`, then `makeMemberCardless(tx, id, { cause: "card-delete" })` per minted id; only `tx`; `cast/cardless` imported dynamically when there is work. Rows without `takes` are never worked and count `unexplained`. A throwing card counts its sessions `failed`, logged by ids. SQL pieces of `resolvable` moved to module level (`knows`, `ATTACHED`, `OWN`, `TAKES_A_MEMBER`); `report.sessions` from a set. Header: step 1, two queries.
- Boot runner `startup/index.ts` unchanged.
- Before settling, so settling finds these seats filled. One transaction per card, so a member minted for one session is found by the next session reading the same book (no second mint). No `io`: nothing sent at boot.

## Changed files
- `src/lib/server/utils/characterBindingSync.ts` (one parameter + JSDoc)
- `src/lib/server/sessions/seats.ts` (option, fill step, header sentence)
- `src/lib/server/sessions/seatMembers.ts`
- `src/lib/server/sessions/seatMembers.deletedCards.int.test.ts` (new, 7 tests)
- `src/lib/server/sessions/seatMembers.int.test.ts`: header, and three tests that pinned the reversed behaviour (~433, ~492, ~537) — now filled card-less, `unexplained` 0; second and third runs still ZEROS.
- `docs/lorebook-cast.md:177`: *"A seat of a card deleted in an earlier version, with no cast member anywhere, is given one made from the card the next time Serene Pub starts."*
- Worker brief `plans/briefs/BRIEF-s4-rul-d-w1.md`.

## Tests
`seatMembers.deletedCards.int.test.ts`: (1) character seat, mintable attached book → member in the attached book, named as the card, its words, card-less; second boot ZEROS, `everything()` unchanged. (2) player seat, own-book-only → minted in the own book; second boot unchanged. (3) character + player seat of one card share one member (`filled:2`, `minted:1`). (4) untouched: deleted card already with an attached member (`minted:0`); live card (settled, linked); departed seat (ZEROS, no binding); another user's attached book, no own book (`unexplained:1` both boots, never worked).
Final run (capped): 12 files, 172 passed, exit 0 — `seatMembers.deletedCards`, `seatMembers`, `seats`, `seats.cardDelete`, `seats.cardless`, `characters.softDelete`, `cast/cardless`, `characterBindingSync` (unit, shownName, concurrentLock, nicknameAlias), `providedBooks`.

## tsc / check
- tsc 3 → 3 (the SDK-build `show-hidden-stats` errors).
- check: 44 errors, 8 warnings — 3 SDK-build + 41 in `CastMemberForm.svelte` (lane s4-rul-b mid-edit). Re-check after s4-rul-b.
- Prettier clean on `seatMembers.ts` and both tests; `seats.ts:349`, `characterBindingSync.ts:149` fail on untouched lines.

## Scope review (answered once)
1. Medium R1: `mintedMembers` clashed with `MintedSeatMember[]` → renamed `mintedMemberIds`. 2. Low: §25 rows → queued. 3. Low: "one query" wording → fixed. 4. Low: log counts with one card in several sessions → fixed (`filledSessions`). 5. No objection to the `resolveSeatMember` option.

## Open ★
None.

## Queued for the lead: NOMENCLATURE §25
- 🚧 `mintDeleted` option on `findOrInsertBinding`, `resolveSeatMember`, `fillSeatsBeforeCardDelete`; only the `seat-members` boot fill passes it.
- 🚧 `fillSeatsBeforeCardDelete` returns `mintedMemberIds` and `filledSessions`; ⚠ not `mintedMembers`.
- `seat-members` boot step 1 as above; module-local `deletedCardSeats`, `knows`, `TAKES_A_MEMBER`; "orphan" avoided (config-address word).

## Noticed, not done
- A takes-less session (attached book not the owner's or provided, no own book) logs `N left without one` every boot — by design; such a session is legacy data under ★27-10. A boot pass making the missing own book would fill these on the next boot (owner's call).
- Step 1, like `resolvable`, doesn't look in ancestors' own books; the fill finds ancestor members, but a branch whose own books can take none is counted `unexplained`.
- Seats of deleted cards whose member is still **linked** to the deleted card (deleted before the ★3 card-less conversion) stay linked; a separate boot conversion would be the owner's call.
