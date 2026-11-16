# BRIEF — `time-t7d-w6`: docs and NOMENCLATURE for dated rows

Supervisor: lane `time-t7d`. App repo `/home/jody/github/serene-pub`. Report back in your final message.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You run no build and no tests.)

Also: never `prettier --write`; never `git checkout / restore / stash`. No other product's name in any file.
Plain, direct prose; no "🚧" inside a linked heading (it broke a heading id once — put the mark in the text
under the heading). Another worker edits the SDK at the same time; a peer session shares the checkout.

## Rules you are applying (quoted)

- NOMENCLATURE §1: "**R1 — One word, one meaning.**" · "**R3 — Qualify, never abbreviate to the bare noun.**" ·
  "**R6** … 🚧 **Provisional** — designed but not built, so the words may still move on contact with
  implementation." §24: grep a new word first; "Say what it is **not**, in the declaration, if a near-neighbour
  exists." CLAUDE.md: "When you add or rename a term, record it in **§25 Change ledger** in the same change." ·
  "**§23 Retired words**: never reintroduce one." · P6 Charters: "Everything that exists states its purpose, why
  it exists, what it owns and what it does not (and who does) — in its **NOMENCLATURE** row."
- Owner, 2026-11-15: "dates returned via SDK should be something like: type date: {year: {number:int,
  name:string?}, month: …, day: …, time: {hour:int, minute:int} … {...., date, dateDelta}, we don't have to rename
  it for every … different row type. The variable layouts should be per parent object/array" · "Context/variable
  layouts are what determine how/where it's printed." · "nothing should be handed down flat. A custom node could
  flatten data, but it should be highly discouraged in the documentation" · "Break existing custom layouts, we
  are in pre-release, we don't care." · "make sure the SDK can pass down the lorebooks calendar structure".

## What was built (facts to document; all names 🚧)

- **Date value** `StoryDateValue` (SDK): `{ year: { number, name? }, month: { number, name? } | null, day:
  { number, name? } | null, time: { hour, minute } | null }`. Names only from the lorebook's declared calendar,
  only when the date lands on it: `year.name` the spelled year (`Year 412 AR`), `month.name` the month,
  `day.name` the weekday; a free-form book has none. Field constant `STORY_DATE_FIELD`.
- **Date delta** `StoryDateDelta`: `{ sign: -1|0|1, year, month|null, day|null, time: {hour, minute}|null }`, the
  row's date minus the session's current date. Only parts both dates carry are compared (a part not compared is
  null, never 0). With a declared calendar it is exact (borrowing month lengths, the leap day included); in a
  free-form book, where a part would have to borrow from a coarser one, one is taken from the coarser part and
  every finer part becomes null (known: at least that much) — e.g. Year 7 month 11 to Year 8 month 2 is
  `-0y`, Year 7 month 3 day 20 to Year 7 month 5 day 5 is `-0y 1m`. `null` with no current date, with the
  Timeline off, when the present comes from the newest history entry (no clock set), or when the row has no
  date. Field constant `STORY_DATE_DELTA_FIELD`. No words: this replaces `time-t7c`'s `relativeDate` and its
  free-form bounds (*under 1 year ago*, *over 2 years ago*), which are gone.
- **Rows**: `history` (`core:var/history@1`) is now a **list** of `{ date, dateDelta, content }`, newest first,
  absent when empty (the keyed record and the `relativeDate` root are removed). `earlierScenes`
  (`core:var/earlier-scenes@1`) rows are `{ name, summary, date, dateDelta }`; a scene's date is the story clock
  when it opened (day and time), none when it opened with no clock. `currentDate` (`core:var/current-date@1`)
  is the same date value (it used to be flat parts plus `label`). No other variable has them.
- **Helpers** in both engines: `formatDate` (`{{{formatDate date}}}`, Liquid `{{ date | formatDate }}`) prints
  the calendar's spelling when the value carries names (`Moonday, 3 Thaw, Year 412 AR`, a time as `, 22:30`), else
  `412-03-05`, `412-03`, or `Year 412` for a year alone (a time as ` 22:30`). `formatDateDelta` prints the sign and
  parts compactly: `-0y 2m 3d`, `+1y 0m 0d`, `0y 0m 0d`, `-0y 0m 2d 3h 15min`; null parts are left out. Both print
  nothing for null or a wrong value. Use the triple stash in Handlebars (they return plain text). Named apart from
  the fields: in Handlebars `{{date}}` inside a row would call a helper named `date`, and Liquid already has a
  `date` filter.
- **Shipped layouts now print** (before → after):
  - History, free-form, clock set: `"412-03-03 (2 days ago)"` (t7c) → `"412-03-03 (-0y 0m 2d)"`; no clock set:
    `"412-03-03"` (unchanged); year only: `"Year 409"` → `"Year 409 (-3y)"` with a clock.
  - History in a book with a declared calendar: the date is now spelled through it, `"412-03-03"` →
    `"Moonday, 3 Thaw, Year 412 AR (-0y 0m 2d)"` (the same spelling as the current date).
  - Two History entries on one date: `"412-03-05"`, `"412-03-05 (2)"` → `"412-03-05"` twice (a list keeps both).
  - Earlier scenes: `{"name":"Scene 1 · The ferry","summary":"…"}` → `{"name":"Scene 1 · The ferry","dateDelta":"-0y 0m 3d","summary":"…"}`
    when there is a delta; the date itself is not printed (an automatic scene name already carries it).
  - Current date: unchanged, byte for byte.
