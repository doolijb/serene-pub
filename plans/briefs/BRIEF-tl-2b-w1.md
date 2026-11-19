# BRIEF — worker `tl-2b-w1`: where a new session's story starts (the injectable "today", the start rule, the create gap)

Supervisor: lane `tl-2b`. App repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/` unless
said otherwise.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: nothing in the SDK changes in this task. Never `prettier --write`, nor on a scratch copy.)

## Goal

A session that starts on a lorebook that keeps a timeline gets a story "now" from its first moment, as far as can be
built before the owner rules on the real calendar (DISCUSS-LATER D49b). Three pieces, all in `state/storyTime.ts`
plus one call in session create:

1. **`storyToday(timeZone: string | null, at: Date = new Date()): StoryClock`** — the one "today" function: the
   date AND time of day (year, month, day, hour, minute) of instant `at` in IANA zone `timeZone`, else the
   server's own zone. Use `Intl.DateTimeFormat(..., { timeZone, hourCycle: "h23", year/month/day/hour/minute:
   "numeric" }).formatToParts`. An unknown zone string (Intl throws `RangeError`) falls back to the server's zone.
   It is injectable through `at` (tests pass a fixed `Date`, or use `vi.setSystemTime`). No module-level setter.
   Plus **`ownerTimeZoneOf(db, userId): Promise<string | null>`** reading `schema.users.timeZone` — the pattern
   is `pipelines/routines/tick.ts` 65–75 (the session owner's `users.timeZone`, else the server's).
   JSDoc on `storyToday`: 🚧 "today's real date" is the lead's reading of the owner's "default to real calendar"
   (D49b), not yet ruled.

2. **`storyStartOf(db, args)`** — 🚧 where a NEW session on a lorebook line starts: the lorebook's **most recently
   active point**, else today. Define it once, here. Signature (you may refine the shape; name your choice):
   ```ts
   export type StoryStart =
     | { cause: "undated" }                    // the lorebook keeps no timeline
     | { cause: "present"; clock: StoryClock } // storyNowOf found the line's present: write nothing, the session follows its line
     | { cause: "latest"; clock: StoryClock }  // no present, but the line's own dated rows: start at the latest of them
     | { cause: "today"; clock: StoryClock }   // nothing dated at all, and today's date lands in the book's calendar (or it is free-form)
     | { cause: "asks" }                       // nothing dated at all, and today's date does not land in the book's calendar
   export async function storyStartOf(db: Db, args: {
     lorebookId: number; branchId: number | null; line?: Line | null; timeZone?: string | null; at?: Date
   }): Promise<StoryStart>
   ```
   The rule, in order:
   - Timeline off (`timelineOfBook`, from `lorebooks/timeline.ts`) → `undated`.
   - `storyNowOf(db, lorebookId, branchId, { line })` non-null → `present` with `clockOfNow(now)`. **This already
     is the most recently active point** (the line's clock, else its newest history entry the line reads).
   - Else scan **the line's own dated rows** and take the latest by `compareDates` (`$lib/shared/lorebooks/storyDate`):
     entry amendments that are not held (`entry_amendments.base IS NULL`) with a year; cast members' dated
     versions (`character_versions` with `cast_member_id` and `year` not null); `cast_amendments`; entries'
     **Beginnings** (`lorebook_entries` whose type takes a Beginning, `takesBeginning` in `utils/lorebookEntries.ts`,
     with a numeric `fields.year`; read the date the same way `state/reading.ts` `historyEntryDate` reads a
     history entry's: only a JSON number counts); and presence arrivals (`cast_presences.from_*`). Only rows the
     line reads: filter each with `datedOnReading(row, date, { branchId, moment: null, forkedAt: null, line })`
     from `state/reading.ts` (it needs the row's `branchId`; check each table has a `branch_id` column and say
     in your report which do). The line, when not given, is `branchId == null ? MAIN_LINE : await lineOfBook(db,
     lorebookId, branchId)` exactly as `storyNowOf` does. **Never** read sessions' clocks, scenes' clocks or
     message stamps: the owner forbids deriving a book's present from its sessions (`storyTime.ts` 32–34). A hit
     → `latest` with `{ year, month, day, hour: null, minute: null }` of that date (month / day null when the
     row has none).
   - Else (nothing dated on the line at all): `today = storyToday(timeZone ?? null, at)`; the book's calendar
     (`bookCalendarOf`) null (free-form) → `today`; a declared calendar in which `today`'s date lands (use the
     existing `clockProblem(clock, calendar)` / `dateProblem`: null means it lands) → `today`; otherwise →
     `asks`.

3. **Session create** (`sockets/sessions.create.ts`, inside the existing `db.transaction(async (tx) => …)` that
   inserts the session row, around lines 717–795): when the create named no clock (`requestedClockYear == null`
   after the next-chapter carry, which arrives through the same `params.session` fields) and is not a branch (the
   branch path returns earlier, line ~85), after the session row AND its own book (or kit copy) exist, call
   `storyStartOf(tx, { lorebookId: <the book the session reads: row.lorebookId ?? its own book's id>, branchId:
   row.lorebookBranchId })` and **only when `cause === "latest"`** write that clock as the **session's** clock
   (`clockColumns(clock)` onto `schema.sessions` where id = row.id), under `lockBookCalendar(tx, book)`.
   `present` writes nothing (owner 2026-09-28: a session made on a book with a present stores no clock and follows
   the line — `storyTime.ts` 24–30, create's "ruling 15" comment, pinned by `state/sessionStoryClock.int.test.ts`
   155–184: keep that). `today` and `asks` write nothing yet: add one 🚧 comment that they wait on the owner's
   ruling on the real calendar (DISCUSS-LATER D49b) and that a new lorebook made for the session keeps no clock
   until then. `undated` writes nothing.
   **Inside `db.transaction` use only `tx`** — the outer `db` deadlocks PGlite silently (`db/transactionGuard.ts`
   throws in dev/test). The genre's create pipeline runs AFTER this transaction (line ~1074, "Creation as a run"):
   confirm in the code that its clock writes come after yours, so a create pipeline's date wins (Dungeon
   Crawler's create advances the clock to 08:00 from wherever the story starts).

## Files owned

- `src/lib/server/state/storyTime.ts` (add the functions; touch nothing else in it — `FIRST_STORY_DAY` stays)
- `src/lib/server/sockets/sessions.create.ts` (the one call above, nothing else)
- New test file `src/lib/server/state/storyStart.int.test.ts`
- `src/lib/server/state/sessionStoryClock.int.test.ts` (add tests; change no existing expectation)

## Files readable

Anything. Start with `state/storyTime.ts` 255–330 (`storyNowOf`), 587–700 (`datedRowsOf`, a book-wide list of
dated rows you can mirror table by table), `state/reading.ts` 430–465, `lorebooks/ownBook.ts` 55–75 and 215–245,
`lorebooks/timeline.ts`, `pipelines/routines/tick.ts` 60–80, `sockets/sessions.create.ts` 380–460 and 700–830,
`db/schema.ts` for the tables above.

## Out of scope

Writing today's date anywhere (D49b); the start form; any refusal at create; existing sessions (nothing gives an
already-created session a date); history-entry year fallbacks (another worker); `FIRST_STORY_DAY`; the SDK; docs;
NOMENCLATURE; any new socket field or event.

## Stop and ask when

Something needs a file outside Files owned; a name the rest of the app would see (socket field, event, UI text);
a migration; an existing test expectation would change; a table above has no line (`branch_id`) column and you
cannot tell whether its rows are line-scoped.

## Tests (capped, never piped into `head`)

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2b-w1-<n>.log 2>&1"
```
An int test that opens a DB inside an `it` needs a 60 s timeout. If a run fails on imports from `@serene-pub/*`
(another lane may be rebuilding the SDK), wait a few minutes and rerun once before investigating.

