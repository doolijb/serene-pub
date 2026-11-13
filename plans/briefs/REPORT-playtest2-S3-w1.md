# REPORT playtest2-S3-w1

Status question: none relayed.

## Changed files
- `src/lib/server/sockets/scenes.ts`: (1) `processScene` draft name is now `result.name ?? shownSceneName ?? scene.name ?? undefined`. I reused the `shownSceneName` variable computed at the top of the same function (same `sceneDisplayNames` call, one reader), rather than re-reading. A renumber mid-run is not possible to matter: the run holds the scene. (2) `sceneUpdateHandler` rename rule: new branch after the "shown name sent back" one: `name !== null && existing.nameIsDefault && name.trim() === (existing.name ?? "").trim()` gives `namePatch = {}`.
- `src/lib/server/sockets/entries.ts`: `listEntryRows` returns `Array<LorebookEntry & { unfiledSceneCount?: number }>`; for `HISTORY_TYPE_ID` only, calls new local unexported helper `unfiledSceneCounts(lorebookId)` (one scenes query; groups by branch and day; `historyEntryOfDate(db, ..., { create: false })` per group; `BranchRefusal` skips the group; dynamic imports of `liveScenes` and `historyEntryOfDate`). The key is attached only when count > 0.
- `src/lib/shared/sockets/types.ts`: `Entries.List.Response.entryList` is now `Array<LorebookEntry & { unfiledSceneCount?: number }>` with the JSDoc. Nothing else touched.
- Tests: `scenes.summaryReview.int.test.ts` (new describe; the fake adapter gained a static `failFromCall`, default null, so the naming step can fail and leave `name` undefined); `scenes.displayNames.int.test.ts` (stored-name-sent-back rename test); `scenes.compileLine.int.test.ts` (entry with no filed scenes + one unfiled scene of its day compiles from it); new `entries.unfiledSceneCount.int.test.ts` (2 on one day, other day separate, filed scene not counted, no key when none, no clock counts for the newest dated entry, lore list has no key).

## Tests
The exact capped command from the brief: 5 files passed, 46 of 46 tests passed (exit=0). Log: `/tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-S3-w1.log`.

## Decisions
- Review test: the fake model otherwise names the scene with its own text, which wins over the fallback, so the test makes the naming call (call 3) throw; the run tolerates it and the draft name falls back to the shown name. Asserts response name and `pendingResult.name` are "Scene 1", Apply keeps `nameIsDefault` true, stored name "Scene 2", listed name "Scene 1".
- Compile test #4 largely overlaps the existing §0-B test; added a narrow one for the only-unfiled case.

## Noticed, not done
- `npx prettier --check` warns on `scenes.ts`, `entries.ts`, `types.ts`, `scenes.displayNames`, `scenes.compileLine` test: they were not prettier-clean before (large uncommitted diffs from other lanes); I did not reformat them. I ran `--write` only on `entries.unfiledSceneCount.int.test.ts` and `scenes.summaryReview.int.test.ts`.
- A model that returns an empty name gives `result.name === ""`, which `??` does not replace, so the draft name would be blank (Apply then reads blank as "make the automatic name"; harmless but the review modal shows an empty name). Brief specified `??`.
- `entries.ts` `listEntryRows` is also reached by `buildEntriesList`; the relay to book readers goes through the same function, so readers get the count too.
