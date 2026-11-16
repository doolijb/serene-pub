# BRIEF — build lane `timeline-a` — a lorebook's Timeline switch, server half

**A go (owner, 2026-11-14: "Go: both lanes side by side").** Reviewed cold; the corrections below rule.

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1, §2, §6 (lane T1) and §10, `docs/lorebook-time.md` (whole: it is
the behaviour this switch turns off), `docs/lorebooks.md` "Your session's own notes", `docs/sessions.md` "Where the
session reads its lorebook", CLAUDE.md Hard rules (migrations), Principles, Standing rulings, NOMENCLATURE §1, §23,
§24, §25. Line numbers are from 2026-11-13/14: search by name.

Words. A **build lane** is this stream of work. A lorebook's **timeline** is everything in `docs/lorebook-time.md`:
dates on entries, dated changes, history entries, the calendar, the story clock, the moment bar. **Lines**
(branches) are not part of it: a branched session forks a line whether or not the lorebook has a timeline.

## Rulings that bind (owner, 2026-11-13 and 14)

- "We also need to make sure to hide all the extra time management noise in entries and the lorebook when
  timelines aren't enabled in the lorebook."
- "No history entries for undated lorebooks, maybe scenes only."
- "Switch off, allow, but prompt the user with a recommendation to clone as a timeless variant instead. Do not
  provide SDK api for this yet." (The prompt and the copy are lanes `timeline-b` and `timeline-c`, not this one.)
- "By default, Story Minimal will use an undated book. Messages will just display real time. All other Story
  presets will continue defaulting to timelined storybooks."
- "the time incriment should be a property of whether the lorebook has it's own calendar or if the session is
  following real time"; Minimal on a timelined lorebook advances story time "as it does today".
- "Lets go with all your recommendations" (2026-11-14), which rules the plan's proposals: the switch is named
  **Timeline**; a lorebook that already holds anything dated, a set clock or a second line is switched on by a
  boot pass; Chat and Guide default to undated like Minimal; the Lair and Dungeon Crawler stay timelined;
  switching off never deletes anything, and a switched-off lorebook is read as it stands now.
- Standing: 0.6 is in users' hands (a forward migration or boot pass, and a test that a second boot changes
  nothing); genres expect, never lock; P1 (an automatic behaviour shows its cause).

## Corrections from the cold review (2026-11-14) — these override anything below that disagrees

1. **This lane is slices 1 and 2 only.** Slice 1: the flag with no behaviour (the column from a generated
   migration, the one-shot pass, the shared test function, `timelineOf`, the flag on the wire). Slice 2: the rule
   (below), the owner-only setter, the refusal sentences. **Every creation path stays as today**: no default for
   new hand-made lorebooks, no preset expectation, no fit sentence, no message-stamp work in the client. Those
   are slice 3 and land with lane `timeline-b` after the owner rules them.
