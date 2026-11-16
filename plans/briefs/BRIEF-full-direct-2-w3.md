# BRIEF — worker `full-direct-2-w3` — two test gaps the scope review found

Repo `/home/jody/github/serene-pub`. **Tests only: change no source file.** If a new test fails because the code
is wrong, do not fix the code: report the failure with its output.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background (read these parts only)

- `plans/REPORT-full-direct-2026-11-13.md`, the last section "Lane `full-direct-2`" (Build 2 and Build 4).
- `src/lib/server/pipelines/runtime/host.ts`: `historyDayInNotes` (search by name, ~1874–1920): for a session
  whose scenes end by themselves, a history day goes to the session's notes when the line would not own it.
  With the fork **pending**: the fork date is taken from the session's story moment; the day goes to the notes
  when there is no fork date or the day is **on or before** it; a later day forks the line and lands in the
  lorebook on the new line.
- The existing tests you extend: `src/lib/server/pipelines/runtime/host.notesMeet.int.test.ts` (~417 a pending
  dateless fork; ~436 an already-forked line), `host.historyWrites.int.test.ts` (its `world(...)` fixture and the
  scenes-end describe), `host.fullDirect.int.test.ts` ~317–347 (Back, a second day for the date, Forward, then
  `looseEnds`).

## Do

1. **`host.notesMeet.int.test.ts`: the pending fork with a fork date.** A session whose scenes end by
   themselves, on its owner's own lorebook under Full, with its line fork pending (`lineOnFirstWrite`) and its
   story clock at Year 4. (a) A history day dated Year 4 is written to the session's notes: no branch is made,
   the session still has its fork pending, the lorebook has no such day. (b) A history day dated Year 6 forks
   the line and lands in the lorebook on the new line: one new branch, the session's `lorebookBranchId` is it,
   the notes hold no such day. Also (c) a day dated Year 3 goes to the notes. Use the file's existing helpers
   and fixtures; follow how ~417 sets up a pending fork and how other tests in the file set a clock.
2. **`host.historyWrites.int.test.ts`: restore the fork-riding case.** The scenes-end describe used
   `world({ fork: true, scenesEnd: true })` before the lane and now uses `world({ scenesEnd: true })`, losing the
   assertions that the session's `lorebookBranchId` stays the fork and that exactly one branch exists. Add a
   test (do not change the existing ones) with `world({ fork: true, scenesEnd: true })` that writes a history
   day the fork owns and asserts both. `git show HEAD:src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts`
   shows the earlier assertions (read-only use of git is fine). The fixture may have no notes row: create one the
   way the lane's rewritten test in that file does.
3. **`host.fullDirect.int.test.ts` ~317–347: make the Loose ends check real.** Each item passed to `looseEnds`
   takes its `date` from the test's own constant (~343). Build each item's date from the row's stored `fields`
   (the file or `$lib` has a helper such as `historyEntryDate(r.fields)`; find it), and also assert that the day
   Forward restored has the same date fields as before Back.

## Rules

- Files you may edit: those three test files only.
- Run only those three files, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/host.notesMeet.int.test.ts src/lib/server/pipelines/runtime/host.historyWrites.int.test.ts src/lib/server/pipelines/runtime/host.fullDirect.int.test.ts > plans/full-direct-2-w3.log 2>&1"`
  from the repo root. Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if a run
  is up, wait and check again every minute or so (never `pgrep -f "vitest run"` in a loop: it matches itself).
  Never pipe vitest into `head`. An int test that opens a DB inside an `it` takes a 60 s timeout.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `kill -9`. Comments state the rule, not the story.

## Report (your final message)

What each new or changed test asserts; the run's result (files, tests passed/failed, with the failure output if
any); anything in the code that looks wrong; nothing else.
