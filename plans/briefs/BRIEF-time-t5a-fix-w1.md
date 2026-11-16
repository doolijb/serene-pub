# BRIEF — worker `time-t5a-fix-w1` — the server half: imprints.ts, redlines.ts, types.ts

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t5a-fix`. Return your report as your final message
(the harness refuses a write to a report path).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no migration. Leave the owner's `vite preview`
(port 4173) alone. Another session shares this checkout: before EVERY vitest run, check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one runs, wait (poll every 30 s) until none does.

## Goal

Data safety first: nothing here may change what a take-back (Back, swipe, regenerate, delete) does to lorebook
text. If a step would, stop and report instead.

Read first: `src/lib/server/lorebooks/imprints.ts` (all; `SUBJECTS.version` ~322, `TakenImprint` ~594,
`retractImprints` ~624, `restoreImprints` ~780, `keptImprintsByEntry` ~835), `src/lib/server/lorebooks/redlines.ts`
(header 1–31, `recordRedline` ~113, `RedlineTaken` / `takeBackRedline` / `putBackRedline` ~400–505),
`src/lib/server/state/write.ts` `reviveRetractedState` ~1180–1222 (taken imprints ride the forward stack as JSON),
`src/lib/server/lorebooks/imprints.version.int.test.ts` (fixtures `world`, `wrote`, `standing`, `fieldsOf`).

### Fix 1 — Back then Forward keeps a made version's edit-history rows

A version a turn made carries a `routine` edit-history row (`lore_redlines`, `amendment_id` = the version, FK
`ON DELETE CASCADE`). Back removes the version (`retractImprints`, the `notes || untouched` branch ~758) and the
cascade takes the row; Forward (`restoreImprints`, `unmade` ~795) puts the version back with no row.

- In `redlines.ts` (it owns every insert into `lore_redlines`; P2: one writer) add two exports:
  - `redlinesOfVersion(db, amendmentId)` → every `lore_redlines` row with that `amendment_id` (the rows the
    cascade will take), oldest first, JSON-safe: type `NonNullable<RedlineTaken["row"]>[]` (createdAt as ISO,
    as `takeBackRedline` builds it). No new type name.
  - `putBackVersionRedlines(db, rows)` → re-inserts them, ids kept, `createdAt` back to a `Date`,
    `.onConflictDoNothing()`, only when the entry and the version exist (as `putBackRedline` checks). No limit
    trim (as `putBackRedline`).
  - Add one bullet to the header comment saying the rule: a version a session made, taken back, takes its rows
    by cascade and Forward puts them back (`redlinesOfVersion` / `putBackVersionRedlines`). Leave the existing
    cast-version sentence alone.
- `TakenImprint`'s `unmade` gains an OPTIONAL `redlines?: NonNullable<RedlineTaken["row"]>[]`. Optional because
  forward stacks already stored in users' databases (`rewind_taken`) have no such key: absent = none.
- In `retractImprints`, in the remove branch, for `subject === "version"` only: read `redlinesOfVersion` BEFORE
  `access.remove!`, and push them on the `unmade` entry (omit the key when empty).
- In `restoreImprints`'s `unmade` branch: after `access.insert!` (and the imprint inserts), when `t.redlines?.length`,
  `putBackVersionRedlines(db, t.redlines)`. Same handle (`db` is the caller's `tx`).
- **Never seed a row at a hardcoded id** — the hard rule. These re-inserts are the one allowed case: they are the
  same rows the take-back removed, with the ids the identity sequence gave them, so no row made since can hold
  those ids. Do not re-insert any other row by id.
- Tests (in `imprints.version.int.test.ts`): a made version (`imprintMade` with subject `version`) with a
  `routine` row recorded through `recordRedline` (`by: { run: { sessionId, messageId, runId, shownAs: null } }`,
  `amendmentId`, `cause: "routine"`); `retractImprints` → version and row gone; round-trip the taken list through
  `reviveRetractedState(JSON.parse(JSON.stringify({ messageId: 0, imprints: taken })))` (check the shape it
  takes) and `restoreImprints` → the version back with its row, same row id and `changes`; a second
  `retractImprints` removes both again. Plus: an `unmade` entry with no `redlines` key restores as before.

### Fix 2 (server half) — `KeptImprint.versionDate`

- `src/lib/shared/entries/types.ts`, `KeptImprint`: add optional `versionDate?: string` with a one-line doc: the
  version's date in words through the lorebook's calendar, on a record whose subject is an entry version.
- `keptImprintsByEntry`: the `versionRows` select also takes `AMENDMENTS.year`, `.month`, `.day`; when there are
  version rows, read the calendar once (`bookCalendarOf(db, lorebookId)` from `$lib/server/state/storyTime`,
  dynamic import as the file does elsewhere) and set `versionDate: formatDate({ year, month, day }, calendar)`
  (`formatDate` from `$lib/shared/lorebooks/storyDate`) on every version record (field or made). Omit when
  `year` is null. Entry records get no `versionDate`.
- Test: a kept made-version record and a kept field record on a version both arrive with `versionDate` (the
  default free-form calendar's words for year 1000, month 1, day 1 — assert against `formatDate` called with the
  same date and `null`, not a hand-typed string); a kept entry record has none.

### Fix 3 — a version's record is never dropped silently

`retractImprints` ~660–675 (the "fold guard") drops a `version` record when the session no longer reads the
record's lorebook. Change: keep the guard's rule that Back never writes into that book, but mark the record
**kept** (as line ~766 does: `status: "kept"`, `keptNow.add`, push `{ act: "kept" }`) instead of dropping it.
Order: the missing-row / moved-book check (~676–683) runs first, so a version that is gone or moved is still
dropped; only an existing version in the record's book whose session reads another book is kept. Update the
comment to state the rule (no story). `restoreImprints` already turns a `kept` back to `standing`.

Test: rewrite `"a session that no longer reads the book drops the record and leaves the row"` (~299) to: the
lorebook's text unchanged, the record `kept`, `taken` acts `["kept"]`; and `restoreImprints(taken)` returns it to
`standing`. Add the made-version case: after the session's book changes, Back leaves the version and keeps its
record.

## Files owned

`src/lib/server/lorebooks/imprints.ts`, `src/lib/server/lorebooks/redlines.ts` (only the two helpers and the
header bullet), `src/lib/shared/entries/types.ts` (only `KeptImprint.versionDate`),
`src/lib/server/lorebooks/imprints.version.int.test.ts`.

## Files readable

Anything. Another worker (w2) edits `src/lib/client/lorebooks/sections/*`, `ownBook.ts`, `sockets/amendments.ts`,
`docs/lorebooks.md` at the same time: never touch those.

## Rules (quoted for you)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently. Every
  function here takes its handle; never statically import `$lib/server/db`.
- Comments state the rule, not the story (no "fix 1", no lane names, no dates).
- Never `prettier --write` beyond the lines you changed (check with `npx prettier --check <file>` and fix by hand).
- An int test that opens a DB inside an `it` needs a 60 s timeout (the file sets `vi.setConfig` already).
- No new name beyond `redlinesOfVersion`, `putBackVersionRedlines`, `versionDate`, `redlines` (on `unmade`).
- Never `kill -9` anything. Never pipe vitest into `head`.

## Stop and ask when

A change would alter what a take-back does to text; a migration or a published SDK name seems needed; a re-insert
by id could collide with a row made since.

## Done means

Run, one at a time, each after the vitest check above:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/lorebooks/imprints > plans/time-t5a-fix-w1-imprints.log 2>&1"
```

(covers every `imprints*` test file). All pass. Report: changed files, the test counts from the log, anything you
could not do, Noticed-not-done. Under 300 words.
