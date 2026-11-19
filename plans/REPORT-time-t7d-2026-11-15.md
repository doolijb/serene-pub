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

## Scope review and fix lane `time-t7d-fix` (2026-11-15)

Scope review: six findings; all fixed by the fix lane, each with a test.

1. `shape-mismatch` fires only in variable layouts: 🚧 `TemplateCheckOptions.variableLayout` (`sdk/src/template.ts`
   ~375; `templateCheck.ts` ~413; `templateFit.ts` ~506); app callers that check a layout pass it. Every shipped
   template and layout checks clean (tests).
2. History prints escaped row objects (was a regression: unescaped key; repeated keys). Before, free-form:
   `{"412-03-03 (-0y 0m 2d)":"Row 1.",…}`; after:
   `[{"date":"412-03-03","dateDelta":"-0y 0m 2d","content":"Row 1."},…]`. Calendar book:
   `[{"date":"Ashday, 3 Bloom, Year 412","dateDelta":"-0y 0m 2d","content":"Row 1."},…]`. ★ for the owner.
3. The delta never has a negative part: free-form rule when either date does not land; the month borrow loops;
   ~11k date pairs checked.
4. A current date the calendar cannot place prints `Year 412, Mo. 13, Day 5` again (`storyDate.ts` ~295).
5. SDK guides updated (`time.md`, `writing-lore-from-a-pipeline.md`; the sample is `Now: {{{currentDate}}}`
   because a laid-out key is already text in a context template).
6. The render-time guard prints the variable's floor with its heading, or nothing, and the receipt says which.

Lane's runs: `sdk:test` the four known failures; app 15 files 655/655; editor dom tests 29/29; `tsc` 0;
`npm run check` 0 errors.

Open ★: History's printed form; `HistoryRow` names three things; the option name `variableLayout`.
Noticed, not done: `parity/goldens/session__history-entries.txt` line 30 holds the keyed History format;
`liquidParity.test.ts` ~61 has a stale input string.

## Grouped verification (lead, 2026-11-16)

- Full vitest run 9 (`plans/lead-full9.log`): 2,514 files, 25 failed. 21 are the standing baseline; the 4 new ones were pinned expectations that the two lanes moved on purpose (`openRenders.test.ts`: Assemble renders `storyCalendar`; `receipts.int.test.ts` and `pipelines.scoping.int.test.ts`: Story places `gather.unknownEntries.read`; `parity/harness.int.test.ts`: History prints as rows). The lead updated the four expectations; rerun of those files: 58/58 (`plans/lead-run9-fix.log`).
- `npm run build`: exit 0. `tsc --noEmit`: 0 errors. `npm run check`: 0 errors, 9 warnings (standing).
