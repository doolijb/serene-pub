# BRIEF — `time-t7d-fix-w2`: History's printed rows (fix 2), the delta never negative (fix 3), the unplaced current date (fix 4), the render-time guard floors (fix 6)

Supervisor: lane `time-t7d-fix`. App `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`.
Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build`: worker `w1` or the supervisor does. Your SDK edits are comments only, so you need no build.)

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo; never `kill -9`; no
migration, no boot pass. Comments state the rule, not the story. No other product's name in any file.
`shared/lorebooks/*` runs in the browser too: no `crypto.randomUUID`, no `navigator.clipboard`. Worker `w1`
edits `templateCheck.ts`, `template.ts`, `templateFit.ts`, the SDK guides, `templateValidation*.ts`,
`templateDiagnostics.ts`, `contextConfigCards.ts`, `sockets/pipelines.ts` and the template editor at the same
time, and a peer session shares the checkout: touch **only** the files below. Do not edit `NOMENCLATURE.md`
(the supervisor does).

## One run at a time (the whole lane shares one machine)

Before **every** test run or `tsc`, wait for the machine to be free:
`timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest|tsx --test|tsc -p tsconfig.build|svelte-check|npm run (sdk:)?build" | grep -v grep >/dev/null; do sleep 10; done'`
then run, capped, from the app root:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t7d-fix-w2.log 2>&1"`
Never pipe vitest into `head`. Note `ls -d /tmp/serene-pub-vitest-*` before and after; remove by name only the
ones your run created.

## Rulings in force (quote, don't reinterpret)

- Owner 2026-11-15: "The context template and variable layouts decide how to represent the data, nothing should
  be handed down flat." · "Context/variable layouts are what determine how/where it's printed."
- Lane design: "`{{formatDate date}}` prints, from the value alone, what the shipped current-date layout prints
  for the same parts" — the row's date and the present stay in one format. "The value carries everything needed
  to print it: a layout has no calendar in scope."
- Standing: `compareDates` is the ordering; story time only, never the wall clock; same inputs, same result.

## Fix 2 — History prints escaped row objects, like Earlier scenes

`src/lib/server/pipelines/entities/variableLayouts.ts` ~374–413 (`historyEntries`, `historyJson`; the shipped
row ~882–895, wrapper "Story history:" unchanged). Today each row is a hand-quoted key, so a calendar name
holding `"` or `\` prints invalid JSON, and two rows on one date print two identical keys; the comment ~385–389
states that breakage as the rule. Replace with a JSON list, newest first (the value's order), each row:

`{"date":<formatDate date as a JSON string>,"dateDelta":"<formatDateDelta dateDelta>" (only when dateDelta is set),"content":<content as JSON>}`

- Handlebars, modelled on `earlierSceneEntries` (~527): `{"date":{{{jsonValue (formatDate date) indent=0}}}{{#if dateDelta}},"dateDelta":"{{{formatDateDelta dateDelta}}}"{{/if}},"content":{{{jsonValue content indent=0}}}}` per row, `[` … `]`, comma between rows (check the subexpression renders; if `jsonValue` cannot take one, say so and propose the nearest form).
- Floor `historyJson`: `JSON.stringify` of the rows mapped to `{ date: storyDateText(r.date), ...(r.dateDelta ? { dateDelta: storyDateDeltaText(r.dateDelta) } : {}), content: r.content }`; `""` for anything but a non-empty list (the absence rule). Template and floor must agree byte for byte (`variableTemplates.parity.test.ts` holds them to it); state what a row with `date: null` prints in both.
- Rewrite the doc comment: the rule (escaped, one object per row, two rows on one date are two objects), not the history.
- Liquid twin `HISTORY_LIQUID` in `src/lib/server/pipelines/prompt/liquidParity.fixtures.ts` ~241: the same bytes (`{{ row.date | formatDate | jsonValue: indent: 0 }}` …).
- Tests (in `variableLayouts.datedRows.test.ts` and wherever History's printed text is pinned — grep the
  tests for `Story history` and `formatDate date`): a calendar name containing `"` and `\` prints valid JSON
  (`JSON.parse` the output) in both engines and the floor; two rows on one date are two objects; newest first;
  the delta present only when set.
- **Before / after**: render the shipped wrapped History for (a) a free-form book, clock set, two rows on one
  date, one row a year earlier; (b) a calendar book; and put both outputs, before and after, in your report.

## Fix 3 — the delta never has a negative part

`src/lib/shared/lorebooks/storySpan.ts` `storyDateDeltaOf` (~38–117). Under a declared calendar a date that does
not land (example row `{ year: 412, month: 1, day: 200 }` against now `{ year: 412, month: 2, day: 1 }`,
calendar of four months) borrows month lengths until the month part goes below what one `+ months.length`
repays. Build:
- when a calendar is given and **either** date fails `storyTimeProblem(date, calendar)` (the check
  `storyDateValueOf` uses, `storyDate.ts` ~280; import it the way `storyDate.ts` does), use the free-form rule
  (as if `calendar` were null) for the whole delta;
- loop the month borrow (`while (v < 0) { v += months.length; parent -= 1 }`) as the day borrow already does.
- Update the header comment (~1–23) to state both rules.
- Property-style test in `storySpan.test.ts`: a fixed, deterministic spread (no `Math.random`; nested loops or a
  seeded generator) of dates — year only, year-month, full, with a time, mixed precision, landing and not
  landing — against free-form, a four-month calendar with month lengths and a leap rule, and a twelve-month
  one: no part is ever negative (`year`, `month`, `day`, `time.hour`, `time.minute`), and `sign` equals the sign
  of `compareDates` of the two dates cut to the parts both carry. Keep the existing tests green.

## Fix 4 — the current date that does not land prints what it printed before

Before the lane, under a declared calendar the current date printed `formatStoryTime(time, calendar)`, which
for a date the calendar cannot place is the free-form fallback `Year 412, Mo. 13, Day 5` (and `, 22:30` with a
clock; SDK `sdk/src/storyTime.ts` ~219–233). Now it prints `412-13-05`. Restore those bytes, keeping "the value
carries everything" (supervisor's decision on the mechanism):
- `src/lib/shared/lorebooks/storyDate.ts` `storyDateValueOf` (~276): under a declared calendar, a date that does
  not land gets `year.name = "Year <year>"` (formatStoryTime's fallback year spelling, `Math.trunc`) and no
  month or day names. A landing date and a free-form book are unchanged.
- `src/lib/shared/lorebooks/storyDateText.ts` `storyDateText`: a named year with a month present but **unnamed**
  prints formatStoryTime's fallback exactly: `${year.name}`, then `, Mo. ${m}` when the month number is
  non-zero, `, Day ${d}` when the day number is non-zero, then the clock as `, HH:MM`. Every other case is
  unchanged. The shipped current-date layout and its floor already route a named year through `formatDate` /
  `storyDateText`, so they follow; History and Earlier-scenes rows for such a date print the same text (one
  format with the present).
- Update the doc comments: `storyDateValueOf`, the header of `storyDateText.ts`, and in the SDK
  `sdk/src/storyTime.ts` the `StoryDateValue` doc (~55–72; the `year` field's line) — comments only, no type or
  code change in the SDK.
- Tests: `storyDateValue.test.ts` (the value for an unplaced date, with and without a clock) and the current-date
  layout under a calendar for an unplaced date prints `Year 412, Mo. 13, Day 5` through the shipped layout
  (both engines) and the floor; a landing date and a free-form date print exactly as now.

## Fix 6 — a value that does not fit its variable falls back to the floor

`variableLayouts.ts` `renderVariable`, the scope guard ~1377–1394 writes the raw value with no wrapper. The lane
design said the variable "falls back to its floor". Build: on a mismatch, render the floor — the variable's
plain default rendering with its heading (`shippedByVariable.get(variableId)?.codeDefault(value)`, which wraps;
for a variable core ships nothing for, the same minified-JSON / written fallback `floor()` uses below). If the
floor throws or returns `""` for that value, print nothing. The receipt line (`report`) stays and says which
happened: rendered with its plain default instead of its layout, or nothing printed because the default could
not render it either. Keep the line's first half (variable, id, what it got, what it declares) and the
"should hand down the declared shape" sentence. Update the `report` parameter's doc (~1366–1370) and the guard
comment. Tests: a flat string handed to History prints nothing and the receipt says so; a value the floor can
render (find a variable whose floor renders a mismatched kind, or a plugin variable) prints the floor with its
heading and the receipt says so.

## Docs (follow fix 2, and fix 4 where they state the printed form)

`docs/context-templates.md` (~277, ~300, ~391 "each headed by its date"), `docs/lorebook-time.md` (grep
`History` / `412-03`), and `../serene-pub-sdk/INTEGRATING.md` §1p (~1535; grep within it for History's printed
form): History prints a JSON list of `{"date", "dateDelta" (when set), "content"}`, newest first; show one
example row. Where a doc states `formatDate`'s output, add the unplaced-date case in one clause. Also fix the
sentence at `docs/context-templates.md` that says a value that does not fit "is written as it came" if one
exists (grep), to the floor behaviour.

## Files owned

App: `src/lib/server/pipelines/entities/variableLayouts.ts`, `variableLayouts.datedRows.test.ts`,
`variableTemplates.parity.test.ts` (only if a fixture needs a new case), `src/lib/server/pipelines/prompt/liquidParity.fixtures.ts`,
`liquidParity.test.ts` (only if needed), `assemble.test.ts` / `assembleExplicitLayouts.test.ts` (only where
History's text is pinned), `src/lib/shared/lorebooks/storySpan.ts`, `storySpan.test.ts`, `storyDate.ts`
(`storyDateValueOf` only), `storyDateValue.test.ts`, `storyDateText.ts`, `docs/context-templates.md`,
`docs/lorebook-time.md`. SDK: `INTEGRATING.md` (§1p, and any History printed-form line elsewhere in it),
`sdk/src/storyTime.ts` (the `StoryDateValue` doc comment only).

## Out of scope

The delta's printed form (★T7D-1), the free-form borrowing rule itself (★T7D-2), Earlier scenes' layout, the
explicit-layout pre-pass's missing `report`, `earlierCost`, any other variable. Note findings under **Noticed, not done**.

## Stop and ask (in your report) when

A new name, setting or type field seems needed; `jsonValue` cannot print a subexpression; a test outside your
files pins History's text; the floor cannot be told apart from "printed nothing" without a new signal.

## Done means

`npx vitest run --maxWorkers=3 src/lib/server/pipelines/entities/variableLayouts.datedRows.test.ts src/lib/server/pipelines/entities/variableTemplates.parity.test.ts src/lib/server/pipelines/prompt/liquidParity.test.ts src/lib/shared/lorebooks/storySpan.test.ts src/lib/shared/lorebooks/storyDateValue.test.ts src/lib/shared/lorebooks/storyDate.test.ts src/lib/server/pipelines/prompt/assemble.test.ts src/lib/server/pipelines/prompt/assembleExplicitLayouts.test.ts`
green (capped form, one run at a time), plus any other test you find pinning History's text;
`npx prettier --check` on every file you touched.

## Report (final message, under about 500 words)

Each fix with file:line; fix 2's before / after outputs verbatim; tests run with results; anything not done;
**Noticed, not done**.
