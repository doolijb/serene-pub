# REPORT m2e-F-C — final client/docs items from the 2026-11-04 evening rulings

(Saved by the lead from the supervisor's hand-back.) **BUILT**; one grouped targeted run 11 files / 211 pass. Worker briefs/reports `plans/briefs/{BRIEF,REPORT}-m2e-F-C-w{1,2,3}.md`.

## Queued for lane F-D (sent by the lead)
1. The plugin's name is not on the wire: the row carries only `readOnly?: true`, so the client line always says "the pub". Proposal `readOnly?: { pluginName: string | null }` or a sibling field; client then passes it to `primerRowLine`.
2. Move `primerRowEditRefusal` to `src/lib/shared` so the client imports it; until then `starterKitCards.ts` `primerRowLine` is a ⏳ copy.
3. NOMENCLATURE §25: the "⚠ What the layering build left in the interface copy" paragraph sits inside the table and breaks it; rows after it (lane D2's and this lane's) render as plain text — the lead moves it below the last row.

## Changed files
- **★D3-1:** `lorebooks/sections/derivedPiece.ts` (`OTHER_RULES: SvelteMap<number, Map<string,string>>`; `rememberOtherRules(lorebookId, groups)`; 🚧 `forgetOtherRules(lorebookId)`; `otherRulesNameOf(typeId, lorebookId)`) · `sections/index.ts` (`rulesListDoor(list, lorebookId)` cache keyed `${lorebookId}:${typeId}`; `descriptorFor(scope, lorebookId?)`; `descriptorForKind` unchanged) · `lenses/PoolMount.svelte` (passes `book.lorebookId`) · `LorebooksWorkspace.svelte` (remembers by the reply's book id; `heldOtherRulesBook` forgets on switch in `whenBookOpens` and on destroy) · tests `sections.test.ts` (book ids + two-book test), `sections/derivedEntryEditor.dom.test.svelte.ts`.
- **Primer rows read-only (client):** keyed only on F-D's `readOnly === true` (`lorebooks:list` row, `lorebooks:get`). `starterKitCards.ts` (`isReadOnlyBook`, ⏳ `primerRowLine(pluginName = null)`) · `LorebookActions.svelte` (`cloneStarter(lorebookId)` → `starterKits:clone { id: "book:<id>" }`, one at a time, opens the copy via `onDuplicated`, no toast) · `LorebooksWorkspace.svelte` (`bookIsReadOnlyStarter`; `readOnly = bookAccess !== "owner" || bookIsReadOnlyStarter`; the shared-book menu/subtitle/Lock state gate on `readOnly && !bookIsReadOnlyStarter`; `kitMenu` gains Clone; `kitSubtitle` shows the badge, the sentence and a tonal Clone `data-primer-row-clone`; BookSettings gets `readOnly` + `onClone`) · `BookSettings.svelte` (one line + Clone replace the five editors; readout and "Make a lorebook from it" stay) · `listItems/LorebookListItem.svelte` (a marked row offers Clone; no Book settings/Duplicate/Delete) · tests `starterKitCards.test.ts`, lorebooks `providedBooks.dom.test.svelte.ts`.
- **Vocabulary/docs:** `NOMENCLATURE.md` §23 retires `dismissed` (~1581); §25 four tail rows (`forgetOtherRules`; the read-only mark + client names/copy; F-D's `primerRowEditRefusal`/`primerRowEditProblem`; **Writing** (was Reply) / **Lair** (was Story) with the R1 clash); the "genre field group strings" row amended in place ("ruled 2026-11-04"; "Rules" dropped — see ★F-C-4). `STYLE-GUIDE.md` §6.4 "A primer row" (~1142). `docs/lorebooks.md` (~260 bullet; ~277 "has Clone instead"). `docs/plugins.md` unchanged.
- **Item 4:** `admin/sections/plugins/IdPage.svelte` `listShows(res: unknown)` fixes the 304:7 error. `EntryWorkspace.svelte:670,672` is the story-playtest programme's (`(0142)` comment; guarded at ~671). `connections/finder.dom.test.svelte.ts` ×7 = playtest2's model finder (`QuantPicker`, `AddModelByName`, briefs `BRIEF-playtest2-C-w2/-w3/-C2`). `loadouts/loadoutSheet.test.ts` ×2 = **M2e's own ★47** (★F-C-3).

## Tests
Grouped 11 files 211/211 (`sections`, `scopes`, `derivedPiece`, `derivedEntryEditor.dom`, `starterKitCards`, lorebooks `providedBooks.dom`, `lorebooksWorkspace.counts.dom`, `loreRail.dom`, `deleteCopy`, plugins `providedBooks.dom`, `starterKitsAdmin.dom`); `tsc` lane files clean after one `as any` at `starterKitCards.test.ts:64`; `docs:build` exit 0; prettier clean on the new files, the rest already failing before.

## New names (🚧, rows written)
`forgetOtherRules` · `isReadOnlyBook` · ⏳ `primerRowLine` · `cloneStarter` · `cloneOpenStarter`, `bookIsReadOnlyStarter` · BookSettings `readOnly`/`onClone` · LorebookListItem `onClone`.

## Open ★
- **★F-C-1** Clone uses `starterKits:clone` (admin kit "‹name› (copy)", opens the copy; admin-only, fine since primer rows are an admin's); `lorebooks:duplicate` rejected (copies the provided mark). **Lead: accept.**
- **★F-C-2** the Clone item's title _Make a starter lorebook of your own from this one_. **Lead: accept.**
- **★F-C-3** `loadoutSheet.test.ts` fixture after ★47: add a `sampling-reply` _Reply_ option and expect "…so sampling is now Reply." **Lead: done.**
- **★F-C-4** "Rules" dropped from the field-group list (no core-catalog `group:` uses it). **Lead: checked against the SDK too — see the plan tail.**

## Noticed, not done
w2 attempted the forbidden `rm -rf /tmp/serene-pub-vitest-*` glob (sandbox refused; nothing deleted) · the door cache `rulesListDoors` only grows (one entry per book visited) · doors from `descriptorForKind` carry no book (EntryWorkspace/LoreRail/TimeLens; empty-copy body says "one of this book's rules lists") · a primer row keeps "Make a lorebook from it" · no unit test for the workspace header/menus of a primer row; not walked in a browser.
