# BRIEF — `ui-borders` worker 4 — themes, sprites, graph, pipelines, settings tabs, invites, media

**Read `plans/briefs/BRIEF-ui-borders-common.md` first and in full.** Every rule there applies. This brief adds only your file list and per-site notes.

## Goal

Remove arbitrary borders from these sidebar components: hand-written cards lose their border, broken border colours get the hairline pair, separators become spacing, fill-less outlined boxes get a quiet fill — except where the ground differs by call site or width.

## Files owned (edit only these; all under `src/lib/client/components/`)

- `CustomThemeManager.svelte`, `CustomThemeEditor.svelte`
- `sprites/SpriteContactSheet.svelte`, `sprites/SpritesTab.svelte`
- `graph/GraphVisualization.svelte`
- `pipelines/PipelineConfigOptions.svelte`, `pipelines/SchemaForm.svelte`
- `settingsTabs/TotpSettings.svelte`, `settingsTabs/ImportSettingsTab.svelte`
- `userForms/InvitePanel.svelte`
- `media/MediaManagerTab.svelte`

Never edit `settingsTabs/UserSettingsTab.svelte` (it renders `TotpSettings`; read it only).

## Files readable

Anything under `src/`, `STYLE-GUIDE.md`.

## Call sites the supervisor found (verify; they decide the ground)

- `CustomThemeManager` → `sidebars/SettingsSidebar.svelte` ~257; it renders `CustomThemeEditor` (~201).
- `MediaManagerTab` → `SettingsSidebar` ~253. `ImportSettingsTab` → `SettingsSidebar` ~376. `TotpSettings` → `UserSettingsTab` ~810.
- `InvitePanel` → `sidebars/UsersSidebar.svelte` ~277 (`compact`) **and** Admin `admin/sections/users/InvitesPage.svelte` ~17.
- `SpritesTab` → `lorebooks/CastWorkspace.svelte` ~2014 (inside the member page: **width-dependent ground**, a `panel-card` at desk, bare at dock) **and** `characterForms/CharacterViewPanel.svelte` ~598. `SpriteContactSheet` → `SpritesTab` ~1092.
- `GraphVisualization` → `lorebooks/graphs/RelationshipsCanvas.svelte` ~139.
- `PipelineConfigOptions` → `lorebooks/GraphsWorkspace.svelte` ~1745 (inside a `bg-surface-200-800` box), `sessionForms/EditSessionForm.svelte` ~3664, Admin `admin/sections/pipelines/SlugPage.svelte` ~946, `pipelines/workspace/canvas/CanvasDrawer.svelte` ~737. Its own markup may wrap content in its own `panel-card`; a box inside that is on a fixed `100-900`.
- `SchemaForm` → many grounds (session widgets' settings panel, connection forms, session settings, Admin, a modal). Treat any fill-less box at its top level as multi-context: keep the edge as `panel-edge border`.

## Sites (line numbers approximate; re-read)

### Move 1
- `CustomThemeManager.svelte` ~255: a hand-written card with `border` → trace its ground; remove the border on the opposite ground.
- **Fill equals its ground — must not vanish**: `CustomThemeManager.svelte` ~271 and `CustomThemeEditor.svelte` ~303. Give each the other ground so it reads (`bg-surface-50-950` ↔ `bg-surface-100-900`) and drop the border, **or** keep its edge if the ground differs by call site. Say which you chose and why.

### Move 2
- **Border with no colour / a colour that does not exist** (unpaired stop such as `border-surface-300`, `border-surface-500/20`, or a pair that does not sum to 1000): `sprites/SpriteContactSheet.svelte` ~197, `sprites/SpritesTab.svelte` ~1149 → `border-surface-200-800`, or `border-surface-300-700` if a dashed drop zone. `graph/GraphVisualization.svelte` ~1240 and `pipelines/PipelineConfigOptions.svelte` ~1521 are separators → remove (move 2).
- **Separators → spacing**: `settingsTabs/TotpSettings.svelte` ~259, `userForms/InvitePanel.svelte` ~229, ~260, `media/MediaManagerTab.svelte` ~937, `settingsTabs/ImportSettingsTab.svelte` ~915, `pipelines/PipelineConfigOptions.svelte` ~1521, `graph/GraphVisualization.svelte` ~1240, `CustomThemeEditor.svelte` ~307, ~336. Remove the line and any padding that only sat off it; keep the stack's gap or one step more. Where the line separated two real sections inside one card, the smaller change wins (usually spacing).

### Move 3 — fill-less boxes
- `pipelines/SchemaForm.svelte` ~596: multi-context → keep the edge as `panel-edge border` unless it sits inside SchemaForm's own filled wrapper.
- `pipelines/PipelineConfigOptions.svelte` ~2553, `userForms/InvitePanel.svelte` ~268, `media/MediaManagerTab.svelte` ~830: trace the immediate parent ground; apply move 3. If the ground differs by call site (InvitePanel: Users sidebar vs Admin; PipelineConfigOptions: four hosts) and the box is not inside a fill the component itself owns, keep the edge as `panel-edge border` and report.

## Out of scope

Anything not listed; every `panel-inset`; chips and pills; thumbnails' and swatches' frames (sprites!), crop masks.

## Stop and ask when

Any "Stop and report" condition in the common rules. A ★-type question — report, don't decide.

## Done means

Every listed site handled or reported with a reason; `npx prettier --check` on each edited file (if a file already failed at HEAD, say so — check with `git show HEAD:<path> | npx prettier --stdin-filepath <path> --check`; do not reformat it); no vitest run.

## Report path

`plans/REPORT-ui-borders-w4-2026-11-12.md` — and return the same text as your final message.
