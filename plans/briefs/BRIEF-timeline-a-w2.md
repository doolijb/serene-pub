# BRIEF — `timeline-a` worker 2 — the Timeline rule: reading, story now, clock moves, history refusals

Supervisor: lane `timeline-a`. Repo: `/home/jody/github/serene-pub` (SvelteKit 5, TypeScript, Drizzle + PGlite, Vitest 4).
Use absolute paths. Read files by line range. `src/lib/server/pipelines/runtime/host.ts` (13k lines),
`src/lib/server/db/schema.ts` and `src/lib/server/sockets/scenes.ts` are very large: search by name, read ranges.
Line numbers below are from 2026-11-14 and drift: search by name.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`; do not run one.)
- Never `kill -9`. Never `npm run db:generate`; never edit `db/schema.ts`.

## Goal

A lorebook has a stored flag `lorebooks.timeline_enabled` (default true; field `timelineEnabled`), the **Timeline**
switch. Read it **only** through `src/lib/server/lorebooks/timeline.ts` (read it first): `timelineOf(row)`,
`timelineOfBook(db, id)`, `sessionTimelineOf(db, sessionId)`, `sessionTimelineSql()` (a scalar for a query over
`sessions`), and the two sentences `TIMELINE_OFF_SENTENCES.history` = *This lorebook has no timeline, so no history is
kept.* and `.clock` = *This lorebook has no timeline, so its story time doesn't move.* Never read the column directly.

**Whose switch governs a session:** its attached lorebook's; a session that reads only its notes, the notes'
(`sessionTimelineOf` / `sessionTimelineSql` already answer that). On = everything exactly as today. With it **off**
(the owner's rule, 2026-11-13/14):

1. "Read as it stands now": no moment — the head, every dated change in force; a session's, the lorebook's and the
   branch's stored clocks are **ignored, never cleared**; fork cuts and session cuts stay. Lines are untouched.
2. "Write undated": nothing is dated; no history day is written and nothing is compiled into history; a pipeline step
   that would write one answers with a sentence in the run's notes and the run goes on.
3. "Time does not move": nothing sets or moves a clock on the lorebook or the session.
4. "Nothing is deleted": dated changes, history entries, calendar and clock stay stored, byte-identical, and come back
   when the switch is on.

The lane's cold review placed the rule in **four helpers**, so most readers follow without edits:

### 1. `src/lib/server/state/reading.ts`
- `LineReading` gains `timelineOff?: true` — 🚧 doc: "Set when the reading was made for a book whose timeline is off
  (`lorebooks/timeline.ts`): the reading has no moment, and nothing written at it is dated. Absent: on, or not asked."
- `readingOf`: when the caller passes a `moment` and `timelineOfBook(db, lorebookId)` is false, the reading's moment is
  null and it carries `timelineOff: true`. When no moment is passed, ask nothing (no extra query).
- `sessionReadingOf`: add `timelineEnabled: sessionTimelineSql()` to its one select (it is the hot path: no second
  query). When `!timelineOf(session)`: moment null wherever it would be set (pass `moment: null` to `readingOf`, skip
  `linePresentOf`, and the `BranchRefusal` fallback's moment is null), and mark `timelineOff: true` on the result
  (with `mark`'s fields). Session cuts stay.
- `writeDatingAt`: returns null when `reading.timelineOff` or `!(await timelineOfBook(db, reading.lorebookId))`
  (a hand-built reading carries no mark; the query covers it). Update its doc comment with one sentence.
- `lineOfBook` takes no moment: leave it.

### 2. `src/lib/server/state/storyTime.ts`
- `storyNowOf`: after the `!lorebookId` check, return null when `!(await timelineOfBook(db, lorebookId))`. This makes
  `sessionStoryNowOf` null too (it calls `storyNowOf` with the governing book), so the prompt date, the message
  story stamp, scene names, ages and the host's story-now sites all see no present. Add one doc sentence to each.
- `moveSessionStoryClock` (private; every move ends here — `advanceSessionStoryClock`, `advanceSessionStoryClockTo`):
  inside its transaction, right after the "lorebook changed" check, `if (!(await timelineOfBook(tx, lorebookId)))
  throw new StoryClockRefusal(TIMELINE_OFF_SENTENCES.clock)`. Use `tx` there. Writes nothing.
- `stepBackSessionStoryClock`: **leave it** (taking back a move made while on may still move a hidden clock; harmless).
- `storyMoveStartOf`: leave it.

### 3. `src/lib/server/sockets/storyClock.ts` — its refusal sentence only
`setSessionStoryClock` (~141): once `book` is known (~162), `if (!(await timelineOfBook(db, book))) throw new
StoryClockRefusal(TIMELINE_OFF_SENTENCES.clock)` — for all three ways (follow, set, step), so a hidden clock is never
cleared, set or stepped by hand. Nothing else in the file.

### 4. `src/lib/server/pipelines/runtime/host.ts` — the dated-write points only
Another lane edits `changeLoreEntry` in this file at the same time: re-read each region right before editing it, keep
each edit small and inside the function named, never reformat.
- **The clock outlet** (`advance-story-clock`, search `advanceSessionStoryClockTo(t, sessionId, target)`, ~10486–10553):
  before the transaction, when `!(await sessionTimelineOf(db, sessionId))`, return the same shape the `target` skip
  path returns — `{ id: sessionId, sessionId, clock: null, label: "", skipped: TIMELINE_OFF_SENTENCES.clock, moved: 0 }`
  — **whatever `onRefusal` says** (a refusal here is a sentence on the receipt, never a halted turn), with no ledger
  row and no event. Put it after the existing argument checks so a malformed step still halts as today; check where
  the keeper's dropped-move return sits and put yours after the checks, before any write.
- **`create-lore-entry@1`'s history day** (search `typeId === HISTORY_TYPE_ID` near `historyDateOf`, ~11870–11921, and
  the early `{ tie }` return handled at ~12157): when `typeId === HISTORY_TYPE_ID` and `!(await
  sessionTimelineOf(db, sessionId))`, write nothing and return before the write's transaction opens, in the shape the
  `tie` branch returns: `{ lorebookId, route: target.route, written: false, notes: [...(checked?.notes ?? []),
  TIMELINE_OFF_SENTENCES.history] }` (confirm `checked` and the return shape are in scope there; adapt to what is).
- **`ownBookDaysCounted`** (~1729): return `{ dating: null, now: null }` when the session's reading has `timelineOff`.
- Every other dating in `host.ts` follows from the helpers (`loreWriteLineOf` → `writeDatingAt`; held changes date
  by `reading.moment`, which is null; `lorebookChangeHeld` reads `line.reading.moment`). **Do not edit them.** Do sweep
  the file for any other point that writes a dated row or a history day on its own (grep `HISTORY_TYPE_ID`,
  `historyEntryOfDate`, `story_clock`, `storyClock`, `year:`) and list each in your report with what it does now when
  the timeline is off; edit none beyond the three above without asking.

### 5. `src/lib/server/sockets/scenes.ts` — compile and history refusals only
- `sceneCompileHandler` (~1259): a by-date ask refuses with `refuse(TIMELINE_OFF_SENTENCES.history)` right after the
  book's owner check (~1398–1401), before any model is resolved or row made; an entry ask (`historyEntryId`) refuses
  the same way as soon as the entry's lorebook is known (find where it loads the entry, ~1515), before the model.
- The compile's save that files scenes under the entry (search `.set({ historyEntryId: activity.historyEntryId })`,
  ~2557): refused with the same sentence when that book's timeline is off (a review begun while on, saved after the
  switch went off). Use the refusal style that handler already uses.
- `sceneCreateHandler` (~301): a scene saved **with** a `historyEntryId` is refused with the same sentence when the
  book's timeline is off (a scene with none is saved as today: "maybe scenes only"). Use that handler's refusal style.

## Tests

Int tests open a PGlite test DB: copy the harness of an existing int test in the same folder (e.g.
`src/lib/server/state/sessionStoryClock.int.test.ts`, `src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`,
`src/lib/server/sockets/scenes.compileLine.int.test.ts`, `src/lib/server/sockets/storyClock.int.test.ts`): `vi.mock`
of `$lib/server/db` with `createTestDb`, a `serene-pub-vitest-<name>-` temp dir, `releaseDataDir`, 60 s timeouts.
Never seed a row at a hardcoded id. New files:

a. `src/lib/server/state/timelineOff.int.test.ts` — with the governing book's timeline off: a session with a stored
   clock (and a book clock, and a branch clock) gets `sessionReadingOf(...).moment === null` and `timelineOff: true`,
   on its own line with its fork cut; `readingOf(db, id, { moment })` gives moment null; `writeDatingAt` is null though
   the book holds dated history; `storyNowOf` and `sessionStoryNowOf` are null; `advanceSessionStoryClock` and
   `advanceSessionStoryClockTo` throw `StoryClockRefusal` with the clock sentence and the session's clock columns are
   unchanged; switching the flag back on (`update lorebooks set timeline_enabled = true`) restores the dated reading,
   dating and story now exactly as before; a session reading its notes alone follows the notes' switch; an attached
   session follows the attached book's switch even when its notes say otherwise.
b. `src/lib/server/sockets/storyClock.timeline.int.test.ts` (or a `describe` in the existing
   `storyClock.int.test.ts` if it fits without restructuring): follow, set and step are each refused with the clock
   sentence and the stored clock is unchanged.
c. `src/lib/server/pipelines/runtime/host.timelineOff.int.test.ts` — drive the host's outlets as
   `host.historyWrites.int.test.ts` does: with the timeline off, `create-lore-entry@1` for a history entry writes no
   row and the result's notes hold the history sentence (the run goes on: no throw); a non-history entry is written
   undated (no `history_entry_id` / year on what it writes); an `update-lore-entry@1` change to an entry is written
   with no date (no dated amendment); `advance-story-clock@1` with `onRefusal` absent (= "halt") does not throw and
   reports `skipped` = the clock sentence, and the session clock is unchanged. **Byte-identical**: snapshot every row
   of `entry_amendments`, `cast_amendments`, `character_versions` (dated ones), `lorebook_entries` of the history type,
   the book's `story_calendar` and every `story_clock_*` (book, branch, session) before these writes and compare after
   — equal. Keep the test clear of deleting a message whose clock move was made while on (`stepBackSessionStoryClock`
   may still move a hidden clock then; the lane says so).
d. `src/lib/server/sockets/scenes.timelineOff.int.test.ts` — a by-date compile and an entry compile are refused with
   the history sentence (the `scenes:compile:error` reply carries it) and nothing is made; a scene saved with a
   `historyEntryId` is refused; a scene saved with none is saved.

Then run these existing suites unchanged and report their counts (they must still pass; Minimal on a timelined
lorebook must advance story time as before):
`src/lib/server/state/sessionStoryClock.int.test.ts src/lib/server/state/clockMoves.int.test.ts
src/lib/server/state/clockTarget.int.test.ts src/lib/server/state/clockProposal.int.test.ts
src/lib/server/state/lorebookReading.int.test.ts src/lib/server/state/ownNotesReading.int.test.ts
src/lib/server/state/reading.sessionCuts.int.test.ts src/lib/server/sockets/storyClock.int.test.ts
src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts src/lib/server/sockets/scenes.compileLine.int.test.ts
src/lib/server/sessions/noLorebook.int.test.ts`
(split into two or three runs if one is heavy).

## Files owned (the only files you may edit or create)

`src/lib/server/state/reading.ts` · `src/lib/server/state/storyTime.ts` · `src/lib/server/sockets/storyClock.ts`
(the one refusal) · `src/lib/server/pipelines/runtime/host.ts` (the three points above) ·
`src/lib/server/sockets/scenes.ts` (the refusals above) · the four new test files (and the `storyClock.int.test.ts`
`describe`, if you take that option).

## Files readable

Anything. `src/lib/server/lorebooks/timeline.ts` is the supervisor's; do not edit it — if it is wrong, say so.

## Out of scope — never build

The flag's storage, the boot pass, notes copying, the setter (worker 1); any default for new lorebooks or presets; the
clock-step binding (`pipelines/runtime/clockStep.ts`) — not the place; the lorebook's own clock and calendar handlers
in `sockets/lorebooks.ts`; `state/write.ts`, `state/clockMoves.ts`, `messages/writes.ts`, `sockets/entries.ts`,
`scenes/historyEntryOfDate.ts`, `lorebooks/ownBook.ts` (list anything they need under Noticed); any client or UI; SDK
files; docs and NOMENCLATURE. Comments state the rule, not the story.

## Rules your work depends on (quoted from CLAUDE.md)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never seed a row at a hardcoded id."
- "P1 Deterministic, never hidden. … every automatic action shows its cause" — so every refusal is a sentence.
- Vitest: "Never pipe vitest into `head`: the SIGPIPE leaks PGlite temp dirs." "An int test that opens a DB inside an `it` needs a 60 s timeout under load."

## Stop and ask (write it in your report and stop that part) when

A file outside the owned list is needed; a new name beyond `timelineOff` is needed; "read as it stands now" is not
what a null moment does for some reader you meet; a write path cannot go undated without losing something a session
needs (say what); an existing suite fails after your change for a reason you cannot tie to a bug of yours.

## Running tests

One run at a time. Before **every** run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` — if any
vitest is running, wait (re-check about once a minute with a single command; never loop `pgrep -f "vitest run"`).
Another lane and another session run tests here too. Then, from the repo root:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/timeline-a-w2.log 2>&1"`
and read the log with `tail`/`grep`. Typecheck with
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "<your files>"`.

## Done means

Parts 1–5 built; tests a–d pass; the listed existing suites pass unchanged; no `tsc` error in your files;
`npx prettier --check` on each file you changed.

## Report

Your final message: changed files (absolute paths) with one line per change; the sweep list from part 4 (each other
dated-write point in `host.ts` and what it does with the timeline off); tests run with exact commands and counts;
anything not done and why; **Noticed, not done**.
