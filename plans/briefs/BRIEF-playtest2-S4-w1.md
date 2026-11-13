# BRIEF playtest2-S4-w1 — the compile files its scenes at Apply, not at the press

Lane `playtest2-S4`, worker 1. Supervisor checks your diff against this brief. Report back in your final message (changed files with line ranges, tests run + exact pass/fail counts, anything you had to decide, anything you stopped on). Do not write a report file.

## Goal
Today `scenes:compile` (`src/lib/server/sockets/scenes.ts`, `sceneCompileHandler`, the `db.transaction` block at ~1150–1199, "§0-B: a scene opens unfiled…") FILES the day's unfiled scenes under the history entry at the press, before the model writes, so a discarded review leaves them filed. Ruled design (lead-accepted ★S3-1, build exactly this):

1. **Press: read, don't file.** Replace the filing transaction with a read: the same query (unfiled = `isNull(scenes.historyEntryId)`, this book, `onLineSql(scenes.branchId, line)`, `rowsReadingOnLine(…, line, sceneDayOf)`), the same per-scene `historyEntryOfDate(db, { lorebookId, branchId: scene.branchId ?? null, date: sceneDayOf(scene) }, { create: false })` test (`of?.historyEntryId === params.historyEntryId`), but **no update and no transaction/lock** (read-only). Keep the `BranchRefusal` → `refuse("That line is not one of this lorebook's.", e)` mapping around it. The compiled scene list is then the already-filed `lineScenes` (unchanged query) **plus** these unfiled-of-this-day scenes, together through `inPlayOrder(…, await placesInPlay(…))` exactly as now. `refuse("No scenes found for this history entry.")` still fires when the union is empty.
2. **Keep the ids on the activity.** `src/lib/server/utils/activityStore.ts`: add to `CompileHistoryEntryActivity` an optional `sceneIds?: number[]` with a doc comment: 🚧 the scenes not yet compiled that this run read (its day's unfiled scenes); filed under the entry when the review is applied (`acted`), never on a discard, supersede or lapse; memory only, never persisted. Let `startCompile`'s params accept `sceneIds?: number[]` (it spreads `...params` already). The handler passes the unfiled ids (only the unfiled ones, not the already-filed ones; omit the key when there are none).
3. **The `acted` hook.** In `activityStore.ts`, modelled exactly on `setSceneReviewDiscarded` (~745–762): a private optional field + a public setter `setCompileReviewApplied(fn: (activity: CompileHistoryEntryActivity) => void | Promise<void>)`, doc comment marked 🚧. In `remove()` (~769), beside the `sceneReviewDiscarded` call: when `existing.kind === "compile_history_entry" && existing.status === "review" && how === "acted" && existing.sceneIds?.length && this.compileReviewApplied`, call it with `existing` as `void Promise.resolve(fn(existing)).catch((e) => console.warn("[activityStore] a compile review's scenes were not filed:", e))`. Nothing else in `activityStore.ts` changes.
4. **Wire it once from `scenes.ts`**, at module level next to `activityStore.setSceneReviewDiscarded(…)` (~1977), with a 🚧 doc comment: the hook files the activity's `sceneIds` in ONE transaction:
   ```ts
   await db.transaction(async (tx) => {
     await lockBookCalendar(tx, activity.lorebookId)
     // re-read each scene with tx; skip it unless it is still unfiled, in this book,
     // and its day's entry is STILL this one:
     //   historyEntryOfDate(tx, { lorebookId, branchId: scene.branchId ?? null, date: sceneDayOf(scene) }, { create: false })
     //   ?.historyEntryId === activity.historyEntryId
     // a BranchRefusal for one scene skips that scene (it is a JS-level throw from lineOfBook,
     // src/lib/server/state/reading.ts:90 — confirm it is thrown before/without a failed SQL statement);
     // then: tx.update(schema.scenes).set({ historyEntryId: activity.historyEntryId })
     //   .where(and(eq(scenes.id, id), eq(scenes.lorebookId, activity.lorebookId), isNull(scenes.historyEntryId)))
   })
   ```
   `sceneDayOf` is a local closure inside the handler today; lift it to a module-private function (same body: `sceneClockOf(s, "opened")` → `{year, month ?? null, day ?? null}`) so both the handler and the hook use one copy. After the transaction, **re-send the lists to the person who compiled**: the compile handler stores, in a module-private `Map<string, { socket: any; emitToUser: (event: string, data: any) => void | Promise<void> }>` keyed by activity id, the socket and `emitToUser` it was called with (set right after `startCompile` returns the id, only when `sceneIds` is non-empty; on each insert, first delete map entries whose id `activityStore.getById(id)` no longer finds, so discarded/lapsed runs don't accumulate). The hook takes and deletes its entry; when found it (a) re-sends `scenes:listByLorebook` for `activity.lorebookId` — call the existing `sceneListByLorebookHandler.handler(socket, { lorebookId }, emitToUser)` (it emits itself; do not emit twice) — and (b) leaves the entries re-list to worker 2 (see Out of scope). When not found (a synthetic activity in a test, or a reload), it files and sends nothing. Filing never depends on the map.
   Why the map: the hook runs from `activity:dismiss` (`sockets/activity.ts`, not ours) with no socket in scope; `pushToUser` (`sockets/utils/userPush.ts`) cannot carry scoped events (`scenes:listByLorebook` / `entries:list` are in `SCOPED_EVENTS`; it asks `interestedSockets` without the scope and every scoped subscriber is dropped). `emitToUser` emits to the user's room through `io`, so it still reaches the person's new tabs after the pressing socket has gone.
5. **Docs** `docs/lorebook-time.md` line 23: replace exactly `Pressing **Compile to entry** also takes in the scenes of the entry's day that aren't compiled yet and files them under it at once, before the model writes; they stay filed there even if you discard the changes.` with `Pressing **Compile to entry** also takes in the scenes of the entry's day that aren't compiled yet: they are filed under it when you apply the changes; discarding leaves them not yet compiled.` Nothing else in the doc.
6. **Comments**: update the handler's "§0-B: a scene opens unfiled, and a compile files…" comment to say the press reads them and Apply files them. The file header comment of `scenes.compileLine.int.test.ts` may gain one bullet.

## Files owned (only these; re-read each immediately before every edit; use Edit, never Write, on existing files)
- `src/lib/server/sockets/scenes.ts` — ONLY the compile handler (`sceneCompileHandler`), a lifted module-private `sceneDayOf`, the module-private map, and the new `setCompileReviewApplied(...)` wiring beside `setSceneReviewDiscarded`. Another worker will later edit the create/delete/open handlers; don't touch them.
- `src/lib/server/utils/activityStore.ts` — ONLY the `sceneIds?` field, `startCompile`'s params type, the hook field/setter, and the call in `remove()`.
- `docs/lorebook-time.md` — the one sentence.
- Tests: `src/lib/server/sockets/scenes.compileLine.int.test.ts`, `src/lib/server/utils/activityStore.compileApplied.test.ts` (new), `src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts`.

## Files readable
Everything. Especially: `src/lib/client/components/modals/CompileHistoryEntryModal.svelte:316–386` (all three save paths — no change, amendment, `entries:update` — emit `activity:dismiss { how: "acted" }` after the server answers; discard/cancel emit a plain dismiss), `src/lib/server/sockets/activity.ts:54–62`, `src/lib/server/scenes/historyEntryOfDate.ts`, `src/lib/server/sockets/entries.ts` (`unfiledSceneCounts`, `listEntryRows`, `buildEntriesList`).

## Tests to add / change
- `scenes.compileLine.int.test.ts`, describe "scenes:compile files the unfiled scenes of its entry's day (§0-B)": rewrite the first test so that **after the compile** the same-day scene is STILL unfiled, `compiled` is `[[sameDay.id]]`, the activity's `sceneIds` is `[sameDay.id]`; then `activityStore.remove(activity.id, "acted")` and `await vi.waitFor(…)` until `sameDay.historyEntryId === dayEntry.id`; `otherDay` stays null; `dawn` stays under `w.entry`; still exactly 2 entries. Add: (a) compile then a plain `activityStore.remove(id)` (discard) → after a short `await new Promise(r => setTimeout(r, 50))` the scene is still unfiled; (b) a lost dismiss: compile, no dismiss, compile again (the second `startCompile` supersedes the review) → the scene is still unfiled, `compiled` shows it read on both runs, the second activity carries it in `sceneIds`, and an `acted` on the second files it. Keep the second existing test (unfiled-only entry compiles from that scene) passing.
- `activityStore.compileApplied.test.ts` (new, pattern of `activityStore.compileDedup.test.ts`, no DB): with a spy set via `setCompileReviewApplied`: `acted` on a `review` compile with `sceneIds` calls it once with the activity; `dismissed`, `superseded`, `lapsed` don't; `acted` on a `running` compile doesn't; `acted` with no `sceneIds` doesn't. Restore the hook to a no-op/undefined after (the setter takes a fn; set a no-op in `afterAll` if there's no way to clear it — say which).
- `entries.unfiledSceneCount.int.test.ts`: add one test — a book with an unfiled scene of an entry's day shows `unfiledSceneCount: 1` on that entry's row; `await import("./scenes")` (wires the hook), `activityStore.startCompile({ …, historyEntryId: thatEntry.id, lorebookId, branchId: null, moment: null, sceneIds: [scene.id] })`, `updateCompile(id, { status: "review", pendingResult: { content: "x" } })`, `remove(id, "acted")`, `vi.waitFor` until the row carries no `unfiledSceneCount` key (absent = 0) and the scene's `historyEntryId` is the entry's.

Run (one log per run, n = 1, 2, …):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/utils/activityStore.compileApplied.test.ts src/lib/server/utils/activityStore.compileDedup.test.ts src/lib/server/utils/activityStore.abortCleanup.test.ts src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts src/lib/server/sockets/scenes.cancelGuard.int.test.ts src/lib/server/sockets/scenes.createScoping.int.test.ts src/lib/server/utils/sceneMentions.int.test.ts src/lib/server/state/sessionLoreWrites.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S4-w1-<n>.log 2>&1; echo exit=$?'` then read the log (tail / grep, never pipe vitest into head). The last four files already use the compile handler; they must stay green (if one asserted filing at the press, report it — don't change its expectations without saying so). Then `npx prettier --check` on each file you changed — but do NOT run prettier `--write` over a whole file; fix only lines you wrote.

