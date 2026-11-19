# BRIEF — worker `tl-2d-w3` — new dated lorebooks start on the real calendar; the calendar editors keep the leap exceptions; a person's undated history entry gets today; the client's Year 1 defaults go

Supervisor: lane `tl-2d`. App repo `/home/jody/github/serene-pub` (SDK `/home/jody/github/serene-pub-sdk`: you do
not edit it; it is already built with the change below). The working tree holds a full day of uncommitted work by
earlier lanes: **re-read each file right before editing it; small targeted edits; never a whole-file rewrite.**
Always absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You never run `sdk:build`. Never `git checkout / restore / stash`. Never `prettier --write` (nor a scratch-copy
equivalent). No `npm run build`, no full `npm test`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <paths> > plans/tl-2d-w3-<n>.log 2>&1"`
(never pipe vitest into `head`; an int test that opens a DB inside an `it` needs a 60 s timeout).
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`; `npm run check` with the same NODE_OPTIONS once
at the end. Another worker may be fixing tests in other files at the same time: touch only your files.

## Rules that apply (quoted)

- Owner 2026-11-16: "With dating on, default to real calendar." Asked whether that is the real calendar at
  today's real date: "Yes". "Go with the safest option for existing lorebooks". "There shouldn't be a scenario
  where it defaults to 1-1-1."
- **Existing books are never touched**: books store their own copy of a calendar (`lorebooks.story_calendar`),
  never a link to a preset; nothing here rewrites a stored calendar; no boot pass; nothing gives an
  already-created session or lorebook a date.
- CLAUDE.md: inside `db.transaction(async (tx) => …)` use only `tx`. Views never call `toaster`.
  `$state(new Set())` / `new Map()` is not reactive on mutation: use `SvelteSet` / `SvelteMap`. Browser code: no
  `crypto.randomUUID`, no `navigator.clipboard`. Never seed a row at a hardcoded id. It is a **session**, never a
  *chat*.
- STYLE-GUIDE §10: sentence case; errors say what went wrong and what to do; help is one sentence.
- No new names, settings or sentences beyond those named here; anything else goes in your report as a question (★).

## What exists (re-verify every line number)

- The SDK now has (built): `StoryLeapRule` with optional 🚧 `skipEvery` / `keepEvery`; `parseStoryCalendar`
  copies them; a preset in `STORY_CALENDAR_PRESETS` with id `real-calendar`, name *The real calendar* (real leap
  rule `{ every: 4, month: 2, skipEvery: 100, keepEvery: 400 }`, Monday-first weekdays, `yearLabel: ''`).
  `twelve-months` is unchanged.
- `src/lib/server/lorebooks/ownBook.ts` ~61–75: `OWN_BOOK_CALENDAR` = the `twelve-months` preset; every new
  session's own notes are born with it (`insertOwnBook`, `genreCalendarOf` lays a genre's `periods` / `seasons`
  over it). Comments there call it "Gregorian" (~19).
- `src/lib/server/sockets/lorebooks.ts` ~709–779: `lorebooks:create`. Without a starter kit it inserts a row with
  no `storyCalendar` (free-form, NULL); `timelineEnabled` defaults to **true** (`db/schema.ts` ~1407) unless the
  params say `false`. A kit copy (`bookFromKit`) carries the kit's own calendar.
- `src/lib/server/sockets/entries.ts` ~950–992 (entry create): a session's history entry with no year is dated
  at the session's story now (`historyDateOfSessionWrite`), else refused with `NO_STORY_DATE_SENTENCE` (~210:
  *This story has no date yet. Give this history entry a year, or set the story clock in the lorebook's Book
  settings first.*); a history entry with no year and no session is refused with *A history entry needs a year.*
- `src/lib/server/state/storyTime.ts` (do not edit; another worker owns it): `storyToday(timeZone, at)`,
  `ownerTimeZoneOf(db, userId)`, `storyNowOf(db, lorebookId, branchId, …)`, `bookCalendarOf`, `clockProblem`.
- The client's Year 1 defaults (lane `tl-2b`'s list): `src/lib/client/lorebooks/sections/index.ts` ~232 (the
  History door's `newDraft`: `year: 1`), `src/lib/client/components/modals/CompileHistoryEntryModal.svelte` ~107
  (a display stand-in for an *Undated* compile: `year ?? 1`, month 1, day 1),
  `src/lib/client/lorebooks/time/StoryCalendarEditor.svelte` ~67 (the example date: `sample?.year ?? 1`, 1, 1),
  `src/lib/client/lorebooks/time/StoryClockEditor.svelte` ~53 (editing a book's clock with no present starts at
  `year: 1`). (`SessionLorebookReading.svelte` is another worker's: not yours.)
- `src/lib/client/lorebooks/time/bookTime.svelte.ts` `BookTime` now carries 🚧 `start: { branchId, date, cause }`
  (where a new session on the book would start: the line's present, else its latest dated row, else today, or
  `asks` with `date: null` when today does not land on the book's calendar) beside `presents`. Read it; do not
  edit the file.

## Build

1. **New dated lorebooks start on the real calendar.**
   - `OWN_BOOK_CALENDAR` becomes the `real-calendar` preset (comments say so; "born Gregorian" becomes true).
     Every **new** session's own notes get it (an own book with its timeline off gets it too, as every own book got
     `twelve-months` before: say so in your report). Existing own books keep what they stored.
   - `lorebooks:create` without a kit: when the new book keeps a timeline (`params.timelineEnabled !== false`), it
     is born with `storyCalendar` = a copy of the `real-calendar` preset (through `parseStoryCalendar`, as
     `ownBook.ts` does); when `timelineEnabled === false`, unchanged: free-form (NULL). A kit copy unchanged. No
     clock is written on the book (a session on it starts at today through the session's own clock, built by
     another worker).
   - Tests: a new session's own notes carry the real calendar (extend `src/lib/server/lorebooks/ownBook.int.test.ts`
     or `sockets/sessions.ownBookCreate.int.test.ts`; change any test that pinned `twelve-months` for a NEW book on
     purpose and list it old → new); `lorebooks:create` dated → real calendar, undated → NULL, kit → the kit's
     (find the closest existing `lorebooks:create` test). And a check that an **existing** book's stored
     `twelve-months` calendar reads back unchanged (no code path rewrites it).
2. **The calendar editors keep leap fields they do not edit.** `StoryCalendarEditor.svelte` copies the stored
   calendar into a draft (`JSON.parse(JSON.stringify(...))` ~83) and edits `leap.every` / `leap.month` in place;
   confirm the save path keeps `skipEvery` / `keepEvery` end to end (draft → `lorebooks:setCalendar` →
   `parseStoryCalendar` → stored → read back). Turning the leap rule off and on again (`~216`) builds
   `{ every: 4, month: 1 }`: that is a deliberate edit, fine. `StoryClockEditor.svelte` edits the clock only:
   confirm it never writes the calendar. Test: a DOM test that opens the editor on a book whose calendar is the
   real one, saves (e.g. after renaming a month), and the emitted calendar still has `skipEvery: 100,
   keepEvery: 400` (follow an existing DOM test's harness for these editors: `grep -rln "StoryCalendarEditor" src --include=*.test.*`);
   and a server test that `lorebooks:setCalendar` stores and returns the two fields.
3. **A person's history entry with no year on a line with no present gets today's date** (`sockets/entries.ts`):
   - Session write: where `historyDateOfSessionWrite` gives no date (the session has no story now), if the line
     has no present (`storyNowOf` null) and today (`storyToday(await ownerTimeZoneOf(db, userId))`, the acting
     person's zone; the date parts only: year, month, day) lands on the book's calendar (`clockProblem` null, or
     free-form), the entry takes today's date; otherwise the existing `NO_STORY_DATE_SENTENCE`.
   - No session: a history entry with no year on a line (`data.branchId`, null = main) with no present gets today's
     date the same way when it lands; otherwise the existing *A history entry needs a year.* A line **with** a
     present still refuses a yearless entry as today (the client prefills the present; see 4).
   - The book's timeline off: unchanged (history refused as today).
   - Tests in the closest existing entries int test (`grep -rln "A history entry needs a year\|NO_STORY_DATE" src/lib/server --include=*.test.ts`):
     each case (session / no session × no present + today lands → today's date, injected with
     `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime`; no present + today does not land → the
     refusal; a present → unchanged). Change any pinned test that expected the refusal for the now-dated case, on
     purpose, and list it old → new.
4. **The four client Year 1 defaults go**; each control starts at the line's present / start, never at 1:
   - History's `newDraft` (`sections/index.ts` ~232): find how the history form opens a new draft and what it can
     read (`EntryWorkspace.svelte` ~1028 `door.newDraft(lorebookId)`, `time/TimeLens.svelte` ~297); prefill the
     year / month / day from the reading line's present, else `BookTime.start.date`, else leave the year empty
     (the server dates it today, item 3, or refuses with its sentence). Keep the change small; if the draft cannot
     reach the book's time without a new prop or plumbing through several files, use an empty year and say so.
   - `CompileHistoryEntryModal.svelte` ~107: the *Undated* stand-in shows no date parts (null), never Year 1, 1, 1
     (it "never decides where or what Save writes": confirm).
   - `StoryCalendarEditor.svelte` ~67: the example date is the `sample`, else `BookTime.start.date` if the editor
     can reach it cheaply, else today from the browser's clock (`new Date()`, local getters) — never year 1.
   - `StoryClockEditor.svelte` ~53: editing with no present starts from `BookTime.start.date` if reachable, else
     empty inputs (the year field already says what it needs, or add nothing).
   - DOM tests for each where an existing test file covers the component (extend it); otherwise one small new DOM
     test for the two editors.

## Files owned

`src/lib/server/lorebooks/ownBook.ts` (the calendar constant and its comments only);
`src/lib/server/sockets/lorebooks.ts` (`lorebooks:create`'s dated case only);
`src/lib/server/sockets/entries.ts` (the yearless history entry only); `src/lib/server/utils/lorebookEntries.ts`
(only if item 3 needs it); `src/lib/client/lorebooks/sections/index.ts`;
`src/lib/client/components/modals/CompileHistoryEntryModal.svelte`;
`src/lib/client/lorebooks/time/StoryCalendarEditor.svelte`, `StoryClockEditor.svelte`; the History draft's caller
(`EntryWorkspace.svelte` / `TimeLens.svelte`) only for the prefill; the test files above.

## Files readable

Anything. Context: `plans/REPORT-tl-2b-2026-11-16.md`, `plans/briefs/BRIEF-tl-2d.md`, `docs/lorebook-time.md`.

## Out of scope

`state/storyTime.ts`, `sockets/sessions.create.ts`, `sockets/lorebookStoryTime.ts`, the start form and
`SessionLorebookReading.svelte` (another worker); the editor's summary text "one more every N years" (~276) and
the prompt layout "Leap day: every N years" (`pipelines/entities/variableLayouts.ts`): note, do not change;
import / export; history entry type defaults in the SDK; docs and `NOMENCLATURE.md` (the supervisor); changing
`twelve-months`; dating existing books.

## Stop and ask when

CLAUDE.md §Decisions applies; a sentence or name beyond those above; an existing book's dates would print
differently; a migration; a shipped genre's first turn would fail or refuse a write. Stop = write it in your report
and finish what you can.

## Done means

The tests above green (log paths and counts); `tsc` 0; `npm run check` 0 errors in your files;
`npx prettier --check` on touched files (report, do not fix formatting you did not cause).

## Report

Your final message: changed files; what each kind of new lorebook starts on (own notes dated / undated, shared
dated / undated, kit); the editors' proof; item 3's cases as built; each client default and what it starts at
now; tests run with results; pinned tests changed (old → new); every new sentence / name (★); **Noticed, not
done**.
