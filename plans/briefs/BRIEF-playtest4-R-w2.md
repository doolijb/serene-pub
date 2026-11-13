# BRIEF playtest4-R-w2 — server-side fixes (compile requestId on the activity, openScene line check, one scene-day rule, name rebuild, compile reply by user, parallel reads)

Lane `playtest4-R`, worker 2 of 2. Working dir `/home/jody/github/serene-pub`. You are a `lane-worker`. Report back in your final message (no report file). Worker w1 edits client files at the same time — never touch them. Another programme (M2e) has agents in this repo: touch only the files and spots named here, and re-read each file immediately before each edit (use Edit, never Write on an existing file).

*"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*

## Goal — seven items. No behaviour change except where stated; no new name, sentence, event or setting.

**1. The by-date ask's `requestId` on the activity (memory only).**
- `src/lib/server/utils/activityStore.ts`: `CompileHistoryEntryActivity.byDate?: { date: StoryDate | null; requestId?: string }` (~236) and `startCompile`'s `params.byDate?` (~543) the same. Keep the 🚧 doc comment; add one clause that the ask's `requestId` is echoed so a window or the Chronicle's request takes only its own ask's run.
- `src/lib/server/sockets/scenes.ts` `sceneCompileHandler` (~1315): `byDate = { date, ...(askedRequestId !== undefined && { requestId: askedRequestId }) }`. Fix the local `byDate` variable's type to match.
- Tests: `activityStore.compileDedup.test.ts` — `byDate.requestId` carried when given, absent when not. `scenes.compileLine.int.test.ts` — the existing activity-`byDate` tests (dated/null/absent, ~S8's +3): a by-date ask with a string `requestId` puts it on the activity; one with none (or a non-string) leaves `byDate` without `requestId`; an entry ask has no `byDate`.

**4. `src/lib/server/scenes/liveScenes.ts` `openScene` (~1079) only.** The line check the removed `fileSceneUnder` made is gone. Re-add it inside the write transaction (`db.transaction(async (tx) => …)`, after the two locks), exactly as HEAD's `fileSceneUnder` did (`git show HEAD:src/lib/server/scenes/liveScenes.ts | sed -n 478,500p`):
```ts
try {
	await lineOfBook(tx, lorebookId, branchId)
} catch (e) {
	if (e instanceof BranchRefusal)
		throw new SceneBoundaryRefusal(
			"This session's line is not one of this lorebook's.",
			{ cause: e }
		)
	throw e
}
```
Import `lineOfBook` and `BranchRefusal` from `$lib/server/state/reading` (they are not imported now). The sentence is byte-identical to HEAD's. Int test in `src/lib/server/sockets/scenes.live.int.test.ts` (the `scenes:open / scenes:close / scenes:moveBoundary` describe): a session whose `lorebookId` is book A and whose `lorebookBranchId` is a branch of book B is refused on `scenes:open` (or `openScene` directly) with exactly that sentence, and no scene row is written. 60 s timeout on the `it`.

**5. One scene-day rule.** `src/lib/server/scenes/unfiledScenesByEntry.ts`: add `export` to `function sceneDay` (~32) — that keyword only. In `scenes.ts` the by-date `waiting` filter (~1257–1271) replace the inline rule with `sceneDay`: `.filter((s) => { const d = sceneDay(s); return d === null || day === null ? d === day : compareDates(d, day) === 0 })` (same results: no year → only Undated; Undated ask → only no-year scenes). Import `sceneDay` beside the existing `unfiledScenesByEntry` import (~60). Remove an import only if it becomes unused. No new test; the existing compileLine tests pin it.

**6. `scenes:update` blank-name rebuild (`scenes.ts` ~651–690).** Today the automatic name is rebuilt from `existing` (the PRE-update row): when the same save changes `selectedMessageIds`, the scene's start (`sceneStartOf`) — so its number — comes from the old selection. Rebuild from the scene as it will be after the save: inside the `name === null || !name.trim()` branch, build `const after = selectedMessageIds !== undefined ? { ...existing, selectedMessageIds } : existing` and use `after` for `sceneStartOf(after)` and `sceneClockOf(after, "opened")` (and `after.sessionId`, `after.channel`, `after.lorebookId` — identical to `existing`'s). Nothing else in the handler moves. Int test in `src/lib/server/sockets/scenes.displayNames.int.test.ts` (the `scenes:update — the rename rule` describe holds the name-rebuild cases): two selection-captured scenes on one lane (A selected at later lines, B at earlier lines, so B is *Scene 1*, A *Scene 2*); save A with `name: ""` and `selectedMessageIds` moved to start before B's → A's stored name is the automatic name of the new start (number 1 — assert against `sceneNameFor` / the exact expected string as the existing cases do). 60 s timeout.

