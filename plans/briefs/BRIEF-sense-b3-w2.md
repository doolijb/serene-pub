# BRIEF — worker `sense-b3-w2` — readers of a session's own-book links and names; the branch copy

Supervisor: lane `sense-b3`. Repo: /home/jody/github/serene-pub (SDK at ../serene-pub-sdk — you do not edit it).
Use absolute paths. Your report is your final message to the supervisor (no report file).

## Verbatim rules (binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build` at all.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.
  Inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite silently); the branch copy runs
  inside the branch's transaction and takes only `tx`.
- No migration, no schema change. If you think you need one, stop and report.
- It is a **session**, never a *chat*. Every session has a lorebook (its own notes, or an attached one): never write "no lorebook".
- No reference to any other project or product in code, comments, tests or docs.
- Tests only in a capped scope, never the whole suite, never piped into `head`:
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files>"`
  An int test that opens a DB inside an `it` needs a 60 s timeout. `npx prettier --check <file>` on each file you changed.
  Typecheck: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report only errors in your files; other
  sessions are editing the repo — do not fix theirs). Do not start a dev server.
- Do what is asked, at the size asked. Findings go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything (line numbers drift).
- Every sentence a person can see that you add is provisional: mark it `// 🚧 Provisional copy` and list it verbatim in
  your report. Any new exported name: list it (distinctive, never a bare generic noun; grep it first).

## Background (what is changing around you)

A session that reads an attached lorebook but may not write it (Review or Off on your own lorebook, or a member's
session on someone else's lorebook) writes its new entries, places, history days and links into its **own book** (its
"Session notes", `lorebooks.session_id` = the session). Another worker is making that route write **links whose ends
may be the lorebook's entries** (row: `narrative_relationships.lorebook_id` = own book, `branch_id` null, an end an
own-book entry *or* an entry of the attached lorebook *or* a member of either cast), and own-book entries filed under a
**lorebook** cast member (`lorebook_binding_id` = a binding of the attached lorebook). In your tests, insert such rows
directly (and a made imprint in `lore_imprints` where a test needs one: `subject_kind 'relationship'`, `field` null,
`message_id` the turn's message, `lorebook_id` the own book, `session_id` the session).

**Ruleset tie rows are not this lane's links:** an own-book `narrative_relationships` row with
`rules_run_id IS NOT NULL` is a ruleset tie's copy of a lorebook row (`rulesets/ties.ts` ~405–460, read only). Leave how
existing readers treat those as it is, except where this brief says.

**The route and what Full does are not changed.** Every existing test must pass unchanged; if one would have to
change, stop and report it.

## Files owned (edit only these)

- `src/lib/server/annotations/index.ts` (`loadVocabulary` and what it calls for names only)
- `src/lib/server/utils/graphEntryLinks.ts`
- `src/lib/server/lorebooks/imprints.ts` — the entry subject's `holds` only (~218–224). The retraction rule
  (`retractionAct`, `retractImprints`' order and acts) must not change.
- `src/lib/server/utils/forkHistory.ts` — `pointedAt` (~194–230) and `linesUsing` (~459–475) only.
- `src/lib/server/lorebooks/ownBook.ts` — only `copyOwnBookToBranch` / `copyNotesStatsAndLinks` (~660–991) and the
  take-back "linked" check (~1883–1896) with its sentence in `TAKE_BACK_REFUSALS`. Nothing else in this file (a later
  worker edits its list/Apply).
- New test files (names your choice, beside each source file, `*.int.test.ts`).

Readable: everything. **Not** `pipelines/runtime/host.ts` (another worker owns it now), `state/reading.ts`,
`state/storyTime.ts`, `state/write.ts`.

## What to build

**1. Names vocabulary (item 4).** `loadVocabulary(db, lorebookId, { holderBookId })` (`annotations/index.ts` ~430–462)
also includes the **own book's entries** when a holder is given (and differs from `lorebookId`), named as amended on
the own book (its own non-held amendments, `amendedNamesOf(db, holderBookId)` or equivalent), **own book first** (the
same order as the write path's match: a session that holds its own copy of a lorebook entry finds its copy). The first
claimant of a name still keeps it (the existing rule). Cast members of the own book are not part of this item (say in
Noticed whether they are already read). A holder is passed under Full too (the three `host.ts` call sites pass
`holderBookOf`), so: state in your report exactly what a Full session now reads, and add one Full test. Tests: the
session (holder = its own book) gets its own-book entry's name; another session of the same lorebook (holder = its own
own book) does not; the lorebook's own reading (no holder) does not.

**2. Graph entry links (item 4).** `readGraphEntryLinks` / `bookEntryLinks` (`utils/graphEntryLinks.ts` ~85–214): in the
own-book pass beside an attached lorebook, an own-book link whose end is a **lorebook entry** is kept when that entry is
on the **session's** line at its moment (the session's reading, `sessionReadingOf`, holder included), and each end is
named **as the session reads it** — the lorebook's amendments on the session's line, the session's held amendments
included (`entryOverlaysFor(db, attachedId, sessionReading, ids)` + `entryAt`, as the lorebook pass does). Own-book ends
stay as today. Off/archived as amended still drops the edge (the same `seesPlace` rule). Tests: the session sees the
cross-book link with the lorebook end's held name; another session of the same lorebook does not see it; a session on
the lorebook with no own-book links (the lorebook's own reading) does not.

**3. A session's private link must not act on anyone else (item 2, three by-entry readers).** Each with a two-session test.
- `imprints.ts` entry `holds` (~218–224): a link in **another session's** own book (a notes book whose `session_id` is
  not the imprint's session) never holds an entry, so it must not turn a run's undo of a made entry into "kept". A link
  in the lorebook itself, or in the same session's own book, holds as today. (You may widen `holds`' internal signature
  to receive the imprint; it is module-internal.) Test: session A's run made a lorebook entry under Full; session B (same
  lorebook, Review) links to it from its own book; A's retraction unmakes the entry (not "kept").
