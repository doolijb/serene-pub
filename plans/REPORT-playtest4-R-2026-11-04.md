# REPORT playtest4-R — the build-4 review's fixes (2026-11-04)

(Saved by the lead from the supervisor's hand-back; the harness refused the lane's own write.)

**All 8 items built**; every Done-means test passes. No migration, setting, event or new sentence; the only new name is `byDate.requestId` (named by the brief). Workers w1 (client, `plans/briefs/BRIEF-playtest4-R-w1.md`), w2 (server, `-w2.md`); every diff checked against a pre-start snapshot.

## Changed files (app repo only; no SDK changes)
1. **`requestId` echoed on the compile activity** — `utils/activityStore.ts`: `CompileHistoryEntryActivity.byDate?: { date: StoryDate | null; requestId?: string }` (+ `startCompile` params); `sockets/scenes.ts` `sceneCompileHandler`: `byDate = { date, ...(askedRequestId !== undefined && { requestId: askedRequestId }) }`; `src/app.d.ts` `CompileEntryState.byDate.requestId?`; `modals/compileEntryState.ts` unchanged (spreads `a.byDate` whole).
2. **`CompileHistoryEntryModal.svelte`** — adoption before the entry is known requires `askedRequestId !== null && a.byDate?.requestId === askedRequestId` (every existing condition kept; an activity with no `requestId` is never adopted); `handleError` accepts a refusal carrying this window's own `requestId` even when it names an entry `entryOf` lacks (F1, the endless spinner).
3. **`requests/compileHistoryEntry.ts`** — `compileByDate` built on `awaitReply` (`event: "scenes:compile"`, `replyKey: "activity:update"`, `errorEvent: "scenes:compile:error"`, `match` = running `compile_history_entry` frame with this ask's `byDate.requestId`, `matchError` by `requestId`, `fallbackError` the existing sentence, `timeoutMs` only when given — the 15000 literal is gone). Dead `sameDay`/day-line-moment comparison and imports removed.
4. **`scenes/liveScenes.ts` `openScene`** — inside the write transaction after the two locks: `lineOfBook(tx, lorebookId, branchId)`; `BranchRefusal` → `SceneBoundaryRefusal("This session's line is not one of this lorebook's.")` (HEAD's sentence, byte-identical). Import `BranchRefusal, lineOfBook` from `$lib/server/state/reading`.
5. **One scene-day rule** — `unfiledScenesByEntry.ts`: `export` on `sceneDay`; the by-date `waiting` filter in `scenes.ts` uses it.
6. **`scenes:update` blank-name rebuild** — from `after = selectedMessageIds !== undefined ? { ...existing, selectedMessageIds } : existing` (feeds `sceneStartOf`, `sceneClockOf`, `sceneNameFor`).
7. **`compileReplyTo`** — stores `{ io: socket.io, userId }`; at Apply (`if (to?.io)`) a local `emitToOwner` sends through `emitToUserRedacted(io, userId, …)` as `afterBoundaryPlaced` does, and a stand-in socket `{ io, user: { id: userId } }` (that function's shape) goes to `sceneListByLorebookHandler.handler` and `relistEntries`. No new abstraction. Both compile paths refuse anyone but the book's owner, so `assertReadableBook` passes for the stand-in.
8. **`Promise.all`** — `buildSceneList` (causes, lore sources, display names); `sceneListByLorebookHandler` and `sceneOpenScenesHandler` (display names, causes).

## Tests
- `activityStore.compileDedup.test.ts` +1 (`requestId` carried when given, absent when not).
- `scenes.compileLine.int.test.ts` +1 (string `requestId` lands on `byDate`; none or non-string `12` leaves it off; entry ask has no `byDate`); the Apply re-send test rewritten to spy `emitToUserRedacted` and assert the owner's id received `scenes:listByLorebook` and `entries:list` (no `unfiledSceneCount`), the press's own `emitToUser` neither.
- `scenes.displayNames.int.test.ts` +1 (selection-captured A saved with `name: ""` and a selection moved before B's → stored name is the new start's, "Scene 1").
- `scenes.live.int.test.ts` +1 (a session whose `lorebookBranchId` is another book's branch is refused on `scenes:open` with the exact sentence; no scene row written).
- `CompileHistoryEntryModal.dom.test.svelte.ts`: `ownAsk()` fixture; +2 (adopted only with its own `requestId`; a refusal with its own `requestId` naming an entry `entryOf` lacks shows the sentence); existing adoption tests pass `byDate: ownAsk(...)`.
- `requests/compileHistoryEntry.test.ts` reworked onto the `requestId` match (resolves on own id; not on another/none even same day and line; not on non-running/entry/other-kind frames); kept refusal, fallback, other-id, timeout, release-on-exit; removed the day/line/moment discrimination tests.

Acceptance runs (capped, `--maxWorkers=2`): 7 files / 98 tests passed (`CompileHistoryEntryModal.dom`, `compileHistoryEntry.test`, `requests/index.test`, `awaitReply.test`, `compileDedup`, `scenes.compileLine.int`, `scenes.displayNames.int`); 3 files / 30 tests passed (`scenes.live.int`, `sceneCauses.int`, `unfiledScenesByEntry.int`). Prettier clean on the lane's clean files; `activityStore.ts`, `scenes.ts`, `liveScenes.ts` and the int tests were not prettier-clean before and were not reformatted. No `tsc`/`svelte-check` run (the lead's).

## Decisions
- Name-rebuild test lives in `scenes.displayNames.int.test.ts` (no `scenes.update*.int` holds name cases); the openScene refusal in `scenes.live.int.test.ts`.
- Spy, not `vi.mock`, for `emitToUserRedacted`: under a file-level mock the second of two near-simultaneous dynamic imports of `broadcastHelpers` got the real module.
- `compileByDate` matches on its own `requestId` alone (no lorebook/line/moment/day compare). Consequence (F10, intended): a press for a day already compiling from another tab now rejects in place with the server's *already in progress* sentence instead of resolving silently.
- The modal tests' shared `activity()` fixture stays bare; tests needing adoption pass `ownAsk()`.

## Stopped, needs owner — none. ★R-1/★R-2/★R-3 untouched.

## Noticed, not done
- Item 6 builds the name from the patch's raw `selectedMessageIds`, before `capturableMessageIds` filters them inside the transaction; if the filter drops the lowest id the name follows a start the saved row lacks (rare; the fix moves the rebuild into the transaction).
- A `vi.mock` of `broadcastHelpers` can leak the real module to a second concurrent dynamic import; prefer `vi.spyOn` around Apply/`afterBoundaryPlaced`.
- `sceneListByLorebookHandler` doesn't await its `emitToUser`, so Apply's two sends overlap (harmless).
- The `emitToOwner` closure now exists in both `afterBoundaryPlaced` and the Apply callback (kept local as briefed); the closure's `if (!io) return` repeats the outer guard.
- 34 `/tmp/serene-pub-vitest-*` dirs exist; none deleted (unattributable).
- An M2e isolated dev server runs (`vite dev --port 5241`): no `sdk:build` while it is up.
