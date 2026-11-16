# BRIEF — worker `time-t8b-w1` — pure helpers for *could exist here* and bulk edit; the move dialog takes several entries

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b`. You type; you do not decide product questions.
If something below does not fit the code, stop and say so in your report rather than inventing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal

Two pure helper modules (with unit tests) that a later worker mounts in the lorebook entries list, and two
additive props on the existing **Move down the tree** dialog so it can move several entries and open with a
chosen line. No component other than the dialog, no socket, no server file.

## Owner rulings (quoted; they decide, you do not)

- 2026-11-13: "a toggle in the entries list to show entries that could theoritically exist in the current branch
  or time. Show the cards muted and full opacity on hover with a control to move them"; "a toggle to show
  checkboxes, toggle multiple entries and perform bulk edits".
- 2026-11-14: bulk actions are **Beginning, Decay, move down, Pinned / Off / Archive, Delete**; "A bulk move asks
  once, naming the count, the parents taken along and the lines that will start reading them."
- 2026-11-14 (★10): *could exist here* lists entries of lines forked from the line being read (at any depth) and
  entries that begin later — **never sibling lines' entries**.
- 2026-11-14: with the Timeline off, Beginning is not a bulk action and "begins later" is not a reason.
- Cold review: History entries never move down the tree (a line keeps one for each date); bulk **Delete…** says
  the entries' edit history goes too and that an entry goes from every line that reads it.

## Read first (do not edit)

- `src/lib/shared/lorebooks/moveDownTheTree.ts` — the move rule: `TreeRow`, `linesBelow`, `takenAlong`,
  `moveDownProblems`, `moveDownSentence`, `MoveDownWords`. Reuse; never re-derive. If it is wrong, say so.
- `src/lib/client/lorebooks/time/moveDownTheTree.ts` — `treeRowsOf(rawRows)`, `joinNames`.
- `src/lib/shared/lorebooks/lineReading.ts` — `lineOf`, `LineBranch`.
- `src/lib/client/lorebooks/time/MoveDownTheTreeDialog.svelte` and its test `moveDownTheTreeDialog.dom.test.svelte.ts`.
- `src/lib/shared/entries/types.ts` — `HISTORY_TYPE_ID`.

## Files owned (edit only these)

1. NEW `src/lib/client/lorebooks/couldExistHere.ts` + NEW `couldExistHere.test.ts` beside it.
2. NEW `src/lib/client/lorebooks/bulkEdit.ts` + NEW `bulkEdit.test.ts` beside it.
3. `src/lib/client/lorebooks/time/MoveDownTheTreeDialog.svelte` (additive) + its existing
   `moveDownTheTreeDialog.dom.test.svelte.ts` (add cases; every existing case must still pass unchanged).

## 1. `couldExistHere.ts` (pure; no Svelte, no `sections/index` import — it pulls components)

```ts
/** The lines forked from `branchId` at any depth: never itself, never a sibling; main → every line. In `branches` order. */
export function linesForkedFrom(branchId: number | null, branches: readonly LineBranch[]): number[]
//  a line L is included when lineOf(L, branches).steps.slice(1) contains branchId.

/** The stored rows on lines forked from the line being read, of `kinds` (null = every kind held), never History. */
export function forkedLineRows<R extends { typeId: string; branchId?: number | null }>(input: {
  rawRows: Readonly<Record<string, readonly R[]>>
  kinds: readonly string[] | null
  line: number | null
  branches: readonly LineBranch[]
}): R[]
//  iterate rawRows by kind (skip HISTORY_TYPE_ID always; skip kinds not in `kinds` when given), keep rows whose
//  branchId is in linesForkedFrom(line). Order: by kind as rawRows lists them, then as stored.

export type CouldExistReason =
  | { kind: "line"; branchId: number }   // on a line forked from this one
  | { kind: "later"; date: StoryDate }   // begins after the moment being read

/** The few words that say why a row is not read here. */
export function couldExistWhy(reason: CouldExistReason, words: { lineName: (id: number | null) => string; date: (d: StoryDate) => string }): string
//  "line" → `On ${lineName}`   "later" → `Begins in ${date}`

/**
 * Why the entry cannot be moved down the tree to `target` (the line being read), or null when it can:
 * the dialog's own rule — the entries `takenAlong` it on its line move with it.
 */
export function moveHereProblem(input: { id: number; rows: readonly TreeRow[]; target: number | null;
  branches: readonly LineBranch[]; words: MoveDownWords }): string | null
