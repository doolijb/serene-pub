# REPORT: lane `perf-3` (2026-11-17), statements per reply, third pass (programme 0.5)

Two of the five cuts are in. One is rejected, one is blocked because its file isn't owned, and one is profiled and not taken. Every fingerprint is byte-identical to `plans/perf-2-shas-final.txt` after each cut and in the final run. Second-world statements per reply: **the Lair went 2500 → 2277 (−9 %); Story stayed at 1036** (its first world went 1585 → 1474).

## Cuts

1. **The `session_settings` query uses the run's host** (`host.ts:2280`, a one-line change: `{ host }`). It saves one cast read (~51 statements) and one narrator build (~53) in the round-tick run's round-worth read. What could invalidate it: the same rules as perf-2 cut 2 (the memo is cleared around `host.call`/`host.commit`, and the `castWrite` epoch); the memos themselves are untouched. Test: `pipelines/runtime/host.sessionSettingsQuery.int.test.ts` checks the document is the same, that one host serves both reads, that a same-run bench commit is seen, and that nothing is cached across hosts.
3. **The rewind check shares its reads** (`sessions/rewind.ts`). A per-call read set feeds both verdicts. It covers replay, step, settle, settled line, `replyRunOf`, `isCreateRun`, `loadPublished`, `creatingRunOf`, `turnYieldOf` and cards. The naming is built once per `rewindStateOf`, because `turnYieldOf` gained an optional `opts.namingOf` in `turnYield.ts`. Statements in `rewindStateOf` went 204 → 89 per Lair reply. What could invalidate it: nothing is written inside the call and nothing outlives it. The shared reads are frozen for one call; a write landing between the two checks may be seen by one read and not another, as with any unlocked read; the push that write triggers re-runs the check. Proof: a scratch capture of 12 worlds (Story and the Lair, owner and guest: `rewindStateOf`, both verdicts, and the pushed `rewind`) was byte-identical. It was taken before the worker's last type-only refactor; the tests and both baselines were re-run after that refactor. Test: `sessions/rewind.sharedReads.int.test.ts`.

| | Story a (1st/2nd) · c · d · e | Lair a (1st/2nd) · c · d · e |
|---|---|---|
| start | 1585/1036 · 1567 · 1457 · 1287 | 2504/2500 · 2503 · 1925 · 2513 |
| cut 1 | 1474/1036 · 1456 · 1346 · 1287 | 2395/2391 · 2394 · 1925 · 2404 |
| cut 3 | = | 2281/2277 · 2280 · 1844 · 2290 |

## Not taken

- **Cut 2, rejected.** `sessionSpeechSettings` runs from `onMessageSettled`. That is emitted by `settledLines.ts` after the run's receipt has closed, and the listener is deferred, so no run host exists at that point. It costs about 116 statements per reply in both worlds.
- **Cut 4, blocked: the file isn't owned.** `buildSessionActions` lives in `sockets/sessions.pipelines.ts`. Proposed change: `pushNow` reads the genre row and `listSessionFunctions` once, then passes `offered` through a new `buildSessionActions` option; `listSessionActions` and `formCollectsOf` only filter it. The saving is about 101 statements per extra member, and 0 in the baselines because only one member is watching.
- **Cut 5.** `turnDeleteRefusedThrough` runs only 12 statements of its own. Its real cost is `sessionKeepsEveryTurn` building a whole settings document on a host of its own: about 104 per member per push, about 208 per Lair reply. The `reading` reads (Story 112, the Lair 230) are spread across the cast reads, `storyTime` and the lore reads, all outside this lane's files. perf-1's reason for rejecting them still holds.

## Tests

- Both baselines after each cut: `plans/perf-3-c{0,1,3}.log`, shas in `plans/perf-3-shas-*.txt`.
- Grouped run `plans/perf-3-final.log`: perf-2's 16 files plus the two new ones, 146/146 passed.
- `tsc`: 0 errors.

## What remains

- ★ `sessionSpeechSettings` and `sessionKeepsEveryTurn` only need `fields`. A fields-only read in `settings.ts` (a new export there) would save about 116 per reply in both worlds, plus about 104 per member per push.
- `rewindStateOf` doesn't depend on the user, so it could run once per push instead of once per member. That change is in `sessions.pipelines.ts` too.
- The in-run cast reads at `bindings.ts:786` and `bindings.retrieval.ts:518` still miss the cast memo.

## Noticed, not done

- Other agents changed `settingsForm.ts`, `routines/log.ts`, `EditSessionForm.svelte` and `revisionDefault.int.test.ts` around 10:09. That wasn't this lane.
- Both new test files fail `prettier --check`: line wrapping copied from their model files. `--write` was not run.
- The Lair's c and d counts drift by about ±3 between runs.

## Scope review (2026-11-17)

No objection to the code. Four findings on tests and wording: the before/after equality was not pinned (the test compared the new code with itself); the invalidation sentence above was wrong (reworded); a test header said "its own host"; internal names not in NOMENCLATURE §25. Fix task `perf-3-fix`.
