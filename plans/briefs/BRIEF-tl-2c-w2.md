# BRIEF — worker `tl-2c-w2` — tests for "play's writes carry the story's date on a lorebook that keeps a timeline"

Supervisor: lane `tl-2c`. Repo: `/home/jody/github/serene-pub` (app). Paths are under `src/lib/server/` unless they
start with `src/` or `plans/`. **Tests only: you edit no production code.** If a test shows a code defect, stop and
report it with the evidence. Other lanes' uncommitted work is everywhere: re-read each test file right before
editing it; targeted edits; never a whole-file rewrite.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You run no `sdk:build`. Never `git checkout / restore / stash`; never `prettier --write`. No migration.

**Split (two workers at once, no shared files):** worker **w2** builds items **1, 2 and 7** below; worker **w4**
(`plans/briefs/BRIEF-tl-2c-w4.md` points here) builds items **3, 4, 5 and 6**. Edit only the files of your own
items. Vitest runs never overlap: always wait with the `pgrep` loop below before you start one.

## What was built (worker w1 and the supervisor; read the code, it is the truth)

`state/storyTime.ts`: `LoreWriteDate` = `{ kind: "dated"; date: StoryDate; hangsOn: number | null }` |
`{ kind: "timeless" }` | `{ kind: "undatable" }`; `loreWriteDateOf(db, sessionId)`; `UNDATED_LORE_WRITE_SENTENCE`;
`undatedLoreWriteRefusal(db, sessionId, date)` (the backstop; reads through a non-exported `readLoreWriteDate`, so
`vi.mock` of `loreWriteDateOf` leaves the backstop reading the truth). `dated` = timeline on and a story now
(`sessionStoryNowOf`: session clock, else line clock, else newest dated history entry), `date` = that day;
`timeless` = timeline off; `undatable` = timeline on, no date at all.
Callers: `pipelines/runtime/host.ts` `create-lore-entry@1` (`newEntryTime`'s `date:`; and a backstop before the
insert when the Beginning resolves to *began* and no date came), `holdLoreEntryChange` (held amendment's date +
backstop), `lorebookChangeHeld` (Beginning check on `dated`), `changeLoreEntry` (dated version on `dated` for an
attached lorebook's entry; backstop before an in-place write of one), `update-lore-entry@1`'s `datedVersion`;
`host.loreWrites.ts` `historyDateOf` (non-`countNotes`); `characters/versions.ts` `storyWrite` (`when`,
`historyEntryId` = `hangsOn` when the target is in the attached book; backstop). Notes entries are still changed in
place; links, knowledge ties, stats, settle, message and scene stamps are unchanged.

## Rules (quoted; they decide what a test must say)

- Lane brief: "each test that pins an undated write **on a timeline lorebook that has a date** changes on purpose
  (list old → new); each that pins one on a lorebook with **no date at all** stays and is renamed to say so if its
  title is ambiguous. **Never weaken an assertion.**" Stop if more than ~30 tests change.
- Cold review: "A lorebook with dated history and no clock is `dated`, on purpose … new writes change (an Item
  begins at the newest history day instead of Perpetual; `update-lore-entry` writes a dated version at that day
  instead of in place) … Rows already written do not change." "Leave `newEntryTime` alone … Test: dated history and
  no clock → World lore stays Perpetual, an Item begins at the newest history date." "`hangsOn` … is null before
  the line's first dated history entry and that stays **legal**."