## Rules you work under (quoted from CLAUDE.md / the lane brief)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." Every read and write inside the hook's transaction, including `historyEntryOfDate` and `lockBookCalendar`, gets `tx`.
- "`$state(new Set())` / `new Map()` is not reactive" — server code, irrelevant; but use a plain `Map` here.
- Names: the only new names are `setCompileReviewApplied` and `sceneIds` (both ruled). Anything else you would export or show a person is a new name: stop and say so. Module-private helpers (`sceneDayOf`, the map) are fine; keep them unexported.
- Stored data: no schema change, no migration. `sceneIds` lives in memory only.
- P1: no new automatic behaviour; the filing happens only on the person's own Apply.
- Sockets: no new event. "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." `scenes:listByLorebook` carries `lorebookId` via its handler.
- Never "fix in passing": anything else you notice goes in your final message under Noticed, not done.
- An int test that opens a DB inside an `it` gets a 60 s timeout.

## Out of scope
The `relistEntries` calls (after scene create/delete/open and after the filing) — worker 2 does them after you. `CompileHistoryEntryModal.svelte`, `entries.ts`, `shared/sockets/types.ts`, `NOMENCLATURE.md`, `sockets/activity.ts`, `userPush.ts`. Any setting. The entry id on `SceneWithMeta`. A "Not yet compiled" group or compile-by-date.

## Stop and ask when
A save path does not send `acted` after all; a name beyond `setCompileReviewApplied` / `sceneIds` would be exported or shown; an existing test outside the compileLine file asserted filing at the press; anything needs a file not owned above.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Also never `git checkout`, `git restore` or `git clean` in either repo. Never a full `npm test`, `npm run check`, or `tsc` over the project.
