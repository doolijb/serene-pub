# REPORT — bench-L3: the bench port, undo, DC companion death and revival — 2026-11-11

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs: `plans/briefs/BRIEF-bench-L3-w{1,2,3}.md`. Built against the lead's 04:54 sdk:build; no SDK change after it. A scope review ran inside the lane: no objection.

## Lead rulings applied
- **Q1:** `seatBenches` added to `CORE_RUNTIME_KEYS` (`sessions/coreAnnex.ts`).
- **Q2, a BEHAVIOUR CHANGE for the owner:**
  - DC `companionsOf` read `doc.cast.characters`, which the host never sends, so companions were invisible in real sessions. It now reads `cast.sessionCharacters`, skipping removed seats and leaving benched ones out of "travelling".
  - **Companions now appear** in the Planner brief, the opening and genesis ("Travelling with them…"), the companion refusals, and the door script.

## Changed (SDK)
- **`contracts/src/outlets.ts`:** `setSeatBench` = `core:outlet/set-seat-bench@1`.
  - In: `seat`, `benched`. Out: `main`, `seat`, `seats`.
  - `effects: write`, `reviewDefault: off`, `review: {fields: []}`.
  - Doc: opt-in, tied to the turn, a person's drag wins.
- **`sdk/src/descriptors.ts`:** `writes.seats?: boolean` (absent = off), validated in `assertSessionWrites`.
- **`registry/genres.ts`:** DC `writes: {lore, scenes, seats: true}`.
- **DC:**
  - `preamble.ts`: `companionsOf`;
  - `shape.ts`: `fallenCompanions` and `revivedCompanions` (≤4);
  - `storyScripts.ts`: `checkPlan`;
  - `story.ts`: the Planner clause and line; ledger companion fates (a death → bench + deceased + `progress.fallen {companion: true}`; a revival → unbench + active + leaves fallen); `lastTelling.companionFates` for a redo; a `companions` junction (bench, then state).
- **Tests:**
  - new `seatBench.test.ts` (4) and `dungeonCrawlerCompanions.test.ts` (5);
  - fixtures moved to `sessionCharacters`;
  - re-pins: `dungeonCrawler`, `dungeonCrawlerStory`, and the **`coreCatalog` golden `a369acc812fc28de` → `cc185d575cea6419`** (proved by a source-vs-dist diff).

## Changed (core)
- **`sessions/coreAnnex.ts`:** the `seatBenches` runtime key.
- **`messages/writes.ts`:** `seatWriteRefusal` (only `writes.seats === true` passes).
- **`runtime/host.ts`:** the `set-seat-bench` case.
  - It refuses first: a non-boolean `benched`, then `seatWriteRefusal`.
  - `seatOf`, then `setSeatBench`. With a turn message it appends a `seatBenches` record under `lockSessionAnnex`.
  - It announces `announceSeatChanges` after commit.
- **`runtime/bindings.ts`:** the binding.
- **`state/write.ts`:** `retractSeatBenchesAnchoredTo` (goes back to `from` through `setSeatBench`, so a person's later drag wins).
  - `retractStateAnchoredTo` calls it.
  - `restoreRetractedState` re-applies it.
  - `reviveRetractedState` carries `seatBenches`.
- **`messages/store.ts`:** the delete path calls it.
- **New `runtime/setSeatBench.int.test.ts` (7):** refused without opt-in; benches tied to the turn; Back and Forward; a person's drag survives Back; regenerate; no anchor; delete.
- **Pins:** `specHashes` (DC create, respond), `registryHashes` (new outlet).

## Tests
- SDK from source: 13 files, 214/214. After the build, `coreCatalog`/`forms`/`formsReview`/`writes`: 69/69.
- Core after the build: 15 files green (after re-pinning). `tsc`: 0.

## Names for L5
- `core:outlet/set-seat-bench@1` ("Bench or bring back a seat"), `writes.seats`, `seatBenches`, `seatWriteRefusal`.
- 🚧 `fallenCompanions`, `revivedCompanions`, `companionFates` (stored), `progress.fallen[].companion` (stored).
- `SeatBenchRecord`, `retractSeatBenchesAnchoredTo`.
- Node keys `channel.story.companions.fates.companion.item.{bench,state}`.

## Open ★ (copy, proposed)
- **L3-1:** refusal "This session's genre ('‹name›') does not bench or bring back seats."
- **L3-2:** host halts.
- **L3-3:** labels.
- **L3-4:** Planner wording.
- **L3-5:** Narrator wording.
- **L3-6:** a companion with no member is skipped. Recommended: keep it.
- **L3-7:** a companion dragged back after a death stays in fallen. Recommended: keep it.

## Queued
1. **Undo moves aren't announced.** Back, Forward, regenerate and delete move seats with no `cast-changed`, so open pages are stale until a refresh. → given to L4.
2. `stateMoved` doesn't list `set-seat-bench`. Probably right.

## Noticed, not done
- `reviveRetractedState` never carried `rulesetConversions`.
- `announceSeatChanges` stamps cause "settings" even for a pipeline bench.
- `assertSessionWrites`' error text lists only lore/scenes.
- `sdk-tests` core-catalog imports read dist.