//  row = rows.find(id); none → null. source = row.branchId (null → moveDownSentence of onMain via moveDownProblems).
//  ids = [id, ...takenAlong([id], rows, source).map(a => a.row.id)];
//  p = moveDownProblems({ ids, rows, target, branches })[0]; return p ? moveDownSentence(p, words) : null
```

Tests (`couldExistHere.test.ts`, plain vitest): lines main ← A(Y3) ← B(Y5), and a sibling C forked from main.
`linesForkedFrom(null)` = all; `(A)` = [B]; `(B)` = []; C never under A. `forkedLineRows` on A: B's rows only
(not A's own, not main's, not C's), History left out, `kinds` honoured, `null` kinds = every kind.
`couldExistWhy` both words. `moveHereProblem`: a perpetual entry on B → null for target A and main; an entry on B
that began at Year 6 → the cut sentence for target A (B left A at Year 5); an entry on B filed under a parent on B
→ null (the parent moves with it); a History entry → the History sentence.

## 2. `bulkEdit.ts` (pure)

```ts
/** A selected entry, as bulk edit reads it. `listed` false = a *could exist here* row (another line's). */
export interface BulkRow { id: number; typeId: string; name: string; pinned: boolean; off: boolean;
  archived: boolean; branchId: number | null; listed: boolean }

export type BulkAction = "beginning" | "decay" | "pin" | "unpin" | "off" | "on" | "archive" | "unarchive" | "delete"

/** An entry left as it was, and the sentence that says why. */
export interface BulkNote { id: number; name: string; reason: string }

export interface BulkPlan { send: BulkRow[]; skip: BulkNote[]; withParent: BulkRow[] }

/**
 * Which selected entries an action is sent for. A *could exist here* row takes only Move down the tree…; a
 * History entry takes no Beginning; an entry already as asked is left out silently; for Delete, an entry filed
 * (at any depth, through `parents`) under another selected entry is not sent: it goes with that one (`withParent`).
 */
export function planBulk(action: BulkAction, rows: readonly BulkRow[], opts: {
  lineName: (id: number | null) => string
  /** Every loaded entry's parent (`anchorEntryId`), for the delete cascade. */
  parents?: ReadonlyMap<number, number | null>
}): BulkPlan
//  skip reasons, exact (no name inside; the report puts the name first):
//   not listed → `On ${lineName(branchId)}: only Move down the tree… reaches it from here.`
//   beginning + History → "A History entry takes no beginning: its date is its own."
//  "already as asked" (never sent, never noted): pin & pinned; unpin & !pinned; off & off; on & !off;
//   archive & archived; unarchive & !archived.

/** The three two-way buttons as the selection decides them (listed rows only; none selected → the first word). */
export function toggleActions(rows: readonly BulkRow[]): { pin: "pin" | "unpin"; off: "off" | "on"; archive: "archive" | "unarchive" }
//  pin while any listed row is unpinned, else unpin; off while any listed row is on, else on; archive while any listed row is not archived, else unarchive.

export const BULK_LABELS: Record<Exclude<BulkAction, "beginning" | "decay" | "delete">, string>
//  pin "Pin" · unpin "Unpin" · off "Switch off" · on "Switch on" · archive "Archive" · unarchive "Unarchive"

/**
 * One request per entry, one after another. `send` resolves null when the entry changed, or a sentence when it
 * changed but something still decides otherwise (kept as a note); a rejection is the server's refusal, kept with
 * its message, and the rest go on. `onProgress(done)` after each.
 */
export async function runBulk(rows: readonly BulkRow[], send: (row: BulkRow) => Promise<string | null>,
  onProgress?: (done: number) => void): Promise<{ changed: number; refused: BulkNote[]; notes: BulkNote[] }>
//  refusal message: err instanceof Error && err.message ? err.message : "The entry could not be changed."

/** What the bar says after an action: how many changed, then one line per entry left as it was. */
export function bulkReport(o: { changed: number; refused: readonly BulkNote[]; skipped: readonly BulkNote[];
  notes: readonly BulkNote[] }): { headline: string; lines: string[] }
//  headline: 0 → "No entry changed." · 1 → "1 entry changed." · n → `${n} entries changed.`
//  lines, in this order skipped, refused, notes: `${name}: ${reason}`

