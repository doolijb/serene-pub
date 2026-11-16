# BRIEF — worker `timeline-a-w3` — the scope review's findings on lane `timeline-a`

Repo `/home/jody/github/serene-pub`. Read first: `plans/REPORT-timeline-a-2026-11-14.md` (whole; note "Lead
follow-up": the one-time pass is **unregistered** on purpose and stays so), and
`src/lib/server/lorebooks/timeline.ts`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

A lorebook has a flag `lorebooks.timeline_enabled` (default on), read through `lorebooks/timeline.ts`
(`timelineOf`, `timelineOfBook`, `sessionTimelineOf`, `sessionTimelineSql`). With it off, readings have no
moment, writes are undated, the story has no "now", and the clock does not move. A session follows its attached
lorebook's switch, else its notes'.

## Do

1. **No extra query when the switch is on (the default).** Today:
   - `sessionReadingOf` (`src/lib/server/state/reading.ts`) reads the flag in its own query, then passes a moment
     to `readingOf`, which asks again with `timelineOfBook` (~238). Let `readingOf` take the flag from a caller
     that already has it, and always record it on the reading it returns, so `writeDatingAt` (~499) trusts the
     reading and never queries.
   - `storyNowOf` (`src/lib/server/state/storyTime.ts` ~270) calls `timelineOfBook` although `readBookStoryTime`
     (~209–220) selects the same lorebook row right after: fold `timelineEnabled` into that select.
     `sessionStoryNowOf` then costs no extra query.
   - The clock outlet in `src/lib/server/pipelines/runtime/host.ts` (search `TIMELINE_OFF_SENTENCES`, the clock
     outlet near `moveSessionStoryClock`) pre-checks with a query and `moveSessionStoryClock` asks again in its
     transaction: drop the pre-check and turn the in-transaction refusal into the `skipped` receipt, with no
     ledger row and no event, as now.
   Prove it: a test that counts queries (or asserts `timelineOfBook` is not called) for `sessionReadingOf`,
   `sessionStoryNowOf` and `writeDatingAt` on a session with a clock and the switch on.
2. **`src/lib/server/sockets/storyClock.ts`.** Run the timeline refusal **after** the request is validated, so a
   malformed step still answers with its own sentence ("Step by one of …"); refuse only setting (`to`) and
   stepping; `follow` (which only clears a stored clock) is allowed as before. The clock read in the same file
   (~107, `present: own ?? linePresent`) returns no present when the session's timeline is off.
3. **Notes never disagree with their lorebook.** `ownBookFor` in `src/lib/server/lorebooks/ownBook.ts` re-points
   `overlay_of` without copying the switch: copy it in the same transaction. And make `timelineOfBook` answer
   for a session's notes that sit over a lorebook with **that lorebook's** switch (resolve `overlay_of` in the
   one query), so `sockets/scenes.ts` ~337, ~1404, ~1530 and any `readingOf` caller handed a notes book get the
   right answer without changes at those sites. Test both.
4. **Tests the review found missing:** a malformed clock step on a switched-off lorebook still fails in the
   outlet as before; a message written in a session whose lorebook's timeline is off gets no story stamp
   (`withStoryClockStamp`, `src/lib/server/messages/store.ts` ~95–108), and with it on gets the stamp as before.
5. **Docs and comments that say the pass ran.** It did not and does not: every lorebook is on, and no person
   can reach the switch yet. Fix:
   - `docs/lorebook-time.md` ~22 ("When Serene Pub was updated to this version, each lorebook already there was
     checked once…"): replace with a sentence saying every lorebook keeps a timeline for now, and mark the new
     section 🚧 as not reachable from a screen yet. Check `docs/lorebooks.md`, `docs/sessions.md` and
     `docs/genre-story.md` for the same claim, and for any sentence saying new lorebooks start off or a preset
     decides: none of that is built.
   - `NOMENCLATURE.md` ~393 and §25 ~4168: the pass `settleTimelineSwitches` and its marker are built and
     **not registered**; say so.
   - The comments at `src/lib/server/db/schema.ts` ~1403 and `src/lib/server/lorebooks/timelinePass.ts` ~10:
     state the rule (what the function does when called), not that it ran. Do not touch anything else in
     `schema.ts` and do **not** run `db:generate`.

## Rules

- Files you may edit: `state/reading.ts`, `state/storyTime.ts`, `lorebooks/timeline.ts`, `lorebooks/timelinePass.ts`
  (comment only), `lorebooks/ownBook.ts` (`ownBookFor` only), `pipelines/runtime/host.ts` (the clock outlet's
  pre-check only), `sockets/storyClock.ts`, `db/schema.ts` (that one comment), the lane's test files and new
  ones beside them, the four docs, `NOMENCLATURE.md`. Another lane (`edit-history-a`) is editing `host.ts`,
  `ownBook.ts`, `db/schema.ts` and `sockets/entries.ts` right now: re-read a region right before editing it,
  keep each edit small, never reformat a file; if an Edit fails because the text moved, re-read and retry.
- Do not register the pass. Do not change any creation path or default.
- Tests: run only the lane's files and the suites you touched (`src/lib/server/state/timelineOff.int.test.ts`,
  `src/lib/server/sockets/storyClock.timeline.int.test.ts`, `src/lib/server/sockets/storyClock*.test.ts`,
  `src/lib/server/pipelines/runtime/host.timelineOff.int.test.ts`, `src/lib/server/lorebooks/ownBook.timeline.int.test.ts`,
  `src/lib/server/lorebooks/timelinePass.int.test.ts`, `src/lib/server/sockets/scenes.timelineOff.int.test.ts`,
  `src/lib/server/state/storyTime*.test.ts`, `src/lib/server/state/reading*.test.ts`, your new files) inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/timeline-a-w3.log 2>&1"`
  from the repo root. Before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if a run
  is up, wait and check again every minute or so (never `pgrep -f "vitest run"` in a loop). Never pipe vitest
  into `head`. An int test that opens a DB inside an `it` takes a 60 s timeout. Then
  `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`.
- Inside a transaction use only the transaction handle. Comments state the rule, not the story.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`.)
- Never `kill -9`.

## Report (your final message)

What changed for each of 1–5; the query counts before and after for the three helpers; test results (files,
passed, failed with output); `tsc` result; anything you could not do and why.
