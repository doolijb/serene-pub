# BRIEF — worker `time-t8b-w4` — the bulk edit action bar

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b`. You type; you do not decide product questions.
If something below does not fit the code, stop and say so in your report rather than inventing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal

One component, `BulkEditBar.svelte`: the toolbar at the bottom of a lorebook's entries list while its bulk edit
toggle is on. It shows the count of selected entries, a select-all, and the actions; it runs each action as the
**existing per-entry requests, one after another**, and then says honestly how many changed and, for each entry
left as it was, its name and the reason (the server's own sentence for a refusal). A later worker mounts it in
`EntryPool.svelte` and owns the selection; you only draw the bar and run the actions. Another worker writes
`CouldExistHereGroup.svelte` at the same time; do not touch it, `EntryPool.svelte` or any other existing file.

## Owner rulings (quoted; they decide, you do not)

- 2026-11-13: "a toggle to show checkboxes, toggle multiple entries and perform bulk edits".
- 2026-11-14: the bulk action bar sits **at the bottom** of the list; the actions are **Beginning…**,
  **Decay…**, **Move down the tree…**, **Pin / Unpin**, **Switch off / on**, **Archive / Unarchive**,
  **Delete…** (marking *not common knowledge* is another lane's; not here). §5.8: bulk edit is the lorebook
  owner's alone (the caller hides the bar for anyone else). §5.9: "A bulk move asks once, naming the count, the
  parents taken along and the lines that will start reading them" (the move dialog already says all three).
- 2026-11-14: with the Timeline off, **no Beginning…**.
- Brief: "**Delete…** and **Move down the tree…** confirm once, naming the count"; Delete says the entries' edit
  history goes too and that an entry goes from every line that reads it. "No action is applied to an entry it
  does not fit". History entries are never moved down the tree (the server refuses them). Keyboard and a11y:
  the bar is a toolbar with a live count; focus returns to the list after an action (the caller does that in
  `onDone`).
- Lead: no new socket event; the existing per-entry requests in a short sequence.

## Pieces that exist — reuse, never rebuild

- `src/lib/client/lorebooks/bulkEdit.ts`: `BulkRow`, `BulkAction`, `BulkNote`, `planBulk(action, rows, { lineName,
  parents })` → `{ send, skip, withParent }`, `toggleActions(rows)`, `BULK_LABELS`, `runBulk(rows, send,
  onProgress)`, `bulkReport({ changed, refused, skipped, notes })`, `bulkDeleteCopy({ count, filedUnder, lines })`,
  `filedUnderCount(sent, selected, parents)`, `bulkMoveProblem(ids, rows, branches, words)`. Read it and its test.
- `src/lib/client/lorebooks/BulkTimeDialog.svelte`: props `open, mode: "beginning" | "decay", count, onApply(patch),
  onClose`; `patch` is `{ year, month, day }` or `{ decayRate }`.
- `src/lib/client/lorebooks/time/MoveDownTheTreeDialog.svelte`: props `open, lorebookId, entryIds?, prefer?:
  { branchId: number | null }, dirty, onClose, onMoved?(target)`.
- `$lib/client/components/modals/DeleteLorebookEntryConfirmModal.svelte`: props `open, title, message,
  onOpenChange, onConfirm, onCancel` (the one delete `alertdialog`).
- `src/lib/client/lorebooks/time/moveDownTheTree.ts`: `treeRowsOf(rawRows)`.
- `src/lib/client/lorebooks/editor/teachMarks.ts`: `markHeldLine(heldBy, null)` — the sentence when an amendment
  still decides a mark; read how `teachMark` correlates `entries:setMarks` by a `request` token (`carries`).
- `getBookData()`: `rawRows`, `timelineEnabled`; `openBookTime`: `branches`, `lineName(id)`; `formatDate`
  (`sections/historyDates.ts`); `loreRoute` (`loreRoute.svelte.ts`): `hasUnsavedChanges()`, `navigate({ type:
  "back" })`.
- `awaitReply` (`$lib/client/utils/awaitReply`), `useTypedSocket`, `interestKey` (`$lib/shared/sockets/interest`).

## The per-entry requests (exact, as the editor and Teach it send them)

- Beginning / Decay / Archive: `awaitReply({ socket, event: "entries:update", params: { entry: { id, typeId,
  ...patch } }, replyKey: interestKey("entries:update", lorebookId), errorEvent: "entries:update:error",
  fallbackError: "The entry could not be changed.", match: (d) => d.entry?.id === id })`, `patch` =
  `{ year, month, day }`, `{ decayRate }`, or `{ archived: true | false }`.
- Pin / Unpin / Switch off / on: `entries:setMarks` with `{ entryId, pinned: boolean }` or `{ entryId, off:
  boolean }` and a `request` token (`bulk-${Math.random().toString(36).slice(2, 10)}-${n}`), `errorEvent:
  "entries:setMarks:error"`, `fallbackError: "The entry's marks could not be saved."`, `match: carries && !error`,
  `matchError: carries`. A reply with `heldBy` changed the entry but an amendment still decides the mark: resolve
  with `markHeldLine(res.heldBy, null)` (kept as a note).
- Delete: `awaitReply({ event: "entries:delete", params: { id, typeId }, replyKey: interestKey("entries:delete",
  lorebookId), errorEvent: "entries:delete:error", fallbackError: "The entry could not be deleted.", match: (d) =>
  d.entryId === id })`.
- Always one at a time (`runBulk` awaits each). Never in parallel.

## File owned (edit only these)

- NEW `src/lib/client/lorebooks/BulkEditBar.svelte`
- NEW `src/lib/client/lorebooks/bulkEditBar.dom.test.svelte.ts`

## The component

```ts
interface Props {
  lorebookId: number
  /** The selected entries, as listed (rows of another line come with `listed: false`). */
  selected: BulkRow[]
  /** How many listed rows carry a checkbox: select-all's figure. */
  selectableCount: number
  /** Every listed row with a checkbox is selected. */
  allSelected: boolean
  onSelectAll: (next: boolean) => void
  /** The line being read; null = main. */
  line: number | null
  /** The entry open in the editor, or null: a move waits for its unsaved changes; deleting it closes it. */
  openEntryId: number | null
  /** After an action: the ids to keep selected (the entries left as they were). */
  onDone: (keep: number[]) => void
}
```

Markup: `<div role="toolbar" aria-label="Bulk edit" data-bulk-bar class="border-surface-200-800 flex flex-wrap
items-center gap-2 border-t pt-2">`, then, in order:

