# BRIEF — `edit-history-a` worker 4 — **Clear edit history** in Book settings, and the Admin › Data row

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Supervisor: lane `edit-history-a`. Repo: `/home/jody/github/serene-pub` (always absolute paths). Report: return it as
your final message (changed files, tests run with results, anything you could not do, Noticed-not-done).

## Goal

The server keeps an **Edit history** for each lorebook entry (table `lore_redlines`; done). The wire is done: read
`src/lib/shared/sockets/types.ts` for `Sockets.Entries.RedlineCount`, `Sockets.Entries.ClearRedlines`,
`Sockets.Admin.RedlineSummary`, `Sockets.Admin.ClearRedlines` (search by name), and
`src/lib/server/sockets/redlines.ts` for what each answers and who may ask (count and clear: the lorebook's owner
only, refused otherwise; the admin pair: admins only). The copy and the confirmation dialog are written by the
supervisor: `src/lib/client/lorebooks/editHistory/editHistoryCopy.ts` (every word you show comes from here; if you
need one that is not there, stop and say so) and `src/lib/client/lorebooks/editHistory/ClearEditHistoryDialog.svelte`.
Read all of these first.

You build: one action in Book settings with its confirmation, one new row component for Admin › Data, its place on
that page, and DOM tests. Worker 3 builds the entry form's fold at the same time: never edit its files.

## Rules that bind (quoted)

- Brief: "**Clear edit history** … for the whole lorebook in Book settings under 'This book'
  (`lorebooks/BookSettings.svelte`), each behind a confirmation that names the count; the lorebook's owner only."
  "Admin › Data (`client/admin/sections/data/Page.svelte`): one row in the count + size + **Clear** pattern of
  `components/media/SpokenLinesRow.svelte`, 🚧 *Edit history · N edits · ‹size›*, with a sentence saying what
  clearing loses."
- Plan rule (ruled): "Lorebook-wide and permanent actions (… clear history …) are the lorebook owner's alone."
- STYLE-GUIDE §6.6: "A question asked before a verb that replaces or deletes something is an `alertdialog` whose
  words say what goes and what stays; its confirm is … filled `error` when it only takes away." The dialog does
  this: pass `CLEAR_BOOK_QUESTION` / `clearBookSentence(count)` (Book settings) and `CLEAR_ALL_QUESTION` /
  `clearAllSentence(count)` (Admin). The admin row's **Clear** asks too (unlike Spoken lines, an edit history
  cannot be made again).
- STYLE-GUIDE §6.11 (admin pages): a `SettingCard` per concern (as **Spoken audio** on the same page:
  `title`, `titleId`, `headingLevel={2}`, `help`, `layout="stack"`), the row inside it; use `ADMIN_CARD_TITLE`,
  `ADMIN_CARD_HELP`, `adminRowLabel(count, bytes)`, `ADMIN_CLEAR_LOSES` (the muted 12px sentence under the row, as
  Spoken lines' *Removes the audio files only…*). The **Clear** button as Spoken lines' (`btn btn-sm
  text-error-600-400 hover:preset-tonal-error`, Trash icon), disabled at 0.
- Book settings: the action **Clear edit history…** (`CLEAR_ACTION_LABEL`) sits in the "This book" section's button
  row (both the starter and the ordinary branch, never when `readOnly`), styled as Spoken lines' Clear (tonal, error
  text — not the filled-error Delete), with `CLEAR_BOOK_HINT` as its `title`. Drawn only when
  `entries:redlineCount` `{ lorebookId }` answers a count above 0 (a refusal = not the owner = not drawn, said
  nowhere). Ask once on mount and again when the dialog opens, so the sentence names the count now.
- STYLE-GUIDE §10: "Sentence case everywhere." "No filler." Help is one sentence.
- CLAUDE.md Standing rulings: "views register listeners for local state and never call `toaster`" — a refusal is
  said inline (the dialog's `error`, or `role="alert"` under the admin row), never a toast. "`socket.off(event)` with
  no handler removes **every** listener app-wide; always pass the handler." Browser code: no `crypto.randomUUID`, no
  `navigator.clipboard`.
- Use the request/reply helpers the neighbours use: `useInterest` / `requestWithInterest`
  (`client/sockets/interest.svelte`, as `SpokenLinesRow.svelte`) and/or `awaitReply` (as
  `lorebooks/editor/entryEarmark.ts` with `interestKey(event, lorebookId)` for the scoped `entries:*` replies).
- Theme tokens only, works at 400px wide. Comments state the rule, not the story. Never reformat a file.

## Files owned (edit only these)

- `src/lib/client/lorebooks/BookSettings.svelte` — the one action and its dialog (and the asks they need).
- New `src/lib/client/lorebooks/editHistory/EditHistoryAdminRow.svelte`.
- `src/lib/client/admin/sections/data/Page.svelte` — one `SettingCard` holding the row, after **Spoken audio**.
- New DOM tests: `src/lib/client/lorebooks/editHistory/clearEditHistory.dom.test.svelte.ts` (Book settings) and
  `src/lib/client/lorebooks/editHistory/editHistoryAdminRow.dom.test.svelte.ts` (fixtures beside them if needed).
- `editHistoryCopy.ts` / `ClearEditHistoryDialog.svelte`: only to fix a bug; say so.

Never touch: `EntryWorkspace.svelte`, `EditHistory.svelte`, `Layout.svelte`, any server file, any SDK file.

## Tests (Done means)

DOM tests (see `src/lib/client/lorebooks/bookSettingsAdvanced.dom.test.svelte.ts` for mounting Book settings with a
mocked socket, and any `SpokenLinesRow` test if one exists):
- Book settings: with a count of 12 the action is drawn; pressing it opens the dialog whose sentence names 12;
  confirming emits `entries:clearRedlines` with `{ lorebookId }`; a refusal reply shows in the dialog; with a count
  of 0, or a refused count, no action is drawn; never drawn when `readOnly`.
- Admin row: shows `Edit history · 40 edits · ‹size›` from `admin:redlineSummary`; **Clear** opens the dialog
  naming 40; confirming emits `admin:clearRedlines`; Clear is disabled at 0.
- Existing suites still pass: `src/lib/client/lorebooks/` (Book settings tests), `src/lib/client/admin/` tests that
  mount the Data page (find them).

Run tests **only** like this, from the repo root, one run at a time, with full paths:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > plans/edit-history-a-w4-<n>.log 2>&1"`
Before **every** run: `ps -eo pid,args | grep -E "node.*(vitest|vite)" | grep -v grep` — if any vitest is running
(worker 3 and two other sessions test on this checkout), wait and check again; never two runs at once; never `pgrep
-f "vitest run"` in a loop. Never pipe vitest into `head`. A failing `assert` on a happy-dom element has OOM-killed
VS Code: keep DOM assertions on strings and attributes.
Then `NODE_OPTIONS=--max-old-space-size=12288 npm run check > plans/edit-history-a-w4-check.log 2>&1` (no other check
or tsc running; worker 3 runs one too) and report new errors in your files only.

## Stop and ask when (put it in your report and stop that part)

A word not in the copy file; a layout choice this brief does not settle; a file outside the owned list is needed.

## Verbatim

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (This lane runs no `sdk:build` at all.)
- Never `kill -9`.