/** The one confirmation of a bulk delete. */
export function bulkDeleteCopy(o: { count: number; filedUnder: number; lines: boolean }): { title: string; message: string }
//  title: count 1 → "Delete 1 entry?" · else `Delete ${count} entries?`
//  message = sentences joined by " ":
//   filedUnder > 0 → `${filedUnder} ${filedUnder === 1 ? "entry" : "entries"} filed under them go too.`
//   always → "Their relationships, amendments and edit history are deleted with them. This cannot be undone."
//   lines (the book has more than one line) → "Each goes from every line that reads it, not only this one."

/** How many loaded entries are filed (at any depth) under the sent ones and are not themselves selected. */
export function filedUnderCount(sent: readonly number[], selected: ReadonlySet<number>,
  parents: ReadonlyMap<number, number | null>): number
//  guard against cycles (a seen set).

/**
 * Why the selection cannot move down the tree together, or null: one line, not main, no History. The lines it
 * may move to, and their reasons, are the dialog's. Uses `moveDownProblems` with the first line below the
 * source as a stand-in target and keeps only the kinds "onMain", "mixedLines", "history"; words via `moveDownSentence`.
 */
export function bulkMoveProblem(ids: readonly number[], rows: readonly TreeRow[], branches: readonly LineBranch[],
  words: MoveDownWords): string | null
//  ids empty → null.
```

Tests (`bulkEdit.test.ts`): `planBulk` for each action (History skipped for beginning with the exact sentence, kept
for decay; unlisted rows skipped for every action with the exact sentence; already-as-asked left out of `send`
and out of `skip`); delete with a child selected under a selected parent (child → `withParent`, not sent) and a
grandchild through an unselected middle row; `toggleActions` both ways and ignoring unlisted rows;
`runBulk` (sequential: the second send starts only after the first settles — assert with a log; a refusal in the
middle is kept with its message and the rest are still sent; a note); `bulkReport` the three headlines and the
line order; `bulkDeleteCopy` with and without filed-under and lines, singular/plural; `filedUnderCount` with a
cycle; `bulkMoveProblem`: two lines → "Move entries from one line at a time."; a main row → the onMain
sentence; a History row → the History sentence; rows of one line → null.

## 3. `MoveDownTheTreeDialog.svelte` — two additive props

- `entryId?: number` (now optional) and NEW `entryIds?: readonly number[]`: the asked entries are `entryIds ??
  (entryId != null ? [entryId] : [])`. The existing single-entry mount in `EntryWorkspace.svelte` passes `entryId`
  and must keep working unchanged (do not edit `EntryWorkspace.svelte`).
- `source` = the first asked row's `branchId`; `along = takenAlong(asked, rows, source)`; `ids = [...asked,
  ...along ids]` (no duplicates). Everything else (options, sentences, confirm label) already reads `ids`.
- NEW `prefer?: { branchId: number | null }`: on open, the chosen line is `prefer.branchId` when that option is
  offered and has no reason; otherwise the first allowed line, as today.
- Title: one asked entry → today's `Move ‹name› down the tree`; several → `Move ${asked.length} entries down the
  tree`. Description: one → today's; several → `Pick a line ‹source› was forked from. The entries move there for
  good.`
- The reply `match`: `d.lorebookId === lorebookId && d.entryIds.includes(asked[0])`.
- Comments state the rule, not the story. Keep its `alertdialog`, `Portal`, focus and button classes as they are.

Add dialog test cases: two asked entries on B → the title names 2, the confirm reads `Move 2 entries to ‹line›`,
the emitted `entryIds` hold both (plus any taken along); `prefer: { branchId: null }` with main reachable → main
is checked on open; `prefer` naming a line with a reason → the first allowed line is checked instead.

## Hard rules

- `$state(new Set())` / `new Map()` are not reactive on mutation: use `SvelteSet` / `SvelteMap` (from
  `svelte/reactivity`) for any reactive set or map.
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines you changed (check with
  `npx prettier --check <file>` on your new files only).
- It is a **session**, never a *chat*.

## Done means

Run, one at a time from the repo root, after checking `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`
shows no vitest (wait if one runs; another session shares the checkout), never piping vitest into `head`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/couldExistHere.test.ts src/lib/client/lorebooks/bulkEdit.test.ts > plans/time-t8b-w1-unit.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/time/moveDownTheTreeDialog.dom.test.svelte.ts src/lib/client/lorebooks/time/moveDownTheTree.test.ts > plans/time-t8b-w1-dialog.log 2>&1"
```

All green. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "couldExistHere|bulkEdit|MoveDownTheTree"`
shows nothing.

## Report

Return your report as your final message (the harness may refuse a file write): changed files, tests run with
results (counts), every exported name and every sentence you added, assumptions, **Noticed, not done**.
