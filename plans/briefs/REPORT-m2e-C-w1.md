# REPORT m2e-C-w1 (2026-11-04)

Status question: none relayed.

## Per item
1. **Delete gone from provided books.** `starterKitCards.ts` new `isProvidedBook(book)` (true when the server's `provided` is present). `LorebookListItem.svelte` (`canDelete` gates the row menu's Delete + separator); `BookSettings.svelte` new prop `isProvided` hides both "Delete starter lorebook" and "Delete “name”"; `LorebooksWorkspace.svelte` only Delete lines: `bookIsProvided` derived, kitMenu and book menu Delete entries gated, `isProvided` passed to BookSettings. Admin kits (not `provided`) unchanged. A primer row is kind `starter_kit` + `provided` => no Delete (tested). `LorebookActions.svelte` needed no change (its confirm only opens from the Delete lines above). `libraryRows.ts`: no delete there.
2. **Plugin page** `IdPage.svelte`: `Draft.booksOff` (slug -> disabled) is an unsaved edit; Save adds one `awaitReply` step per changed book (`plugins:disableProvidedBook`/`enableProvidedBook`, reply `plugins:list`, matched on that book's `disabled`). Switch: native `role="switch"` checkbox, `aria-label="Enabled: name"`, label `title`, visible Enabled/Disabled. No `dismissed` handling existed in the client (nothing to drop).
3. **Starter-kits `Page.svelte`**: asks `starterKits:list` with `{includeDisabled:true}`; rows with `provided` get the switch (acts when pressed, emits `{pluginId, slug}` from `row.provided`); the DOM checkbox is put back until the server's re-send changes the row, so it never shows a stale state. Declared interest on the two events and their `:error`s (no-op handlers, no toast). Primer rows: Clone only, no Delete.
4. **Picker**: nothing assumed a `primer:` id outside `refOfCard` (which handles `book:<id>` as `{lorebookId}` and still `primer:`). No change; only the `kitBookId` doc comment updated.
5. **Stale copies** (all listen to the server's `lorebooks:list`, no client filtering): `LorebooksWorkspace.svelte:2576` (standing, plus emit 2607) · `EditSessionForm.svelte:1553` (emit 1558) · `SummarizeLoreModal.svelte:736` (+ requestWithInterest 752) · `StartSessionForm.svelte:229` (requestWithInterest, handler lives while mounted) · `CharacterForm.svelte:996` (emit 1054). No change needed.
6. **navigation.ts**: `src/lib/shared/sessions/declaredFieldRefusal.ts` does NOT exist (checked at end); nothing changed.

## Choices
- Disabled state in IdPage is a `Record<slug, boolean>` in the existing Draft (rides the existing `UnsavedEdits`).
- `typedSocket.ts`: added the two events (shared `SetProvidedBookDisabled` type had landed) and their `:error`s.

## New names
- `isProvidedBook` (client helper: row carries the server's `provided`; not "disabled", not admin kit). `isProvided` (BookSettings prop). `bookIsProvided` (Workspace derived). `canDelete` (list item derived). `booksOff` (IdPage draft field: slug -> disabled; unsaved edit). `data-kit-switch` (test hook).

## ⏳ local types (not yet in shared types)
`StarterKits.Card.provided` (Page.svelte `Row` intersection) and `StarterKits.List.Params.includeDisabled` (cast), both marked in Page.svelte. Everything else read the real types.

## Tests
- `npx vitest run` on starter-kits, plugins dir, lorebookForms, new lorebooks test: 10 files, 48 passed. Earlier run also `starterKitCards.test.ts`, `deleteCopy.test.ts`, `navigation.test.ts`: 69 passed, 4 failures were only my new test lacking socket mocks (fixed; now 5/5).
- New: `plugins/providedBooks.dom.test.svelte.ts` (3: switch words/title, unsaved until Save, disable and enable events), `lorebooks/providedBooks.dom.test.svelte.ts` (5: no Delete on provided / provided kit, Delete stays on ordinary book and admin kit), 3 added to `starter-kits/starterKitsAdmin.dom.test.svelte.ts`.
- Prettier: new test files and Page.svelte formatted; `IdPage.svelte`, `LorebooksWorkspace.svelte`, `typedSocket.ts` were already failing prettier before my change (left alone).

## Open ★
None.

## Noticed, not done
- The server's standing `starterKits:list` re-send must honour the asker's `includeDisabled` or the admin page loses disabled rows after a re-send (lane D to confirm).
- `LorebooksWorkspace` has no unit test of the menu Delete gating (only BookSettings + helper tested).
- `navigation.ts` still mirrors the refusal sentence until lane D lands `declaredFieldRefusal.ts`.

## Queued for lane D
- Add `provided?` to `StarterKits.Card` and `includeDisabled?` to `StarterKits.List.Params` in shared types, then drop the two ⏳ casts in Page.svelte.
- Land `declaredFieldRefusal.ts` so `navigation.ts` can import it.
