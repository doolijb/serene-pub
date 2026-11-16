# BRIEF — `edit-history-a` worker 1 — the record's call sites in the domain modules, the registry, Share, and their tests

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Supervisor: lane `edit-history-a`. Repo: `/home/jody/github/serene-pub` (always absolute paths). Report: return it as
your final message (changed files, tests run with results, anything you could not do, Noticed-not-done).

## Goal

The app now keeps an **Edit history** for lorebook entries: table `lore_redlines` (schema.ts, migration
`drizzle/0161_flowery_bishop.sql`, both already done; never touch either) and the record module
`src/lib/server/lorebooks/redlines.ts` (already written by the supervisor: **read it whole first**; it is the
contract). Every write of an entry's text calls its one writer (`recordRedline` / `recordEntryRedline`) on the
handle of the write. Your part: the call sites outside the socket files, the take-back on retraction, the registry
spec, Share as a lorebook clearing it, and server tests. A second worker is doing the socket files
(`sockets/entries.ts`, `sockets/amendments.ts`, new socket handlers) at the same time: never edit those.

Rules that bind (owner and the lane's cold review, quoted):

- "every save that changes an entry's name, text or typed fields keeps the previous values, with when and who (a
  person, or *‹routine› in ‹session›*) … it belongs to the lorebook, not to a session; it never travels … it
  records saves by a person, writes by a routine, **Apply**, **Revert**, **Take back** and **Restore**, not plugin
  upgrades or upgrades at start-up; **Share as a lorebook** clears it; an overwrite import clears it; the last 50
  per entry are kept."
- "the limit never evicts the newest row a person wrote" (already in `recordRedline`).
- "**Back, swipe, regenerate and Forward do not record.** A run's write that is taken back with its turn takes
  **its own edit row with it**, and Forward puts that row back with the write … Do this at the callers
  (`retractImprints`, `restoreImprints`), never inside `SUBJECTS.entry.write`, which runs once per field and knows
  no cause or person. Only the *replaced* note's **Revert** records a row … as that person, cause *revert*. Test:
  30 swipes of a turn that rewrites an entry leave the history holding the person's original edit and one row for
  the standing reply's write."
- "In `changeLoreEntry` the call sits inside `write(tx)` after the update (this covers `fileOntoHistoryDay`); the
  early return into `holdLoreEntryChange` records nothing: a held change waits in a session's notes and is not an
  edit of the entry. Apply of an undated held change records through `writeEntryKeys`; a dated one applied is a
  new version, not an edit. Compare only the keys the write names (as `imprintChanges` does) so `graphed` and
  `isCompleted` never count. No row for: `entries:setMarks`, the graph build's `fields.graphed`, the cast-absorb
  anchor writes, `utils/forkHistory.ts`, `sessions/forgetNote.ts`, the import's anchor pass, `copyFromLibrary`,
  `iterateNext`. The history-day merge at Apply deletes the notes day: its history goes with it, and its text
  arrives on the lorebook's day as one Apply row."
- "The routine's or pipeline's shown name is stored as text when the row is written (at `changeLoreEntry`:
  `routineRunOf(runId)?.shownAs?.name`, as `earmarkNotice` gets it)." Never a run id, model or connection in
  anything shown (the run id is stored, never shown).
- "Register it as an entry-scoped spec (`tableRegistry.ts` ~594, ~627), not the book-scoped `binding_merge_logs`
  pattern (the table has no `lorebook_id`)." "**Share as a lorebook** clears it for that book
  (`ownBook.ts` `shareAsLorebook`)."
- CLAUDE.md Hard rules: inside `db.transaction(async (tx) => …)` use only `tx` (the outer `db` deadlocks PGlite
  silently). Never statically import `$lib/server/db` from `lorebooks/imprints.ts` or `redlines.ts`. Comments state
  the rule, not the story. Never reformat a file.

## Files owned (edit only these)

- `src/lib/server/lorebooks/imprints.ts` — `TakenImprint`, `retractImprints`, `restoreImprints`, `settleKeptImprint`.
- `src/lib/server/pipelines/runtime/host.ts` — `changeLoreEntry` only (search by name; ~2459).
- `src/lib/server/lorebooks/ownBook.ts` — `writeEntryKeys` and its four callers (~1785, ~2110, ~2355, ~2749,
  ~2760), and `shareAsLorebook` (~1196).
