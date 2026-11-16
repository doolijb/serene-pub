# BRIEF — build lane `time-t8b-fix` — the scope review's findings on *could exist here* and bulk edit

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t8b-2026-11-15.md`, `plans/briefs/BRIEF-time-t8.md` (Builds C and D and the Corrections),
`STYLE-GUIDE.md` (lists, toolbars, copy), `NOMENCLATURE.md` §24 and the §25 block for bulk edit.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal

Five fixes found by the scope review of lane `time-t8b`. No new feature, no setting, no migration, no SDK change.

### 1. A refusal reaches only the request that caused it, and is said once

Today the bulk bar's `entries:update` / `entries:delete` requests give no `matchError`
(`src/lib/client/lorebooks/BulkEditBar.svelte` ~104–115, ~133–143), and the entry form's own save waits on the
same `entries:update:error` without one (`EntryWorkspace.svelte` ~1812–1820). A refusal of either rejects both;
and Layout's catch-all toasts every bulk refusal as well as the bar listing it (only `entries:setMarks:error` is
in the handled list, `components/Layout.svelte` ~243).

- Server (`src/lib/server/sockets/entries.ts`, the update and delete handlers ~1492–1498, ~1889): echo an
  optional `requestId` from the params on the refusal, the way `lorebooks:duplicate` does (`askerOf` / `echo` in
  `sockets/refusable.ts`; read how `sockets/lorebooks.ts`'s duplicate handler and `time/TimelineCard.svelte` use
  it, and follow that pattern exactly). Additive: absent `requestId`, behaviour is as today.
- Client: the bulk bar sends a `requestId` per request and matches the reply and the refusal on it; the entry
  form's save does the same for its own request. Build the id without `crypto.randomUUID` (plain-http LAN
  addresses and phones): reuse the helper the duplicate flow uses.
- `Layout.svelte`: add `entries:update:error` and `entries:delete:error` to `HANDLED_WHEN_ASKED_ERROR_EVENTS`
  (~377), so a refusal that carries a `requestId` is said by its asker and one without is still toasted, with
  the test in `layoutHandledErrors.test.ts`. Another session edits `Layout.svelte`: add your lines by Edit only.
- `src/lib/client/sockets/typedSocket.ts`: add `"entries:delete:error"` so the bar's `as never` cast goes.
- Check every other asker of `entries:update` and `entries:delete` in the client still works unchanged.

### 2. A bulk delete tells the truth

- A child whose parent's delete was refused is listed as not deleted (*Not deleted: ‹parent› was not.* 🚧) and
  stays selected (`BulkEditBar.svelte` ~249–268, ~152).
- When entries filed under the selection may exist that the page has not loaded (`filedUnderCount` sees only
  loaded rows, ~214–219), the confirmation says *Entries filed under them go too.* without a number, never a
  count that may be short.
- After a bulk move, the report counts the entries taken along too (~284–287).

### 3. Rows that begin later stay in the list (lead's decision, ★T8B-1 for the owner)

The brief did not ask for the existing dimmed rows to change. Rows on this line's chain that begin after the
moment being read **stay in the list body, dimmed and at the end as before the lane**, with their checkbox, row
actions, drag and place in the tree; with the **Could exist here** toggle on they gain one line: *Begins in
‹date›* and **Read from ‹date›**. The **Could exist here** group holds only entries on lines forked from this
one. History entries are never given *Begins in* (a history entry's date is its own). Update the group's
charter comment, the docs and the NOMENCLATURE row to say so.

### 4. No word of fading

`BulkTimeDialog.svelte` ~129: *Sets how each entry fades…* becomes *Sets the Decay stored on each entry. Their
other fields stay as they are.* 🚧 (nothing reads Decay yet; P1). Update the §25 copy line.

### 5. Touch size

The group's checkboxes get `pointer-coarse:size-6`, as the list's have (`CouldExistHereGroup.svelte` ~198).

## Files owned

`src/lib/client/lorebooks/BulkEditBar.svelte`, `bulkEdit.ts`, `BulkTimeDialog.svelte`, `CouldExistHereGroup.svelte`,
`couldExistHere.ts`, `EntryPool.svelte`, `EntryWorkspace.svelte` (only its save's `requestId` and the dimmed-row
line if it is drawn there), `src/lib/server/sockets/entries.ts` (the echo only), `src/lib/shared/sockets/types.ts`
(the optional `requestId`), `src/lib/client/sockets/typedSocket.ts`, `src/lib/client/components/Layout.svelte`
(two lines) and `layoutHandledErrors.test.ts`; tests beside each; `docs/lorebooks.md`, `NOMENCLATURE.md`.

## Out of scope

Anything else in the review's notes (the delete modal's role, the per-entry delete wording, a bulk server
request); the entry form's layout; the Chronicle (another lane is building it in the SDK and
`components/sessionPage/requests/` right now: do not touch those, and do not run `sdk:build`).

## Stop and ask when

CLAUDE.md §Decisions applies; the echo pattern cannot be followed without changing what a refusal sends to other
listeners; a second event or a server behaviour change seems needed.

## Done means

- Tests (targeted, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t8b-fix-<name>.log 2>&1"`,
  one at a time; before each, check `ps -eo pid,args | grep -E "node.*vitest|sdk:build" | grep -v grep` and wait
  if anything is running): a bulk refusal does not reject the form's save and the other way round; a refusal
  with a `requestId` is not toasted and one without is; the truthful delete report; later rows stay in the body
  with their checkbox and gain the line only with the toggle on; the existing lane tests and
  `sockets/entries*.int.test.ts` pass.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines changed.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t8b-fix-2026-11-15.md`): changed files,
tests with results, names and sentences added, open ★, Noticed not done. Under about 500 words.
