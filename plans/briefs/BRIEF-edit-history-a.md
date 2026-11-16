# BRIEF — build lane `edit-history-a` — an edit history for lorebook entries

**A go (owner, 2026-11-14: "Go: both lanes side by side").** Reviewed cold; the corrections below rule.

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then
`plans/PLAN-edit-history-2026-11-13.md` (the facts: every writer of an entry's text, what already records
changes, what travels, the cleanup surfaces), `plans/PLAN-entry-time-and-lines-2026-11-14.md` §2, §5 (rules 2 and
8) and §8's ruling note, the header of `src/lib/server/lorebooks/imprints.ts` (1–60: the per-turn undo record,
which this is **not**), `docs/lorebooks.md` "Changes from a replaced reply", CLAUDE.md Hard rules (migrations),
Principles, Standing rulings, NOMENCLATURE §1, §23, §24, §25, STYLE-GUIDE §6.4, §6.6, §6.11, §6.21, §10. Line
numbers are from 2026-11-13: search by name.

Words. A **build lane** is this stream of work. An **edit** is one save that changed an entry's name, text,
keywords or typed fields: by a person, a routine, an Apply or a restore. A **dated change** (`entry_amendments`)
is part of the story's timeline and is not an edit history; but editing a dated change **is** an edit.

## Rulings that bind (owner, 2026-11-13 and 14)

- "Perhaps we should keep a change history. Change history that's not a dated change on the timeline (i.e. it's
  purely an edit and not a timeline evolution) does not persist on copy, export, share, copied from starter, etc.
  We can add admin and user controls for cleaning up non persistent change history."
- Agreed shape ("I agree", then "Lets go with all your recommendations"): every save that changes an entry's
  name, text or typed fields keeps the previous values, with when and who (a person, or *‹routine› in
  ‹session›*); a list with **Restore**, and a restore is itself recorded; it belongs to the lorebook, not to a
  session; it never travels; the name in the UI is **Edit history**; it records saves by a person, writes by a
  routine, **Apply**, **Revert**, **Take back** and **Restore**, not plugin upgrades or upgrades at start-up;
  **Share as a lorebook** clears it; an overwrite import clears it; the last 50 per entry are kept; entries
  (places and history days included) first, cast and cards in later lanes.
- From the plan's rules, ruled with it: the limit never evicts the newest row a person wrote; clearing is the
  lorebook owner's alone.
- Standing: members never see model plumbing (a routine's or pipeline's shown name and a session's name are
  fine; never a run id, a model or a connection); 0.6 is in users' hands; P2 (one writer per thing).

## Corrections from the cold review (2026-11-14) — these override anything below that disagrees

