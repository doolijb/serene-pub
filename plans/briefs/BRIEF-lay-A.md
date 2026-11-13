# BRIEF lay-A — SDK layout format v2

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-lay-common.md` first, then `RECON-layout-sdk.md` and PLAN §3 D1–D6, D15. Also `../serene-pub-sdk/INTEGRATING.md` sections that mention layouts/panels (grep).

## Goal
Make **panels v2** the SDK's layout arrangement: three plain zone stacks, no pin, a per-panel `priority`, layout look (`backing`, `opacity`, `gap`) inside `panels`, and ONE pure converter that every reader and the app's boot pass reuse.

## Build
1. Types (sdk/src/sessionLayout.ts): `PanelPriority = 'high'|'normal'|'low'`; `PanelBacking = 'card'|'glass'|'none'`; `PanelGap = 'tight'|'comfortable'|'spacious'`; `PanelV2 { key; tabs; open?; height?: PanelHeightV1; priority?: PanelPriority; title? }`; `PanelLayoutV2 { version: 2; left: PanelV2[]; middle: PanelV2[]; right: PanelV2[]; backing?; opacity?; gap? }`; `SessionLayoutV1.panels?: PanelLayoutV1 | PanelLayoutV2`. Constants `PANEL_GAP_PX = { tight: 4, comfortable: 12, spacious: 24 }`, defaults card / 100 / comfortable. 🚧 provisional names.
2. Converter `panelsV2Of(layout, opts?: { widgetSettings?: Record<instanceId, Record<string, unknown>>; widgetStyles?: Record<instanceId, string> })` → `{ panels: PanelLayoutV2; settingsMoves: Array<{ from: string; to: string; key: string; value: unknown } | { drop: string; key: string }>; styleCopies: Array<{ from: string; to: string }> }`. Pure, idempotent (a v2 input returns itself and no moves). Accepts old slots (via `panelsFromSlots` then v1→v2), v1, v2. Rules exactly as PLAN D2 (flatten middle `[...above, primary, ...below]`; drop `pinned`; for each panel holding a Messages tab whose EFFECTIVE `showComposer !== false` — effective = layout's widgetSettings over the widget's default — insert a `turn-line` panel (height fit) unless `nextUp === 'hidden'`, then a `composer` panel (height fit), right after the panel (right before when `composerPosition === 'top'`); ids from `conversationSplitIds` of the first composing Messages instance; skip both when the layout already places any `composer`; new panel keys continue the `p<n>` counter; moves: `composer`, `otherTabsComposer`, `showActions` → the Composer; `nextUp` → the Turn line; drop `composerPosition`, `showComposer`, `showMessages`, `hostCard`, `backingMode` everywhere; styleCopies: the Messages instance's pinned style id → the new Composer and Turn line ONLY when they have none (D8 also makes them wear it at render, so this is belt-and-braces for export); no look written).
3. Readers: `panelsOf` returns `PanelLayoutV2` always; `storedPanels` accepts v2; `panelTabs`, `layoutWidgetIds`, `middleWidgetIds` walk v2. Defensive per RECON (unknown version → as absent; stray v1 keys on v2 ignored; bad look values → defaults; opacity clamped).
4. `resolveDrawn` → `DrawnLayout { left; middle; right: DrawnZone; look: { backing; opacity; gap; gapPx } }`, `DrawnPanel.priority` resolved panel → open tab's `WidgetDecl.panel.priority` → `'normal'`; `DrawnPanel.height` default from the open tab's `WidgetDecl.panel.height` when the panel has none, else today's default; floor = a middle panel marked `floor: true`. Keep ⏳ deprecated: `PanelMiddleV1`, `DrawnMiddle`, `pinnedOf`, `pinned` fields (always absent/true as the envelope needs), `ZoneRung`, `DEFAULT_SIDE_RULES`, `DEFAULT_STRIP_RULES`, `zoneRungAt` — exported, unused by v2 readers, JSDoc `@deprecated ⏳ removed at 0.7 (owner's call)`.
5. Validator: accept v2 (error on empty middle "the middle is never empty", on `pinned`/`above`/`primary`/`below` inside a v2 panels, on bad priority/backing/gap/opacity); v1 still accepted with a WARNING `panels-v1` ("converted on read"); keep the conversation-missing warning (now: no `messages` anywhere).
6. `RETIRED_WIDGET_IDS`: remove `composer`; add `LEGACY_SLOT_DROPPED = new Set(['composer'])` used ONLY by the old-slot path (`convertSlots`/`panelsFromSlots`) so slot-era blobs never revive a composer.
6b. Export the pure helper `conversationSplitIds(instanceId) → { composer: string; turnLine: string }` (`messages`→`composer`/`turn-line`; `messages#x`→`composer#x`/`turn-line#x`) and use it inside `panelsV2Of` (no collision numbering needed: a v1 layout never holds a `composer`).
7. `WidgetDecl.panel?: { height?: 'fit'|'fill'; priority?: PanelPriority }` (sdk/src/layout.ts), validated in `widget()` (sdk/src/widgetDecls.ts).
8. CLI `genreLayouts` (cli/src/compiler.ts:2054–2134 only): namespace ids in a v2 middle array; leave v1 handling.
9. Envelope docs only in sdk/src/widgets.ts are lay-B's file — queue the `chrome.card` / `LayoutV1.pinned` doc change in your report for lay-B.

## Files owned
`../serene-pub-sdk/sdk/src/sessionLayout.ts`, `sdk/src/layout.ts`, `sdk/src/widgetDecls.ts`, `sdk/src/index.ts` (exports only), `cli/src/compiler.ts` (genreLayouts only), `sdk-tests/{sessionLayout,panelsFromSlots,resolveDrawn,widgetDecls,widgetAliases}.test.ts`, new `sdk-tests/panelsV2Of.test.ts`, new `sdk-tests/fixtures/core-layouts-old-slots.ts` (freeze the CURRENT v1 shipped literals there so panelsFromSlots' golden stops reading the shipped ones).

## Files readable
Everything in both repos.

## Out of scope
core-catalog (lay-B: widget decls, layouts.ts, components); the app (lay-C/E). Do not run `sdk:build` (the lead builds after lay-B).

## Stop and ask when
A rule in D1–D6 can't hold; a name collides; a test outside your owned list breaks (report it, don't fix — lay-B owns catalogue tests).

## Done means
`cd ../serene-pub-sdk && npx tsc --noEmit -p sdk` (or the package's tsc) clean; `npx tsx --test sdk-tests/{sessionLayout,panelsFromSlots,resolveDrawn,widgetDecls,widgetAliases,panelsV2Of}.test.ts` green. Report `plans/REPORT-lay-A-2026-11-05.md`.
