# REPORT vl-A — Variable layouts: admin pages and preset form — 2026-11-10

Saved by the lead from the supervisor's hand-back (subagents can't write report files).

**Status:** W1, W2, W3, W6, redirects and nav built. 9 lane test files / 52 tests pass. `tsc` and `svelte-check` (8 GB cap, completed) show nothing in lane files (1 project error in `sessionForms/startSessionAdvanced.dom.test.svelte.ts`, not ours). Scope review: no objection; three low findings fixed (owner-slug rule now imports `OWNER_SLUG` from `canvas/draft.svelte.ts`; `pipelines:templateVariableLayouts` uses the global registry; copies named *‹name› (copy)*).

## Changed files

New: `src/lib/client/admin/sections/variable-layouts/{Page,VariablePage,VariableLayoutForm,NewLayoutPage,LayoutPage,LegacyIdRedirect}.svelte`, `variableLayoutsSockets.ts` (⏳ typed bridge with casts), `variableLayoutWords.ts` + test, tests `variableLayoutsPage.dom.test.svelte.ts`, `variablePage.dom.test.svelte.ts`, `variableLayoutForm.dom.test.svelte.ts`, `TemplateEditorStub.svelte` (test-only); `src/lib/client/components/admin/VariableLayoutPreview.svelte`; `src/lib/client/admin/sections/session-presets/PresetVariableLayouts.svelte` + `presetVariableLayouts.dom.test.svelte.ts`.
Edited: `admin/adminRoutes.ts` (+ test), `shell/adminNav.ts` (one item), `components/admin/TemplateChangeForm.svelte` + `TemplateChangelist.svelte` (`kind` narrowed to `"context"`), `session-presets/IdPage.svelte` (~50 lines: fieldset, dirty, Save sends preset then layout writes in order), `session-presets/Page.svelte`, `presetsAdmin.ts` + test (status `layouts`, *Variable layout missing*).
Deleted: `admin/sections/variable-templates/{Page,NewPage,IdPage}.svelte`.

## Tests

`npx vitest run src/lib/client/admin/sections/variable-layouts/ src/lib/client/admin/adminRoutes.test.ts src/lib/client/admin/sections/session-presets/`: 9 files, 52 pass (W1 reasons/+N preset/filter/?step=/no Add; W2 Use this/In use/Back to the default/delete refusal in place, no toast/empty variable; W3 reference fixed after save/debounced preview kind variable/switch off + counted sentence/create sends reference + useEverywhere false; W6 add/remove/declared as words/dangling; redirects).

## Requests (routed by the lead to vl-F)

1. `Layout.svelte` `HANDLED_ERROR_EVENTS` += `pipelines:libraryVariables:error`, `:libraryVariable:error`, `:librarySetPubLayout:error`, `:libraryUseEverywhereCounts:error`, `:presetVariableLayouts:error`, `:setPresetVariableLayout:error`, `:stampVariableTemplateReference:error`, `:libraryDeleteTemplate:error`, `:templateVariableLayouts:error`.
2. `typedSocket.ts` `SocketEventMap` entries (+ `:error`) for `pipelines:libraryVariables`, `:libraryVariable`, `:librarySetPubLayout`, `:libraryUseEverywhereCounts`, `:presetVariableLayouts`, `:setPresetVariableLayout`, `:stampVariableTemplateReference`; then drop the casts in `variableLayoutsSockets.ts`.
3. W6 picker: `pipelines:presetVariableLayouts` should return `candidates: variableId[]` (the variables this preset's pipelines render); today it offers every variable with a layout.
4. W1: `VariableLayouts.ListRow` should carry `key` (first scope root); W1 shows the variable id today.
5. Server `referenceOf` (`entities/variableTemplates.ts` ~308) accepts `core` as a person's owner slug; refuse it as the client does.
6. `src/lib/shared/adminLogbook.ts:81` links `/admin/variable-templates/<id>` labelled "variable template" (redirect covers it).

## ★ and decisions

- ★A W1 shelves are a **Shelf** facet filter with rows in shelf order, no visible headings (`AdminChangelist` has no grouping). Accept, or add `groupBy` to `AdminChangelist`.
- ★B W6 edits wait for Save (STYLE-GUIDE §6.11): *Waiting for Save* / *Removed — waiting for Save* with **Put back**; Save sends each in order.
- ★C **Duplicate** and **New layout** open W3 at `/new?from=<id>` prefilled (*‹name› (copy)*), not the clone socket (§6.11).
- ★D presets changelist status *Variable layout missing* (warning dot) after *Binding unavailable*.
- ★E the new views raise no toasts.
- Inside scope: **Use it everywhere** only on a new layout; **Referenced as** required when saving an older row without one; owner slug prefilled from the newest person's layout with a reference; Language a select on new, words on existing; W1's step words from the library's pipeline and step labels.

## New labels and names (for vl-N)

Components `VariableLayoutPreview`, `VariableLayoutForm`, `PresetVariableLayouts`, `LegacyIdRedirect`, `NewLayoutPage`, `LayoutPage`; modules `variableLayoutsSockets` (⏳), `variableLayoutWords`.
Nav/page **Variable layouts**; purpose *How each variable is written out. One choice for the whole pub.*
W1: **Variable**, **Supplied by**, **Written as**, **Layouts**, filter **Shelf**; *‹name› · chosen for this pub*, *‹name› (automatic)*, *As written*, *+ N preset(s)*; *Showing the variables ‹step› writes out.*, **Show all**.
W2: *Supplied by ‹supplier›.*, *Chosen for this pub.*, **Back to the default** *(‹name›)*, **New layout**; **Example value**, **Variable layouts**; Name/Owner/Preview/Status/Actions; **In use**, **Use this**, **Duplicate**, **Edit**, **Delete**, *Named by N context template(s)*, *Chosen by the ‹A and B› preset(s)*; *As written — Written exactly as the pipeline gives it: this variable has no variable layout yet.*; **All variable layouts**; **Show all**/**Show less**, *No preview.*, *The preview could not be written: …*
W3: **New variable layout**; **Variable layout**, **Source** (**Preview**), **Use it everywhere**; **Name**, **Referenced as**, **Owner slug**, **Name to reference it by**, **Language**; *Fixed once saved, so templates that name it keep working.*; *Fixed once made: storing text under another language does not translate it.*; *Written against the variable's example value.*; *Every template that writes {{{key}}} without naming a variable layout uses this one: N pipelines, M templates.*; *Left off, it is offered on the variable's page with Use this.*; *A variable layout needs a name.*; *There is no variable layout ‹id› for ‹label›.*
W6: **Variable layouts**; *Uses the pub's layout for every variable.*; **Change a variable's layout**, **Remove**, **Put back**, **Cancel**, **Give it a reference**; **Variable**; *Waiting for Save*, *Removed — waiting for Save*, *(pub's: …)*, *the pub's*, *Give it a reference to pick it.*; *This preset ships with Serene Pub or a plugin, and updates replace it. Clone it to change its variable layouts.*; *‹variable› names ‹reference›, which no variable layout goes by now. The pub's layout is used.*
Presets status *Variable layout missing*.

## Noticed, not done

- W3 drops the `warnings` create/update answers carry (no toast; the save leaves the page).
- `config/panel/read.ts` `variableTemplateRow` dead.
- `AdminDeleteConfirm` reads **Delete variable layout** (singular).
- `IdPage.svelte`'s existing `onError` uses `notify.error` (pre-existing).
- W6 requests `pipelines:library` only to prefill an owner slug.
- W6's DOM test stands in a plain `<select>` for `Select.svelte` (portal).
