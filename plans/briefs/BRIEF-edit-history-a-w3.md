# BRIEF — `edit-history-a` worker 3 — the entry form's **Edit history** fold and its ⋯ menu item

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Supervisor: lane `edit-history-a`. Repo: `/home/jody/github/serene-pub` (always absolute paths). Report: return it as
your final message (changed files, tests run with results, anything you could not do, Noticed-not-done).

## Goal

The server keeps an **Edit history** for each lorebook entry (table `lore_redlines`; done). The wire is done too:
read `src/lib/shared/sockets/types.ts` for `Sockets.RedlineView` (~51) and the namespaces `Sockets.Entries.Redlines`,
`RestoreRedline`, `ClearRedlines`, `RedlineCount` (~9330–9420), and `src/lib/server/sockets/redlines.ts` for what
each request answers (and when it re-sends `entries:redlines`). The copy and the confirmation dialog are written
by the supervisor: `src/lib/client/lorebooks/editHistory/editHistoryCopy.ts` (every word you show comes from here;
never write a user-facing string elsewhere — if you need one that is not there, stop and say so) and
`src/lib/client/lorebooks/editHistory/ClearEditHistoryDialog.svelte`. Read all of these first.

You build: a new component for the fold, its place in the entry form, the **Clear edit history…** item in the
entry's ⋯ menu with its confirmation, and DOM tests. Worker 4 builds Book settings and Admin › Data at the same
time: never edit their files.

## Rules that bind (quoted)