- `forkHistory.ts` `pointedAt` (~209–216) and `linesUsing` (~465–469): an own-book link (a row in a notes book other
  than the history entry's own book) is not "main uses this entry" — leave such rows out. Test: a history entry of the
  lorebook named only by another session's own-book link is not counted as used on main.
- `ownBook.ts` take-back (~1883–1896): take-back of an Apply **still refuses** when another session's own-book link names
  the entry, but with a sentence that is true for it — add to `TAKE_BACK_REFUSALS` (🚧):
  `‹Entry› is linked from another session's notes, so this can't be taken back.` A link elsewhere in the lorebook keeps
  today's sentence. Test both (see `lorebooks/applyTakeBack.int.test.ts` for how an Apply batch is made and taken back).

**4. A branch is the session as of the fork (item 6).** `copyOwnBookToBranch` (`ownBook.ts` ~682–840):
- For a parent that reads an **attached** lorebook (`input.created.lorebookId != null`), copy the own book's **links**
  too (today `copyNotesStatsAndLinks` runs only for a notes-alone parent, ~835–836, and skips any link whose end is not
  an own-book entry, ~978–980). A link has no message column: its **cut point is its made-row imprint's `message_id`**
  (the newest standing-or-kept `lore_imprints` row with `subject_kind 'relationship'`, `subject_id` = the link, `field`
  null, `lorebook_id` = the parent's own book). Imprint message after the fork, or not among the copied messages
  (`input.remap`) → stays behind; no imprint → comes across (as an unanchored entry does). Ends: an own-book entry end
  through `entryRemap` (skipped if it did not come across); a lorebook entry end and any member end kept as is;
  `history_entry_id` through `entryRemap` when it is an own-book day, kept when it is a lorebook day; `branch_id` null.
  Tie rows (`rules_run_id IS NOT NULL`) are **not** copied by this new path. For each copied link with a cut imprint,
  file a made imprint for the **branch** (`session_id` = the branch, `message_id` = the remapped message, `lorebook_id` =
  the branch's own book, `subject_id` = the copy, `origin 'run'`, `run_id` null) so the branch's own turn owns it.
  Do not change the notes-alone parent's copy (`copyNotesStatsAndLinks`) except to share code.
- A copied own-book entry **keeps `anchor_binding_id`** when that binding belongs to the attached lorebook (today it is
  always nulled, ~771); an own-book member stays nulled as today.
- Update the function's JSDoc. Tests (both situations: own lorebook under Review; a member's session on someone else's
  lorebook): a link between an own-book room and a lorebook room, imprinted at message M — a branch cut after M has the
  copy (ends right, branch imprint at the remapped message) and a branch cut before M does not; a lorebook–lorebook
  own-book link likewise; a tie row is not copied; an entry filed under a lorebook member keeps its binding.
  See `sessions/branch.heldAmendments.int.test.ts` for how a branch is made in a test.

## Regression set — must pass unchanged (capped scope, batches of ≤ 8 files; all under `src/lib/server/`)

`lorebooks/ownBook.int.test.ts`, `lorebooks/ownBook.branchNotes.int.test.ts`, `lorebooks/imprints.int.test.ts`,
`lorebooks/applyTakeBack.int.test.ts`, `lorebooks/heldApply.int.test.ts`, `sessions/branch.heldAmendments.int.test.ts`,
`utils/forkHistory.versions.int.test.ts`, `state/heldAmendments.readers.int.test.ts`,
`state/heldAmendments.exclusions.int.test.ts`, `state/heldAmendments.undo.int.test.ts`,
`pipelines/runtime/relationshipLinkHop.int.test.ts`, `pipelines/runtime/loreBindingVocabulary.int.test.ts`,
`sessions/rewind.int.test.ts`, `sockets/sessions.retraction.int.test.ts`, `sockets/ownBooks.fold.int.test.ts`, and every
existing test file whose name contains `vocabulary`, `graphEntryLinks`, `forkHistory` or `annotations` (find them).
A failure that is not yours (another session's file): report it with file and line, do not fix it.

## Stop and report (do not decide) when

A migration or schema change seems needed; an existing test would have to change; you need a file not listed above; a
reader cannot get the session's reading or holder without a signature change that ripples past these files.

## Report (your final message)

Changed files; for each numbered item what the code did before and does now; every 🚧 sentence verbatim; what a Full
session's vocabulary now reads; tests run with pass/fail counts; `tsc` for your files; Noticed, not done.
