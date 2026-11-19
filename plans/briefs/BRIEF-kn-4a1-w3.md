# BRIEF — worker `kn-4a1-w3` — bulk **Mark not common knowledge** / **Mark common knowledge**, and the list badge (client)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `kn-4a1`. Report: your final message. No server file
and no SDK file is touched.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore`; never `prettier --write` (nor a scratch-copy equivalent).
`NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` and `npm run check`; name, never fix,
errors in files you do not own. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.

## What already exists (read first)

- The store `src/lib/client/lorebooks/knowledge/bookKnowledge.svelte.ts`: `getBookKnowledge()` (undefined when not
  provided), `knowledge.loaded` (the book's marks have been read), `knowledge.isMarked(id)` (reactive),
  `knowledge.setMark(entryIds, notCommonKnowledge)` — **one** `entryKnowledge:setCommonKnowledge` request for all
  the ids, one transaction on the server (all marked or none), resolving with the reply
  (`markedEntryIds` = the book's whole marked list after) or rejecting with the server's sentence. The store is
  created and provided by `EntryWorkspace.svelte` (which mounts `EntryPool`, which mounts `BulkEditBar`) and is
  opened only for the lorebook's owner. How the inspector test supplies it: `src/lib/client/lorebooks/knowledge/knownByTab.dom.test.svelte.ts`.
- `src/lib/client/lorebooks/bulkEdit.ts` (`BulkRow`, `BulkAction`, `planBulk`, `toggleActions`, `BULK_LABELS`,
  `runBulk`, `bulkReport`) and `src/lib/client/lorebooks/BulkEditBar.svelte` (the bar; its Pin/Off/Archive two-way
  buttons via `toggleActions`; Delete's confirm through a dialog; the report under the bar in `role="status"`).
- `src/lib/client/lorebooks/sections/EntryMarks.svelte`: the state marks every entry row carries (off, archived …).
- The Skeleton Dialog pattern of `src/lib/client/components/modals/DeleteLorebookEntryConfirmModal.svelte` (read the
  Skeleton Dialog section first: `grep -n "^# Dialog" AI-TEMP/skeleton-llms-svelte.txt`, then that section only).

## Files owned (edit only these)

`src/lib/client/lorebooks/bulkEdit.ts`, `src/lib/client/lorebooks/BulkEditBar.svelte`,
`src/lib/client/lorebooks/sections/EntryMarks.svelte`, new `src/lib/client/lorebooks/knowledge/KnowledgeMarkConfirm.svelte`,
and tests: `src/lib/client/lorebooks/bulkEdit.test.ts`, `src/lib/client/lorebooks/bulkEditBar.dom.test.svelte.ts`,
new `src/lib/client/lorebooks/knowledge/knowledgeMarkConfirm.dom.test.svelte.ts` (or fold its cases into the bar test),
and the existing test of `EntryMarks` if one exists (`grep -rl EntryMarks src/lib/client --include=*.test.*`).
Not yours: `EntryPool.svelte` (which builds `BulkRow`s), `EntryWorkspace.svelte`, the store, `Layout.svelte`.

## Rules your work depends on (quoted)

- Owner, plan rule 6 (2026-11-14): "Bulk-marking entries not common knowledge warns with the count."
- Owner, plan rule 8: "Lorebook-wide and permanent actions (… bulk edit, not-common-knowledge marks) are the lorebook owner's alone." (The bar is already mounted for the owner only; the store exists only for the owner.)
- Lane brief D: "two actions, **Mark not common knowledge** and **Mark common knowledge**, owner only, one request for the whole selection; before marking, the confirm step warns with the count (… use the bar's existing confirm pattern, as bulk delete does); what it did is said under the bar (`role="status"`), never in a toast."
- STYLE-GUIDE 1063–1066: "What an action did is said under the bar (`role="status"`), never in a toast"; "a disabled control's reason is a 12px muted line it names in `aria-describedby`".
- CLAUDE.md Sockets: views "never call `toaster`". Nothing here calls `toaster` / `notify`.
- STYLE-GUIDE §10: sentence case; "A button says what happens"; "Help is one sentence."; §9: real buttons with names, 44px on coarse pointers (`pointer-coarse:min-h-11`, as the bar's `btn` constant already has); dialogs are portaled.

## Build

### 1. `bulkEdit.ts`

- `BulkRow` gains optional `notCommon?: boolean` (EntryPool does not set it; the bar fills it from the store).
- `BulkAction` gains `"notCommon" | "common"`. `alreadyAsked`: `notCommon` and the row already marked, `common` and
  the row not marked → left out silently (as Pin does). A *could exist here* row (`listed: false`) is skipped with
  the existing sentence (planBulk's first branch already does it). A History entry takes the mark (the filter
  judges History entries too).
- `toggleActions` returns also `knowledge: "notCommon" | "common"`: `"common"` when every listed selected row is
  marked (and at least one is selected), else `"notCommon"`.
- `BULK_LABELS`: `notCommon: "Mark not common knowledge…"` (it opens a confirm, like *Delete…*), `common: "Mark common knowledge"`.
- 🚧 `bulkNotCommonCopy(count: number): { title: string; message: string }` — exact words:
  - title: `Mark 1 entry not common knowledge?` / `Mark ‹n› entries not common knowledge?`
  - message (1): `Only the cast members tied to it will read it when they speak; every other cast member stops reading it.`
  - message (n): `Only the cast members tied to them will read them when they speak; every other cast member stops reading them.`

### 2. `knowledge/KnowledgeMarkConfirm.svelte`

The Delete confirm's shape (Skeleton `Dialog` + `Portal`, backdrop, `h2` title, the message, footer **Cancel**
`preset-tonal-surface` and the confirm button), props `{ open; title; message; onConfirm; onCancel; onOpenChange }`;
the confirm button says **Mark not common knowledge** and is `preset-filled-primary-500` (the one filled control).

### 3. `BulkEditBar.svelte`

- `const knowledge = getBookKnowledge()`. The rows the bar plans with are `selected` with
  `notCommon: knowledge?.isMarked(r.id) ?? false` added (a `$derived`), used for the knowledge action only (leave the
  other actions' planning as it is).
- One more two-way button after Archive/Unarchive, drawn only when `knowledge?.loaded` (no knowledge store, or marks
  not read yet → not drawn): label `BULK_LABELS[toggles.knowledge]`, disabled with the others' rule (`none || busy`).
- **Mark not common knowledge…**: `planBulk("notCommon", rows, { lineName })`; nothing to send → `say(0, plan.skip, [], [])`
  as `askTime` does; else open `KnowledgeMarkConfirm` with `bulkNotCommonCopy(plan.send.length)`. On confirm: send
  `knowledge.setMark(plan.send.map((r) => r.id), true)` — ONE call, not `runBulk` per entry — with `busy` set and the
  count line saying the existing `Changing ‹done› of ‹total›…` (0 of n until the reply, then done). Success →
  `say(plan.send.length, plan.skip, [], [])`. Refusal → every sent row is refused with the server's sentence
  (`say(0, plan.skip, plan.send.map((r) => ({ id: r.id, name: r.name, reason: message })), [])`): nothing changed,
  because the server's write is all or nothing.
- **Mark common knowledge**: no confirm; same single call with `false`, same reporting.
- Never a toast. The report under the bar is the existing `role="status"` block.

### 4. `sections/EntryMarks.svelte` — the list badge

`const knowledge = getBookKnowledge()`; when `entry.id` is a number and `knowledge?.isMarked(entry.id)`, one more mark
in the same shape as *archived* (`preset-tonal-surface rounded {pad} text-xs`, `title="Not common knowledge"`), the
icon `Icons.EyeOff` (the toggle's icon) and the word `not common`. Nothing for a reader who is not the owner (the
store is never opened for them, so `isMarked` is false). A short comment states the rule.

## Tests (Done means)

- `bulkEdit.test.ts`: planBulk for `notCommon` / `common` (already-marked left out silently, unmarked left out for
  `common`, a *could exist here* row skipped with its sentence, a History entry sent); `toggleActions().knowledge`;
  `bulkNotCommonCopy` both forms.
- `bulkEditBar.dom.test.svelte.ts` (extend; supply a store as `knownByTab.dom.test.svelte.ts` does, or a small fake
  object with `loaded`, `isMarked`, `setMark` through the same mock of `getBookKnowledge`): with three selected
  unmarked entries, pressing **Mark not common knowledge…** opens the dialog whose title says `Mark 3 entries not
  common knowledge?` and sends nothing yet; Cancel sends nothing; confirming makes exactly ONE `setMark([a,b,c], true)`
  call and the status under the bar says `3 entries changed.`; with every selected entry marked the button reads
  **Mark common knowledge** and sends one `setMark(ids, false)` with no dialog; a refusal lists each entry with the
  sentence under the bar; without a store the button is absent. Existing bar tests stay green.
- `EntryMarks`: the badge shows for a marked entry and not for an unmarked one (a small DOM test if none exists).
- **axe** on the dialog open (`import axe from "axe-core"`; `axe.run(target, { rules: { "color-contrast": { enabled: false } } })`,
  violations `[]`, as `src/lib/client/components/connections/finder.dom.test.svelte.ts` ~400 does; the dialog is
  portaled, so run it on `document.body`).

**How to run tests (only this way, one run at a time):** first
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/kn-4a1-w3-<n>.log 2>&1"`
and read the log (never pipe vitest into `head`). Run also `src/lib/client/lorebooks/entryPool.couldExistBulk.dom.test.svelte.ts`
and every existing test of the files you touch. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` and
`NODE_OPTIONS=--max-old-space-size=10240 npm run check` (0 errors in your files), and `npx prettier --check` on each
touched file (new files must pass; for an existing file already failing before you, keep your own hunks formatted).

## Stop and report (do not decide) when

A sentence a person reads is needed beyond the ones above; `EntryPool.svelte` or the store would need a change; a
new setting, event or file outside the list seems needed.

## Report

Changed files; every sentence a person can read, listed; tests with pass counts and log paths; tsc/check results;
noticed and not done.
