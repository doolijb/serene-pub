# REPORT — ui-borders worker 2 (2026-11-12)

Status question: none relayed. Implementation done; no vitest, no `npm run check`. Paths below are under `src/lib/client/`.

## 1. Changes (old → new; ground)
**components/sidebars/ConnectionsSidebar.svelte**
- `NEXT_STEP_EDGE` values: `border-primary-500/30!` / `border-error-500/30!` / `border-success-500/30!` → each prefixed `border ` (signal edges kept).
- Models section (`id="api-connection-models"`): `panel-card flex flex-col gap-2` → added `[&_.panel-card]:bg-surface-50-950`. Only `panel-card` descendant is `ModelRow` (`ModelTable` and `PanelFilterInput`/`EmptyState` have none; checked ModelTable.svelte, ModelRow.svelte).
- "Advanced and notes" `<details>` (~1208): `group panel-edge rounded-lg border` → `group bg-surface-100-900 rounded-lg`. Ground: sidebar `50-950`. `endpointSettings` is rendered in the Settings tab panel / `OnnxEndpointView` settings tab / bare (ConnectionsSidebar ~1970, 2008; OnnxEndpointView.svelte:536), none with a fill.
- Add-by-name `<form>` (~1887): `panel-edge flex flex-col gap-2 border-t pt-2` → `flex flex-col gap-2` (parent section already `gap-2`).

**components/sidebars/HelpSidebar.svelte** ~664 `nav`: `border-surface-200-800 mt-8 grid grid-cols-2 gap-3 border-t pt-4` → `mt-8 grid grid-cols-2 gap-3`.

**components/sidebars/ActivitySidebar.svelte** ~1018: nested inner `<div class="divide-surface-200-800 divide-y">` → `<div>`. Outer `divide-y` (~1015) kept.

**components/sidebars/SamplingValuesForm.svelte** ~304: `border-primary input w-24 …` → `border-surface-200-800 input w-24 …` (see section 6, form-control conflict).

**components/connections/ModelFinderView.svelte**: both `<div class="panel-card flex flex-col gap-2">` (`resultRow`, `hubResultRow`) → added `[&_[data-quant-picker]]:bg-surface-50-950`.

**components/connections/DownloadsTray.svelte** ~54: `panel-edge bg-surface-100-900 … border` → `bg-surface-100-900 …` (no `panel-edge`, no `border`). Ground: its only caller `ModelsListView.svelte:572` wraps it in a sticky div with no fill, in the sidebar list pane = `50-950`.

**components/connections/ConnectionCapabilities.svelte** ~221: `border-b border-dotted` (colourless) → added `border-surface-300-700`. Judgement: a dotted underline hint on "Assumed" text, so I used `300-700` rather than the hairline so the cue still reads. Say if you want `200-800`.

**components/connections/ConnectionIndexView.svelte** ~653: `<hr class="panel-edge my-1" />` removed (parent `flex flex-col gap-2`).

**components/connections/ConnectionStopScripts.svelte** ~81: `border-surface-200-800 … rounded-lg border px-2 py-1` → `bg-surface-50-950 … rounded-lg px-2 py-1`. Ground varies by call site: ConnectionsSidebar.svelte:1418 inside `connectionFormExtras` (in the Advanced details, now `100-900`, so `50-950` reads; but also rendered bare via `connectionFormBody` ~1348, `50-950`, where it will not read); Admin `IdPage.svelte:1113` inside `AdminFieldset` (`panel-card`, `100-900`, reads). **Mixed ground.**

**components/connections/comfy/ComfyDrawTest.svelte** ~188 (progress box, `border-surface-500/20 … border`): fill-less, so move 3 → `bg-surface-100-900 rounded-lg p-2 text-xs`. Ground: callers ImageConnectionForm.svelte:319 (sidebar `50-950`) and `WorkflowEditorDialog.svelte:280` (dialog; ground not traced, may be `100-900` where the box then would not read). **Mixed ground.**

**connectionForms/OllamaForm.svelte** ~265: `bg-background border-muted` → `bg-background border-surface-200-800` (`.input`).
**connectionForms/LlamaCppForm.svelte** ~224: same swap (`.input`).

**connectionForms/ImageConnectionForm.svelte**
- ~270 (separator): `class={embedded ? "mt-6" : "border-surface-500/20 mt-5 border-t pt-4"}` → `class="mt-6"`.
- ~296 info `<p>`: `border-surface-500/20 … rounded border p-2` → `bg-surface-100-900 … rounded p-2`.
- ~358 progress box: `border-surface-500/20 rounded-lg border p-2` → `bg-surface-100-900 rounded-lg p-2`.
- Ground for both: ConnectionTypeForm, used at ConnectionsSidebar.svelte:1367 (`50-950`) and Admin `IdPage.svelte:840` inside `AdminFieldset` (`panel-card`, `100-900`). **Mixed ground**; I chose `100-900` for the sidebar. In Admin these two boxes will not read (text stays legible).

**connectionForms/KoboldCppManagedForm.svelte** ~289: `<hr class="border-surface-200-800" />` removed (parent `space-y-4`).

