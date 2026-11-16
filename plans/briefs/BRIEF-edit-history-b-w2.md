# BRIEF — `edit-history-b` worker 2 — the Edit history fold for card versions and cast versions (client)

Repo `/home/jody/github/serene-pub`. Supervisor: lane `edit-history-b`. You cannot spawn agents.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This lane runs no `sdk:build` at all.)

## Owner rulings you build (quoted)

- 2026-11-13: "Also make a pass on cast history and make sure it behaves similar so it's familiar across the entire lorebook. Lets also add card edit history." · "card edit history should be per version".
- 2026-11-14 "Lets go with all your recommendations": the name **Edit history**; cast: an Edit history on each cast version, **the dated list (*Amendments*) left exactly as it is**.
- With **Show advanced controls** off the fold still shows (it is the undo for a person's own edits).
- Members never see model plumbing. It is a session, never a chat.

## Rules for these files (quoted from the canon)

- Sockets ruling (CLAUDE.md): "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`." A refusal is said inline in the fold, never as a toast. The fold already listens through `declareInterest` and asks through `awaitReply`: keep that pattern.
- Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`.
- `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. `socket.off(event)` without its handler removes every listener app-wide.
- STYLE-GUIDE §6.13 (folds): a fold is a full-width `<button type="button" aria-expanded aria-controls>` with a sentence-case label and a chevron; "A fold is drawn **only when it holds something**." The existing `EditHistory.svelte` already does this: reuse it, don't fork it.
- STYLE-GUIDE §6.14: "A form that buffers edits behind a Save asks before they are lost — and **only** then." A Restore must never silently drop a person's unsaved typing.
- STYLE-GUIDE §11: "Copy is sentence case and says what happens." "No horizontal scroll at 399px": the fold and its rows wrap at phone width.
- Comments state the rule, not the story. No `prettier --write` on a directory (single files only). All new copy is 🚧 and lives in `editHistoryCopy.ts`.
- Before running tests, check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`; if one is running, wait. Run each test as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/edit-history-b-w2-<name>.log 2>&1"` from the repo root, one run at a time; never pipe vitest into `head`.

## The wire contract (already in `src/lib/shared/sockets/types.ts`; the server side is being built in parallel by another worker — code against it, do not edit types.ts)

Read `Sockets.RedlineView` (new optional `beforeFollows`, `afterFollows`, `noPreview` on each change) and `namespace Sockets.CharacterVersions` (`Redlines`, `RestoreRedline`, `ClearRedlines`). Events, each reply scoped on **`characterVersionId`** (`interestKey(event, characterVersionId)`), errors `<event>:error`:
- `characterVersions:redlines` `{ characterVersionId }` → `{ characterVersionId, cardId, lorebookId, canRestore, canClear, redlines }`
- `characterVersions:restoreRedline` `{ redlineId }` → `{ redlineId, characterVersionId }`, then the list again as `characterVersions:redlines`
- `characterVersions:clearRedlines` `{ characterVersionId }` → `{ characterVersionId, cleared }`
The typed-socket map (`client/sockets/typedSocket.ts`) and the interest registry get these names from worker 3; until then `tsc` may complain about the event names in your files — note it in your report, do not edit those two files.

## Build

1. **`src/lib/client/lorebooks/editHistory/EditHistory.svelte`** takes a subject: keep the existing `lorebookId` + `entryId` props working exactly as today (the entry form, `EntryWorkspace.svelte`, and `editHistory.dom.test.svelte.ts` must pass unchanged), and add `characterVersionId?: number` as the other subject. Move every event name, interest key, params and match function behind one small subject descriptor inside the component, so the markup is shared. For a version subject: ask `characterVersions:redlines`; Restore via `characterVersions:restoreRedline`; and, because a card editor and the Member tab have no ⋯ menu, the open fold ends with a **Clear edit history…** button (tonal, small) when `canClear`, opening the same `ClearEditHistoryDialog` with the version question and sentence (entries keep the ⋯ menu path through `clearOpen`). Switching `characterVersionId` closes the fold and clears its state, as switching entry does. Add `restoreBlocked?: string`: when set, every Restore button is disabled and carries that string as its `title`.
   - A change with `noPreview` shows `‹label›: changed`; a side with `beforeFollows` / `afterFollows` reads `(follows the card)` instead of a value.
2. **`editHistoryCopy.ts`** (all 🚧): add `CLEAR_VERSION_QUESTION = "Clear this version's edit history?"`, `clearVersionSentence(n)` = `Removes its ${editsCount(n)}. The version stays as it is now; what it said before can no longer be restored.`, `FOLLOWS_CARD_TEXT = "(follows the card)"`, `NO_PREVIEW_TEXT = "changed"`, `RESTORE_BLOCKED_UNSAVED = "Save or discard your changes first."`. Widen (one meaning now covers three subjects): `clearBookSentence(n)` = `Removes ${editsCount(n)} across its entries and cast. Every entry and cast member stays as it is now; what they said before can no longer be restored.`; `CLEAR_BOOK_HINT = "What this lorebook's entries and cast said before each edit."`; `CLEAR_ALL_QUESTION = "Clear every edit history on this pub?"`; `clearAllSentence(n)` = `Removes ${editsCount(n)} across this pub. Entries, cast members and cards stay as they are now; what they said before can no longer be restored.`; `ADMIN_CARD_HELP = "What entries, cast members and cards said before each edit, kept on this pub."`; `ADMIN_CLEAR_LOSES = "Clearing removes every kept edit; entries, cast members and cards stay as they are now."`. Leave every other existing string as it is. Update the existing DOM tests' expected strings only where these words changed.
3. **Character editor** (`src/lib/client/components/characterForms/CharacterForm.svelte`): in edit mode, an `EditHistory` with `characterVersionId={shownCardVersionId}` right under the version picker area. `versionLine` is rendered in two branches (~1345 and ~1355); place the fold so exactly one instance mounts whichever branch shows, and so it shows even when the card has a single version (the picker hides then). Pass `restoreBlocked={RESTORE_BLOCKED_UNSAVED}` while the form has unsaved changes (`hasChanges`). After a Restore the form must show the restored values: the server's restore runs the card's own save, which replies `characters:update`; check how the form takes its own save's reply and make sure a restore's reply (or a re-ask of the shown version with `askCharacter(characterId, shownCardVersionId)`) refreshes the clean form. The list must be asked again after each save of the shown version (the `updatedAt` prop exists for that: pass something that changes on every save reply).
4. **Cast member page, Member tab** (`src/lib/client/lorebooks/CastWorkspace.svelte`, the Member tab panel ~1940): the same fold for the shown cast version (`castRows.find((r) => r.id === selectedMember.id)?.castVersionId`), placed after the `AmendmentList` block inside the same fieldset, shown whether or not the book keeps a timeline. **The `AmendmentList` block is left exactly as it is.** `restoreBlocked` while `memberDirty`. Ask again after each save of the member.
5. **`src/lib/client/components/Layout.svelte`**, the `HANDLED_ERROR_EVENTS` set only: add `characterVersions:redlines:error`, `characterVersions:restoreRedline:error`, `characterVersions:clearRedlines:error` beside the `entries:redlines:error` lines; extend `src/lib/client/components/layoutHandledErrors.test.ts` for them.
6. **DOM tests**: `src/lib/client/lorebooks/editHistory/editHistoryVersion.dom.test.svelte.ts` (copy the harness of `editHistory.dom.test.svelte.ts`): a version subject asks `characterVersions:redlines` with its id; draws nothing for an empty list; closed fold *Edit history · 3 edits*; Restore emits `characterVersions:restoreRedline`; a refusal is inline; `restoreBlocked` disables Restore with the title; the Clear button opens the version question and emits `characterVersions:clearRedlines`; `noPreview` and follows render as specified; switching `characterVersionId` closes and re-asks. Plus a mount check for each screen if the existing tests of `CharacterForm` / `CastWorkspace` give a harness you can extend cheaply (find them with `ls src/lib/client/components/characterForms/*.test.* src/lib/client/lorebooks/*ast*.test.*`); if not, say so.
7. Run: your new test, `src/lib/client/lorebooks/editHistory/`, `src/lib/client/components/layoutHandledErrors.test.ts`, and the existing tests of `CharacterForm` and `CastWorkspace` you touched. `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — report errors in your files only.

## Files owned (edit only these)

`src/lib/client/lorebooks/editHistory/*`, `src/lib/client/components/characterForms/CharacterForm.svelte` (the version area and the fold's wiring only), `src/lib/client/lorebooks/CastWorkspace.svelte` (the Member tab's fold only), `src/lib/client/components/Layout.svelte` (`HANDLED_ERROR_EVENTS` only), `src/lib/client/components/layoutHandledErrors.test.ts`, and new test files beside them.

## Out of scope

The server; `shared/sockets/*`; `client/sockets/typedSocket.ts`; `AmendmentList.svelte`; the Timeline tab; `BookSettings.svelte`, `EntryWorkspace.svelte` and `admin/sections/data/Page.svelte` (they pick the widened words up through `editHistoryCopy.ts`); docs.

## Stop and ask (in your report, do not decide) when

A new label or sentence beyond the ones above seems needed; a placement in the brief cannot work; a file outside Files owned would need a change.

## Report

Your final message: changed files; every string added or changed; tests run with pass/fail counts and log paths; tsc errors in your files; Noticed, not done. Under 500 words.
