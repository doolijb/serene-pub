# BRIEF — `ui-borders` worker 1 — lorebooks, character forms, entry fire test, templates

**Read `plans/briefs/BRIEF-ui-borders-common.md` first and in full.** Every rule there applies. This brief adds only your file list and per-site notes.

## Goal

Remove arbitrary borders from the sidebar views in your files: hand-written cards lose their border, separators become spacing, fill-less outlined boxes get a quiet fill — except where the ground depends on the width or a signal must show.

## Files owned (edit only these; all under `src/lib/client/`)

- `lorebooks/graphs/NodePanel.svelte`, `lorebooks/cast/CastRelationships.svelte`, `lorebooks/GraphsWorkspace.svelte`, `lorebooks/graphs/LinkForm.svelte`, `lorebooks/sections/EntryInspector.svelte`, `lorebooks/cast/CastMemberForm.svelte`, `lorebooks/BookRulesCard.svelte`, `lorebooks/sections/DerivedEntryEditor.svelte`, `lorebooks/sections/KeptImprintNote.svelte`, `lorebooks/graphs/TieSidesBlock.svelte`, `lorebooks/places/ExitsLineLinks.svelte`, `lorebooks/places/PlaceStats.svelte`, `lorebooks/places/PlaceLinks.svelte`, `lorebooks/CastWorkspace.svelte`, `lorebooks/cast/CastDuplicatesPanel.svelte`
- `components/characterForms/CardStatsTab.svelte`, `components/characterForms/StrokeList.svelte`, `components/characterForms/StrokeField.svelte`
- `components/lorebookForms/EntryFireTest.svelte`
- `components/templates/TemplateLayoutsList.svelte`, `components/templates/TemplateEditor.svelte`

## Files readable

Anything under `src/` (to trace parents and call sites), `STYLE-GUIDE.md`.

## Sites (line numbers approximate; re-read)

### Move 1 — hand-written cards
- `lorebooks/graphs/NodePanel.svelte` ~187 `bg-surface-100-900 panel-edge … border` row: **keep the edge** (supervisor checked: it renders in GraphsWorkspace's `sideColumn`, a `panel-card` at desk width — 100 on 100 — and the bare ground at dock). Report it as width-dependent. No edit.
- `lorebooks/cast/CastRelationships.svelte` ~79 `bg-surface-100-900 panel-edge … border` row: **keep the edge** (renders in CastWorkspace's `memberPage`, width-dependent). No edit.
- `lorebooks/GraphsWorkspace.svelte` ~1726, ~1756, ~1850 and `lorebooks/graphs/LinkForm.svelte` ~97: `bg-surface-200-800 panel-edge … border` boxes. The raised `200-800` fill reads on both `100-900` and `50-950`, so remove `panel-edge` and `border` from each.
- `components/characterForms/CardStatsTab.svelte` ~478 (`bg-surface-50-950 border-surface-200-800 … border` row) and ~809: trace each one's parent ground. If the parent is `100-900`, remove the border and its colour. **The set-value marker at ~480** (`border-primary-500/60` when `slotId in values || slotId in limits`) is a signal edge: once the base `border` goes, write the conditional as `border border-primary-500/60` so the marker still shows. If the parent is `50-950` (fill equals ground), stop and report that site instead.
- `components/characterForms/StrokeList.svelte` ~232: same move after tracing the parent ground.

### Move 2 — separators
- `components/lorebookForms/EntryFireTest.svelte` ~409, `lorebooks/sections/EntryInspector.svelte` ~136: separator lines → spacing.
- `lorebooks/cast/CastMemberForm.svelte` ~1196: an `<hr>` → remove it; keep the gap.

### Move 3 — fill-less outlined boxes
- **Width-dependent: keep the edge as `panel-edge border`** — `lorebooks/places/PlaceLinks.svelte` ~495, ~586; `lorebooks/places/PlaceStats.svelte` ~277; `lorebooks/places/ExitsLineLinks.svelte` ~263, ~288; `lorebooks/sections/KeptImprintNote.svelte` ~50; `lorebooks/graphs/TieSidesBlock.svelte` ~90. Normalise the colour to `panel-edge` only if spelled `border-surface-200-800`; otherwise no edit. Report each.
- `lorebooks/sections/DerivedEntryEditor.svelte` ~215: it is a `<fieldset>` inside the entry editor (width-dependent, and fieldsets are never-touch). **No edit**; report it.
- `lorebooks/BookRulesCard.svelte` ~126: parent is the component's own root `card preset-filled-surface-100-900` (~101), a fixed `100-900` ground → `bg-surface-50-950`, no border.
- `lorebooks/CastWorkspace.svelte` ~1372 (`panel-edge … border p-3` box under "Background character name", inside the `castList` snippet): the supervisor believes `castList` sits on the bare sidebar ground at both widths (desk: `ResizableSplit`'s `first`, no card; dock: no card) → `bg-surface-100-900`, no border. Verify before editing.
- `lorebooks/cast/CastDuplicatesPanel.svelte` ~242: rendered inside CastWorkspace's `panel-inset` `#castReviewPanel` (~2052) → a `50-950` parent → `bg-surface-100-900`, no border. Verify.
- `components/characterForms/StrokeField.svelte` ~78, `components/lorebookForms/EntryFireTest.svelte` ~283, `components/templates/TemplateLayoutsList.svelte` ~132, `components/templates/TemplateEditor.svelte` ~401: trace the parent ground (including call sites — `EntryFireTest` may render inside a lorebook entry editor, which would make it width-dependent) and apply move 3 or the width-dependent exception.

## Out of scope

Anything not listed. Every `panel-inset`. `lorebooks/time/MomentBar.svelte` (its border is a signal; leave it). Any file outside the list, even if you notice a border there (put it under Noticed, not done).

## Stop and ask when

Any "Stop and report" condition in the common rules. A ★-type question (behaviour, layout, copy, a new name or class) — report, don't decide.

## Done means

Every listed site handled or reported with a reason; `npx prettier --check` passes on each file you edited; no vitest run (the supervisor runs tests).

## Report path

`plans/REPORT-ui-borders-w1-2026-11-12.md` — and return the same text as your final message.