1. **Back, swipe, regenerate and Forward do not record.** A run's write that is taken back with its turn takes
   **its own edit row with it**, and Forward puts that row back with the write (what a message changed goes with
   it). Match the row to the write by entry + run + message, or keep the per-turn record's id on the row (your
   choice; say which). Do this at the callers (`retractImprints`, `restoreImprints`), never inside
   `SUBJECTS.entry.write`, which runs once per field and knows no cause or person. Only the *replaced* note's
   **Revert** records a row (`settleKeptImprint`'s socket caller has the user): as that person, cause *revert*.
   Test: 30 swipes of a turn that rewrites an entry leave the history holding the person's original edit and one
   row for the standing reply's write.
2. **Keys on the row.** `session_id`, `message_id` and `user_id` never cascade a delete into the history (plain
   columns or SET NULL): deleting a session must not erase the lorebook's history. The routine's or pipeline's
   shown name is stored as text when the row is written (at `changeLoreEntry`: `routineRunOf(runId)?.shownAs?.name`,
   as `earmarkNotice` gets it). **A session is named only to a viewer who may open it** (`checkSessionAccess`, as
   `earmarkNotice` does, `sockets/entries.ts` ~421); otherwise the row reads 🚧 *‹routine› in a session*; a
   deleted session reads 🚧 *‹routine› in a session that was deleted*.
3. **Restore is two paths, written for the purpose.** Entry: only the lorebook's owner saves through
   `entries:update` today; Restore follows whoever may edit the entry there, and **refuses in words** when a key
   it would restore is no longer declared by the entry type (🚧 *‹label› is no longer part of this kind of
   entry.*) instead of silently dropping it (`splitUpdate` drops such keys). Dated change: `amendments:update`
   replaces `fields` whole, so Restore sends the stored fields with the row's keys put back, and a key that was
   absent before is removed. Say in the report that restoring a field a run wrote marks its per-turn record
   *kept*, so the *replaced* note appears: that is what any hand edit does (`markImprintsKept`).
4. **Where the call goes, and what is not an edit.** In `changeLoreEntry` the call sits inside `write(tx)`
   after the update (this covers `fileOntoHistoryDay`); the early return into `holdLoreEntryChange` records
   nothing: a held change waits in a session's notes and is not an edit of the entry. Apply of an undated held
   change records through `writeEntryKeys`; a dated one applied is a new version, not an edit. Compare only the
   keys the write names (as `imprintChanges` does) so `graphed` and `isCompleted` never count. No row for:
   `entries:setMarks`, the graph build's `fields.graphed`, the cast-absorb anchor writes, `utils/forkHistory.ts`,
   `sessions/forgetNote.ts`, the import's anchor pass, `copyFromLibrary`, `iterateNext`. The history-day merge at
   Apply deletes the notes day: its history goes with it, and its text arrives on the lorebook's day as one
   Apply row ("Apply keeps an entry's history" in Done means is for an entry that is **moved**, not merged).
5. **The table has exactly two keys into the lorebook:** the entry (FK, cascade) and a nullable dated change (FK,
   cascade). Nothing polymorphic and nothing for cast or cards: a later lane adds its own nullable key. The
   "let a later lane key by a `character_versions` row" clause in rule 1 is struck.
6. **Facts.** Register it as an entry-scoped spec (`tableRegistry.ts` ~594, ~627), not the book-scoped
   `binding_merge_logs` pattern (the table has no `lorebook_id`). The common form save runs with no transaction
   (`applyEntryUpdate` on `db` when there is no re-parent and no re-date): wrap that branch in one; this is not
   a stop. `host.ts` has drifted: `changeLoreEntry` ~2459, `holdLoreEntryChange` ~2346, `fileOntoHistoryDay`
   ~2570; search by name. Forward re-inserts a made entry under its old id with no history: fine.
7. **Order of work:** pass 1, server (table and migration after `timeline-a`'s, the one writer, the call sites,
   never-travels, the list / restore / clear sockets, server tests); pass 2, client (the fold, the two clear
   confirmations, the Admin › Data row, DOM tests). The fold's placement is interim and an **open ★** in the
   report.

## The rule to build

1. **The record** (🚧 names per §24): one table, one row per edit, keyed by the **entry** (never by a lorebook
   id: Apply and Take back move an entry between books by rewriting `lorebook_id`, `lorebooks/ownBook.ts` ~2176,
   ~2715), deleted with the entry (FK cascade). A row holds: which version it changed (null = the entry itself,
   else the dated change's id, deleted with it), the changed fields with their value **before and after**, when,
   and who: a person (user id) or a run (the session id and the routine's or pipeline's shown name as it read
   then, plus the message id when a turn caused it), and the cause (🚧 save / routine / apply / revert /
   take-back / restore). The design must let a later lane key the same table by a `character_versions` row (cast
   and card versions) without reshaping it; build nothing for those now.
2. **One writer.** A single function records an edit on the transaction of the write that made it; every site
   below calls it; no site inserts into the table by itself. An edit that changes nothing records nothing.
3. **Every writer of an entry's text records** (list and lines in `PLAN-edit-history` §Facts): the form save
   (`applyEntryUpdate`, `sockets/entries.ts`); a pipeline's write (`changeLoreEntry`, `host.ts`, including
   `fileOntoHistoryDay`); Apply and Take back (`writeEntryKeys`, `ownBook.ts`); Revert, retract and restore of
   the per-turn record (`SUBJECTS.entry.write`, `imprints.ts`); a ruleset tie's field write
   (`rulesets/ties.ts` ~732); the Dungeon Crawler's cairn retitle (`sessions/dcCairns.ts` ~351); and edits of a
   dated change's fields (`sockets/amendments.ts` create is not an edit; update is). **Not recorded:** provided
   books and primers upgrades, boot data upgrades, imports, marks, positions, archive, line moves.
4. **The limit.** After a row is written, an entry keeps its 50 newest rows, except that the newest row whose
   author is a person is never evicted.
5. **Restore.** Puts the row's *before* values back into the version it names, through the same save path a
   person's save takes (so the earmark refusal, the declared-field checks and the per-turn record's "kept"
   marking all apply), and is recorded as an edit with cause restore. Refused in words when the version it
   names is gone. Whoever may edit the entry may restore.
