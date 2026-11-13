# BRIEF — `s4-bk-lock` worker 2 (client) — no reading a book in, no stopping; the edit form's read-only Lorebook line — 2026-11-08

Supervisor: lane `s4-bk-lock`. Repo `/home/jody/github/serene-pub`. Worker 1 runs in parallel on the server (bookLock, `sessions:update`, removing the `sessions:setLorebook` handler, its socket types, `typedSocket.ts` and `interest.ts` entries). Don't touch any server file, `src/lib/shared/**`, `typedSocket.ts` or `interest.ts`.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Owner rulings this rests on (never reinterpret)

- 2026-11-05 ★27-10: "All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data storage API is predictable. No swapping lorebooks."
- 2026-11-08 ★B-5: the book is **fixed at start** — chosen at create; **the edit form shows a read-only line**.
- Memory rule "There is ALWAYS a lorebook": never write copy that frames a session as having no lorebook. A session with `lorebookId == null` reads **its own book** (its Session notes); one with `lorebookId` set reads that book (its own book overlays it).
- Removed with the event: every UI that reads a book into a session or stops reading one — LorebooksWorkspace **Read into this session** / **Stop reading** + the replace dialog, LorebookActions/NewLorebookDialog create-and-read-in, SummarizeLoreModal attach-existing / create-and-attach. The summary writes into the book the session already reads (the modal already gets it as `lorebookId = sessionBookOf({ lorebookId, ownBookId })` from the session page).
- **Kept:** Share as a lorebook (`sessions:shareAsLorebook`), Share to ‹book›, Clone with changes and attach (removed in wave 6, not here), the reading line (*Read by ‹session›*), Book settings' list of sessions reading the book.

## The words (owner-ruled, plan §34.3 — import them, never retype)

Worker 1 is adding to `src/lib/shared/lorebooks/sessionNotes.ts` (import from there; until it lands, tsc will complain — that's expected):
```ts
export const BOOK_LOCK_REFUSAL = "A session keeps the lorebook it started with."
export const BOOK_LOCK_LINES = Object.freeze({
	ownBook: "This session's lorebook is its own notes, and a session keeps the lorebook it started with. Share them as a lorebook to build on them in other sessions.",
	overlay: (book: string): string => `This session reads ${book} and keeps it. Share its notes to ${book}.`
})
```
and **removing** `NOTES_KEEP_THE_WORLD` and `bookFixedSentence` (EditSessionForm imports them today — drop those imports). `SESSION_NOTES_LABEL` and `SHARE_LABELS` stay.

## Goal

### 1. `src/lib/client/components/sessionForms/EditSessionForm.svelte` — the Lorebook Select becomes a read-only line (~2477–2560)
- Replace the `<Select label="Lorebook" …>`, its `sr-only` help span and the `lorebookFixed` paragraph with one read-only block inside the same `{#if showLorebookField}`: the existing visual label (**Lorebook**, keep the help icon's `title`), then the line, `text-surface-600-400 text-xs` like its neighbours, `data-session-lorebook-line={savedLorebookId == null ? "own" : "overlay"}`.
  - **Owner** (`!isGuest`): own book (`savedLorebookId == null`) → `BOOK_LOCK_LINES.ownBook`; overlay → `BOOK_LOCK_LINES.overlay(name)`.
  - **Guest**: only the name — `SESSION_NOTES_LABEL` for an own book, the book's name for an overlay (the sentences offer Share, which a guest can't do). No new copy.
  - The name: look it up in the `lorebooks:list` reply **before** `handleLorebooksList`'s filters (a shared or provided book can be filtered out of `lorebookList`) — e.g. keep a small name map from the unfiltered reply; fall back to `"its lorebook"` (the old code's fallback) only when unknown.
- Replace the "With no lorebook, this session keeps its session notes…" paragraph (~2615–2644): keep the block's **Share as a lorebook** button (same condition, owner only, `savedLorebookId == null`), drop the paragraph — the own-book line above already says it.
- Remove `if (!shape.lorebook) lorebookId = null` in the genre-change trim (~1433): the server now refuses any change of book, so it would make Save fail. The save payload keeps posting the stored `lorebookId` (the server accepts the same value).
- Remove what only served the picker: `lorebookFixed` derived (~494), the old imports, the unreachable `{:else if lorebookId != null}` "Save to choose the line…" branch (~2660) if it can no longer be reached (`lorebookId` now only changes together with `savedLorebookId`, in the shareAsLorebook reply). Keep `SessionLorebookReading`, Lorebook writes, scene settings as they are. Keep `Select`'s import if anything else uses it.
- Fix the 🚧 book-lock comments you touch so none promises a switch before play.

