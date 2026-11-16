# BRIEF — worker `time-t8b-fix-w3` — the bulk bar claims its own replies, and its delete and move reports tell the truth

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b-fix`. Return your report as your final message
(the harness refuses report files): changed files, tests run with results, anything you could not do, Noticed-not-done.
Under 400 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**Never run `sdk:build` at all in this lane** (another lane owns it). Use no GPU, no local model, start no dev instance.

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)

- Sockets: "views register listeners for local state and never call `toaster`." The bar says its outcome in place
  (its `role="status"` report); never toast.
- "`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."
- "An event in `SCOPED_EVENTS` must carry its scope key … in the payload." Do not drop fields from what you send.
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
  Build request ids with the helper the duplicate flow uses: `import { v4 as uuid } from "uuid"`.
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- Comments state the rule, not the story. Never `prettier --write` beyond the lines changed.
- New copy is exactly as written here; invent no other sentence or label.

## Already done by worker w1 (rely on it, do not change it)

`entries:update` and `entries:delete` now echo an optional `requestId` from the params on both the reply and the
refusal (`src/lib/server/sockets/entries.ts`, the `lorebooks:duplicate` pattern); `Sockets.Entries.Update/Delete`
`Params`/`Response` have `requestId?: string`; `typedSocket.ts` now lists `"entries:delete:error"` (response
`{ error?: string; requestId?: string }`) and `entries:update:error` has `requestId?`. Layout no longer toasts those
two refusals when they carry a `requestId`. The entry form's save sends its own `requestId` and matches on it.

## Files owned (edit only these)

`src/lib/client/lorebooks/BulkEditBar.svelte`, `src/lib/client/lorebooks/bulkEdit.ts`, and their tests
`bulkEditBar.dom.test.svelte.ts`, `bulkEdit.test.ts`. Readable: anything. Never edit
`time/MoveDownTheTreeDialog.svelte` (another lane's file), `EntryPool.svelte`, `EntryWorkspace.svelte`, sockets, docs.

## Work

### 1. A refusal reaches only the request that caused it

In `BulkEditBar.svelte`:
- `update` (~104–115): `const requestId = uuid()`; send `requestId` beside `entry` in the params;
  `match: (d) => d?.requestId === requestId`; `matchError: (d) => d?.requestId === requestId`.
- `del` (~133–143): the same; `errorEvent: "entries:delete:error"` without the `as never` cast and without the comment
  above it (the typed map lists it now). Drop the params' `as never` casts too where the types now allow it.
- Leave `mark` (`entries:setMarks`, its own `request` token) as it is.

### 2. A bulk delete tells the truth

- **A child whose parent's delete was refused.** In `confirmDelete` (~237–271) each `plan.withParent` row (an entry
  filed, at any depth, under another selected entry, so not sent) is today counted as deleted when its nearest sent
  ancestor was not refused, and silently dropped otherwise. Rule: a `withParent` row went **iff its nearest sent
  ancestor was sent and not refused**. Otherwise it is listed as not deleted with the reason
  *Not deleted: ‹parent› was not.* where ‹parent› is the name of its **nearest selected ancestor** (a row in
  `plan.send` or `plan.withParent`), and it **stays selected** (pass these notes with the refused ones to `say`, so
  `onDone` keeps them). Move the rule into a pure, tested function in `bulkEdit.ts` (one function; name it plainly,
  e.g. `withParentOutcome`, returning the rows that went and the notes for those that did not). `openGone` keeps
  working from the rows that went.
- **Entries the page has not loaded.** `filedUnderCount` counts only loaded rows. The count is complete only when
  every entry type whose entries can be filed under another is loaded: `[...FILEABLE_ENTRY_TYPE_IDS,
  ...data.rulesLists.map((l) => l.typeId)].filter(isFileableEntryType).every((t) => data.loaded(t))`
  (`FILEABLE_ENTRY_TYPE_IDS`, `isFileableEntryType` from `$lib/shared/entries/types`; `data` is `getBookData()`).
  When it is not complete, the confirmation says exactly *Entries filed under them go too.* with no number; when it
  is complete, as today (*‹n› entries filed under them go too.*, nothing when 0). Change `bulkDeleteCopy` to take
  `filedUnder: number | null` (null = not known) and say so in its doc comment.
- **After a bulk move, count the entries taken along too.** `moved()` (~284–287) reports `selected.length`; the
  dialog moves the selection plus the entries taken along with it on its line. When the dialog opens, take the count
  the same way the dialog computes its ids (`time/MoveDownTheTreeDialog.svelte` ~60–69: `takenAlong(asked, rows,
  source)` from `$lib/shared/lorebooks/moveDownTheTree` over `treeRowsOf(data.rawRows)`, `source` = the first
  selected row's `branchId`, none when null; unique ids) and keep it with the open state (`moveAsk` becomes
  `{ count } | null`); `moved()` reports that count. Put the count in a small pure function in `bulkEdit.ts`
  (e.g. `bulkMoveCount(ids, rows)`), tested. (Count at open, not after: the rows change once the move lands.)

## Tests (each run one at a time)

Before every run: `ps -eo pid,args | grep -E "node.*vitest|sdk:build|tsup|tsc -b" | grep -v grep`; if anything is
listed, wait (`timeout 900 bash -c 'while ps -eo pid,args | grep -E "node.*vitest|sdk:build|tsup|tsc -b" | grep -v grep >/dev/null; do sleep 20; done'`).
Run as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t8b-fix-<name>.log 2>&1"`
from the repo root, then read the log's tail. Never pipe vitest into `head`.

- `bulkEdit.test.ts`: the new pure functions (a child of a refused parent is kept with *Not deleted: ‹parent› was
  not.* naming its nearest selected ancestor, through a chain of two; a child of a deleted parent went), and
  `bulkDeleteCopy` with `filedUnder: null`, 0 and 2; `bulkMoveCount` with and without entries taken along.
- `bulkEditBar.dom.test.svelte.ts` (it mocks `awaitReply`; keep that for the existing cases): each `entries:update`
  and `entries:delete` request carries a distinct `requestId`, and its `match` / `matchError` accept only that id
  (call the captured functions with the right and a foreign id). Also: the delete report lists the child of a refused
  parent as *‹child›: Not deleted: ‹parent› was not.* and keeps it selected (`onDone` gets its id); the confirmation
  says *Entries filed under them go too.* without a number when a fileable entry type is not loaded
  (`staticBookData` without that type's list), and the count when all are; after a move the report counts the entries
  taken along (if driving the move dialog is impractical in the harness, cover it with the pure test and say so).
- Then `bulkEdit.test.ts`, `bulkEditBar.dom.test.svelte.ts`, `entryPool.couldExistBulk.dom.test.svelte.ts` together
  (log `plans/time-t8b-fix-w3-all.log`).

Done means those pass and `npx prettier --check` is clean on each file you changed (if a file was already unclean
before you, say so rather than reformat it).
