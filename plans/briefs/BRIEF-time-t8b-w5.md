# BRIEF — worker `time-t8b-w5` — the entries list's two toggles: *Could exist here* and bulk edit

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b`. You type; you do not decide product questions.
If something below does not fit the code, stop and say so in your report rather than inventing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal

Wire two toggles into the lorebook entries list, `src/lib/client/lorebooks/EntryPool.svelte`, using the parts
already built (below). Edits to `EntryPool.svelte` stay to: two toggle buttons, a checkbox in the row and card
snippets, the two mounts, and the state and deriveds that feed them. Nothing else in the file changes.
`EntryPool.svelte` is mounted only by `EntryWorkspace.svelte`, which you must **not** edit: everything you need
is reachable from inside `EntryPool` (`getBookData()`, `openBookTime`, `loreRoute`, the props it already has).

## Owner rulings (quoted; they decide, you do not)

- 2026-11-13: "a toggle in the entries list to show entries that could theoritically exist in the current branch
  or time. Show the cards muted and full opacity on hover with a control to move them"; "a toggle to show
  checkboxes, toggle multiple entries and perform bulk edits".
- 2026-11-14: *could exist here* is **a group at the end of the list, with the bulk action bar at the bottom**;
  ★10: entries of lines forked from this one and entries that begin later, never sibling lines'. §5.8: both are
  the lorebook owner's alone (hidden for a shared reader and on a read-only book).
- 2026-11-14: with the Timeline off, "begins later" is not a reason (the list then dims nothing, so it falls out)
  and Beginning is not a bulk action (the bar already hides it).
- Brief: the *Could exist here* toggle is off by default and remembered per browser in `localStorage`, read and
  written inside `try/catch`. Bulk edit is off each time. Checkboxes are real checkboxes with the entry's name in
  their label, never on a scene, a cast member or a rules-library piece; on muted rows only for rows of lines
  forked from this one (they take Move down the tree… only). A select-all for what is listed. Focus returns to
  the list after an action. The group's rows are never counted in the list's figures (do not touch `summary`,
  `facets` or any count).

## Parts already built — mount them, never rebuild

- `src/lib/client/lorebooks/CouldExistHereGroup.svelte` — props `later, forked, sourceOf, descriptorOf, bindings,
  vectorizationEnabled, selectedKey, line, bulk, isChecked, onCheck, onSelect`. Read it.
- `src/lib/client/lorebooks/BulkEditBar.svelte` — props `lorebookId, selected: BulkRow[], selectableCount,
  allSelected, onSelectAll, line, openEntryId, onDone(keep: number[])`. Read it.
- `src/lib/client/lorebooks/couldExistHere.ts` — `forkedLineRows({ rawRows, kinds, line, branches })`.
- `src/lib/client/lorebooks/bulkEdit.ts` — `BulkRow`.
- `src/lib/client/lorebooks/poolFilter.ts` — `filterPool(items, filters)`, `comparePoolBy(orderBy)`, `SCENE_KIND`,
  `CAST_KIND`, `buildTree`, `hasNesting`.
- `src/lib/client/lorebooks/sections/index.ts` — `descriptorForKind(kind)` → `toPoolItem(row)`.
- `getBookData()` (`bookData.svelte.ts`): `lorebookId`, `rawRows`, `readOnly`. `openBookTime.branches`.
  `loreRoute.route.branch` (the line being read; `?? null` = main).

## File owned (edit only these)

- `src/lib/client/lorebooks/EntryPool.svelte`
- NEW `src/lib/client/lorebooks/entryPool.couldExistBulk.dom.test.svelte.ts`

## What to build in `EntryPool.svelte`

1. **State.** `couldExist` (`$state(false)`, then read once on mount from `localStorage.getItem(
   "serene.lore.couldExistHere") === "on"` inside `try/catch`; written on toggle — `setItem(…, "on")` /
   `removeItem` — inside `try/catch`). `bulk` (`$state(false)`). `checked = new SvelteSet<string>()` of pool keys;
   cleared when bulk is switched off. `const book = getBookData()`. `line = $derived(loreRoute.route.branch ??
   null)`.
2. **Where the toggles show:** `offered = !readOnly && descriptor.store !== "scenes"`. Two icon buttons (STYLE-GUIDE
   §6.3: never a bare icon; `title` and `aria-label` saying the action; ON = `preset-pressed` with `aria-pressed`,
   OFF = `preset-tonal-surface`), class `btn btn-sm shrink-0` like the Reorder button beside them, in BOTH the
   desk toolbar row (after Reorder) and the compact row (after Reorder): *Could exist here* (`Icons.SquareDashed`,
   `data-toggle-could-exist`) and *Bulk edit* (`Icons.ListChecks`, `data-toggle-bulk`).
3. **The group's lists.**
   - `later = couldExist ? items.filter((i) => dimmedKeys?.has(i.key)) : []` and the list body
     `body = couldExist ? items.filter((i) => !dimmedKeys?.has(i.key)) : items`. Draw the List, Cards and Tree
     lenses from `body` instead of `items` (`treeRows` from `buildTree(body)`); keep every empty-state and
     `treeOffered` condition on `items` as it is, and the reorder draft on `items`.
   - `forkedRows = couldExist && offered ? forkedLineRows({ rawRows: book.rawRows, kinds: descriptor.kind ?
     [descriptor.kind] : null, line, branches: openBookTime.branches }) : []`; `forked` = their pool items
     (`descriptorForKind(row.typeId)?.toPoolItem(row)`, dropping rows with no door), through `filterPool(…,
     filters)` and sorted with `comparePoolBy(orderBy)`; a `Map` key → row for their sources.
   - Mount `<CouldExistHereGroup>` at the end of the scroller's content (after the lens rows, before the History
     divider), only while `couldExist && offered && !loading && !isReordering`, with `sourceOf = (item) =>
     forkedSource.get(item.key) ?? sourceOf(item)`, the props it needs from EntryPool's own, `onSelect`, and the
     checkbox props below.
4. **Checkboxes.** `selectable(item) = !item.fromLibrary && item.kind !== SCENE_KIND && item.kind !== CAST_KIND`.
   While `bulk`, in `listRow` (after the tree toggle, before the pick part) and in `card` (first in the row box),
   a real `<input type="checkbox" class="checkbox …">` with `aria-label="Select {item.name}"`, `data-bulk-check`,
   checked from `checked.has(item.key)`; it is beside the pick part, never inside it (STYLE-GUIDE §9), and its
   clicks and keys must not pick the row. The group gets `isChecked = (i) => checked.has(i.key)` and `onCheck`.
5. **The bar.** While `bulk && offered`, mount `<BulkEditBar>` after the scroller `div` (so it sits at the bottom
   of the list, outside the scroll), with:
   - `selected`: for each key in `checked`, the listed row in `body` (→ `listed: true`) or the forked row (→
     `listed: false`); keys found in neither are ignored (never pruned by an effect). A `BulkRow` is `{ id,
     typeId: item.kind, name: item.name, pinned: item.pinned, off: item.off, archived: item.archived, branchId:
     item.branchId ?? source?.branchId ?? null, listed }`.
   - `selectableCount` = selectable rows in `body`; `allSelected` = that count > 0 and every one checked;
     `onSelectAll(next)` adds or removes every selectable `body` key.
   - `line`; `openEntryId` = the id in `selectedKey` when it is `entry#‹id›`, else null; `lorebookId` =
     `book.lorebookId`.
   - `onDone(keep)`: clear `checked`, re-add `entry#${id}` for each kept id, then move focus to the scroller
     (`bind:this`, `tabindex="-1"` on it, `.focus()` after `tick()`).
