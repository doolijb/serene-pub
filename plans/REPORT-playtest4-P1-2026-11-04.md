# REPORT playtest4-P1 — the scene lists' two performance notes (2026-11-04)

Status: built; all Done-means tests pass. No status question was relayed.

## Changed files (app repo only; no SDK changes)
- `src/lib/server/scenes/historyEntryOfDate.ts`: 🚧 new exported pure **`pickEntryOfDate(rows, line, date)`** returns `{ historyEntryId, date } | null`. It holds the date-match loop moved verbatim (it applies `dayOnly`, uses `rowReadsOnLine`, the newest date wins, a tie goes to the higher position). `historyEntryOfDate` calls it, so the rule lives in one place. The `create: true` path is unchanged and stays only here; it computes `target = dayOnly(at.date)` for the creation date only. One header bullet names the picker.
- `src/lib/server/scenes/unfiledScenesByEntry.ts`:
  - It returns early with no reads when there are no groups.
  - It reads the book's history rows **once per call**, with a local select of the same shape as `historyEntryOfDate`'s. I added no exported reader, because that would be a new name.
  - It calls `lineOfBook` **once per distinct scene `branchId`**, memoised in a Map local to the call. A `BranchRefusal` is memoised as null and skips every group on that branch; any other error rethrows.
  - Each (branch, day) group is resolved on **its own scene's line** through `pickEntryOfDate`; `at.line` is still only the scene filter. The merge is unchanged, and the charter bullets are updated.
- `src/lib/server/scenes/liveScenes.ts`, only `sceneDisplayNames` and `sceneCauses`:
  - **`sceneDisplayNames`**:
    - `numbered` is now a `Set`, keeping the same object-identity test as before.
    - Lane start lines are grouped per session and channel in a nested `Map<sessionId, Map<channel|null, number[]>>`, with no string-key collision between `null` and `"null"`, and each lane is sorted ascending.
    - A scene's position is 1 plus a lower-bound binary search, i.e. the count of starts STRICTLY earlier, so tied starts share a number.
    - The old `o.id === s.id` skip is reproduced by subtracting 1 when the scene's own stored row is on the same lane and starts before `at`. That only happens when the passed-in scene differs from its stored row.
  - **`sceneCauses`**: `Promise.all` over `sessionIds` replaces the sequential `sessionSceneContext` loop, with no concurrency knob. The doc comment now says "(read in parallel)".
- Tests:
  - `scenes/unfiledScenesByEntry.int.test.ts` (+2):
    - **Equivalence**: 9 scenes in 8 (branch, day) groups, covering two entries on one day, a day with no entry, a year-only entry, undated scenes and a fork-only entry. Read on main and on the fork, the result equals a per-group `historyEntryOfDate(create: false)` expectation, and no history row is created.
    - **Fork-only entry, main-line scene, read from the fork**: the fork has an entry on the same day at a higher position. Read from the fork, the main-line scene still files under main's `day1`, and the fork's own scene files under the fork entry.
  - `scenes/historyEntryOfDate.int.test.ts` (+1): pure `pickEntryOfDate` cases (exact day, a tie goes to the higher position, no match gives null, no date gives the newest, a sibling line's row is skipped). The worker also ran `prettier --write` on this file, which reflowed some existing lines with no logic change.
  - `sockets/scenes.displayNames.int.test.ts` (+1): 205 scenes, bulk-inserted. 200 are on `main` with scrambled ids, a tie of opening lines, a selection scene whose smallest selected line equals another scene's opening, custom names and ` · Place` suffixes; 5 are on `whisper`, two of them tied. The result is asserted equal to the old quadratic rule computed in the test, the tie shares a number, and the custom name stays.
  - `scenes/sceneCauses.int.test.ts` (+1): two sessions in one call, a refreshing genre and a plain genre with a judged cue; each gets its own causes. The existing three-session case only asserted that causes were absent.
- Worker briefs: `plans/briefs/BRIEF-playtest4-P1-w1.md`, `plans/briefs/BRIEF-playtest4-P1-w2.md`.

## Tests run
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <files> > …/playtest4-P1-<n>.log 2>&1; echo exit=$?'`
- Batch 2: `unfiledScenesByEntry.int`, `historyEntryOfDate.int`, `scenes.displayNames.int`, `sceneCauses.int`, `sceneStartOf.test`: **5 files, 31 tests passed**, exit 0.
- Batch 3: `scenes.compileLine.int`, `entries.unfiledSceneCount.int`, `lorebooks.unfiledScenesExport.int`: **3 files, 39 tests passed**, exit 0.
- First attempt: all 8 files at once with the default worker count. The capped scope printed `Terminated` before any test finished, most likely memory with 8 PGlite files in parallel. It passed when rerun in two batches with `--maxWorkers=2`. That killed run may have left `/tmp/serene-pub-*-int-test-*` dirs I can't identify by name, so I deleted none.
- `npx prettier --check`: `historyEntryOfDate.ts` and `unfiledScenesByEntry.ts` are clean. `liveScenes.ts` and the displayNames/sceneCauses tests were already not prettier-clean; the new hunks follow the surrounding style.

## Decisions (implementation, inside scope)
- The history-rows read in `unfiledScenesByEntry` is a local query, not a shared exported reader, to avoid a new name.
- `pickEntryOfDate` returns `{ historyEntryId, date }`, matching the found-branch fields of `HistoryEntryOfDate`.
- I kept the self-exclusion in `sceneDisplayNames` exact, even for a passed-in scene that differs from its stored row, so output is identical in every case and not only the common one.

## Stopped, needs owner
None. No unruled ★. The picker reproduces the read path, and creation stays in `historyEntryOfDate` with no duplication.

## Canon rows needed (NOMENCLATURE §9 history entry, §25 ledger; the lead owns the file)
- **2026-11-04 (playtest4, lane P1 — the scene lists' perf notes).** §9 history entry: 🚧 **`pickEntryOfDate(rows, line, date)`** (`scenes/historyEntryOfDate.ts`) is the pure date-match over already-read history rows, and the one place that rule lives. `historyEntryOfDate` calls it; `unfiledScenesByEntry` reads the book's history rows once per call, resolves `lineOfBook` once per distinct scene line, and files each (line, day) group through it. No behaviour change.

## Queued for other lanes
None.

## Noticed, not done
- With the default worker count, the 8 Done-means int files together exceed the 6 GB capped scope. The lead's grouped run may want `--maxWorkers=2` for these.
- `sceneCauses` still runs `placed.filter` per live scene, which is quadratic in the number of cues. It is small in practice and not in the brief.
