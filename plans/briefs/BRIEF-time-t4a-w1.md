# BRIEF — worker `time-t4a-w1` — one version per entry, line and date (server)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t4a`. Report: your final message (under ~500
words): changed files, tests run with results, every sentence added, anything you could not do.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

An entry has at most **one dated change per line and date** (owner-ruled, plan §5.1: "One version per entry,
line and date: a second write that day updates it."). Today nothing enforces it:
`amendments:create` inserts with no check (`src/lib/server/sockets/amendments.ts`, `amendmentsCreateHandler`,
entry branch ~1676–1708, inside `writeDated`), the re-date in `updateAmendment` (~1880–1970) has none, and there
is no unique index. Make two changes, **entries only** (the cast subject is untouched):

1. **Create at a taken date merges.** In the entry branch of `amendmentsCreateHandler`, inside the existing
   `writeDated` transaction (already under `lockBookCalendar`), after `assertAtOrAfterBeginning` and
   `assertOverlayAnchor`: look for the line's own stored change of this entry at exactly this date — same
   `entryId`, same `branchId` (null = main: match with `isNull`), same `year`, same `month` (null-safe), same
   `day` (null-safe), and `base IS NULL` (a held amendment, `base` not null, is a session's and is never
   matched). If there is one (several in old data: take the highest id), **update that row** instead of
   inserting: `fields = { ...stored.fields, ...newFields }` (the new fields win), `updatedAt` now, and when the
   create carries a `historyEntryId` set it, otherwise keep the stored one. Record it in the edit history as an
   edit of that row, exactly as `updateAmendment` does (~1950–1966): `recordRedline(tx, { entryId,
   amendmentId: stored.id, before: stored.fields, after: merged, keys: union of both key sets, cause: "save",
   by: { userId } })` (dynamic import as there). Otherwise insert as today. The reply is unchanged (the book's
   list).
2. **Re-date onto a taken date is refused.** In `updateAmendment`'s entry path, inside the existing transaction
   where `"year" in patch` (after `assertDateLands` and `assertAtOrAfterBeginning`): read the moving row's
   `entryId` and `branchId`; if another row (`id <> params.id`) of the same entry, same `branchId`
   (null-safe), same year/month/day (the merged date in `patch`), `base IS NULL`, exists, throw
   `new Error(sentence)` with the sentence below, formatted with the book's calendar as
   `assertAtOrAfterBeginning` does (`bookCalendarOf(tx, lorebookId)`, `formatDate`).
   Sentence (🚧, exact): `` `This entry already has a version dated ${date} on this line. Pick another date, or change that version instead.` ``

No index, no migration, no reshaping of stored rows (two rows already at one date stay two rows; the merge
writes into the highest id). Do not touch the cast branch, `amendments:place`, `amendments:fork` or anything
else in the file.

## Files owned

- `src/lib/server/sockets/amendments.ts` — only the two places above (and a helper function beside them if it
  keeps both readable, e.g. `ownChangeAt(tx, { entryId, branchId, date, exceptId? })`).
- New test: `src/lib/server/sockets/amendments.oneVersion.int.test.ts`.

## Files readable

`src/lib/server/sockets/amendments.beginning.int.test.ts` (copy its setup: `vi.mock("$lib/server/db")` with
`createTestDb`, a `mkdtemp` data dir named `serene-pub-vitest-amendments-one-version-`, `releaseDataDir` in
`afterAll`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`, handlers called directly with
`socketOf(userId)` and a no-op emit), `amendments.redlines.int.test.ts` (how a redline row is read back),
`src/lib/server/lorebooks/redlines.ts` (`recordRedline`), `src/lib/server/db/schema.ts` (`entryAmendments`,
`loreRedlines`).

## Rules

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently
  (`db/transactionGuard.ts` throws in tests). Every new read and write here is on `tx`.
- Comments state the rule, not the story ("a second write at one date updates the row", never "lane t4a added").
- No `prettier --write` on a directory or on a file you did not otherwise change; `npx prettier --check` your
  test file. (`amendments.ts` already fails `--check` in places: do not reformat it.)
- No new socket event, setting, column or migration. If one seems needed, stop and report.

## Done means

Tests in the new file, at least:
- a second `amendments:create` for one entry, one line, one date → one row; its fields are the merge, the new
  value wins a shared key; an edit-history row exists with that `amendment_id`, `cause` `save`, before/after;
- the same date on another line → two rows; another date on the same line → two rows; a held row (`base` set)
  at that date and line is not merged into;
- re-dating a change onto a date the line already has for that entry → refused with the exact sentence, both
  rows unchanged; onto a free date → moved; onto a date only another line has → moved;
- a create with `historyEntryId` merging into a row keeps or sets it as described.

Run (one at a time, from the repo root; first check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`
shows no running vitest and wait if one is; never pipe vitest into `head`):

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/amendments.oneVersion.int.test.ts src/lib/server/sockets/amendments.int.test.ts src/lib/server/sockets/amendments.beginning.int.test.ts src/lib/server/sockets/amendments.redlines.int.test.ts > plans/time-t4a-w1.log 2>&1"
```

All pass. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → report
the count and any error in your files.