2. **The rule lives in four helpers, not where the brief first aimed.** The story date comes from `storyNowOf` /
   `sessionStoryNowOf` (`src/lib/server/state/storyTime.ts` ~251, ~358), which feed the prompt's date
   (`pipelines/prompt/assemble.ts` ~363), every message's story stamp (`messages/store.ts`
   `withStoryClockStamp` ~95–108), scene names (`scenes/liveScenes.ts` ~146), ages (`state/resolve.ts` ~809) and
   nine sites in `host.ts`. Write dating comes from `writeDatingAt` (`state/reading.ts` ~486), which with no
   moment still returns the line's newest dated history entry and so dates stats, cast versions, links and
   history days. Every clock move ends in `moveSessionStoryClock` (`storyTime.ts` ~456), which starts a clock at
   the first story day when there is none. So, with the timeline off:
   - `sessionReadingOf` (and `readingOf`): the head, moment null, with the session's, the lorebook's **and the
     branch's** clock ignored (`linePresentOf`, `reading.ts` ~361, ~385); fork cuts stay;
   - `writeDatingAt`: null;
   - `storyNowOf` / `sessionStoryNowOf`: null (messages then get no story stamp at the source, and the round tick
     already does nothing with no present: `core-catalog` `shared/roundTick.ts`);
   - `moveSessionStoryClock`: refused with a sentence (it is reached from the clock outlet `host.ts` ~10516,
     accepted proposals and the reckoning `state/write.ts` ~1428, ~3194, **Time passes…** and setting the clock by
     hand `sockets/storyClock.ts` ~172, and Story's **After a rest** routine).
   `clock-step` is not the place (`pipelines/runtime/clockStep.ts` serves Chat's reply and **Time passes…**).
   `src/lib/server/state/storyTime.ts` is **owned**; the `host.ts` work shrinks to the history-day and
   held-change points; `sockets/storyClock.ts` is owned for its refusal sentence only.
3. **The pass runs once, never again.** A startup task with a `doneMarker` (`startup/bootMarkers.ts` ~9–13),
   registered after `attic` and `dc-crawl-clock` (0.5.3 history arrives through the attic task; the crawl-clock
   pass sets session clocks). It must not re-decide on later boots: a person's later switch-off stands, and a
   lorebook that gains a dated row later is not switched on by it. The test of "holds something dated" is one
   shared function, also called by the attic's lore step (`attic/etl/lore.ts`) and by lorebook import
   (`sockets/import.ts` ~888) so an arriving dated lorebook lands on; those two files are owned for that call
   only. The test: one EXISTS per table: `entry_amendments`, `cast_amendments`, `character_versions` with a
   date, `narrative_relationships.history_entry_id`, dated `attribute_values`, history entries with a numeric
   year, a clock on the lorebook, a branch or a session reading it, a `story_calendar` row that is not the
   default, more than one branch. Fresh installs: nothing to do. Tests: a second boot changes nothing **and** a
   switch-off between two boots survives the second.
4. **Whose switch governs.** A session that reads an attached lorebook follows **that lorebook's** switch; its
   notes copy the switch when they are made (`lorebooks/ownBook.ts` ~752 makes notes from a parent and copies its
   calendar and clock: cover it) and when the parent's switch changes. The notes' own switch decides only for a
   session whose lorebook is its notes.
5. **Facts.** `lineOfBook` takes no moment and is not a read site. "Reading at now" today is not one thing: a
   session with no clock reads at the line's present when a lorebook or branch clock is set. A duplicate copies
   every column (`utils/lorebookDuplicate.ts` ~83–93); there are nine lorebook insert sites: each takes the
   column default in this lane. Scenes store opening and closing clocks (`db/schema.ts` ~4901–4907); history-day
   writes fall back to Year 1, month 1, day 1 (`messages/writes.ts` ~334, `scenes/historyEntryOfDate.ts` ~155):
   with the timeline off those writes are refused before the fallback. `stepBackSessionStoryClock`
   (`storyTime.ts` ~519) may still move a hidden clock when a message whose move was made while on is deleted:
   harmless; keep the byte-identical test clear of that case and say so.

6. **Migration order with the other lane.** Lane `edit-history-a` builds beside this one and also generates a
   migration. **You generate first**: add the column, run `npm run db:generate` early (re-read the highest index
   in `drizzle/meta/_journal.json` first; another Claude session may also have generated since 0159), then write
   the new migration's file name into `plans/timeline-a-migration.txt`. The other lane waits for that file.
   Do not regenerate afterwards; if the schema needs a second change, stop and report.

## The rule to build

A lorebook has one stored flag, 🚧 **timeline** (name per §24). **On** is everything as today. **Off** means, for
every reader and writer of that lorebook:

1. **Read as it stands now.** A session, the lorebook's own pages and every pipeline read the lorebook with no
   moment: the base of each entry with every dated change applied that is in force "now" on the line (what
   reading at **now** does today). A session's stored clock is ignored while the lorebook's timeline is off; it
   is not cleared.
2. **Write undated.** A session's pipelines write entries with no date and changes with no date; nothing is
   filed as a dated change; no history day is written and nothing is compiled into history; a step that would
   write one answers with a sentence in the run's notes (🚧 *This lorebook has no timeline, so no history is
   kept.*) and the run goes on.
3. **Time does not move.** The round's clock step does nothing (find it: the wiring conformance mentions
   `clock-step.unless`; the story clock rules are `docs/lorebook-time.md` ~100–138). Nothing sets a clock on the
   lorebook or the session.
4. **Nothing is deleted.** Dated changes, history entries, the calendar and the clock stay stored and come back
   when the flag is switched on.
5. **Lines are untouched** by the flag.

Which lorebooks start how:
- **Existing lorebooks:** a boot pass (not a hand-written migration; the column itself comes from a generated
  migration with a default) sets the flag **on** for a lorebook that holds any dated entry, any dated change, any
  history entry, a set clock (on the lorebook or on a session reading it), a calendar that is not the default, or
  a second line; **off** otherwise. A second boot changes nothing (test). Session notes follow the same rule.
- **New lorebooks made by a person:** off. (The Book settings card that switches it is lane `timeline-b`; this
  lane adds the socket path that sets it, owner-only.)
- **New sessions' notes:** on when the session's preset expects a timeline, off otherwise. The expectation is
  the genre's or preset's (genres expect, never lock): Story Living and Rule Based, the Lair, Dungeon Crawler
  expect one; Story Minimal, Chat and Guide do not. Find where a preset states what it plays best with
  (`../serene-pub-sdk/sdk/src/fit.ts`) and whether an existing statement can carry this (a clock or calendar
  expectation) **without a new published SDK name**; if it needs one, **stop and report** the smallest shape.
- **A session started on an existing lorebook** takes that lorebook as it is: Minimal on a timelined lorebook
  keeps story time exactly as today; a timeline-expecting preset on a lorebook with the timeline off plays
  undated, and the session's fit line says so in words (P1; find the fit sentences).
- A starter's copy and a duplicate carry the flag with the lorebook row.

