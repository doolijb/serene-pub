# BRIEF — `time-t5a` worker 3 — a dated session writes its change as a dated version at once

Repo `/home/jody/github/serene-pub`. First read `plans/briefs/BRIEF-time-t5a-rules.md` (the rules, rulings,
words and how to run tests); it is part of this brief.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**Data safety comes first.** This changes what a running session writes and how Back undoes it. If anything
below cannot be met as written, or a change that waits today would be dropped, refused or written twice, stop
and report instead of improvising.

## Files you may edit

`src/lib/server/pipelines/runtime/host.ts` (only `lorebookChangeHeld`, `changeLoreEntry` and the
`core:outlet/update-lore-entry` / `create-lore-entry` lines named below), new
`src/lib/server/pipelines/runtime/host.datedVersion.int.test.ts`, and existing `host.*.int.test.ts` files only
as section "Existing tests" says. Another worker edits `lorebooks/ownBook.ts` and `sockets/amendments.ts` now:
do not touch them, nor `imprints.ts`, `redlines.ts`, `entryVersions.ts` (done; use them).

## Read first

`host.ts` ~2339–2610 (`holdLoreEntryChange`, `lorebookChangeHeld`, `changeLoreEntry`), ~11994–12080 (the match
path of `create-lore-entry`), ~12281–12487 (`update-lore-entry`). `lorebooks/entryVersions.ts` (whole, short).
`lorebooks/imprints.ts` `imprintMade`, `imprintField`, `SUBJECTS.version`. `lorebooks/redlines.ts`
`recordRedline`. Tests: `host.fullDirect.int.test.ts` (fixtures to copy: `world({ clock })`, `place`,
`messageIn`, `hostOf`, the swipe / Back / Forward recipe at ~242–272), `host.heldEntryChange.int.test.ts`.

## The rule to build

On the `book` route (Full, the session's owner's own lorebook), a change to an existing **lorebook** entry by a
session whose reading has a moment (`line.reading.moment != null`, `line.reading.timelineOff !== true`) is
written **at once as a dated version** at `dayOnly(line.reading.moment)` on `line.branchId`, in the pipeline
write's own transaction, through `writeEntryVersion`. It never overwrites the entry's stored row and never
waits in the notes. The change **waits (held, as today)** only when: the stored entry is not in the write's
lorebook (any other route, as today); the entry is on another line than the session's, or the session's line
is still to be forked (as today); this session already holds a change on that entry (as today: a second held
row); **the change is dated before the entry's Beginning** (new hold reason); a moment with the Timeline off
(theoretical; held as today). Nothing else is held. A session with no moment is written in place exactly as
today. A notes entry and a history day filed through (`writeThrough`) are exactly as today.

## Build

1. `lorebookChangeHeld`: keep every existing test; replace "a moment → held" with: moment and
   `timelineOff === true` → held; moment and `beginningRefusal(dbx, lorebookId, stored.id, dayOnly(moment))`
   non-null → held. Rewrite its doc comment to the rule above.