1. Select-all: a real checkbox with a visible label `Select all ${selectableCount}`, checked by `allSelected`,
   `indeterminate` while some but not all are selected, calling `onSelectAll(!allSelected)`. Disabled when
   `selectableCount` is 0.
2. The live count: `<span aria-live="polite" data-bulk-count>` — `${n} selected`; while an action runs,
   `Changing ${done} of ${total}…`.
3. Buttons, `btn btn-sm preset-tonal-surface pointer-coarse:min-h-11`, all disabled while nothing is selected
   or an action runs: **Beginning…** (only while `getBookData().timelineEnabled`), **Decay…**, **Move down the
   tree…**, then `BULK_LABELS[toggleActions(selected).pin]`, `…off]`, `…archive]`, then **Delete…** as
   `btn btn-sm preset-tonal-error pointer-coarse:min-h-11` (STYLE-GUIDE §6.1: removes something saved → error,
   tonal in a row).
4. Arrow keys move focus between the toolbar's enabled controls (Left/Right, Home/End), one tab stop.

Behaviour:

- **Beginning… / Decay…**: `planBulk(action, selected, { lineName })`. Nothing to send → write the report at
  once (no dialog). Else open `BulkTimeDialog` with `count = send.length`; on apply run `runBulk(send, row =>
  update(row, patch))`.
- **Pin / Unpin / Switch off / on / Archive / Unarchive**: no confirmation; `planBulk` with the action
  `toggleActions` names, then `runBulk`.
- **Move down the tree…**: `problem = bulkMoveProblem(ids, treeRowsOf(rawRows), openBookTime.branches, words)`
  over all selected ids (`words` as the move dialog builds them). A problem → the button is disabled, the
  sentence in its `title` and in an `sr-only` element its `aria-describedby` names. Else open the move dialog
  with `entryIds` = the selected ids, `prefer: { branchId: line }` when the selection's line is not `line` (the
  dialog ignores a line it cannot offer), `dirty = openEntryId != null && ids.includes(openEntryId) &&
  loreRoute.hasUnsavedChanges()`. On `onMoved` the report says the selected count changed; `onDone([])`.
