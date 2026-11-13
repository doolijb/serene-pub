# BRIEF — build lane `ui-borders` — borderless cards in the sidebar views

**You are a lane supervisor.** Read `.claude/guides/multi-agent.md` first. Then `STYLE-GUIDE.md` §1 (rule 4, "Cards,
not separators"), §2.3 (grounds: the sidebar is `surface-50-950`, a card on it `100-900`, borders `200-800`), the
card definition (~1145–1155), `.panel-card` / `.panel-edge` / `.panel-inset` (~1205–1222), and `src/app.css`
~385–425 where those utilities are defined. CLAUDE.md Hard rules and "Decisions". Line numbers below are from a scan
on 2026-11-12 and may have moved: re-read before editing.

## The owner's words

"scan the sidebars for arbitrary borders as well. it adds noise to what should be a clean, minimal asthetic", then,
on the lead's three-step proposal, "go ahead and run them all". Earlier the same day the owner had the borders
removed from the home page's cards (done; not this lane).

## What to build, in three steps

Scope is the **sidebar views**: the roots in `src/lib/client/components/sidebars/` and everything they render
(panels, settings tabs, connections, session forms, character forms, `src/lib/client/lorebooks/`). Admin uses the
same shared card and changes with step 1; that is accepted. Not in scope: the home page, session widgets, modals,
dialogs, popovers and menus, docs pages.

### Step 1 — the shared card loses its border

- `@utility panel-card` (`src/app.css` ~405): drop `border` and the border colour. The fill already stands a full
  step off the sidebar ground.
- **`@utility panel-inset` keeps its border in this lane** (cold review, 2026-11-12). At dock width the lorebook
  editors sit straight on the sidebar ground, not in a card (`CastWorkspace.svelte` ~2103–2124, `TimeLens.svelte`
  ~910–927, `GraphsWorkspace.svelte` ~1894–1907, `EntryWorkspace.svelte` ~2253–2280), so an inset there is
  `50-950` on `50-950` and its border is its only edge; no fixed fill is right in both widths. Leave every
  `panel-inset` as it is and carry it as a ★ for the owner (borderless insets need those editors to sit in a card
  at dock width too, which is a layout change).
- **A card directly inside a card must not vanish**: `connections/ModelRow.svelte:189` (rendered inside the
  `panel-card` section at `sidebars/ConnectionsSidebar.svelte` ~1684) and `connections/QuantPicker.svelte:187`
  (inside the `panel-card` row at `connections/ModelFinderView.svelte` ~1789). Give the inner one the inset fill
  (`bg-surface-50-950`) and say so. Grep for any other `panel-card` whose parent is a `panel-card` and treat it the
  same way.
- `EditSessionForm.svelte` ~164 `CARD_CLASS` re-spells the card with its border: make it the utility alone.
- Hand-written copies of the same card (a filled `bg-surface-100-900` box with `border` on the sidebar ground, or a
  `50-950` box with `border` on a card) lose the border the same way: `AppletCard.svelte:64` **only if** it still
  reads on the home page (its fill equals the page ground there in dark mode: if it would vanish, leave it and
  report), `listItems/SessionCardItem.svelte:72`, `connections/DownloadsTray.svelte:54`,
  `EditSessionForm.svelte` Visibility tab (~3833–3917), `characterForms/CardStatsTab.svelte:478, 809`,
  `characterForms/StrokeList.svelte:232`, `CustomThemeManager.svelte:255`, `lorebooks/graphs/NodePanel.svelte:187`,
  `lorebooks/cast/CastRelationships.svelte:79`, and the `200-800`-filled boxes with `panel-edge border`
  (`GraphsWorkspace.svelte:1726, 1756, 1850`, `graphs/LinkForm.svelte:97`).
- **Signal edges that relied on the card's border keep a border of their own**: the next-step edge in
  `sidebars/ConnectionsSidebar.svelte` (~164–166, applied ~1529), the default tile in `loadouts/LoadoutsGrid.svelte`
  ~45, the set-value marker `CardStatsTab.svelte:480`, and in Admin `admin/sections/network/Page.svelte:334`
  (`border-warning-500`), `components/admin/AdminChangeForm.svelte:159` (`border-error-500/60!`). Add an explicit
  `border` beside the colour so they still show. `admin/sections/overview/Page.svelte:356` used a border colour as
  its hover cue: move the cue to the fill. Grep every `panel-card` site that adds a `border-*` colour or style and
  expects the utility's width (`connections/JobsGrid.svelte` ~131, ~167 does, but nothing imports that file: leave
  it and say so). `lorebooks/time/MomentBar.svelte` ~116 already carries its own `border`: leave it.
