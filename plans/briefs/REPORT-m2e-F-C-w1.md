# REPORT m2e-F-C-w1

Status question: none relayed.

## Changed
- `src/lib/client/lorebooks/sections/derivedPiece.ts`: `OTHER_RULES` is `SvelteMap<number, Map<string,string>>`; `rememberOtherRules(lorebookId, groups)` sets a fresh inner Map (empty groups store an empty map); new 🚧 `forgetOtherRules(lorebookId)`; `otherRulesNameOf(typeId, lorebookId)` returns undefined with no book id; doc comment updated.
- `sections/index.ts`: `rulesListDoor(list, lorebookId)`, cache keyed `${lorebookId}:${typeId}`; `rulesListDoorOf(typeId, lorebookId?)`; `descriptorFor(scope, lorebookId?)`. `descriptorForKind` unchanged.
- `lenses/PoolMount.svelte`: passes `book.lorebookId` to both calls.
- `LorebooksWorkspace.svelte`: import `forgetOtherRules`; `rememberOtherRules(id, others)` in `handleEntryTypes`; `rulesListDoor(list, openBookId)`; plain `let heldOtherRulesBook` (set in handleEntryTypes, forgotten in the `whenBookOpens` callback when it differs from the new id, and in `onDestroy`).
- `IdPage.svelte`: `listShows` takes `res: unknown` (svelte-check fix).
- Tests: `sections.test.ts` (book ids passed, new per-book test incl. `descriptorFor(listScope(...), id)` and `forgetOtherRules`); `derivedEntryEditor.dom.test.svelte.ts` (`rulesListDoor(WEAPONS, 1)` x4). derivedPiece.test.ts and scopes.test.ts needed no change.

## Tests
The brief's single vitest command: 7 files passed, 175 tests passed.

## Prettier
Fails on index.ts, PoolMount, LorebooksWorkspace, sections.test.ts, IdPage. Checked the diffs for index.ts, PoolMount and IdPage: every complaint is on a line I did not touch. derivedPiece.ts and the dom test pass. I did not diff-check LorebooksWorkspace or sections.test.ts (the brief says the former was already dirty; the latter's long import line was already there).

## Choices
- Empty groups store an empty map, not a delete.
- One variable `heldOtherRulesBook` serves both the "previous book" and "last remembered" roles.
- Reset to null after forgetting in the whenBookOpens callback.

## Noticed, not done
None.
