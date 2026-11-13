# BRIEF m2e-F-C-w2 — primer rows are read-only, client half (★M2e-D-4)

Lane **m2e-F-C** (supervisor reads your report). Work from `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## The ruling (owner, 2026-11-04) and the server's contract
★M2e-D-4 → "Refuse edits, clone only": a **primer row** (a lorebook of kind `starter_kit` that comes with the pub or a plugin) is read-only; the only way to change it is to clone it. Lane m2e-F-D (in parallel, server) refuses every edit door and marks the row. The mark, already in `src/lib/shared/sockets/types.ts` (F-D's file — read, never edit):
- `lorebooks:list` row and `lorebooks:get` `lorebook`: **`readOnly?: true`** — "Present exactly when this is a primer row (a `starter_kit` with its own provided mark, owner present): every edit is refused; clone it." Its `bookAccess` doc now says: read-only is `bookAccess !== "owner"` **or** `readOnly`.
- The server's sentence (`src/lib/server/plugins/providedMarks.ts` `primerRowEditRefusal(pluginName)`): _This starter lorebook comes with the pub: clone it to make your own._ / _This starter lorebook comes with ‹plugin›: clone it to make your own._ The wire carries NO plugin name today.
**No client-side guessing: the server's mark decides.** Never infer read-only from `kind`, `provided`, the owner or anything else — only `readOnly === true`.

## Goal — what to build
1. **Helper** in `src/lib/client/lorebooks/starterKitCards.ts`, beside `isProvidedBook`:
   - `isReadOnlyBook(book: { readOnly?: unknown } | null | undefined): boolean` → `book?.readOnly === true`. Doc comment `🚧 (m2e-F-C)`: the server's primer-row mark; read-only, clone only; not `isProvidedBook` (Delete only), not a shared book.
   - a function `primerRowLine(pluginName: string | null = null): string` returning exactly the server sentence above. Comment: `⏳ mirrors server primerRowEditRefusal (plugins/providedMarks.ts) until it moves to src/lib/shared; the wire carries no plugin name yet, so callers pass null`. (Name it `primerRowLine`; no constant.)
   - Tests in `src/lib/client/lorebooks/starterKitCards.test.ts`: `isReadOnlyBook` true only for `readOnly: true` (false for `provided`, `kind: "starter_kit"`, `readOnly: false`/absent, null); `primerRowLine()` and `primerRowLine("Mundi")` exact strings.
2. **Clone action** = the existing clone path **`starterKits:clone`** (`{ id: "book:<lorebookId>" }`, admin-only; the server names the copy "‹name› (copy)" when `name` is omitted and answers `starterKits:clone` with `{ kit: Card }` whose `kit.id` is `book:<newLorebookId>`; refusals come on `starterKits:clone:error`, toasted by Layout's catch-all). Do NOT use `lorebooks:duplicate` for a read-only row (it would copy the primer's provided mark).
   - In `src/lib/client/lorebooks/LorebookActions.svelte`, add an exported `cloneStarter(lorebookId: number)` modelled exactly on `saveAsStarterKit` / `handleSaveFromBook` / `handleSaveFromBookError` (~205–235, registered ~505–515): a `pendingClone: number | null` guard (one at a time), emit `starterKits:clone` with `{ id: \`book:${lorebookId}\` }` and no name, and on the answer (only while pending) parse `kit.id` (`book:<n>`) and call the existing `onDuplicated?.(n)` (it opens the new book — the copy is the feedback). **No toast** (views never call `toaster`); on `:error` just clear the pending flag. Check `starterKits:clone` and `:error` are in `src/lib/client/sockets/typedSocket.ts` (they are, ~3843) and how LorebookActions declares its listeners — follow that.
   - Wire it in `LorebooksWorkspace.svelte` the way `makeBookFromOpenKit` calls `actions?.makeBookFromKit` (~1387): a `cloneOpenStarter()` that calls `actions?.cloneStarter(book.id)`.
3. **The open book reads read-only** — `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (~296–330):
   - `let bookIsReadOnlyStarter = $derived(isReadOnlyBook(book))` (comment: the server's primer-row mark, ★M2e-D-4).
   - `let readOnly = $derived(bookAccess !== "owner" || bookIsReadOnlyStarter)` — the existing read-only mode (built for shared books: `book.readOnly` in the bookData context, read by EntryWorkspace, CastWorkspace and the lenses) then hides every write verb. Update the comment above it in one line.
   - Where `readOnly` currently picks the SHARED book's things, keep them for shared books only: `bookMenu` (~1460: `readOnly ? [shared menu] : …` → `readOnly && !bookIsReadOnlyStarter ? …`) and the header subtitle (~2708: `readOnly ? sharedSubtitle : bookIsKit ? kitSubtitle : …` → same guard). Grep every other `readOnly` use in the file and list in your report any that would read wrong for a read-only starter (do not change others unless clearly wrong; ask).
   - `kitMenu` (~1363) for a read-only starter: keep **Book settings** (it opens read-only, item 4), keep **Make a lorebook from it**, add **Clone** (`Icons.CopyPlus`, title _Make a starter lorebook of your own from this one_), and no Delete (already gated by `bookIsProvided`).
   - `kitSubtitle` snippet (~2726): for a read-only starter keep the _Starter lorebook_ badge and replace the sentence with `primerRowLine()` followed by a small tonal **Clone** button (`btn btn-sm preset-tonal-surface`, `CopyPlus` icon, `data-primer-row-clone`) that calls `cloneOpenStarter`; the wrapper must wrap (`flex-wrap`) at phone width. This is the "one line with the way out" (STYLE-GUIDE §6.4 library precedent: one 12px muted note + one action).
   - Pass `readOnly={bookIsReadOnlyStarter}` and `onClone={cloneOpenStarter}` to `<BookSettings>` (~2944).
   - The rail's `onOpenSettings={readOnly ? undefined : openSettings}` stays as is.
   - This file is shared with other lanes' uncommitted hunks: re-read the exact lines right before each edit; additive hunks; never reformat (do not `prettier --write` it).
4. **Book settings** — `src/lib/client/lorebooks/BookSettings.svelte`: new props `readOnly?: boolean` (doc: 🚧 (m2e-F-C) the server's primer-row mark: no edit control is drawn; the way out is Clone) and `onClone?: () => void`. When `readOnly`:
   - do not render `EditLorebookForm`, `BookRulesCard`, `BookWritesCard`, `StoryClockEditor`, `StoryCalendarEditor` (they are edit controls);
   - right under the header row render one line: `<p class="text-surface-600-400 text-xs" data-book-settings-read-only>{primerRowLine()}</p>` plus the **Clone** button (`btn btn-sm preset-tonal-surface`, `CopyPlus`, `data-book-settings-clone`, `onclick={onClone}`), in a `flex flex-wrap items-center gap-2` row;
   - keep "What this book holds" and the "This starter lorebook" card, with **Make a lorebook from it**; the kit card's paragraph "…what you change here reaches the ones started next" must not show for a read-only book (it invites editing) — show nothing in its place;
   - `hasUnsavedChanges` stays false.
5. **Lorebooks list row** — `src/lib/client/components/listItems/LorebookListItem.svelte`: new prop `onClone?: (lorebookId: number) => void`. When `isReadOnlyBook(lorebook)`: no **Book settings** item, no **Duplicate** item, add **Clone** (`Icons.CopyPlus`, title _Make a starter lorebook of your own from this one_, `onSelect: () => onClone?.(lorebook.id!)`, only when `onClone` is given); Delete is already gone (`canDelete`). Other rows unchanged. In `LorebooksWorkspace.svelte` pass `onClone={(id) => actions?.cloneStarter(id)}` on the starter-lorebook group's `LorebookListItem`s (find the group under _Your starter lorebooks_; passing it on every list item is fine too since the item gates on the mark).
6. **Tests** (extend, don't create new files unless needed):
   - `src/lib/client/lorebooks/providedBooks.dom.test.svelte.ts` (BookSettings + list item, by lane C): add — BookSettings with `readOnly` shows the exact line and a Clone button that calls `onClone`, and renders no `EditLorebookForm` (pick a stable marker from that component / its inputs) and no Delete; a `LorebookListItem` with `readOnly: true` offers Clone and no Book settings / Duplicate / Delete in its menu, and one without the mark is unchanged. Read how the file mounts and opens the menu and follow it.
   - `starterKitCards.test.ts` as in item 1.

## Files owned (edit only these)
`src/lib/client/lorebooks/starterKitCards.ts`, `src/lib/client/lorebooks/starterKitCards.test.ts`, `src/lib/client/lorebooks/LorebookActions.svelte`, `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (only the hunks above), `src/lib/client/lorebooks/BookSettings.svelte`, `src/lib/client/components/listItems/LorebookListItem.svelte`, `src/lib/client/lorebooks/providedBooks.dom.test.svelte.ts`.
## Files readable
Anything under `src/`.
## Out of scope
Server and `src/lib/shared/**` (F-D's); NOMENCLATURE/docs/STYLE-GUIDE (the supervisor's); copy beyond the line, "Clone" and the one Clone title above; any change to shared-book behaviour; Duplicate for other rows; the admin Starter lorebooks page; nothing for later.
## Stop and ask (in your report, then stop) when
A change needs a file not listed, a new name beyond `isReadOnlyBook` / `primerRowLine` / `cloneStarter` / `cloneOpenStarter` / `bookIsReadOnlyStarter` / the `readOnly` and `onClone` props, any other copy, or a behaviour change for books WITHOUT the mark.

## Rules you work under (quoted)
- CLAUDE.md P1 "Deterministic, never hidden" and the brief's "No client-side guessing: the server's mark decides."
- CLAUDE.md Sockets ruling: "one domain context per event family … is the only listener, and the only place that toasts; views register listeners for local state and never call `toaster`."
- CLAUDE.md: "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." · "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §10: "Sentence case everywhere" · "A button says what happens" · "Help is one sentence."
- STYLE-GUIDE §6.4 (provided books): "A provided book's row and Book settings offer no Delete … An admin starter kit keeps _Delete starter lorebook_." (admin kits — no mark — keep everything they have.)
- STYLE-GUIDE §9: every control has a name, a focus ring and a 44px target on touch (`min-h-11 pointer-fine:min-h-0` where the codebase does so for small buttons).
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Targeted tests only; never pipe vitest into `head`.

## Done means
One run: `npx vitest run src/lib/client/lorebooks/starterKitCards.test.ts src/lib/client/lorebooks/providedBooks.dom.test.svelte.ts src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts src/lib/client/lorebooks/loreRail.dom.test.ts src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts src/lib/client/lorebooks/deleteCopy.test.ts` (find the exact path of `starterKitsAdmin.dom.test.svelte.ts` with `find src -name`) — all green, counts recorded. `npx prettier --check` on each edited file (report pre-existing failures; your hunks must be prettier-clean). `npx tsc --noEmit -p .` optional; svelte-check is the lead's.

## Report
Write `/home/jody/github/serene-pub/plans/briefs/REPORT-m2e-F-C-w2.md`: changed files and each hunk's purpose, the `readOnly` uses you reviewed (item 3), test command + results, prettier, choices made, Noticed-not-done.
