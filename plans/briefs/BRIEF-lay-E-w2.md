# BRIEF lay-E-w2 — the version 2 boot pass over stored session layouts

Worker for lane **lay-E** (supervisor: lay-E). App: `/home/jody/github/serene-pub`. SDK (read only, built — never edit, never build): `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Every stored session layout and every person's own / pub saved layout reaches **panels version 2** once, idempotently, with the Messages settings that moved to the new Composer / Turn line widgets carried onto them, before the boot prune (`syncWidgetSettings`) can delete them. A second boot changes nothing.

## Background you need (quoted)
- PLAN D2: `panelsV2Of(layout, { widgetSettings, widgetStyles })` → `{ panels, settingsMoves, styleCopies }` (SDK, pure). It LAYERS the passed settings/pins over the layout's own `widgetSettings`/`widgetStyles` per instance. Composer gets `composer`, `otherTabsComposer`, `showActions`; Turn line gets `nextUp`; `composerPosition`, `showComposer`, `showMessages`, `showNudge`, `backingMode` are dropped on messages copies, `hostCard` on every widget.
- PLAN D14: "no schema migration. `convertPanelsToV2` in `db/sessionLayoutPanels.ts`, called from `dbReady` before the prune: rows with `panels.version = 1` on `session_panel_layouts` and presets `origin IN ('user','pub')`; one transaction per row (layout + moved `widget_settings` rows + `layoutSettings.widgetStyles` copies; stale `composer*`/`turn-line*` rows for that user+session deleted first); core rows reseed from the v2 catalogue; plugin rows convert at read/copy."
- Lane brief: "never touch `layout_updated_at`. Log + skip a failing row (rolled back), continue." "SECOND BOOT: counts zero and a snapshot of `session_panel_layouts`, `session_layout_presets`, `widget_settings` (updatedAt included) identical."

## Already written — USE it, do not edit it
`src/lib/server/db/panelsFromStored.ts` (the supervisor's): read its doc comments first.
- `storedPanelsKind(layout)` → `"v2" | "v1" | "slots" | "floor" | "none" | "other"`.
- `storedLayoutAsV2({ layout, settings?, styles? }, { dropStale? })` → `{ layout, settings, styles, changed: { layout, settings, styles } }`. Pure, never mutates its input, a second call on its answer reports nothing changed. `v1`/`slots` get v2 `panels` written (old slots stay inert); with `dropStale` every `composer*`/`turn-line*` entry in every store is dropped first. `floor`/`none` (readers derive the floor) get only the settings moves/style copies. `v2`/`other` come back unchanged. `settings` = a session's `widget_settings` rows as `{ [instanceId]: values }`; `styles` = its `layout_settings.widgetStyles`. An outer settings entry left empty is removed from `settings` (= delete that row).
If you believe it has a bug, STOP and report it; don't work around it.

## Build (all in `src/lib/server/db/sessionLayoutPanels.ts`)
1. `export interface PanelsV2Report { sessions: number; presets: number; failed: number }` and
   `export async function convertPanelsToV2(handle: Db = db): Promise<PanelsV2Report>` (`Db` is the ambient type from `db/types.d.ts`, already used in this file).
   - **Sessions**: select ids from `session_panel_layouts` where `layout_copied_at IS NOT NULL` AND (`(layout -> 'panels') IS NULL` OR `(layout -> 'panels' ->> 'version') = '1'`), ordered by id. (The column is `json`, not `jsonb`: no `?` operator, no `=` on json.) Pre-copy rows (`layout_copied_at IS NULL`) are skipped ON PURPOSE: step 1 (`completeSessionLayouts`) makes them whole from a base row the startup reconcilers write later; converting them first would freeze a partial layout.
   - Per row: read the row and that (user, session)'s `widget_settings` rows with `handle` (outside any transaction); `storedLayoutAsV2({ layout, settings: rowsMap, styles: layoutSettings.widgetStyles (when a plain object) }, { dropStale: true })`; nothing changed → skip with no transaction (this is what keeps every later boot cheap — `none`/`floor` rows stay selected forever). Else ONE `handle.transaction(async (tx) => …)`: re-read row + rows under `tx` (same predicate), recompute, then write with `tx` ONLY:
     - `changed.layout` → `update session_panel_layouts set layout` (never `layout_copied_at`, never `layout_preset_id`);
     - `changed.settings` → diff old rows vs the answer's `settings`: delete each row whose instance is gone; upsert each new/changed one (`onConflictDoUpdate` on `[userId, sessionId, widgetInstanceId]`, as `completeRow` does); leave an identical row untouched;
     - `changed.styles` → `layout_settings = { ...layoutSettings, widgetStyles: styles }`.
     Count `sessions` per row written. Wrap each row in try/catch: `console.error("[session-layouts] could not convert session layout row ${id} to panels version 2; left as it was, retried next boot:", err)`, `failed++`, continue.
   - **Presets**: `session_layout_presets` with `origin IN ('user','pub')` and the same panels predicate (no copied-at test). Per row: `storedLayoutAsV2({ layout }, { dropStale: true })`; unchanged → skip; else one transaction: re-read, recompute, `update … set layout` — NEVER `layoutUpdatedAt`. Same catch/log/continue; `presets++`.
   - Core (`origin = 'core'`) and plugin rows are never selected.
   - One `console.info` line at the end: `[session-layouts] panels version 2: ${sessions} session layout(s) and ${presets} saved layout(s) converted${failed ? `; ${failed} left as they were` : ""}`.
2. `export async function panelLayoutWriteAsV2<T extends { layout?: unknown; layoutSettings?: unknown; widgetSettings?: unknown }>(sessionId: number, userId: number, sent: T, handle: Db = db): Promise<T>` — what `sessions:panelLayout:set` will call BEFORE validating (the supervisor adds the socket line; you don't touch `sockets/sessions.ts`):
   - `storedPanelsKind(sent.layout)` not one of `v1`/`slots`/`floor`/`none` → return `sent` itself.
   - `"widgetSettings" in sent` but not a plain object whose values are all plain objects, or `"layoutSettings" in sent` but not a plain object → return `sent` (the handler's own checks refuse it).
   - settings = `sent.widgetSettings` when the key is present; else, for `v1`/`slots` only, the stored rows (`readWidgetSettings(sessionId, userId)` style read, via `handle`); else `undefined`. styles = `sent.layoutSettings.widgetStyles` when `layoutSettings` is present; else, for `v1`/`slots` only, the stored row's `layout_settings.widgetStyles`; else `undefined`.
   - `storedLayoutAsV2({ layout, settings, styles })` — NO `dropStale` (a live page's composer values are real).
   - Return `{ ...sent, layout: answer.layout }`, plus `widgetSettings: answer.settings ?? {}` only when `changed.settings`, plus `layoutSettings: { ...(sent.layoutSettings ?? the stored layout_settings ?? {}), widgetStyles: answer.styles }` only when `changed.styles`. Never add a key that wasn't sent unless it changed.
   - Wrap the whole computation in try/catch → on throw, `console.warn` and return `sent`.
3. The `session-layouts` startup task (`sessionLayoutPanels()`, this file) gains **step 3**: after steps 1–2, `await convertPanelsToV2()` — it converts what steps 1–2 just produced (a pre-copy row made whole, a row given v1 panels by step 2); on every other boot it writes nothing. Add its counts to `SessionLayoutPanelsReport` as `version2: PanelsV2Report` and to the log line. Steps 1 and 2 are NOT changed.
4. Update the module header comment: a third step, the `dbReady` call (before the prune — PLAN D5), why pre-copy rows wait, what `none`/`floor` rows get (settings only).

## Tests
A. `src/lib/server/db/sessionLayoutPanels.int.test.ts` — new `describe("⏳ step 3: panels version 2", …)` block, every `test(…, 60_000)`. Reuse the file's helpers (`person`, `sessionOf`, `copiedRow`, `sessionRow`, `presetRow`, `storedText`, `seedAdventure`, …). Compute expectations with the SDK's `panelsV2Of` where a whole panels object is compared. Cover:
  1. a v1 row with a pinned side panel: the pin is gone in v2; middle is `[...above, primary, ...below]` in that order (use a v1 with one above and one below panel);
  2. `messages` settings `{ composer: "quill", otherTabsComposer: "minimal", showActions: false, nextUp: "list", showComposer: true, composerPosition: "top" }` → rows `composer: { composer, otherTabsComposer, showActions }`, `turn-line: { nextUp }`, the `messages` row keeps only its other keys (or is deleted when empty); `composerPosition: "top"` puts turn-line + composer panels BEFORE the messages panel;
  3. `messages#journal: { showComposer: false }` (DC-style) → no composer / turn-line panel for it, `showComposer` dropped from its row;
  4. a Lair-style middle panel with tabs `["messages", "messages#sanctum"]` → exactly one composer + one turn-line panel (`composer`, `turn-line`);
  5. a stale `composer` row `{ composer: "writer" }` (and a stale `turn-line#x` row) for that user+session is deleted and replaced by the moved values; ANOTHER session's `composer` row is untouched;
  6. a style pin `layout_settings.widgetStyles.messages` is copied to `composer` and `turn-line`;
  7. a `user` preset and a `pub` preset (blob `widgetSettings.messages.composer`, `widgetStyles.messages`) convert: v2 panels, blob settings split, pins copied, `layoutUpdatedAt` unchanged;
  8. `core` and `plugin` rows byte-identical (`storedText`);
  9. a `{}` row (and a floor-only row) whose `messages` row holds `composer: "quill"`: the layout stays byte-identical, the setting moves to a `composer` row;
  10. a pre-copy row (`layout_copied_at` null) is NOT touched by `convertPanelsToV2` alone; `sessionLayoutPanels()` (all three steps) leaves it v2;
  11. a failing row rolls back and the next row still converts (e.g. `vi.spyOn` the transaction or make one row's write throw — choose the least invasive way; say which);
  12. SECOND BOOT: run the boot sequence — `convertPanelsToV2()`, then `syncWidgetSettings(CORE_WIDGETS)` (`CORE_WIDGETS` from `$lib/shared/widgets/types`, `syncWidgetSettings` from `./widgetSettings`), then `sessionLayoutPanels()` — over a database holding cases 1–9's kinds of rows; snapshot ALL rows of `session_panel_layouts`, `session_layout_presets`, `widget_settings` (every column, `updatedAt` included); run the sequence again; the second `convertPanelsToV2` and step-3 counts are all zero and the snapshot is identical (`toEqual`);
  13. `panelLayoutWriteAsV2`: a v1 `layout` with sent `widgetSettings` → v2 layout + moved settings; v1 layout with NO `widgetSettings` key and stored `messages.composer` → the answer carries `widgetSettings` (stored rows after the move); a v2 layout → the same object back (`toBe`); a `widgetSettings` that is not an object → `sent` back.
  Existing tests that call `pass()` (= `sessionLayoutPanels()`) and assert v1 output (e.g. "a pre-copy row is made whole first, then converted, in one pass", "a second run converts nothing…") will now see step 3: update ONLY those expectations to the v2 result, and say which in your report. Tests calling `convert()` (= step 2 alone) must stay unchanged and green.
B. NEW `src/lib/server/db/layoutPanelsV2.boot.int.test.ts` (model it on `src/lib/server/db/layoutPresets.boot.int.test.ts`: same `vi.mock("$lib/server/db", …createTestDb…)`): a version-change boot keeps moved Messages keys — seed a session with a v1 layout and `messages: { composer: "quill", nextUp: "list" }`; run `convertPanelsToV2()` then `syncWidgetSettings(CORE_WIDGETS)`; assert `composer.composer === "quill"` and `turn-line.nextUp === "list"` survive. A second case shows WHY the order matters: the same data with `syncWidgetSettings` FIRST loses them (assert it, with a comment). A third case reads `src/lib/server/db/index.ts` as text (`fs.readFileSync`) and asserts that inside the gated block `convertPanelsToV2(` appears, and appears BEFORE `syncWidgetSettings(CORE_WIDGETS)` (the supervisor adds that call; the test will fail until then — that's expected, say so).

## Files owned
`src/lib/server/db/sessionLayoutPanels.ts`, `src/lib/server/db/sessionLayoutPanels.int.test.ts`, NEW `src/lib/server/db/layoutPanelsV2.boot.int.test.ts`. Nothing else.

## Files readable
`src/lib/server/db/panelsFromStored.ts`, `widgetSettings.ts`, `layoutPresets.ts`, `schema.ts` (`sessionPanelLayouts` ≈7697, `sessionLayoutPresets` ≈7783, `widgetSettings` ≈8007), `index.ts` (≈741–781, the gated block), `layoutPresets.boot.int.test.ts`, `/home/jody/github/serene-pub-sdk/sdk/src/sessionLayout.ts` (`panelsV2Of` ≈1021–1182), `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/widgets.ts` ≈337–435 (Composer: `composer` ∈ classic·minimal·writer·quill, `otherTabsComposer` ∈ same·classic·minimal·writer·quill, `showActions` boolean; Turn line: `nextUp` ∈ head·list·hidden — use VALID values or the prune drops them).

## Out of scope
`index.ts`, `sockets/sessions.ts`, `panelsFromStored.ts`, `layoutPresets.ts`, `startup/index.ts`, the SDK, docs, NOMENCLATURE, any migration. Findings → "Noticed, not done".

## Rules (CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod." (Here: inside `handle.transaction`, only `tx`.)
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- "Never seed a row at a hardcoded id." (Tests insert rows and read ids back.)
- "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." No schema migration in this build.
- It is a **session**, never a *chat*.
- Every new exported name is listed in your report (the lane forwards it for NOMENCLATURE §25). Use exactly the names above; invent no others that are exported.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build: the SDK is built.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## How to run tests and tsc (MANDATORY — a bare run OOM-killed VS Code)
Every run inside a memory-capped scope, one file at a time, logging to a file, never piped into `head`:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run --no-file-parallelism <one file> > $S/lay-E-w2-t.log 2>&1; echo test-exit=\$? >> $S/lay-E-w2-t.log"
grep -E "Test Files|Tests |FAIL|✗|×|test-exit" $S/lay-E-w2-t.log
```
tsc in its own scope: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && timeout 900 npx tsc --noEmit -p . > $S/lay-E-w2-tsc.log 2>&1; echo tsc-exit=\$? >> $S/lay-E-w2-tsc.log"` then `grep -E "sessionLayoutPanels|layoutPanelsV2" $S/lay-E-w2-tsc.log`. Never hand a DOM node to an assertion. Scratch files start with `lay-E-w2-`.

## Done means
`sessionLayoutPanels.int.test.ts` green (all old + new tests); `layoutPanelsV2.boot.int.test.ts` green except the index.ts source case (expected to fail until the supervisor's call lands — report it); tsc clean on your two/three files.

## Report (your final message — you cannot write report files)
Exported names + signatures; changed files; each test added/updated (one line each); test runs with results; the failing-row technique you chose; any doubt about `storedLayoutAsV2`; Noticed, not done.
