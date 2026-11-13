# REPORT — ui-borders worker 4 (2026-11-12)

This was an implementation task. No relayed status question was received. All paths are under `src/lib/client/components/`.

## 1. Changes (old -> new, ground)
- `CustomThemeManager.svelte` ~255, the swatch label: `bg-surface-50-950 border-surface-200-800 hover:border-surface-400-600 ... border p-2` -> `bg-surface-50-950 hover:bg-surface-200-800 ... p-2`. The ground is `100-900`: the `<section class="panel-card">` at line 215 holds the grid. Move 1; the hover cue moved to the fill. The selected ring is kept.
- `CustomThemeManager.svelte` ~271, the preview: `bg-surface-50-950 border-surface-200-800 ... rounded-lg border px-3` -> `bg-surface-100-900 ... rounded-lg px-3`. Its fill equalled the label's `50-950`, so it takes the other ground. It carries its own `data-theme`, so it reads as that theme's `100-900`.
- `CustomThemeEditor.svelte` ~303, the root: `panel-edge bg-surface-50-950 ... rounded-xl border` -> `bg-surface-100-900 ... rounded-xl`. The ground is `50-950`: `CustomThemeManager.svelte:201` renders the editor in place of the manager, inside a bare `div` in `SettingsSidebar`, with no card. The fill equalled the ground, so it takes `100-900`.
- `CustomThemeEditor.svelte` ~307, ~336, ~368 (toolbar, fields row, status bar): removed `panel-edge bg-surface-100-900 border-b` / `border-t`. The bars now inherit the root's `100-900`; the existing `px`/`py` stays as the spacing. Their `bg-surface-100-900` would have stacked on the root's now-identical fill, so I dropped it. Prettier then reflowed the class lines.
- `sprites/SpriteContactSheet.svelte` ~197 and `sprites/SpritesTab.svelte` ~1149, dashed placeholders with no border colour: added `border-surface-300-700` beside `border-2 border-dashed`. They are drop-zone-like, so the dashed rule and its `300-700` pair apply.
- `graph/GraphVisualization.svelte` ~1240: `border-surface-600 space-y-1 border-t pt-2` -> `space-y-1`. The parent legend already has `space-y-2`.
- `pipelines/PipelineConfigOptions.svelte` ~1521: `border-surface-500/30 space-y-2 border-t pt-3` -> `space-y-2`. The parent has `space-y-3`.
- `settingsTabs/TotpSettings.svelte` ~259: `border-surface-200-800 space-y-2 border-t pt-3` -> `space-y-2`. The parent has `space-y-3`.
- `userForms/InvitePanel.svelte` ~229 and ~260: `border-surface-200-800 space-y-2 border-t pt-3` -> `space-y-2`. The parent has `space-y-4`.
- `settingsTabs/ImportSettingsTab.svelte` ~915: `border-surface-400-600 mt-6 border-t pt-4` -> `mt-6`.
- `media/MediaManagerTab.svelte` ~830, the media list row: `border-surface-200-800 flex ... rounded-lg border p-1.5` -> `bg-surface-100-900 flex ... rounded-lg p-1.5`. The ground is `50-950`: the root `div` at line 615 has no fill, and `SettingsSidebar.svelte:253` renders it bare. Move 3.
- `media/MediaManagerTab.svelte` ~937: `border-surface-200-800 flex flex-col gap-4 border-t p-3` -> `flex flex-col gap-4 p-3`. It sits inside the `card preset-filled-surface-100-900` card. `p-3` stays as content padding.
- `pipelines/SchemaForm.svelte` ~596, `<details>`: `border-surface-200-800 rounded-container border p-3` -> `panel-edge rounded-container border p-3`. It is multi-context and the root `div` at line 399 has no fill. The edge is kept, with the pair spelled `panel-edge`.
- `userForms/InvitePanel.svelte` ~268, the `li`: `border-surface-200-800 flex ...` -> `panel-edge flex ...`. The ground differs by call site (Users sidebar vs Admin) and the component owns no fill. The edge is kept.

