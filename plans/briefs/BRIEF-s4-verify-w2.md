# BRIEF — `s4-verify-w2` (worker of lane s4-verify) — date the parent's notes in a branch's reading; a retired card-less seat never blocks a branch — 2026-11-08

Repo `/home/jody/github/serene-pub` (SDK in `../serene-pub-sdk` — do not touch it). Supervisor: lane `s4-verify`. Use absolute paths; your cwd resets between shell calls.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Background (verified by the supervisor and worker w1)

A branch of a session that reads its **own notes** alone reads the parent's notes' **cast members** as they are (members are not copied; "members ride"). A member's durable value rows on the notes' **main** (no line, no session) are therefore shared. Worker w1 added three tests to `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts` (describe "a member's value on the notes' main reads the same in the branch at the fork") that **fail**: parent-before / branch / parent-after read M = 4/**3**/4, 3/**4**/3, 10/**3**/10. Cause: `src/lib/server/state/reading.ts` `loadEntryDates` (~493) dates a row's `historyEntryId` only by entries of `reading.lorebookId` ("An entry of another book, or a deleted one, dates nothing."). The branch's reading is on the branch's own notes book, so a member row dated by a history entry of the **parent's** notes reads undated: the fork cut, the moment cut and the by-date order (`state/resolve.ts` `inForce` ~534, `datedOnReading` ~410) all go wrong.

The supervisor rejected the alternative "copy member main rows into the branch": a copy owned by the same member with `branchId` null is read by the parent too, where the copy's history entry (the branch's book) dates nothing — so the parent at Year 3 would read a Year 5 value (w1's test 3 would fail on "parent after").

## Task 1 — date the ancestors' notes in an own-notes reading

In `loadEntryDates` (`state/reading.ts`), after the existing query and before the "dates nothing" loop: when `reading.onOwnBook` is set, `reading.line.sessionCuts` is non-empty, and ids are still missing, date the missing ids by entries whose book is an **ancestor's own notes** — `schema.lorebooks.sessionId` in the cut sessions' ids (`reading.line.sessionCuts.map((c) => c.sessionId)`), one query joining `lorebook_entries` to `lorebooks` (or a sub-select). Everything else keeps today's rule. Private change, no new exported name, no new field on `LineReading`. Update the function's doc comment with one sentence: a branch reading its own notes also dates rows by its ancestors' own notes, whose members it reads (★s4-last gap, lane s4-verify). Update the comment in `src/lib/server/lorebooks/ownBook.ts` above `copyNotesStatsAndLinks` (~826–834) where it says a member's main rows are "read by both sessions" to add "— dated in the branch by the parent's notes (`loadEntryDates`)". Don't change `copyNotesStatsAndLinks`' code.

Then w1's three tests must pass. Also add, in the same describe, a **fourth** test (diagnostic): parent on its notes' main; after the fork message, the parent writes member M a main row with `validFromMessageId` = a parent message **after** the fork (value 9, undated); before that M has an undated main row (value 6) anchored to no message. Branch at the fork message. Assert the branch reads 6. If it reads 9, mark that one test `test.fails` with a comment `// ★s4-verify-3: a parent's post-fork turn-tied member row reaches a branch (members ride on main)` and report it — don't fix it.

## Task 2 — a retired card-less player seat never blocks a branch

`src/lib/server/sessions/branch.ts` ~252–281: a card-less player seat (`personaId == null && castMemberId != null`) is copied with `castMemberId`, and `seatPlayer` throws a refusal when the member no longer checks out (`checkSeatMember` — a plain JS `Error`, no SQL error, so the transaction stays usable); the branch turns it into `BranchError`. Keep that for a **live** seat. For a **retired** seat (`sp.removedAt != null`), on that refusal seat it again without `castMemberId` (name only: same `seatName`, `userId`, `portraitMediaId`, `removedAt`, `removedName`, `onExisting: "insert"`, `deferMember: true`) — a retired seat is nobody now, and its lines are named by `removedName`. Comment one sentence on why. No new parameter on `seatPlayer`.

Tests in `src/lib/server/sessions/branch.cardlessSeats.int.test.ts` (reuse its setup): make a member fail the check by seating, through a direct insert into the parent, a member of a lorebook the session does not read (another user's book). (a) a **live** card-less character seat on such a member → `branchSession` rejects with `BranchError` and no branch session row exists afterwards; (b) a **live** card-less player seat on such a member → `BranchError`; (c) a **retired** card-less player seat on such a member → the branch is made, its copy is retired with the same `removedName` and `castMemberId` null. If (a) or (b) behave otherwise, report — don't change the live path.

## Rules you depend on (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "It is a **session**, never a *chat*." · Decide implementation inside the asked scope; no new option, hook or extension point nobody asked for.
- Owner 2026-11-05 ★S2b-1 "Still theo": the person who seated a cast member keeps acting for that seat (`seated_by_user_id`).
- Memory rule: never frame a session as having no lorebook — own notes / overlay.
- An int test that opens a DB inside an `it` needs a 60 s timeout. **Never pipe vitest into `head`.**
- Tests only in a capped scope, logged:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w2-tests.log'`
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo.

## Files owned

`src/lib/server/state/reading.ts` (`loadEntryDates` only), `src/lib/server/lorebooks/ownBook.ts` (the one comment), `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts` (the fourth test), `src/lib/server/sessions/branch.ts` (the player-seat copy only), `src/lib/server/sessions/branch.cardlessSeats.int.test.ts`. Nothing else. Another Claude session owns image-generation files — never touch them.

## Done means

All green (bar a `test.fails` from Task 1's diagnostic), in one or two capped runs, counts per file: `src/lib/server/lorebooks/ownBook.branchNotes.int.test.ts`, `src/lib/server/sessions/branch.*.int.test.ts` (all six), `src/lib/server/state/reading.sessionCuts.int.test.ts`, `src/lib/server/state/ownNotesReading.int.test.ts`, `src/lib/server/state/ownNotesLine.int.test.ts`, `src/lib/server/state/lorebookReading.int.test.ts`, `src/lib/server/state/entriesOnReading.int.test.ts`, `src/lib/server/sessions/settle.int.test.ts`, `src/lib/server/cast/memberAsRead.ancestryLine.int.test.ts`, `src/lib/server/lorebooks/foldInParent.int.test.ts`, and any `src/lib/server/state/statTrail*.test.ts` (list with `ls`). Then `npx tsc --noEmit -p .` once under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && export NODE_OPTIONS=--max-old-space-size=8192; npx tsc --noEmit -p . > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w2-tsc.log 2>&1; echo exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-verify-w2-tsc.log'` — report errors in your files (others' errors: count only).

## Stop and ask when

A test outside your new ones fails after your change; the fix seems to need a file outside the list or a new exported name.

## Report

Your final message (no report file): changed files with a one-line summary each; per-file test counts; the diagnostic test's result; tsc result; prettier; **Noticed, not done**.
