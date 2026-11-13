# RECON — SDK + core-catalog side (2026-11-05, read-only Plan agent; lead decisions in PLAN §3 override its ★s)

Paths under /home/jody/github/serene-pub-sdk unless "app".

## Findings
1. Layout types — sdk/src/sessionLayout.ts (re-exported sdk/src/index.ts:182, `@experimental`):
- `PanelHeightV1` (:436) stays. `PanelV1` (:443–459) `key, tabs, open?, pinned?: false, height?, title?`. `PanelZoneV1` (:462), `PanelMiddleV1` (:469–473 above/primary/below), `PanelLayoutV1` (:485 version 1), `SessionLayoutV1` (:497–510); `SLOTS` (:1269).
- ⚠ `look` is in `RETIRED_DOCUMENT_KEYS` (:1272) → validator ERRORS on a top-level `look`. Put look inside `panels`.
- Converter/readers: `panelsFromSlots` (:835), `convertSlots` (:671), `storedPanels` (:840), `panelsWithFloor` (:847) hard-check version 1 + middle.primary; `panelsOf` (:858), `panelTabs` (:866), `layoutWidgetIds` (:891), `middleWidgetIds` (:902) walk above/primary/below.
- Pin/rail: `pinnedOf` (:995), `LayoutZoneRule.mode` 'rail'|'icons'|'drawer' (:274), `LayoutZoneDef.pinned` (:299), `ZoneRung` (:915), `DEFAULT_SIDE_RULES` (:935), `DEFAULT_STRIP_RULES` (:954), `zoneRungAt` (:964); consumed in app simulator.ts, sideSlot.ts, LayoutEditorToolbar.svelte.
- Drawn model: `DrawnInstance.pinned` (:1016), `DrawnPanel.pinned` (:1031), `DrawnZone.pinned/.rung` (:1066/:1072), `DrawnMiddle` (:1084–1090), `resolveDrawn` (:1139–1204).
- Validator `validateSessionLayout` (:1334); panels block :1516–1568 errors on pinned + v1 shape; conversation-missing only a WARNING (:1563). `MIDDLE_EMPTY` is the APP's (app arrangeOps.ts:27); SDK enforces it implicitly via "primary has ≥1 tab" (:1527).
- `RETIRED_WIDGET_IDS = new Set(['composer','inventory'])` (:157; doc :143–146). A new `composer` widget must come off this list.
- Envelope sdk/src/widgets.ts:108–135: `LayoutV1.pinned`, `collapsed`, `drawered`, `chrome.card` (doc = hostCard).
2. Widget declarations: `WidgetDecl` (sdk/src/layout.ts:118–221) has NO height/priority; only ⏳ `layout` packing hints (:204–211). `widget()` validates in sdk/src/widgetDecls.ts:128–146. Core decls: core-catalog/src/registry/widgets.ts `CORE_WIDGETS` (:48); handles `coreWidgets` (:1487–1525); messages :64 (settings composer :82, otherTabsComposer :111, composerPosition :128, showMessages/showComposer :213/:218, nextUp :401, showActions :414); scene-portraits :423; lore-entries :640; stats :702; turn-order :963; authors-note :1463. `CORE_COMPONENTS` (:1532).
- Pruning trap: layout.ts:183–185 — a field dropped from a schema has stored values pruned on next reconcile.
- `turn-line-*` / `next-up-*` are style PARTS of `messages` (guides/widgets.md:54).
3. Shipped layouts: core-catalog/src/registry/layouts.ts — STORY :52, STORY_WORLD :97, LAIR :182, LAIR_PARTY :230, DUNGEON_CRAWLER :304 (messages#journal/#table showComposer:false at :343/:355). `layout()` calls genres.ts:684–686, :1454–1462, :1734–1735. Guide ships none (layouts.ts:7) → needs GUIDE_LAYOUT. `GenreLayoutDecl` (widgetDecls.ts:154–179), `layout()` (:184) throws on validator errors. CLI `genreLayouts` (cli/src/compiler.ts:2054–2134) walks middle.above/primary/below (:2072–2087). App ingest re-validates app src/lib/server/db/pluginLayouts.ts:286; app boot pass sessionLayoutPanels.ts + panelsFromStored.ts.

## Proposed (see PLAN §3 D1–D6 for the decided version)
- `PanelPriority`, `PanelV2`, `PanelLayoutV2 {version:2; left/middle/right: PanelV2[]; backing?; opacity?; gap?}`; `SessionLayoutV1.panels?: PanelLayoutV1 | PanelLayoutV2`.
- `panelsV2Of` converter (pure, idempotent); `panelsOf` returns v2; `storedPanels` accepts v2; `resolveDrawn` returns `{left,middle,right}: DrawnZone` with `DrawnPanel.priority` resolved panel → open tab's decl → 'normal', and `DrawnLayout.look` with defaults; floor = a middle panel marked `floor`.
- Defensive: unknown version reads like absent panels; stray pinned/above/primary on v2 ignored; bad priority/backing/gap → defaults; opacity clamped 0–100.
- Validator v2: error middle empty; error `pinned` on v2; error bad priority/backing/gap/opacity.
- `WidgetDecl.panel?: {height?, priority?}` validated in `widget()`.
- Added names: PanelV2, PanelLayoutV2, PanelPriority, PanelBacking, PanelGap, panelsV2Of, PANEL_GAP_PX (4/12/24), WidgetDecl.panel, coreWidgets.composer, coreWidgets.turnLine.

## Tests (sdk-tests/)
sessionLayout.test.ts (24; panels block :336–411, core genres :413); panelsFromSlots.test.ts (16; golden at :46–67 compares SHIPPED literals → freeze v1 literals into fixtures/core-layouts-old-slots.ts); resolveDrawn.test.ts (23; ~45 pinned + ~40 rung hits — largest rewrite); new panelsV2Of.test.ts; touch widgetDecls.test.ts, widgetAliases.test.ts, coreCatalog.test.ts, lair.test.ts, lairSanctumTab.test.ts, dungeonCrawler.test.ts, dungeonCrawlerWalk3.test.ts, coreConversationComponent.test.ts, coreScenePortraits.test.ts. `npm run sdk:test` = tsc + tsx --test over 283 files.

## Docs
guides/widgets.md:259–305 (example :280–289 uses primary + pinned:false; parts list :54); sessionLayout.ts header :1–62; layouts.ts header :24–40; widgets.ts chrome.card doc :120–135; RETIRED_WIDGET_IDS doc.