- `src/lib/server/rulesets/ties.ts` — the `entry-field` target (~722–750).
- `src/lib/server/lorebooks/tableRegistry.ts` — one spec.
- `src/lib/server/lorebooks/redlines.ts` — only to fix a bug you find in it; say so in the report.
- New test files you create (suggested: `src/lib/server/lorebooks/redlines.int.test.ts`,
  `src/lib/server/lorebooks/redlines.callSites.int.test.ts`, or a case added to an existing suite of a file you own).

**Lane `timeline-a` is editing `host.ts`, `ownBook.ts` and `db/schema.ts` right now, elsewhere in those files.**
`host.ts` (13k lines) and `ownBook.ts` (3.2k) are huge: read by line range only, search by name. Keep each edit to
the call it needs; **re-read a region right before editing it**; if an Edit fails because the text moved, re-read
and retry, never rewrite the region. Never touch `sessions/settle.ts`, `sessions/rewind.ts`,
`sockets/*`, `state/*`, `Layout.svelte`, any SDK file.

## What to build

1. **`changeLoreEntry`** (`host.ts`): inside `write(tx)`, after the update and the `imprintChanges` call, when
   `was && wrote[0]`: `recordEntryRedline(tx, { before: was, after: wrote[0], named: [...Object.keys(columns),
   ...Object.keys(fieldPatch).map(entryFieldAddress)], cause: "routine", by: { run: { sessionId: a.sessionId,
   messageId: anchor?.messageId ?? null, runId: anchor?.runId ?? null, shownAs } } })`, recorded whether or not
   `anchor` is set. `shownAs` = `routineRunOf(anchor?.runId)?.shownAs?.name` (`pipelines/routines/runs.ts`,
   dynamic import as the file does elsewhere); if that is empty and the pipeline's own shown name is plainly in
   scope in that closure, use it; otherwise null. Nothing in the `holdLoreEntryChange` early return.
2. **Retraction** (`imprints.ts`): add an optional `redline?: RedlineTaken` to the `reverted` member of
   `TakenImprint`. In `retractImprints`, when an imprint with `subjectKind === "entry"` and a `field` is
   **reverted** (`access.write` back to `before`), call `takeBackRedline(db, { entryId: imprint.subjectId,
   sessionId: imprint.sessionId, messageId: imprint.messageId, runId: imprint.runId, address: imprint.field })` and
   keep the result on the taken record. `kept`, `spliced`, `dropped`: the write still stands in the history; leave
   its row. `unmade`: the entry's delete cascades its rows. In `restoreImprints`, for a `reverted` record with a
   `redline`, call `putBackRedline(db, t.redline)` **only when the field was actually written back** (the branch
   that sets `changed = true`). The taken records ride the forward stack as JSON (`sessions/rewind.ts` ~806 revives
   them with `reviveRetractedState`, `state/write.ts`): `RedlineTaken` is already JSON-safe; check that the revive
   does not mangle it, and that `restoreImprints`' reverse order puts a deleted row back before the keys taken from
   it earlier.
3. **Revert** (`settleKeptImprint`): add an optional 4th parameter `by?: { userId: number }`. When `choice ===
   "revert"`, the imprint is an entry field, and `by` is given: after `access.write`, read the row again and
   `recordEntryRedline(db, { before: row, after: <row re-read>, named: [imprint.field], cause: "revert", by: {
   userId: by.userId } })`. (Worker 2 passes `{ userId }` from the socket caller.)
4. **Apply and Take back** (`ownBook.ts`): give `writeEntryKeys` a 4th parameter `edit: { cause: "apply" |
   "take-back"; by: RedlineAuthor }`; inside, read the row before the update, update with `.returning()`, and
   `recordEntryRedline(t, { before, after, named: Object.keys(data), cause: edit.cause, by: edit.by })`. Callers:
   ~2110 (merged history day, apply), ~2355 (undated held change, apply), ~2749 (merged day taken back,
   take-back), ~2760 (entry change taken back, take-back). The author: an Apply pressed by a person
   (`ApplyWho` `{ by: { userId } }`) → `{ userId, sessionId: input.sessionId }`; an Apply made by itself
   (`{ automatic }`) → `{ sessionId: input.sessionId }`; a take-back → the person who pressed it, with the session
   (read the take-back function's input to find both; if no person is known there, stop and report).
5. **Share as a lorebook** (`shareAsLorebook`): inside its transaction, `await clearRedlines(tx as unknown as Db, {
   lorebookId: ownBook.id })`.
6. **Ruleset tie** (`ties.ts` `entry-field`): after the update, record the field: before = the stored `fields[field]`
   row values, using `recordRedline` directly or `recordEntryRedline` with the row read before and after (your
   choice), cause `"routine"`, by `{ run: { sessionId, messageId, runId, shownAs: routineRunOf(runId)?.shownAs?.name
   ?? null } }` from the anchor / context the function has. If the write there is on a handle that is not a
   transaction, record on the same handle and **say so in the report** (a stop condition for the supervisor).
7. **Registry** (`tableRegistry.ts`): an entry-scoped spec for `schema.loreRedlines`, placed after the entry
   annotations spec: `scope: "entry"`, `lineScoped: false`, `notCopied: "an entry's edit history never
   travels"`, `copy: async () => {}`, `purge` deleting rows whose `entry_id` is in the book's entries (as the
   vectors spec does, `entryIdsOf`), `count` the same way. `tableRegistry.test.ts` ~62 fails for an unregistered
   table: make it pass.

