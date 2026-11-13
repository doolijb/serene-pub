# BRIEF — worker `sense-b3-w4` — a turn owns what the own-book route wrote (item 5), end to end

Supervisor: lane `sense-b3`. Repo: /home/jody/github/serene-pub (SDK at ../serene-pub-sdk — you do not edit it).
Use absolute paths. Your report is your final message to the supervisor (no report file).

## Verbatim rules (binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.
  Inside `db.transaction(async (tx) => …)` use only `tx`.
- No migration, no schema change. If you think you need one, stop and report.
- It is a **session**, never a *chat*. Every session has a lorebook: never write "no lorebook".
- No reference to any other project or product in code, comments, tests or docs.
- Tests only in a capped scope, never the whole suite, never piped into `head`:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`
  An int test that opens a DB inside an `it` needs a 60 s timeout. `npx prettier --check <file>` on each file you add.
  Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (only errors in your files). No dev server.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.

## Background

On the **own-book route** (a session that reads an attached lorebook it may not write: your own lorebook under Review
(`userSettings.loreWriteMode: "review"`), or a member's session on someone else's lorebook), the host
(`pipelines/runtime/host.ts`, now built by another worker — read it) writes into the session's own book: new entries and
places (`source_message_id` = the turn), **links whose ends may be the lorebook's entries** (row in the own book; a made
imprint in `lore_imprints` whose `message_id` is the turn), **history days** (one per date in the own book; a new day is
imprinted as made and anchored by `source_message_id`; a later write for that date appends a **paragraph**, imprinted as
a field change), and **held changes** to lorebook entries. A turn is undone by one retraction rule
(`retractLoreAnchoredTo` and what it calls: `retractImprints` in `lorebooks/imprints.ts`, `takeOwnBookEntriesAnchoredTo`
in `lorebooks/ownBook.ts`), restored by `restoreRetractedState` (a failed re-tell) and by Forward. Rule: **"A turn owns
what it wrote."**

## Files owned

- New test file(s): `src/lib/server/state/ownBookRoute.undo.int.test.ts` and
  `src/lib/server/sessions/branch.ownBookRoute.int.test.ts` (names may vary; report them).
- `src/lib/server/pipelines/runtime/host.ts` **only** if a test shows a fault in item 5 on the own-book route, and only
  after you have reported to yourself exactly which lines (minimum change; say it in the report). Another worker is
  editing `lorebooks/ownBook.ts` now: **do not touch it**, nor `imprints.ts`, `state/write.ts`, `state/reading.ts`,
  `state/storyTime.ts`. If a fault is in one of those, stop and report it with the evidence.

## What to test (both situations in every case; drive the real outlets `core:outlet/create-lore-entry`,
`core:outlet/link-lore-entries`, as `state/heldAmendments.undo.int.test.ts` and
`pipelines/runtime/host.ownBookRoute.int.test.ts` do — reuse their roads for swipe, regenerate, Back/Forward, delete
and a failed re-tell)

1. One turn writes, on the own-book route: a new own-book entry, a new own-book history day, a paragraph onto an existing
   own-book day (written by an earlier turn), a link between an own-book room and a **lorebook** room, a link between two
   **lorebook** entries. Then each road takes exactly that turn's writes and leaves the earlier turn's:
   - a swipe; a regenerate (the retake's delete); Back; a delete;
   - Forward after Back puts every one back (ids and all, the paragraph's text exact);
   - a failed re-tell (`restoreRetractedState`) puts every one back.
2. A press-started run (an `action`-family run with no turn message — see how `host.ownBookRoute.int.test.ts` test 10
   makes one): report, per kind, what a later swipe/Back of the newest message does to it today. Links now anchor to the
   newest message as entries do; check that Back of the newest message takes both the entry and the link.
3. End to end, the brief's "Done means": a link between an own-book room and a lorebook room written by turn M — taken
   back with its turn, restored by Forward, **copied to a branch cut after M and absent from one cut before M**
   (branching: see `sessions/branch.heldAmendments.int.test.ts` and `sessions/branch.ownBookLinks.int.test.ts`); in the
   branch cut after M, Back of the branch's copy of M takes the branch's copy and leaves the parent's link standing.
4. Say (in the report) whether `state/write.ts` needed any change for item 5, and why not if not (the supervisor
   expects not: what takes each kind back is listed above).

Run, unchanged, at the end (capped, batches ≤ 8): `state/heldAmendments.undo.int.test.ts`,
`sockets/sessions.retraction.int.test.ts`, `sessions/rewind.int.test.ts`, `lorebooks/imprints.int.test.ts`,
`pipelines/runtime/host.ownBookRoute.int.test.ts`, `sessions/branch.ownBookLinks.int.test.ts`,
`sessions/branch.heldAmendments.int.test.ts` (all under `src/lib/server/`). A failure that is not yours: report it.

## Stop and report (do not decide) when

A cross-book link cannot be owned by its turn without a migration or a new column; a fault is in a file you do not own;
an existing test would have to change.

## Report (your final message)

Files added/changed; each road × kind result; the press-run per-kind behaviour; any host.ts change with the reason;
the `state/write.ts` answer; tests with pass/fail counts; Noticed, not done.
