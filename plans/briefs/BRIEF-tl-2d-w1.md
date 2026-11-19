# BRIEF — worker `tl-2d-w1` — the real leap rule and *The real calendar* preset (SDK)

Supervisor: lane `tl-2d`. Repo: `/home/jody/github/serene-pub-sdk` (the SDK; edit it here). The app is
`/home/jody/github/serene-pub`. Most of the SDK tree is uncommitted work by earlier lanes: **re-read each file
right before editing it; small targeted edits; never a whole-file rewrite.**

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**You do not run `sdk:build` at all** (the supervisor does). Never `git checkout / restore / stash / clean` in
the SDK. Never `prettier --write` (nor a scratch-copy equivalent).

## Goal

1. **The real leap rule** in `sdk/src/storyTime.ts`. `StoryLeapRule` (~276) gains two **optional** fields,
   🚧 `skipEvery?: number` and `keepEvery?: number` (additive; nothing renamed; an existing stored rule
   `{ every, month }` means exactly what it means today). Meaning: a leap year every `every` years, **except**
   every `skipEvery` years, **except** every `keepEvery` years. The real rule is
   `{ every: 4, month: 2, skipEvery: 100, keepEvery: 400 }`. Honour it in:
   - `isLeapYear` (~431): leap when `mod(y, every) === 0` and not (`skipEvery` and `mod(y, skipEvery) === 0` and
     not (`keepEvery` and `mod(y, keepEvery) === 0`)). Negative and zero years by the same `mod` (year 0 is a
     leap year under the real rule, as in astronomical counting).
   - the leap count in `storyDayIndex` (~493): `floorDiv(y, every) - (skipEvery ? floorDiv(y, skipEvery) : 0)
     + (keepEvery ? floorDiv(y, keepEvery) : 0)` with `y = year - 1` (keep the existing shape; one helper is fine).
   - the average year in `storyTimeOfDayIndex` (~567): `yearDays + 1/every - 1/skipEvery + 1/keepEvery`
     (each term only when set).
   - `storyCalendarProblems` (~355): each, when present, a whole number of 1 or more; `skipEvery` a whole
     multiple of `every`; `keepEvery` needs `skipEvery` and is a whole multiple of it. One sentence per fault, in
     the file's existing style (sentence case, says what is wrong). Proposed (mark each ★ in your report; reuse
     the file's voice, adjust only if a sentence reads wrong):
     - ★ *A leap rule's skipped years must be a whole number, a multiple of its leap years.*
     - ★ *A leap rule's kept years must be a whole number, a multiple of its skipped years.*
     - ★ *A leap rule can keep years only when it skips some.*
   - the calendar copy in `parseStoryCalendar` (~422): copy `skipEvery` / `keepEvery` when present (today the
     copy drops every key but `every` and `month`, which would silently strip the real rule on every save).
   - The JSDoc of `StoryLeapRule` (one extra day … every `every` years) says the two exceptions.
   - Grep the SDK for other readers of `leap` (`grep -rn "leap" sdk/src core-catalog/src controls/src --include=*.ts`):
     `sdk/src/cadences.ts` ~1138 (annual search window `every * 2 + 1` years: the real rule's longest gap between
     29 Februaries is 8 years, so it still holds: confirm and leave it, or say why not); `sdk/src/variables.ts`
     ~1000 (the `core:var/story-calendar@1` declaration's `leap.fields`): find out whether a value carrying
     extra leap keys is refused or stripped by that declaration's validation; if it is, add the two optional
     fields there (additive; if that moves a pinned hash, re-pin with a dated comment "(was …) 2026-11-16,
     tl-2d: leap exceptions"); if it is not, leave it and say so.
2. **A new preset** in `STORY_CALENDAR_PRESETS` (~701), after `twelve-months`: id ★ `real-calendar`, name
   🚧 *The real calendar*: the same twelve months as `twelve-months` (January 31 … December 31; February 28),
   `weekdays` the same Monday-first `WEEK`, `firstWeekday` such that today prints its real weekday (proleptic
   Gregorian 1 January, year 1 is a Monday, so with the Monday-first week this should be `0`: **prove it by
   test**, do not trust this line), `yearLabel: ''` (the bare number), `leap: { every: 4, month: 2, skipEvery:
   100, keepEvery: 400 }`. Grep both repos for `real-calendar` first (NOMENCLATURE §24: no second meaning).
   **`twelve-months` is not changed in any way** (owner 2026-11-16: "Go with the safest option for existing
   lorebooks"; books store their own copy of a calendar, never a link to the preset).
3. **INTEGRATING.md** (`/home/jody/github/serene-pub-sdk/INTEGRATING.md`, the canonical one): near the story
   time text (~1615–1635, or wherever `StoryCalendar` / the leap rule is described; grep), one short paragraph:
   the leap rule's two optional exceptions, the real rule, the `real-calendar` preset, and that existing books
   keep the rule they stored (`twelve-months` is every 4 years, unchanged). Plain, short, in the file's style.

## Tests (in `/home/jody/github/serene-pub-sdk/sdk-tests/`, extend `storyCalendar.test.ts` or add `storyCalendarLeap.test.ts`)

- **First, before touching `storyTime.ts`:** compute and pin a table over the built-in `twelve-months`
  calendar's output **with today's code**: for at least these dates `{1,1,1}`, `{4,2,29}`, `{100,2,29}`,
  `{1900,2,29}`, `{2000,2,29}`, `{2026,11,16}`, `{2100,2,29}`, `{0,12,31}`, `{-3,3,1}` → `storyDayIndex` →
  `formatStoryTime` (and `storyTimeOfDayIndex` back). Write the literal values into the test (never computed in
  the test from the code under test). Then make the change; this table must stay green unchanged. (This is the
  owner's "safest option for existing lorebooks" proof: no existing book's dates or weekdays move.)
  Also pin the `twelve-months` preset object itself with `deepEqual` to its literal value.
- **Property tests of the real rule against JavaScript's `Date`** (UTC; build dates with
  `new Date(Date.UTC(2000, 0, 1))` and `setUTCFullYear` so years are not remapped), for every day — or every
  day of a sampled set of years if the full sweep is slow (≥ 1600, 1700, 1800, 1899, 1900, 2000, 2024, 2026,
  2100, 2399, 2400 and every 7th year in between) — across 1600–2400:
  - day index ↔ date round trip (`storyTimeOfDayIndex(storyDayIndex(d)) === d`);
  - consecutive days differ by 1 in index and match `Date`'s day difference from a fixed anchor;
  - the weekday `formatStoryTime` prints equals `Date`'s (`getUTCDay()`, Sunday 0, mapped to Monday-first);
  - `storyTimeProblem` accepts 29 February in 2000 and 2400, refuses it in 1900 and 2100;
  - `storyDaysInMonth(year, 2, real)` equals `Date`'s February length.
- **The preset prints today's real weekday with an injected date:** for a few injected instants (e.g.
  `2026-11-16T12:00:00Z` → Monday, `2000-02-29T00:00:00Z` → Tuesday, `2100-03-01T00:00:00Z` → Monday) the
  year / month / day from UTC getters, formatted through the preset, start with the right weekday and print
  the year as the bare number (`yearLabel: ''`).
- `storyCalendarProblems`: the real rule passes; each fault above gives its sentence; an old `{ every, month }`
  rule passes unchanged; `parseStoryCalendar` keeps `skipEvery` / `keepEvery` (open, save → the rule survives)
  and still drops unknown keys.
- `advanceStoryTime` across 28 Feb 2100 → 1 Mar 2100 and 28 Feb 2000 → 29 Feb 2000 on the real calendar.
- Every preset is well-formed (the existing test covers the new one).

Run only these files, from `/home/jody/github/serene-pub-sdk/sdk-tests` (never the SDK root):
`npx tsx --test storyCalendar.test.ts storyClockAdvance.test.ts <your new file>` and
`npx tsc --noEmit -p .` there (check first how `sdk-tests` resolves `@serene-pub/sdk`: if it resolves the
built `dist/` rather than sources, say so in your report and run the property tests against the source via a
relative import or tell the supervisor they need `sdk:build` first; do not build). Also
`npx tsc --noEmit -p sdk/tsconfig.build.json` (or the SDK package's own typecheck; find the right command
without building `dist/`).

## Files owned

`sdk/src/storyTime.ts`; `sdk/src/variables.ts` (only the `story-calendar` leap fields, only if needed);
`sdk-tests/storyCalendar.test.ts` / a new `sdk-tests/storyCalendarLeap.test.ts`; `INTEGRATING.md` (one
paragraph); a pin file only if a hash moves because of `variables.ts`.

## Files readable

Anything in either repo. Context: `/home/jody/github/serene-pub/plans/REPORT-tl-2b-2026-11-16.md` §1.

## Out of scope

Changing `twelve-months`; any app file (`OWN_BOOK_CALENDAR`, the calendar editor, the prompt layout of
`storyCalendar` in the app's `variableLayouts.ts` that prints "Leap day: every N years": note it, do not touch);
renaming anything; any display format change.

## Stop and ask when

The real rule cannot be expressed without changing the meaning of an existing calendar's stored fields; the
pinned `twelve-months` table would change; a name other than `skipEvery`, `keepEvery`, `real-calendar` seems
needed; anything outside the files owned. Stop = write it in your report and finish what you can.

## Done means

The tests above green; `tsc` for `sdk-tests` and the SDK package 0 errors; `npx prettier --check` on each
touched file (report, do not fix formatting you did not cause).

## Report

To your final message (the supervisor reads it): changed files; the pinned `twelve-months` table (as pinned);
the `firstWeekday` proof; the test commands and results (counts); every new sentence and name (★); what you
found in `variables.ts` and `cadences.ts`; **Noticed, not done**.