## 2. Borders kept
- `CustomThemeEditor.svelte:118` is an inline CSS `borderRight`; it is not a class and was not touched.
- `SchemaForm.svelte:596` and `InvitePanel.svelte:268` are the multi-context edges above.
- Signal edges: `TotpSettings.svelte:137` (`border-warning-500`), `InvitePanel.svelte:154` (`border-primary-500`), the `border-l-4 border-warning-500` bars in `ImportSettingsTab.svelte`, and the `border-error-500/50` boxes in `MediaManagerTab.svelte`. All already carry an explicit `border` or `border-l-4`.
- Dashed drop zone: `MediaManagerTab.svelte:725`.
- Thumbnail frames: `MediaManagerTab.svelte:745`, `SpritesTab.svelte:934` and `:1137`.
- Swatch frames: `CustomThemeManager.svelte:445` and `:496`.
- Fieldsets: `SchemaForm.svelte:406` and `PipelineConfigOptions.svelte:1850/1975/2235/2553`.
- `SpriteContactSheet.svelte` ~152, the tile `li` with `border-surface-200-800 ... border p-1.5`: not in my brief and the ground is width-dependent (`SpritesTab` inside the member page). I left it.

## 3. Brief sites not changed
- `PipelineConfigOptions.svelte` ~2553 is a `<fieldset>` (never touch), so I left it as it was.
- `PipelineConfigOptions.svelte` ~1850 and ~2235 are fill-less outlined chip-like boxes, not in the brief. I left them.

## 4. Chips and pills seen and left
- `PipelineConfigOptions.svelte` 1850 and 2235 (outlined chips).
- `CustomThemeManager.svelte:468` (an inline-styled pill).
- The legend summary in `GraphVisualization.svelte`.

## 5. Test files that render touched components
- `lorebooks/lenses/libraryLayer.dom.test.svelte.ts`, `lorebooks/lenses/readOnlyLenses.dom.test.svelte.ts` and `lorebooks/lenses/lensMounts.dom.test.svelte.ts`
- `lorebooks/cast/memberSprites.dom.test.ts`
- `components/sprites/spritesTabFromCard.dom.test.ts`, `spriteContactSheet.dom.test.svelte.ts`, `spritesTab.memberOwner.dom.test.ts` and `spriteReexpress.dom.test.svelte.ts`
- `components/graph/GraphVisualization.dom.test.svelte.ts`
- `components/sidebars/settingsImportSection.dom.test.svelte.ts`
- `components/pipelines/schemaFormChoiceLabels.dom.test.ts`, `settingsGroups.dom.test.ts`, `loadoutRow.dom.test.ts`, `schemaFormUnset.dom.test.svelte.ts`, `stepVariableLayouts.dom.test.ts`, `schemaFormObject.dom.test.ts` and `workspace/canvas/canvasPanel.dom.test.svelte.ts`
- Server tests that mention `SchemaForm` only by name, not run for this lane: `KoboldCppManagedImageAdapter.test.ts` and `dispatchImage.managedImage.int.test.ts`.

I ran no vitest and no `npm run check`.

## 6. Prettier, assumptions, noticed
- `npx prettier --check` passes on all edited files except `graph/GraphVisualization.svelte` and `pipelines/SchemaForm.svelte`. Both already failed at HEAD (verified with `git show HEAD:... | prettier --stdin-filepath --check`), and I did not reformat them. I ran `prettier --write` on the other single owned files that had passed at HEAD.
- Assumption: the swatch preview takes `100-900` inside its `data-theme` scope. That is the visible step off its own `50-950` label.
- Assumption: dropping the editor bars' own `100-900` fill is right now that the root holds it.
- Noticed, not done: `SchemaForm.svelte` is prettier-dirty at HEAD, and so is `GraphVisualization.svelte`.
