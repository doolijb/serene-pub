# BRIEF — `sense-eng-w2` — a first clock move by an amount starts the clock

You are a `lane-worker` under lane supervisor `sense-eng`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.
Report back in your final message (not a file): changed files, tests run with exact results, anything you could
not do, and **Noticed, not done**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

`src/lib/server/state/storyTime.ts`, `moveSessionStoryClock` (~439–493). Today a move TO a time of day
(`advanceSessionStoryClockTo`) on a story with no clock and no present starts at `FIRST_STORY_DAY` (Year 1, month 1,
day 1, 00:00) and stores the clock; a move BY an amount (`advanceSessionStoryClock`) refuses with "This session's
lorebook has no present to start from…". Make a move by an amount start from `FIRST_STORY_DAY` the same way: stored,
returned with `from`/`clock`/`label` exactly as the `to` path returns them (the caller in `host.ts` ~10000 then
records and announces it the same way for both; do not touch `host.ts`).

Implementation (decided by the supervisor): drop the optional `clockless` parameter and start every move from
`present ?? FIRST_STORY_DAY`. The `if (!start) throw … "no present to start from"` branch becomes unreachable;
delete it. Every other refusal and both locks (`lockBookCalendar`, the session row `for update`, the
"lorebook changed while its clock was being advanced" check, the calendar's `moved.problem`, the `today` refusal)
stay exactly as they are. Move the `FIRST_STORY_DAY` constant above its first use if needed; do not export it.
Update the doc comments of `advanceSessionStoryClock` ("Throws … with no book, no present to start from…" and
"A session with no clock of its own starts from its line's present") and `advanceSessionStoryClockTo`
("A move by an amount still refuses.") so they say both moves start a clockless story on its first day.

`src/lib/server/state/clockMoves.ts`: no code change expected. `clockSkipReason` and `NO_STORY_CLOCK_YET` stay (the
Story keeper's pre-check in `state/clockProposal.ts` still uses them; that file is NOT yours). If a comment in
`clockMoves.ts` now says something untrue about a move by an amount, correct that comment only.

## Tests

Owned test files: `src/lib/server/state/sessionStoryClock.int.test.ts` and
`src/lib/server/state/clockMoves.int.test.ts`. Tests there that assert the old refusal must be rewritten to the new
behaviour, not deleted silently. Known ones (re-check by grepping `no present`, `NO_STORY_CLOCK_YET`, `clock: false`):
- `sessionStoryClock.int.test.ts` ~299 "refused with no book and with no present to start from": becomes "a move by an
  amount on a story with no clock starts on its first day": `advanceSessionStoryClock(db, s, 1, "days")` resolves with
  `from` = Y1 M1 D1 00:00, the stored clock is Y1 M1 D2 00:00 (check `clockRow`'s shape in the file).
- `clockMoves.int.test.ts` ~225 "a move skipped for want of a clock, before any line, heads the ledger too", ~237
  `describe("a story with no clock yet")` (~238 "onRefusal 'skip': nothing moves…", ~256 "a session with no shared
  lorebook…", ~279 "unwired, a refusal still halts…"): rewrite each so it asserts what now happens — the clock starts
  on the first day, an `applied` row with `from` Y1 M1 D1 00:00 and `to` 3 hours later, the line reads as an
  ordinary move, `noted`/events as any applied move. Where a test's point was a *skipped* row at the ledger head or
  an unwired halt, keep that point with a refusal that still exists (e.g. a step the calendar cannot place, see
  docs/lorebook-time.md ~122: a clock with a time of day but no date cannot run past midnight) if one fits cleanly;
  otherwise rewrite to the new behaviour and say so. The ~270 "a move TO a moment starts the clock…" test stays.
- The test that proves the change: on a clockless story, Advance story clock `{ by: 3, unit: "hours", cause:
  "action" }` stores Y1 M1 D1 03:00 and records an applied row with `from`/`to`. It must fail against the old code
  (say how you confirmed).

Tests in files you do NOT own will also change behaviour; do not edit them, list them in your report with the line
and what the new assertion should be:
- `src/lib/server/sockets/sessions.timePasses.int.test.ts` ~128 "🚧 a story with no clock: the press finishes,
  nothing moves…"
- `src/lib/server/state/clockProposal.int.test.ts` ~316 "a clock that can no longer move refuses with its own
  sentence and stays pending" (accept → `decideProposal` → `advanceSessionStoryClock` now starts the clock)
Run them anyway (read-only) so the report gives their actual result.

## Docs (only the sentences this change makes untrue)

- `docs/lorebook-time.md` ~120 ("When a move was asked for but the story had no clock yet … (A pipeline's move
  **until** a time is the exception…)"): **Time passes…** and a reply's tick now start the clock on the story's first
  day (Year 1, month 1, day 1) and move it from there, as a move until a time does. The **state-keeper's move or
  suggestion in Story** still needs a clock (its pre-check in `clockProposal.ts` is unchanged), so for it the
  "not on the clock" line stays. Rewrite the paragraph to say exactly that, no more.
- `docs/sessions.md` ~200 ("It needs the session to read a lorebook with a date to start from; otherwise nothing
  moves and a line says so: *Time passes: 1 hour, not on the clock…* (Story's keeps the world's changes all the
  same).") : on a story with no clock yet it starts the clock on the story's first day and moves it from there.
List every new or changed sentence in your report, verbatim, marked 🚧 provisional copy.

## Files owned (the only files you may edit)

- `src/lib/server/state/storyTime.ts`, `src/lib/server/state/clockMoves.ts` (comments only, if needed)
- `src/lib/server/state/sessionStoryClock.int.test.ts`, `src/lib/server/state/clockMoves.int.test.ts`
- `docs/lorebook-time.md`, `docs/sessions.md` — the two passages above only

Readable: everything. Out of scope: `host.ts`, `sockets/*`, `state/clockProposal.ts`, `state/write.ts`,
`db/schema.ts`, migrations, the SDK repo, default calendars of new lorebooks, `durable.ts` and `bindings.ts` (another
worker owns those).

## Rules (quoted)

- No new name, setting, flag, event, table or migration. If you think one is needed, stop and say so in the report.
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- It is a **session**, never a *chat*. Every session has a lorebook (its own book, or an overlay): never write
  "no lorebook" in code comments, copy or your report.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You should need no `sdk:build`.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` in either repo. Never pipe vitest into `head`.
- An int test that opens a DB inside an `it` needs a 60 s timeout.

## Done means

Run only, in a capped scope:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/state/sessionStoryClock.int.test.ts src/lib/server/state/clockMoves.int.test.ts src/lib/server/sockets/sessions.timePasses.int.test.ts src/lib/server/state/clockProposal.int.test.ts"
```

Owned files all pass; report the two unowned files' results as they are. Then `npx prettier --check` on each file
you changed (if a file was already unformatted before you, say so rather than reformatting it). Report exact
pass/fail counts.
