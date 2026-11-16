# REPORT — lane `time-t6c1` (2026-11-15): the firsthand filter reaches History entries (opt-in; no shipped pipeline invokes it)

Saved by the lead from the supervisor's report.

## Inventory (file:line)

- `core:query/history-entries@1`, `contracts/src/queries.ts` ~1177: ranked lore (out-ports `main`, `hits`,
  `exclusions`); binding `runtime/bindings.ts` ~2843 → `loreFor("history", …)` ~1044; History rows are
  `source: "history"` (`host.ts` ~5598–5617).
- Other ways in: entity search (every enabled entry); vector search (`source: "historyEntry"`,
  `embedding/ragContext.ts` ~570, ~634). All concatenated in story `respond.ts` ~858–882, then `eligibility`
  (~1004–1012), which aliases `historyEntry` to `history` (`ranking/eligibility.ts` ~78–84): the vector pool is
  covered by `exclusions`. Every shipped spec reading this lane wires its `exclusions` into eligibility (story
  `respond.ts` ~1009; lair `reply.ts` ~473, ~1207, `roomAnswer.ts` ~262, `fileRoom.ts` ~230).
- `scenes.history_entry_id` (`schema.ts` ~4855, ~4992); `loadFirsthandView` already reads every scene of the
  session (no extra query). `earlierScenesOf` untouched.

## The rule as built

With `firsthandFor` wired, an entry is left out for the member when at least one scene of this session compiled
into it fails the summary rule. Other sessions' scenes, a deleted session's scenes and hand-written text are not
judged. Left-out entries are appended to the lane's `exclusions` as `{source:"history", id, reason}`; `main`,
`hits`, `skipped` unchanged; eligibility blocks every copy and the ranker records `excluded_ineligible`. A
narrator turn reads everything. Unwired: byte-identical. The replacement by scene summaries is not built.

## Names and sentences (all 🚧)

In-ports `firsthandFor` / `firsthandBy` on `history-entries@1`. Module: `scenesOfEntry`,
`FirsthandSceneRow.historyEntryId`, `leftOutEntryIds`, `historyReceipt`, `historyExclusionReason`,
`judgeHistoryEntries`; `HISTORY_LANE_READS` in `bindings.ts`. Receipts: *No history entries left out for ‹name›*
· *1 history entry left out: ‹name› was not there for all of its scenes* · *‹n› history entries left out: ‹name›
was not there for all of their scenes*. Reason: *‹name› was not there for all of this history entry's scenes.*
`validate()` law `firsthand 2026-11-15` covers three reads.

## Statements added

Not invoked 0; invoked, no stat: the loader's 13 (the History judgement adds none); with a stat and three
members 67.

## Changed files

SDK: `contracts/src/queries.ts`, `sdk/src/validate.ts`, `sdk-tests/firsthand.test.ts`,
`sdk-tests/nodeInput.test.ts`, `guides/genres-presets-and-routines.md`. App:
`src/lib/server/sessions/firsthandFilter.ts` (+ tests), `pipelines/runtime/bindings.ts` (~1005–1015,
~2843–2905), `bindings.firsthand.int.test.ts`, `pipelines/boot/registryHashes.test.ts` (history-entries →
`dd12a4e6fec4c`, was `1403d2cf364be7`), `pipelines/boot/declaredReads.test.ts`, `docs/pipelines.md`,
`docs/lorebook-time.md`, `NOMENCLATURE.md`.

## Verification (lane's)

`sdk:build` 16:19. `sdk:test` 4746/4751 (the known four). App: 8 files, 107 pass, 2 fail (the
`paramsSlotWiring` baseline). `tsc` 0; `npm run check` 0 errors.

## Open ★

- ★T6C1-1 names and sentences.
- ★T6C1-2 replacing a left-out entry with the summaries of the scenes the character was there for: not built.
- ★T6C1-3 a compiled scene with no live lines counts as attended (alternative: the scene's stored cast).
- ★T6C1-4 left-out entries stay in `main` and are blocked by eligibility; a custom spec that wires
  `firsthandFor` but not the lane's `exclusions` does not leave them out (the guide says to wire it; no
  `validate()` warning).

## Queued / noticed

INTEGRATING.md line for `firsthandFor` / `firsthandBy` (three nodes). `docs/sessions.md` ~544 does not mention
History entries. `lorebook-triggers@1` reads History entries with no firsthand ports. Relationship edges dated
through `history_entry_id` are not judged.

## Scope review and lead fixes (2026-11-15)

In scope; the rule matches the brief; every route a History entry takes into Story's reply passes eligibility
(keyword, entity and vector search; pinned entries; the `history` variable renders ranked allocations only;
"Earlier in the story" never carries History text). Findings:

1. ★T6C1-4 stands, for the owner: a spec that wires `firsthandFor` on `history-entries@1` but not the lane's
   `exclusions` filters nothing while the node's notes still count entries as left out. Proposed: a `validate()`
   warning under the same law. Not built (outside the brief).
2. Fixed: `docs/pipelines.md` no longer claims the entry stays out unconditionally; its limits and the guide's
   now state the unconnected-`exclusions` case, that `lorebook-triggers@1` (story narrate, look; lair castellan)
   is not filtered, and that recursion can still pull in entries a left-out day names.
3. Fixed: NOMENCLATURE §25 records the new `validate()` strings and `HISTORY_LANE_READS`.
4. Left: the "not invoked" binding test proves determinism rather than equality with an unfiltered read (the
   code path returns the lane untouched).

## Grouped verification (lead, 2026-11-15)

- Full vitest run 7 (`plans/lead-full7.log`): 2,503 files, 21 failed, 26 tests failed; the same 21 files as run 6, none new.
- `npm run build`: exit 0. `tsc --noEmit`: 0 errors. `npm run check`: 0 errors, 9 warnings (standing).
