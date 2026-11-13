# REPORT lay-E (2026-11-05; finished 2026-11-06)
(Saved by the lead from the supervisor's final message.)

Status: done. 15 targeted files pass, each alone in the capped scope. App tsc: 37 errors, all in client files (sessionLayout/arrangeOps*, mobileEdit, presetPreview, arrangeCanvas.dom.test) — lay-C/lay-D's. No sdk:build, commit, stash or migration.

## Names (app-internal; no new user-visible word)
- src/lib/server/db/panelsFromStored.ts: `type StoredPanelsKind = "v2"|"v1"|"slots"|"floor"|"none"|"other"`; `storedPanelsKind(layout)`; `interface LayoutStores { layout; settings?; styles? }`; `LayoutStoresV2 extends LayoutStores { changed: { layout; settings; styles } }`; `storedLayoutAsV2(stores, opts?: { dropStale?: boolean })` — the ONE place panelsV2Of is applied to stored values (pure, idempotent; each move applied to every store holding the key; style copy goes to the store holding the source pin); `presetLayoutAsV2(layout)` (unreadable → as it was + a log line); `exportedSessionLayout` emits v2.
- src/lib/server/db/sessionLayoutPanels.ts: `PanelsV2Report { sessions; presets; failed }`; `convertPanelsToV2(handle = db)`; `panelLayoutWriteAsV2(sessionId, userId, sent, handle?)`; `SessionLayoutPanelsReport.version2`.

## Behaviour
- dbReady: `convertPanelsToV2(db)` immediately before `syncWidgetSettings(CORE_WIDGETS)`, same gate (`!building && (dev || versionChanged || treatAsFreshInstall)`), deferred import, no top-level await. Selects session_panel_layouts rows with `layout_copied_at IS NOT NULL` and panels absent/v1, and presets origin IN ('user','pub'); one tx per row (tx only); failing row rolled back, logged, skipped; preset `layout_updated_at` never moved; core/plugin rows never selected.
- Step 3 in the session-layouts task (own file; startup/index.ts untouched): runs after steps 1–2 — pre-copy rows need step 1 (base rows written by reconcilers after dbReady), so dbReady skips them and step 3 converts them the same boot.
- `{}` and floor-only rows: layout left byte-identical (readers derive the floor); settings moves still applied (else a Start-from-scratch session's messages.composer is pruned).
- Stale composer*/turn-line* dropped only in the one write that gives a layout v2 panels — never on `{}`/floor rows, `:set`, or saves.
- copyLayoutIntoSession reads via presetLayoutAsV2 (v1 plugin preset copied as v2, settings + pins split; plugin row unchanged). Save as new / Save changes normalize inside `packSessionLayout` (db layer) → one socket hunk only; packed result validated by `drawable()`. markStartedFrom insert writes v2.
- `sessions:panelLayout:set`: one hunk (≈4486) after the access check: dynamic import, `params = await panelLayoutWriteAsV2(…)` before validation.
- Checked: the prune reads only widget_settings, never preset blobs; syncLayoutPresets writes v2 verbatim; pluginLayouts.ts unchanged (v1 manifest projected verbatim with the `panels-v1:` warning, now tested).
- Session row updatedAt moves on conversion ($onUpdate); empty preset-blob entries stay `{}`; the v2 log line prints only when something converted.

## Changed files
Supervisor: panelsFromStored.ts, db/index.ts (call + import), sockets/sessions.ts (the `:set` hunk). w2: sessionLayoutPanels.ts, sessionLayoutPanels.int.test.ts, new layoutPanelsV2.boot.int.test.ts. w1: layoutPresets.ts (+15/−7), layoutPresets.int.test.ts, new panelsFromStored.test.ts, pluginLayouts.int.test.ts, expectation-only sockets/sessions.{panelLayout,layoutPresets,layoutPresetVerbs,layoutStartedFrom}.int.test.ts. w3: expectations/fixtures sessions.layoutCopy.int.test.ts, sessions.widgetSettings.int.test.ts. Briefs BRIEF-lay-E-w{1,2,3}.md.

## Tests (capped, one file per run)
panelsFromStored 12/12 · sessionLayoutPanels.int 23/23 · layoutPanelsV2.boot.int 3/3 · layoutPresets.int 40/40 · layoutPresets.boot.int 2/2 · pluginLayouts.int 16/16 · pluginLayouts 2/2 · widgetSettings.int 8/8 · sessions.panelLayout.int 7/7 · sessions.layoutCopy.int 28/28 · sessions.layoutPresets.int 18/18 · sessions.layoutPresetVerbs.int 32/32 · sessions.layoutStartedFrom.int 10/10 · sessions.widgetSettings.int 14/14 · plugins/exportPackage.int 15/15.
Covered: step 3 (pin dropped, flatten order, composerPosition top, showComposer false, Lair one pair, settings to right rows, stale rows replaced + other session untouched, pin copy, user+pub presets with layout_updated_at unchanged, core+plugin byte-identical, {}/floor settings-only, pre-copy waits for step 1, failing row rolls back); SECOND BOOT (convert → prune → task twice: zero counts, identical snapshot of three tables incl. updatedAt); boot order (convert-then-prune keeps composer/nextUp; prune-then-convert loses them; source check of the call order); copy from v1 plugin preset; Save as new / Save changes from v1; v1 manifest warning; v1 `:set` stores v2 + a composer row.
Baseline failures caused by lay-B's catalogue (Story v2, Guide ships a layout) were fixed by w1: "a core genre that declares none" tests now use core:genre/chat; Story's Author's-note test rewritten (second tab beside Cast, left); withStorySettings packs composer + stats.

## Open ★ (reversible)
`{}` and floor rows keep their stored layout and only move settings (alternative: write the floor as placed panels, which step 2 already declines).

## Noticed, not done
- An older cached page `:set`ting a v1 layout whose widgetSettings lacks composer/turn-line keys would sweep the boot-moved composer rows (writeWidgetSettings "absent = remove").
- A row failing conversion in dbReady loses its moved Messages keys to the prune right after (logged by id).
- cloneLayoutPreset / shareLayoutPreset copy blobs verbatim → a clone of a v1 plugin preset stays v1 until next boot's step 3 (readers accept v1).
- sessions.layoutCopy.int.test.ts fixtures still use `messages: { composer: … }` (≈:356, :416, :483–506).
- Pre-existing prettier drift in layoutPresets.ts, sessionLayoutPanels.ts (+int test), sessions.widgetSettings.int.test.ts.
- w1 briefly ran prettier --write on layoutPresets.ts and rebuilt it from a HEAD copy + its edits; verified HEAD = w1's saved original (file was unmodified at session start).
- No /tmp/serene-pub-vitest-* dirs deleted (ownership unclear; vitest setup prunes stale ones).

## Scope review + lead decisions (2026-11-06)
Review: no scope breach (db/index.ts one deferred call, gate unchanged, no top-level await; tx-only transactions; no migration; `:set` the only lay-E hunk in sockets/sessions.ts; the six socket int tests accepted as "their tests"; second-boot test snapshots all three tables incl. updatedAt).
Lead decisions:
1+2 (data): ACCEPT the risk as real → worker lay-E-fix (plans/briefs/BRIEF-lay-E-fix.md): `PanelsV2Report.pending` (pre-copy + failed session rows) passed to `syncWidgetSettings(decls, { spare })`, which keeps exactly the moved Messages keys on those rows' Messages copies until step 3 moves them; the failure log line made true; the pre-copy test models a real boot (convert → prune(spare) → task).
3: KEEP step 3 (needed for pre-copy rows) — recorded here as an accepted deviation from "propose, don't reshuffle"; lay-E-fix narrows its query so `{}`/floor rows whose moves are done are not re-read each boot. The lead updated the `session-layouts` task comment in `startup/index.ts` (comment only).
4: names added verbatim to BRIEF-lay-F.
5: stale TDD comment removed by lay-E-fix.

## lay-E-fix outcome (2026-11-06)
Done. `PanelsV2Report.pending` (pre-copy skipped + failed session rows; presets never); `MESSAGES_MOVED_KEYS` (widgetSettings.ts: composer, otherTabsComposer, showActions, nextUp, composerPosition, showComposer, showMessages, showNudge — the SDK's lists are private); `syncWidgetSettings(decls, { spare })` keeps exactly those keys on spared rows' Messages copies (also left out of the `dropped` log). db/index.ts: `const v2 = await convertPanelsToV2(db)` → `syncWidgetSettings(CORE_WIDGETS, { spare: v2.pending })`. Failure log: "left as it was; its Messages settings are kept for the retry". Step 3 narrowed: v1 / placing-slot rows always; `{}`/floor/other rows only while `storedLayoutAsV2` would still change settings, layout or pins (one batched widget_settings read; a done row costs no tx/read/write on later boots).
Tests (capped, one file per run): sessionLayoutPanels.int 25/25 (pre-copy models a real boot; failing row keeps its keys and converts next boot; done `{}` row not re-selected; second-boot test passes spare, pending []), widgetSettings.int 9/9 (spare scope exact; next boot clears leftovers), layoutPanelsV2.boot.int 3/3 (asserts `spare:` is passed). tsc: no error in these files (≈37 remain in lay-C/D client files).
Noticed: pre-existing prettier drift in sessionLayoutPanels.ts (+int test), widgetSettings.int.test.ts; a `{}`/floor row holding ONLY stale composer*/turn-line* values is no longer selected (can only exist if the new widgets stored values before conversion). Names for §25: `pending`, `spare`, `MESSAGES_MOVED_KEYS`.