6. Comments state the rule, not the story. No toast, no socket listener.

## STYLE-GUIDE and a11y rules that apply (quoted)

- §6.3: "**Never a bare icon button** … An icon button that is ON (a filter in force, the chosen view mode, an open
  panel) is `preset-pressed` with `aria-pressed` … gold, filled or tonal, always means "do this", never "this is
  on"."
- §9: "**Never an interactive inside an interactive.** A row picked by pressing it (`role="button"`) holds its own
  controls … _beside_ the part that picks it … and its key handler acts only on keys pressed on itself"; "Every
  interactive element is a real `button`, `a` or input with an accessible name"; "Targets are 44px on touch"
  (`pointer-coarse:min-h-11` where a control is smaller).
- §10: "Sentence case everywhere."

## Hard rules

- `$state(new Set())` is not reactive on mutation: use `SvelteSet` / `SvelteMap`.
- `localStorage` only inside `try/catch` (it can throw or be absent).
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Views register socket listeners only for local state and never toast.
- Never `prettier --write` on `EntryPool.svelte` (it is shared, and other lines must not move): format your own
  lines by hand and check with `npx prettier --check src/lib/client/lorebooks/EntryPool.svelte` (report if it
  was already failing before your change — compare with `git diff --stat` / `git show HEAD:…` if tracked).
