# BRIEF — worker `full-direct-2-w2` — the card's sentence, and the tests the scope review found missing

Supervisor: lane `full-direct-2`. Repo: `/home/jody/github/serene-pub`. Use absolute paths.

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This task needs no `sdk:build`: do not run one.)
- Never `kill -9`. No source change outside the one sentence below; no migration, setting, event or name.

`git diff HEAD -- <file>` is allowed (read-only) and is how you see what the previous lane changed.

## Words

A session's **notes** (code: *own book*) is the `lorebooks` row with `session_id` set; the **lorebook** is
`sessions.lorebook_id`. Under **Full** on the owner's own lorebook a session writes straight into the lorebook (the
"book" route); a change still **waits** in the notes when the session is dated, when it is a branch's change to its
original's line or its line fork is pending, or when the session already holds a change on that entry. Waiting rows
are applied by **automatic Apply** as each scene closes. **Back / Forward** take a turn's writes back and put them
back through **imprints** (`lore_imprints`). `holds` (`src/lib/server/lorebooks/imprints.ts`) decides that a made
row stands on something and is kept with a *replaced* note instead of being deleted; the previous lane widened it
(any link touching it in any book, an entry filed under it, a line amendment or another session's held change,
another session's message or notes annotation naming it, another session's place values), and stated "Back on a
session's own notes is unchanged". History holds one entry per date on a line; **Loose ends** reports *Two
history entries on one date* and nothing is merged for you (owner, 2026-11-10, ★H3).

## Rules you must keep (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx`."
- Comments state the rule, not the story: no "used to", "previously", "no longer", lane names or dates in comments
  (`src/lib/shared/conformance/commentHistory.test.ts` ratchets these phrases).
- Tests are rewritten, never deleted or skipped. An int test that opens a DB inside an `it` takes a 60 s timeout.
- Copy that is new and unseen by the owner is marked 🚧.

## Files owned

- `src/lib/client/components/sessionForms/SessionViewPanel.svelte` — the one sentence (~650), nothing else.
- `src/lib/client/components/sessionForms/sessionViewPanel.applied.dom.test.svelte.ts`
- `src/lib/server/lorebooks/autoApply.int.test.ts`
- `src/lib/server/pipelines/runtime/host.fullDirect.int.test.ts`
- `src/lib/server/lorebooks/imprints.holds.int.test.ts`

Not `host.ts`, `imprints.ts`, `ownBook.ts`, `sessions/rewind.ts`, any doc, any other test file. Another worker edits
`host.ts` at the same time (links and history days on the book route): don't depend on its changes, and don't edit
what it owns. If a test you write fails because of `host.ts` behaviour, report it; do not change source.

## Tasks

1. **The card sentence** (`SessionViewPanel.svelte` ~650): *The lorebook takes this session's changes by itself
   as each scene closes.* becomes *The lorebook takes what waits here by itself as each scene closes.* Mark it
   provisional with an HTML comment just above it: `<!-- 🚧 Provisional copy: the owner has not seen this sentence. -->`
   (check the file's existing comment style and match it). Update `SENTENCE` in
   `sessionViewPanel.applied.dom.test.svelte.ts` (~233). Nothing else in the component.
2. **`autoApply.int.test.ts`'s `change()` helper** (~145): the previous lane replaced the real outlet
   (`createHost(…).commit!({ entry, …data }, UPDATE)` with `core:outlet/update-lore-entry`) by a direct
   `entry_amendments` insert, because under Full an undated change is now written in place. Restore the real
   writer: the change goes through `update-lore-entry` again, and the test's session reaches the held path the
   real way — a dated session (give its reading a moment) or a prior hold — whichever keeps each existing test's
   meaning. See `git diff HEAD -- src/lib/server/lorebooks/autoApply.int.test.ts` for the original. Every existing
   test in the file still passes with its assertions (a dated hold carries a date: adjust only what a date
   necessarily changes, and say which).
3. **`host.fullDirect.int.test.ts` ~401**: the title says "folds into the held change" but the assertion counts a
   second held row (`heldRows(own.id)` length 3). The rule as built: a second change to an entry the session
   already holds a change on is a **second held row**, applied in order at the next scene close. Rename the test so
   title and assertion agree; keep the assertion.
4. **The Apply record's automatic cause**: `host.scenesEndRoute.int.test.ts` dropped its assertion of it
   (`git diff HEAD -- src/lib/server/pipelines/runtime/host.scenesEndRoute.int.test.ts`). Confirm another test
   still asserts the automatic cause on an Apply record written at scene close (`autoApply.int.test.ts` has
   `record!.cause` assertions ~260–270: check they are the scene-close cause). If none does, add one to
   `autoApply.int.test.ts`. Report which test covers it.
5. **New in `host.fullDirect.int.test.ts`: a match that names `links` on a pending fork.** A session whose line is
   still to be forked (`lineOnFirstWrite`), `create-lore-entry` whose `match` finds a lorebook entry and whose
   `links` name another **lorebook** entry: assert what is true — the line forks (a link is a row on the line), the
   link is on the new line, the matched entry's change is held in the notes or written, whichever the code does
   (read `lorebookChangeHeld` in host.ts ~2256 to predict it: after the fork the entry is on the parent's line, so
   it waits), never refused. Use a lorebook entry at both ends (the other worker changes what happens when an end
   is a notes row).
6. **New in `imprints.holds.int.test.ts`: Back on a session's own notes after the `holds` widening.** A session
   whose notes take its writes (Review changes, or a book it does not own): a turn makes a notes entry and a link
   in the notes to it from another notes entry made by an earlier turn; Back past the turn → the entry and its link
   are removed as before (no *replaced* note), Forward puts them back. And: a notes entry another session's held
   change does not touch — Back removes it. The claim to prove: widening `holds` did not change what Back does on
   a session's own notes.
7. **New in `host.fullDirect.int.test.ts`: Forward never merges.** Under Full on the owner's own lorebook: a turn
   writes a history day for date D (made by the turn); Back past it (the day goes); then a history day for D is
   written another way (a second turn, or by hand); then Forward → **both** days exist with their own text (nothing
   merged), and the Loose ends chore *Two history entries on one date* lists D: build the input for
   `looseEnds` (`src/lib/client/lorebooks/looseEnds.ts`, chore id `doubled-history-date`) from the book's rows the
   way its own tests do (`looseEnds.test.ts`), and assert a row for D. If Forward instead refuses or merges, report
   exactly what happens; do not change source.

Then run, from the repo root, one run at a time (another session shares this checkout: first check
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait while a vitest runs):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/lorebooks/autoApply.int.test.ts src/lib/server/pipelines/runtime/host.fullDirect.int.test.ts src/lib/server/lorebooks/imprints.holds.int.test.ts src/lib/client/components/sessionForms/sessionViewPanel.applied.dom.test.svelte.ts > plans/full-direct-2-w2.log 2>&1"
```

Never pipe vitest into `head`. `host.fullDirect.int.test.ts` may also be run by the other worker; that is fine, but
never at the same moment as your run (check `ps` first).

## Stop and report when

A test cannot be written without a source change; Forward merges or refuses in task 7; restoring the real writer
in task 2 would lose coverage of the held path.

## Report (your final message)

Each task: what changed and what the test asserts; decisions you made; tests run with pass/fail counts and the log
path; anything you stopped on; **Noticed, not done**.
