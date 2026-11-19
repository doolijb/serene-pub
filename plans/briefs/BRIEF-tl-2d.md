# BRIEF — build lane `tl-2d` — the real calendar; a new dated session starts today; the start form shows the date; the last Year 1 defaults go (programme 1.7)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/REPORT-tl-2b-2026-11-16.md` (all of it: what is built, what waits, the proposals; this lane finishes
it), the programme's "Latest rulings" (`plans/PLAN-programme-2026-11-15.md`: "Timelines and writes", "A story's
first date", "Dates, three more"), `plans/briefs/BRIEF-tl-2b.md` (its rules and its "Cold review corrections"
apply unchanged: an existing lorebook with a present gets nothing written; nothing gives an already-created
session a date; no boot pass writes lorebook lines), `docs/lorebook-time.md`, `docs/sessions.md`,
`STYLE-GUIDE.md` copy rules, `NOMENCLATURE.md` §1, §24, rows **story calendar**, **story clock**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write` (nor a scratch-copy equivalent). Never commit.
Never `npm test` / `npm run build` at the SDK root. `npm run sdk:build` from the app root only after
`pgrep -af "vite"` shows no dev / preview server and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`); then `npm run sdk:test` in the capped form
(the standing failures only). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2d-<n>.log 2>&1"`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. Migrations generated only; none
expected. Inside `db.transaction` only `tx`. No full run, no `npm run build`.

## Owner (2026-11-16)

"With dating on, default to real calendar." Asked whether that is the real calendar at today's real date:
"Yes". "Go with the safest option for existing lorebooks". "There shouldn't be a scenario where it defaults to
1-1-1. The exception would be if the genre/presets session init pipeline changes the date."

## Build

1. **The real leap rule (SDK `sdk/src/storyTime.ts`).** `StoryLeapRule` gains two optional fields (🚧
   `skipEvery`, `keepEvery`; additive, nothing renamed): a leap year every `every` years, except every
   `skipEvery`, except every `keepEvery`. `isLeapYear`, the leap count in `storyDayIndex`, the average year in
   `storyTimeOfDayIndex`, `storyCalendarProblems` (each a multiple of the one before; refusal sentences), and
   the calendar copy (~:422) all honour them. Property tests against JavaScript's `Date` for the real rule
   across 1600–2400: day index ↔ date round trip, weekday, 29 February in 2000 / 2100 / 2400.
2. **A new calendar preset** (🚧 *The real calendar*): the real leap rule, weekdays so that today prints its
   real weekday, the year shown as the bare number. `twelve-months` is **not changed** (books hold their own
   copy; existing books are untouched either way: "the safest option for existing lorebooks").
3. **New dated lorebooks start on it:** a session's own notes when they keep a timeline (`OWN_BOOK_CALENDAR`,
   `lorebooks/ownBook.ts:70`); a new shared lorebook created with its timeline on (find `lorebooks:create` and
   what it does today: free-form; change only the dated case, and say what an undated new lorebook gets).
   The calendar editors (`client/lorebooks/time/StoryCalendarEditor.svelte`, `StoryClockEditor.svelte`) keep
   leap fields they do not edit (test: open, save, the rule survives).
4. **Create's `today` and `asks` branches** (`storyStartOf`'s causes): `today` writes the **session's** clock at
   `storyToday(ownerTimeZoneOf(...))` inside the create transaction; `asks` (today does not land on the book's
   calendar) refuses to create without a date given by the form (★ sentence) and accepts one when given. A
   date set by the genre's or preset's create pipeline still wins (test with a fixture pipeline that sets one;
   Dungeon Crawler cannot show it).
5. **`FIRST_STORY_DAY` goes** (`advance-story-clock` with no clock and no present): with the rules above a dated
   session always has a start; the remaining case (an **existing** dated session or lorebook with no date,
   which nothing dates: "safest option") is refused with a sentence that says how to give the story a date (★),
   under the outlet's existing `onRefusal` contract. The guard's allow-list ends empty.
6. **A person's history entry with no year** on a line with no present gets today's date (same function) when
   today lands on the calendar; otherwise the existing refusal. The client's Year 1 defaults in the five places
   the report lists are removed: each control starts at the line's present / start (the form gets it from the
   reply in item 7), never at 1.
