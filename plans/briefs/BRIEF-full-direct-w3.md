# BRIEF — worker `full-direct-w3` — rewrite the lorebooks/state tests that pinned "a change to a lorebook entry always waits"

Supervisor: lane `full-direct` (brief `plans/briefs/BRIEF-full-direct.md`, read-only for you). Repo root
`/home/jody/github/serene-pub`. Report: your final message (do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## What changed (already built — do not touch the source)

Owner ruling 2026-11-13: under **Full**, on the session owner's own lorebook (the **"book" route**), a session's
pipelines write new entries, places, history days, links and **undated** changes to existing entries **straight into
the lorebook**, imprinted (`lore_imprints`), so swipe / regenerate / Back / delete take them back and Forward puts
them back. A change to an existing lorebook entry still **waits** in the session's notes (a held change:
`entry_amendments` row with `base IS NOT NULL` in the session's own book) when: the setting in force is **Review
changes** or **Off**, or the book is someone else's; or, under Full, the session is **dated** (its reading has a
moment), is a branch changing an entry on another line / with its line fork pending, or already holds a change on
that entry. A session whose scenes end by themselves now also gets the "book" route under Full (it no longer keeps
new rows in its notes), but still never settles by a `sources` write; the story settles when a scene closes
(`applyHeldAutomatically`, `src/lib/server/lorebooks/ownBook.ts`).

`imprints.ts` `SUBJECTS.entry.holds` now keeps a made lorebook entry (imprint `kept`, the *replaced* note) when
another session stands on it (any link, a child, a line amendment or **another session's** held change, another
session's annotation, another session's place values). **This session's own held change does not hold** (it is
taken with its turn, after the imprints) — the supervisor added that exclusion after `imprints.holds.int` was
written; it needs a test.

## Task

1. These tests build their held rows by running `host.commit` under the default Full, which now writes in place,
   so the held rows are missing. **Rewrite them to the new rule, never delete or skip**; the held path must stay
   covered. The lane's rule: **a test that set Full only to reach the held path moves to Review changes** (give the
   user `loreWriteMode: "review"` in `userSettings`, or the book's `loreWriteMode`, as other tests do — find how,
   e.g. `src/lib/server/pipelines/runtime/host.heldEntryChange.int.test.ts` `it.each(["review","off"])`). Pressed
   Apply and Take back are the owner's and work under Review changes; if a test needs **automatic** Apply (which
   needs Full), keep Full and make the held change another way: a **dated** session (give it a moment) or insert
   the held row directly as `src/lib/server/lorebooks/autoApply.int.test.ts` `change()` now does. Keep every
   assertion's meaning.
   - `src/lib/server/lorebooks/heldApply.int.test.ts` (8 failing)
   - `src/lib/server/lorebooks/applyTakeBack.int.test.ts` (4 failing)
   - `src/lib/server/state/heldAmendments.undo.int.test.ts` (5 failing; its `hold()` helper has no `userSettings`)
   - `src/lib/server/state/sessionLoreWrites.int.test.ts` (2 failing): "★ accepted: while a new history day waits in
     the session's own book, a stat value is still dated by the lorebook's day" — keep what it proves (a day waiting
     in the notes does not date a stat value) by making the waiting day another way (Review changes if stat values
     still land there, else insert the own-book day directly, as a row from before the change would be); "a lore
     link a session whose scenes end by themselves draws goes to its own book; no line is forked" — now it lands in
     the **lorebook** (route `book`); assert where it lands and whether the line forked (read `forkedLoreLine` /
     `ensureSessionLine` behaviour; a session that already has its own line forks nothing).
2. Add to `src/lib/server/lorebooks/imprints.holds.int.test.ts`: session A's turn makes an entry directly
   (`imprintMade`) and A itself holds a change on it (an `entry_amendments` row in A's notes, `base` set); retracting
   A's message removes the entry (`act: "unmade"`). And with B's held change on it as well, it stays (`kept`).

Run, do not edit, as neighbours: `src/lib/server/lorebooks/autoApply.int.test.ts`,
`src/lib/server/lorebooks/imprints.int.test.ts`, `src/lib/server/state/heldAmendments.readers.int.test.ts`,
`src/lib/server/sessions/branch.heldAmendments.int.test.ts`. Report any failure.

## Files owned (edit only these)

The four test files in 1, and `src/lib/server/lorebooks/imprints.holds.int.test.ts`.

## Out of scope

Every non-test file. Other test files (another worker rewrites the socket/messages tests). Any migration, setting,
name.

## Stop and ask (in your report) when

A test cannot be rewritten without losing coverage of the held path; a failure looks like a source bug rather than
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
flock /home/jody/github/serene-pub/plans/full-direct-vitest.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/full-direct-w3-<name>.log 2>&1"
```

The `ps` wait may see the supervisor's run; that is fine, the `flock` queues you. Read the log with
`grep -n "✓\|×\|FAIL\|Tests " <log>`. Never pipe vitest into `head`. Ignore an `esbuild --service` process.

## Done means

The five files you own and the four neighbours pass.

## Report (final message)

Changed files; each rewritten `it` and what it asserts now (and how it reaches the held path); tests run with counts;
anything you stopped on; **Noticed, not done**.
