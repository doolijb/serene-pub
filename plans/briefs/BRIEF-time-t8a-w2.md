# BRIEF — worker `time-t8a-w2` — the **Move down the tree…** button and dialog

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8a`. You type; you do not decide product questions.
If something below does not fit the code, stop and say so in your report rather than inventing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal

In the lorebook entry form: one button, **Move down the tree…**, and a dialog component of its own that moves
the open entry, permanently, to a line its line was forked from. The server half (`amendments:moveDownTheTree`)
is being written at the same time by another worker; code against the wire below. Keep the change small: one
button, one dialog component, so a later layout change moves the button without rework.

## Owner rulings (quoted; they decide, you do not)

- 2026-11-13: "perpetual entries always sit on the earliest point on their branch … a dropdown and button to
  permanently move the entry down the tree. The dropdown shows the current and parents in descending order"
  ("down" = toward main); an entry dated before the split "could theoritically be pulled down as well"; "When
  moving a child before the parent, prompt an approval to move the parent, don't allow children to be moved down
  without the parent."
- 2026-11-14: the chosen screen is **move down as a confirming dialog**. ★9 ruled: no way back (the dialog says it
  is permanent). §5.8: permanent actions are the lorebook owner's alone (hide for a shared reader).
- 2026-11-14: "hide all the extra time management noise … when timelines aren't enabled" — lines are not part of
  the timeline, so the move stays with the Timeline off; only its wording drops dates.
- Label (cold review, correction 2): **Move down the tree…** (never "Move down": that already means reordering a
  list).
- Supervisor's decision (★T8A-1, open with the owner): entries filed under one another move together — the
  entry's parents on its line, and every entry filed under it there. The dialog names them in its one approval;
  Cancel declines.

## The rule is already written — use it, do not re-derive it

`src/lib/shared/lorebooks/moveDownTheTree.ts` (green test beside it): `TreeRow`, `linesBelow(source, branches)`,
`takenAlong(ids, rows, source)`, `moveDownProblems({ ids, rows, target, branches })`, `moveDownSentence(problem,
words)`, `linesStartingToRead(rows, source, target, branches)`. Do not edit it; if it is wrong, say so.

## The wire (exact)

- emit `amendments:moveDownTheTree` with `{ lorebookId: number; entryIds: number[]; branchId: number | null }`
  (`branchId` = the target line, null = main).
- reply `amendments:moveDownTheTree`, scoped by `lorebookId`: `{ lorebookId; branchId; entryIds }`. It comes after
  the server has re-sent the entry lists (`entries:list`), so the workspace re-reads by itself.
- refusal `amendments:moveDownTheTree:error`: `{ error?: string; lorebookId?: number }` — the server's own sentence.
Until the other worker adds the typedSocket entries, `tsc` may complain about the event name; that is expected —
say so in your report, do not add the typedSocket lines yourself.

## Files owned (edit only these)

- NEW `src/lib/client/lorebooks/time/moveDownTheTree.ts` — client glue, pure: `treeRowsOf(rawRows: Readonly<Record<
  string, PoolSource[]>>): TreeRow[]` (each wire row: `id`, `name: row.name?.trim() || "Untitled"`, `isHistory:
  typeId === HISTORY_TYPE_ID`, `branchId: row.branchId ?? null`, `anchorEntryId: row.anchorEntryId ?? null`,
  `date: typeof row.year === "number" ? { year, month: month ?? null, day: day ?? null } : null` — the date the
  workspace's `rowDate` cuts on), and the words/joins the dialog needs. NEW test beside it.
- NEW `src/lib/client/lorebooks/time/MoveDownTheTreeDialog.svelte` and NEW
  `src/lib/client/lorebooks/time/moveDownTheTreeDialog.dom.test.svelte.ts`.
- `src/lib/client/lorebooks/time/BeginningDecayRow.svelte` — add one optional prop `lineAction?: Snippet`, drawn
  beside the toggle button (wrap the toggle and it in a `flex flex-wrap items-center gap-x-3` row; the toggle keeps
  its look and its `aria-label`). Nothing else changes there. Extend `time/beginningDecayRow.dom.test.svelte.ts`
  with one test that `lineAction` is drawn and the existing tests still pass.
- `src/lib/client/lorebooks/EntryWorkspace.svelte` — ONLY: (a) `let moveDownOpen = $state(false)`; (b) in the
  `entryZone` snippet's `<BeginningDecayRow …>` (~2641) a `lineAction` snippet holding the button, drawn when
  `entryEditable && selectedSource && selectedSource.branchId != null && !isNew`; (c) in `editorMenu` (~2440), in
  the block that already draws Pinned/Off when `!railed`, the same action as a `btn btn-sm preset-tonal-surface
  w-full justify-start` row when `!railed && !readOnly && !isNew && selectedSource && selectedSource.branchId !=
  null && (selectedSource.branchId ?? null) === (route.branch ?? null) && activeDoor.kind !== HISTORY_TYPE_ID`
  (the Timeline-off case: there is no entry area then, exactly as Pinned and Off sit in ⋯ when not railed); it
  closes the menu and opens the dialog; (d) one `<MoveDownTheTreeDialog>` mounted inside the existing `{#if
  !readOnly}` block near the `VersionDateDialog` mount (~3057), with `open={moveDownOpen}`, the `lorebookId`, the
  entry id, `dirty={hasUnsavedChanges}` (or the form's `dirty`), `onClose`, `onMoved`. Nothing else in that file.
- `src/lib/client/components/Layout.svelte` — exactly one line added by Edit into `HANDLED_ERROR_EVENTS` (~117):
  `"amendments:moveDownTheTree:error",` — another session edits this file; do not reformat, do not run prettier on
  it, touch no other line.

Files readable: anything. Models: `time/VersionDateDialog.svelte` (Skeleton `Dialog` in a `Portal`, header,
footer) and its test `time/versionDateDialog.dom.test.svelte.ts` (mount pattern); `time/TimeLens.svelte` ~336
(`awaitReply` with `replyKey: interestKey(event, lorebookId)`); `bookData.svelte.ts` (`getBookData().rawRows`: every
entry as stored, every line, every type; `bookReadOnly()`, `bookTimeline()`); `time/bookTime.svelte.ts`
(`openBookTime.branches`, `openBookTime.lineName(id)`); `sections/historyDates.ts` (`formatDate`, which uses the open
book's calendar).

## The dialog — `MoveDownTheTreeDialog.svelte`

Props: `open: boolean`, `lorebookId: number`, `entryId: number`, `dirty: boolean`, `onClose: () => void`,
`onMoved?: (target: number | null) => void`. Reads rows from `getBookData().rawRows` (via `treeRowsOf`) and lines from
`openBookTime.branches`. A Skeleton `Dialog` in a `Portal`, `role="alertdialog"` (a permanent action),
`closeOnInteractOutside={false}`; Escape, the `X` and **Cancel** close it. Header: `Dialog.Title`, muted
`Dialog.Description`, `X` `Dialog.CloseTrigger` with `aria-label="Close"` (as `VersionDateDialog`).

Copy, exact (‹source› = the entry's line name, ‹target› = the chosen line's name, main is `main`):
- Title: `Move ‹entry name› down the tree`
- Description: `Pick a line ‹source› was forked from. The entry moves there for good.`
- A `fieldset` with legend `Move to`, one real radio per line in the order `[source, ...linesBelow(source)]`
  (current first, main last). The current line's radio is disabled and its label carries a tonal chip `Here now`.
  A line the move cannot reach is a disabled radio with its reason under it, muted, tied by `aria-describedby`:
  the reason is `moveDownSentence(firstProblem, words)` for `moveDownProblems({ ids: [entryId, ...takenAlong ids],
  rows, target, branches })`, with `words = { lineName, date: formatDate, timeline: bookTimeline().value }`. The
  first reachable line below is chosen when the dialog opens; none reachable → nothing chosen.
- Under the list, for the chosen line, in one `aria-live="polite"` region, each its own `<p>`:
  - when `takenAlong` is not empty: `Also moves ‹A, B and C›: entries filed under one another move together.`
  - `‹lines› will start reading it, and so will the sessions playing on them.` (‹lines› = the names of
    `linesStartingToRead(movingRows, source, target, branches)`, joined `A`, `A and B`, `A, B and C`)
  - `Its dated changes and links written on ‹source› stay on ‹source›.`
  - `It can't be moved back.`
  - with anything taken along, `it`/`Its` become `them`/`Their` in the last three.