6. **It never travels.** Registered in the lorebook table registry as not copied (`lorebooks/tableRegistry.ts`
   ~1092, the `binding_merge_logs` pattern; `tableRegistry.test.ts` ~62 fails otherwise); **Share as a
   lorebook** clears it for that book (`ownBook.ts` ~1196–1245); export leaves it out; an overwrite import
   removes it with the entries it purges.
7. **Screens.**
   - The entry form gets an **Edit history** fold under the fields, where the *Amendments* list sits today
     (`lorebooks/EntryWorkspace.svelte` ~2199), closed by default, showing the count. Each row: who (🚧 *You*,
     a person's shown name, or *‹routine› in ‹session›*), when (relative, exact on hover), which fields changed
     with before → after for short values and a *Show* disclosure for long text, and **Restore**. A row for a
     dated change says which (*the change from Year 7*). This placement is interim: the ruled design lists edits
     under each version of a timeline rail, a later lane.
   - **Clear edit history** for one entry in the entry's ⋯ menu, and for the whole lorebook in Book settings
     under "This book" (`lorebooks/BookSettings.svelte`), each behind a confirmation that names the count; the
     lorebook's owner only.
   - Admin › Data (`client/admin/sections/data/Page.svelte`): one row in the count + size + **Clear** pattern
     of `components/media/SpokenLinesRow.svelte`, 🚧 *Edit history · N edits · ‹size›*, with a sentence saying
     what clearing loses.
   - All copy is 🚧 and listed in the report.
8. **Sockets.** A request to list an entry's edits and one to restore, one to clear (entry or lorebook), and
   the admin count and clear; replies carry the scope key (`lorebookId`) where the family is scoped; additive
   types in `shared/sockets/types.ts`, `client/sockets/typedSocket.ts`, `shared/sockets/interest.ts`,
   `shared/sockets/scopedReplies.test.ts`. No pushed event.
9. **Migration.** The table comes from `npm run db:generate` only. Lane `timeline-a` generates first: **wait
   until `plans/timeline-a-migration.txt` exists**, re-read `drizzle/meta/_journal.json`, then generate; check
   the SQL holds only your table. Never seed a row. A second boot changes nothing (nothing to backfill: history
   starts empty).
10. **Docs and ledgers in the same change:** `docs/lorebooks.md` (a short section; say what is and is not
    recorded and that it never travels), the admin doc where Data is described, NOMENCLATURE rows and §25,
    STYLE-GUIDE only if a pattern is new.

## Files owned

`src/lib/server/db/schema.ts` (the one table) and the generated migration; a new module for the record and its
one writer (beside `lorebooks/imprints.ts`); the call sites named in rule 3, each for the one call
(`sockets/entries.ts`, `pipelines/runtime/host.ts` `changeLoreEntry` and `fileOntoHistoryDay`,
`lorebooks/ownBook.ts` `writeEntryKeys` and the surface function, `lorebooks/imprints.ts` `SUBJECTS.entry.write`,
`rulesets/ties.ts`, `sessions/dcCairns.ts`, `sockets/amendments.ts` update); `lorebooks/tableRegistry.ts` (one
spec); the new socket handlers and their registration; `shared/sockets/types.ts`, `client/sockets/typedSocket.ts`,
`shared/sockets/interest.ts`; client: `lorebooks/EntryWorkspace.svelte` (the fold and the menu item), a new
component for the list, `lorebooks/BookSettings.svelte` (one action), `client/admin/sections/data/Page.svelte`
and a new row component; their tests; the docs above; `NOMENCLATURE.md`. **Not** `sessions/settle.ts`,
`sessions/rewind.ts`, `sockets/sessions.ts`, `Layout.svelte` (if a new `:error` event must join the shell's
handled errors, list it for the lead), `state/storyTime.ts`, `state/reading.ts`, any SDK file. Lane `timeline-a`
is editing `host.ts`, `ownBook.ts`, `db/schema.ts` and `sockets/lorebooks.ts` at the same time, elsewhere in
those files: keep each edit to the one call, re-read a region right before editing it, never reformat a file.

## Out of scope

Cast versions and card versions; the versions timeline; merging with or changing the per-turn undo record;
recording who *read* an entry; a trash for deleted entries; a setting for the limit; any SDK surface; a pushed
event.

## Stop and ask when

A writer of an entry's text exists that rule 3 does not list (report it; do not guess whether it records); a
write site has no transaction to record on; the shown name of a routine cannot be had at a write site without
model plumbing leaking; Restore cannot go through the person's save path; the migration index is contested or
`plans/timeline-a-migration.txt` does not appear; a file outside the owned list is needed.

## Done means

Tests, through the real handlers and outlets: each writer in rule 3 leaves exactly one row with the right
before, after, author and cause, and the unrecorded writers leave none; a save that changes nothing leaves none;
a routine's rewrite then a person's Restore brings the text back and is itself listed; Restore of an earmarked
entry is refused with the earmark sentence; the limit keeps 50 and keeps the newest person-written row through
60 routine rewrites; Apply moving an entry between books keeps its history; duplicate, a starter copy, Merge
into notes and export carry none (the registry test passes); **Share as a lorebook** clears it; deleting an
entry or a dated change deletes its rows; a member who is not the owner cannot clear; the admin count and clear;
DOM tests for the fold (closed with a count, a row's parts, the long-text disclosure, Restore) and the two
clear confirmations. Existing suites pass: `sockets/entries.*`, `sockets/amendments.int`, `server/lorebooks`,
the `runtime/host.*` tests, `rulesets`, `client/lorebooks`, `shared/sockets`.
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` clean; `npm run check`
(`NODE_OPTIONS=--max-old-space-size=12288`) no new errors. Tests only inside
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > log 2>&1"`
from the repo root, one run at a time; two other sessions' work runs tests here too: before each run check
`ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` and wait (never `pgrep -f "vitest run"` in a
loop). An int test that opens a DB inside an `it` takes a 60 s timeout. No `npm run sdk:build`. Inside a
transaction use only `tx`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`. Comments state the
rule, not the story. At most two workers at once.

Verbatim for every worker brief:
- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."
- Never `kill -9`.

## Report

**Return the full report as your final message** (the lead saves it as `plans/REPORT-edit-history-a-<date>.md`):
the record's name and shape; the one writer; each call site and what it records; the limit rule; Restore's path;
what clears it; the sockets; copy verbatim; the migration's index and name; changed files; tests and results;
open ★; **Noticed, not done**. Say plainly that nothing was looked at in a running app.
