# BRIEF playtest2-S4-w2 — keep the Compile gate's count fresh: re-list history after scene writes and after filing

Lane `playtest2-S4`, worker 2. Supervisor checks your diff against this brief. Report back in your final message (changed files with line ranges, tests run + exact pass/fail counts, decisions, anything you stopped on, Noticed-not-done). Do not write a report file.

## Background
History rows of `entries:list` carry 🚧 `unfiledSceneCount` (`src/lib/server/sockets/entries.ts`, `listEntryRows` → `unfiledSceneCounts`; key present only when > 0; three Compile gates enable on it). Nothing re-sends `entries:list` when scenes change, so the count goes stale. Worker 1 (done) moved the filing of a compile's unfiled scenes to Apply: `activityStore.setCompileReviewApplied(async (activity) => { … })` in `src/lib/server/sockets/scenes.ts` (~2007–2053) files them in a `tx`, then — when the module-private `compileReplyTo` map has the pressing request's `{ socket, emitToUser }` — calls `sceneListByLorebookHandler.handler(to.socket, { lorebookId }, to.emitToUser)`.

## Goal — call the existing `relistEntries`, no new event
`relistEntries(socket, lorebookId, HISTORY_TYPE_ID, emitToUser)` is exported from `src/lib/server/sockets/entries.ts` (~501; it emits `entries:list` lazily through `emitToUser` and relays to share readers). `HISTORY_TYPE_ID` is already imported in `scenes.ts`. Import `relistEntries` the way `scenes.ts` imports its siblings — check first whether `entries.ts` (or anything it imports) imports `./scenes`; if a static import would make a cycle, use `await import("./entries")` at the call site. Say which you chose. `await` each call.

Call it, in `src/lib/server/sockets/scenes.ts`, after:
1. **scene create** — `sceneCreateHandler` (~288–527), after the session cascades (`scenes:list` / `scenes:scenedMessageIds`), before building the reply; lorebook `newScene.lorebookId`.
2. **scene delete** — `sceneDeleteHandler` (~838–890), after the session cascades; lorebook `existing.lorebookId`.
3. **scene open** — every handler path that opens a scene: `sceneOpenHandler` (await `replyLiveScene(…)` into a const, relist with `result.scene.lorebookId`, return the const); `sceneCloseHandler` only when `openedScene` is set (*End scene here*, Automatic opens the next one) — relist with `openedScene.scene.lorebookId`; `scenes:decideCue` (~2470) only in the `decided.opened` branch — `decided.opened.scene.lorebookId`. Not after close, moveBoundary or merge (out of scope — list them under Noticed).
4. **after the filing** — in the `setCompileReviewApplied` hook, inside the existing `if (to)`, after the `sceneListByLorebookHandler.handler(...)` call: `relistEntries(to.socket, activity.lorebookId, HISTORY_TYPE_ID, to.emitToUser)`. (Turn the `if (to) await …` into a block.)

Touch nothing else in these handlers. A one-line comment at each call is enough (e.g. `// The history list's unfiledSceneCount follows the scenes (Compile's gate).`).

## Files owned (only these; re-read each immediately before every edit; Edit, never Write, on existing files)
- `src/lib/server/sockets/scenes.ts` — ONLY the call sites above (and one import line if static).
- Tests: `src/lib/server/sockets/scenes.live.int.test.ts`, `src/lib/server/sockets/scenes.compileLine.int.test.ts`.

## Tests
- `scenes.live.int.test.ts` (it has a `recorder()` returning `{ emits, emit }`; emits may carry a thunk as `data` — resolve with `typeof d === "function" ? await d() : d`). Add one `describe("the history list follows scene writes (Compile's gate)")` with: (a) `scenes:open` emits `entries:list` whose resolved payload has `lorebookId` = the book and `typeId` = `HISTORY_TYPE_ID`, and — when the book has a history entry of the scene's day — that row carries `unfiledSceneCount: 1`; (b) `scenes:create` emits `entries:list` for its book; (c) `scenes:delete` of that unfiled scene emits `entries:list` whose row no longer carries `unfiledSceneCount`. Reuse the file's existing seed helpers; read how the existing open/create tests seed a session + book + messages and copy that shape. If a book in the file has no history entry, insert one with `historyValues([...])` (already imported) at the scene's day.
- `scenes.compileLine.int.test.ts`: in the §0-B describe, add a test: run the compile with a recording emitter (`{ emits, emit }` — write a small local one), `activityStore.remove(activity.id, "acted")`, then `await vi.waitFor(…, { timeout: 10_000 })` until `emits` contains both `scenes:listByLorebook` (payload `lorebookId` = the book) and `entries:list` (resolve the thunk; the day entry's row has no `unfiledSceneCount`). Also pass `{ timeout: 10_000 }` to the existing `vi.waitFor` calls in this file and in `src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts` (that file: only the `vi.waitFor` options — you may edit just that) — the default 1 s is short under load.

Run (n = 1, 2, …):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.live.int.test.ts src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/sockets/scenes.displayNames.int.test.ts src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts src/lib/server/sockets/scenes.createScoping.int.test.ts src/lib/server/sockets/scenes.cues.int.test.ts src/lib/server/sockets/scenes.laneE.int.test.ts src/lib/server/sockets/scenes.captureAndLine.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S4-w2-<n>.log 2>&1; echo exit=$?'` then read the log (tail/grep; never pipe vitest into head). Those extra files call the create/open/close/decideCue handlers; an existing assertion on the exact list of emitted events may now see `entries:list` too — if so, report which test and line, and adjust only that expectation to include it (say so). Do not run prettier `--write` over whole files (they are not prettier-clean at baseline); match the file's style on your lines.

## Rules you work under
- Sockets: no new event. "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." `entries:list` carries `lorebookId` via `buildEntriesList`; never hand-build the payload.
- "Inside `db.transaction(async (tx) => …)` use only `tx`." Your relist call in the hook goes AFTER the transaction, never inside it.
- No new names (functions you'd export, fields, events, labels). Stop and ask if one seems needed.
- Never "fix in passing": anything else you notice goes under Noticed, not done.
- An int test that opens a DB inside an `it` gets a 60 s timeout.

## Out of scope
Re-list after close / moveBoundary / merge, after automatic opens made outside `scenes.ts` (e.g. `scenes/boundaryWatcher.ts` from message flow), `entries.ts` beyond calling `relistEntries`, client files, `shared/sockets/types.ts`, `NOMENCLATURE.md`, any setting.

## Stop and ask when
A call needs a file not owned above; `relistEntries`' signature differs from the one quoted; an existing test's expectation would need more than adding `entries:list`.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Also never `git checkout`, `git restore` or `git clean` in either repo. Never a full `npm test`, `npm run check`, or `tsc` over the project.