- **Delete…**: `planBulk("delete", selected, { lineName, parents })` with `parents` = every loaded entry's
  `anchorEntryId` from `rawRows` (every type, every line). Nothing to send → report. Else open the delete modal
  with `bulkDeleteCopy({ count: send.length + withParent.length, filedUnder: filedUnderCount(send ids, selected
  ids, parents), lines: openBookTime.branches.length > 0 })`; on confirm run `runBulk(send, del)`. Each
  `withParent` row counts as changed when its nearest selected ancestor that was sent was not refused. If the
  open entry was deleted (sent and changed, or went with its parent), `loreRoute.navigate({ type: "back" })`.
- **The report**: after every action, `bulkReport({ changed, refused, skipped: plan.skip, notes })`, drawn under
  the toolbar in `<div role="status" data-bulk-report>`: the headline as a 13px line, then the lines as a list
  (12px muted `text-surface-700-300`). It stays until the next action. Then `onDone(ids of refused + skipped)`.
- No toast (views never toast; the bar says it in place). No socket listener of your own beyond `awaitReply`'s.

## STYLE-GUIDE rules that apply (quoted)

- §6.1: "One primary button per surface" (the bar has none: its actions are tonal); "an action that removes
  something saved … is `error` — `preset-tonal-error` in a row or footer, `preset-filled-error-500` only as the
  confirm of an `alertdialog`".
- §6.6: "A question asked before a verb that replaces or deletes something is an `alertdialog` whose words say
  what goes and what stays … An `alertdialog` is answered, never dismissed by a click outside".
- §9: "Every interactive element is a real `button`, `a` or input with an accessible name"; "Focus is visible";
  "Targets are 44px on touch."
- §10: "Sentence case everywhere"; "A button says what happens"; "Counts live in the copy where they help".
- §6.21 / CLAUDE.md sockets ruling: views register listeners for local state only and never call `toaster`.

## Hard rules

- `SvelteSet` / `SvelteMap` for any reactive set or map.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- `socket.off(event)` with no handler removes every listener app-wide: always pass the handler (you should need
  no `off` at all; `awaitReply` releases its own).
- Comments state the rule, not the story. Never `prettier --write` beyond your own two files.
- It is a **session**, never a *chat*.

## Tests (`bulkEditBar.dom.test.svelte.ts`)

Harness like `src/lib/client/lorebooks/time/moveDownTheTreeDialog.dom.test.svelte.ts`: mock `$app/environment`,
`typedSocket`, and `awaitReply` (record each `{ event, params }`; refuse chosen ids with a sentence; for
`entries:setMarks` return `{ entryId, request: params.request, off, pinned }`); `staticBookData` +
`bookDataContext`; `openBookTime.open` / `setBranches`. Cases:
1. Nothing selected → every action disabled; the count reads `0 selected`.
2. Three selected, one pinned → the button reads **Pin**; pressing it sends `entries:setMarks` twice (not for
   the pinned one), in order; the report reads `2 entries changed.`; `onDone` gets `[]`.
3. All three pinned → **Unpin**.
4. Archive with one refusal (`awaitReply` throws `Error("Entry not found or access denied.")` for one id) → the
   others are still sent; the report reads `2 entries changed.` and lists `‹name›: Entry not found or access
   denied.`; `onDone` gets that id.
5. Timeline off → no **Beginning…**; on → **Beginning…** with a History row selected: the History row is not
   sent and the report lists `‹name›: A History entry takes no beginning: its date is its own.` (drive the
   dialog: choose Began at, year 5, Apply; assert the `entries:update` params carry `year: 5`).
6. **Delete…** opens the alertdialog whose title is `Delete 2 entries?` and whose words include *edit history*;
   Cancel sends nothing; confirm sends `entries:delete` once per sent entry; a child selected under a selected
   parent is not sent.
7. **Move down the tree…** with rows of two lines → disabled, `title` *Move entries from one line at a time.*;
   with rows of one branch → opens the move dialog naming the count.
8. A row with `listed: false` selected with Pin → not sent; the report lists `‹name›: On ‹line›: only Move down the
   tree… reaches it from here.`
9. Select-all checkbox calls `onSelectAll(true)`; `allSelected` → checked.

## Done means

Check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows no vitest first (wait if one runs); never
pipe vitest into `head`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/bulkEditBar.dom.test.svelte.ts > plans/time-t8b-w4.log 2>&1"
```

Green. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "BulkEditBar|bulkEditBar"` shows nothing.

## Report

Return your report as your final message (the harness may refuse a file write): changed files, tests run with
results, every label and sentence you added, assumptions, **Noticed, not done**.
