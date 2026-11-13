# BRIEF lay-E — app storage: v2 conversion of stored layouts, copy/export, server normalization

Lane-supervisor (fresh, Opus). Read `plans/briefs/BRIEF-lay-common.md` first, then `RECON-layout-storage.md`, PLAN §3 D1–D5, D14, D15, and `plans/REPORT-lay-A-2026-11-05.md` (`panelsV2Of`, `conversationSplitIds`, validator) + `plans/REPORT-lay-B-2026-11-05.md` (new widget ids/settings; which Messages settings were dropped). CLAUDE.md Hard rules: no top-level `await` in `src/lib/server/db/index.ts` (await `dbReady`); inside `db.transaction(async (tx) => …)` only `tx`; never seed at a hardcoded id; 0.6 data in users' hands → boot pass + second-boot-no-op test; NO schema migration. The SDK is already built.

## Goal
Every stored layout and its per-instance settings reach panels v2 with nothing lost, once, idempotently; writes after boot are normalized.

## Build
1. `convertPanelsToV2(db)` in `src/lib/server/db/sessionLayoutPanels.ts`: rows on `session_panel_layouts` whose layout has old slots and no panels, or `panels.version = 1`; and `session_layout_presets` with `origin IN ('user','pub')` likewise. Per row, ONE transaction (only `tx`): run `panelsV2Of(layout, { widgetSettings, widgetStyles })` (it LAYERS the passed rows over the layout's own `widgetSettings`/`widgetStyles` per instance; apply each move to whichever store holds that key — the rows, or the blob); write the v2 layout; apply `settingsMoves` to that (user, session)'s `widget_settings` rows (delete stale `composer*` / `turn-line*` rows for that user+session first); apply `styleCopies` to `layout_settings.widgetStyles`; for presets rewrite the blob's `widgetSettings` / `widgetStyles`; never touch `layout_updated_at`. Log + skip a failing row (rolled back), continue.
2. Call it from `dbReady` in `src/lib/server/db/index.ts` immediately BEFORE `syncWidgetSettings(CORE_WIDGETS)` (≈:779), under the same gate (dev boot / version change / fresh install) — PLAN D5 revised: the prune must never see a Messages key before it moves. Verify the existing steps 1–2 (`completeSessionLayouts`, `convertTable`) in the `session-layouts` startup task still behave (no-ops for converted rows); if step 1 must run first for correctness, say so and propose the order in your report rather than reshuffling startup.
3. Core rows reseed from the v2 catalogue (nothing to do but verify `syncLayoutPresets` accepts v2); plugin rows stay as the manifest says — convert at read/copy: `copyLayoutIntoSession` (layoutPresets.ts:759) and `exportedSessionLayout` (panelsFromStored.ts:51) write/emit v2 and split `widgetSettings` via `panelsV2Of`; `pluginLayouts.ts` ingest accepts the v1 warning.
4. Server normalization: `sessions:panelLayout:set` (sockets/sessions.ts ≈4464, validates ≈4428) and `sessions:layoutPreset:save` (≈4551) / `update` (≈4883) normalize an incoming v1 to v2 (with its settings moves) before validating. `sockets/sessions.ts` is SHARED — another programme queues edits there: re-read right before each edit, minimal hunks, never a whole-file write.
5. Tests — `sessionLayoutPanels.int.test.ts` new block (RECON-layout-storage "Tests" list, all items) incl. the SECOND BOOT: counts zero and a snapshot of `session_panel_layouts`, `session_layout_presets`, `widget_settings` (updatedAt included) identical; a boot-order int test that a moved Messages key (`composer`, `nextUp`) survives a version-change boot (model on `layoutPresets.boot.int.test.ts`); copy-from-v1-plugin-preset and export tests. 60 s timeouts for DB-in-`it`.

## Files owned
`src/lib/server/db/sessionLayoutPanels.ts` (+`.int.test.ts`), `src/lib/server/db/index.ts` (the one call + import, nothing else), `src/lib/server/db/layoutPresets.ts`, `src/lib/server/db/panelsFromStored.ts`, `src/lib/server/db/pluginLayouts.ts`, `src/lib/server/db/widgetSettings.ts` (only if the move needs a helper), `src/lib/server/sockets/sessions.ts` (the four normalization hunks only), their tests, new `layoutPanelsV2.boot.int.test.ts`.

## Out of scope
Client code (lay-C/D), SDK (queue to the lead), docs (lay-F), `startup/index.ts` (propose, don't edit), any migration.

## Stop and ask when
A row can't convert without guessing; the prune turns out to also prune preset blobs; the gate in dbReady differs from what the plan assumes.

## Done means
Your int tests green (run each file alone, 60 s timeouts); `npx tsc --noEmit -p .` clean on your files. Report `plans/REPORT-lay-E-2026-11-05.md`.