- Lane brief item 4: "`undatable` (existing lorebooks with no date at all): unchanged … Tests pin this."
- Lane `tl-3a` (landed today): a new Story session's own lorebook keeps **no** timeline by default; a test that wants
  a dated Story session must state its timeline (e.g. the preset row `timeline: true`, as
  `sockets/sessions.createStoryStart.int.test.ts` does). Lane `tl-2d`: a new dated session starts with a clock set
  to today.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`". "An int test that opens a DB inside an `it`
  needs a 60 s timeout under load." "Never pipe vitest into `head`."

## Build

1. **`state/loreWriteDate.int.test.ts` (new).** `loreWriteDateOf`: session clock → `dated`, date = the clock's day;
   only the lorebook's (line's) clock → `dated`; no clock but a dated history entry → `dated`, date = newest history
   day, `hangsOn` = that entry; a clock earlier than the first dated history entry → `dated` with `hangsOn: null`;
   timeline off with a stale clock → `timeless`; timeline on, nothing dated → `undatable`; a session on its own
   notes (no attached lorebook) with a timeline and a dated notes history entry → `dated`.
   `undatedLoreWriteRefusal`: `dated` + null → `UNDATED_LORE_WRITE_SENTENCE`; `dated` + a date → null; `timeless` /
   `undatable` + null → null. Borrow the setup style of `state/sessionStoryClock.int.test.ts` or
   `pipelines/runtime/host.datedVersion.int.test.ts`.
2. **Per outlet: `dated` by clock, `dated` by history with no clock, `timeless`, `undatable`.** Add to the existing
   files, reusing their `world()` helpers; add only the cases not already covered (say which existed):
   - `create-lore-entry@1`, non-history (`pipelines/runtime/host.entryDefaults.int.test.ts`): dated history, no
     clock → an Item begins at the newest history date; World lore stays Perpetual. Existing "Timeline on with no
     clock: no date" (~201): if its lorebook has no dated row at all it is `undatable` and stays (rename to say "no
     date at all"); if it has a dated history entry it flips (old → new).
   - `update-lore-entry@1` (`host.datedVersion.int.test.ts`): dated history, no clock → a dated version at the newest
     history day, the base row untouched; **Back / retake of that turn removes the version** (follow the file's
     existing "Back on a changed version takes its keys back" test); "a session with no moment writes in place"
     (~587): same rule as above (stays and renamed if `undatable`, flips if dated). Timeless → in place.
   - held change (`host.heldEntryChange.int.test.ts`, Review changes): dated history, no clock → the held amendment
     carries the newest history day; `undatable` → held undated (existing ~279, ~323: classify as above).
   - `update-cast-member@1` (`state/ownNotesLine.int.test.ts` and/or an existing cast-member host test):
     `ownNotesLine` "with no clock a cast version on main is undated" now fails with `row.year` 15 (its notes have
     dated history and no clock): re-pin (old → new: dated at the notes' newest history day) and add the
     `undatable` twin (notes with no dated row → undated). On an attached book with dated history and no clock, a
     cast version's `historyEntryId` is the newest history entry and its `year` that entry's.
   - links / `note-entry-knowledge@1`: **verified unchanged**: one case each that, on an attached lorebook with dated
     history and no clock, the row hangs on the newest history entry, and on an `undatable` one on null (skip a case
     an existing test already asserts; name it).
3. **`pipelines/runtime/host.historyWrites.int.test.ts`.** "under Full, a change to an attached lorebook's history
   entry is written in place › moves its date through the socket's date checks…" (~352) now throws *'entry N' keeps
   its date in the lorebook, and a session's change cannot move it*: its world has dated history and no clock, so the
   change now takes the dated-version path (as it already did with a clock). Re-pin: (a) that case, on that world,
   asserts the refusal and that nothing changed (entry fields and content, no amendments) — retitle the describe
   to say so; (b) keep the socket's date-check coverage by moving the original assertions to a world where the
   history entry is the session's own notes' (`world({ own: true })`, where the change is written in place), if
   that path runs the same `moved` checks (read host.ts ~7070–7130 to confirm); if it doesn't, report and keep (a)
   only. **Do not touch** "a month or a day without a year is refused…" (~203): it fails since lane tl-2d for
   another reason (the history type now requires `year`); leave it failing and list it.
4. **The backstop (`pipelines/runtime/host.undatedWriteBackstop.int.test.ts`, new).** `vi.mock("$lib/server/state/storyTime", async (orig) => ({ ...(await orig()), loreWriteDateOf: vi.fn(async () => ({ kind: "undatable" })) }))`
   (check the mock really intercepts the dynamic `await import(...)` in host.ts; if not, report). On a session that
   is truly dated (attached lorebook under Full, session clock set): `update-lore-entry@1` on an attached entry →
   rejects with `UNDATED_LORE_WRITE_SENTENCE`, the entry unchanged, no `entry_amendments` row; Review changes (held)
   → rejects, no amendment; `create-lore-entry@1` of an Item → rejects, no new row; a World lore create → written
   Perpetual (no refusal: it stores no date). And a control: the same writes on an `undatable` session (mock
   still on) succeed undated. Cast member (`storyWrite`) too if the file's setup reaches it simply; else skip and say.
5. **The guard (`pipelines/runtime/loreWriteDate.guard.test.ts`, new),** in the manner of
   `state/noYearOneFallback.guard.test.ts` (copy its comment stripper): in `pipelines/runtime/host.ts`,
   `pipelines/runtime/host.loreWrites.ts` and `characters/versions.ts`, after comments are stripped, every line
   matching `\.moment\b`, `\bsessionStoryNowOf\(`, `\bstoryNowOf\(`, `\bmomentOf\(` or `\bwriteDatingAt\(` must be
   on the allow-list, keyed by **file + enclosing function/const name** (not line numbers) with the expected count
   and a one-line reason (e.g. "hangs a link on a history entry, not a date: links keep today's value (cold review
   1)"; "the advance-story-clock outlet moves the clock, not a lore write"; "a fork date, not a write's date";
   "counts the notes' history days for a history day (`ownBookDaysCounted`)"; "the reading a change is read at, not
   its date"). Checked both ways (a stale entry fails and names itself). Enumerate every hit, give each a true
   reason; **any hit that is a lore write's date read outside `loreWriteDateOf` is a finding: report it, don't
   allow-list it.**
6. **`sockets/sessions.lairWalk.int.test.ts`** (~633–660): run it unchanged first. Add a new test (keep the
   cleared-clock one): a freshly created Lair session (clock set at create, today) → `update-lore-entry@1` on The
   Vault writes a **dated version** at the session's day; the base row's content is unchanged; the session reads
   the new content. If the cleared-clock case now fails because the Lair lorebook holds a dated history entry by
   then (it would be `dated`, not undated), stop and report; don't change it.
7. **Run, then classify** every other test in the inventory's §6 list that you have not already handled, edit only
   those that flip on a dated lorebook: `lorebooks/applyOwnBookLinksDays.int.test.ts` (~652),
   `characters/versions.authoring.int.test.ts` (~807, an author's write: expected unchanged),
   `lorebooks/sessionLine.int.test.ts` (~168), `sockets/sessions.timePasses.int.test.ts` (~128),
   `lorebooks/entryDefaults.test.ts` (~78), `state/sessionStoryClock.int.test.ts`.

## Files owned (edit only these)

The test files named above (existing and new). Nothing else.

## Tests

One run at a time; first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (another lane's vitest
may be running: wait for it). Exactly:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/tl-2c-w2-<n>.log 2>&1"`.
Batch your files in one or two runs, not one run per edit. All named files green except the one tl-2d failure in
item 3. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` → 0 at the end.

## Report (final message, under 600 words)

Per file: tests added (titles), tests changed **old → new** (title and the assertion), tests confirmed `undatable` and
renamed; the guard's allow-list (entry → reason); findings (any code defect, any date read outside the function);
run logs with pass/fail counts; prettier `--check`; **Noticed, not done**.
