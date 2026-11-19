# BRIEF — build lane `tl-2` — on a lorebook that keeps a timeline, play never writes dated lore without a date (programme 1.7)

Supersedes `BRIEF-tl-1.md`. Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk`
(SDK: edit it there; never `git checkout / restore / stash` in it). Supervisor: read
`.claude/guides/multi-agent.md`, then `plans/INVENTORY-undated-lore-writes-2026-11-16.md` and
`plans/INVENTORY-timeline-stance-2026-11-16.md` (**re-verify every file:line**), the programme's "Latest
rulings" block (`plans/PLAN-programme-2026-11-15.md`, "Timelines and writes"), `docs/lorebook-time.md`,
`docs/sessions.md` (starting a session; the story clock), `NOMENCLATURE.md` §1, §24 and the rows **timeline**,
**story clock**, **story now**, **Perpetual**, **Beginning**, `../serene-pub-sdk/INTEGRATING.md` (the steps on
story time and lore writes: by section).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write` (nor a scratch-copy equivalent). Never commit.
Never `npm test` / `npm run build` at the SDK root. Before `npm run sdk:build` (app root): `pgrep -af "vite"`
(dev / preview up → do not build; report "blocked on your dev server") and wait until no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2-<n>.log 2>&1"`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. Migrations are generated only
(`npm run db:generate`; index above the journal's highest, 0168 today); none is expected. Inside
`db.transaction` only `tx`. No full run, no `npm run build`.

## Owner (2026-11-16; all in the programme's Latest rulings)

- "I think we should enforce true type safety for dates."
- "Genres must respect timelines if they are writing to the lore book. Refuse the fucking write if dated
  entries don't get a date"
- "This is what we are enforcing type safety on timelines lorebooks"
- "Sessions are locked to one lorebook for now" / "Once the session starts, the lorebook can't be swapped."
- 2026-11-15: core values "shouldn't be something that could get changed or fucked up in a way that another
  session suddenly can't use it properly."
Standing: 0.6 is in users' hands (a change to stored data ships with a boot pass and a second-boot test); P1
(every automatic action shows its cause and how to undo it); P3 (a fresh install plays after one guided step);
prompts: comprehension and fidelity first; compareDates is the one ordering key.

## The rules to build

**R-A. A session on a timeline lorebook always has a story "now".** Today a timeline lorebook can exist with no
clock and no dated history (new lorebooks start that way), so story now is null and every play write below goes
undated. Fix at the source:
- When a session **starts** on a lorebook whose timeline is on and whose line has no story now, the line's
  present is established first: the calendar's first moment, the same value `advance-story-clock` already starts
  from (`state/storyTime.ts` ~387, 465–473). It is written through the module that owns the story clock, shown
  (the start form says what the story's date will be before the session is made; the session's first run
  records it), and changeable (the story clock control). ★ in the report: the sentence, and whether the start
  form should offer the date as an editable field instead of stating it.
- The same guarantee for **existing** sessions and lorebooks: a per-boot pass (`pipelines/boot/`-style, after
  the passes it depends on; pattern `replyTickDrop.ts`) or a check at run start establishes "now" for any
  timeline lorebook line that has none; a second boot changes nothing. Report the count on a scratch database.
- Chat and Guide on an attached timeline lorebook read that lorebook's now (they have no clock of their own):
  covered by the same rule. Their own notes book has the timeline off: untouched.

**R-B. Play writes on a timeline lorebook are dated with the session's story now, or refused.** Every host
commit in the inventory's §2 table dates its row from one helper that returns the session's story now (clock,
else the newest dated history entry: `storyNowOf`'s rule, not `reading.moment` alone): an entry's Beginning when
the type's default is "began", links, `update-lore-entry` (a dated version, never "in place on the base row" by
accident), held changes, cast versions, knowledge ties, scene open / close stamps, stats, settle. If, despite
R-A, no now exists, the write is **refused**: nothing stored, `written: false` with one sentence in the
receipt (★: *This lorebook keeps a timeline and the story has no date yet. Set the story's date, then try
again.*), the run goes on as it does for the existing history refusal (state which writes halt the node and
which return `written: false`; follow each outlet's existing refusal contract).
- A pipeline may still state an explicit date where the outlet's fields allow it (a history entry's year); an
  explicit **Perpetual** / "from the beginning" by a pipeline is allowed only where the entry type's declared
  default says so (`lorebooks/entryDefaults.ts`): a type that defaults to Perpetual is not "dated lore".
- Session notes → Apply (`lorebooks/ownBook.ts`): a held change made under R-B is dated; an old undated held
  change folds as today (say so in the docs; do not invent dates for it).

**R-C. What a person writes by hand is their choice.** Perpetual, an undated link, a hand tie "on every line",
an author's undated cast version on main: unchanged. A history entry a person creates with no year keeps
today's defaults (it gets a date). No change to import, duplicate, the attic.

**R-D. Switching a timeline on never leaves an inherently dated row undated.** The timeline pass
(`lorebooks/timelinePass.ts`, `sockets/lorebooks.ts` ~1059–1155): after it, every history entry of the book has
a date and the line has a now (R-A). If the pass cannot date a legacy undated history entry, it refuses to
switch the timeline on and says which entries need a date. Report what it does today first.

**R-E. A started session's lorebook cannot be swapped.** Find every path that changes `sessions`' lorebook
(update handlers, preset switch, branch, import, plugin, the attic, admin tools). Each refuses for a started
session with one sentence (★: *A session keeps the lorebook it started with.*); branch and "next chapter"
create a new session and are not swaps (verify). A guard test holds the rule. Define "started" from the code
(first message? created?) and say which.

**R-F. The run is told, typed, whether its session has a timeline.** One fact on what the SDK hands a run
(🚧 on the session scope or input: `timeline: boolean`; name ★), filled from `sessionTimelineOf`, documented as
fixed for the session's life except when the lorebook's owner flips the switch (R-D). With it `true`,
`current-date` is always present (R-A makes that true): mark what the variable docs can now promise. No
"stance" on genres or presets; `GenreDecl.timeline: 'required'` and `defaults.timeline` are untouched.

## Order of work

1. Inventory deltas the two inventories did not answer: what "started" means; every lorebook-swap path; what
   the timeline pass does to legacy undated history; where the start form learns the lorebook's now.
2. R-A (start + boot pass), R-E. 3. R-B, outlet by outlet, each with its test, the pinned tests in the
   inventory §6 changed on purpose (list each: old expectation → new). 4. R-D. 5. R-F + docs + names.

## Files owned

App: `state/storyTime.ts`, `state/reading.ts` (the dating helper), `pipelines/runtime/host.ts` (the commit
cases' dating only), `host.loreWrites.ts`, `characters/versions.ts` (the play write path only),
`scenes/liveScenes.ts` (stamps), `state/write.ts`, `state/durable.ts`, `sessions/settle.ts`,
`lorebooks/ownBook.ts` (held changes' dating), `lorebooks/timelinePass.ts`, `sockets/lorebooks.ts` (the timeline
switch), `sockets/sessions.create.ts`, `sockets/sessions.update.ts` and any other swap path found, a new boot
pass, `client/components/sessionForms/StartSessionForm.svelte` (the one line about the date), their tests,
`docs/lorebook-time.md`, `docs/sessions.md`, `NOMENCLATURE.md`. SDK: the one typed fact, `INTEGRATING.md`, the
variable docs. Lanes `kn-4a2` (`client/lorebooks/*`, `lorebooks/entryKnowledge.ts`) and `ss-5-fix` (session
settings, `pipelines/registrations`, `routines/sessionRoutines.ts`) are running: not their files; `host.ts` and
`host.loreWrites.ts` hold other lanes' uncommitted edits: small targeted edits, re-read before each.

## Out of scope

A stance on genres or presets; locking which lorebook a genre accepts; new date ports on outlets; changing
hand-written undated lore; dating old undated rows retroactively (beyond R-A's "now" and R-D's history
entries); the Line picker; presence.

## Stop and ask when

CLAUDE.md §Decisions applies; R-A would change the date an existing session's next reply reads in a way a
player would notice (report the cases and counts before building the boot pass); a write cannot be dated
without changing which line or branch it lands on; R-B makes a shipped genre's ordinary play refuse a write
(Story, the Lair, Dungeon Crawler, Chat, Guide on a fresh install: prove each plays a first turn with every
write stored and dated); R-E would refuse something the app itself does on purpose.

## Done means

Tests (capped): R-A (start on a fresh timeline lorebook: a now exists before the first run; boot pass, second
boot; Chat on an attached timeline lorebook); R-B per write (dated with now; refused with the sentence when no
now; hand writes unchanged); R-D; R-E (each path, the guard); R-F (the fact, `current-date` present); a first
turn of each shipped genre on a fresh install; both prompt baselines and the parity harness (a changed prompt
is a finding to report, with the diff); `sdk:build` and `npm run sdk:test` (capped; standing failures only) if
SDK source changed. `tsc` 0; `npm run check` 0 errors in lane files.

## Report

Final message = the report (lead saves `plans/REPORT-tl-2-<date>.md`): what "started" means; R-A as built and
the counts; per write, how it is dated and what a refusal does; pinned tests changed (old → new); swap paths
closed; the typed fact; every sentence (★); **Noticed, not done**. Under about 900 words.

## Cold review corrections (2026-11-16) — these rule over the text above. The lane is cut in two

### `tl-2a` — builds now

- **R-E is an audit, not a build.** The rule is already ruled and built: `sessions/bookLock.ts` 1–15 (★B-5,
  owner 2026-11-08: "The book is chosen when the session is made and never moved after — not before play, not
  after."); the sentence ships (`shared/lorebooks/sessionNotes.ts:86` `BOOK_LOCK_REFUSAL` = "A session keeps the
  lorebook it started with."); enforced at `sockets/sessions.update.ts` 151–167; tested in
  `sessions/bookLock.int.test.ts`. "Started" means created. Audit every other writer of the session's lorebook
  (`appletSessions.ts`, import, plugins, the attic, admin tools, the preset switch) against `bookChangeRefusal`;
  close any that bypass it, through that function, with the existing sentence; add a source-scanning guard that
  no other code writes the column. No new sentence, no ★.
- **R-F:** the typed fact that a run's session has a timeline, as written above. It promises only what is true
  today: with it `false` there are no dates; with it `true` a date **may still be absent** until `tl-2b` is ruled
  (the docs say exactly that).
- **R-D as a report only:** what the timeline pass does today when a timeline is switched on over undated
  history entries; the count of timeline lorebook lines with no story now on a scratch database; **no data is
  changed** in this lane.
- Not in `tl-2a`: R-A, R-B, the boot pass, any change to what a write stores.

### `tl-2b` — not launched: waits on the owner (DISCUSS-LATER D47)

- **R-A conflicts with a ruling.** `PLAN-sensible-engine-2026-11-11.md` 534–556 (§2.11, RULED 2026-11-11): "A
  story with no clock is not started by this tick … otherwise every casual session would begin stamping its
  lines 'Year 1, month 1, day 1'." (built: `core-catalog/src/shared/roundTick.ts` 10–15). The line's clock has
  one writer, the book editor (`PLAN-history-one-per-date-2026-11-10.md:341`); a session's own clock is the
  session's. Writing a line's clock at boot would cut every row dated after it out of existing sessions'
  prompts. If R-A is ruled in: it writes only the **session's** clock, at create (the existing path,
  `sockets/sessions.create.ts` 433–445, 746–758; Dungeon Crawler's create already sets one,
  `core-catalog/src/genres/dungeon-crawler/create.ts` 196–199); no boot pass writes lorebook lines.
- **R-B narrowed.** On the optionally dated columns NULL is a meaningful value ("from the beginning, read on
  every line"); `update-lore-entry` in place with no moment is a documented choice (`host.ts` 315–326); a
  step's own default beats the entry type's (`lorebooks/entryDefaults.ts` 4–8, 113–114). So: **refuse only rows
  that must carry a date** (history, already refused; scene open / close stamps; held dated changes;
  `cast_amendments`); a row that may carry a date takes the story's now when one exists and stays NULL when the
  story has none; Perpetual is judged by the resolved default (step, else type). Minimal "writes undated" on a
  timeline lorebook was ruled 2026-11-13 (`NOTES-entry-time-and-lines-2026-11-13.md` 249–259) and revised the
  same day into a reading the owner has not confirmed: quote both to him.
