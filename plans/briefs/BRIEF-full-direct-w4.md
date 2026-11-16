# BRIEF — worker `full-direct-w4` — rewrite the socket and message tests that pinned "under Full, a session whose scenes end by themselves keeps its writes in its notes"

Supervisor: lane `full-direct` (brief `plans/briefs/BRIEF-full-direct.md`, read-only for you). Repo root
`/home/jody/github/serene-pub`. Report: your final message (do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What changed (already built — do not touch the source)

Owner ruling 2026-11-13: "We should pull back on how frequently we use own notes. Use the lorebook if it's a
surfaced one." Under **Full**, on the session owner's own lorebook (the **"book" route**), **everything a session's
pipelines write goes into the lorebook at once**: new entries, places (rooms), history days, links, and **undated**
changes to existing entries (written in place, the name kept). Each write is imprinted (`lore_imprints`), so a
swipe, regenerate, Back or delete of the turn takes it back (an entry it changed gets its earlier text back; a row it
made is removed) and Forward puts it back; when a person changed the field since, it stays and the entry is marked
*replaced* (a `kept` imprint). **This now includes a session whose scenes end by themselves** (Story Living, the Lair,
the Dungeon Crawler with scene mode Automatic): it no longer keeps its new rows in its notes until a scene closes.
Such a session still never settles by a `sources` write; the story settles when a scene closes.

What still waits in the session's notes (a held change: `entry_amendments` with `base IS NOT NULL`; or a notes
entry): everything under **Review changes** and **Off** or on a book someone else owns; under Full, a change to an
existing entry by a **dated** session (its reading has a moment), by a branch on another line / with its fork
pending, or on top of a change it already holds. A name that meets a row already waiting in the notes changes that
row there.

A **press with no turn** (the Lair's **File as a room**, saved from the person's review) leaves no imprint: on the
owner's lorebook under Full, Back no longer takes it (it did while it sat in the notes). The test should say so.

## Task

These fail now. **Rewrite each to the new rule, never delete or skip; do not weaken an assertion to pass — assert
the new thing.** Where a test's point was the waiting path itself (rows in the notes, then applied at scene close),
keep that coverage by moving the case to **Review changes** (the user's `loreWriteMode: "review"`; then the owner's
press Apply moves them) **only if** the test is about the waiting machinery; where its point was "where a Full
session's room lands", assert the lorebook.

- `src/lib/server/messages/loreLinks.int.test.ts` — describe "a session whose scenes end by themselves: its
  pipeline's links and new entries go to its own book": "a link between two lorebook entries lands in the own book,
  none in the lorebook, no line forked"; "a new entry and its links land in the own book, none in the lorebook".
- `src/lib/server/sockets/sessions.lairFileRoom.int.test.ts` — "R11 · … a filed room is in the session's own book
  until a scene closes, then in the lorebook with its links": now in the lorebook at once, links included; and Back
  past the newest message does not take it (a press, no imprint).
- `src/lib/server/sockets/sessions.lairKnock.int.test.ts` — "B6 · … the room and its links are in the session's own
  book until a scene closes, then in the lorebook": now in the lorebook at once; a swipe / Back of the turn removes
  them (if the knock is a turn's run) — read the test to see whether the knock is a turn or a press, and assert
  accordingly.
- `src/lib/server/sockets/sessions.lairWalk.int.test.ts` — "update-lore-entry@1: a change lands; a misfit and a name
  nothing answers to are refused": the change is now written in place on the lorebook entry (undated session), or
  held if the session is dated — check which and assert it.
- `src/lib/server/sockets/sessions.sweepShown.int.test.ts` — "shows the entries the lines name, and rewrites the
  shown one it returns: held for the lorebook, its name kept": now rewritten **in place** in the lorebook, its name
  kept, imprinted; unless the session is dated (then held) — check and assert.

The Lair test helpers read the lorebook plus the own book (★b4-7); keep or simplify them as the new rule needs, and
say what you did. Run, do not edit, as neighbours: every other `src/lib/server/sockets/sessions.lair*.int.test.ts`,
`src/lib/server/sockets/sessions.chatMemoryShown.int.test.ts`. Report any failure.

The supervisor may message you more failing files from the same directories; treat them the same way.

## Files owned (edit only these)

The five test files above (and any further test file the supervisor names by message).

## Out of scope

Every non-test file. Other test files (another worker rewrites the lorebooks/state tests). Any migration, setting,
name.

## Stop and ask (in your report) when

A test cannot be rewritten without losing coverage of the waiting path; a failure looks like a source bug rather than
an old-rule test (describe it with file:line, do not fix the source).

## Rules

- Inside `db.transaction(async (tx) => …)` use only `tx`.
- An int test that opens a DB inside an `it` takes a 60 s timeout.
- Comments state the rule, not the story. It is a **session**, never a *chat*.
- Never `kill -9`. No migration, no `npm run sdk:build`.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build`.)

## Running tests

One command at a time, always like this (the `flock` serializes you with the other worker and the supervisor; the
`ps` check catches another session):

```
cd /home/jody/github/serene-pub
timeout 1800 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 15; done'
flock /home/jody/github/serene-pub/plans/full-direct-vitest.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/full-direct-w4-<name>.log 2>&1"
```

The `ps` wait may see the supervisor's run; that is fine, the `flock` queues you. Read the log with
`grep -n "✓\|×\|FAIL\|Tests " <log>`. Never pipe vitest into `head`. Ignore an `esbuild --service` process.

## Done means

The files you own and the neighbours pass.

## Report (final message)

Changed files; each rewritten `it` and what it asserts now; tests run with counts; anything you stopped on;
**Noticed, not done**.
