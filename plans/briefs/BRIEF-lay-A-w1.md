# BRIEF lay-A-w1 — panels v2 in `sessionLayout.ts` (+ `panelsV2Of.test.ts`)

Worker for lane **lay-A** (supervisor: lay-A). SDK repo `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
Make **panels v2** the session layout's arrangement in `sdk/src/sessionLayout.ts`: three plain zone stacks, no pin, a per-panel `priority`, the layout's look (`backing`, `opacity`, `gap`) inside `panels`, and ONE pure converter `panelsV2Of` that every reader reuses (the app's boot pass will call it too). Owner ruling 2026-11-05: "Get rid of pin." · "One type of group, each zone can have groups." · "Split the messages, composer and activity status/turn select into three widgets".

## Files owned (edit only these)
- `/home/jody/github/serene-pub-sdk/sdk/src/sessionLayout.ts`
- NEW `/home/jody/github/serene-pub-sdk/sdk-tests/panelsV2Of.test.ts`

Readable: everything. Another worker (w2) edits `sdk/src/layout.ts`, `sdk/src/widgetDecls.ts`, `cli/src/compiler.ts`, `sdk-tests/widgetDecls.test.ts` and `sdk-tests/fixtures/core-layouts-old-slots.ts` at the same time — never touch those. Another lane (lay-B) edits `core-catalog/**` at the same time — never touch it.

## Do step 1 FIRST and save it (w2 imports these types)
### 1. Types (beside the v1 panel types, "── Panels ──" section)
All new names are 🚧 provisional — say so in each JSDoc (`🚧` + `@experimental`), the file's style.
```ts
export type PanelPriority = 'high' | 'normal' | 'low'
export type PanelBacking = 'card' | 'glass' | 'none'
export type PanelGap = 'tight' | 'comfortable' | 'spacious'
export const PANEL_GAP_PX: Readonly<Record<PanelGap, number>> = Object.freeze({ tight: 4, comfortable: 12, spacious: 24 })
export interface PanelLook { backing: PanelBacking; opacity: number; gap: PanelGap }
export const DEFAULT_PANEL_LOOK: Readonly<PanelLook> = Object.freeze({ backing: 'card', opacity: 100, gap: 'comfortable' })
export interface PanelV2 { key: string; tabs: string[]; open?: string; height?: PanelHeightV1; priority?: PanelPriority; title?: string }
export interface PanelLayoutV2 { version: 2; left: PanelV2[]; middle: PanelV2[]; right: PanelV2[]; backing?: PanelBacking; opacity?: number; gap?: PanelGap }
```
- `PanelV2.priority` doc: absent = the open tab's widget declaration (`WidgetDecl.panel.priority`), else `'normal'`. When a zone runs short, `low` gives way first, then `normal`.
- `PanelLayoutV2` doc: the middle is never empty; `opacity` 0–100 (percent); absent look values are `DEFAULT_PANEL_LOOK`.
- `SessionLayoutV1.panels?: PanelLayoutV1 | PanelLayoutV2` (doc: v2 is what is written; v1 stays readable, converted on read by `panelsV2Of`).

## Then
### 2. Ids, retired list
- `RETIRED_WIDGET_IDS` = `new Set(['inventory'])` — `composer` comes OFF (rewrite the doc: `composer` is a widget again — the owner's R8, 2026-11-05, "Split the messages, composer and activity status/turn select into three widgets", supersedes NOMENCLATURE §23's 2026-09-16 "composer (the widget) — Merged into messages").
- NEW `export const LEGACY_SLOT_DROPPED: ReadonlySet<string> = new Set(['composer'])` (⏳ @experimental): widget ids the OLD-SLOT path drops, so a slot-era blob never revives a composer. Used ONLY in `convertSlots` (its `admit`, and the side's "arrangement places anything live" test) — i.e. `panelsFromSlots`. Nowhere else.
- NEW `export function conversationSplitIds(instanceId: string): { composer: string; turnLine: string }` — `messages` → `{ composer: 'composer', turnLine: 'turn-line' }`; `messages#x` → `{ composer: 'composer#x', turnLine: 'turn-line#x' }` (use `instanceNameOf`). Pure.

### 3. The converter `panelsV2Of`
```ts
export interface PanelsV2Options extends PanelsFromSlotsOptions {
  /** Per-instance settings to read and plan moves over; absent = the layout's own `widgetSettings`. */
  widgetSettings?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** Style pins (any value: a pin or a style id) keyed by instance id; absent = the layout's own `widgetStyles`. */
  widgetStyles?: Readonly<Record<string, unknown>>
}
export type PanelSettingsMove =
  | { from: string; to: string; key: string; value: unknown }
  | { drop: string; key: string }
