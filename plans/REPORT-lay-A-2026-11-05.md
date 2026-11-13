# REPORT lay-A (2026-11-05)
(Saved by the lead from the supervisor's final message; subagents can't write report files.)

Status: complete. 6 targeted files 149/149 pass; SDK tsc (`npx tsc --noEmit -p sdk/tsconfig.build.json`) clean; sdk-tests tsc 0 errors at run time. No sdk:build run.

## Exported names (sdk/src/sessionLayout.ts unless noted; new = 🚧 @experimental)
- `PanelPriority = 'high'|'normal'|'low'`; `PanelBacking = 'card'|'glass'|'none'`; `PanelGap = 'tight'|'comfortable'|'spacious'`; `PANEL_GAP_PX = { tight: 4, comfortable: 12, spacious: 24 }` (frozen); `interface PanelLook { backing; opacity; gap }`; `DEFAULT_PANEL_LOOK = { backing:'card', opacity:100, gap:'comfortable' }`.
- `interface PanelV2 { key; tabs; open?; height?: PanelHeightV1; priority?: PanelPriority; title? }`; `interface PanelLayoutV2 { version: 2; left; middle; right: PanelV2[]; backing?; opacity?; gap? }`; `SessionLayoutV1.panels?: PanelLayoutV1 | PanelLayoutV2`.
- `panelsV2Of(layout: SessionLayoutV1, opts?: PanelsV2Options): PanelsV2Conversion`; `PanelsV2Options extends PanelsFromSlotsOptions { widgetSettings?: Record<id, Record<string, unknown>>; widgetStyles?: Record<id, unknown> }`; `PanelSettingsMove = { from; to; key; value } | { drop; key }`; `PanelsV2Conversion { panels: PanelLayoutV2; settingsMoves: PanelSettingsMove[]; styleCopies: Array<{ from; to }> }`.
- `conversationSplitIds(instanceId) → { composer; turnLine }`; `LEGACY_SLOT_DROPPED = {'composer'}` (old-slot path only); `RETIRED_WIDGET_IDS = {'inventory'}`.
- Changed: `panelsOf(layout, opts?: PanelsV2Options): PanelLayoutV2` (was V1); `resolveDrawn(layout, box, opts?: ResolveDrawnOptions): DrawnLayout`, `ResolveDrawnOptions { widgets?: readonly Pick<WidgetDecl,'id'|'panel'>[] }`; `DrawnLayout = { left; middle; right: DrawnZone; look: PanelLook & { gapPx } }` (middle was DrawnMiddle); `DrawnPanel.priority: PanelPriority` (new, required).
- sdk/src/layout.ts `WidgetDecl.panel?: { height?: 'fit'|'fill'; priority?: PanelPriority }`; `widget()` (widgetDecls.ts) refuses bad panel/height/priority.
- ⏳ `@deprecated ⏳ removed at 0.7 (owner's call)`, still exported + working, unused by v2 readers: `PanelMiddleV1`, `DrawnMiddle`, `pinnedOf`, the `pinned` fields on PanelV1/DrawnInstance/DrawnPanel/DrawnZone (drawn ones always true), `DrawnZone.rung`/`zoneKey` (no longer set), `ZoneRung`, `DEFAULT_SIDE_RULES`, `DEFAULT_STRIP_RULES`, `zoneRungAt`. Nothing removed or renamed.

## Behaviour
- `panelsV2Of`: pure/total/non-mutating; stored v2 returns the same object, no moves; else reads v1 or old slots (via panelsFromSlots); middle = `[...above, primary, ...below]`; drops `pinned` + unknown keys; per panel the FIRST tab that's a `messages` copy with effective `showComposer !== false` → after it a `turn-line` (fit) then a `composer` (fit) panel; `composerPosition:'top'` → before; no turn-line when `nextUp === 'hidden'` (legacy `showNudge:false` = hidden); nothing added if the layout already places a `composer`; new keys continue `p<n>` in order middle, left, right.
- settingsMoves: each messages copy sheds `composer`, `otherTabsComposer`, `showActions`, `nextUp` (move if that copy produced the widget, else drop); `composerPosition`, `showComposer`, `showMessages`, `backingMode` dropped on messages copies only; `hostCard` dropped on every widget. styleCopies only when the source messages copy has a pin and the new widget has none.
- Floor: when old slots place no conversation the converter supplies one; floor panel + its pair marked `floor: true`, skipped by id readers.
- Readers (`panelTabs`, `layoutWidgetIds`, `middleWidgetIds`, `drawnWidgetIds`) read v2 → on v1/slot layouts include the derived `turn-line` / `composer` ids.
- resolveDrawn: priority = stored → open tab's WidgetDecl.panel.priority → 'normal'; height = valid stored → declared panel.height → 'fill'; look read defensively, opacity clamped; `box` no longer read.
- Validator v2 errors: wrong shape; v1-style middle / above / primary / below ("one list of panels"); "the middle is never empty"; `pinned`; bad priority/backing/opacity/gap. v1 accepted with a warning starting `panels-v1:`. Conversation-missing warning looks across all zones. Old-slot `composer` placement warns "slot-era composer".
- CLI `genreLayouts` namespaces ids in v2's three lists; v1 branch unchanged.