- **A hand-written box whose fill equals what it sits on must not vanish** (these are not `panel-inset`):
  `sidebars/TagsSidebar.svelte:772`, `CustomThemeEditor.svelte:303`, `CustomThemeManager.svelte:271`. Give each the
  other ground so it reads, or keep its edge, and say which you chose.
- Do **not** touch `panel-edge`: it is colour only, used by structural lines.

### Step 2 — mistakes, and separators the guide already forbids

- Borders with no colour or a colour that does not exist: `sprites/SpriteContactSheet.svelte:197`,
  `sprites/SpritesTab.svelte:1149`, `connections/ConnectionCapabilities.svelte:221`,
  `connectionForms/OllamaForm.svelte:265`, `connectionForms/LlamaCppForm.svelte:224`,
  `sidebars/SamplingValuesForm.svelte:304`. Unpaired stops: `graph/GraphVisualization.svelte:1240`,
  `connectionForms/ImageConnectionForm.svelte:270, 296, 358`, `connections/comfy/ComfyDrawTest.svelte:188`,
  `pipelines/PipelineConfigOptions.svelte:1521`. Give each the hairline pair (`border-surface-200-800`), or the
  stronger `300-700` where it is a dashed drop zone, or remove it where it is a separator (next bullet).
- Separators between sections or inside a card (rule 4): `settingsTabs/TotpSettings.svelte:259`,
  `userForms/InvitePanel.svelte:229, 260`, `media/MediaManagerTab.svelte:937`,
  `settingsTabs/ImportSettingsTab.svelte:915`, `sidebars/ConnectionsSidebar.svelte:1887`,
  `sidebars/HelpSidebar.svelte:664`, `sessionForms/SessionRunsTab.svelte:256`,
  `lorebookForms/EntryFireTest.svelte:409`, `lorebooks/sections/EntryInspector.svelte:136`,
  `pipelines/PipelineConfigOptions.svelte:1521`, `connectionForms/ImageConnectionForm.svelte:270`,
  `graph/GraphVisualization.svelte:1240`, `connectionForms/KoboldCppManagedForm.svelte:289` (`<hr>`),
  `lorebooks/cast/CastMemberForm.svelte:1196` (`<hr>`), `connections/ConnectionIndexView.svelte:653` (`<hr>`),
  `loadouts/LoadoutsGrid.svelte:28`, `CustomThemeEditor.svelte:307, 336`. Replace each line with spacing (the gap
  the surrounding stack already uses, or one step more), never with another rule. Where the line separates two
  real sections inside one card, a `panel-inset` or a second card is the guide's answer; choose the smaller change.
- Row dividers in lists (`sidebars/ActivitySidebar.svelte:1015, 1018` nested `divide-y`,
  `connections/comfy/WorkflowFittingForm.svelte:180, 245`, `comfy/ComfyWorkflowsTab.svelte:167`,
  `connections/ModelTable.svelte:162, 307`): remove the nested duplicate in Activity; leave table and list row
  dividers otherwise and list them in the report as a ★.

### Step 3 — boxes whose only boundary is an outline get a quiet fill instead

About 30 boxes have no fill, so their border is all that groups them: the seat rows in
`EditSessionForm.svelte` (~2352, 2456, 2529, 2635, 2737, 3098), `sessionForms/BenchedSeatRow.svelte:43`,
`CharacterPickRow.svelte:173`, `loadouts/sheet/ModelCard.svelte:197`, `SessionAnnexPanel.svelte:185, 268`,
`speech/SpeechSettingsBlock.svelte:254`, `BookRulesCard.svelte:126`, `DerivedEntryEditor.svelte:215`,
`KeptImprintNote.svelte:50`, `graphs/TieSidesBlock.svelte:90`, `places/ExitsLineLinks.svelte:263, 288`,
`places/PlaceStats.svelte:277`, `places/PlaceLinks.svelte:495, 586`, `characterForms/StrokeField.svelte:78`,
`EntryFireTest.svelte:283`, `TemplateLayoutsList.svelte:132`, `TemplateEditor.svelte:401`,
`ConnectionStopScripts.svelte:81`, `InvitePanel.svelte:268`, `MediaManagerTab.svelte:830`,
`CastWorkspace.svelte:1372`, `CastDuplicatesPanel.svelte:242`, `ConnectionsSidebar.svelte:1208`,
`AudioCppModelsTab.svelte:200`, `KoboldCppBinaryVariantPicker.svelte:373`, `pipelines/SchemaForm.svelte:596`,
`PipelineConfigOptions.svelte:2553`, `ImageConnectionForm.svelte:296, 358`.