**Not recorded, do not add a call:** `sessions/dcCairns.ts` (it runs only from `startup/index.ts`, a start-up
upgrade: the owner ruled those out; the supervisor reports this), provided books and primers upgrades, boot data
upgrades, imports, marks, positions, archive, line moves, the list above.

## Tests (Done means)

Through the real functions and outlets (find the harness the neighbouring suites use: `imprints.int.test.ts`,
`ownBook.int.test.ts`, `host.fullDirect.int.test.ts`, `host.heldEntryChange.int.test.ts`,
`host.historyWrites.int.test.ts`, `tableRegistry.copyInto.int.test.ts`):

- a pipeline's write to an entry (`update-lore-entry@1` through the host, or the nearest existing outlet test)
  leaves exactly one row: right before/after, cause `routine`, `session_id`, `run_id`, `shown_as` as available; a
  write that changes nothing leaves none; a held change (`holdLoreEntryChange`) leaves none; a history-day filing
  leaves one row on the day.
- **30 swipes**: a person's edit (insert a `save` row with `recordEntryRedline`, or through the socket if trivial),
  then a turn whose run rewrites the entry, retracted and rewritten 30 times (the real retraction:
  `retractImprints` by message or by run, then a new write) → the history holds the person's row and **one**
  routine row. Forward (`restoreImprints` of a retraction's taken list) puts the row back with the write.
- a `kept` retraction (the field changed since) leaves the run's row.
- Revert (`settleKeptImprint(..., "revert", { userId })`) leaves one `revert` row as that person.
- Apply of an undated held change: one `apply` row; Take back: one `take-back` row; Apply that **moves** a notes
  entry into the lorebook keeps its rows (keyed by entry); a merged history day arrives as one `apply` row on the
  lorebook's day; a dated held change applied leaves no row.
- the limit: 60 routine rows after one person row → 50 newest kept plus the person's row (51 total).
- duplicate / a starter copy / Merge into notes (`copyLorebookTables`) carry no rows; Share as a lorebook clears
  them; deleting an entry or a dated change deletes its rows; an overwrite import's purge removes them.
- the tie's entry-field write leaves one `routine` row.
- Existing suites still pass: `src/lib/server/lorebooks/` (imprints, ownBook, tableRegistry),
  `src/lib/server/pipelines/runtime/host.*` (at least the lore-write ones), `src/lib/server/rulesets/`.

Run tests **only** like this, from the repo root, one run at a time, with full paths:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/edit-history-a-w1-<n>.log 2>&1"`
Before **every** run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` — if any vitest is running
(two other sessions test on this checkout), wait and check again; never two runs at once; never `pgrep -f
"vitest run"` in a loop. Never pipe vitest into `head`. An int test that opens a DB inside an `it` takes a 60 s
timeout. A failure in a file lane `timeline-a` is editing (host.ts lore-day/held-change paths, ownBook
`insertOwnBook`, storyTime, reading) may be theirs: report it, don't fix it.
Typecheck at the end: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/edit-history-a-w1-tsc.log 2>&1`
and report errors in your files only (others' files may be mid-edit).

## Stop and ask when (put it in your report and stop that part)

A writer of an entry's text exists that this brief does not list; a write site has no transaction; a routine's
shown name cannot be had without a run id, model or connection leaking into what is shown; a file outside the owned
list is needed; anything a user sees.

## Verbatim

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs no `sdk:build` at all.)
- Never `kill -9`.
