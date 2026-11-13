# BRIEF — hist-E-w2: a next chapter carries the followed session's clock

Supervisor: hist-E (plan `plans/PLAN-history-one-per-date-2026-11-10.md`, Build scope item 7). Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Owner ruling this applies (2026-11-10, verbatim)

- **★C2:** "Carry the clock (Recommended)": next chapter carries the clock, rather than close-out moving the line's present.
- **★C3:** keep session clocks ("Keep them for now").

Research fact (plan § Clocks): "**Next chapter drops the clock**: it falls back to the line's present (sessions.ts:903-932)." "It should start at the followed session's story now (a one-column copy in the create path)."

## Goal

In `src/lib/server/sockets/sessions.ts`, the `creationMode === "next-chapter"` block of `sessions:create` (:903-932) rewrites `params.session` so the new session reads the followed session's book and line. Extend **that block only**:

- After the book is settled (after the `shareAsLorebook` step, so the followed session reads a book), read the followed session's story now with `sessionStoryNowOf(db, params.from!)` (`$lib/server/state/storyTime`, :358-368; import it lazily with `await import(...)`, as the block already does for `ownBook`).
- **When it answers `from: "session"`** (the followed session has a clock of its own), put its parts verbatim into the new session's clock fields in `params.session`: `storyClockYear: now.year`, `storyClockMonth: now.month ?? null`, `storyClockDay: now.day ?? null`, `storyClockHour: now.hour ?? null`, `storyClockMinute: now.minute ?? null`. These flow through the existing destructure (`requestedClockYear` etc., :1237-1241) into `sessionLinePatch`'s `clock` (:1543-1556), which checks it against the book's calendar under the lock. Don't touch :1540-1556 unless that flow turns out not to work; if it doesn't, say why in your report before changing it.
- **When it answers anything else** (null, `from: "clock"` or `from: "history"`: the followed session follows its line), change nothing: the new session follows the line too, exactly as today.
- Add a short comment in the block's style (`// …`, plain sentences) saying the chapter starts where the followed session's story stands (★C2), and a session that follows its line is followed by one that follows it too.
- Change nothing else in `sessions.ts`. It is a shared file: keep your diff to these lines.

## Files owned (edit only these)

- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.ts` (the next-chapter block only)
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.creationModes.int.test.ts` (add tests in its `describe("next-chapter", …)`)

## Files readable

Anything. Useful: `state/storyTime.ts:75-88` (`StoryNow`), `:251-300` (`storyNowOf`), `:358-368`; the existing next-chapter tests at `sessions.creationModes.int.test.ts:236-350` and the clock test near :410-425.

**Never edit** `src/lib/server/pipelines/runtime/host.ts` or `src/lib/server/pipelines/tools/writeTools.ts` (another lane is editing them now), nor any file not listed above.

## Tests to add (in the `next-chapter` describe)

1. **A next chapter starts at the followed session's clock.** Give the followed session (`w.session`) a clock of its own (update `storyClockYear/Month/Day/Hour/Minute` directly, a date the test book's calendar accepts), create the next chapter, and assert the new session's five `storyClock*` columns equal the followed session's.
2. **A following session is followed by a following one.** The followed session has no clock (all `storyClock*` null): the new session's `storyClock*` are all null.

## Run (capped scope; never pipe vitest into `head`)

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/server/sockets/sessions.creationModes.int.test.ts; echo test-exit=$?'
```

Report any failure with the test name and your diagnosis. Then `npx prettier --check` your two files (check only; the file may already fail on others' hunks — report whether your own hunks are formatted like their neighbours).

## Rules (quoted from CLAUDE.md and the lane brief)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently. (Your read is outside the transaction, on `db`, like the block's other reads.)
- Int tests that open a DB inside an `it` need a 60 s timeout.
- It is a **session**, never a *chat*.
- **Decisions:** decide implementation inside the asked scope; name the choice in your report. Anything a user sees, a new setting/flag/table/migration/event, or files outside the list: stop and report, don't do it. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never `git checkout`, `restore` or `clean` in either repo. Scratch files start with `hist-E-` and go in your scratchpad, not `/tmp` globs.

Verbatim:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This task needs no `sdk:build`.)

## Done means

Both new tests pass and `sessions.creationModes.int.test.ts` is green (or each failure diagnosed).

## Report

Write to `/home/jody/github/serene-pub/plans/briefs/REPORT-hist-E-w2.md` (if the write is refused, put it in your final message): changed files with a one-line summary each, tests run with pass/fail counts, decisions made, **Noticed, not done**.