**components/loadouts/LoadoutsGrid.svelte**: group header `border-surface-200-800 mb-2 flex … border-b pb-1` → `mb-2 flex items-center gap-2`; default tile `border-primary-500/40!` → `border border-primary-500/40!`.

**components/loadouts/sheet/ModelCard.svelte** ~197 chosen box: `border-surface-200-800 … rounded-container border px-3 py-2.5` → `bg-surface-50-950 … rounded-container px-3 py-2.5`. Ground `100-900`: root `<section class="panel-card …">` at ModelCard.svelte:124.

**components/audiocppManager/AudioCppModelsTab.svelte** ~200 `li`: `border-surface-200-800 … rounded-md border p-2` → `bg-surface-100-900 … rounded-md p-2`. Ground `50-950`: component root `flex flex-col gap-4 p-3` has no fill; only caller `ManagedConnectionView.svelte:1383`, in a plain tab panel.

**components/koboldcppManager/KoboldCppBinaryVariantPicker.svelte** ~373 "Selected:" box: `border-surface-200-800 mt-1 rounded-lg border p-3` → `bg-surface-100-900 mt-1 rounded-lg p-3`. Ground `50-950`: callers `ManagedConnectionView.svelte:1266` and `SetupChatFlow.svelte:277` are plain scroll wrappers, no fill.

## 2. Borders kept
- `components/sidebars/TagsSidebar.svelte` ~772 (`border-primary-500 bg-surface-50-950 rounded-lg border p-4`): unchanged as briefed. Its parent is `<div class="flex flex-col gap-3">` (~742) on the bare sidebar ground, `50-950`. So the fill equals the ground and only the gold edge shows it off; question for the supervisor.
- ConnectionCapabilities.svelte:192 `<fieldset … border>` (fieldset); ComfyDrawTest.svelte:232 and ImageConnectionForm.svelte:381, 408 (thumbnail/image frames); ModelFinderView.svelte:1370, 1422, 1484 and ConnectionIndexView.svelte:501 (popover cards); KoboldCppManagedForm.svelte:198 (`border-warning-500 … border`, warning edge); LlamaCppForm.svelte:194 (`border-error-500`, error state); KoboldCppBinaryVariantPicker.svelte:344 (selectable option rows with `border-primary-500` selected edge and radio mark at 351; not in my brief); ActivitySidebar outer `divide-y` and other row dividers.

## 3. Sites not changed
- TagsSidebar ~772 (above).
- SamplingValuesForm ~304, OllamaForm ~265, LlamaCppForm ~224 were changed (colour only), see section 6.

## 4. Chips and pills seen and left
Not enumerated. Only the `Badge` in ModelCard.svelte (~210) and the "Assumed" label (changed above, not a chip) were seen.

## 5. Tests rendering touched components (for the supervisor)
`connectionForms/connectionForms.dom.test.svelte.ts`, `components/audiocppManager/AudioCppModelsTab.dom.test.svelte.ts`, `components/connections/finder.dom.test.svelte.ts`, `finderViews.ssr.test.ts`, `indexRows.ssr.test.ts`, `firstRunDoors.ssr.test.ts`, `admin/sections/connections/comesWithApp.dom.test.svelte.ts`, `modelLeversSave.dom.test.svelte.ts`, `components/sidebars/connectionsList.dom.test.svelte.ts`, `samplingFirstOpen.dom.test.svelte.ts`, `samplingValuesChoose.dom.test.svelte.ts`, `activitySidebar.indexing.dom.test.svelte.ts`, `logitBiasField.dom.test.svelte.ts`, `shell/railViews.test.ts` (all under `src/lib/client/`).

## 6. Assumptions; Noticed, not done
- Prettier: I ran `prettier --write` on ConnectionsSidebar.svelte and ModelFinderView.svelte (single files; they were clean before and my longer class strings needed it; diffs are class-only). The other edited files already fail `prettier --check` (probably before my edits; I did not reformat them, to keep the diff to class strings). Failing: HelpSidebar, ActivitySidebar, DownloadsTray, ConnectionCapabilities, ConnectionIndexView, ComfyDrawTest, OllamaForm, LlamaCppForm, ImageConnectionForm, KoboldCppManagedForm, LoadoutsGrid, ModelCard, AudioCppModelsTab. TagsSidebar, SamplingValuesForm, ConnectionStopScripts and KoboldCppBinaryVariantPicker pass.
- Conflict: the common rules say never touch form controls, but the brief lists SamplingValuesForm ~304, OllamaForm ~265 and LlamaCppForm ~224 (all `.input`). I followed the brief and swapped only the dead colour class (`border-muted` / `border-primary` → `border-surface-200-800`). SamplingValuesForm's `border-primary` looks like an in-edit cue; it was inert before, and is now a hairline.
- Mixed grounds (width- or call-site-dependent): ConnectionStopScripts, ComfyDrawTest progress box, ImageConnectionForm ~296 and ~358 (see section 1). No fixed fill reads everywhere; the chosen fills read in the sidebar.
- Noticed, not done: ConnectionCapabilities.svelte:192 fieldset border and the `border-surface-500/20` pattern recurs elsewhere (ImageConnectionForm ~381 uses `border-surface-200-800`, inconsistent with it).