### 2. `src/lib/client/lorebooks/LorebooksWorkspace.svelte` — no Read into / Stop reading
Remove: the `attachLorebookToSession` import; `ReplaceReadingModal` import and its `<ReplaceReadingModal …>`; `replacing`, `readIntoSession`, `handleAttachToSession`, `handleDetachFromSession`, `changeReading`, `readingVerbTitle`; the `readingVerb` snippet and its render site(s); the compact ⋯ item (~1546–1555) and the disabled *Open a session you own…* item (~1593–1598); `useInterest<"sessions:setLorebook">` (~2659–2666) and `handleSessionsSetLorebook`; `canOfferAttachToSession` and the prop passed to `LorebookActions`; the attach props passed to `LorebookListItem` (`hasOpenSession`, `openSessionHasLorebook`, `isOpenSessionLorebook`, `onAttachToSession`, `onDetachFromSession`) and `canChangeReading` / `onChangeReading` passed to `BookSettings`. Then delete whatever became unused (`otherReadBook`, `readingFixed`, `openSessionHasLorebook`, `READ_INTO_SESSION`/`STOP_READING` imports …) — but **keep** `readingInto`, `markedSessionId`, the reading line, `hasOpenSession` if still read. Fix the comment at ~404 that cites `sessions:setLorebook`. Don't touch Share / Clone with changes menus.

