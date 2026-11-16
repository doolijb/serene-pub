# BRIEF — `time-t7d-w5`: Assemble hands dated rows to the layouts; scenes carry their opened clock (app)

Supervisor: lane `time-t7d`. App repo `/home/jody/github/serene-pub`. Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build`: the supervisor does.)

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo. No migration. Inside
`db.transaction(async (tx) => …)` use only `tx`. Comments state the rule, not the story. No other product's
name in any file. Another worker (`w3`) edits `entities/variableLayouts.ts`, the template helpers, `preview.ts`,
`templateContext.ts`, `variableLayoutsView.ts`, `contextConfigCards.ts`, `liquidParity.fixtures.ts` and their
tests at the same time — do not touch those. The previous lane just changed `runtime/bindings.ts` and
`sessions/firsthandFilter.ts`: build on the tree as it is. A peer session shares this checkout.

## Owner rulings, 2026-11-15 (his words)

- "dates returned via SDK should be something like: type date: {year: {number:int, name:string?}, month:
  {number:int, name:string?}, {day: {number:inst, name:string?}, time: {hour:int, minute:int} So if an scene for
  example might have something like {...., date, dateDelta}, we don't have to rename it for every fucking
  different row type."
- "Use the time delta in the same year month day time format … Context/variable layouts are what determine
  how/where it's printed." · "Lets not bother adding the delta value to the returned results for now, just
  scenes/history entries" · "lets try to match the internal variable names as close as possible and make sure we
  standardize."
- "The context template and variable layouts decide how to represent the data, nothing should be handed down flat."
- "Lets also make sure the SDK can pass down the lorebooks calendar structure in case someone wants to render
  that in as additional context."
- Standing: Decay never puts text in a prompt; no magic in core for pipeline data (core supplies values; a
  layout prints); `compareDates` is the ordering; story time only, never the wall clock.

## Already built (SDK dist rebuilt 21:25; app shared modules)

- SDK types `StoryDateValue` / `StoryDateDelta` (`@serene-pub/sdk`). `core:var/history@1` = one root
  `history: list of { date?, dateDelta?, content }`; `core:var/earlier-scenes@1` rows `{ name, summary, date?,
  dateDelta? }`; `core:var/current-date@1` `currentDate` = a `StoryDateValue`; new `core:var/story-calendar@1`
  (key `storyCalendar`, the `StoryCalendar` object) which Assemble's contract now `renders`.
- `src/lib/shared/lorebooks/storyDate.ts`: `storyDateValueOf(time: StoryClock, calendar: StoryCalendar | null): StoryDateValue`
  (names only under a declared calendar when the date lands).
- `src/lib/shared/lorebooks/storySpan.ts`: `storyDateDeltaOf(date, now, calendar): StoryDateDelta | null` (row
  minus now). `relativeDateWords` and the other span words are GONE (assemble.ts still imports it: you remove that).
- w3 is changing, in parallel: `renderVariable(layouts, key, value, run?, report?: (line: string) => void)` —
  the 5th parameter `siblings` becomes `report` (a render-time scope guard calls it with one receipt line when a
  value does not fit its variable's declared root kind); `prepareExplicitLayouts` loses its `siblingsOf` input;
  `RELATIVE_DATE_ROOT` is removed; the shipped History / Earlier scenes / Current date / Story calendar layouts
  read the new shapes. Code against that interface.

## Goal — `src/lib/server/pipelines/prompt/assemble.ts`

1. **History becomes a list of rows.** For core's History (an entry type with an `order` role and no title):
   rows `{ date, dateDelta, content }`, newest first by the declared order exactly as `sortByOrder` sorts today,
   blank-after-trim content skipped as today, **`undefined` (never `[]`) when there is none**. `date` =
   `storyDateValueOf({ year, month, day }, calendar)` from the allocation's order meta (`orderMeta`; history rows
   carry no time, so `time` is null), `null` when the allocation has no order meta. `dateDelta` =
   `storyDateDeltaOf(rowParts, nowParts, calendar)`, and `null` when: there is no story time; `storyTime.now` is
   null (no book present, or the Timeline is off — verify in `state/storyTime.ts` ~264–283 that a book with the
   Timeline off yields a null now, and say so); `now.from === "history"` (the present was borrowed from the newest
   History day); or the row has no date. `calendar` and `now` come from `input.templateContext.storyTime`
   (`{ now, calendar }`, as `relativeDatesOf` reads them today). The titled projection (world lore) is unchanged.
   Remove `relativeDatesOf`, the History `siblings` plumbing (`siblingsByKey`, `siblings:` in `bandValue`, the
   `layout()` third parameter, `siblingsOf` in the `prepareExplicitLayouts` call, the `RELATIVE_DATE_ROOT`
   import), and `orderKeyOf` / `partName` / `distinctKey` / `orderedEntries` if nothing else needs them. Restructure
   `objectByRole` / `bandObjectOf` as you judge best (internal names are yours; `objectByRole` is exported only
   for its test): the ordered projection now yields rows, the titled one the keyed record. Update the doc
   comments to state the rule.
2. **Earlier scenes rows** `{ name, summary, date, dateDelta }`: `RenderInput.earlierScenes` entries gain
   `openedStoryClock?: StoryClock | null` (the scene's story clock when it opened); `date` =
   `storyDateValueOf(openedStoryClock, calendar)` (day and time), `null` without one; `dateDelta` by the same rule
   and the same now as History.
3. **The current date adopts the date value.** `currentDateOf` returns `storyDateValueOf(parts, calendar)` —
   the story's now with its hour/minute when it has them (minute defaulting 0 beside an hour, as today), else the
   newest allocated History entry's parts as today — and no `label` (the names carry the calendar's spelling).
   `undefined` exactly when it is today. (w3's shipped layout prints it byte-identically.)
4. **The calendar reaches a template.** Lay out `storyCalendar` like `currentDate`:
   `layout("storyCalendar", storyTime?.calendar ?? undefined)` (free-form → absent → renders nothing), put it on
   the render context, and add `"storyCalendar"` wherever `"currentDate"` / `"earlierScenes"` are listed as laid-out
   keys (the explicit-layout `inUse` lookup ~1044, the `laidOutSafeFor` key list ~1072, the list ~1234). No shipped
   template prints it.
5. **The guard's receipt line.** Pass a `report` to every `renderVariable` call `layout()` makes that pushes the
   line onto the `notes` this render returns (`RenderedContext.notes`, ~1157–1242: absent when empty, as now).

## Goal — the scene's opened clock reaches Assemble

- `src/lib/server/scenes/earlierScenes.ts`: `EarlierScene` gains `openedStoryClock: StoryClock | null` — the
  scene's `opened_story_clock_*` columns (select them in the second query; build with `sceneClockOf(row, "opened")`
  from `scenes/liveScenes.ts`, already imported dynamically there, or the same rule inline: null when the year is
  null). Doc comment updated.
- `src/lib/server/pipelines/runtime/bindings.ts`: the earlier-scenes query handler (~8837–8887) returns it
  unchanged in `main.scenes`; Assemble's port parse (~6250–6276) keeps a well-formed `openedStoryClock` (an object
  with a finite numeric `year`; month/day/hour/minute numbers or null) and reads anything else as `null` — never
  drops the scene for it; `renderWith` (~6307) passes `openedStoryClock` through with `name` and `summary`. The
  budget cost (`earlierCost`) stays on `name` + `summary`.

## Tests

- Replace `src/lib/server/pipelines/prompt/relativeDate.test.ts` with `datedRows.test.ts`: render through
  `render()` (or the narrowest exported function that runs the History / Earlier scenes / current-date
  production) with **explicit JSON layouts** (`{{{json history 0}}}`, `{{{json earlierScenes 0}}}`,
  `{{{json currentDate 0}}}`, `{{{json storyCalendar 0}}}` — selected through `input.variables`, so the test does not
  depend on w3's shipped layouts) and assert the values: History rows newest first with `date` and `dateDelta`;
  an empty History is `undefined` (the key renders nothing); a free-form book has no names, a calendar book has
  them; `dateDelta` null with no storyTime, with `now: null`, with `now.from === "history"`; Earlier scenes rows
  with a clock and without; the current date as a `StoryDateValue` with and without a time; `storyCalendar`
  present under a calendar and absent free-form; a flat string handed to `history` (a node flattening it: feed the
  value through `input.variables` / the path a declared band takes, whichever reaches `renderVariable` with a
  string) puts w3's guard line in `notes` — if that path cannot be reached from `render()`, say so.
- Update `assemble.test.ts` (`objectByRole` / ordered projection cases), `earlierScenes.int.test.ts`,
  `runtime/earlierScenesQuery.int.test.ts`, `runtime/assembleTranscriptFit.int.test.ts` and
  `currentDate.storyTime.test.ts` for the new shapes. **Byte-identity:** `currentDate.storyTime.test.ts`'s
  expected printed strings must NOT change (only its inputs/fixtures may); if one would have to change, stop and
  report.
- Tests that assert the shipped History / Earlier scenes text depend on w3: run them, and if they fail only for
  w3's pending layouts, list them with the reason rather than editing w3's files.

## Files owned (only these)

`src/lib/server/pipelines/prompt/assemble.ts`, `src/lib/server/scenes/earlierScenes.ts`,
`src/lib/server/pipelines/runtime/bindings.ts` (only the two regions above), and the tests named above (plus the
new `datedRows.test.ts`). Any other test file that fails because it builds the old History record or the flat
current date through `render()`: you may update it, and list it.

## Out of scope

w3's files. The SDK. Docs, NOMENCLATURE. Deltas on any other variable (lore entries etc.). Relative words. Any
migration. `host.ts` (the cast read already carries `storyTime`).

## Stop and ask when

A shipped genre or plugin reads the History record's keyed shape or the current date's flat fields anywhere
but a layout (grep `src/` and `../serene-pub-sdk/core-catalog/src`); the current date cannot stay byte-identical;
the Timeline-off case does not yield a null now; a stored value needs rewriting.

## Done means

From the app root, strictly one run at a time (check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`
first; if one is running, do other work and check again — never start a second; never pipe vitest into `head`;
int tests that open a DB inside an `it` need a 60 s timeout under load):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7d-w5.log 2>&1"`
over the tests above plus `prompt/assemble*.test.ts` and `prompt/cachePrefix.test.ts`. Report: changed files,
names added/removed (exported and the internal ones you removed), the Timeline-off finding, tests with counts,
failures attributed to w3's pending work with the reason, and anything not done.