Rule: a fill-less box takes **the other of the two grounds from its immediate parent** (`bg-surface-50-950` ↔
`bg-surface-100-900`), with no border, judged after step 1. An inset counts as a parent (`50-950`), so a box in an
inset is `100-900`. Keep its radius and padding. **Where the parent's ground depends on the width** (the lorebook
editors: `places/PlaceLinks`, `places/PlaceStats`, `places/ExitsLineLinks`, `KeptImprintNote`, `graphs/TieSidesBlock`,
and anything else rendered both inside a card at desk width and on the bare ground at dock width), keep the edge
as `panel-edge border` and list it in the report with the inset ★. Where the box is interactive and used a border colour change as its hover or selected cue,
move the cue to the fill (`hover:bg-surface-200-800`, the row-hover stop) and keep any selected ring.
**Do not invent a new shared class**; if one recipe repeats (the seat row appears six times in one file plus two
components), say so under Noticed, not done.

## Never touch (these borders carry meaning)

Form controls and their error states; fieldsets and radio marks; dashed drop zones, "add" tiles and empty states
(`EmptyState.svelte`, `FileDropzone.svelte` and the like); warning, error and success edges; the selected-row
marker and selected rings; the tab strip's underline (`panels/PanelTabStrip.svelte`); the list/detail line
(`panels/PanelSplit.svelte`, `panels/SectionList.svelte`); pinned footers' `border-t`; menu-group hairlines in
popovers; the timeline axis, crop mask, indent and quote bars; outlined service chips and pills (leave all chips
and pills; list them as a ★); thumbnails' and swatches' frames.

## Also

- `STYLE-GUIDE.md` in the same change: the card's definition (no border; the fill is the edge), that the inset
  keeps its hairline for now and why, the fill-less box rule from step 3, and every sentence that says a card has a
  border (~104, ~115, ~237, ~1150, ~1205–1219). Keep the dated notes there (2026-10-02 at ~1211, 2026-10-24 at
  ~233) and mark them superseded for cards by the owner's go of 2026-11-12, so the guide keeps its history. Keep it
  a rule a newcomer can apply.
- Tests that pin these class strings (grep `panel-card`, `border-surface-200-800` under `src/**/*.test.*`): update
  to the new strings, never weaken.

## Files owned

`src/app.css` (`panel-card` only), the components named above (the three Admin files for their signal edge and
hover cue only), `STYLE-GUIDE.md`, the tests that pin their classes. Other sessions are editing server files, `PanelSplit.svelte`, `Layout.svelte`, the home page and
`UserSettingsTab.svelte` today: do not touch those.

## Out of scope

Any change of layout, spacing scale, radius, colour stops or copy beyond what replacing a line with a gap needs;
new components, utilities or props; the home page; session widgets; Admin-only components (they change only
through the shared utility).

## Stop and ask when

Removing a border would make something unreadable in either theme and no ground step fixes it; a signal colour
would be lost; a change would need a new shared class or prop.

## Done means

`NODE_OPTIONS=--max-old-space-size=12288 npm run check` shows no new errors; the touched tests pass (run only
inside `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run
--maxWorkers=3 <files> > <log> 2>&1"`, never two runs at once); `grep` shows no `border` left on a `panel-card` site
except the signal edges. Never `git commit`, `stash`, `checkout` or `restore`; never
`prettier --write` a directory. At most two workers at once, split by directory so no two edit one file.

## Report

Return the full report as your final message: per step, what changed and where (counts per directory); every place
you kept a border and why; every inset or box you gave a different fill; the style guide's new wording; tests;
open ★ (table rows, chips and pills, anything you were unsure of); **Noticed, not done**. Say plainly that nothing
was looked at in a running app: the lead and the owner will.
