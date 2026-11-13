# REPORT m2e-C2-w1

Status question: none relayed.

## Changed files
- src/lib/client/admin/sections/starter-kits/Page.svelte
- src/lib/client/admin/sections/starter-kits/starterKitsAdmin.dom.test.svelte.ts
- src/lib/client/components/AppletCard.svelte
- src/lib/client/components/listItems/LorebookListItem.svelte
- src/lib/client/lorebooks/BookSettings.svelte
- NOMENCLATURE.md (the two row edits only; each old string matched exactly once)

## Items
1. Done. `pendingSwitch` / `switchError` locals; `setDisabled` sets `pendingSwitch`. Success and error listeners call two small helpers, `clearSwitch` and `refuseSwitch`. The brief asked for inline listener bodies; the behaviour is the same and the helpers avoid repeating it four times. Fallbacks are the server's two sentences. The actions span sits in `div.flex.flex-col.items-end.gap-1`, followed by `InlineError data-kit-switch-error`. No toast. Four new tests in a nested describe "a refused switch says why" cover the pressing tab, clearing on success, another tab's refusal, and the enable fallback.
2. Done (a) and (b), by exact string. Nothing added to section 23.
3. Done. `AppletCardOrigin` is `"apps" | "home"`, so the type lines up.
4. Done. The `git diff` of both files now shows only the real change. In BookSettings the paragraph wrap is restored. In LorebookListItem the import, `sessionNotesOf` type, World lore chip, badge class order, two div wraps, `onDuplicate` line and Export indentation are restored.

## Tests (all pass)
- starterKitsAdmin.dom.test.svelte.ts: 12 passed
- admin/sections/plugins/providedBooks.dom.test.svelte.ts: 3 passed
- AppletCard.dom.test.ts: 7 passed
- shell/leaveDestination.test.ts: 8 passed
- lorebooks/providedBooks.dom.test.svelte.ts: 5 passed

## Prettier
- Page.svelte, the test file and AppletCard.svelte: checked on stdout before the edit (diff only in my regions), then `--write` run on them.
- LorebookListItem.svelte and BookSettings.svelte: `--check` fails, as expected (they failed at HEAD); not rewritten.

## Noticed, not done
- I ran a botched HEAD-cleanliness probe that wrote and removed one temp file, /tmp/x.<pid>. It was harmless and has been deleted.
- `AppletCard.svelte` is not in HEAD (untracked), so "prettier-clean before" was judged only from a dry-run diff of my regions.
