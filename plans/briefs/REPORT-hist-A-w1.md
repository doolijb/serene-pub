# REPORT hist-A-w1

Status line: done; all brief goals built, tests pass, tsc clean for my files.

## Changed files
- src/lib/shared/lorebooks/lineReading.ts: `historyOwnerStep(line, date)` (after `stepOf`).
- src/lib/shared/lorebooks/lineReading.cases.ts: `CASE_HISTORY_OWNERS` (18 rows, line and owner by name).
- src/lib/shared/lorebooks/lineReading.test.ts: `describe("historyOwnerStep — rule C …")` runs the table + the partial-fork-date test.
- src/lib/server/state/reading.ts: `historyEntryOver` next to `historyEntryDate`; used in `writeDatingAt` (rows are read id-ascending, so result unchanged). Nothing else touched.
- src/lib/server/scenes/historyEntryOfDate.ts: `pickEntryOfDate` uses `historyEntryOver`, no `position` in its row type; create inserts on `historyOwnerStep(line, date).branchId`; header bullets updated; new `assertHistoryDateFree` (exact copy for sentences (a) and (b); dateless sentence marked 🚧).
- src/lib/server/scenes/historyEntryOfDate.int.test.ts: tests below.
- src/lib/server/scenes/unfiledScenesByEntry.int.test.ts: one expectation + title (see below).

## Tests run (one grouped run, capped scope)
lineReading.test.ts, historyEntryOfDate.int.test.ts, unfiledScenesByEntry.int.test.ts, lineSql.int.test.ts, client/lorebooks/lineConformance.test.ts: 5 files passed, 144/144 tests passed (vitest prints only the total). tsc --noEmit: no errors in lineReading / reading.ts / historyEntryOfDate / unfiledScenesByEntry.

## Old expectations changed
- historyEntryOfDate.int.test.ts: "answers the entry dated that day ...; of two, the higher position" -> lower id; "pickEntryOfDate: ... ties to the higher position" -> lowest id (expected ids 2 -> 1 in two assertions; rows lost `position`).
- unfiledScenesByEntry.int.test.ts "a main-line scene is resolved on main even when read from a fork that has a higher-positioned entry that day": it pinned the old highest-position tie on a doubled date (main's day1 and a fork's own row on the same date). Now lowest id wins, so both scenes file under main's day1 and the fork's row gets none. Expectation changed to `[shared, forked]` / `[]`; title reworded to match.

## New tests
Tie-break (historyEntryOver pure; finder and writeDatingAt agree on the lower id); fork compile (all five points, both dates); assertHistoryDateFree (taken date exact text `Year 5, Mo. 1, Day 2` verified, exceptId, partial dates distinct, undated ignored, null date, BranchRefusal for foreign branch, North at/before fork exact (b), after fork passes, North own row refused, South reuses date, main passes with North's post-fork and with North's rule-C-breaking row, dateless fork sentence).

## Assumptions
- The first-sentence-(a) check also tested with a date carrying an hour (dayOnly drops it).
- `nameOf` falls back to "main" for an unknown parent id.
- The `rowReadsOnLine` call in (a) uses no moment (head), per brief.

## Noticed, not done
- sockets/scenes.ts ~:1274 comment about "creates on that line's own branch" is now stale (create lands on the owning line, possibly an ancestor).
- `writeDatingAt`'s doc "Two entries on one date: the lower id." still true; left as is.
- Scratch files in the session scratchpad named hist-A-w1-edit.py / hist-A-w1-tail.txt (not in repo).
