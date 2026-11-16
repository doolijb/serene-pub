# BRIEF — worker `time-t7b-w1` — how long ago an entry was last true (pure functions + table tests)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t7b`. Report back through your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build`: you edit no SDK file.)

Also: another session shares this checkout, so touch only the two files below. Never `git checkout` / `restore`. Never `kill -9`. No other product's name in any file. It is a *session*, never a *chat*.

## Goal

Two pure functions in one new module, with a table of tests. Nothing calls them yet (the supervisor wires them later); do not edit any other file.

### 1. `storySpanBetween(earlier, later, calendar)` and `storySpanWords(earlier, later, calendar)`

How much story time lies between two story dates, as the coarsest whole unit that is at least 1.

- Inputs: `earlier` and `later` are `StoryDate | null | undefined` (type from `$lib/shared/lorebooks/storyDate`: `year`, optional/nullable `month`, `day`, `hour`, `minute`); `calendar` is `StoryCalendar | null` (type from `@serene-pub/sdk`; null = free-form).
- `storySpanBetween` returns `{ count: number; unit: "years" | "months" | "days" } | null`. `storySpanWords` returns the words for it through the existing `clockSpanWords(count, unit)` (`$lib/shared/lorebooks/storyDate.ts` ~67: `"3 years"`, `"1 year"`, `"2 days"`), or null. The words carry no "ago": the layout writes that.
- **The rule (owner-reviewed, quote it in the module's header comment as the rule, not the story):**
  - null when either date is missing (no `year` number).
  - Compare the two dates part by part down to the finest part **both** carry: the year always; the month only when both have one; the day only when both have a month and a day. Hour and minute are never compared ("nothing under one day").
  - null when the compared parts are equal, or when `later` is before `earlier` (a clock moved back). Use the SDK comparator through `compareDates` (`storyDate.ts` ~88) on the truncated dates.
  - **Free-form (no calendar):** report the coarsest part that differs, and **never borrow**: Year 7 month 11 → Year 8 month 2 is `1 year`; same year, months differ → that many months (`5 months`; months can pass 12 in a free-form book: month 2 → month 14 is `12 months`); same year and month, days differ → that many days.
  - **A declared calendar:** subtract with borrowing as the calendar says: years, months, days = the differences of the compared parts; if days < 0, take one month and add the length of the month before `later`'s month (in the right year, leap day included: `storyDaysInMonth(year, month, calendar)` from `@serene-pub/sdk`; month 1's previous month is the last month of the year before); if months < 0, take one year and add `calendar.months.length`. Then report the coarsest non-zero unit. Year 7 month 11 → Year 8 month 2 in a 12-month calendar is `3 months`.
- Owner ruling 2026-11-13: a living entry's age in the prompt: "A time delta is better I think". Standing P1: same inputs, same result; story time only, never the wall clock (`Date.now()` must not appear).

### 2. `lastTrueDate(entry, inForce, opts)`

When an entry was last true, as the reading sees it. Lead's rule (brief correction 3, 2026-11-15), quote it:

> It is the date of the newest version in force on the reading that **sets the entry's content** (or one of its type's declared fields); a version that only renames, re-keys, pins, moves or switches the entry off or on does not count; with no such version, the entry's Beginning; with neither, no delta. A **History** entry takes no Beginning: a living History entry uses **its own date**.

- `entry`: the wire row's date parts `{ year?: number | null; month?: number | null; day?: number | null }` (for a non-history type these are its Beginning; for History, its own date).
- `inForce`: the amendments in force on the reading, as `amendmentsOnLine` returns them (`$lib/shared/lorebooks/lineReading.ts` ~456): each `{ year?: number | null; month?: number | null; day?: number | null; fields: Record<string, unknown> }` (a session's held amendment may have a null year). Type the parameter structurally like that; do not import server code.
- `opts`: `{ declaredFields: readonly string[]; ownDate: boolean }` — `ownDate: true` for a type whose date is the entry (History): return its own date when it has a year, else null, ignoring amendments.
- Otherwise: an amendment **counts** when its `fields` has own key `content` or any of `declaredFields` (and no other key makes it count: `name`, `keys`, `secondaryKeys`, `constant`, `anchorEntryId`, `enabled`, `archived` and the rest do not). Among the counting amendments take the **newest by date** (`compareDates`), not the last in apply order. **If a counting amendment has no year** (an undated held change), the date is unknown: return null (supervisor's decision; it will be a ★ in the lane report).
- No counting amendment: the entry's own parts when it has a year (its Beginning), else null.
- Return `StoryDate | null` with month/day as `null` when absent (the shape `dayOnly` in `storyDate.ts` returns).

## Files owned (the only files you may edit)

- `src/lib/shared/lorebooks/lastTrue.ts` (new)
- `src/lib/shared/lorebooks/lastTrue.test.ts` (new)

## Files readable

`src/lib/shared/lorebooks/storyDate.ts`, `src/lib/shared/lorebooks/lineReading.ts`, `src/lib/shared/lorebooks/amendments.ts`, `../serene-pub-sdk/sdk/src/storyTime.ts` (`StoryCalendar` ~244, `storyDaysInMonth` ~390, `isLeapYear`), any existing `*.test.ts` under `src/lib/shared/lorebooks/` for test style.

## Tests (a table, `it.each` or a loop over rows, each row named in words)

`storySpanBetween` / `storySpanWords`: free-form years (`Year 7` → `Year 10`: `3 years`); free-form no-borrow (Y7 M11 → Y8 M2: `1 year`); free-form months past 12; free-form days; year only against a full date (compares years only; same year → null); year and month against year and month; a declared calendar with odd month lengths (e.g. months of 30, 31, 28, 35 days) borrowing days across a month; the same calendar borrowing months across a year (`3 months`); a leap day (calendar with a leap rule: Y4 M2 D29 → Y5 M2 D28 is `11 months`; check against your borrowing); `1 year` / `1 day` singular; equal dates → null; same day, different hours → null; a clock moved back → null; a missing date on either side → null.

`lastTrueDate`: Beginning only → the Beginning; a dated change setting `content` later → its date; one setting a declared field (`category`) → counts; one setting only `name`, only `keys`, only `constant`, only `anchorEntryId`, only `enabled` → ignored (Beginning wins); two counting changes, the newer one applied first → the newer date; an undated held change setting `content` → null; a dated held change setting `content` → its date; perpetual with no counting change → null; History (`ownDate: true`) → its own date even with a later counting change; History with no year → null.

Run (check first that no vitest is running: `pgrep -af vitest`; if one is, wait and check again), from the app root:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/shared/lorebooks/lastTrue.test.ts > plans/time-t7b-w1.log 2>&1"
```

Never pipe vitest into `head`. Then `npx prettier --check` on both files (fix with an edit, never `--write` on other files) and `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep lastTrue` (no errors in your files).

Comments state the rule, not the story. Export only the three functions (and a type for the span if you need one).

## Stop and ask (in your report, do not decide) when

A rule above is ambiguous for a case you meet; you need to edit any other file; a test needs a name or behaviour not listed here.

## Report

Changed files; the test count and result (paste the vitest summary line); tsc and prettier results; any case where you had to interpret the rule.