### 3. Other components that carried the verbs
- `src/lib/client/components/listItems/LorebookListItem.svelte`: drop the attach props and the two menu items (~203–230) and the imports. `grep -rn "<LorebookListItem" src` — drop those props from any other caller too.
- `src/lib/client/lorebooks/BookSettings.svelte`: the *Reading into a session* section keeps its readout (label, `readingValue`, explanation) with **no action** (the `behaviour` snippet's `action` is optional); drop the `canChangeReading` / `onChangeReading` props. In `readingExplain`, drop the sentences that invite reading the book in — `"Those sessions read this book as they play. Open a session you own to read it in there too."` → `"Those sessions read this book as they play."`; `"No session reads this book. Open a session you own to read it in."` → `"No session reads this book."` (deleting words only; no new copy).
- `src/lib/client/components/lorebookForms/NewLorebookDialog.svelte`: drop the *Read it into ‹session›* switch, `canOfferAttachToSession`, `attachToSession` (state and the `onConfirm` details field), and `sessionName` if it only served the switch. Check every caller (`grep -rn "NewLorebookDialog" src`).
- `src/lib/client/lorebooks/LorebookActions.svelte`: drop `canOfferAttachToSession`, `pendingAttach`, the `attachLorebookToSession` call (~428–441) and the prop passed to the dialog. The create toast and `onCreated` stay.
- `src/lib/client/lorebooks/scopes.ts`: delete `READ_INTO_SESSION`, `STOP_READING`, `readingActionLabel`, `replaceReadingSentence` once nothing imports them (`grep -rn` first), and their cases in `scopes.test.ts`.
- Delete `src/lib/client/lorebooks/ReplaceReadingModal.svelte` and `src/lib/client/utils/attachLorebookToSession.ts` (their only use was the removed door).

### 4. `src/lib/client/components/modals/SummarizeLoreModal.svelte` — the summary writes into the book the session reads
- Remove: the `attachLorebookToSession` import and local function, `READ_INTO_SESSION` import, `attachingLorebookId`, `newLorebookName`, `isCreatingLorebook`, `confirmAttachExisting`, `createAndAttachLorebook` and the `lorebooks:create` request/interest that only fed it (check `pendingCreateRequestId` has no other use), the `useInterest<"sessions:setLorebook">` (~744) and its handler (~553–566), the `onLorebookSet` prop, and the whole `{:else}` attach block (~1145–1205) including *"This session reads no lorebook. Read one into this session to continue."*
- The status block shows **Saving to:** when `lorebookId` is known (as today); while it isn't (the page hasn't received the session's book yet) render nothing there — no new copy. `canGenerate` already requires `lorebookId`.
- `src/routes/sessions/[id]/+page.svelte`: delete the one line `onLorebookSet={(id) => data.setLorebook(id)}` (~1068) — nothing else in that file.
- `src/lib/client/components/sessionPage/sessionPageData.svelte.ts`: delete `setLorebook` (~1129) and its entry in the returned object (~1345) if nothing else calls it.

## Files owned (edit only these)
`EditSessionForm.svelte` · `LorebooksWorkspace.svelte` · `LorebookListItem.svelte` · `BookSettings.svelte` · `NewLorebookDialog.svelte` · `LorebookActions.svelte` · `client/lorebooks/scopes.ts` · `SummarizeLoreModal.svelte` · `src/routes/sessions/[id]/+page.svelte` (one line) · `sessionPageData.svelte.ts` (`setLorebook` only) · delete `ReplaceReadingModal.svelte`, `client/utils/attachLorebookToSession.ts` · any other caller of `LorebookListItem`/`NewLorebookDialog` only to drop the removed props · **client tests**: `scopes.test.ts`, `summarizeLoreModal.crosstalk.dom.test.ts`, `providedBooks.dom.test.svelte.ts`, `bookReadBy.dom.test.svelte.ts`, any other client test that breaks because of these removals, and the new DOM tests below.

**Never touch** (another worker's fix-up is editing them now): `BookRulesCard`, `BookWritesCard`, `BranchChip`, `LibraryView`, `ImportComponentDialog`, admin rulesets `IdPage`, `StartSessionForm`. Also out: `SessionViewPanel.svelte`, `ownBook`/clone-with-changes UI, ranking/annotation files.

## Out of scope (never build here)
- Clone with changes and attach (wave 6). Fold / Merge (wave 6). Surfaced books (wave 6).
- The SDK outlet, `ledgerLines.ts`'s `attach-lorebook` text (wave 1).
- Any restyle beyond swapping the Select for the line.

## Stop and ask when (say it in your report; finish the rest)
- Removing a control leaves a feature with nowhere to go (e.g. a summarize path that can't find a book to save to in a real session).
- Any new user-facing word beyond the three ruled sentences — the only words allowed are those, existing labels (`SESSION_NOTES_LABEL`, `SHARE_LABELS`), and deleting words.
- A new name, prop, setting or component.

## Rules (CLAUDE.md / STYLE-GUIDE, quoted)
- *"Sockets: one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."* Don't add toasts. Toasts go through `notify`.
- *"`socket.off(event)` with no handler removes every listener app-wide; always pass the handler."*
- *"`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."* (A plain object or a `$derived` map rebuilt from the reply is fine for the name lookup.)
- *"Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."*
- STYLE-GUIDE §10: *"Labels are nouns, hints are sentences … errors say what went wrong and what to do."* *"One name per thing … the thing you open is a session, never a chat."*
- STYLE-GUIDE §9: every interactive element is a real `button`/`a`/input with an accessible name. The read-only line is plain text — no disabled input pretending to be one.
- It is a **session**, never a chat.
- Never `git checkout` / `restore` / `stash`.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (No `sdk:build` is needed; a dev server runs on :5199.)
- **Prettier:** run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit (a whole-file `--write` re-sorts classes and reflows markup other work owns). If a file fails only on lines you didn't touch, leave it and say so.

## Tests
Capped scope, logged, never piped into `head`; logs in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, names starting `s4-bk-lock-w2`:
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <log> 2>&1; echo test-exit=$? >> <log>'
```
DOM tests are heavy: run ≤3 DOM files per run. A failing `assert` on a happy-dom element has OOM-killed VS Code — keep assertions on strings/booleans, not whole elements.

1. **Baseline first** (before editing): `scopes.test.ts`, `summarizeLoreModal.crosstalk.dom.test.ts`, `providedBooks.dom.test.svelte.ts`, `bookReadBy.dom.test.svelte.ts`, `lorebooksWorkspace.counts.dom.test.ts`, `editSessionHowStrict.dom.test.svelte.ts`, and any other client test that greps for `READ_INTO_SESSION`, `STOP_READING`, `attachLorebookToSession`, `canOfferAttachToSession`, `canChangeReading`, `onLorebookSet`, `sessions:setLorebook`, `data-session-lorebook-fixed`, `lorebook-from-notes`.
2. **New DOM tests** (follow the harness of `editSessionHowStrict.dom.test.svelte.ts` / `editSessionPlayerSeats.dom.test.svelte.ts`, and `lorebooksWorkspace.counts.dom.test.ts` / `bookOpens.dom.test.svelte.ts`):
   - the edit form shows the read-only line for an **own-book** session (`BOOK_LOCK_LINES.ownBook`, `data-session-lorebook-line="own"`, the Share as a lorebook button, no Lorebook select/combobox) and for an **overlay** session (`BOOK_LOCK_LINES.overlay(name)`); a guest sees only the name.
   - the lorebook workspace with an open owned session has no *Read into this session* / *Stop reading* (header, ⋯, list row ⋯, Book settings).
3. Update every client test that referenced the removed door/props; delete a case only with a one-line reason in your report.
4. Re-run all of the above; report before/after per file. Don't run `npm test`, `tsc` or `check` — the supervisor does (you may run `npx svelte-check --threshold error` on nothing; skip it).

## Report
Your final message: changed/deleted files, each decision you made, tests before/after per file, anything under Stop-and-ask, and **Noticed, not done**.
