# REPORT playtest2-S2-w1

Status question: none relayed.

## Changed files
- src/lib/server/scenes/liveScenes.ts: `openScene` files nothing (`historyEntryId: null`, `nameIsDefault: true`); `fileSceneUnder` deleted (no other caller; boundaryWatcher.ts does not call it); `createdHistoryEntry` removed from `LiveSceneResult` and the return; header item 1 rewritten; unused imports removed (`assertDateLands`, `historyEntryDate`, `lineOfBook`, `BranchRefusal`, `rowReadsOnLine`, `HISTORY_TYPE_ID`, `entryInsert`). `lockBookCalendar` stays in `openScene` (still imported, harmless).
- src/lib/server/sockets/scenes.ts: compile handler files the unfiled scenes of the asked entry's day (one transaction, `lockBookCalendar`, `historyEntryOfDate(... create:false)`, `UPDATE ... AND history_entry_id IS NULL`, BranchRefusal -> refuse) before the `lineScenes` query; create handler skips the history-entry lookup and line check when `historyEntryId` is absent and stores null; `scenes:create` and `recordClose` pass `historyEntryId ?? undefined`; `createdHistoryEntry` spread removed from `replyLiveScene`. Imports added: `isNull`, `StoryDate` type, `historyEntryOfDate`. Module-private closure `sceneDayOf` inside the compile handler (`sceneClockOf` via the file's usual dynamic import of liveScenes).
- Tests: new src/lib/server/scenes/historyEntryOfDate.int.test.ts (5 tests); scenes.live.int.test.ts (two open tests changed to the new rule: historyEntryId null, nameIsDefault true, no new history entry row, createdHistoryEntry undefined; helper `historyEntryCount`); scenes.compileLine.int.test.ts (+1: compile fills the day's entry; other day stays unfiled; filed scene untouched; no entry made); scenes.createScoping.int.test.ts (+1: create without historyEntryId is unfiled; the foreign-entry refusal test already exists).
- historyEntryOfDate.ts: unchanged, no bug found.

## Tests run
Batch 1 (historyEntryOfDate, live, compileLine, createLine, createScoping, liveScenes.rewind): 6 files, 40 tests passed. Log: /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S2-w1-1.log
Batch 2 (boundaryWatcher x2, judgedSceneCue, laneE, captureAndLine, loreWritesOff): 6 files, 66 tests passed. Log: .../scratchpad/playtest2-S2-w1-2.log
(Same command shape as the brief. I also ran a project `npx tsc --noEmit` once, filtered to my files: no errors there; I should not have, per the rules.)

## Decisions
- Compile only files scenes whose date's entry is the asked entry (create:false); the scene's day is its opened clock, `{year, month, day}` (null without a clock; then `historyEntryOfDate` date null = newest dated entry, so a clockless unfiled scene is filed under the asked entry only if that is the newest dated one).
- Scenes with a different branchId are looked up on their own branch via `scene.branchId`.

## Stopped / needs supervisor
Nothing stopped.

## Queued
- src/lib/shared/sockets/types.ts:~14194 `createdHistoryEntry?: boolean`: remove (no producer now).
- src/lib/server/state/durable.ts:~413: `let best: { id: number; historyEntryId: number } | undefined` -> `{ id: number; historyEntryId: number | null }` (the return type already says `number | null`; `best = row` is a type error until then). With an unfiled newest scene it returns `{ historyEntryId: null, sceneId: <that scene> }`, a null anchor. Readers: sessions/settle.ts:~174 (returns null when no scene has an entry, then falls to `newestHistoryEntryOf(...).historyEntryId` -> null) and sockets/sessions.ts:~1863-1870 (passes the moment to `recordToTimeline`, dated from the reading when null). Both tolerate null.

## Reader verdicts (server)
- attic/etl/lore.ts:299: reads 0.5.3 NOT NULL data; no change.
- state/reading.ts:388, resolve.ts:472, placeStats.ts:213: null-guarded, fine.
- graphBuilder.ts:1726: `?? undefined`, fine. forkHistory.ts:202/325/446: inArray/eq on ids, null rows simply never match (unfiled scenes are not moved/kept with an entry; fine).
- lorebooks/ownBook.ts:1094: `through(maps.entries, scene.historyEntryId)!` - `through` returns null for null, written to a nullable column: fine at runtime (the `!` is just a lie to the type).
- sockets/narrativeGraph.ts:289/1197/2406/2836/4559/5433, lorebooks/tableRegistry.ts:375-591 (w2's): null-guarded or `?? null`; `via(maps.historyEntries, null)` at tableRegistry 382/511/591 and the export builder (utils/lorebookExportBuilder.ts:225-227 `scenesByHistoryEntryId.get(scene.historyEntryId)` / :455, lorebookExportMapper.ts:1166 is guarded) should be checked by w2; 225-227 groups an unfiled scene under key null (drops it from every entry; no crash).
- sockets/scenes.ts other readers: w2's areas not inspected.

## Client readers (none throw; no file edited)
- BookSettings.svelte:162 `!done.has(s.historyEntryId)`: Set.has(null) false, an unfiled scene counts as "waiting" - correct meaning.
- time/storyTime.ts:167 `byId.has(null)` -> skip; :192 `byId.get(null)` undefined -> `if (!entry) continue`. Not shown on the timeline.
- EntryWorkspace.svelte:670-672, TimeLens.svelte:173-175: `map.get(null) ?? []` / `map.set(null, ...)`: harmless extra null key, never looked up by an entry id.
- cast/memberScenes.ts:55: `dates.get(null) ?? null` -> undated scene, listed with `historyEntryId: null`.
- sessionPage/requests/historyEntries.ts:259 already `!= null` guarded; liveSceneProjection.ts already `?? null`.
- sections/index.ts:399 only builds a string key.
No unit-test case added for storyTime.ts (existing tests cover only filed scenes; the skip is `if (!entry) continue`); not added since no code changed.

## Noticed, not done
- TimeLens.svelte:262 and GraphsWorkspace.svelte:909 navigate `openEntry` with `entryId: scene.historyEntryId`, which is null for an unfiled scene (reachable from GraphsWorkspace `openScene`, and not from the timeline since storyTime skips unfiled scenes). Navigation to a null entry id is probably a dead click, not a throw; a guard needs a design call (where should an unfiled scene open?).
- Wire types derived from the scene row may now be `number | null` for `historyEntryId`; svelte-check on the client readers above was not run (forbidden), so type errors there are possible.
- scenes.live test still asserts `res.scene.name` matches /^Scene 1 · / ; w2's rendering change could affect it (green now).
