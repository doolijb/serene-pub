# REPORT m2e-C-w2
Status question: none relayed. All three items done; tests green (192 passed, 8 files).

## Item A — ★50 other rules' lists
Verified the finding (counts loop counts every type; `entries:types` sends only primaryRuleset lists).
- `LorebooksWorkspace.svelte`: `otherRules` state (reset on book open); `handleEntryTypes` reads `otherRules` through ONE narrow cast with `// ⏳ until lane D adds otherRules to the contract (★50)`, remembers the lists (`rememberRulesLists`, `rememberOtherRules`), asks `entries:list` for each; `everyRulesList` (own + other) feeds `drawnRulesLists`, `rulesListDoors` (so rows join `bookPoolItems`/Everything) and the `rulesLists` getter on the BookData (so `PoolMount.svelte` needed no change); `otherRulesGroups` derived for the rail; `lensLineScope` finds facets there too.
- `scopes.ts`: `OtherRulesGroup` type, `otherRulesFacetGroups(groups, counts)` (reuses `rulesListFacets`/`drawsRulesList`; a group with nothing drawn is dropped).
- `LoreRail.svelte`, `ScopePopout.svelte`: new optional prop `otherRulesGroups` drawn after `rulesGroup` (additive, not widening `rulesGroup`, so `loreRail.dom.test.ts` stays untouched). ScopePopout's rules block became an `{#each}` over own + other groups.
- `sections/derivedPiece.ts`: `rememberOtherRules`, `otherRulesNameOf`. `sections/index.ts` `rulesListDoor`: for such a list `creatable:false` and body copy 🚧 "‹Label› comes from ‹Rules›, which this book is not told by. Its entries are listed here; add new ones in a book told by ‹Rules›." (door cache sig includes the rules name).
- Tests: `scopes.test.ts` (groups, empty not drawn), `sections.test.ts` (rows in `bookPoolItems`, no Add, copy, creatable again once own).
New names (all 🚧): `OtherRulesGroup` = a rail group of lists from rules the book isn't told by / not a list the book may add to; `otherRulesFacetGroups` = pure rail-group builder; `rememberOtherRules`/`otherRulesNameOf`/`OTHER_RULES` = per-book mark that makes a door read-only / not a second list registry; `otherRulesGroups` prop; `otherRules` wire field (proposed).
Queued for lane D: add `otherRules?: { rulesName: string; types: <same row as types> }[]` to `Sockets.Entries.Types.Response` and send it from `entries:types` (lists of types the book holds entries of whose rules are not primaryRuleset; with `libraryRows` 0). Until then nothing changes on screen.
Assumption: `otherRules` rows carry `typeId/label/piece/libraryRows` like `types`; an other-rules typeId never also appears in `types`.

## Item B — ★C-1 Leave
- New `src/lib/client/shell/leaveDestination.ts` (🚧 `leaveDestination(from, appsRegistered)` → "apps"|"home"|"sessions"; `AppletCardOrigin`) + `leaveDestination.test.ts` (8-row table).
- `AppletCard.svelte`: required `from` prop; `onclick` on plain left click (button 0, no modifiers, not already prevented) -> `goto(href, { state: { appletFrom: from } })`; href kept.
- Callers: `AppsSidebar.svelte` `from="apps"`, `src/routes/+page.svelte` `from="home"`.
- `apps/[pluginId]/+page.svelte` `leave()`: reads `page.state.appletFrom`; Apps registered = `"apps" in panelsCtx.rightNav` (Layout.svelte:959 registers it only while an applet is listed); home -> `goto("/")`; apps/sessions -> existing `openAfterLeaving`. Esc uses `leave()`.
- Choice: state key is `appletFrom`, NOT `from`, because `App.PageState.from` ("dock"|"half", app.d.ts) is Focus's. `App.PageState` has no `appletFrom`, so the card casts and the page reads through a cast; adding it to `src/app.d.ts` is out of my files (see Noticed).
- Edited outside the list (required by the new prop/goto): `src/lib/client/components/AppletCard.dom.test.ts` (passes `from`, mocks `$app/navigation`, +1 click test).

## Item C — ★E-2 Advanced fold: no change
Both deriver sites (`settingsForm.ts:277` genre fields, `:667` routine fields) feed the same `Form`, whose only client consumer is `SessionSettingsForm.svelte` (mounted by `EditSessionForm.svelte:2743`). It draws `splitAdvanced(fields)` (`sessionSettingsForm.ts:100`) per group: `fieldList` snippet `SessionSettingsForm.svelte:134-165`, closed `<details>` last, only when `parts.advanced.length`, "Advanced · N settings". `PipelineConfigOptions.svelte:2646` and `SchemaForm.svelte:536` draw their own advanced folds likewise. `sessions:stepSettings` is declared in `typedSocket.ts:1677` but has no client caller.

## Tests
`npx vitest run` sections.test, scopes.test, viewRoutes.test, leaveDestination.test, AppletCard.dom.test, loreRail.dom.test, lorebooksWorkspace.counts.dom.test, sessionSettingsForm.dom.test: 8 files, 192 passed. Prettier: derivedPiece.ts, AppletCard.svelte/.dom.test.ts formatted and clean; the other touched files (scopes.test, sections.test, sections/index.ts, ScopePopout, LorebooksWorkspace, apps page, routes/+page) were already failing prettier at HEAD (pre-existing, not reformatted).

## ★ open
- ★ Add `appletFrom?: "apps" | "home"` to `App.PageState` in `src/app.d.ts` to drop the two casts (recommended; one line).
- ★ Copy of the foreign-door sentence is proposed (🚧).

## Noticed, not done
- SessionSettingsForm summary says "Advanced · N settings" without "· M changed" (STYLE-GUIDE §6.17 wording); no test covers its fold (ungrouped/none) in `sessionSettingsForm.dom.test.ts`.
- Home leave with open views: `goto("/")` leaves whatever the shell had open; not investigated.
