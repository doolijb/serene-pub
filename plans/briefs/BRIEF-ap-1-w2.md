# BRIEF — `ap-1-w2` (client): the Apply review where the session's owner may not write the lorebook

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `ap-1`. SDK untouched.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: do not run one.)

Also: run no git command that changes the index or the working tree. Never `prettier --write`. Comments state the rule, never the history. **Views never call `toaster`** (CLAUDE.md: one domain context per event family is the only listener that toasts). `socket.off(event)` always with its handler. Mutable sets/maps in `$state` are `SvelteSet`/`SvelteMap`. No `confirm()`: confirmations are built into the page (this panel's existing `ask(...)` → `asking` dialog).

## Context (server, built by a sibling worker; do not edit server files)

`sessions:overlayItems` / `sessions:appliedBatches` now answer `mayApply: true` only when the reader is the **session's owner AND may write the session's lorebook** (`canWriteLorebook`, today: owns it). Anyone but the session's owner still gets the empty shape (owner ruling G2, 2026-11-16: "a guest neither opens nor edits the notes"). Owner ruling A1 (2026-11-17): "Can't apply to a lorebook owned by someone else." Where the session's owner may not write the lorebook (a provided/plugin lorebook), Apply and Take back are closed; the review says so in one sentence and offers the existing **Merge ‹book› into these notes** action with its existing words (`FOLD_LABEL`, `FOLD_CONFIRM` from `$lib/shared/lorebooks/sessionNotes`, emit `sessions:foldInParent` with `{ sessionId }` — exactly what the header menu item at `SessionViewPanel.svelte` ~400–410 does).

## Goal — `src/lib/client/components/sessionForms/SessionViewPanel.svelte` only

1. Add `let mayWrite = $derived(isOwner && mayApply)` with a one-line comment: the reader is the session's owner and may write its lorebook (what the server's `canWriteLorebook` says, via `mayApply`). Use `mayWrite` (not `mayApply`) for every Apply control (**Apply all to the lorebook**, each **Apply to the lorebook**, the **Writes from sessions to this book** link at ~594) and make **Take back** require `isOwner && mayTakeBack`.
2. The header menu item **Share to ‹book›** (~386–399, emits `sessions:applyOverlay`): gate `isOwner && mayWrite && lorebookId != null` (today `isOwner && lorebookId != null`).
3. The card gate at ~588: `isOwner && lorebookId != null && (overlayItems.length > 0 || batches.length > 0)` (today `(isOwner || mayApply) && …`).
4. Inside the card, when `!mayWrite`: at the top of the card, one line (same style as the `appliesItself` line: `<p class="text-surface-600-400 mb-1.5 text-xs">`), with a `<!-- 🚧 Provisional copy: the owner has not seen this sentence. -->` comment:
   `{shareBookName} isn't yours to change, so what waits here stays in this session.`
   followed by a quiet text-link button (class like the existing `text-primary-ink hover:underline`, `type="button"`) labelled `FOLD_LABEL(shareBookName)` whose click runs `ask(FOLD_CONFIRM(book), FOLD_LABEL(book), () => socket.emit("sessions:foldInParent", { sessionId }))` with `const book = shareBookName` captured first, exactly as the menu item does. Give the line `data-apply-closed` so tests find it. No new state, no new socket listener, no toast.
5. Update the `mayApply` comment (~147) to: the reader is the session's owner and may write its lorebook (the server decides).

Touch nothing else. Reuse; no new component.

## Tests

Existing DOM tests that pin the old gate (`isOwner: false, mayApply: true` shows the card / Take back) are **re-pinned**, not deleted: in `src/lib/client/components/sessionForms/sessionViewPanel.applied.dom.test.svelte.ts` — "shows with mayApply even when the reader does not own the session" becomes "hidden for a reader who is not the session's owner, whatever mayApply says" (expect no card, no Apply button); the Take back and refusal tests that mount `isOwner: false, mayApply: true` mount `isOwner: true, mayApply: true`; the "absent without mayApply" half keeps `isOwner: false` or uses `isOwner: true, mayApply: false` — both must show no Take back. Fix the file's header comment that says the card follows `mayApply` (never `isOwner`). List every re-pin old → new in your report. Change `sessionViewPanel.ownBookItems.dom.test.svelte.ts` only if it fails, and say why.

New tests (in `sessionViewPanel.applied.dom.test.svelte.ts`, reusing its `mountPanel` harness):
- owned (`isOwner: true, mayApply: true`): Apply buttons present, no `[data-apply-closed]`, the header menu offers **Share to ‹book›** (see `sessionViewPanelHeader.dom.test.svelte.ts` / `sessionViewPanel.fold.dom.test.svelte.ts` for how the menu is opened and read).
- not writable (`isOwner: true, mayApply: false`, items + one batch): `[data-apply-closed]` shows the sentence with the book's name; no **Apply to the lorebook**, no **Apply all…**, no **Take back**; the header menu has no **Share to ‹book›** but still has **Merge ‹book› into these notes**; pressing the card's merge link opens the in-page confirmation with `FOLD_CONFIRM(book)` and confirming emits `sessions:foldInParent` with `{ sessionId }`; `socket.emit` was never called with `sessions:applyOverlay`.

Run, one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, always with paths:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-1-w2-<n>.log 2>&1"`
with `src/lib/client/components/sessionForms/sessionViewPanel.applied.dom.test.svelte.ts src/lib/client/components/sessionForms/sessionViewPanel.ownBookItems.dom.test.svelte.ts src/lib/client/components/sessionForms/sessionViewPanel.fold.dom.test.svelte.ts src/lib/client/components/sessionForms/sessionViewPanelHeader.dom.test.svelte.ts`. Never pipe vitest into `head`. Then `NODE_OPTIONS=--max-old-space-size=10240 npm run check` and report errors in your files (0 expected) — do not fix others'. `npx prettier --check` your files.

## Files owned
`src/lib/client/components/sessionForms/SessionViewPanel.svelte`; `sessionViewPanel.applied.dom.test.svelte.ts`; `sessionViewPanel.ownBookItems.dom.test.svelte.ts` (only if it fails).

## Files readable
Anything. Never edit: server files, `shared/**` (including `shared/lorebooks/sessionNotes.ts` and `shared/sockets/types.ts`), `EditSessionForm.svelte` and its seat components, `LorebooksWorkspace.svelte`, docs.

## Out of scope
Any copy/clone action, a new socket event, re-pointing the session, other entry points (e.g. `LorebooksWorkspace.svelte`'s Share menu: note it, don't touch it).

## Stop and ask when
A test you did not name fails; you need a new prop, event, state field or shared constant; the sentence seems to need different words (build as given; note your concern).

## Report
Final message: changed files, the diff of the gates (before → after), tests run with pass counts and log paths, re-pins old → new, check result, anything noticed but not done.
