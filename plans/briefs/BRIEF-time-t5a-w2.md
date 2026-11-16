# BRIEF — `time-t5a` worker 2 — the per-turn record learns an entry version

Repo `/home/jody/github/serene-pub`. First read `plans/briefs/BRIEF-time-t5a-rules.md` (the rules, rulings,
words and how to run tests); it is part of this brief. Then read `src/lib/server/lorebooks/imprints.ts` whole
(911 lines; its header states the one retraction rule) and `src/lib/server/lorebooks/redlines.ts` ~397–494.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

A session's turn will soon write an entry's dated version (an `entry_amendments` row, `base` NULL, on the
lorebook) and must be able to take it back with its turn. The per-turn record (`lore_imprints`) gets one new
subject kind, **`version`**: `subject_id` is the `entry_amendments` id, `lorebook_id` the version's lorebook,
`field` the **wire key** inside the version's `fields` jsonb (`name`, `content`, a declared typed field's key,
`keys`…), or NULL for a version the turn made. The supervisor has already widened the CHECK
(`db/schema.ts`, generated `drizzle/0164_imprint_versions.sql`). Owner ruling: "the turn's undo is the per-turn
record; every write also lands in the edit history".

The rule of taking back (unchanged, now also for versions): a version the turn **made** is deleted when it is
still as made and nothing else stands on it; a version the turn **changed** gets each changed field's earlier
value back while the field still holds what the turn wrote; **a field the turn added is removed: the key is
deleted, never written as null**. When another session or a person changed it since, the turn's part is not
ripped out: the record is **kept** and the entry shows the existing *replaced* note. Forward puts back what
was taken.

## Build (only these two files, plus the tests below)

`src/lib/server/lorebooks/imprints.ts`:
1. `IMPRINT_SUBJECTS` gains `"version"`. `imprintMade` accepts `subject: "entry" | "relationship" | "version"`.
   Add versions to the header's list of lorebook subjects (one clause).
2. `SUBJECTS.version` (beside `entry`): `row` = the `entry_amendments` row by id; `bookOf` = its `lorebookId`;
   `read(row, field)` = `(row.fields ?? {})[field]` (absent → `undefined`); `write(db, id, field, value)` = read
   the row's `fields`, delete the key when `value === undefined`, else set it, and update `fields` and
   `updatedAt: new Date()`; `remove` = delete the row (its `lore_redlines` rows go by cascade, as a made entry's
   do); `insert(snapshot)` = insert the snapshot with its id, `createdAt`/`updatedAt` turned back into dates (the
   snapshot rides JSON on the forward stack, as `withDates` does for entries); `ignored` = `id`, `createdAt`,
   `updatedAt`; `holds(db, id, imprint)` = true when a `lore_redlines` row on `amendment_id = id` was written by a
   person (`user_id` not null) or by another session (`session_id` not null and ≠ `imprint.sessionId`).
3. `retractImprints`: when a `version` field imprint is **reverted**, take its edit-history key back with
   `takeBackRedline({ entryId: row.entryId, amendmentId: imprint.subjectId, sessionId, messageId, runId, address:
   imprint.field })` (see redlines below), as the entry branch does.
4. `retractImprints`: a `version` imprint whose session no longer has that lorebook as its lorebook
   (`sessions.lorebook_id` ≠ `imprint.lorebookId`, e.g. after the notes folded the lorebook in) is **dropped**
   (`act: "dropped"`, the imprint deleted, the row untouched): a session never writes a book it no longer reads.
   Cache the session's lorebook per call. Entries and other subjects are unchanged.
5. `keptImprintsByEntry`: also return the book's **kept** `version` imprints whose version's `entry_id` is in
   `entryIds`, under that entry id, in imprint id order merged with the entry's own. `label`: `name` → "Name",
   `content` → "Content", a key the type declares → its declared label (`fieldLabel(entryFieldAddress(key),
   decl)`), anything else `fieldLabel(key)`; a made version (`field` null) has `label: null` as a made entry does.
   No change to the `KeptImprint` wire type.
6. `settleKeptImprint` for a `version`: Revert of a field writes `before` back through `SUBJECTS.version.write`
   (so an absent `before` deletes the key) and, when `by` is given, records a `revert` edit-history row with
   `recordRedline(db, { entryId: row.entryId, amendmentId: imprint.subjectId, before: <fields before>, after:
   <fields after>, keys: [imprint.field], cause: "revert", by: { userId } })`. Revert of a made version deletes
   the version (the existing `remove` branch). Either way return `typeId` = the type of the version's entry, so
   the socket relists the book (`sockets/entries.ts` ~2630 reads `settled.typeId`).
7. `markImprintsKept` needs no change (it is by subject kind); confirm with a test.

`src/lib/server/lorebooks/redlines.ts`:
8. `takeBackRedline` takes an optional `amendmentId`. Given: it matches `amendment_id = amendmentId` (instead of
   `IS NULL`) and the key is `address` itself (a version's record names the wire key). Absent: exactly as today.
   Update its doc comment.
9. `putBackRedline`: when the row being put back whole has an `amendmentId`, return without inserting if that
   `entry_amendments` row no longer exists (the foreign key would refuse it).

## Tests

- New `src/lib/server/lorebooks/imprints.version.int.test.ts`. Fixtures: copy `imprints.int.test.ts`'s (test
  DB mock, user, lorebook, session with `lorebookId` set, real `messages` rows so `assertRetractable` passes);
  insert the entry and the version rows directly; file records with `imprintMade` / `imprintField` (subject
  `"version"`, an anchor with the session, a message id and a run id); retract with `retractImprints(db,
  { messageIds })` and put back with `restoreImprints` (also after a JSON round trip of the taken list). Cases:
  made → retract deletes the row → restore re-inserts it with its id and fields; changed (`before` a value) →
  reverted → restored; a field the turn added (`before` undefined) → the key is gone afterwards and is **not**
  `null`; a person changed that field since → kept, value stays; another session's standing record on a version
  this turn made → the made record is kept and the row stays; a person's `lore_redlines` row on the version →
  `holds` keeps it; `markImprintsKept({ subjectKind: "version", … })` → retraction leaves it; a routine
  `lore_redlines` row (session, run, message, `amendment_id`) loses the key on revert and gets it back on
  restore; `keptImprintsByEntry` returns a kept version record under its entry id with the label;
  `settleKeptImprint(…, "revert", { userId })` puts the field back, writes a `revert` row with `amendment_id`,
  returns the entry's `typeId`; the session's `lorebook_id` set to null → the version record is dropped and the
  row untouched; `settleThrough` (`sessions/settle.ts`) past the message marks a version record `settled` and a
  later retraction does nothing to it.
- New `src/lib/server/db/imprintVersions0164.int.test.ts` modelled on `db/entryDecay0162.int.test.ts`: migrate
  through `0163_redline_versions`, insert a `lore_imprints` row of kind `entry` (with the user, lorebook, session
  it needs), migrate the real folder, then a `version` row inserts and a kind `bogus` is refused by the CHECK;
  a second migrate changes nothing (ledger hashes and rows equal).
- Re-run unchanged: `src/lib/server/lorebooks/imprints.int.test.ts`, `imprints.holds.int.test.ts`,
  `imprints.otherSessionLink.int.test.ts`, `imprints.rule.test.ts`, `redlines.callSites.int.test.ts`,
  `redlines.apply.int.test.ts`, `src/lib/server/db/redlineVersions0163.int.test.ts`.

Report per the rules file.