export interface PanelsV2Conversion { panels: PanelLayoutV2; settingsMoves: PanelSettingsMove[]; styleCopies: Array<{ from: string; to: string }> }
export function panelsV2Of(layout: SessionLayoutV1, opts?: PanelsV2Options): PanelsV2Conversion
```
Pure, deterministic, never throws on any input, never mutates its input. Rules (PLAN D2, exactly):
1. **A stored v2** (`isObj(layout.panels) && layout.panels.version === 2`): return `{ panels: layout.panels (the same object), settingsMoves: [], styleCopies: [] }`. Idempotent: converting the output again changes nothing.
2. Otherwise the v1 source: a stored v1 (today's `storedPanels` test: `version === 1`, `middle` and `middle.primary` objects) else `convertSlots(layout, opts)` (old slots, keeps its `floor`). Any other `panels.version` reads as absent (→ old slots).
3. **Flatten**: `left`, `middle = [...above, primary, ...below]`, `right`. Each panel is rebuilt with ONLY `key`, `tabs` (strings of the stored list), and `open` / `height` / `title` when present — `pinned` and any stray key dropped. Keep every panel object (no repair: readers skip empty panels). Use the existing `panelList` / `strings` helpers.
4. **Settings source** `S` = `opts.widgetSettings ?? layout.widgetSettings ?? {}` (read defensively). **Style source** `T` = `opts.widgetStyles ?? layout.widgetStyles ?? {}`.
5. **Composer insertion.** Skip it entirely if any flattened panel already has a tab that is a copy of `composer` (`isInstanceOf(id, 'composer')`). Otherwise, for each panel in each zone (zones in order middle, left, right; panels top to bottom), let `M` = its FIRST tab that is a copy of `messages` whose effective `showComposer !== false` (effective = `S[id].showComposer` when it is a boolean, else the default `true`). If there is an `M`: `{ composer: c, turnLine: t } = conversationSplitIds(M)`; insert a turn-line panel `{ key, tabs: [t], height: 'fit' }` UNLESS the effective `nextUp` is `'hidden'`, then a composer panel `{ key, tabs: [c], height: 'fit' }`. The pair goes right AFTER the panel — `[panel, turn-line, composer]` — or right BEFORE it when the effective `composerPosition === 'top'` — `[turn-line, composer, panel]`. Effective `nextUp` = `S[M].nextUp` when it is one of `head | list | hidden`, else `'hidden'` when `S[M].showNudge === false` (the legacy boolean still reads as hidden — core's messages declaration says so), else `'head'`. Effective `composerPosition` = `S[M].composerPosition === 'top' ? 'top' : 'bottom'`. Never insert an id that is already a tab anywhere (defensive).
   - New keys continue the `p<n>` counter: the next number above the highest `p<n>` key in the layout, assigned in final array order, zones middle → left → right.
   - **Floor**: when the v1 source came from `convertSlots` with `floor: true`, the floor's panel (the old primary) AND any turn-line/composer panels inserted for it are floor panels — keep their keys in an internal set (see §4). `panelsV2Of` itself does not return it; write an internal `convertToV2(layout, opts)` that returns `{ ...PanelsV2Conversion, floorKeys: ReadonlySet<string> }` and have `panelsV2Of` drop `floorKeys`.
6. **settingsMoves** — walk `S`'s entries in object order; for each instance id, check keys in this fixed order and emit at most one entry per key that is PRESENT (own property, any value):
   - On a copy of `messages`: `composer`, `otherTabsComposer`, `showActions` → `{ from: id, to: <its composer id>, key, value }` when `id` is an `M` that got a composer inserted, else `{ drop: id, key }`; `nextUp` → `{ from, to: <its turn-line id>, key, value }` when `id` got a turn line inserted, else `{ drop }`; then `composerPosition`, `showComposer`, `showMessages`, `backingMode` → `{ drop }`.
   - On EVERY instance (any widget): `hostCard` → `{ drop }` (it is core's per-widget Card setting, offered on every widget; the others are Messages' own keys and are left alone on other widgets — a plugin widget may have a setting of that name).
   - Order of the keys for a messages copy: `composer, otherTabsComposer, showActions, nextUp, composerPosition, showComposer, showMessages, hostCard, backingMode`.
7. **styleCopies**: for each inserted composer / turn-line id (in insertion order, turn-line before composer when both), `{ from: M, to: newId }` when `T[M]` is present (not `undefined`/`null`) and `T[newId]` is not.
8. No look is written: the output has no `backing` / `opacity` / `gap`.

### 4. Readers (all walk v2 now)
- `storedPanels` (internal) accepts a stored v2 (`version === 2`) as well as v1.
- `panelsWithFloor` (internal) → `{ panels: PanelLayoutV2; floorKeys: ReadonlySet<string> }` via `convertToV2`.
- `panelsOf(layout, opts?: PanelsV2Options): PanelLayoutV2` — always v2: `panelsV2Of(layout, opts).panels`. (Its return type changes: say so in the JSDoc.)
- `panelTabs`, `layoutWidgetIds`, `middleWidgetIds` walk the three v2 lists; floor panels are left out, as today. A v1 or slot layout's derived composer/turn-line ARE counted (they are drawn).
- Every reader is defensive: a v2 whose zone is not an array reads as `[]`; stray v1 keys on a v2 (`above`, `primary`, a panel's `pinned`) are ignored.

### 5. `resolveDrawn`
```ts
export interface ResolveDrawnOptions { /** Widget declarations by the id the layout names them — for a panel's default priority and height. */ widgets?: readonly Pick<WidgetDecl, 'id' | 'panel'>[] }
export function resolveDrawn(layout: SessionLayoutV1, box: { inline: number; block?: number }, opts?: ResolveDrawnOptions): DrawnLayout
export interface DrawnLayout { left: DrawnZone; middle: DrawnZone; right: DrawnZone; look: PanelLook & { gapPx: number } }
```
(`WidgetDecl.panel?: { height?: 'fit' | 'fill'; priority?: PanelPriority }` is being added to `layout.ts` by w2 right now. Until it lands your `Pick<WidgetDecl, 'id' | 'panel'>` won't type-check — that is expected; do not edit layout.ts. If you need to compile meanwhile, run tsx tests, which don't type-check.)
- Reads `panelsWithFloor(layout)`. Retired tabs dropped, each instance drawn once in reading order middle → left → right (as today), panels left with no tab not drawn (in every zone now — there is no primary).
- `DrawnPanel` gains `priority: PanelPriority`: the panel's stored `priority` when valid → the OPEN tab's declaration `panel.priority` (decl found by `widgetId` after alias, in `opts.widgets`) → `'normal'`.
- `DrawnPanel.height`: the stored height when valid (`heightOf`'s rules) → else the open tab's declaration `panel.height` (`fit` / `fill`) → else `'fill'`.
- `DrawnPanel.floor: true` on floor panels (`floorKeys`).
- `look`: from a stored v2's `backing` / `opacity` / `gap`: a known backing else `'card'`; opacity a finite number clamped to 0–100 else `100`; a known gap else `'comfortable'`; `gapPx = PANEL_GAP_PX[gap]`. A v1/slot layout reads `DEFAULT_PANEL_LOOK`.
- The pin is gone: `DrawnInstance.pinned`, `DrawnPanel.pinned`, `DrawnZone.pinned` stay in the types and are always `true`. `DrawnZone.rung` and `DrawnZone.zoneKey` are no longer set (leave them optional in the type). `box` is no longer read (no width ladder); keep the parameter.
- `drawnInstances`, `drawnWidgetIds`, `primaryPlaced` keep working on the new shape.

### 6. ⏳ Deprecated, kept exported, unused by the v2 readers
JSDoc `@deprecated ⏳ removed at 0.7 (owner's call)` on: `PanelMiddleV1`, `DrawnMiddle`, `pinnedOf`, the `pinned` fields of `PanelV1` / `DrawnInstance` / `DrawnPanel` / `DrawnZone`, `DrawnZone.rung`, `DrawnZone.zoneKey`, `ZoneRung`, `DEFAULT_SIDE_RULES`, `DEFAULT_STRIP_RULES`, `zoneRungAt`. They keep working exactly as today (`pinnedOf` is still used by `convertSlots` — fine). Nothing is removed or renamed — published SDK names are the owner's call.

### 7. `validateSessionLayout`
- `panels.version === 2`: errors —
  - not `{ version: 2, left: [], middle: [], right: [] }` lists → `panels: { version: 2, left: [ … ], middle: [ … ], right: [ … ], backing?, opacity?, gap? }` (and per zone `panels.<zone>: a list of panels, top to bottom`);
  - `middle` an object (v1's) or `panels.above` / `panels.primary` / `panels.below` present → `panels.middle: one list of panels, top to bottom — above / primary / below are version 1's`;
  - empty middle → `panels.middle: the middle is never empty — at least one panel`;
  - a panel: the same key / tabs / open / height / title checks as v1 (reuse `panel()`), PLUS `pinned` present → `${at}.pinned: there is no pin in version 2 — every panel is open; leave it out`; `priority` not one of the three → `${at}.priority: 'high', 'normal' or 'low'`;
  - `backing` → `panels.backing: 'card', 'glass' or 'none'`; `opacity` not a finite number in 0–100 → `panels.opacity: a number from 0 to 100`; `gap` → `panels.gap: 'tight', 'comfortable' or 'spacious'`.
- `panels.version === 1`: every check as today, PLUS a WARNING starting `panels-v1:` — `panels-v1: version 1 panels are converted on read (panelsV2Of) — ship { version: 2, … }`.
- Any other version → the shape error (mention both versions).
- Conversation-missing warning: no copy of `messages` in ANY zone (v1 or v2).
- `'composer'` is no longer retired, so it no longer warns as retired. In the old slots (no `panels`), a placed copy of a `LEGACY_SLOT_DROPPED` widget warns `'<id>' is a slot-era composer — the old slots never draw it; place the Composer in panels` instead of the "placed but never drawn" warning.
- Update the validator's JSDoc list of errors/warnings.

### 8. Module header (lines 1–62)
Rewrite "The shape in one paragraph" for v2 (three stacks, no pin, priority, look inside `panels`; v1 read and converted by `panelsV2Of`, the ONE converter alongside `panelsFromSlots`). Keep it tight. "session", never "chat".

## `panelsV2Of.test.ts` (node:test + `assert/strict`, import from `'../sdk/src/index.js'`; see `sdk-tests/panelsFromSlots.test.ts` for the house style)
Cover, at least: a v2 input returns the same object and no moves; idempotence (`panelsV2Of({ ...layout, panels: out.panels })` returns those panels, no moves); flatten order and `pinned` dropped; composer + turn line after the panel, and before it with `composerPosition: 'top'`; `nextUp: 'hidden'` (and legacy `showNudge: false`) → no turn line; `showComposer: false` → no pair (a reading pane); `messages#journal` → `composer#journal` / `turn-line#journal`; two composing panels each get their own pair; the FIRST composing Messages tab of a panel names it (e.g. tabs `['messages#parley','messages','annex#planning-notes']` → `composer#parley`); a layout already placing `composer` gets nothing inserted; keys continue `p<n>`; `opts.widgetSettings` wins over `layout.widgetSettings`; the exact `settingsMoves` (moves and drops, in the fixed order, `hostCard` dropped on a non-messages widget, `showMessages` on a non-messages widget left alone); `styleCopies` only when the Messages copy has a pin and the new id has none; old slots go through `panelsFromSlots` (a slot-era `composer` is NOT revived, the floor's conversation gets its pair); `conversationSplitIds`; `RETIRED_WIDGET_IDS` no longer holds `composer`, `LEGACY_SLOT_DROPPED` does; total on junk (`null`, `{ panels: 7 }`, `{ panels: { version: 9 } }`). Write layout literals inline in the test — do not import core-catalog's shipped layouts (lay-B is rewriting them).

## Rules (quoted from CLAUDE.md / the lane brief)
- "Published SDK names are never removed or renamed in this build: mark ⏳ deprecated instead (owner's call, PLAN D4)."
- "No `svelte` import, ever" in this module (it is a leaf: a linked package that imports svelte gives the app a second Svelte). Import only types from `layout.ts`.
- New names you add are exactly the ones in this brief. Do not invent others (exported); internal helpers are fine. Any extra exported name → stop and report.
- "It is a session, never a chat."
- Do what was asked, at the size asked. Findings go under **Noticed, not done** in your report, never fixed in passing.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build` at all — don't run it.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## Stop and ask (in your report) when
A rule above can't hold as written; a name collides with an existing export (`grep -rn "export .*<Name>" sdk/src`); you'd need to touch a file you don't own.

## Done means
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test panelsV2Of.test.ts` green.
- `cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p sdk/tsconfig.build.json` — no error in `sessionLayout.ts` (an error about `WidgetDecl['panel']` only while w2's `layout.ts` change is missing is acceptable; say so).
- Expected and NOT yours to fix: `sessionLayout.test.ts`, `panelsFromSlots.test.ts`, `resolveDrawn.test.ts`, `widgetAliases.test.ts` will fail on the new shapes — other workers rewrite them next. Run them once and list which tests fail (names only) in your report.
- Formatting: these SDK files are NOT prettier-formatted today, so never run `prettier --write` on them (it would rewrite the whole file); match the surrounding style by hand. The new `panelsV2Of.test.ts` should pass `npx prettier --check`.
- Report (as your final message): exported names + signatures added/changed, the decisions you made inside the brief, test results, Noticed-not-done.