Messages: when the lorebook a session reads (its notes included) has the timeline off, a message shows the real
time it was written and no story date (find where a message's story-time stamp is drawn; client, one place).

## Build

1. The flag: schema column with a default, `npm run db:generate` (re-read the highest index first: it was 0159
   on 2026-11-13 and another session generates migrations; the new index must exceed the highest applied), the
   boot pass with its second-boot test, the table registry / export / starter kit paths that copy a lorebook row.
2. One reader, 🚧 `timelineOf(lorebook)` or similar, that every site asks; no site reads the column by itself.
3. The read rule at the one place a reading is made (`server/state/reading.ts`: `sessionReadingOf`, `readingOf`,
   `lineOfBook`): timeline off → no moment. List every other site that passes a date or clock into a read and
   say what each does now.
4. The write rule at the outlets that date things (`pipelines/runtime/host.ts`: the lore outlets'
   dated-change path, `fileOntoHistoryDay`, the compile and scene-summary paths in `sockets/scenes.ts`, the
   clock outlets). Refusals are sentences in the run's notes, never an error that stops a turn.
5. The clock step.
6. New sessions' notes (`lorebooks/ownBook.ts` `insertOwnBook`; `sockets/sessions.ts` create) and the fit
   sentence.
7. The socket path that sets the flag (owner-only; the lorebook's settings event family; no new event if an
   existing lorebook update can carry it), sending the flag in the lorebook's wire shape.
8. The message stamp (client, one component).
9. Docs in the same change: `docs/lorebook-time.md` (a new opening section: the switch, what off means),
   `docs/lorebooks.md`, `docs/sessions.md`, `docs/genre-story.md`; NOMENCLATURE row and §25.

## Files owned

`src/lib/server/db/schema.ts` (the one column) and the generated migration; a new boot pass under the existing
boot-pass home (find it; `startup/index.ts` only to register it); `src/lib/server/state/reading.ts`;
`src/lib/server/pipelines/runtime/host.ts` (the dated-write points only); `src/lib/server/sockets/scenes.ts`
(compile and history refusals only); the clock step's binding; `src/lib/server/lorebooks/ownBook.ts`
(`insertOwnBook`); `src/lib/server/sockets/sessions.ts` (create: the notes' flag only);
`src/lib/server/sockets/lorebooks.ts` (the flag on the wire and the setter); `src/lib/shared/sockets/types.ts`;
`src/lib/server/lorebooks/tableRegistry.ts` only if a lorebook row's columns are listed there; the one client
component that draws a message's time; their tests; the docs above; `NOMENCLATURE.md`. **No SDK source file**
unless the stop above is answered by the lead.

## Out of scope

Every screen (hiding the moment bar, dates, versions, the Book settings card, the switch-off prompt, the Scenes
list: lane `timeline-b`); the timeless copy (`timeline-c`); Beginning and Decay; the versions timeline; any SDK
surface for the switch; deleting or converting dated data; lines; the edit history.

## Stop and ask when

A preset's expectation needs a new published SDK name; "read as it stands now" is not what reading at **now**
does today for some reader; a write path cannot go undated without losing something a session needs (say what);
the boot pass cannot tell "holds something dated" from stored facts; the migration index is contested; a file
outside the owned list is needed.

## Done means

Tests: the boot pass sets on / off by each stored fact and a second boot changes nothing; with the timeline off
a session with a stored clock reads the lorebook as at now, its pipelines write undated entries and changes,
no history day is written, the compile refusal is a sentence, the clock does not move, and the stored dated
changes, history entries, calendar and clock are byte-identical before and after a played turn; switching on
restores dated reading; Story Minimal's new session has notes with the timeline off and Story Living's on;
Minimal on a timelined lorebook advances story time as before (an existing test must still pass unchanged);
a duplicate and a starter copy keep the flag; only the lorebook's owner may set it; the message stamp (DOM
test). The existing suites pass: `server/state`, `server/lorebooks`, `server/scenes`, the `runtime/host.*`
tests, the session-create tests, the Lair socket tests.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean; `npm run check`
(`NODE_OPTIONS=--max-old-space-size=12288`) no new errors. Tests only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > log 2>&1"`
from the repo root, one run at a time; another session also runs tests and SDK builds here: before each run
check `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait (never `pgrep -f "vitest run"`
in a loop). An int test that opens a DB inside an `it` takes a 60 s timeout. No `npm run sdk:build`. Inside a
transaction use only `tx`. Never seed a row at a hardcoded id. Comments state the rule, not the story. At most
two workers at once.

Verbatim for every worker brief:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `kill -9`.

## Report

**Return the full report as your final message** (the lead saves it as
`plans/REPORT-timeline-a-<date>.md`): the rule as built; the flag's name and where it is read; every site that
reads with a date and what it does with the timeline off; every dated write and what it does; the boot pass's
exact rule; how a preset states its expectation; the migration's index and name; copy verbatim; changed files;
tests and results; open ★; **Noticed, not done**. Say plainly that nothing was looked at in a running app.
