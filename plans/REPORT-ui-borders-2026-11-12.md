# REPORT — build lane `ui-borders` — 2026-11-12

Brief: `plans/briefs/BRIEF-ui-borders.md`. Worker reports: `plans/REPORT-ui-borders-w1…w4-2026-11-12.md`. Saved by
the lead from the supervisor's report. **Nothing was looked at in a running app.**

- **Step 1.** `@utility panel-card` is `bg-surface-100-900 rounded-container p-4`, no border; `panel-inset` and
  `panel-edge` unchanged. A card inside a card takes the inset fill at the call site
  (`sidebars/ConnectionsSidebar.svelte` models section `[&_.panel-card]:bg-surface-50-950`;
  `connections/ModelFinderView.svelte` `[&_[data-quant-picker]]:bg-surface-50-950`), because `ModelRow` and
  `QuantPicker` also render on the bare ground elsewhere. `EditSessionForm` `CARD_CLASS` is `"panel-card"`.
  Hand-written cards lost their border (`SessionCardItem`, `DownloadsTray`, the Visibility tab's five boxes,
  `CardStatsTab` ~478, the theme swatch label, three `GraphsWorkspace` boxes, `LinkForm`). Signal edges carry their
  own `border` (`ConnectionsSidebar` next-step edge, `LoadoutsGrid` default tile, `CardStatsTab` set-value marker,
  Admin network and change-form edges); the Admin overview's hover cue moved to the fill; `StrokeList` keeps a
  transparent resting border for its drop target.
- **Step 2.** Dead or unpaired border colours fixed; separators became spacing in `TotpSettings`, `InvitePanel`,
  `MediaManagerTab`, `ImportSettingsTab`, `ConnectionsSidebar`, `HelpSidebar`, `SessionRunsTab`, `EntryFireTest`,
  `EntryInspector`, `PipelineConfigOptions`, `ImageConnectionForm`, `GraphVisualization`, `KoboldCppManagedForm`,
  `ConnectionIndexView`, `LoadoutsGrid`, `CustomThemeEditor` (also its status bar's line, beyond the list);
  Activity's nested `divide-y` removed.
- **Step 3.** Fill-less boxes on a card took `bg-surface-50-950` (the six seat rows, `BenchedSeatRow`,
  `SessionAnnexPanel`, `SpeechSettingsBlock`, `BookRulesCard`, the loadout sheet's `ModelCard`); on the ground or an
  inset `bg-surface-100-900` (Connections' "Advanced and notes", `CastWorkspace` ~1372, `CastDuplicatesPanel`,
  `AudioCppModelsTab` row, the KoboldCPP variant picker's box, `MediaManagerTab` row, `CustomThemeEditor` root).
- **Kept, because the ground depends on width or call site:** `PlaceLinks`, `PlaceStats`, `ExitsLineLinks`,
  `KeptImprintNote`, `TieSidesBlock`, `EntryFireTest` ~283, `NodePanel` ~187, `CastRelationships` ~79,
  `TemplateEditor`, `TemplateLayoutsList`, `CharacterPickRow`, `SchemaForm` ~596, `InvitePanel` ~268,
  `ConnectionStopScripts`, `ComfyDrawTest`, `ImageConnectionForm` ~296/~358. Fieldsets, drop zones, thumbnails,
  warning and error edges untouched.
- **STYLE-GUIDE.md:** a card has no border (owner, 2026-11-12); the inset keeps its hairline for now; card in card,
  signal edge and fill-less box rules added; the 2026-10-02 and 2026-10-24 notes marked superseded for cards.
- **Tests:** 69 files, 610 tests pass; `npm run check` no new problems.

## Open ★

1. Borderless `panel-inset` needs the lorebook editors in a card at dock width (layout change); the
   width-dependent boxes go with it. 2. Table and list row dividers left (`WorkflowFittingForm`,
   `ComfyWorkflowsTab`, `ModelTable`, Activity's outer `divide-y`). 3. Chips and pills left. 4. `TagsSidebar` ~772
   gold-edged description box. 6. `StrokeField` ~78 keeps its edge. 7. The theme preview now shows the theme's
   `100-900` stop.

## Lead's follow-up (2026-11-12)

- `components/admin/AdminList.svelte`: the clickable card's hover and keyboard-focus cue was a border colour, which
  shows nothing without a border width. Now the row-hover fill, plus a primary focus outline.
- `components/AppletCard.svelte` (owner: "Yes, match the continue cards"): no border; `bg-surface-50-950` on the
  home page (`from="home"`), `bg-surface-100-900` in the Apps view.
- Scope review: pending.

## Noticed, not done

The seat-row recipe repeats seven times; `ModelRow`'s selected ring offset colour inside the Connections card;
dead `bg-background` in `OllamaForm` / `LlamaCppForm`; `SpriteContactSheet` ~152 tile; `CanvasPanel` ~328 header
`border-b`; `connections/JobsGrid.svelte` (imported by nothing) still adds border colours to a `panel-card`.

## Scope review and the lead's fixes (2026-11-12)

Scope: class-only diffs, no new components or props; the review flagged the lead's own `AdminList` edit as outside
the lane's files (it is the lead's, recorded above) and the style guide's "set the fill at the call site" rule as
beyond the brief (kept: it is what was built). Four same-fill regressions the shared utility caused, all fixed:

1. `loadouts/LoadoutSheet.svelte`: the dialog was `100-900` and its five cards vanished into it. The dialog is now
   `bg-surface-50-950`, the ground the guide gives dialogs.
2. `connections/OnnxModelView.svelte`: `QuantPicker` inside the `100-900` status card takes the inset fill at the
   call site.
3. Admin: `ModelRow` inside the fieldset card (`admin/sections/connections/IdPage.svelte`) and `AdminList` inside
   one (`admin/sections/session-genres/IdPage.svelte`) take the inset fill at the call site.
4. `admin/sections/rulesets/RulesetInlinePick.svelte`: the dropdown floated `100-900` over `100-900` rows; it is
   now the popover recipe (`bg-surface-50-950`, hairline).

Also fixed: a type error in `sceneEditor.routineSummary.dom.test.svelte.ts` (lane `sense-sum`'s test) that
`npm run check` reported. After the fixes `npm run check` shows 0 errors from this work.