- It is a **session**, never a *chat*.

## Tests (`entryPool.couldExistBulk.dom.test.svelte.ts`)

Mount `EntryPool` alone with `bookDataContext(staticBookData(() => ({ lorebookId, rawRows, readOnly?,
timelineEnabled })))`, real doors (`descriptorForKind(WORLD_LORE_TYPE_ID)` etc.), items from their `toPoolItem`,
and mocks as in `src/lib/client/lorebooks/bulkEditBar.dom.test.svelte.ts` (read it and
`couldExistHereGroup.dom.test.svelte.ts`). `openBookTime.open` / `setBranches` for lines main ← A ← B and a
sibling C; set the reading line with `loreRoute.set(…)` (read `loreRoute.svelte.ts` for the route shape; restore
it in `afterEach`). Stub `localStorage` per test. Cases:
1. Toggles drawn for the owner, neither pressed; with `readOnly: true` neither is drawn; in a scenes scope neither.
2. *Could exist here* on → reading A, the group lists B's entry (not C's, not A's own, not main's), and the
   summary text is unchanged; `localStorage` holds `"on"`; a fresh mount with `"on"` stored starts on; a throwing
   `localStorage` still mounts with the toggle off.
3. With `dimmedKeys` holding one listed key and the toggle on, that row is drawn in the group (with *Begins in*)
   and not in the body; with the toggle off it stays in the body.
4. Bulk on → a checkbox labelled *Select ‹name›* on each entry row, none on a cast row or a library piece; the bar
   is drawn after the scroller; the select-all checks every listed entry; bulk off → no checkboxes, no bar, and
   switching it on again starts with nothing checked.
5. Bulk on, two rows checked, **Pin** → `entries:setMarks` sent for each (through the mocked `awaitReply`); after
   the action focus is on the list scroller.

## Done means

Check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows no vitest first (wait if one runs); never
pipe vitest into `head`. Run, one at a time:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/entryPool.couldExistBulk.dom.test.svelte.ts > plans/time-t8b-w5.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/entryWorkspace.versions.dom.test.svelte.ts src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts src/lib/client/lorebooks/lorebooksWorkspace.timelineOff.dom.test.svelte.ts src/lib/client/lorebooks/refusalsSaidOnce.dom.test.ts > plans/time-t8b-w5-neighbours.log 2>&1"
```

Both green (the second guards that nothing else in the list moved; if one of those fails, check whether it fails
without your change before reporting it). Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .
2>&1 | grep -E "EntryPool|entryPool"` shows nothing.

## Report

Return your report as your final message (the harness may refuse a file write): changed files, tests run with
results, every label and sentence you added, assumptions, **Noticed, not done**.
