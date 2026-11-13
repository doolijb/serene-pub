# BRIEF lay-E-w1 — copy, save and export write panels version 2; their tests

Worker for lane **lay-E** (supervisor: lay-E). App: `/home/jody/github/serene-pub`. SDK (read only, built — never edit, never build): `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
A layout copied into a session, saved from one, or exported is written as **panels version 2**, with the Messages settings that moved to the new Composer / Turn line widgets split onto them. Plugin preset rows themselves stay exactly as their manifest says (converted at read/copy, never in place).

## Background (quoted)
- PLAN D1: "`panels: { version: 2, left: PanelV2[], middle: PanelV2[], right: PanelV2[], backing?, opacity?, gap? }` … v1 stays readable; v2 is what is written."
- PLAN D2: `panelsV2Of(layout, { widgetSettings, widgetStyles })` → `{ panels, settingsMoves, styleCopies }` (SDK, pure; layers the passed values over the layout's own). Composer gets `composer`, `otherTabsComposer`, `showActions`; Turn line gets `nextUp`; `composerPosition`, `showComposer`, `showMessages`, `showNudge`, `backingMode` are dropped on messages copies, `hostCard` everywhere.
- Lane brief: "plugin rows stay as the manifest says — convert at read/copy: `copyLayoutIntoSession` (layoutPresets.ts:759) and `exportedSessionLayout` (panelsFromStored.ts:51) write/emit v2 and split `widgetSettings` via `panelsV2Of`; `pluginLayouts.ts` ingest accepts the v1 warning." "`sessions:layoutPreset:save` / `update` normalize an incoming v1 to v2 (with its settings moves) before validating."

## Already written — USE it, do not edit it
`src/lib/server/db/panelsFromStored.ts` (the supervisor's; read its doc comments):
- `storedPanelsKind(layout)` → `"v2" | "v1" | "slots" | "floor" | "none" | "other"`.
- `storedLayoutAsV2({ layout, settings?, styles? }, { dropStale? })` → `{ layout, settings, styles, changed }` (pure; `v1`/`slots` get v2 `panels`; `floor`/`none` only settings moves; `v2`/`other` unchanged).
- `presetLayoutAsV2(blob)` = the preset-blob form (stale `composer*`/`turn-line*` entries dropped; a blob it cannot read comes back as is, logged).
- `exportedSessionLayout` ALREADY emits v2 (done) — you only test it.
If you believe one of these has a bug, STOP and report it; don't work around it.

## Build (`src/lib/server/db/layoutPresets.ts` only)
1. `copyLayoutIntoSession` (≈:759): where it reads the preset (`if (isPlainObject(row.layout)) source = row.layout`), read it through `presetLayoutAsV2(row.layout)` instead. Everything after (`arrangementOf`, `incomingPins`, `incomingSettings`, the "incoming wins per instance" rule, `seatedKeys`) stays as is and so receives the split settings. Update the function's doc comment with one bullet: the copy is written as panels version 2.
2. `packSessionLayout` (≈:1215, the ONE packing behind Save as new and Save changes): return the packed blob through `storedLayoutAsV2({ layout: packed }).layout` — NO `dropStale` (a session's own `composer` rows are real). Note: `drawnWidgetIds` of a v1 arrangement already lists the derived `composer`/`turn-line` ids, so those rows are packed.
3. `markStartedFrom` (≈:1278): the row it INSERTS (no row yet) takes `arrangementOf(storedLayoutAsV2({ layout: arrangementOf(from.layout) }).layout)` instead of `arrangementOf(from.layout)`.
Import what you need from `./panelsFromStored`. Change nothing else in the file. Never `layoutUpdatedAt` beyond what the code already does.
`pluginLayouts.ts`: expected NO change (it refuses only errors; the validator's `panels-v1:` line is a warning). Confirm by test; if a change looks needed, stop and report.

## Tests
A. NEW `src/lib/server/db/panelsFromStored.test.ts` (pure vitest unit test, no DB): `storedPanelsKind` for each kind; `storedLayoutAsV2` — v1 → v2 with moves into outer settings AND into blob `widgetSettings` (a key in both stores moves in both); a style pin copied to the store holding it (outer first); `dropStale` drops `composer*`/`turn-line*` from all four stores only for `v1`/`slots`; `none` (`{}`) with `messages.composer` moves the setting and leaves the layout `toEqual({})`; an outer entry left empty is removed, a blob entry left empty stays `{}`; input never mutated (deep-freeze or compare a JSON copy); a SECOND call on the answer reports `changed` all false; `exportedSessionLayout`: v1 → v2 panels first, old slots stripped, settings split; a floor-only old-slot layout keeps its old slots; a v2 layout with inert old slots loses the slots and keeps its panels `toBe`-equal content.
B. `src/lib/server/db/layoutPresets.int.test.ts`: add (each `test(…, 60_000)`):
  1. copy from a **v1 plugin preset** (insert an `origin: "plugin"` row with `panels.version 1`, `widgetSettings: { messages: { composer: "quill", nextUp: "list", showComposer: true } }`, `widgetStyles: { messages: <pin> }`) via `copyLayoutIntoSession` inside `testDb.transaction` → the session row's `layout.panels.version === 2` with the composer/turn-line panels, `widget_settings` rows `composer: { composer: "quill" }` and `turn-line: { nextUp: "list" }`, `messages` gets no moved key, `layout_settings.widgetStyles` holds the pin for `messages`, `composer`, `turn-line`; and the plugin preset row itself is byte-identical afterwards;
  2. Save as new from a session whose SENT layout is v1 (and whose `messages` row holds `composer: "writer"`) → the stored preset's `layout.panels.version === 2` and `widgetSettings.composer.composer === "writer"`, no `composer` key under `widgetSettings.messages`;
  3. Save changes (`saveChangesToLayout`) from a v1 sent layout → v2 written.
  Values must be VALID for the declarations (Composer `composer` ∈ classic·minimal·writer·quill; `otherTabsComposer` ∈ same·classic·minimal·writer·quill; `showActions` boolean; Turn line `nextUp` ∈ head·list·hidden).
C. `src/lib/server/db/pluginLayouts.int.test.ts`: one test — a plugin manifest layout in `panels` version 1 is projected VERBATIM (row `toEqual` the manifest) and reported with a warning starting `panels-v1:`, not refused.
D. Baseline failures that predate this lane (seen 2026-11-06 before any lay-E edit; cause = lay-B's v2 catalogue: Story's default is now v2, the core floor genre's layout is named "Guide"):
  - `src/lib/server/db/layoutPresets.int.test.ts`: "seeds the layout it declares, byte for byte…" (TypeError reading `.map` at ≈:97 — v1 shape), "Story's default places the Author's note, unpinned, in the right rail (2026-10-03)", "a core genre that declares none still gets the empty floor", "seeds a default preset per core genre…", "re-forces an edited seeded row's content" ("Guide" vs "Default").
  - `src/lib/server/sockets/sessions.layoutPresets.int.test.ts` (3), `sessions.layoutPresetVerbs.int.test.ts` (2), `sessions.layoutStartedFrom.int.test.ts` (2).
  For each: find the cause. If it is a stale expectation of the v1 catalogue / old name / v1 copy shape, update the EXPECTATION minimally to today's shipped catalogue (read it from the SDK, e.g. `getGenre(id)?.layouts`, rather than hard-coding where the test already does so) and keep the test's intent; if a test's premise no longer exists (e.g. "a core genre that declares none" — check whether any core genre still declares none), rewrite it to the nearest true statement or report it — do not delete a test without saying why. If the cause looks like a real bug, DON'T change the test: report it with file:line.
E. `src/lib/server/sockets/sessions.panelLayout.int.test.ts`: the supervisor made `sessions:panelLayout:set` normalize a v1 layout to v2 before validating. The test "set refuses a layout the app cannot draw…" stores a v1 `good` then expects `got.layout` toEqual `good`: update that expectation to the v2 form (`panelsV2Of(good).panels`, from `@serene-pub/sdk`) and add one assertion that a v1 `:set` with `widgetSettings: { messages: { composer: "quill" } }` stores a `composer` row (`composer: "quill"`) and no `composer` key on `messages`. Keep every other test as is; all must pass.

## Files owned
`src/lib/server/db/layoutPresets.ts`, `src/lib/server/db/layoutPresets.int.test.ts`, NEW `src/lib/server/db/panelsFromStored.test.ts`, `src/lib/server/db/pluginLayouts.int.test.ts`, and — expectations only, minimal hunks — `src/lib/server/sockets/sessions.panelLayout.int.test.ts`, `sessions.layoutPresets.int.test.ts`, `sessions.layoutPresetVerbs.int.test.ts`, `sessions.layoutStartedFrom.int.test.ts`, `src/lib/server/plugins/exportPackage.int.test.ts` (only if it asserts the old export shape). Nothing else. NEVER edit `src/lib/server/sockets/sessions.ts` (shared with another programme), `panelsFromStored.ts`, `sessionLayoutPanels.ts` (another worker's), `index.ts`.

## Files readable
`src/lib/server/db/panelsFromStored.ts`, `sessionLayoutPanels.ts`, `layoutPresets.ts`, `pluginLayouts.ts`, `widgetSettings.ts`, `schema.ts`, `src/lib/server/sockets/sessions.ts` (≈4480–4560 the `:set` handler), `/home/jody/github/serene-pub-sdk/sdk/src/sessionLayout.ts` (`panelsV2Of` ≈1021–1182, validator ≈1699), `/home/jody/github/serene-pub-sdk/core-catalog/src/registry/{widgets,layouts,genres}.ts`.

## Out of scope
Anything not listed above; the SDK; docs; NOMENCLATURE; migrations; `startup/index.ts`. Findings → "Noticed, not done".

## Rules (CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."
- "Never seed a row at a hardcoded id." (Tests insert and read ids back.)
- "0.6 is in users' hands." No schema migration in this build.
- It is a **session**, never a *chat*.
- No new exported name in `layoutPresets.ts`. Any you think you need → stop and report.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no sdk:build: the SDK is built.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## How to run tests and tsc (MANDATORY — a bare run OOM-killed VS Code)
Every run inside a memory-capped scope, ONE file at a time, logging to a file, never piped into `head`:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run --no-file-parallelism <one file> > $S/lay-E-w1-t.log 2>&1; echo test-exit=\$? >> $S/lay-E-w1-t.log"
grep -E "Test Files|Tests |FAIL|✗|×|test-exit" $S/lay-E-w1-t.log
```
tsc in its own scope: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; cd /home/jody/github/serene-pub && timeout 900 npx tsc --noEmit -p . > $S/lay-E-w1-tsc.log 2>&1; echo tsc-exit=\$? >> $S/lay-E-w1-tsc.log"` then grep the log for your files. Never hand a DOM node to an assertion. DB-in-`it` tests need a 60 s timeout. Scratch files start with `lay-E-w1-`.

## Done means
Green, each run alone: `panelsFromStored.test.ts`, `layoutPresets.int.test.ts`, `pluginLayouts.int.test.ts`, `sessions.panelLayout.int.test.ts`, `sessions.layoutCopy.int.test.ts`, `sessions.layoutPresets.int.test.ts`, `sessions.layoutPresetVerbs.int.test.ts`, `sessions.layoutStartedFrom.int.test.ts`, `sessions.widgetSettings.int.test.ts`, `plugins/exportPackage.int.test.ts`; tsc clean on your files.

## Report (your final message — you cannot write report files)
Changed files; each test added/updated with ONE line on why (for D: the cause of each baseline failure and how you resolved it); test runs with results; Noticed, not done.