- Brief: "The entry form gets an **Edit history** fold under the fields, where the *Amendments* list sits today
  (`lorebooks/EntryWorkspace.svelte` ~2199), closed by default, showing the count. Each row: who (🚧 *You*, a
  person's shown name, or *‹routine› in ‹session›*), when (relative, exact on hover), which fields changed with
  before → after for short values and a *Show* disclosure for long text, and **Restore**. A row for a dated change
  says which (*the change from Year 7*). This placement is interim." The server already words `who` and `version`;
  show them as given.
- "**Clear edit history** for one entry in the entry's ⋯ menu … behind a confirmation that names the count; the
  lorebook's owner only." The list reply's `canClear` says so; `canRestore` says whether **Restore** is drawn.
- STYLE-GUIDE §10: "Sentence case everywhere." "No filler: a screen with nothing to say says nothing" — an entry
  with no edits draws **no fold**. "Counts live in the copy where they help … not as badges."
- STYLE-GUIDE §6.13 (folds): "Each fold is a full-width `<button type="button" aria-expanded …>`" with its body
  under it; collapsed on load.
- STYLE-GUIDE §6.6: the ⋯ is a Popover of toggles and buttons here (`editorMenu` snippet ~1904): add one
  full-width `btn btn-sm` row like **Archive** (`w-full justify-start`, a 14px icon), destructive tone
  `text-error-600-400`, last in the popover; it closes the popover and opens `ClearEditHistoryDialog`. "A question
  asked before a verb that replaces or deletes something is an `alertdialog` whose words say what goes and what
  stays" (the dialog does this; you pass `CLEAR_ENTRY_QUESTION` and `clearEntrySentence(count)`).
- CLAUDE.md Standing rulings: "views register listeners for local state and never call `toaster`" — a refusal
  (Restore refused with the earmark sentence, a clear refused) is said **inline** (`role="alert"`, under the row
  or in the dialog's `error`), never a toast. "`socket.off(event)` with no handler removes **every** listener
  app-wide; always pass the handler." "`$state(new Set())` / `new Map()` is not reactive on mutation — use
  `SvelteSet` / `SvelteMap`." Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- Use the request/reply helpers the neighbours use: `awaitReply` (as `lorebooks/editor/entryEarmark.ts`, with
  `interestKey("entries:redlines", lorebookId)`) and/or `useInterest` / `requestWithInterest`
  (`client/sockets/interest.svelte`, as `components/media/SpokenLinesRow.svelte`). The list must refresh when
  the entry is saved (pass the stored row's `updatedAt` as a prop and re-ask when it changes) and when the server
  re-sends `entries:redlines` after a Restore or a clear.
- Time: `timeAgo` (`client/utils/timeAgo.ts`) for the relative time, the exact local date and time in `title`.
- Values: `redlineValueText(value, absent)` and `isShortChange(beforeText, afterText)` from the copy file; a long
  change shows its `label` and **Show** / **Hide** (`aria-expanded`) revealing *Before* and *After* blocks
  (`whitespace-pre-wrap`).
- Row shape (STYLE-GUIDE §6.4 list rows): a line with **who** (semibold) · cause label (`REDLINE_CAUSE_LABELS`) ·
  time (muted 12px); the version line (`versionLine(version)`) when there is one; the changes; **Restore** as a
  `btn btn-sm preset-tonal-surface` (`RESTORE_LABEL`, `title={RESTORE_TITLE}`) at the row's end. Theme tokens only
  (`text-surface-600-400`, `border-surface-200-800`, …), no raw colours. Must work at 400px wide.
- Comments state the rule, not the story. Never reformat a file.

## Files owned (edit only these)

- New `src/lib/client/lorebooks/editHistory/EditHistory.svelte` (the fold; you may add a small `.ts` helper beside it).
- `src/lib/client/lorebooks/EntryWorkspace.svelte` (2.4k lines; read by range): the fold right **after**
  `<AmendmentList … />` inside the same `{#if !isNew && selectedItem && !libraryOpen && activeDoor.store ===
  "entries"}` block, and the one menu item + dialog. Check whether places and history days go through the same
  block (they are entries); report what you find.
- New DOM tests: `src/lib/client/lorebooks/editHistory/editHistory.dom.test.svelte.ts` (and a fixture `.svelte` if
  the harness needs one).
- `editHistoryCopy.ts` / `ClearEditHistoryDialog.svelte`: only to fix a bug; say so.

Never touch: `BookSettings.svelte`, `client/admin/**`, `Layout.svelte` (the six new `:error` events are listed for the
lead by the supervisor), any server file, any SDK file.

## Tests (Done means)

DOM tests (see the harness in `src/lib/client/lorebooks/entryEarmark.dom.test.ts` and
`bookSettingsAdvanced.dom.test.svelte.ts` for mounting with a mocked socket):
- the fold is closed on load and its button reads `Edit history · 3 edits`; no rows → no fold;
- a row shows who, the cause label, the relative time with the exact time in `title`, the version line for a dated
  change, a short change as *before → after*;
- a long change shows **Show**, and pressing it reveals *Before* and *After*;
- **Restore** emits `entries:restoreRedline` with the row's id; a refusal reply shows inline (`role="alert"`);
  **Restore** is not drawn when `canRestore` is false;
- the ⋯ item opens the dialog naming the count; confirming emits `entries:clearRedlines` with `{ entryId }`; the item
  is not drawn when `canClear` is false or there are no edits.
- Existing suites still pass: `src/lib/client/lorebooks/` (all of it; EntryWorkspace is mounted by several).

Run tests **only** like this, from the repo root, one run at a time, with full paths:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/edit-history-a-w3-<n>.log 2>&1"`
Before **every** run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` — if any vitest is running
(worker 4 and two other sessions test on this checkout), wait and check again; never two runs at once; never `pgrep
-f "vitest run"` in a loop. Never pipe vitest into `head`. A failing `assert` on a happy-dom element has OOM-killed
VS Code: keep DOM assertions on strings and attributes.
Then `NODE_OPTIONS=--max-old-space-size=12288 npm run check > plans/edit-history-a-w3-check.log 2>&1` (no other check
or tsc running) and report new errors in your files only.

## Stop and ask when (put it in your report and stop that part)

A word not in the copy file; a layout choice this brief does not settle; a file outside the owned list is needed.

## Verbatim

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs no `sdk:build` at all.)
- Never `kill -9`.