**7. `compileReplyTo` holds the pressing socket (`scenes.ts` ~1066–1076, ~1466–1468, ~2184–2204).** Store `{ io: socket.io, userId }` instead of `{ socket, emitToUser }` (update the map's type and its doc comment in a clause: it re-sends to the user, so a tab that closed meanwhile loses nothing). At Apply, send to the USER through the same user-scoped emitter `afterBoundaryPlaced` uses (~2618–2633): a local `emitToOwner = async (event, data) => { if (!io) return; const { emitToUserRedacted } = await import("$lib/server/sockets/utils/broadcastHelpers"); await emitToUserRedacted(io as any, userId, event, data) }`, and a stand-in socket `{ io, user: { id: userId } }` (exactly the shape `afterBoundaryPlaced` passes to `relistEntries`). Then `await sceneListByLorebookHandler.handler(asOwner, { lorebookId: activity.lorebookId }, emitToOwner)` (the same builder the list handler is; it reads `socket.user.id` and `socket.user.isAdmin` — a compile is the book owner's on both paths: scenes.ts ~1215 and ~1335 refuse anyone else, so no admin flag is needed) and `await relistEntries(asOwner, activity.lorebookId, HISTORY_TYPE_ID, emitToOwner)`. The `compileReplyTo.delete` lines stay. No new exported helper, no new module: a local closure only. If you find this cannot be done without a new abstraction, stop, leave item 7 unchanged, and say why.
Test: the existing `Apply re-sends the scenes of the book and the history list without the unfiled count` test in `scenes.compileLine.int.test.ts` (~777) captures `emitToUser`; it must now observe the emits reaching the owner through `emitToUserRedacted`. Give that test a socket with an `io` (e.g. `{ user: { id }, io: fakeIo }`) and observe `emitToUserRedacted` calls with the owner's id (a `vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => ({ ...(await importOriginal()), emitToUserRedacted: vi.fn(...) }))` recording `(userId, event, data)` is fine — make sure it does not break the file's other tests). Keep its assertions (the book's scene list; the entries list row has no `unfiledSceneCount`), plus that the press's own `emitToUser` is NOT what carried them. The `a dismissed compile leaves nothing in compileReplyTo` test must still pass.

**8. Parallel independent reads (`scenes.ts`).** Same outputs, `Promise.all`:
- `buildSceneList` (~247–254): `sceneCauses(db, scenes)`, `sceneLoreSourcesOf(db, ids)`, `sceneDisplayNames(db, scenes)` → `const [causes, sources, shownNames] = await Promise.all([...])`.
- `sceneListByLorebookHandler` (~1009–1010): `sceneDisplayNames`, `sceneCauses`.
- `sceneOpenScenesHandler` (~2831–2832): `sceneDisplayNames`, `sceneCauses`.
These run on `db`, never inside a transaction. Nothing else changes.

## Files owned (only these, only the spots named)
- `src/lib/server/utils/activityStore.ts` + `src/lib/server/utils/activityStore.compileDedup.test.ts`
- `src/lib/server/sockets/scenes.ts` (the spots above only) + `scenes.compileLine.int.test.ts`, `scenes.displayNames.int.test.ts` (the rename-rule describe), `scenes.live.int.test.ts` (the one new refusal test)
- `src/lib/server/scenes/liveScenes.ts` (`openScene` and the import line only)
- `src/lib/server/scenes/unfiledScenesByEntry.ts` (the `export` keyword on `sceneDay` only)

## Files readable
`src/lib/server/state/reading.ts` (`lineOfBook`, `BranchRefusal`), `src/lib/server/sockets/entries.ts` (`relistEntries`), `src/lib/server/sockets/utils/bookReaders.ts`, `src/lib/server/sockets/utils/broadcastHelpers.ts`, `src/lib/server/scenes/historyEntryOfDate.ts`, `scenes.afterBoundaryPlaced.int.test.ts` (mock pattern), `src/lib/shared/sockets/types.ts`.

## Out of scope — never built
Any client file; `historyEntryOfDate.ts`; `NOMENCLATURE.md`; docs; the SDK; gating `relistEntries` on interest; the empty-entry-on-failed-run question; any setting; any new event, sentence or exported name. Findings go under Noticed, not done.

## Stop and ask (in your report) when
Item 7 needs a new abstraction (then skip it and say why); a sentence or name beyond those above seems needed; a change outside the owned spots seems needed.

## Rules your work depends on (CLAUDE.md, verbatim)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod." (Item 4's `lineOfBook` takes `tx`.)
- "Never seed a row at a hardcoded id." (tests: let ids be generated.)
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." (`scenes:listByLorebook` carries `lorebookId` — keep it.)
- "A change to stored data or ids ships with a forward migration…" — nothing here is stored: `byDate` is memory only. Every reader must still work on an activity that lacks `requestId`.
- Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean`.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no sdk:build.)
- Never run project-wide `tsc`, `npm run check`, `svelte-check` or `npm test`. Never `prettier --write` `liveScenes.ts`, `scenes.ts` or test files that were not already clean (they are not; keep the surrounding style).
- An int test that opens a DB inside an `it` gets a 60 s timeout. Never pipe vitest into `head`.

## Tests (Done means — all green)
Run in two batches (8 PGlite files at once exceeds the cap), each one command, then read the log:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/utils/activityStore.compileDedup.test.ts src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/sockets/scenes.displayNames.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-R-w2-a<n>.log 2>&1; echo exit=$?'
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/sockets/scenes.live.int.test.ts src/lib/server/scenes/sceneCauses.int.test.ts src/lib/server/scenes/unfiledScenesByEntry.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest4-R-w2-b<n>.log 2>&1; echo exit=$?'
```

## Report (final message)
Changed files with a one-line summary each · exact test commands and pass/fail counts · decisions you made · anything skipped and why · Noticed, not done.
