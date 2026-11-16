# BRIEF — `time-t7d-w2`: the date value, the delta and their printed forms (app, pure functions)

Supervisor: lane `time-t7d`. App repo `/home/jody/github/serene-pub`. Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not run `sdk:build`: the supervisor does.)

Also: never `prettier --write`; never `git checkout / restore / stash` in either repo. No migration. Comments
state the rule, not the story. No other product's name in any file. Browser-safe code (these modules are
shared with the client): no `crypto.randomUUID`, no `navigator.clipboard`. Another worker edits the SDK at the
same time (it adds the types below); a peer session shares this checkout: touch only your files.

## Owner rulings, 2026-11-15 (his words)

- "dates returned via SDK should be something like: type date: {year: {number:int, name:string?}, month:
  {number:int, name:string?}, {day: {number:inst, name:string?}, time: {hour:int, minute:int} …"
- "Use the time delta in the same year month day time format … Context/variable layouts are what determine
  how/where it's printed."
- Standing: no magic in core for pipeline data; `compareStoryTimes` / `compareDates` is the ordering; the wall
  clock is never read (story time only); same inputs, same result.

## The types (being added to the SDK right now by another worker; `import type` them from `@serene-pub/sdk`)

```ts
interface StoryDatePart { number: number; name?: string }
interface StoryDateValue { year: StoryDatePart; month: StoryDatePart | null; day: StoryDatePart | null;
                           time: { hour: number; minute: number } | null }
interface StoryDateDelta { sign: -1 | 0 | 1; year: number; month: number | null; day: number | null;
                           time: { hour: number; minute: number } | null }
```
Until the supervisor rebuilds the SDK, `tsc` will not see them: that is expected. Vitest erases `import type`,
so your tests run. Do not redeclare them locally.

## Goal

### 1. The value builder — `src/lib/shared/lorebooks/storyDate.ts` (additive)

`export function storyDateValueOf(time: StoryClock, calendar: StoryCalendar | null): StoryDateValue`
- `year.number = time.year`; `month` null when absent; `day` null when absent or when the month is absent;
  `time` = `{ hour, minute: minute ?? 0 }` when `hour` is set, else null.
- **Names only under a declared calendar and only when the date lands** (`storyTimeProblem(time, calendar) === null`,
  SDK). `year.name` = `formatStoryTime({ year }, calendar)` (the SDK's own year spelling: label + era, no clock);
  `month.name` = `calendar.months[month - 1].name`; `day.name` = the weekday — compute it with the SDK's exported
  `storyDayIndex(time, calendar)`: `weekdays[mod(index + (firstWeekday ?? 0), weekdays.length)]`, absent when the
  calendar has no weekdays or the index is null. A free-form book (`calendar` null) gives no names at all. Omit a
  `name` key rather than setting it undefined.

### 2. The printed forms — same file (or a new `src/lib/shared/lorebooks/storyDateText.ts` if storyDate.ts grows past ~320 lines)

`export function storyDateText(value: unknown): string` — what the `formatDate` helper will print:
- not an object with a numeric `year.number` → `""`.
- **calendar spelling** when `year.name` is a non-empty string (and, when `month` is set, `month.name` is too):
  clock = `time` ? `, HH:MM` : `""`; no month → `${year.name}${clock}`; no day → `${month.name}, ${year.name}${clock}`;
  else `${day.name ? `${day.name}, ` : ""}${day.number} ${month.name}, ${year.name}${clock}`. This must equal
  `formatStoryTime(time, calendar)` (SDK) for every date that lands — test it over a calendar with weekdays,
  eras, a leap rule, with and without a time, and one with no weekdays.
- **numeric** otherwise: no month → `Year ${year.number}`; else `${year}-${pad2(month)}` then `-${pad2(day)}` when
  a day; then ` ${pad2(hour)}:${pad2(minute)}` when a time (also after `Year N`).
`export function storyDateDeltaText(delta: unknown): string` — what `formatDateDelta` prints (🚧, the owner rules
the form later): `""` for anything not an object with `sign` in {-1,0,1} and a numeric `year`. Else the parts
`${year}y`, `${month}m` (when not null), `${day}d` (when not null), `${hour}h ${minute}min` (when `time` not null),
joined by one space, the first prefixed `-` for sign −1, `+` for +1, nothing for 0. Examples: `-0y 2m 3d`,
`+1y 0m 0d`, `0y 0m 0d`, `-3y`, `-0y 0m 2d 3h 15min`.

### 3. The delta — `src/lib/shared/lorebooks/storySpan.ts` (rewrite)

Replace `storySpanBetween`, `storySpanWords`, `relativeDateWords` and the `StorySpan` / `bound` wording with
`export function storyDateDeltaOf(date: StoryClock | null | undefined, now: StoryClock | null | undefined, calendar: StoryCalendar | null): StoryDateDelta | null`.
First grep `/home/jody/github/serene-pub/src` for every importer of those names (today only
`pipelines/prompt/assemble.ts` and the tests): leave `assemble.ts` alone (another worker rewrites it next; it
will stop importing `relativeDateWords`) and report the importers you found. Rules (row date minus now):
- `null` when either is missing or has no numeric year.
- Compared parts: the year always; the month only when both carry one; the day only when both carry a month and
  a day; the time only when the day is compared and both carry an hour (minute defaults 0). A part not compared
  is `null` in the result, never `0`.
- `sign` = sign of `compareDates` over the compared parts only (time included when compared): −1 when the row
  is before now, +1 after, 0 equal. Magnitudes are `later − earlier`, part by part, non-negative after borrowing.
- Borrowing, finest first. **Minutes from hours and hours from days are always exact** (60 and 24). **Days from
  months**: with a declared calendar add the length of the month before the later date's month in the right year
  (`storyDaysInMonth`, SDK, leap day included; month 1 borrows from the previous year's last month); **months from
  years**: with a calendar add `calendar.months.length`. **Free-form** (calendar null), where a part would have to
  borrow from a coarser one: take one from the coarser part and set every part finer than that coarser part to
  `null` (known: at least that much). E.g. free-form Year 7 m11 → Year 8 m2: `{ year: 0, month: null, day: null }`;
  Year 7 m3 d20 → Year 7 m5 d5: `{ year: 0, month: 1, day: null }`; with a calendar the second is exact. A time
  that borrows from a free-form day whose day would itself need a month borrow cascades by the same rule.
- Keep the module header honest (a short rule statement, no history).

### 4. Tests

Rewrite `src/lib/shared/lorebooks/storySpan.test.ts` for the delta: past, future, zero, across a year, month
forward and day backward (calendar: exact; free-form: coarser part less one, finer parts null), mixed precision
(year-only against a full date: month and day null), times (exact borrow across midnight), a negative year, the
leap day under a leap rule, missing inputs → null. Add a storyDate test file (or extend the existing one; grep
`storyDate.test`) for `storyDateValueOf` (year-only, year-month, full, with a time; free-form and calendar; a date
that does not land under the calendar → no names; weekday absent without weekdays) and for `storyDateText` /
`storyDateDeltaText` (each example above; null and wrong types → `""`; the parity with `formatStoryTime`).

## Files owned (only these)

`src/lib/shared/lorebooks/storyDate.ts`, optionally new `src/lib/shared/lorebooks/storyDateText.ts`,
`src/lib/shared/lorebooks/storySpan.ts`, `src/lib/shared/lorebooks/storySpan.test.ts`, the storyDate test file(s).

## Out of scope

`assemble.ts` and every other caller; helper registration in the template engines (next round); the SDK;
docs; relative words of any kind.

## Stop and ask when

Another importer of the removed storySpan names exists outside `assemble.ts` and tests; a rule above
contradicts an existing test you cannot reconcile; you need a new exported name beyond the four above
(`storyDateValueOf`, `storyDateText`, `storyDateDeltaText`, `storyDateDeltaOf`).

## Done means

`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <your test files> > plans/time-t7d-w2.log 2>&1"`
from the app root, all green. Before any run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
if one is running, do other work and check again; never start a second. Never pipe vitest into `head`.
Report: changed files, exported names added and removed, the importers found, tests with counts.
