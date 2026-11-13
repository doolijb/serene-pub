# BRIEF — `ui-borders` worker 2 — connections, connection forms, sidebars, loadouts, managers

**Read `plans/briefs/BRIEF-ui-borders-common.md` first and in full.** Every rule there applies. This brief adds only your file list and per-site notes.

## Goal

Remove arbitrary borders from the sidebar views in your files: hand-written cards lose their border, separators become spacing, fill-less outlined boxes get a quiet fill, broken border colours get the hairline pair — while signal edges keep showing.

## Files owned (edit only these; all under `src/lib/client/`)

- `components/sidebars/ConnectionsSidebar.svelte`, `components/sidebars/TagsSidebar.svelte`, `components/sidebars/SamplingValuesForm.svelte`, `components/sidebars/HelpSidebar.svelte`, `components/sidebars/ActivitySidebar.svelte`
- `components/connections/ModelFinderView.svelte`, `components/connections/DownloadsTray.svelte`, `components/connections/ConnectionCapabilities.svelte`, `components/connections/comfy/ComfyDrawTest.svelte`, `components/connections/ConnectionIndexView.svelte`, `components/connections/ConnectionStopScripts.svelte`
- `connectionForms/OllamaForm.svelte`, `connectionForms/LlamaCppForm.svelte`, `connectionForms/ImageConnectionForm.svelte`, `connectionForms/KoboldCppManagedForm.svelte`
- `components/loadouts/LoadoutsGrid.svelte`, `components/loadouts/sheet/ModelCard.svelte`
- `components/audiocppManager/AudioCppModelsTab.svelte`, `components/koboldcppManager/KoboldCppBinaryVariantPicker.svelte`

Not owned (do not edit): `connections/ModelRow.svelte`, `connections/QuantPicker.svelte`, `connections/JobsGrid.svelte`, `connections/ModelTable.svelte`, `connections/comfy/WorkflowFittingForm.svelte`, `connections/comfy/ComfyWorkflowsTab.svelte`.

## Files readable

Anything under `src/`, `STYLE-GUIDE.md`.

## Sites (line numbers approximate; re-read)

### Move 1 — cards inside cards, hand-written cards, signal edges
- **Card inside a card, fixed at the call site.** `ModelRow` (root `panel-card`) renders inside the `panel-card` models section of `sidebars/ConnectionsSidebar.svelte` (~1683, `id="api-connection-models"`), but also on the bare ground in `ModelsListView`, `ManagedModelsTab` and Admin, so `ModelRow.svelte` itself must not change. On that section's class string add the descendant variant `[&_.panel-card]:bg-surface-50-950` (first check there is no other `panel-card` descendant in that section besides `ModelRow`; if there is, stop and report).
- Likewise `QuantPicker` (root `<section data-quant-picker class="panel-card …">`) renders inside the result-row `panel-card`s of `connections/ModelFinderView.svelte` (the `resultRow` snippet ~1789 and `hubResultRow` ~1916), and on the bare ground in `OnnxModelView`. On **both** of those row cards add `[&_[data-quant-picker]]:bg-surface-50-950`.
- `connections/DownloadsTray.svelte` ~54 `panel-edge bg-surface-100-900 … border`: trace its parent ground; on `50-950`, remove `panel-edge` and `border`.
- **Signal edges:** `sidebars/ConnectionsSidebar.svelte` `NEXT_STEP_EDGE` (~163–167: `border-primary-500/30!`, `border-error-500/30!`, `border-success-500/30!`, applied to the status `panel-card` ~1529): prefix each value with `border ` (e.g. `"border border-primary-500/30!"`) so the edge still shows. `loadouts/LoadoutsGrid.svelte` ~45 default tile `border-primary-500/40!` → `border border-primary-500/40!`.
- `sidebars/TagsSidebar.svelte` ~772 (`border-primary-500 bg-surface-50-950 rounded-lg border p-4`, a tag's description): **leave unchanged** and report the parent ground you find; the supervisor carries the gold edge as a question.

### Move 2 — broken colours and separators
- **Border with no colour, or a colour that does not exist** (an unpaired stop, e.g. `border-surface-300`, `border-surface-700` alone, or a pair that does not sum to 1000): `components/connections/ConnectionCapabilities.svelte` ~221, `connectionForms/OllamaForm.svelte` ~265, `connectionForms/LlamaCppForm.svelte` ~224, `sidebars/SamplingValuesForm.svelte` ~304, `connectionForms/ImageConnectionForm.svelte` ~270, ~296, ~358, `connections/comfy/ComfyDrawTest.svelte` ~188. Give each the hairline pair `border-surface-200-800`, or `border-surface-300-700` if it is a dashed drop zone — **unless** it is a separator (then remove it, move 2) or a fill-less box (then move 3). `ImageConnectionForm` ~270 is a separator (remove); ~296 and ~358 are fill-less boxes (move 3).
- **Separators → spacing**: `sidebars/ConnectionsSidebar.svelte` ~1887, `sidebars/HelpSidebar.svelte` ~664, `connectionForms/KoboldCppManagedForm.svelte` ~289 (`<hr>`), `connections/ConnectionIndexView.svelte` ~653 (`<hr>`), `loadouts/LoadoutsGrid.svelte` ~28 (the group header's `border-surface-200-800 … border-b pb-1`: drop `border-surface-200-800`, `border-b` and the `pb-1` that only sat it off the line; keep `mb-2`).
- **Row dividers**: `sidebars/ActivitySidebar.svelte` ~1015 and ~1018 nest one `divide-y` inside another: remove the **nested (inner)** duplicate only. Leave every other row divider.

### Move 3 — fill-less outlined boxes
- `loadouts/sheet/ModelCard.svelte` ~197, `connections/ConnectionStopScripts.svelte` ~81, `sidebars/ConnectionsSidebar.svelte` ~1208, `audiocppManager/AudioCppModelsTab.svelte` ~200, `koboldcppManager/KoboldCppBinaryVariantPicker.svelte` ~373, `connectionForms/ImageConnectionForm.svelte` ~296, ~358: trace each one's immediate parent ground (through call sites where the box is near the component root) and apply move 3. If interactive with a border hover/selected cue, move the cue to `hover:bg-surface-200-800` and keep any selected ring.

## Out of scope

Anything not listed; every `panel-inset`; table/list row dividers other than Activity's nested one; chips and pills (list any you saw).

## Stop and ask when

Any "Stop and report" condition in the common rules. A ★-type question — report, don't decide.

## Done means

Every listed site handled or reported with a reason; `npx prettier --check` passes on each file you edited; no vitest run (the supervisor runs tests).

## Report path

`plans/REPORT-ui-borders-w2-2026-11-12.md` — and return the same text as your final message.