- `dirty` true: `Save or discard your changes first.` and the confirm is disabled.
- A refusal: the server's sentence (the rejection's message from `awaitReply`, the timeout's included), in
  `text-error-600-400`, `role="alert"`, cleared when the choice changes or the dialog reopens.
- Footer: **Cancel** (`btn preset-tonal min-h-11`), then the one filled primary (`btn preset-filled-primary-500
  min-h-11`): `Move to ‹target›`, or `Move ‹n› entries to ‹target›` when others go along; disabled with no choice,
  while dirty, or while the request is in flight.
- Confirm: `awaitReply({ socket: useTypedSocket(), event: "amendments:moveDownTheTree", params: { lorebookId,
  entryIds, branchId: target }, replyKey: interestKey("amendments:moveDownTheTree", lorebookId), errorEvent:
  "amendments:moveDownTheTree:error", fallbackError: "The entry could not be moved.", match: (d) => d.lorebookId ===
  lorebookId && d.entryIds.includes(entryId) })`. On the reply: `onMoved?.(target)`, then `onClose()`. No toast
  (views never toast; the entry area's line words change, which says it).
- Focus (STYLE-GUIDE §6.6): when a yes removes the control it was asked from (moved to main: the button is gone),
  focus goes to the nearest control, never the page: in `onMoved`, after `tick()`, focus the entry area's
  Beginning/Decay toggle (`[data-lore-entry-zone] [data-lore-beginning-decay] > div > button` or by a ref — your
  choice) or, from ⋯, the ⋯ trigger.

The button in the entry area: `<button type="button" class="btn btn-sm preset-tonal-surface min-h-11"
data-lore-move-down-tree>` with `Icons.GitBranch` (size 14, `aria-hidden`) and the text `Move down the tree…`.

## Tests

- `time/moveDownTheTree.test.ts`: `treeRowsOf` over rows of two types (one History), and the joins.
- `time/moveDownTheTreeDialog.dom.test.svelte.ts` (mount with a static book-data context — grep
  `staticBookData`/`bookDataContext` in `bookData.svelte.ts` and an existing dom test using them; set
  `openBookTime.branches` as other tests do; mock the typed socket as other dom tests do, e.g. grep
  `useTypedSocket` mocks in `src/lib/client/lorebooks/**/*.dom.test*.ts`). Lines main ← A (Year 3) ← B (Year 5):
  1. the order is B (Here now, disabled), A, main;
  2. an entry dated Year 4 on B: A enabled and chosen, main disabled with `‹name› began at Year 4; A left main at
     Year 3.`; with the Timeline off: `A left main before ‹name› began.`;
  3. a perpetual entry: both enabled; the sentences name the lines that start reading, say what stays, and
     `It can't be moved back.`;
  4. a child with its parent on B: `Also moves ‹parent›…` and the confirm reads `Move 2 entries to A`; the emitted
     `entryIds` hold both;
  5. dirty: the sentence shows and the confirm is disabled;
  6. confirm emits the exact params; a refusal on the `:error` shows its sentence in place and the dialog stays
     open; a reply calls `onMoved` and `onClose`;
  7. Cancel calls `onClose` and emits nothing.
- `time/beginningDecayRow.dom.test.svelte.ts`: `lineAction` drawn beside the toggle.
- Keep green: `time/versionRail.dom.test.svelte.ts`, `entryWorkspace.versions.dom.test*`, `sections/entryZones.dom*`,
  `time/beginningDecayRow.dom.test.svelte.ts`, `lenses/readOnlyLenses.dom*` (grep the exact file names). Run them.

Run (from the repo root, one file at a time; first check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`
and wait while one runs; never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <path> > plans/time-t8a-w2-<name>.log 2>&1"`

## STYLE-GUIDE rules this work must meet (quoted)

- §6.6: "Dialogs are Skeleton `Dialog` in a `Portal` at `z-50`. Nothing in the app renders its own `fixed inset-0`
  backdrop. A question asked before a verb that replaces or deletes something is an `alertdialog` whose words say
  what goes and what stays … An `alertdialog` is answered, never dismissed by a click outside
  (`closeOnInteractOutside` off; its buttons and Escape close it), and when a yes removes the control it was asked
  from, focus goes to the nearest control that brings it back, never the page." "**A dialog's header** is its
  `Dialog.Title` (heading font, 18px semibold), a muted 14px `Dialog.Description` under it saying what the dialog is
  for or where things stand, and an `X` `Dialog.CloseTrigger` (a small icon button, `aria-label="Close"`) at the top
  right."
- §6.1: "One primary button per surface … Secondary actions are tonal." The confirm is primary (the person gets
  something: the entry on more lines), never `error`.
- §9: "Every interactive element is a real `button`, `a` or input with an accessible name"; "Never an interactive
  inside an interactive"; "Nothing is hover-only"; "Targets are 44px on touch" (`min-h-11`); focus visible.
- §10: "Sentence case everywhere"; "A button says what happens"; "errors say what went wrong and what to do";
  "Help is one sentence."

## Hard rules

- Sockets: one domain context listens and toasts; **views never call `toaster`/`notify`**. `socket.off(event,
  handler)` always with the handler (`awaitReply` releases its own interests). An event in `SCOPED_EVENTS` carries
  its scope key in the payload — here `lorebookId`, and the reply key is `interestKey(event, lorebookId)`.
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- Inside `db.transaction(async (tx) => …)` only `tx` (server; not yours here).
- It is a **session**, never a chat.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines you changed (check with
  `npx prettier --check <file>`; fix by hand; never on `Layout.svelte`).
- No other product's name. No new name, label or sentence beyond the ones above; if you need one, stop and ask.
- Do not touch the version rail, the other zone fields, or any file not listed.

## Report (your final message)

Changed files; each test file run with pass/fail counts and log path; every label and sentence added (verbatim);
the one Layout line; anything that did not fit; Noticed, not done.
