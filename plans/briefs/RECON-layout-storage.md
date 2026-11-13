# RECON — storage, boot pass, docs/vocabulary (2026-11-05, read-only Plan agent; lead decisions in PLAN §3 override its ★s)

No schema migration needed (JSON/row data only). Two blockers: (A) the boot prune deletes Messages' composer settings before the pass moves them — decided D5: keep them declared hidden ⏳; (B) top-level `look`/`version` are retired document keys — decided D1: look inside `panels`.

## 1. Storage
- `session_panel_layouts` (schema.ts:7697): `layout` json (:7715: panels, ⏳ old slots, active/tierSizeOverrides); `layout_settings.widgetStyles` (:7742) style pins; `layout_copied_at` provenance.
- `session_layout_presets` (:7783): `layout` blob (:7820) panels + widgetSettings + widgetStyles; origin core|plugin|pub|user; `pub` rows not reseeded.
- `widget_settings` (:8007) keyed by `widget_instance_id` (:8018), non-default values only; prune `syncWidgetSettings` (db/widgetSettings.ts:50) runs inside `dbReady` (db/index.ts:779-780) on version change, before startup tasks.
- `widget_styles` (:7928): a pin resolves only when the style's `widgetSlug` equals the widget id (shared/widgets/resolve.ts:39,55).
- `user_layout_defaults` (:7884) preset id SET NULL.
- Core genre layouts: `syncLayoutPresets` (layoutPresets.ts:164) reseeds every boot from core-catalog layouts.ts; deletes undeclared core rows (:249-260).
- Plugin layouts `syncPluginLayouts` (pluginLayouts.ts:226, validated :286) → rows equal to manifest (stay v1).
- Copy into a session `copyLayoutIntoSession` (layoutPresets.ts:759) via `arrangementOf`/`ARRANGEMENT_SLOTS` (:614-631); unpacks widgetSettings :776, :855-863. Export `exportedSessionLayout` (panelsFromStored.ts:51).
- Sockets (sockets/sessions.ts): `sessions:panelLayout:get` 4023, `:startFrom` 4301, `:set` 4464 (writeWidgetSettings 4516; validates 4428), `:startedFromUpdated` 3996; `sessions:layoutPreset:save` 4551, rename/delete/usage/share/clone, `update` 4883, `setNewSessionLayout` 4949. widgetStyles sockets sockets/widgetStyles.ts:333-532.
- SDK: PanelV1.pinned 454, PanelMiddleV1 469, PanelLayoutV1 485; panelsOf accepts only version 1 with middle.primary (843, 858); one-conversation rule 1563.

## 2. Existing boot pass db/sessionLayoutPanels.ts
Step 1 `completeSessionLayouts` (:75) per-row transaction, log+skip failures; step 2 `convertTable` (:233) compare-and-set where panels IS NULL; converts sessions + origin='user' presets (:276-279). Startup task `session-layouts` (startup/index.ts:425-432) after `layout-presets` (:380) and `plugins`. Tests sessionLayoutPanels.int.test.ts, idempotence :567 ("a second run converts nothing and changes nothing") and :303.
- Collision C: `composer` in RETIRED_WIDGET_IDS (sessionLayout.ts:157); old slots / stale widget_settings rows may name `composer` → keep old-slot readers dropping them (`LEGACY_SLOT_DROPPED`).
- Style packs target `messages.compose*` under the messages widget; pins match by widget id → decided D8 (Composer/Turn line wear their target's style).

## Proposed step 3 (decided form PLAN §3 D2, D14)
`convertPanelsToV2` in the same task: rows where `layout->'panels'->>'version' = '1'`; per-row transaction on session_panel_layouts (layout write + moved widget_settings rows + layout_settings.widgetStyles copy; delete stale composer*/turn-line* rows for that user+session first); presets origin IN ('user','pub') rewriting widgetSettings + widgetStyles in the blob, `layout_updated_at` untouched; core rows reseed; plugin rows convert at read/copy; floor-only rows (old slots, no panels): leave layout, move only bare messages settings. `:set` and `layoutPreset:save` normalize v1→v2 server-side.

## Tests
sessionLayoutPanels.int.test.ts step-3 block: rail panel opens; above/primary/below flatten in order; composerPosition top → before; showComposer:false (DC messages#journal) → none; Lair Story·Sanctum tabs → one composer; settings move to right widget_settings rows; stale composer row replaced; user + pub presets convert with layout_updated_at unchanged; core + plugin rows byte-identical; failing row rolls back, next converts; SECOND BOOT: zero counts and identical snapshot of all three tables incl. updatedAt. Boot-order int test: a moved Messages key survives a version-change boot (layoutPresets.boot.int.test.ts style). SDK: panelsV2Of from v1 and old slots; v2 passthrough; validator. copyLayoutIntoSession from a v1 plugin preset writes v2 + splits widgetSettings; exportedSessionLayout emits v2.

## 3. Docs and vocabulary (sources docs/*.md; src/lib/generated is gitignored, rebuilt by `npm run docs:build` / the Vite plugin)
- docs/session-layout.md: :100-123 (composer settings, Show messages/composer, Card Auto/On/Off), :234-249 (gear, pin, settings window, Card), :282-327 (Arrange, Panels and the rail, The main panel), :341 (Rails preview), :345-378 (phones, Full screen), :382-392 (storage, ids); new sections Composer + Turn line widgets, priority, backing/opacity/gap.
- docs/genre-lair.md:58-60, docs/genre-dungeon-crawler.md:45 (Session panels menu); docs/sessions.md:132,583; docs/getting-around.md:170-178 (Full screen + session side zones; its rail/Alt+[ text is the APP rail and stays); docs/component-authoring.md:166 (settings window); SDK guides/widgets.md:261-299.
- NOMENCLATURE §9 retire into §23: primary panel (:494), strip of the middle (:495), docked · in the rail (:496), rail strip (:497), pin rule `pinnedOf` (:525), host card (:552), message backing · backing mode (:553). Amend: panel (:492), panel height (:498), panel tab (:493), zone (:517), turn line (:516, now a widget), composer skin (:514), primary floor (:505), session layout (:524). Add: Composer / Turn line widgets, priority, zone switch, widget gap, backing (layout), `--sp-widget-*` (🚧 §24). §26 amend: Full screen, furled header. §25 ledger rows for each.
- STYLE-GUIDE: §5.1 :468-470; §5.3 :622-707; §6.5 :1188-1201; §6.7 :1280-1290; §6.16 :1822-1880 (parts move/alias).

## 4. Collisions
Working tree heavily uncommitted (owner commits on own schedule — not a risk by itself). Another programme (`cv-*`, briefs plans/briefs/BRIEF-cv-*.md) has a queued lane `cv-fix` touching `sockets/sessions.ts`, `schema.ts`, `drizzle/**` (regenerating 0146), `sockets/import.ts`, a startup sweep. Lanes editing `sockets/sessions.ts` or `startup/index.ts` must re-read right before each edit and keep hunks minimal. A tsc error in `arrangeCanvas.dom.test.svelte.ts` predates this work.
