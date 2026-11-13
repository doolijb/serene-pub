# REPORT — hist-A: one history entry per date (core), Loose-ends chores — 2026-11-10

Saved by the lead from the supervisor's hand-back; the harness refused the supervisor's own write. Worker briefs and reports: `plans/briefs/BRIEF-hist-A-w{1,2,3}.md`, `plans/briefs/REPORT-hist-A-w{1,2,3}.md`.

## Changed files
- **`shared/lorebooks/lineReading.ts`:** pure `historyOwnerStep(line, date)` (rule C). Test table `CASE_HISTORY_OWNERS` (18 rows) in `lineReading.cases.ts`, run in `lineReading.test.ts`.
- **`server/state/reading.ts`:** `historyEntryOver(a, b)`, where the later date wins and of equal dates the lower id. `writeDatingAt` uses it, and its results are unchanged.
- **`server/scenes/historyEntryOfDate.ts`:**
  - `pickEntryOfDate` uses `historyEntryOver`, so a doubled date now picks the lowest id, not the highest position.
  - `create:true` creates on the owning line (`historyOwnerStep`).
  - New `assertHistoryDateFree` checks rule C first, then one entry per date on the target line.
- **`server/sockets/entries.ts`:**
  - **create:** a blank session write reuses the day's entry (`historyEntryOfDate` create, under the lock). Every other dated history create is checked, and a session write *with content* on a taken day is refused (★3).
  - **update:** a re-date is checked only when the date changes.
  - **iterateNext:** answers with the existing next-day entry, or inserts on the owning line.
- **`client/lorebooks/time/TimeLens.svelte`:** a drop onto a day with an entry opens it (lowest id) and appends the dropped row's name to the draft.
- **`client/lorebooks/looseEnds.ts`:** chores `doubled-history-date` ("Two history entries on one date", with `alsoEntryIds`) and `history-before-fork` ("A line's own history before its fork"), plus the input `line?`. `LooseEndsQueue.svelte` gets "Other entry" links.
- **Lead:**
  - `LorebooksWorkspace.svelte` passes `line` to `looseEnds()`.
  - `sockets/scenes.ts` has its compile comment updated for rule C.
- **Tests:**
  - new `entries.historyDateUnique.int.test.ts` (11);
  - extended `historyEntryOfDate.int.test.ts` and `looseEnds.test.ts`;
  - fixtures updated for rule C and the tie-break: `unfiledScenesByEntry`, `entries.lines`, `entries.redateLines`, `entries.sessionWrite`, `entries.unfiledSceneCount`, `embeddingCost`, `loreEntries.unifiedTable`.

## Tests
- `entries*`, `scenes/`, `lineReading`: 27 files, 266/266.
- 30 history-touching suites: green after two fixture fixes.
- `client/lorebooks/` plus exports and more: 120 files, 1414/1415. The one failure is `cast/memberPage.dom.test.ts`, about the cast lore editor's Advanced fold, an area another session edited today.
- `tsc`: 0 errors.

## Decisions made inside scope
- The lowest id wins a tie everywhere.
- Re-dates are checked only when the date changes, so a doubled entry stays editable.
- A blank session write that carries a cast member or lore sources takes the checked path.
- The doubled chore counts archived rows, matching the server.

## Open ★
1. **Dateless-fork refusal copy (provisional):** "‹line› follows ‹parent› with no fork date, so its dated history is ‹parent›'s. Change that day here as an amendment."
2. **Chore fix lines (provisional):**
   - "Give one of them another date, or move what it says into the other and delete it."
   - "Give it a date after the fork, or delete it."
   - The link reads "Other entry".
3. **A session write with content on a taken day is refused, not appended.** `entries.ts` has no imprinted append path. Nothing visible changes today, because the summarize modal's create is blank.
4. **Rule C in a clockless branch session:** its "New history entry" makes an empty entry on **main**, one day after main's newest, because that day is at or before the fork. This is pinned in `entries.sessionWrite.int.test.ts`. The alternative is to start the session's date after its fork (`messages/writes.ts`, hist-E).
5. **Partial dates distinct:** a lead default, applied and tested.

## Queued
- **hist-B:**
  - `create-lore-entry@1` history → `historyEntryOfDate(create:true)`, then append through the imprinted `changeLoreEntry`;
  - `update-lore-entry@1` re-date → `assertHistoryDateFree` only when the date changes;
  - use `historyEntryOver` for ties.

## Noticed, not done
- An undated entry dropped on the Time lens snaps to a taken tick and is now refused.
- A Time-lens drop on or before the fork with no ancestor entry is refused; rule C would allow an empty owner entry.
- iterateNext's toast says "The story's date has moved forward" even when it reused an entry.
- The client date check (`sections/index.ts:262-283`) has no one-per-date rule; the server is the authority.
- A Year-0 fork in the `entries.redateLines` fixture.

## Names for hist-F (NOMENCLATURE / docs), added by the lead after scope review
- **Functions:** `assertHistoryDateFree`, `historyOwnerStep`, `historyEntryOver`.
- **Chore ids:** `doubled-history-date`, `history-before-fork`.
- **Fields:** `LooseEnd.alsoEntryIds`, `LooseEndsInput.line`. **Attribute:** `data-loose-end-also`. **Test table:** `CASE_HISTORY_OWNERS`.
- **UI copy:**
  - chore labels "Two history entries on one date" and "A line's own history before its fork";
  - the two fix lines (provisional, ★2);
  - "Other entry" / "Other entry N" and its aria-label;
  - the two refusal sentences, plus the dateless-fork sentence (★1).
- **Concepts for `docs/lorebook-time.md`:**
  - the owning line of a history day (rule C);
  - the day-entry paths reuse the day's entry;
  - a person's create or re-date onto a taken day is refused;
  - on a doubled date, the oldest entry is the day's entry.

## Queued for hist-E
- ★4's alternative, if the owner chooses it: a branch session's history date starts after its fork (`messages/writes.ts` `historyDateOfSessionWrite`).

## Scope review (2026-11-10): no rework; follow-ups
1. `entries.unfiledSceneCount.int.test.ts:179-190`: the fixture edit left "gives the main entry no count" passing trivially. Restore a dateless fork for that assertion, and use a separate Year-2 fork for the fork's own entry.
2. `unfiledScenesByEntry.int.test.ts:320-351`: no case now makes main and the fork answer differently. Add one.
3. `historyEntryOfDate.ts:248,255`: the dateless-fork sentence names the immediate parent, not the line that owns the day. Name `historyOwnerStep(line, day)`'s line.
4. This report gained "Names for hist-F" and "Queued for hist-E" (above).
- **Follow-ups 1-3 done** (lead's worker, 2026-11-10):
  - `entries.unfiledSceneCount.int.test.ts` is split into a dateless fork case and a Year-2 fork case.
  - `unfiledScenesByEntry.int.test.ts` has a new case where main and the fork resolve the same day differently.
  - `historyEntryOfDate.ts` now names the owning line (`historyOwnerStep`) in both refusal sentences, with a nested-fork test.
  - Results: 4 files, 37 tests, green; `tsc` clean.
