# BRIEF — build lane `tl-2b` — a lorebook that keeps a timeline always has a date; nothing falls back to 1-1-1; play's writes are dated (programme 1.7, second half)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then the programme's
"Latest rulings" (`plans/PLAN-programme-2026-11-15.md`: "Timelines and writes" and "A story's first date"),
`plans/INVENTORY-undated-lore-writes-2026-11-16.md` and `plans/INVENTORY-timeline-stance-2026-11-16.md`
(**re-verify every file:line**), `plans/briefs/BRIEF-tl-2.md` (only its "Cold review corrections": what is
undated on purpose; the line clock's single writer), the report of lane `tl-2a` if it exists
(`plans/REPORT-tl-2a-*.md`: the typed fact and the timeline-pass report), `docs/lorebook-time.md`,
`docs/sessions.md` (starting a session), `NOMENCLATURE.md` §1, §24 and the rows **timeline**, **story clock**,
**story now**, **Beginning**, **Perpetual**, **calendar**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write` (nor a scratch-copy equivalent). Never commit.
Never `npm test` / `npm run build` at the SDK root. Before `npm run sdk:build` (app root): `pgrep -af "vite"`
(dev / preview up → do not build; report "blocked on your dev server") and wait until no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2b-<n>.log 2>&1"`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. Migrations are generated only
(`npm run db:generate`; index above the journal's highest); none is expected. Inside `db.transaction` only
`tx`. No full run, no `npm run build`.

## Owner (2026-11-16)

- "I think we should enforce true type safety for dates." / "Genres must respect timelines if they are writing
  to the lore book. Refuse the fucking write if dated entries don't get a date" / "This is what we are enforcing
  type safety on timelines lorebooks"
- "If the genre/preset supports undated, use undated by default. With dating on, default to real calendar. For
  an existing lorebook, default to the most recently active point. There shouldn't be a scenario where it
  defaults to 1-1-1. The exception would be if the genre/presets session init pipeline changes the date."
Standing: 0.6 is in users' hands (stored-data changes ship with a boot pass and a second-boot test); P1; P3;
compareDates is the one ordering key; the line's clock has one writer, the book editor
(`PLAN-history-one-per-date-2026-11-10.md:341`); a session's own clock is the session's.

## The rules to build

**T1. No 1-1-1 anywhere.** Remove every fallback to year 1 / month 1 / day 1 (or "the calendar's first
moment"): `state/storyTime.ts` ~387, 465–473, 508 (`advance-story-clock` with no clock);
`utils/lorebookEntries.ts` 418–420 and the history entry type's `year` default 1
(`sdk:core-catalog/src/registry/entries.ts` 242–254: the declared default; changing a declared default re-pins
that definition's hash: do it, with "(was …)"); `sockets/entries.ts` 970–984 and `messages/writes.ts` 329–341
(a person's history entry with no year); `scenes/historyEntryOfDate.ts` 151–155 (scene compile);
`utils/lorebookImportMapper.ts` 963–966 (import). Grep for others (`year: 1`, `{ year: 1, month: 1, day: 1 }`,
`?? 1` beside a year). Each uses the story's now (T2 makes one exist), or for a person's write with no now
refuses with a sentence that says how to give the story a date; import of a history entry with no year: report
what the file formats can carry and propose (★) before choosing (keep / refuse / date at import time).
A guard test fails on a new literal year-1 fallback in the story-time, entries, scenes and import modules.

**T2. A session that starts on a lorebook with a timeline has a story "now", from the first moment:**
- **A new lorebook made for the session** (its own notes book, or a new attached book) that keeps a timeline
  starts **on the real calendar** (the Gregorian calendar definition the app already ships: find it; if the
  default calendar for a new book is not the real one today, this changes that default: say so) **at today's
  real date** (the server's local date and time at creation; state which clock and time zone, and make it
  injectable for tests). Written as the **session's** clock at create (the existing path,
  `sockets/sessions.create.ts` 433–445, 746–758), not the line's.
- **An existing lorebook:** the session starts at that lorebook's **most recently active point**: 🚧 define it
  once, in `state/storyTime.ts`, as the line's clock if set; else the latest date found on the line among
  everything dated (history entries, dated versions and amendments, Beginnings, scenes' clocks, message stamps
  of its sessions: decide the list from what `compareDates` can order and say which), so no dated row is cut
  out of the session's reading; if the line holds **no date at all**: today's real date when the book's calendar
  is the real one; otherwise (a custom calendar with no date anywhere) the start form asks for the date and the
  session is not created without one (★ the sentence).
- **The start form** shows the date the story will begin on before the session is made, with its cause in a
  few words (*today* / *where ‹lorebook› last was*), and lets the owner change it (★ wording; reuse the existing
  story clock control if the form has one for "branch-off").
- **The exception:** a genre's or preset's create pipeline may set another date (Dungeon Crawler's does,
  `sdk:core-catalog/src/genres/dungeon-crawler/create.ts` 196–199): its write wins over T2's default. Verify
  the order of operations makes that true and test it.
- **Existing sessions** on a timeline lorebook with no story now (created before this lane): at their next run
  start the same rule gives them a now (existing-lorebook rule; then today's date), written to the session's
  clock, once, recorded in the run's receipt; **no boot pass writes lorebook lines**. Count such sessions on a
  scratch database and report. Stop and report if giving them a now would drop rows from their reading.

**T3. "Undated by default where the genre / preset supports it".** DISCUSS-LATER D48 is open on what this
means for Story. **Build nothing that changes which sessions start with a timeline** (`timelineDefaultFor`,
`lorebooks/timeline.ts` 59–69, stays as it is) unless the lead's launch message says D48 was answered.

**T4. Play's writes on a timeline lorebook are dated with the session's story now.** With T2 a now always
exists, so each host write in the inventory's §2 table that today falls to NULL **because the session had no
moment** takes the story's now: a new entry's Beginning when its resolved default (the step's, else the entry
type's: `lorebooks/entryDefaults.ts`) is "began"; links; `update-lore-entry` (a dated version); held changes;
cast versions; knowledge ties; scene open / close stamps; stats; settle. **Undated on purpose stays undated:**
a resolved default of Perpetual; a step that asks for "from the beginning"; what a person writes by hand.
Use one helper for "the date this write carries" (story now: clock, else the most recently active point), not
`reading.moment` alone.
**The backstop (the owner's refusal):** if a row that **must** carry a date (a history entry; a scene's stamp;
a held dated change; a `cast_amendments` row) still has none, the write is refused: nothing stored,
`written: false` with one sentence in the receipt (★: *This lorebook keeps a timeline and the story has no date
yet. Set the story's date, then try again.*), following each outlet's existing refusal contract.

**T5. Switching a timeline on** (`lorebooks/timelinePass.ts`, `sockets/lorebooks.ts` ~1059–1155) leaves no
history entry undated and no 1-1-1: use lane `tl-2a`'s report; undated history entries are listed to the owner,
who dates them, and the switch is refused until then (★ sentence), unless the report shows the pass already
dates them soundly.

## Order of work

1. Deltas to the inventories: every 1-1-1 site; the shipped calendars and what a new book gets; where the start
   form learns a lorebook's present; counts on a scratch database. 2. T2 (create, start form, existing
   sessions). 3. T1. 4. T4, write by write, with the pinned tests of the inventory's §6 changed on purpose (list
   each: old → new). 5. T5, docs, names.

## Files owned

App: `state/storyTime.ts`, `state/reading.ts` (the dating helper), `sockets/sessions.create.ts`,
`pipelines/runtime/host.ts` (commit cases' dating only), `host.loreWrites.ts`, `characters/versions.ts` (the
play path), `scenes/liveScenes.ts`, `scenes/historyEntryOfDate.ts`, `state/write.ts`, `state/durable.ts`,
`sessions/settle.ts`, `lorebooks/ownBook.ts` (held changes' dating), `lorebooks/timelinePass.ts`,
`sockets/lorebooks.ts` (the switch), `sockets/entries.ts`, `messages/writes.ts`, `utils/lorebookEntries.ts`,
`utils/lorebookImportMapper.ts`, the start form (`client/components/sessionForms/StartSessionForm.svelte` and
its store) for the date line only, tests, `docs/lorebook-time.md`, `docs/sessions.md`, `NOMENCLATURE.md`.
SDK: the history entry type's default, `advance-story-clock`'s docs, `INTEGRATING.md`; `sdk:build` and
`npm run sdk:test` (capped; the standing failures only). `host.ts` and `host.loreWrites.ts` hold other lanes'
uncommitted edits: small targeted edits, re-read before each.

## Out of scope

Which sessions start with a timeline (T3 / D48); a stance on genres; new date ports on outlets; dating old
undated rows retroactively; the Line picker; presence; a session's lorebook lock (lane `tl-2a`).

## Stop and ask when

CLAUDE.md §Decisions applies; "most recently active point" cannot be computed without cutting rows from an
existing session's reading; a shipped genre's ordinary first turn would refuse a write (prove Story, the Lair,
Dungeon Crawler, Chat and Guide each play a first turn on a fresh install with every write stored, and dated
where the lorebook keeps a timeline); a prompt baseline changes for a session that already had a clock; the
real calendar is not available as a shipped definition; a migration.

## Done means

Tests (capped): T1 (each site; the guard); T2 (new book: real calendar, today's injected date; existing book:
clock, latest dated row, no date at all on a real and on a custom calendar; the create pipeline's date wins;
an existing session gets a now once); T4 per write (dated with now; on-purpose undated unchanged; the backstop
refusal); T5; a first turn of each shipped genre; both prompt baselines and the parity harness (a changed
prompt is reported with its diff and cause: a session that had no date now has one is the expected cause);
`sdk:test`. `tsc` 0; `npm run check` 0 errors in lane files.

## Report

Final message = the report (lead saves `plans/REPORT-tl-2b-<date>.md`): every 1-1-1 site removed; how a story
gets its first date in each case and what "most recently active point" is; per write, how it is dated;
pinned tests changed (old → new); counts; every sentence (★); **Noticed, not done**. Under about 900 words.

## Cold review corrections (2026-11-16) — these rule over the text above. The lane is cut again

### `tl-2b` — builds now: T1, T2 for **new sessions only**, T5

1. **An existing lorebook that has a present: write nothing.** `storyNowOf` (`state/storyTime.ts` 266–327)
   already returns the line's clock, else its newest history entry: that **is** the most recently active point.
   A session made on such a book stores no clock and follows the line (owner 2026-09-28, `storyTime.ts` 24–30;
   `sockets/sessions.create.ts` 434–437 "ruling 15"; pinned by `state/sessionStoryClock.int.test.ts` 155–184):
   keep that. The start form shows that date with *where ‹lorebook› last was*. Never derive a book's present
   from its sessions' clocks or message stamps (`storyTime.ts` 32–34 forbids it).
   Only when `storyNowOf` returns null for an existing book (no clock, no dated history entry): scan the line's
   **own** dated rows (dated versions and amendments, Beginnings; no session clocks, no message stamps) for the
   latest date; if one exists the new session starts there; if none, the new-lorebook rule below. In that gap
   only, the date is written as the **session's** clock at create.
2. **"Existing sessions" is removed from this lane.** Nothing gives an already-created session a date
   (DISCUSS-LATER D49a). No run-start write, no boot pass.
3. **The real calendar.** The shipped `twelve-months` calendar is called Gregorian in comments
   (`lorebooks/ownBook.ts:19`) but its leap rule is every 4 years (`sdk:sdk/src/storyTime.ts` 701–724, 488–503),
   so today's real date prints the wrong weekday and 29 Feb 2100 is accepted. **Stop and report** on this before
   writing any real date into a book: propose the smallest change (a Gregorian leap rule as a new
   `StoryLeapRule` variant and whether `twelve-months` adopts it or a new calendar is added: both are the
   owner's, D49b). Build the mechanism meanwhile: "today" comes from one injectable function, in the session
   owner's `users.timeZone` (as `pipelines/routines/tick.ts` 65–75 does), else the server's; date **and** time;
   a free-form book (NULL calendar: new shared lorebooks, `db/schema.ts:1396`) takes today's date as it lands
   and is **not** asked for one (the "custom calendar → the form asks" branch applies only to a calendar on
   which today's date does not land). "Today's real date" is the lead's reading of "default to real calendar"
   (D49b): mark it 🚧 in the docs.
4. **T1:** removing the history entry type's `default: 1` needs no boot pass (the boot CHECK is built from
   `required`, `pipelines/boot/entryProjection.ts` 230–232). A person's new history entry in a lorebook with no
   present at all gets today's date by the same function (not a refusal), once item 3 is settled; until then it
   keeps asking for a year in the form (find what the form does) rather than inventing year 1.
5. **Not in this lane:** T4 and the backstop (lane `tl-2c`), which also carries the open Minimal item (D49c).

### `tl-2c` — not launched: T4 and the backstop refusal

Waits on D49a (existing campaigns with no date) and D49c (Story: Minimal on a timeline lorebook: "writes
undated", ruled 2026-11-13, and its same-day revision, `NOTES-entry-time-and-lines-2026-11-13.md` 249–259).
