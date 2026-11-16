# REPORT — lane `time-t7d` (2026-11-15): History and Earlier scenes rows carry `date` and `dateDelta`

Saved by the lead from the supervisor's report (condensed). No migration, no boot pass.

## Inventory

History value was built in `prompt/assemble.ts` (`objectByRole` / `orderedEntries` / `orderKeyOf` ~229–335,
`relativeDatesOf` ~348); layout in `entities/variableLayouts.ts` ~376–421, ~835; readers `preview.ts` ~150,
`variableLayoutsView.ts` ~668, `contextConfigCards.ts` ~386. No plugin or catalogue pipeline read the keyed
shape. Earlier scenes: `scenes/earlierScenes.ts` → `bindings.ts` ~8837 → Assemble ~6250–6307; a scene's date is
`opened_story_clock_*`. Current date: only layouts read its flat shape. Calendar: `host.ts` ~6285 →
`templateContext.storyTime`. At render only syntax errors and unregistered helpers throw.

## Names (all 🚧)

SDK: `StoryDatePart`, `StoryDateValue`, `StoryDateDelta`, `FORMAT_DATE_HELPER`, `FORMAT_DATE_DELTA_HELPER`,
`STORY_DATE_FIELD`, `STORY_DATE_DELTA_FIELD`, `varStoryCalendar` (`core:var/story-calendar@1`, `storyCalendar`),
typed `SessionCastV1.storyTime`, `openedStoryClock` on the earlier-scenes rows, finding kind `shape-mismatch`
(warning). App: `storyDateValueOf`, `storyDateText`, `storyDateDeltaText`, `storyDateDeltaOf`, `HistoryRow`, the
calendar layout row **Parts**, `renderVariable`'s `report` callback. Removed: `relativeDate`,
`RELATIVE_DATE_ROOT`, `relativeDateWords`, `storySpanBetween`, `storySpanWords`, `StorySpan`, the sibling
plumbing, assemble's `orderKeyOf` / `distinctKey` / `orderedEntries`.

## What prints

`formatDateDelta`: `-0y 2m 3d`, `+1y 0m 0d`, `0y 0m 0d`, `-0y 0m 2d 3h 15min`; null parts omitted.

| Case | Before | After |
|---|---|---|
| Free-form, clock set | `412-03-03 (2 days ago)` | `412-03-03 (-0y 0m 2d)` |
| Year only | `Year 409` | `Year 409 (-3y)` |
| No clock | bare date | unchanged |
| Calendar book | `412-03-03` | `Moonday, 3 Thaw, Year 412 AR (-0y 0m 2d)` |
| Two entries on one date | `412-03-05`, `412-03-05 (2)` | `412-03-05` twice |

Earlier scenes: `{"name":…,"dateDelta":"-0y 0m 3d","summary":…}`. Current date: byte-identical.
An old-shape History layout renders wrong without throwing and its page warns; upgrade note in
`docs/context-templates.md`.

## Changed files

SDK: `sdk/src/storyTime.ts`, `variables.ts`, `variableLayouts.ts`, `participants.ts`, `template.ts`,
`templateCheck.ts`, `contracts/src/tasks.ts`, `queries.ts`, `INTEGRATING.md`, `guides/time.md`,
`guides/extending.md`, tests. App: `shared/lorebooks/storyDate.ts`, `storyDateText.ts` (new), `storySpan.ts`,
`shared/utils/contextHandlebarsHelpers.ts`, `contextLiquid.ts`, `templateCheckOptions.ts`, `templateAssist.ts`,
`templateVariableShelves.ts`, `contextConfigCards.ts`, `entities/variableLayouts.ts`, `prompt/assemble.ts`,
`preview.ts`, `liquidParity.fixtures.ts`, `config/variableLayoutsView.ts`, `sockets/pipelines.ts`
(`validateTemplateDraft`), `scenes/earlierScenes.ts`, `runtime/bindings.ts`, docs, `NOMENCLATURE.md`, tests
(`registryHashes`: assemble@2 `13d026c54e7d85`, was `77b5ad64835be`).

## Verification (lane's)

`sdk:build` 21:25 and ~22:00. `sdk:test` 4773: the four known failures. App: 35 files, 915 pass after the
re-pin. `tsc` 0; `npm run check` 0 errors.

## Open ★

- ★T7D-1 the printed delta (`-0y 2m 3d`; alternatives `-0-02-03`, `-P0Y2M3D`).
- ★T7D-2 free-form borrowing (finer parts null; alternative a flag).
- ★T7D-3 Earlier scenes prints the delta as its own JSON member.
- ★T7D-4 History keys are not escaped (a calendar name with `"` breaks the key).
- ★T7D-5 two entries on one date give identical keys.
- ★T7D-6 names. ★T7D-7 the warnings' wording.

## Noticed, not done

- Possible bug in shipped templates: `core-catalog/src/genres/chat/respond.ts:142` and `shared/toolLoop.ts:113`
  print `{{{postHistory}}}` while the scope declares an object; now a `shape-mismatch` warning.
- The context builder (`templateContext.ts`) has no receipt channel for guard lines; the explicit-layout pre-pass
  passes no `report`.
- A plugin band with an `order` role and no title now gets dated rows.
- A current date that does not land on its calendar prints `412-13-05`.
- `earlierCost` does not count the delta (~8 tokens per scene).