7. **The start form shows the date.** The `lorebooks:storyTime` reply gains 🚧 `start: { branchId, date, cause }`
   (`sockets/lorebookStoryTime.ts` and its socket type; scoped events keep their scope key), computed by
   `storyStartOf`; the start form (`StartSessionForm.svelte` and its store) shows one line: ★ *The story begins
   on ‹date›, where ‹lorebook› last was.* / *The story begins today, ‹date›.* / for `asks`, a required date
   field with one sentence of why; **Change** reuses the form's existing clock control where one exists (do not
   build a second date picker). Nothing is shown when the timeline is off. (Lane `tl-3`, next, adds the
   on / off choice for a new lorebook: leave room; do not build it.)
8. **Import and export of an undated history entry** (`utils/lorebookExportBuilder.ts` 382, 392;
   `utils/lorebookImportMapper.ts` ~963): export writes no year for a row that has none (older files that carry
   Year 1 for such rows cannot be told apart: say so); import skips a history entry with no year and reports
   ★ *‹n› history entries had no year and were not imported.* through the import's existing warnings. Then the
   history entry type's declared `default: 1` (`core-catalog/src/registry/entries.ts` 242–254) is removed
   (re-pin that definition's hash "(was …)"), and `historyDateOf` / `toEntryRow` read a legacy undated row as
   undated, not Year 1: follow the type change through its callers (`sockets/scenes.ts`,
   `narrativeGraph.build.ts`, `availableSceneCast.ts`) without changing what a dated row does. If this item
   balloons past those callers, stop it and report: the rest of the lane does not depend on it.
9. **Docs and names:** `docs/lorebook-time.md`, `docs/sessions.md`, `docs/summarization.md:32`,
   `INTEGRATING.md` (the leap rule), `NOMENCLATURE.md` (the calendar, the fields, the reply field; §25);
   the stale Year 1 comment in `sockets/scenes.ts` ~1475.

## Files owned

SDK: `sdk/src/storyTime.ts` and its tests, the preset list, `core-catalog/src/registry/entries.ts` (item 8),
`INTEGRATING.md`. App: `state/storyTime.ts`, `sockets/sessions.create.ts`, `lorebooks/ownBook.ts` (the calendar
constant), the lorebook create handler (dated case), `sockets/lorebookStoryTime.ts` and its types,
`sockets/entries.ts`, `utils/lorebookEntries.ts`, `utils/lorebookExportBuilder.ts`, `utils/lorebookImportMapper.ts`,
the outlet's host case for `advance-story-clock` (dating only), the five client files and the start form, the
two calendar editors (only to keep unknown leap fields), tests, docs, `NOMENCLATURE.md`. No other lane is
running; many files hold today's uncommitted work: re-read before each edit, small targeted edits.

## Out of scope

Which sessions start with a timeline, and the start form's on / off choice (lane `tl-3`); how play's writes are
dated and the backstop refusal (lane `tl-2c`); dating existing sessions or lorebooks; changing `twelve-months`.

## Stop and ask when

CLAUDE.md §Decisions applies; the real rule cannot be expressed without changing the meaning of an existing
calendar's stored fields; an existing book's dates would print differently; a shipped genre's first turn on a
fresh install fails or refuses a write (walk Story, the Lair, Dungeon Crawler, Chat, Guide); a prompt baseline
changes for a session that already had a date.

## Done means

SDK tests (item 1's properties; the preset prints today's real weekday with an injected date); `sdk:build`;
`sdk:test`. App tests (capped): items 3–8, each case; the create pipeline's date wins; the guard's allow-list is
empty; a first turn of each shipped genre; the parity harness and both prompt baselines (a new dated session's
prompt gaining today's date is the expected change: report the diff). `tsc` 0; `npm run check` 0 errors.

## Report

Final message = the report (lead saves `plans/REPORT-tl-2d-<date>.md`): the leap rule and its proofs; what each
kind of new lorebook starts on; create's branches; what is refused now and its sentence; the start form's line
in each state; import / export; pinned tests changed (old → new); every sentence and name (★); **Noticed, not
done**. Under about 800 words.
