# BRIEF playtest2-S4-w3 — one rule, one place: a scene's day → its history entry (unfiled scenes)

Lane `playtest2-S4`, worker 3. The supervisor checks your diff against this brief. Report back in your final message (changed files with line ranges, tests run + exact pass/fail counts per file, decisions, anything you stopped on, Noticed-not-done). Do not write a report file.

## Why
The rule "an unfiled scene belongs to the history entry of its day" (`historyEntryOfDate(…, { create: false })`, `src/lib/server/scenes/historyEntryOfDate.ts`) is now applied by hand in four places, each slightly differently:
- `src/lib/server/sockets/scenes.ts` — the compile press (`sceneCompileHandler`, the "§0-B" block ~1175–1215, one `historyEntryOfDate` call PER SCENE, via module-private `sceneDayReader()` ~1047);
- `src/lib/server/sockets/scenes.ts` — the Apply hook `activityStore.setCompileReviewApplied(async (activity) => …)` (~2007–2060), per scene again;
- `src/lib/server/sockets/entries.ts` — `unfiledSceneCounts(lorebookId)` (~224–273): the only copy that groups by (branch, day), but it counts EVERY line's scenes against an entry;
- `src/lib/server/utils/lorebookExportBuilder.ts` ~205–262 — per scene, and a `BranchRefusal` from one bad `branchId` fails the whole export.
They also differ on month/day nulls (the compile keeps a day with no month; the export and `historyEntryOfDate`'s own `dayOnly` drop it — the rule: a Day-count clock, a day with no month, dates by its year).

## Goal
1. **New file `src/lib/server/scenes/unfiledScenesByEntry.ts`** exporting (🚧, doc comment saying it is THE one reading of the rule for unfiled scenes and who calls it):
   ```ts
   export async function unfiledScenesByEntry(
     db: Db,                     // the caller's db or tx
     at: { lorebookId: number; line?: Line }
   ): Promise<Map<number, SceneRow[]>>   // history entry id → its unfiled scenes, in id order
   ```
   - Reads the book's unfiled scenes (`isNull(scenes.historyEntryId)`, `eq(scenes.lorebookId, …)`). With `line`: only the ones that line reads — `onLineSql(schema.scenes.branchId, line)` (`$lib/server/state/lineSql`) then `rowsReadingOnLine(rows, line, sceneDay)` (`$lib/shared/lorebooks/lineReading`). Without `line`: every line's (the export).
   - A scene's day: `openedStoryClock{Year,Month,Day}` → `null` when no year; else `{ year, month: month ?? null, day: month != null ? (day ?? null) : null }` (the `dayOnly` rule). One module-private function, used for both line reading and grouping.
   - Groups by (scene `branchId ?? null`, day key), calls `historyEntryOfDate(db, { lorebookId, branchId, date }, { create: false })` ONCE per group (each scene is resolved on its OWN line, as today), skips a group whose call throws `BranchRefusal` (`$lib/server/state/reading`), rethrows anything else, and adds the group's rows to the map under the answer's `historyEntryId` (no answer → not in the map).
   - Check for an import cycle before importing anything from `./liveScenes` (you shouldn't need it: read the columns directly). Keep imports static unless a cycle forces a lazy one.
2. **Compile press** (`scenes.ts`): replace the per-scene loop with `(await unfiledScenesByEntry(db, { lorebookId: historyEntry.lorebookId, line })).get(params.historyEntryId) ?? []`. Nothing else in the handler changes (the union with `lineScenes`, `inPlayOrder`, `sceneIds` on `startCompile`, `compileReplyTo`). The `BranchRefusal` try/catch around it can go if nothing in it can throw one any more (the line is already resolved above) — say what you did.
3. **Apply hook** (`scenes.ts`): inside the existing `db.transaction(async (tx) => …)`, after `lockBookCalendar(tx, activity.lorebookId)`: resolve the activity's line `lineOfBook(tx, activity.lorebookId, activity.branchId)` (a `BranchRefusal` → file nothing, return from the transaction); `const byRule = (await unfiledScenesByEntry(tx, { lorebookId, line })).get(activity.historyEntryId) ?? []`; file the ids in `byRule` ∩ `activity.sceneIds` (the hook only runs when `sceneIds` is non-empty — `activityStore.remove` guards that) with ONE `tx.update(schema.scenes).set({ historyEntryId }).where(and(inArray(id, ids), eq(lorebookId), isNull(historyEntryId)))` (skip when empty). Keep the re-sends after the transaction exactly as they are (`sceneListByLorebookHandler.handler` + `relistEntries`). Remove `sceneDayReader` if nothing uses it any more.
4. **The count promises only what the compile takes** (`entries.ts`, `unfiledSceneCounts` only — and its one call in `listEntryRows` ~214 if its arguments change): count, for each history entry, only the unfiled scenes the entry's OWN line reads (main's shared scenes + that line's chain), so a fork's scene never enables Compile on a main entry that will not take it. Do it once per distinct line among the book's history rows, not per scene: for each distinct `branchId ?? null` of the history rows being listed → `lineOfBook(db, lorebookId, branchId)` (`BranchRefusal` → those entries get no count) → `unfiledScenesByEntry(db, { lorebookId, line })` → for each entry on that line, `map.get(entry.id)?.length`. The returned shape stays `Map<entryId, count>`; the key stays absent at 0. Update its doc comment (it now says "on the scene's own line" — say the entry's own line reads them, and why: the compile from that line takes exactly these).
5. **Export** (`lorebookExportBuilder.ts` ~205–262): replace the per-scene `historyEntryOfDate` call with one `unfiledScenesByEntry(db, { lorebookId: lorebook.id })` (no line) before the loop; a scene found in the map under an entry in `exportedHistoryIds` is `filedUnder` that entry; every other unfiled scene takes the existing synthetic-entry path unchanged (so a scene whose line is not the book's is exported under a synthetic entry, never failing the export). Keep the synthetic path's own year/month/day code as is.

## Files owned (only these; re-read each immediately before every edit; Edit, never Write, on existing files — the new files you create with Write)
- `src/lib/server/scenes/unfiledScenesByEntry.ts` (new) and `src/lib/server/scenes/unfiledScenesByEntry.int.test.ts` (new)
- `src/lib/server/sockets/scenes.ts` — ONLY the compile press block, the Apply hook, and removing `sceneDayReader` if unused. Another worker edits `src/lib/server/scenes/liveScenes.ts` (`sceneReplyRow`) at the same time — not yours.
- `src/lib/server/sockets/entries.ts` — ONLY `unfiledSceneCounts` and its call in `listEntryRows`.
- `src/lib/server/utils/lorebookExportBuilder.ts` — ONLY the unfiled-scene block ~205–262 (and an import line).
- Tests: `src/lib/server/sockets/scenes.compileLine.int.test.ts`, `src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts`, `src/lib/server/sockets/lorebooks.unfiledScenesExport.int.test.ts`.

## Tests to add (existing ones must stay green)
- `unfiledScenesByEntry.int.test.ts` (pattern: `entries.unfiledSceneCount.int.test.ts` — `vi.mock("$lib/server/db", …createTestDb…)`, `releaseDataDir`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })`): two scenes of one day map to that day's entry; a scene of a day with no entry is absent; a Day-count scene (year + day, no month) maps to the entry dated by its year alone; with `line` = main a fork's scene is absent and with the fork's line it is present (and main's shared scene too); a scene whose `branchId` is a branch of ANOTHER book is skipped, not thrown.
- `entries.unfiledSceneCount.int.test.ts`: a fork's unfiled scene of the main entry's day gives the main entry NO `unfiledSceneCount`; a history entry ON the fork (dated that day) does count it.
- `scenes.compileLine.int.test.ts` (Apply): a scene in `sceneIds` that the rule no longer puts under the entry (re-date it, e.g. set its `openedStoryClockDay` to another day, between the compile and the `acted`) is NOT filed; a same-day scene created after the compile (not in `sceneIds`) is NOT filed; the one in both is filed. Use `vi.waitFor(…, { timeout: 10_000 })` as the file does.
- `lorebooks.unfiledScenesExport.int.test.ts`: a book with one unfiled scene whose `branchId` belongs to another book exports without throwing, that scene under a synthetic entry and the book's other unfiled scene still nested under its day's entry. (If the FK or a check makes such a row impossible to insert, say so and skip that case.)

Run (n = 1, 2, …):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/scenes/unfiledScenesByEntry.int.test.ts src/lib/server/sockets/scenes.compileLine.int.test.ts src/lib/server/sockets/entries.unfiledSceneCount.int.test.ts src/lib/server/sockets/lorebooks.unfiledScenesExport.int.test.ts src/lib/server/sockets/scenes.live.int.test.ts src/lib/server/sockets/scenes.displayNames.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S4-w3-<n>.log 2>&1; echo exit=$?'` then read the log (tail/grep; never pipe vitest into head). If it produces no output for 10 minutes, kill only your own vitest by pid and run the files one at a time, and say so. Do not run prettier `--write` over whole files (they are not prettier-clean at baseline); match the file's style on your lines; `npx prettier --check` your new files.

## Rules you work under
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." The helper takes the caller's handle; the hook passes `tx`, and `lineOfBook` inside it gets `tx`.
- Names: the only new name is `unfiledScenesByEntry` (lead-proposed; the supervisor records it for canon). Anything else exported or shown to a person: stop and ask.
- No schema change, no migration, no new event, no setting.
- Never "fix in passing": anything else you notice goes under Noticed, not done.
- An int test that opens a DB inside an `it` gets a 60 s timeout.

## Out of scope
Changing `historyEntryOfDate` itself; the compile's draft saying which scenes it re-reads; recovery for a lost activity; `sceneReplyRow`/graph names (worker 4); client files; `shared/sockets/types.ts`; `NOMENCLATURE.md`.

## Stop and ask when
A caller cannot use the helper without changing what it returns to its own callers; an existing test's expectation must change (say which and why); a file outside the owned list is needed.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*
- Also never `git checkout`, `git restore` or `git clean` in either repo. Never a full `npm test`, `npm run check`, or `tsc` over the project.
