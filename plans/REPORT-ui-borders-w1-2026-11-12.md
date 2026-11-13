# REPORT ui-borders w1 (2026-11-12)

Status question: none relayed. Implementation done; no vitest, no `npm run check`.
All paths under `src/lib/client/`.

## 1. Changed sites
- `lorebooks/GraphsWorkspace.svelte` ~1725, 1755, 1849 (three boxes) and `lorebooks/graphs/LinkForm.svelte` 97: `bg-surface-200-800 panel-edge ... rounded-lg border p-3` -> `bg-surface-200-800 ... rounded-lg p-3`. Fill is raised 200-800, reads on both 100-900 and 50-950 (common rules). I ran `prettier --write` on GraphsWorkspace alone because one class line then fitted on one line (net diff 3+/5-).
- `lorebooks/BookRulesCard.svelte` 126: `border-surface-200-800 rounded-base flex flex-col gap-2 border p-3` -> `bg-surface-50-950 rounded-base flex flex-col gap-2 p-3`. Parent: root `<section class="card preset-filled-surface-100-900 ...">` at BookRulesCard.svelte:101, fixed 100-900.
- `lorebooks/CastWorkspace.svelte` 1372 (Background character name box): `panel-edge flex flex-col gap-2 rounded-lg border p-3` -> `bg-surface-100-900 flex flex-col gap-2 rounded-lg p-3`. Verified: it is inside the `castList` snippet (1326), root `flex min-h-0 flex-1 flex-col gap-3`, no fill. `castList` is rendered at 2107 (ResizableSplit `first`, no card; ResizableSplit.svelte has no panel fill) and 2138 (dock, no card). Bare 50-950 sidebar ground at both widths.
- `lorebooks/cast/CastDuplicatesPanel.svelte` 242 (merge-log rows): `panel-edge ... rounded-lg border px-3 py-2` -> `bg-surface-100-900 ... rounded-lg px-3 py-2`. Verified: only call site is CastWorkspace.svelte:2096, inside `panel-inset id="castReviewPanel"` (2052) = 50-950 parent.
- `components/characterForms/CardStatsTab.svelte` 478-480: row `bg-surface-50-950 border-surface-200-800 ... rounded-lg border p-2.5` -> `bg-surface-50-950 ... rounded-lg p-2.5`; marker became `'border border-primary-500/60'` so the set-value signal still shows. Parent: `<section class="panel-card ..." aria-label="Stats">` CardStatsTab.svelte:452 = 100-900.
- `components/characterForms/StrokeList.svelte` 232: `bg-surface-50-950 border-surface-200-800 data-[drop-target=true]:border-primary-500 ... rounded-lg border p-2` -> `bg-surface-50-950 data-[drop-target=true]:border-primary-500 ... rounded-lg border border-transparent p-2`. The drop-target border is a signal, so I kept `border` and made its resting colour transparent (no 1px shift on drop). Parent: StrokeList is only rendered by StrokeField, which CharacterForm.svelte renders at 1410 and 1803 inside `<section class="panel-card">` (1380, 1800) = 100-900. **Assumption/judgement call**: `border-transparent` is a new colour class beside the signal; say if you prefer `data-[drop-target=true]:border` instead.
- `lorebooks/sections/EntryInspector.svelte` 136: `border-surface-200-800 flex flex-col gap-2 border-t pt-2` -> `flex flex-col gap-2`. Gap comes from the parent stacks (`gap-4` at lorebooks/EntryWorkspace.svelte:2121 and 2205, both call sites).
- `components/lorebookForms/EntryFireTest.svelte` 409 (Teach it): `border-surface-200-800 flex flex-col gap-1 border-t pt-2` -> `flex flex-col gap-1`. Gap comes from the enclosing `<section ... gap-2>` (283).

