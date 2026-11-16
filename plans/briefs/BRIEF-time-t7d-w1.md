# BRIEF — `time-t7d-w1`: SDK declarations for dated rows (types, scopes, calendar variable, contracts, guides)

Supervisor: lane `time-t7d`. SDK repo `/home/jody/github/serene-pub-sdk` (edit it there). App repo
`/home/jody/github/serene-pub` (read only for you, except nothing). Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build` at all: the supervisor does.)

Also: never `git checkout / restore / stash` in `../serene-pub-sdk` (most of it is uncommitted). Never
`prettier --write`. No migration. Comments state the rule, not the story. No other product's name in any
file. A peer session and a reviewer share this checkout and another worker edits the app at the same time:
touch only the files below.

## Owner rulings, 2026-11-15 (his words; they govern everything here)

- "dates returned via SDK should be something like: type date: {year: {number:int, name:string?}, month:
  {number:int, name:string?}, {day: {number:inst, name:string?}, time: {hour:int, minute:int} So if an scene for
  example might have something like {...., date, dateDelta}, we don't have to rename it for every fucking
  different row type. The variable layouts should be per parent object/array"
- "Use the time delta in the same year month day time format … Context/variable layouts are what determine
  how/where it's printed." · "Lets not bother adding the delta value to the returned results for now, just
  scenes/history entries" · "lets try to match the internal variable names as close as possible and make sure we
  standardize."
- "The context template and variable layouts decide how to represent the data, nothing should be handed down
  flat. A custom node could flatten data, but it should be highly discouraged in the documentation …"
- "Lets also make sure the SDK can pass down the lorebooks calendar structure in case someone wants to render
  that in as additional context."
- "Break existing custom layouts, we are in pre-release, we don't care."
- Standing: no magic in core for pipeline data (core supplies values and helpers; a layout prints); Decay never
  puts text in a prompt; `compareStoryTimes` is the ordering; no `@2` bumps before 0.7 (additive changes in place).

NOMENCLATURE R1 one word one meaning; R3 qualify; R6 mark provisional names 🚧. Every name below is 🚧 and
`@experimental`. Do not invent any other exported name; if you need one, stop and say so in your report.

## Goal — exactly these changes

### 1. Types (`sdk/src/storyTime.ts`, beside `StoryTime`; exported through the existing `export *`)

```ts
/** 🚧 One part of a date value: its number, and the calendar's name for it when the calendar names one. @experimental */
export interface StoryDatePart { number: number; name?: string }
/** 🚧 A story date as a layout reads it (owner 2026-11-15) … @experimental */
export interface StoryDateValue {
  year: StoryDatePart            // name: the era-spelled year (`Year 412 AR`), only under a declared calendar
  month: StoryDatePart | null    // name: the month's name
  day: StoryDatePart | null      // name: the weekday
  time: { hour: number; minute: number } | null
}
/** 🚧 How far a row's date is from the session's current date: row minus now. @experimental */
export interface StoryDateDelta {
  sign: -1 | 0 | 1
  year: number                   // non-negative magnitudes; a part is null where it was not compared or
  month: number | null           // could not be known, never 0 for "unknown"
  day: number | null
  time: { hour: number; minute: number } | null
}
```
Doc comments state: names come only from the lorebook's calendar and are absent where it names nothing
(free-form: no names); the value carries everything needed to print it (a layout has no calendar); a delta
has no names (a month name labels a position, not a length). Keep `StoryDatePart` only if you need it for the
two interfaces (you do); it is the one extra name allowed.

Also export the two **helper names** core registers in both template engines, beside `VARIABLE_LAYOUT_HELPER`
(find where that constant is declared and follow its pattern and file):
`export const FORMAT_DATE_HELPER = 'formatDate'` and `export const FORMAT_DATE_DELTA_HELPER = 'formatDateDelta'`,
each with a doc comment: what it prints, from the value alone; prints nothing for null or a value of the
wrong shape; named apart from the `date` / `dateDelta` fields because a Handlebars `{{date}}` inside a row
would call a helper named `date`, and Liquid already has a `date` filter.

### 2. Shared field constants (`sdk/src/variables.ts`, exported)

`export const STORY_DATE_FIELD: VarField` and `export const STORY_DATE_DELTA_FIELD: VarField` describing the
two interfaces as `VarField`s (`type: 'object'` with `fields`; `month`, `day`, `time` and every `name` are
`optional: true` — `checkValue` treats null as absent; the delta's `month`, `day`, `time` optional, `sign` and
`year` not). Every field gets a one-line English `description`. These are object field constants, **not** a new
member of the `VarType` union (do not touch `VarType`).

### 3. The three variables (`sdk/src/variables.ts`)

- **`varHistory`** (`core:var/history@1`): scope becomes ONE root,
  `history: { type: 'list', of: { type: 'object', fields: { date: {...STORY_DATE_FIELD, optional: true, description}, dateDelta: {...STORY_DATE_DELTA_FIELD, optional: true, description}, content: { type: 'string', description } } } }`.
  Remove the `relativeDate` root entirely. Description: history entries that fit the budget, newest first, each
  with its date and its distance from the story's current date (fix the old "from the chat" wording: say
  "from the story"). `dateDelta` description: absent with no current date set, with the Timeline off, or when
  the present is only the newest history entry. History rows carry no time of day (say so on `date`). Sample: two
  free-form rows (no names; one book has one calendar), newest first: one with a `dateDelta`, one with
  `dateDelta: null` (null on an optional field passes `checkValue`).
- **`varEarlierScenes`** (`core:var/earlier-scenes@1`): rows gain `date` (optional; the scene's opened clock,
  day and time; absent when the scene was opened with no clock) and `dateDelta` (optional, same absence rules as
  History's). Keep `name` and `summary` first. Sample rows gain both.
- **`varCurrentDate`** (`core:var/current-date@1`): scope becomes `currentDate: { ...STORY_DATE_FIELD, description }`.
  The old flat fields (`year`, `month`, `day`, `hour`, `minute`, `label`) go. Rewrite the ⚠ doc comment: the
  value is the same date value every dated row carries, so a layout prints all of them one way; the calendar's
  spelling is reached through the names. Sample: `{ year: { number: 412 }, month: { number: 3 }, day: { number: 5 }, time: null }`.

### 4. The calendar variable (new, `sdk/src/variables.ts`)

`export const varStoryCalendar = defineVariable({ id: 'core:var/story-calendar@1', i18n: { name: { en: 'Story calendar' } }, … })`
— key `storyCalendar` (matches the internal `StoryCalendar` / `lorebooks.story_calendar`). Description: the
session's lorebook calendar, for a template that wants to tell the model how the calendar runs; absent for a
free-form book. Scope `storyCalendar: { type: 'object', fields: { months: list of { name: string, days: number },
weekdays: optional list of string, firstWeekday: optional number, yearLabel: optional string, leap: optional
object { every: number, month: number }, eras: optional list of { name: string, start: optional number,
backwards: optional boolean } } }`. The day's periods and seasons are NOT declared (their labels are I18n,
which a VarField cannot type); say so in the doc comment. Sample: a short calendar (three or four months,
weekdays, one era). Mark `@experimental` and 🚧 in the comment. Check §24: grep `storyCalendar` and
`story-calendar` across `/home/jody/github/serene-pub/src` and the SDK first; report any collision.

### 5. The cast read's story time, typed (`sdk/src/participants.ts`, `SessionCastV1`)

Add `storyTime?: { now: (StoryTime & { from: 'clock' | 'history' | 'session' }) | null; calendar: StoryCalendar | null } | null`
with a doc comment: the session's story present (the session's clock, else its line's clock, else its newest
history entry, `from` says which) and the lorebook's declared calendar (`null` = free-form); absent without a
book. (Host fact: `src/lib/server/pipelines/runtime/host.ts` ~6285–6301, `state/storyTime.ts` `StoryNow` ~76–89;
`now.label` is also set by the host — include `label?: string` on `now`.)

### 6. Contracts (`contracts/src/tasks.ts`, `contracts/src/queries.ts`)

- `core:task/assemble@2`: in `ASSEMBLE_TEMPLATE_SCOPE` (~1191) add `storyCalendar: { type: 'string', optional: true, description: 'The lorebook’s calendar, laid out — absent for a free-form book.' }`
  after `currentDate`; in its `renders` (~1339–1341) add `storyCalendar: 'core:var/story-calendar@1'`. Update the
  `history` description if it says "keyed" anywhere. No new port.
- `core:query/earlier-scenes@1` doc comment (~1513–1538): each scene in `main.scenes` gains
  `openedStoryClock: { year, month, day, hour, minute } | null` — the session's story clock when the scene opened
  (columns `opened_story_clock_*`), `null` when it opened with no clock. Words only; the port stays `S.json`.

### 7. Guides and INTEGRATING

- `INTEGRATING.md` §1p: replace the bullet **"A dated layout value: `relativeDate`"** (~1579–1585) with a bullet
  **"Dates in a layout: `date` and `dateDelta`"** saying: `StoryDateValue` / `StoryDateDelta`; History is a list of
  `{ date, dateDelta, content }` newest first (`undefined` when empty), Earlier scenes rows carry both, the current
  date is the same date value, the delta is row minus the session's current date (only parts both carry; with a
  declared calendar exact, borrowing by month lengths; free-form, where a part would have to borrow, one is taken
  from the coarser part and that part's finer parts are null); `null` with no current date, Timeline off, a present
  borrowed from the newest history entry, or a row with no date; the helpers `formatDate` / `formatDateDelta`
  (`FORMAT_DATE_HELPER`, `FORMAT_DATE_DELTA_HELPER`) are core's in both engines; `core:var/story-calendar@1`
  (`storyCalendar`) is laid out by Assemble from the cast read's `storyTime.calendar`, no shipped template prints
  it; a saved custom layout written for the old keyed History is not migrated (it renders wrong, not an error,
  and the layout check warns). Also add one bullet: **a value that does not fit its variable's declared scope**
  (a node handing down a flat string for a list) is not rendered through the layout: the host writes it with the
  variable's floor and the run's receipt names the variable and why; flattening a value in a node is strongly
  discouraged, because the layouts that variable offers are written for its declared shape.
- `guides/time.md`: add a section **"Dates in a prompt layout"** before "Not yet built": the date value and the
  delta (shape, when null), `{{formatDate date}}` / `{{formatDateDelta dateDelta}}` with one Handlebars and one
  Liquid line (`{{ date | formatDate }}`), what `formatDate` prints (the calendar's spelling when the value carries
  names; else `412-03-05`, `412-03`, `Year 412` for a year alone; a time of day after a date as ` 22:30`, or
  `, 22:30` in the calendar's spelling) and what `formatDateDelta` prints (🚧 `-0y 2m 3d`: the sign, then year,
  month and day, then `4h 5min` when a time was compared; parts that are null are left out; `+` for a future date,
  no sign at zero). No `js recipe` fence unless you also add it to the app's recipe list (you cannot: do not add one).
- `guides/where-values-come-from.md` (or `extending.md`, whichever describes a node's `renders` / variable
  layouts — read both, pick one): one short paragraph "Don't flatten a variable in a node", the why, and what the
  host does (the floor plus a receipt line).

## Files owned (only these)

SDK: `sdk/src/storyTime.ts`, `sdk/src/variables.ts`, the file holding `VARIABLE_LAYOUT_HELPER` (add the two
constants only), `sdk/src/participants.ts`, `contracts/src/tasks.ts`, `contracts/src/queries.ts`,
`INTEGRATING.md`, `guides/time.md`, `guides/where-values-come-from.md` or `guides/extending.md`, and SDK test
files under `sdk-tests/` that assert the old History / current-date shapes or variable samples.

## Files readable

Anything. In particular `sdk/src/template.ts` (`VarField`, `checkValue` ~624, `checkScopeSample`),
`sdk/src/variables.ts` `sampleValues` / `checkVariableSamples`.

## Out of scope

The template checker (`sdk/src/templateCheck.ts`): another worker. Any app file. `VarType`. Deltas on any other
variable. Relative words. Any migration. Version bumps.

## Stop and ask when

A name beyond those above seems needed; anything in `core-catalog/` or `cli/` reads the History record's keyed
shape, `relativeDate`, or the current date's flat fields (grep `core-catalog/src`, `cli`, `conformance`); the
earlier-scenes or assemble contract change would move a port's shape.

## Done means

- `cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "npx tsx --test <files> > /home/jody/github/serene-pub/plans/time-t7d-w1.log 2>&1"`
  on the test files that cover variables / samples / contracts you touched (find them with grep: `checkVariableSamples`,
  `varHistory`, `current-date`, `earlier-scenes`, `assemble@2`). Before any run check
  `ps -eo pid,args | grep -E "node.*(vitest|tsx --test)" | grep -v grep`; if one is running, wait and do other work.
  Strictly one run at a time. Registry hash pins that move: re-pin with a `(was <old>)` note.
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit -p .` (typecheck) — report its result.
- Report: changed files; every exported name added or removed; tests run with results; anything you did not do.
