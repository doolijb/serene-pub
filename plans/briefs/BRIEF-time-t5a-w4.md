# BRIEF — `time-t5a` worker 4 — Apply's checks for a waiting dated change, ★FD-9, and a person's edit keeps the turn's record

Repo `/home/jody/github/serene-pub`. First read `plans/briefs/BRIEF-time-t5a-rules.md` (the rules, rulings,
words and how to run tests); it is part of this brief.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**Data safety comes first.** Nothing that waits today may be dropped or written twice. If anything below
cannot be met as written, stop and report.

## Files you may edit

`src/lib/server/lorebooks/ownBook.ts` (only `heldChangeVerdict`, `HELD_CHANGE_CONFLICTS` and the entry
classification loop of `applyOverlayItems`), `src/lib/server/sockets/amendments.ts` (only the four
`markImprintsKept` calls below), and new test files beside them. Another worker edits `pipelines/runtime/host.ts`
now: do not touch it, nor `imprints.ts`, `redlines.ts`, `entryVersions.ts` (done; use them).
**Do not change `takeBackApply`, Apply's dated move (`ownBook.ts` ~2403–2441) or its settle.**

## Background

A dated session's change to a lorebook entry under Full is now written at once as a dated version (another
worker). A change still **waits** in the notes (a held `entry_amendments` row, `base` set) when the session
already holds a change on that entry, stands on another line, or the change is dated before the entry's
Beginning; and always under Review changes. Apply moves a waiting dated change to the lorebook as its own row
(`applyOverlayItems` ~2403–2441); it never merges. Owner ruling (2026-11-14): "one version per entry, line and
date … a version cannot be dated before the entry's Beginning". So Apply must not write past either rule: such
a change **waits, with its reason**.

## Build

1. `heldChangeVerdict` (`ownBook.ts` ~1475): for a **dated** held row (`held.year != null`), after the existing
   Timeline-off return and before the per-key checks, two more early returns, each `{ agreeing: [], conflict,
   done: false }` (never `done`: a waiting change is never dropped by these):
   - `beginningRefusal(t, stored.lorebookId, stored.id, <the held row's date>)` (from
     `$lib/server/lorebooks/entryVersions`) non-null → that sentence is the conflict.
   - `ownChangeAt(t, { entryId: stored.id, branchId: reading.branchId ?? null, date: <the held row's date> })`
     finds a row → conflict `HELD_CHANGE_CONFLICTS.versionAt(<date words>)`, a new entry in that object:
     `` (date: string) => `The lorebook already has a version of this entry dated ${date} on this line; change that version there instead.` ``
     (🚧 provisional copy, as its siblings say). Date words: `formatDate(date, await bookCalendarOf(t,
     stored.lorebookId))` (`$lib/shared/lorebooks/storyDate`, `$lib/server/state/storyTime`).
   The held row's date is `{ year: held.year, month: held.month ?? null, day: held.month != null ? (held.day ??
   null) : null }`, as the function already builds its moment. Update the doc comment (one sentence each).
2. ★FD-9, `applyOverlayItems`' classification loop (~2068–2092, after `ensureSessionLine`): a notes history
   day with a date for which the lorebook holds no day on the session's line (the **move** path) is checked
   against rule C like the merge path (~2104–2112): `historyDayOwnerRefusal(t, { lorebookId: bookId, branchId,
   date })` non-null → `heldDays.push({ notesEntryId: own.id, reason })` and `continue` (it stays in the
   notes). Owner ruling: "the day waits with the reason".
3. `sockets/amendments.ts` — a person's write on a version keeps the session's per-turn record of it
   (`markImprintsKept` from `$lib/server/lorebooks/imprints`, `subjectKind: "version"`, `subjectId` = the
   amendment id), on the write's own handle (`tx` inside a transaction):
   - create, when `writeEntryVersion` returned `merged`: `fields` = the keys the person wrote;
   - `updateAmendment` (entry branch) with `fields`: the union of the before and after keys; with a re-date: the
     keys of the version's stored `fields` (both when both);
   - delete (entry branch): the keys of the row's `fields`, before the row is deleted.

## Tests

- New `src/lib/server/lorebooks/heldApply.versionChecks.int.test.ts` (fixtures: copy `heldApply.int.test.ts` /
  `autoApply.int.test.ts`; a held dated row may be inserted directly into the session's notes with `base` set,
  as those tests' helpers do): (a) a held dated change before the entry's Beginning: the overlay list
  (`overlayItemsOf`) shows it with the Beginning sentence as `conflict`; Apply leaves it held (`stillHeld` with the
  reason), writes nothing to the lorebook, and the row is still there; (b) the line already has a version at the
  held change's date: same, with the new sentence; the person's version is unchanged; (c) a held dated change at a
  free date still moves as before (regression); (d) automatic Apply (`applyHeldAutomatically` path used by
  `autoApply.int`) leaves (a) waiting too.
- ★FD-9 test, in the same file or `applyOwnBookLinksDays.int.test.ts`'s style: a session on a fork of the
  lorebook (fork date set) whose notes hold a history day dated **before** the fork, with no lorebook day for that
  date: Apply leaves the day in the notes with rule C's sentence in `heldDays`; a day dated after the fork still
  moves onto the fork line.
- New `src/lib/server/sockets/amendments.imprintsKept.int.test.ts` (fixtures: `amendments.oneVersion.int.test.ts`
  for the handlers; file the session's record with `imprintMade` / `imprintField` from `imprints.ts`, subject
  `"version"`, anchored to a real session message): a person's create at the same date (merge), an update of
  fields, a re-date, and a delete each turn the version's standing records `kept`; after the first three a
  retraction of the turn (`retractImprints(db, { messageIds })`) leaves the person's text.
- Re-run unchanged: `lorebooks/heldApply.int`, `autoApply.int`, `autoApply.settle.int`, `applyTakeBack.int`,
  `applyOwnBookLinksDays.int`, `applyForksLine.int`, `redlines.apply.int`, `sockets/amendments.oneVersion.int`,
  `amendments.beginning.int`, `amendments.redlines.int`, `amendments.int`. **Note:** another worker is changing
  how a dated session writes at the same time; a failure in these that comes from a test using a dated Full
  session to reach the held path is that change's, not yours: list it with the test name, do not edit it.
  Any other failure: stop and report.

Report per the rules file.