- **Story calendar** variable `core:var/story-calendar@1`, template name `storyCalendar`: the lorebook's calendar
  (months with lengths, weekdays, leap rule, eras; the day's periods and seasons are not included), laid out by
  Assemble; absent for a free-form book; shipped layout **Parts** prints `Months: Thaw (30 days), …`,
  `Weekdays: …`, `Leap day: every 4 years, in month 2`, `Eras: BR, counting down; AR from year 1`. No shipped
  template prints it; add `{{{storyCalendar}}}` to a template to tell the model how the calendar runs.
- **A value that does not fit its variable** (a step handing down a flat string where the variable declares a
  list) is not written through the layout: it is written as it came and the run's receipt says which variable
  and why. Flattening a value in a step is strongly discouraged: the variable's layouts are written for its
  declared shape.
- **Layout checks**: the layout editor and a save now warn (never refuse; only a syntax error refuses) on: an
  unknown field; an object, list or date printed bare (it would print `[object Object]`); `each` over something
  that is not a list; `@key` inside an `each` over a list (the mark of a layout written for the old keyed
  History); `formatDate` / `formatDateDelta` given a field that is not a date / delta. Finding kind 🚧
  `shape-mismatch` (SDK `TemplateFindingKind`).
- **Upgrading**: a custom History layout written for the keyed record (`{{#each history}}` with `@key`, or
  `relativeDate`) is not converted: it prints wrong (positions instead of dates) and its page warns; rewrite it with
  `date`, `dateDelta` and `content`, or use the shipped layout. A custom current-date layout reading
  `currentDate.year` / `currentDate.label` prints wrong the same way; use `currentDate.year.number` or
  `{{{formatDate currentDate}}}`. Custom Earlier scenes layouts keep working (fields were only added).

## Goal

1. `docs/context-templates.md`: the variables list (~179–197: `currentDate`, `history`, `earlierScenes`, add
   `storyCalendar`); replace the section **"How far a history day is from now"** (~266–284) with **"Dates in a
   layout"** (the value, the delta, the two helpers with one Handlebars and one Liquid example, what the shipped
   layouts print); add the scope-mismatch paragraph where variable layouts are explained; extend **"Templates are
   checked when you save them"** (~462) with the warnings; add an **upgrade note** under **"Upgrading from 0.5"**
   or as its own short section for layouts written on an earlier 0.6 pre-release. Grep the file for every other
   `relativeDate` / *days ago* / keyed-History mention and fix it.
2. `docs/lorebook-time.md` (~174 and ~216): the distance is now the numeric delta; drop the bound wording.
3. Grep `docs/` for `relativeDate`, `days ago`, `under 1 year`, `currentDate.label`, `currentDate.year` and fix any
   other page that describes them (list what you changed).
4. `NOMENCLATURE.md` (this lane owns it for this change):
   - §15 "Chat-shaped services only" table (or "Generic" if you judge it generic — say which and why): replace the
     🚧 **`relativeDate`** row with rows for 🚧 **date value** · `date` (`StoryDateValue`), 🚧 **date delta** ·
     `dateDelta` (`StoryDateDelta`), 🚧 **`formatDate` · `formatDateDelta`** (the helpers; ⚠ not the app's TypeScript
     `formatDate(date, calendar)` in `shared/lorebooks/storyDate.ts`, which spells a stored date for the UI: say how
     they differ, R1), 🚧 **story calendar variable** · `storyCalendar` (`core:var/story-calendar@1`), and 🚧
     **`shape-mismatch`** (the layout-check warning kind). Each row: built 2026-11-15, lane `time-t7d`, no migration;
     **Purpose · Owns · Not** (P6) — e.g. the delta owns arithmetic only and no words; Decay plays no part; a layout
     prints it.
   - §23: retire `relativeDate` (History's second root, 2026-11-15, replaced by `dateDelta` on each row; owner
     "match the internal variable names", "nothing should be handed down flat"), and the free-form bound words
     (`StorySpan.bound`, *under / over*).
   - §25: one ledger entry for this change (follow the format of the newest entries at the end of the file),
     listing every name added and removed: `StoryDatePart`, `StoryDateValue`, `StoryDateDelta`, `STORY_DATE_FIELD`,
     `STORY_DATE_DELTA_FIELD`, `FORMAT_DATE_HELPER`, `FORMAT_DATE_DELTA_HELPER`, `varStoryCalendar`
     (`core:var/story-calendar@1`, `storyCalendar`), the `shape-mismatch` kind, the earlier-scenes query's
     `openedStoryClock` field, the app's `storyDateValueOf`, `storyDateText`, `storyDateDeltaText`,
     `storyDateDeltaOf`; removed `relativeDate`, `RELATIVE_DATE_ROOT`, `relativeDateWords`, `storySpanBetween`,
     `storySpanWords`, `StorySpan`, `renderVariable`'s `siblings`, `prepareExplicitLayouts`' `siblingsOf`. Grep
     each new word in `src/` and `../serene-pub-sdk/` first (§24) and note any collision in the entry.

## Files owned (only these)

`docs/context-templates.md`, `docs/lorebook-time.md`, other `docs/*.md` pages only where step 3 finds an
outdated description, `NOMENCLATURE.md`.

## Out of scope

Code, tests, the SDK's own docs (`INTEGRATING.md`, guides — already done), generated docs, STYLE-GUIDE.

## Stop and ask when

A word above collides with an existing meaning you cannot qualify away; a doc describes behaviour this brief
does not cover and you would have to guess.

## Done means

The edits, `npx prettier --check` on each changed file (report the result, don't fix formatting by tool), and
a report: changed files with the sections touched, every NOMENCLATURE row added/retired, collisions found.
