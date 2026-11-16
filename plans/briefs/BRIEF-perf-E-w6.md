# BRIEF — perf-E-w6 — vectorisation scan buffers: prune dropped groups, drain a third time before giving up

You are a `lane-worker`; the lead is acting supervisor for this follow-up to lane `perf-E`. Repository root
`/home/jody/github/serene-pub`. Read first: `plans/briefs/BRIEF-perf-E-w1.md` (the original step-1 brief),
`plans/REPORT-perf-E-2026-11-13.md` (step 1 and the lead's acceptance note, finding 1), and the current
`src/lib/server/embedding/vectorizationQueue.ts` (`scanBuffers`, `nextOfChain`, `pickNextItem` / `pickGlobalNextItem`,
`removeQueueGroup`, `stopVectorization`) plus `src/lib/server/indexing/lane.ts` ~540–546 (`replaces` drops a group)
and ~760–775 (`pickNext` shifts a group off when a pick returns null). Other uncommitted files belong to other lanes;
never touch them; never `git stash` / `git checkout`.

## The two defects (scope review, 2026-11-13)

1. A `group:<uuid>` buffer is cleared only by `stopVectorization()` and `removeQueueGroup()`. A group dropped by
   `pickNext` (null pick) or by `enqueueGroup`'s `replaces` leaves its buffer (≤ 50 entries plus fetched vectors)
   until stop. Group ids are random, so it is never read again.
2. `nextOfChain` caps refills at 2 per call. In a race where a fresh refill's rows all re-read as already embedded
   while a second refill finds new rows, the call returns `null`: a group is logged completed, or a run ends, with
   rows unembedded (the next periodic scan or `start()` recovers; nothing marks them done).

## Do

- In the pick path, before using a buffer, delete every `group:` key whose group id is not among the lane's live
  groups (find how the queue learns the live set — the lane passes the group when it picks; if the queue cannot see
  the lane's list, prune on the lane side at the two drop points, `lane.ts` ~545 and ~770, by calling
  `removeQueueGroup` or a new small `dropScanBuffer(groupId)` export — prefer the existing `removeQueueGroup` if
  its other effects are safe there; say which you chose and why).
- In `nextOfChain`, after the second refill, drain that buffer fully (re-read heads as today) before returning
  `null`; i.e. a third pass over the second buffer. Keep the loop guard (no unbounded loop).
- Tests in `vectorizationQueue.batchScan.int.test.ts` (extend): (a) a group dropped via `replaces` or a null pick
  leaves no buffer (inspect the exported test hook or add a `_scanBufferKeys()` test-only export); (b) the race:
  rows embedded by `promote` between scan and pick, plus new rows, are all picked in one run (no early null).

## Done means

`npx vitest run src/lib/server/embedding/vectorizationQueue.batchScan.int.test.ts src/lib/server/embedding/
src/lib/server/indexing/ --testTimeout=60000` green (never piped into `head`); `npx prettier --check` on changed
files; `npx tsc --noEmit -p .` filtered to your files clean. Report to `plans/REPORT-perf-E-w6.md`: what you changed,
tests, Noticed-not-done.

## Rules (verbatim)

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form; use `npx prettier --check <file>`. Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name.
- Never pipe vitest into `head`. Inside `db.transaction(async (tx) => …)` use only `tx`. No new setting, event or user-facing name.
