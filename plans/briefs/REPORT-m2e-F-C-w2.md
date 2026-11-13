# REPORT m2e-F-C-w2 — primer rows read-only, client half

Status question: none relayed.

## Changed files and hunks
- `starterKitCards.ts`: `isReadOnlyBook` (`readOnly === true` only), `primerRowLine(pluginName = null)` (server sentence; "the pub" when null).
- `starterKitCards.test.ts`: both helpers, exact strings.
- `LorebookActions.svelte`: exported `cloneStarter(lorebookId)` + `pendingClone` guard, `handleCloneStarter` (parses `kit.id` `book:<n>`, calls `onDuplicated?.(n)`, no toast), `handleCloneStarterError` (clears flag); two `useInterest` registrations (`starterKits:clone`, `:clone:error`; both keys already in typedSocket).
- `LorebooksWorkspace.svelte`: import; `bookIsReadOnlyStarter`; `readOnly = bookAccess !== "owner" || bookIsReadOnlyStarter`; `kitMenu` gets **Clone** (only when marked); `cloneOpenStarter()`; `bookMenu` and header `subtitle` shared-branches guarded with `&& !bookIsReadOnlyStarter`; `kitSubtitle` shows badge + `primerRowLine()` + Clone button (`data-primer-row-clone`) for a marked book, wrapper `flex-wrap`; `<BookSettings readOnly onClone>`; `onClone` on the "Your starter lorebooks" `LorebookListItem`.
- `BookSettings.svelte`: props `readOnly`, `onClone`; when read-only the line + Clone row replaces EditLorebookForm / BookRulesCard / BookWritesCard / StoryClockEditor / StoryCalendarEditor; the kit paragraph is hidden; holds-readout and Make-a-lorebook kept; no Delete (isProvided).
- `LorebookListItem.svelte`: prop `onClone`; marked row: no Book settings, no Duplicate, Clone added (only when `onClone` given); Delete already gone via `canDelete`.
- `providedBooks.dom.test.svelte.ts`: BookSettings read-only (line, Clone calls onClone, no form/input, no kit paragraph, no Delete), unmarked unchanged; list item menu marked vs unmarked.

## `readOnly` uses reviewed in LorebooksWorkspace
- bookMenu, header subtitle: guarded as briefed.
- **`{:else if route.settings && readOnly}` (shared-book Lock empty state) would have read wrong** (it hid Book settings for a primer row, contradicting item 4). Changed to `readOnly && !bookIsReadOnlyStarter` (clearly wrong otherwise; shared books unchanged).
- bookData context `readOnly` getter (~789): now true for a primer row, which is the intended mechanism (hides write verbs in lenses).
- `canShare` (`!readOnly`), `primaryAction` (`!readOnly && !bookIsKit`), rail `looseEndsCount`/`onOpenSettings`, `onSetPresent`: all read right (no Share, no loose ends, no settings in rail; the rail's settings entry is gone by brief, the book's `⋯` Book settings still opens it).
- `bookEmpty && readOnly` -> "This book is empty." reads fine for an empty primer row.

## Tests
`npx vitest run` the six listed files: 6 files, 57 tests, all passed. (After a final prettier --write of the test file, providedBooks re-run green.)

## Prettier
Clean: starterKitCards.ts/.test.ts, providedBooks.dom.test.svelte.ts (written with prettier; the file was untracked, it is lane C's, my hunks included). `LorebookActions.svelte`, `BookSettings.svelte`, `LorebookListItem.svelte` fail prettier on HEAD too (pre-existing); `LorebooksWorkspace.svelte` also reports issues (not formatted, as briefed). My hunks follow the file's style.

## Choices
- `primerRowLine` outputs "the pub" for null (the server's sentence), plugin name verbatim otherwise.
- Clone is added to the kit menu only for a marked book (an admin kit's menu is unchanged).
- The list-item Clone is passed only on the starter-lorebook group.
- `cloneStarter` ignores an answer whose `kit.id` isn't `book:<n>` (still clears pending).

## Noticed, not done
- I tried a `rm -rf /tmp/serene-pub-vitest-*` cleanup; the sandbox refused (glob), so I removed nothing. I don't know which dirs, if any, my run left.
- Primer rows from the starter-lorebook picker group elsewhere (not the Lorebooks list) are not touched.
