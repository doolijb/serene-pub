# BRIEF — lane `sense-eng2` — finish "a first clock move starts the clock"

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `plans/REPORT-sense-eng-2026-11-11.md`
(what lane `sense-eng` built: item 3, its open ★2, and "Tests"), `docs/lorebook-time.md` (the paragraph about a
story with no clock yet), CLAUDE.md Hard rules. This is small: do it yourself or with one worker.

## Goal

Lane `sense-eng` made every move in `src/lib/server/state/storyTime.ts` start from `present ?? FIRST_STORY_DAY`, so a
move by an amount starts the clock on a story that has none. One path still refuses, with its own copy of the rule:

1. **The Story keeper's clock move or suggestion.** `clockMoveProblem` in `src/lib/server/state/clockProposal.ts`
   (about 101–105) still answers "no clock yet". Give it the same start: export `FIRST_STORY_DAY` from
   `storyTime.ts` (or a small reader of "where a move starts") and use it, so there is one rule and no second copy.
   Every other refusal there stays.
2. **Two tests that asserted the old refusal**, per the report:
   - `src/lib/server/state/clockProposal.int.test.ts` about 316 ("a clock that can no longer move refuses with its
     own sentence and stays pending"): keep its point with a refusal that still exists — a clock with a time of
     day and no date, stepped past midnight, expecting the "no date" sentence.
   - `src/lib/server/sockets/sessions.timePasses.int.test.ts` about 128 ("a story with no clock: the press
     finishes, nothing moves…"): the press now succeeds; the clock is the first story day plus the amount, the row
     is applied with `from` 00:00, and the head line reads as an ordinary move.
3. **Docs.** In `docs/lorebook-time.md` remove the exception sentence that says the state-keeper's move in Story
   still needs a clock, once it no longer does. If `NO_STORY_CLOCK_YET` is then unreachable, say so under
   **Noticed, not done**; do not delete it.

## Files owned

`src/lib/server/state/clockProposal.ts`, `src/lib/server/state/storyTime.ts` (the export only),
`src/lib/server/state/clockProposal.int.test.ts`, `src/lib/server/sockets/sessions.timePasses.int.test.ts`,
`docs/lorebook-time.md` (that paragraph).

## Out of scope

Everything else, including `sockets/sessions.ts`, `runtime/host.ts`, the SDK repo, default calendars, and any other
lane's files. Lane `sense-mod` is building at the same time in the KoboldCpp and set-up files.

## Stop and ask when

A new name beyond the one export; a file outside **Files owned**; a refusal other than the "no clock yet" one would change.

## Done means

Those two test files pass, plus `state/sessionStoryClock.int.test.ts` and `state/clockMoves.int.test.ts` still pass,
in one capped run:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.

## Report

**Return the full report as your final message** (the harness refuses a supervisor's write of a report file; the
lead saves it as `plans/REPORT-sense-eng2-2026-11-11.md`): changed files, tests and results, open ★, provisional
copy, **Noticed, not done**.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `prettier --write` on a directory. Never `git checkout` / `restore` in either repo. Inside
  `db.transaction(async (tx) => …)` use only `tx`. Every session has a lorebook (its own book, or an overlay):
  never write "no lorebook". Do what is asked, at the size asked.
