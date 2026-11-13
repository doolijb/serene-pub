# BRIEF — build lane `sense-b4`, worker 2 — an Apply forks the session's line; a branch applies by itself

You are a `lane-worker`. Supervisor: build lane `sense-b4` (`plans/briefs/BRIEF-sense-b4.md`, readable for
context; this brief is your contract and wins where they differ). Words: a **build lane** is this stream of work;
a **channel** is a session's message channel. Never write bare "lane" for a channel.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

From this build lane on, a pipeline's new entries, places, history days and links of a session whose scenes end by
themselves stay in the session's own book until **Apply** (another worker builds that route in `host.ts`). Today a
branch session riding its parent's line (`sessions.line_on_first_write` true) forks its own line on its first
direct write to the lorebook. Those writes no longer happen, so **an Apply forks instead**, and a branch's changes
reach **its own line** by themselves as scenes end (owner, 2026-11-12: "Yes" — a branch's changes still reach its
own line by themselves). Owner on an earlier over-built draft: "You're over complicating it" — take the plainer
shape.

## Build, in `src/lib/server/lorebooks/ownBook.ts` only

Re-read the cited lines first; numbers are approximate. **Do not touch** `scenesEndByThemselves` (just added after
`loreWriteTargetFor` by the supervisor) or the routing functions.

1. **`applyOverlayItems` (~1865 now; the reading at ~1925–1927)** reads `sessionReadingOf(db, …)` and `branchId`
   **outside** its transaction, then uses both inside. Change it so that, inside the transaction, after the book's
   advisory lock:
   - the reading is read on the transaction handle (`t`);
   - the "done" drop loop runs as today;
   - after the existing early return (nothing chosen), `ensureSessionLine(t, input.sessionId)` is called (it does
     nothing unless `line_on_first_write` is set and the session has an attached book; it is already imported at
     the top of the file), and **then the reading and `branchId` are read again**, so every write below — moved
     entries, links, folded dated amendments, merged days, `lorebookDayOfDate`, `heldChangeVerdict` — lands on and
     is judged on the session's own line, never its parent's. An Apply with nothing to apply forks nothing.
   Nested advisory locks on the same key inside one transaction are fine (`lockBookCalendar` takes the same
   `pg_advisory_xact_lock(bookId)`). Inside `db.transaction(async (tx) => …)` use only `tx`/`t`.
   Update the function's JSDoc in one or two 🚧 sentences.
2. **Automatic Apply runs for a branch session too.** Remove the `branchOfSessionId != null` condition from
   `applyHeldAutomatically` (~2819) and the `branchOfSessionId == null` condition from `overlayAccessOf`'s
   `appliesItself` (~2941). **Every other condition stays** (owner owns the lorebook, write setting Full, the
   rewound check, the scene and summary gates). Drop the column from those selects if it becomes unused. Update
   both JSDocs (they say "is not a branch").
3. `src/lib/server/lorebooks/sessionLine.ts` — **comment only**: add `applyOverlayItems` (`lorebooks/ownBook.ts`) to
   the list of writers in the header JSDoc (~9–16) that call `ensureSessionLine` inside their transaction. No code.

Known and **not** changed (say so in the report): an **undated** held change folds into the entry's base row, so
every line sees it (★B1-6, carried). A merged history day onto a day another line owns is held by
`historyDayOwnerRefusal` (sense-b3). Write your tests with new entries, links and **dated** held changes for the
"nothing reaches the original's line" assertions.

## Tests

Run only these files, only inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`.
An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.

1. **New file** `src/lib/server/lorebooks/applyForksLine.int.test.ts` (harness style of
   `src/lib/server/lorebooks/autoApply.int.test.ts` / `heldApply.int.test.ts`; a real branch via `branchSession`
   from `sessions/branch.ts` where you need `line_on_first_write`, see `sessions/branch.heldAmendments.int.test.ts`):
   - a branch session riding its parent's line, with own-book new entries (a place), a standalone link and a dated
     held change: a **pressed** Apply forks the session's line inside the Apply (`lorebook_branch_id` set,
     `line_on_first_write` false, one new `lorebook_branches` row named after the session); the moved entries and
     link carry the new line's `branch_id`; the dated amendment lands on the new line; the original session's
     reading does not see the moved entries or the dated change;
   - the same through `applyHeldAutomatically` (`scene-close` with a closed scene of the branch, and `close-out`):
     it applies, lands on the branch's own line, and nothing reaches the original's line;
   - a branch whose line was already forked first by another writer (call `ensureSessionLine` directly, as cast
     versions or values would) applies its entries onto **that same line** — no second fork;
   - an Apply with nothing to apply (only done held changes, or nothing) forks nothing;
   - `overlayAccessOf(...).appliesItself` is true for a branch session of the lorebook's owner under Full.
2. `src/lib/server/lorebooks/autoApply.int.test.ts` — the case **"a branch"** (~427) pins the old rule
   (null for a branch). Rewrite **only that case** to the new rule, never weaker: a branch of the owner's session
   under Full applies by itself at Close out, and what it applied lands on the branch's line. Every other case in
   the file passes **unchanged**.
3. Run unchanged and report: `heldApply.int.test.ts`, `applyTakeBack.int.test.ts`,
   `applyTakeBack.otherSessionLink.int.test.ts`, `applyOwnBookLinksDays.int.test.ts`, `ownBook.int.test.ts` (all in
   `src/lib/server/lorebooks/`), `src/lib/server/scenes/liveScenes.autoApply.int.test.ts`,
   `src/lib/server/sessions/branch.heldAmendments.int.test.ts`, `src/lib/server/sessions/branch.ownBookLinks.int.test.ts`,
   `src/lib/server/sockets/sessions.applyOverlayLinks.int.test.ts`, `src/lib/server/sockets/sessions.applyLists.int.test.ts`.

Typecheck at the end: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report only errors in your
files (another worker is editing `host.ts` and `rulesets/ties.ts` at the same time; errors there are not yours).
`npx prettier --check <file>` on each file you changed.

## Files owned (edit only these)

`src/lib/server/lorebooks/ownBook.ts` (`applyOverlayItems`, `applyHeldAutomatically`, `overlayAccessOf` and their
JSDoc only), `src/lib/server/lorebooks/sessionLine.ts` (header comment only), the new test file,
`src/lib/server/lorebooks/autoApply.int.test.ts` (the one case).

## Out of scope (never built)

`host.ts`, `rulesets/ties.ts` (another worker, now); automatic Apply's other conditions; take-back; the card UI;
cast versions, values, scenes, summaries; retiring `ensureSessionLine` or `line_on_first_write` (D12 is not this
build lane's); docs and NOMENCLATURE (the supervisor's); any migration, schema change, setting or new name visible to
a user.

## Stop and ask (in your report, then stop) when

A migration or schema change seems needed; a suite you were told passes unchanged fails because of your change;
the fork inside Apply deadlocks or needs a lock order change outside `ownBook.ts`; anything needs a new user-facing
sentence.

## Verbatim rules

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." — and in this build lane: **do not run `npm run sdk:build` at all.**
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. Inside `db.transaction(async (tx) => …)` use only `tx`. Never run npm at the SDK repo root. It is a
  **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- **No reference to any other project or product** in code, comments, tests or docs.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- **Re-read the cited lines before changing anything.**
- Other sessions are editing this repo (a visual-novel layout build lane, speech): never touch their files, never
  "fix" failures that are theirs.

## Report (your final message)

Changed files; one line per change; every test file run with pass/fail counts; anything that failed and why; open
questions; **Noticed, not done**.
