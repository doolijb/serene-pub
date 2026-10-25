# REPORT — polish lane B: colour restraint and toasts (2026-10-24)

Built: L4.1–L4.5, the §5.4 L4 additions, L13.6 (notify facade), ★R2, ★R4. Nothing in the SDK;
widgets.css / messageLayouts.css untouched (lane A's).

## What changed
- **★R4 beta notice** — `components/BetaNotice.svelte` + `betaNotice.ts`: one dismissible line on
  Home ("Beta, pre-release {version}. Expect changes; keep backups of anything you can't lose."; a
  release build drops "pre-release"); dismissal remembered per browser and per version. Wizard shows
  none. Document View footer carries the same sentence. Login "beta" no longer ember.
- **★R2** — new `@utility preset-pressed` in app.css (surface step, ink text, 2px gold bar at the
  foot) for the All/Your turn/Favorites chips, every ON toolbar toggle (`panels/toolbarButton.ts`),
  the lorebook lens track, rules presets + "How strict" radios, the cast Suggestions toggle. Rail
  active item and selected tab label are ink with the bar kept (Layout.svelte, PanelTabStrip). Home
  "Your turn" pill = tonal surface + gold dot. KoboldCPP "Recommended" badge → tonal primary.
- **Connections status** — `connectionRowStatus.ts` (+6 tests): 6px dot + 13px muted words; red +
  3px error bar + filled Fix ONLY when `RowStatus.blocked` (broken and fills a default loadout —
  the Admin Needs you predicate, now shared as `src/lib/shared/loadouts/loadoutsFilledBy.ts`,
  used by `sockets/adminOverview.ts`). Start filled on the row that can start. `stateTone` retired.
  ConnectionRow/ConnectionCard/liveStatus/ConnectionIndexView/admin connections Page updated.
- **Light mode** — `@utility text-primary-ink` (gold in dark; Lamplight light stop = primary-950,
  6.3:1; primary-700 measured 2.5:1) swept across 54 files of primary-coloured text. Filled primary
  in light = primary-600 via `--sp-primary-fill-light` (lamplight.css; `preset-filled-primary-500`
  redeclared in app.css to read it).
- **Toasts** — `utils/toaster.ts` exports a configured toaster (errors/warnings 8s, success/info
  4s). `utils/notify.ts` (+test): `source` dedupe (id `notify:<source>`), `silent`, `fromPoll`
  (logged + dropped with a TODO: no client-side API raises an Activity notification yet). Layout's
  catch-all (where the Ollama toasts actually came from; `POLLED_ERROR_EVENTS`) and
  `contexts/connections.svelte.ts` sync errors go through notify. Dark/Light-mode and "Theme
  updated" toasts removed.
- Docs/guides: STYLE-GUIDE §2.1, §2.3–§2.6, §6.1, §6.3, §6.5, §6.11, §6.21; NOMENCLATURE §10 + four
  §25 rows; docs/connections.md, docs/getting-around.md ("Pop-up messages"), docs/getting-started.md.

## Needs the owner's word (🚧 in STYLE-GUIDE)
1. §6.1 said a managed-process Start is `preset-tonal-success`; the plan says filled. Built filled.
2. 13px text written as `text-[13px]` pending L13's utility (`text-chip`).
3. BetaNotice uses `rounded-[10px]` until L13.3 makes `--radius-base` 10px.
4. Light-mode primary text stop is primary-950, not the brief's primary-700 (contrast).

## Skipped (listed as ⏳ in STYLE-GUIDE §2.4)
~55 other pressed `preset-tonal-primary` sites (admin network/pipelines/scripts/session-presets,
lorebook workspaces, wizard, pipelines library, CustomThemeEditor, ModelFinder, SetupChatFlow,
Onnx, SessionRoutineRow, GeneratePortraitDialog, StartAskField, LoadoutSheet, MediaManagerTab,
PresetBindingsRows, AdminChangelist, AdminList, ConnectionServicePicker, SamplingSidebar,
LibraryView, CollectModal, RunsPanel, PipelineMap) — a mechanical swap of the ON branch to
`preset-pressed`. Filled primary kept on: EntryMarks priority badge (three-colour scale, own
ruling), EntityGalleryTab selected-image check, tag-colour fallback. `text-primary-500` on icons
kept per §2.3. ~425 other `toaster.*` calls not converted (they get the new defaults). The single
connection view's status card keeps its own red.

## Tests / typecheck (verbatim)
A 16-file batch was Killed by the 3G cap; rerun in groups/singly under the cap:
notify + connectionRowStatus + layoutHandledErrors + server/admin/attention: Test Files 4 passed (4) Tests 74 passed (74)
avatar.ssr 13 · indexRows.ssr 10 · firstRunDoors.ssr 5 · newViews.ssr 23 · jobPickerDialog.ssr 9 · loreRail.dom 15 ·
contexts/connections.dom 5 · connectionsList.dom 19 · sceneRunSaidOnce.dom 4 · readOnlyLenses.dom 12 · memberPage.dom 5 ·
settingsImportSection.dom 3 · helpPage.ssr 3 · startSessionRules.dom 16 · i18n/state 14 · helpLinks 22 — all "1 passed (1)".
`npx tsc --noEmit -p .` needs `--max-old-space-size=5500` (6.5G scope): exit 2, one error NOT in this lane's files:
  src/lib/client/sessionLayout/arrangeCanvas.dom.test.svelte.ts(11,25): TS2614 '"*.svelte"' has no exported member 'NARROW_SIDE_PX'
svelte-check --threshold error (7G scope): 1 error, not this lane's file:
  src/routes/sessions/[id]/+page.svelte 253:16 Cannot find name 'hasGeneratingMessage'  (likely lane A mid-edit; recheck after A)
app.css compiled through @tailwindcss/node: new utilities emitted; redeclared preset overrides Skeleton's.

## Contrast (Lamplight, computed): on surface-50 — primary-500 1.55:1, -700 2.54:1, -900 4.58:1, -950 6.32:1.
Dark ink on filled: 11.28:1 (500), 8.90:1 (600).

## Visual walk list
Home (beta line + × + reload; Your turn pill; All N; one gold fill) · wizard (no beta line) · login footer ·
Document View footer · rail narrow/wide + phone bottom bar · pressed toggles (Sessions chips, toolbars in
Sessions/Characters/Connections/Models/Users/Loadouts, lorebook lens track) · Connections index list+cards at
Dock/Half (quiet rows, the one blocked row red, stopped KoboldCPP filled Start, neutral hover) · Admin Connections
Status column · Ollama host down → no toasts · Themes toggles → no toast · toast 8s + dedupe · light-mode gold text
sites · Cast Suggestions, How strict, Rules presets, KoboldCPP Recommended.