## Width/context-dependent: kept as `panel-edge border`
Colour normalised from `border-surface-200-800` to `panel-edge` where it was spelled that way; fill left as written.
- `lorebooks/places/PlaceLinks.svelte` 495, 586; `places/PlaceStats.svelte` 277; `places/ExitsLineLinks.svelte` 263, 288; `sections/KeptImprintNote.svelte` 50; `graphs/TieSidesBlock.svelte` 90. (Lorebook editors, 100-900 at desk, bare 50-950 at dock.)
- `components/lorebookForms/EntryFireTest.svelte` 283: rendered by EntryInspector, which sits in EntryWorkspace (width-dependent). `panel-edge border` normalised.
- `components/templates/TemplateEditor.svelte` 401 and `TemplateLayoutsList.svelte` 132 (rendered inside TemplateEditor, line 376): TemplateEditor has no fill of its own and its ground differs by call site. Admin `AdminFieldset` (`panel-card`, 100-900) hosts it in `TemplateChangeForm.svelte:431` and `VariableLayoutForm.svelte:604`; `pipelines/PipelineConfigOptions.svelte:1736` places it in a `bg-surface-50-950` box (1698, found by scan, 50-950). No fixed fill reads in both, so edge kept as `panel-edge border`.

## 2. Borders kept (not width-dependent)
- `lorebooks/graphs/NodePanel.svelte` ~187 and `lorebooks/cast/CastRelationships.svelte` ~79: unchanged per brief (width-dependent, 100 on 100 at desk).
- `components/characterForms/StrokeField.svelte` 78 (`bg-surface-100-900 border-surface-200-800 ... border` compiled-preview box): parent is StrokeField inside `panel-card` (100-900), so fill equals ground; edge kept, unchanged. Quiet fill alternative would be `bg-surface-50-950`; needs your call.
- `lorebooks/sections/DerivedEntryEditor.svelte` 215: fieldset, no edit.
- `ExitsLineLinks.svelte` 270 `border-l-2` quote bar, `StrokeList.svelte` 374 `border-l` indent bar, `CastMemberForm.svelte` `border-l border-white/25` split-button: left alone.
- TieSidesBlock 100 `border-primary-500` pill: left.

## 3. Brief sites not changed
- `lorebooks/cast/CastMemberForm.svelte` ~1196 `<hr>`: it sits inside the Change face `Popover.Content` (opens 1058, `card bg-surface-50-950 border ... shadow-xl`), so it is a menu-group hairline in a popover. Common rules: never touch, popovers out of scope. Left; hr at 1110 and 1952 also left. Your call if you want it removed.
- `components/characterForms/CardStatsTab.svelte` ~809 (`bg-surface-50-950 border-surface-200-800 ... border` slot list in the New sheet): it is inside `Dialog.Content` (781, `card bg-surface-100-900`), a modal, out of scope. Left. (The parent ground would be 100-900, so the move would apply if you want modals included.)

## 4. Chips/pills seen and left
TieSidesBlock 100 "from the rules" pill (primary outline).

## 5. Test files rendering touched components (supervisor to run)
variableLayoutForm.dom.test.svelte.ts (admin/sections/variable-layouts), lorebooks/{lineConformance.test.ts, lineConformance.screens.dom.test.ts, bookRulesFit.dom.test.svelte.ts, refusalsSaidOnce.dom.test.ts, crosstalk.dom.test.ts}, lorebooks/graphs/{LinkForm,TieSidesBlock}.dom.test.svelte.ts, lorebooks/places/{PlaceStats,PlaceLinks}.dom.test.svelte.ts, lorebooks/sections/keptImprintNote.dom.test.svelte.ts, lorebooks/cast/{memberPage,memberPageCard,memberPageVersions,memberSprites,memberCopy,memberGallery}.dom.test.ts, components/templates/{templateEditorLayouts,templateEditorField}.dom.test.svelte.ts, templateVariables.dom.test.ts, components/characterForms/{StrokeField,StrokeList}.dom.test.svelte.ts. (utils/awaitReply.test.ts matched by name only.)

## 6. Assumptions; Noticed, not done
- `npx prettier --check`: passes on GraphsWorkspace, LinkForm, BookRulesCard, CastWorkspace, CastDuplicatesPanel, TemplateLayoutsList. Fails on EntryInspector, KeptImprintNote, TieSidesBlock, ExitsLineLinks, PlaceLinks, PlaceStats, CardStatsTab, StrokeList, EntryFireTest, TemplateEditor; I confirmed via `git show HEAD:<file> | prettier --stdin-filepath` that each already failed at HEAD, so the failures are pre-existing, not mine. I did not reformat them.
- PipelineConfigOptions 1698 parent for TemplateEditor was found by a backwards scan, not by reading the full nesting.
- Noticed: CastMemberForm Popover content has a `border-surface-200-800 border` box on `bg-surface-50-950` (popover, out of scope).
