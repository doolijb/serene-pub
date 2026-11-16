# REPORT perf-E-w6

Status question: none relayed.

## Changed
- `src/lib/server/embedding/vectorizationQueue.ts`
  - `pruneDroppedGroupBuffers()` runs at the start of `pickFromGroup`. It reads `embeddingLane.snapshotGroups()` and deletes every `group:` buffer whose id is not live. Chosen over `removeQueueGroup` or lane-side calls: the queue can already see the live set, so `lane.ts` is untouched. `removeQueueGroup` also calls `removeGroup`, which is not wanted at a drop point that has already dropped the group. The prune covers both drop points (null pick and `replaces`).
  - `nextOfChain`: three drain passes (drain, refill, drain, refill, drain). The loop is still bounded. The third pass returns `null` without scanning again.
  - `_scanBufferKeys()`: test-only export.
- `vectorizationQueue.batchScan.int.test.ts`: added a scan hook (`afterScan`), plus two tests. One checks that a replaced group leaves no buffer. The other is the race: refill rows vanish, new rows appear, and all new rows are picked in one drain.

## Tests
- batchScan test file: 7 passed.
- `src/lib/server/embedding/` and `src/lib/server/indexing/`: 28 files, 208 tests passed.
- `prettier --check` is clean on both changed files. `tsc` shows nothing for these files.

## Noticed, not done
- I did not run the race test against the old code, so I have not seen it fail there.
- The race test deletes the refill's rows instead of embedding them with `promote`. Calling `promote` inside the scan hook silently failed to embed.
- `vectorizationQueue.ts` carries other lanes' uncommitted changes (large diff). I left them alone.