2. `changeLoreEntry`, after the existing hold branch and the existing another-line refusal: when
   `!a.writeThrough`, the stored entry is not in the session's notes, and `line.reading.moment != null &&
   line.reading.timelineOff !== true`, take the **dated version** path instead of the in-place write. Inside
   the caller's `at`, else `db.transaction` with `pg_advisory_xact_lock(${lorebookId})` (only `tx` inside):
   - `data` = the patch plus a trimmed non-empty `name` and a string `content`, as the hold branch builds it.
   - What the session reads now, exactly as `holdLoreEntryChange` reads it (`sessionReadingOf(tx, sessionId)`
     with its fallback, `entryOverlaysFor`, `entryAt`, `toEntryRow`); `kept` = keys whose value differs
     (`sameValue`). None → return `false`.
   - A key in `NEVER_AMENDED` → throw the **same** `HostScopeError` sentence `holdLoreEntryChange` throws
     (factor the sentence into one local helper both call; byte-identical).
   - `beginningRefusal(tx, lorebookId, stored.id, date)` non-null (the Beginning moved since the decision) →
     `return holdLoreEntryChange({ nodeKey, sessionId, stored, data }, tx)` (it waits with that reason).
   - `writeEntryVersion(tx, { lorebookId, entryId: stored.id, branchId: line.branchId ?? null, date, fields:
     <the kept keys and their values> })`.
   - The per-turn record, when `anchor` is set: `made` → `imprintMade(tx, anchor, { lorebookId, subject:
     "version", subjectId: id })`; `merged` → for each kept key `imprintField(tx, anchor, { lorebookId, subject:
     "version", subjectId: id, field: key }, <before[key], undefined when absent>, after[key])`.
   - The edit history: `recordRedline(tx, { entryId: stored.id, amendmentId: id, before: made ? {} :
     before, after, keys: kept, cause, by })` with the **same** author rule as the in-place write (a person's
     press with no anchor and a `scope.userId` → `save` by that person; otherwise `routine` by the run with
     `shownAs`). Factor that author computation into one local helper both writes call.
   - Return `true`. Do not delete vectors (the stored row did not change).
3. `update-lore-entry`: the history re-date checks (`moved`) run today only when `!held`; they must not run on
   the dated path either. Add a `datedVersion` boolean (lorebook entry, not held, moment, timeline on) and guard
   `moved` with `!datedVersion`. The result stays `{ route: "book", lorebookId: target.lorebookId }` on the dated
   path.
4. `create-lore-entry`'s match path needs no logic change; update the comments that say a dated change waits.
5. Comments state the rule, not the story.

## Tests

New `host.datedVersion.int.test.ts`, through the real outlets (`CREATE` with `match`/`shown`, `UPDATE`), each
`it` with the 60 s timeout. A lorebook entry (e.g. a Place) and a dated session (`storyClock*` set; make sure
the lorebook's timeline is on, as `host.fullDirect.int`'s dated test does). Cases:
1. `UPDATE` writes one `entry_amendments` row on the lorebook, `base` NULL, at the session's day, on the
   session's line, holding only the changed keys; the stored entry row is unchanged; no held row in the notes;
   the result says `route: "book"`.
2. The session reads the new text at once (`sessionEntriesAsRead` or `contentAsRead`); a second session on the
   same lorebook and line at a later date reads it; one at an earlier date reads the old text; a session on a
   fork of the lorebook forked before that date reads the old text.
3. A second change the same day by the same session (next turn: a new message and run id) updates the same row
   (still one row); by another session at the same date on the same line, the same.
4. Each undo path, for a version the turn **made** and for one it **changed** (a person's version at that date
   made first with `writeEntryVersion` or a direct insert): swipe/regenerate (`retractStateAnchoredTo(…,
   "replaced")`), Back/delete (`"leaves"` in a transaction), and Forward (`reviveRetractedState` of the JSON
   round trip, then `restoreRetractedState`). Made → the row is gone, then back with its id; changed → each field
   back to the person's value, a field the turn added is **absent, not null**; Forward puts the turn's values
   back. Taking back the **second** turn restores the **first** turn's text, not the person's.
5. Another session's later change to the same version survives the take-back (the record is kept, the other
   session's text stays); a person's hand edit of the field since (direct DB update) likewise.
6. The edit history: a `routine` `lore_redlines` row with `amendment_id`, the run and the message; Back on a
   changed version takes its key back.
7. `settleThrough` past the turn → Back no longer takes the version (the record is `settled`).
8. A Beginning (set `fields.year` on a type that `takesBeginning`) after the session's day → the change is held
   in the notes as today (a held row, `base` set), the lorebook has no version, result `route: "own-book"`.
9. Unchanged: no moment → written in place (stored row changes); this session already holds a change on the
   entry → a second held row; a session on a fork changing main's entry → held; Review changes → held; a
   History entry's date keys in `UPDATE` on a dated session → the same refusal sentence as before.

## Existing tests

Run all `src/lib/server/pipelines/runtime/host.*.int.test.ts` before and after your change (two logs). A test
that fails **only** because it pinned "a dated session's change waits" is rewritten: either to the new rule (a
dated version), or, where it exists to cover the held path, moved to a reason that still holds (Review changes,
a branch on main's entry, or a second held change) so no held-path coverage is lost — as lane `full-direct`
did. Never delete or skip a test. List every rewritten test by name with old → new expectation. A failure
that is not explained by this rule: stop and report it, do not "fix" it. Do not edit test files outside
`pipelines/runtime/`; list their failures instead.

Report per the rules file.
