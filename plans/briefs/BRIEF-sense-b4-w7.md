# BRIEF — build lane `sense-b4`, worker 7 — pin the accepted dating ★ with one test

You are a `lane-worker`. Supervisor: build lane `sense-b4` (`plans/briefs/BRIEF-sense-b4.md`). This brief is your
contract. Words: a **build lane** is this stream of work; a **channel** is a session's message channel.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

The build lane's brief item 5: "**Accepted, pinned by one test and reported as a ★:** while a new history day waits
in the own book, stat values, timeline captures and cast versions written meanwhile are still dated by the
lorebook's latest day (`writeDatingAt` and `sessionStoryNowOf` are not this lane's), and a moved day does not
re-date them." Write that one test. **No production change.**

## What is built

For a session whose scenes end by themselves (`scenesEndByThemselves` in `src/lib/server/lorebooks/ownBook.ts`),
a pipeline's history day (`core:outlet/create-lore-entry` with entry type `core:entry/history`) is filed onto the
**own book's** day for that date, not the lorebook's. Stat values (`core:task/set-state@1`, `state/write.ts`) are
not rerouted and are dated by `writeDatingAt` on the session's reading of the lorebook alone.

## Build

In `src/lib/server/state/sessionLoreWrites.int.test.ts` add **one** test in the `describe` that holds "Full writes
it, unchanged for a session whose scenes end by themselves …" (~256), using that file's `world()`, `setOwnMode`,
`run(w)` (set-state through `stateBindings`) and its existing per-session `scenesEnd` mock (~46–49), and the
`createHost(...).commit` pattern the file uses at ~660–691:

1. Full; the session meets the rule (`scenesEnd.add(w.session.id)`).
2. Through `createHost` + `commit` with `{ key, definitionId: "core:outlet/create-lore-entry" }`, write a history
   entry dated **after** every history day the lorebook holds on the session's line (pick a year beyond the world's
   newest; read the fixture). Assert it landed in the **own book** (`route: "own-book"`).
3. Run the set-state write (`run(w)`); read the written value row(s) and assert their `historyEntryId` is the
   **lorebook's** day the reading stands at (what the same write gives without step 2 — compute it, do not
   hard-code a guess), **not** the own book's new day.
4. Title it so a reader sees it is an accepted limitation, e.g. `"★ accepted: while a new history day waits in the
   session's own book, a stat value is still dated by the lorebook's day"`.

If the value turns out dated by the own book's day, do not change production code: report what you saw.

## Run

Only that file, only inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/state/sessionLoreWrites.int.test.ts"`.
Never pipe vitest into `head`.

## Files owned

`src/lib/server/state/sessionLoreWrites.int.test.ts` (one new test only).

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — and in this build lane: **do not run `npm run sdk:build` at all.**
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash`. Never `kill -9` anything. It is
  a **session**, never a *chat*. No reference to any other project or product. Do what is asked, at the size asked;
  findings go under **Noticed, not done**.

## Report (your final message)

The test's title and what it asserts (the two `historyEntryId`s you saw); the file's pass/fail count; **Noticed,
not done**.
