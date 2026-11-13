# REPORT — lane `sense-st2b` — 2026-11-11 (saved by the lead; condensed from the supervisor's message)

## Part A — the undo rule's review findings

1. **A scene boundary goes with a turn only when nothing sits after it.** `takeSceneBoundariesAt(tx, messageId,
   { leavingWith? })` (`scenes/liveScenes.ts`, private `laterLineStays`) checks each scene in all three steps (opened
   at the row, closed at the row, a selection holding the row): if a live line of the session sits on that scene's
   channel after the row and is not leaving too, the scene is left exactly as it is. Both cases. A person's boundary
   cannot be told from a turn's (`schema.scenes` has no such column); no second rule.
2. **A failed re-tell keeps no annex values.** `AnnexDeltaTaken.kept?: true`; `retractAnnexDeltasAnchoredTo` gains
   `opts.except`; `restoreRetractedState` fully takes the failed run's own deltas before putting the swipe's back.
3. **The reveal follows the rule**: `reveal.ts` strings and `docs/genre-dungeon-crawler.md`.
4. **The round's move on a replacement is ruled** ("Keep the round's move on a swipe"): "interim" removed from
   `guides/storage.md`; `docs/stats-and-states.md:90` says "a round's move".
5. `sessions/retakeTurn.ts` `deleteTurnYield` takes scene boundaries by the same rule.
6. `utils/generationStatus.ts` ~249–268 was written by lane `bench-L4b`, not `sense-st2`.

New tests: `oneUndoRule` +7 (older row keeps the scene, newest takes it, Back of a whole turn, `deleteTurnYield`),
`annexChanges.keepOnRetell` +2 (failed re-tell, mixed and kept-only rows). Not proven by removing the fix.

## Part B — the Lair's clock is the round tick

The round tick is back to four parts (round worth, `moves`, `at`, `advance`; outlet key
`clock.moves.clocked.at.advance`). The Lair registers it in `lairRegistrations`, as Story does. The keeper's
`ownsTheClock`, `clockUnnamed` and `round` branch are gone; its *Move the clock* ships off in every Lair preset.
The empty-branch store rule and its tests stay, on a fixture junction. ★CLK2-1 and ★CLK3-2 are closed. ★CLK2-3
now covers the Lair too: with *Move the clock* switched on the clock moves twice a round; the docs say to set the
round worth to 0.

## Lead's follow-up

- `retractStateAnchoredTo` takes `{ leavingWith }` explicitly and `sessions/rewind.ts` passes `unit.ids`; the
  module-level `WeakMap` the lane used is removed.
- `routines/roundTick.int.test.ts`: "Story and the Lair register it". `sockets/sessions.lairCastRows.int.test.ts`
  leaves the round tick out of its reply-run list again.
- Re-pinned with dated notes: `core:spec/dungeon-crawler-reveal@1.0.0` → `2201000dc17a1`;
  `core:spec/lair-keeper@1.0.0` → `1e7e03116e5d3d` and `core:spec/round-tick@1.0.0` → `123220d7c924ea` (both back to
  their hashes before the keeper-owner work); SDK digest → `01624c1fa8720c3b`.
- Verified by the lead: `tsc` clean; SDK `coreCatalog`, `coreClockOwners`, `coreGenreDefaults`, `junctionEmptyBranch`,
  `keepOnRetell` 46/46; app, 17 files 211/211 (undo rule, annex changes, rewind, live-scenes rewind, round tick and
  its undo, clock owners, round worth, spec and registry hashes, chain round trip, the Lair, enabledWhen, actions and
  Dungeon Crawler socket tests, `replyRoad`).

## Provisional copy 🚧

`reveal.ts`: "Shows everyone the Planner's secret notes. Going Back past it hides them again." and the confirm
text. `docs/genre-lair.md` ~160, `docs/lorebook-time.md` ~110, `guides/time.md`, `guides/storage.md` (the scene
boundary sentence), the NOMENCLATURE rows.

## Queued (small leftovers)

- Stale ★ST2-1 "interim" comments: `state/clockMoves.ts` ~32, ~250, ~338; `sockets/sessions.ts` ~9325, ~9961;
  `roundTick.undo.int.test.ts` ~2; the NOMENCLATURE §25 sense-st2 row.
- `reveal.ts` ~105 comment ("for good") and possibly the Planner's posted note.
- `restoreRetractedState` opens one extra transaction on every call.
- `src/lib/generated/docs/` lists an outlet key that no longer exists.
- `sdk-tests` import the built package, so they need a build before they run.
