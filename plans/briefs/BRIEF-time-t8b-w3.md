# BRIEF — worker `time-t8b-w3` — the **Could exist here** group component

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b`. You type; you do not decide product questions.
If something below does not fit the code, stop and say so in your report rather than inventing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal

One component, `CouldExistHereGroup.svelte`, drawn at the end of a lorebook's entries list while its *Could
exist here* toggle is on: a group of muted rows the line and moment being read do not read but could, each
saying why in a few words and carrying the control that would bring it here. A later worker mounts it in
`EntryPool.svelte` and computes its two lists; you only draw them. Another worker writes the bulk action bar at
the same time (`BulkEditBar.svelte`); do not touch it, `EntryPool.svelte` or any other existing file.

## Owner rulings (quoted; they decide, you do not)

- 2026-11-13: "a toggle in the entries list to show entries that could theoritically exist in the current branch
  or time. Show the cards muted and full opacity on hover with a control to move them".
- 2026-11-14: the chosen screen is ***could exist here* as a group at the end of the list**; ★10: entries of
  lines forked from this one (at any depth) and entries that begin later, **never sibling lines'**.
- Brief: each row says why it is not read here in a few words (*On ‹line›*, *Begins in ‹date›*: plan §5.6, "a
  filter always shows its cause"). Muted rows are at full opacity on hover **and on keyboard focus**. A row of
  another line opens **read-only** when selected: nothing about it is editable from this line. A row of a line
  forked from this one carries **Move down the tree…** to this line, enabled only where the move rule allows it,
  else the reason; a row that begins later carries the date it begins and a control that moves the moment bar
  to that date.
- Label (cold review): **Move down the tree…**, never "Move down" (that reorders a list).

## Pieces that exist — reuse, never rebuild

- `src/lib/client/lorebooks/couldExistHere.ts`: `couldExistWhy(reason, words)` (→ *On ‹line›* / *Begins in
  ‹date›*), `moveHereProblem({ id, rows, target, branches, words })` (→ the reason the row can't move to
  `target`, or null), `CouldExistReason`.
- `src/lib/client/lorebooks/time/MoveDownTheTreeDialog.svelte`: props `open, lorebookId, entryIds?, entryId?,
  prefer?: { branchId: number | null }, dirty, onClose, onMoved?`. Open it with `entryIds: [item.id]`,
  `prefer: { branchId: line }`, `dirty: false`. One dialog instance for the group, keyed by the row it is for.
- `src/lib/client/lorebooks/time/moveDownTheTree.ts`: `treeRowsOf(rawRows)` (the rule's rows from the book data).
- `getBookData()` (`bookData.svelte.ts`): `lorebookId`, `rawRows`, `timelineEnabled`. `bookTimeline()`.
- `openBookTime` (`time/bookTime.svelte.ts`): `branches`, `lineName(id)`.
- `formatDate` (`sections/historyDates.ts`) for dates; `MoveDownWords` = `{ lineName, date, timeline }` as the
  move dialog builds it.
- `loreRoute` (`loreRoute.svelte.ts`) and `reduce`, `momentKey` (`$lib/shared/lorebooks/loreRoute`): move the
  moment with `loreRoute.set(reduce(loreRoute.route, { type: "setMoment", moment: momentKey(date) }))` (moving the
  moment never asks about unsaved changes; the workspace does the same in `setMoment`).
- `ListGroupLabel` (`$lib/client/components/panels/ListGroupLabel.svelte`): the group's label.
- Row markup to match: `EntryPool.svelte`'s `listRow` snippet (read it): the row box
  `preset-filled-surface-100-900 hover:bg-surface-200-800 flex items-start gap-2 rounded-lg transition-colors`,
  the pick part `role="button" tabindex="0" data-entry-pick … min-w-0 flex-1 cursor-pointer self-stretch
  rounded-lg py-3 pl-3 focus-visible:outline-2 …` with `<Row {item} {source} {bindings} {vectorizationEnabled} />`
  (`Row = descriptorOf(item).row`), and its controls BESIDE the pick part, never inside it; Enter/Space act only
  when `event.target === event.currentTarget` (`activate`).

## File owned (edit only these)

- NEW `src/lib/client/lorebooks/CouldExistHereGroup.svelte`
- NEW `src/lib/client/lorebooks/couldExistHereGroup.dom.test.svelte.ts`

## The component

```ts
interface Props {
  /** Listed rows that begin after the moment being read (only with the Timeline on), in list order. */
  later: PoolItem[]
  /** Rows of lines forked from the line being read, already filtered and sorted by the caller. */
  forked: PoolItem[]
  /** The wire row behind a row (a later row: the list's resolved row; a forked row: its stored row). */
  sourceOf: (item: PoolItem) => PoolSource | undefined
  descriptorOf: (item: PoolItem) => SectionDescriptor
  bindings: BindingWithRelations[]
  vectorizationEnabled: boolean
  selectedKey: string | null
  /** The line being read; null = main. */
  line: number | null
  /** Bulk edit is on: forked rows carry a checkbox (they take Move down the tree… only). */
  bulk: boolean
  isChecked: (item: PoolItem) => boolean
  onCheck: (item: PoolItem, checked: boolean) => void
  /** A later row opens in the editor, as it does in the list. */
  onSelect: (item: PoolItem) => void
}
```

- Draws nothing when both lists are empty. Otherwise a wrapper `<section aria-labelledby=…
  data-could-exist-here>` with `ListGroupLabel` *Could exist here* and the count of rows as its trailing text,
  then the later rows, then the forked rows.
- Every row: the row box above plus `opacity-50 hover:opacity-100 focus-within:opacity-100` (muted; full on hover
  and keyboard focus; nothing hover-only), `data-could-exist-row`, `data-entry-key={item.key}`. Under the `Row`,
  inside the pick part, one 12px muted line `text-surface-700-300 text-xs` with `couldExistWhy(...)`
  (`data-could-exist-why`).
- **A later row** (reason `{ kind: "later", date }`, the date from its source's `year`/`month`/`day`): the pick
  part calls `onSelect(item)` (`aria-current` when `selectedKey === item.key`). Beside it a tonal button
  `btn btn-sm preset-tonal-surface pointer-coarse:min-h-11` reading `Read from ${formatDate(date)}`
  (`data-could-exist-read-from`), which moves the moment bar to that date.
- **A forked row** (reason `{ kind: "line", branchId: source.branchId }`): the pick part toggles an in-place,
  read-only view of the entry (`aria-expanded`, `aria-controls` → a region holding its content as text,
  `whitespace-pre-wrap text-sm`, `data-could-exist-readout`; nothing editable). Beside it **Move down the tree…**
  (`btn btn-sm preset-tonal-surface pointer-coarse:min-h-11`, `data-could-exist-move`), disabled when
  `moveHereProblem({ id: item.id, rows: treeRowsOf(book.rawRows), target: line, branches: openBookTime.branches,
  words })` is a sentence; then that sentence sits under the row as a 12px muted `<p id=…>` the button names in
  `aria-describedby`. Enabled, it opens the move dialog for this row (see above). With `bulk`, a real checkbox
  `<input type="checkbox">` with `aria-label="Select ${item.name}"` sits first in the row box (beside the pick
  part), checked from `isChecked`, calling `onCheck`.
- No toast, no socket listener of your own (the dialog sends its own request). Unique ids per instance
  (`Math.random().toString(36).slice(2, 8)`, never `crypto.randomUUID`).

## STYLE-GUIDE rules that apply (quoted)

- §6.4: "A **group label** is `ListGroupLabel` … an `h3` at 12px muted, `px-3 pt-4 pb-1`, sentence case, with
  optional trailing muted text (a count when passed …). Never a rule or a hairline above or below it."
- §9: "**Never an interactive inside an interactive.** A row picked by pressing it (`role="button"`) holds its own
  controls … _beside_ the part that picks it, inside the row's box but not inside the button, and its key handler
  acts only on keys pressed on itself"; "Selection is announced: `aria-current` on the selected row …
  `aria-expanded` on anything that opens"; "Nothing is hover-only"; "Targets are 44px on touch."
- §2.6/§6.4: muted text is `surface-700-300` / `surface-600-400`, never quiet `surface-500` for a fact.
- §10: "Sentence case everywhere"; "A button says what happens".

## Hard rules

- `SvelteSet` / `SvelteMap` for any reactive set or map (the expanded rows: a `SvelteSet<string>` of keys, or one
  `$state` key).
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Views never toast; they register socket listeners only for local state, and always `socket.off(event, handler)`
  with the handler (you need none).
- Comments state the rule, not the story. Never `prettier --write` beyond your own two files.
- It is a **session**, never a *chat*.

## Tests (`couldExistHereGroup.dom.test.svelte.ts`)

Model the harness on `src/lib/client/lorebooks/time/moveDownTheTreeDialog.dom.test.svelte.ts` (mock
`$app/environment`, `typedSocket`, `awaitReply`; `staticBookData` + `bookDataContext`; `openBookTime.open` /
`setBranches`). For `descriptorOf`, use the real door: `descriptorForKind(WORLD_LORE_TYPE_ID)` from
`./sections` (index), and build items with its `toPoolItem(row)`; if mounting the real row component is
impossible in happy-dom, say so and use a minimal stub descriptor with a tiny row component instead. Lines:
main ← A (Y3) ← B (Y5); reading A. Cases:
1. Both lists empty → nothing drawn.
2. A forked row on B: the label *Could exist here* with count 1, the words *On B*, the row muted (class
   `opacity-50`), **Move down the tree…** enabled; pressing it opens the dialog with A checked (`prefer`).
3. A forked row on B that began at Year 6 → the button disabled, the cut sentence under it and named by
   `aria-describedby`.
4. Pressing a forked row's pick part shows its content read-only (`aria-expanded="true"`, no input inside the
   readout); pressing again hides it; `onSelect` is not called.
5. A later row: the words *Begins in ‹date›*, pressing its pick part calls `onSelect`; **Read from ‹date›** sets
   `loreRoute.route.moment` to the date's key.
6. `bulk: true` → a checkbox on the forked row only, labelled *Select ‹name›*, calling `onCheck`.

## Done means

Check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows no vitest first (wait if one runs); never
pipe vitest into `head`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/couldExistHereGroup.dom.test.svelte.ts > plans/time-t8b-w3.log 2>&1"
```

Green. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "CouldExistHereGroup|couldExistHereGroup"` shows nothing.

## Report

Return your report as your final message (the harness may refuse a file write): changed files, tests run with
results, every label and sentence you added, assumptions, **Noticed, not done**.