## Decisions inside the brief
1 `DEFAULT_PANEL_LOOK` / `PanelLook` names. 2 named option/result/move types. 3 `opts.widgetStyles: Record<string, unknown>` (style id or WidgetStylePin). 4 `opts.*` REPLACES the layout's own widgetSettings/widgetStyles (no merge). 5 `hostCard` dropped everywhere; Messages-only keys dropped only on messages copies (protects plugin settings of the same name). 6 messages copies that produce no widget DROP the moved keys. 7 `showNudge:false` = `nextUp:'hidden'`. 8 floor = old primary + its pair. 9 stored v2 trusted as written (validator refuses empty middle; readers don't repair). 10 `sdk-tests/fixtures/core-layouts-old-slots.ts` gained V1_STORY_LAYOUT, V1_STORY_WORLD_LAYOUT, V1_LAIR_LAYOUT, V1_LAIR_PARTY_LAYOUT, V1_DUNGEON_CRAWLER_LAYOUT (snapshotted before lay-B); goldens + converter tests read these.

## Changed files
SDK: sdk/src/sessionLayout.ts, sdk/src/layout.ts, sdk/src/widgetDecls.ts, cli/src/compiler.ts (v2 branch; unused PanelV1 import removed), sdk-tests/{panelsV2Of (new), sessionLayout, panelsFromSlots, resolveDrawn, widgetDecls, widgetAliases}.test.ts, sdk-tests/fixtures/core-layouts-old-slots.ts. sdk/src/index.ts unchanged (already `export *`). Worker briefs plans/briefs/BRIEF-lay-A-w{1..4}.md.

## Tests
`cd sdk-tests && npx tsx --test sessionLayout.test.ts panelsFromSlots.test.ts resolveDrawn.test.ts widgetDecls.test.ts widgetAliases.test.ts panelsV2Of.test.ts` → 149 pass 0 fail (baseline 94). Info-only neighbours: lair.test.ts "two layouts: the GM's…" fails (expects no derived pair — goes when lay-B ships v2 Lair); lairSanctumTab.test.ts "declares the other tabs' composer" fails (lay-B's in-progress widgets.ts). CLI tsconfig reads SDK dist → compiler.ts typechecks there only after sdk:build.

## Names for §25 (🚧)
PanelPriority, PanelBacking, PanelGap, PANEL_GAP_PX, PanelLook, DEFAULT_PANEL_LOOK, PanelV2, PanelLayoutV2, panelsV2Of, PanelsV2Options, PanelsV2Conversion, PanelSettingsMove, conversationSplitIds, LEGACY_SLOT_DROPPED, ResolveDrawnOptions, DrawnPanel.priority, DrawnLayout.look, WidgetDecl.panel; ids `composer` un-retired (R8 2026-11-05 supersedes the 2026-09-16 merge), `turn-line` new; validator warning code `panels-v1`.

## Queued
- lay-B: sdk/src/widgets.ts envelope docs — `LayoutV1.pinned` always true, `collapsed`/`drawered` always false (D4); `chrome.card` = "this panel's backing is not none" (D9).
- lay-B: `sdk-tests/goldens/core-session-layouts.json` (sessionLayout.test.ts:697 compares shipped presets) must be regenerated when v2 literals ship.
- lay-B: catalogue tests reading v1 shapes — lairSanctumTab.test.ts:24–30, dungeonCrawler.test.ts:112–119 (`panels.middle.primary`), lair.test.ts:575 (exact layoutWidgetIds).
- lay-C/D/E: `DrawnLayout.middle` is a plain DrawnZone; `rung`/`zoneKey` never set; `panelsOf` returns v2; `resolveDrawn` takes `opts.widgets`; the boot pass calls `panelsV2Of(layout, { widgetSettings, widgetStyles })` and applies settingsMoves + styleCopies itself.

## Open ★
None.

## Noticed, not done
- descriptors.ts `widgetDeclsFindings` (plugin manifests, genre shape.panels) doesn't check `WidgetDecl.panel`; readers default bad values.
- The "already placed" check reads pre-addition panels: a malformed v1 placing one messages id in two panels gets two composers with one id.
- `layoutWidgetIds` on a slot layout whose arrangement shadows the grid lists shadowed ids via slotWidgetIds without a derived pair (by design).
- sessionLayout.test.ts genre comment still says panels v1.
- forGuests dropped by the CLI manifest type (compiler.ts:315) — known.
- Scratch files prefixed `lay-A-` in the lead session's scratchpad incl. `lay-A-shipped-v1-layouts.json`.

## Lead follow-up after the scope review (2026-11-05)
Scope review: no breach. Lead fixed in sdk/src/sessionLayout.ts `convertToV2`:
1. A `composer` written into a stored v1 is slot-era: dropped (LEGACY_SLOT_DROPPED applied to v1 tabs; a panel left empty goes; `open` cleared if it pointed there), so it never blocks the split nor turns moves into drops.
2. Settings and style pins LAYER per instance: the layout's own `widgetSettings`/`widgetStyles`, then `opts.*` over them (a caller key wins; a layout-only key still counts — e.g. a preset's `messages#journal: { showComposer: false }`). Callers apply each move to whichever store holds the key. (Supersedes decision 4.)
3. `showNudge` added to the dropped Messages keys.
Tests: panelsV2Of.test.ts updated (v1 composer dropped + split runs; v2 composer kept as written; layering; layout-declared reading pane survives caller rows; showNudge dropped; unique-keys assertion; two expectations that had duplicate `p2` keys corrected) and resolveDrawn.test.ts:634 retitled to the new rule. Run: the 6 files → 150/152; the 2 failures are `sessionLayout.test.ts` "core's genres declare the layouts they have always shipped" (story, lair) — the golden vs lay-B's in-progress layouts.ts, lay-B's queue. SDK tsc clean.
For lay-F: the validator warning "'…' is a slot-era composer — the old slots never draw it; place the Composer in panels" (new copy) and the `backingMode` drop being Messages-only.