`state/storyStart.int.test.ts` (new) covers: `storyToday` at a fixed instant in two zones that fall on different
days (e.g. `Pacific/Auckland` and `America/Los_Angeles`), with `null` (the server zone: compare with the `Date`'s
local getters), and with an unknown zone (falls back); `storyStartOf` → `undated` (timeline off); `present` from a
line clock and from a dated history entry; `latest` from each kind of row (an amendment, a cast version, a
Beginning, a presence arrival) taking the latest of several, and a row on a sibling line NOT counted; `today` on a
free-form book and on the `twelve-months` calendar (`OWN_BOOK_CALENDAR`) with an injected `at`; `asks` on a
declared calendar today's date does not land in (e.g. ten months: month 11 does not exist).
`state/sessionStoryClock.int.test.ts` (add): a create on a book with no present but a dated amendment (or
Beginning) stores the session clock at that date, and the book's own clock stays unset; the existing tests stay
green unchanged (a book with nothing dated still leaves the clock unset).
If a Dungeon Crawler create test exists that is cheap to extend (`sockets/sessions.dungeonCrawler.int.test.ts`),
add one where the book has only a dated amendment: after create the session clock is the create pipeline's
(08:00 on that day), proving its write wins. If it is not cheap, say why and stop there.

Run: the two files above, plus `state/sessionStoryClock.int.test.ts` and `sockets/sessions.timelineDefault.int.test.ts`
and `sockets/sessions.ownBookCreate.int.test.ts` as regressions. Then
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/tl-2b-w1-tsc.log 2>&1` and report errors in
your files (other lanes may have errors of their own: list them, do not fix them). `npx prettier --check` your
files.

## Report (your final message)

Changed files; the final signatures; which tables have a line column and how the scan reads them; where in create
the call sits and the line numbers proving the create pipeline runs after it; tests run with pass/fail counts and
log paths; anything you assumed; **Noticed, not done**.
