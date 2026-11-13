# BRIEF playtest2-S3-w1 — server: the review's name; the entry row's count of not-yet-compiled scenes

Lane `playtest2-S3`, worker 1 of 2. Supervisor reads your report: write it at `plans/briefs/REPORT-playtest2-S3-w1.md` (if the harness refuses, put the full text in your final message).

## Goal
**A. The review's name** (`src/lib/server/sockets/scenes.ts`).
1. In `processScene` (~:1853) the review's draft name is `name: result.name ?? scene.name ?? undefined`. `scene.name` is the STORED name; a default name is numbered at render, so after an earlier scene is deleted the stored *Scene 3* is shown as *Scene 2*. The review modal sends the draft name back at Apply, the `scenes:update` rename rule sees a name that is not the shown one and makes it custom — the scene jumps back to *Scene 3* and stops renumbering. Fix: fall back to the shown name — `shownSceneName` computed at ~:1490 in the same function with `sceneDisplayNames(db, [scene]).get(scene.id)` (the one display-name reader; reuse that variable or re-read with the same call just before building `pendingResult` — choose, and say which). `activityStore.updateScene(... sceneName: pendingResult.name ...)` then shows the display name too; that is intended.
2. In `sceneUpdateHandler`'s rename rule (~:635–667, the `namePatch` block): also treat `name !== null && name.trim() === (existing.name ?? "").trim() && existing.nameIsDefault` as "keep default" (`namePatch = {}`), beside the existing "the shown name sent back" branch. A review opened before a renumber still carries the old stored name; it must not turn custom.

**B. The history entry row carries the count of its date's not-yet-compiled scenes.**
- `src/lib/shared/sockets/types.ts`, `Sockets.Entries.List.Response` (~:8475): change `entryList: LorebookEntry[]` to `entryList: Array<LorebookEntry & { unfiledSceneCount?: number }>` with a JSDoc on the field: 🚧 history entries only — how many scenes not yet compiled (`scenes.history_entry_id` null) a compile of this entry would take in: the unfiled scenes whose day's entry (`historyEntryOfDate`, on the scene's own line) is this one; absent when there are none; projected, never written from a client; sent by the book's list only. **This is the ONE field this lane may add to that file; the name `unfiledSceneCount` is claimed (grepped: no other use). Touch nothing else in types.ts.**
- `src/lib/server/sockets/entries.ts` `listEntryRows(lorebookId, typeId)` (~:195): return type follows the response row type. When `typeId === HISTORY_TYPE_ID` only: ONE query for the book's unfiled scenes (`eq(schema.scenes.lorebookId, lorebookId)`, `isNull(schema.scenes.historyEntryId)`; select only `id`, `branchId` and the `openedStoryClock*` columns `sceneClockOf` reads). Each scene's day = `sceneClockOf(scene, "opened")` → `{ year, month: month ?? null, day: day ?? null }`, or `null` when it has no clock — exactly what `sceneCompileHandler`'s `sceneDayOf` (~scenes.ts:1145) passes. Group the scenes by `(branchId ?? null, day)`; for each group call `historyEntryOfDate(db, { lorebookId, branchId, date }, { create: false })` (`$lib/server/scenes/historyEntryOfDate` — the ONE date rule; never re-implement it) and add the group's size to the returned entry id's count. A `BranchRefusal` from it (a scene on a line that is no longer the book's) skips that group. Attach `unfiledSceneCount` only where the count > 0, the way `keptImprints` is attached in the same function. Dynamic `import()` for `liveScenes`/`historyEntryOfDate` if a static import would cycle — check.
- Do NOT edit `historyEntryOfDate.ts`, `liveScenes.ts`, or anything else. If the date rule can't be reached this way, stop and report.

## Files owned (re-read each immediately before every edit; use Edit, never Write, on existing files — other lanes edit nearby)
`src/lib/server/sockets/scenes.ts` (only the two places above), `src/lib/server/sockets/entries.ts` (`listEntryRows` only), `src/lib/shared/sockets/types.ts` (the one field), tests: `src/lib/server/sockets/scenes.summaryReview.int.test.ts`, `src/lib/server/sockets/scenes.displayNames.int.test.ts`, `src/lib/server/sockets/scenes.compileLine.int.test.ts`, new `src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts`.

## Files readable
Everything. Harness patterns: `scenes.summaryReview.int.test.ts` (fake model adapter, `processScene` runs), `scenes.displayNames.int.test.ts` (`makeWorld`, `openedScene`, `update`, `listed`), `scenes.compileLine.int.test.ts` (the §0-B describe at ~:639), `scenes/historyEntryOfDate.int.test.ts`.

## Tests to add (Done means)
1. `summaryReview.int` (or `displayNames.int` if it can run a summary): two default scenes on one channel; delete the first; `scenes:process` the second → the review's draft name (response `name` and the activity's `pendingResult.name`) is the SHOWN name (*Scene 1…*); Apply (`scenes:update` with that name + a summary) → `nameIsDefault` stays true, stored name unchanged, the listed name still *Scene 1…*.
2. `displayNames.int` rename rule: a default scene, renumbered by a delete, sent its STORED name → `nameIsDefault` stays true and it keeps renumbering.
3. `entries.unfiledSceneCount.int` (new): `entries:list` / `listEntryRows` for history: an entry whose day has two unfiled scenes carries `unfiledSceneCount: 2`; a scene of another day counts for that day's entry only; a scene already filed (historyEntryId set) is not counted; an entry whose day has none has no `unfiledSceneCount` key at all; a lore (non-history) list carries none; a scene with no clock counts for the newest dated entry. Rows lacking the field still type-check/read as before (absent = 0).
4. `compileLine.int`: an entry with NO scenes filed under it but an unfiled scene of its day → `scenes:compile` completes with that scene's summary read (do not change the existing press-time filing; another lane decision covers when filing happens).
Then run (exact, capped; read the log after; never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/sockets/scenes.summaryReview.int.test.ts src/lib/server/sockets/scenes.displayNames.int.test.ts src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts src/lib/server/sockets/scenes.live.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S3-w1.log 2>&1; echo exit=$?'`
An int test that opens a DB inside an `it` gets a 60 s timeout (`vi.setConfig({ testTimeout: 60_000 })` as the neighbours do). `npx prettier --check <file>` on each changed file.

## Rules your work depends on (quoted from CLAUDE.md / the lane brief)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Stored data. 0.6 is in users' hands: an additive field is fine only if every reader still works on rows that lack it (test that)." — `unfiledSceneCount` is projected on the wire only; no schema change, no migration.
- "Names. Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24." The only new name is `unfiledSceneCount` (claimed). No new event, function export, setting or string. A local unexported helper inside `entries.ts` is fine; name it in your report.
- "It is a **session**, never a *chat*."
- Do what was asked, at the size asked. Findings go under **Noticed, not done** in your report, never fixed in passing.
- Never `kill -9` anything; never a full `npm test`, `npm run check`, project-wide `tsc`, or `sdk:test`.

## Stop and ask when
The count needs a new event, a new exported name, or an edit outside the owned files; the date rule cannot be reused as written; a test needs a behaviour change not listed here.

## Report
Changed files (with what changed), tests run (exact command, pass/fail counts), decisions you made, Noticed-not-done.

## Verbatim lines
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK change is expected in this brief.)
