# BRIEF lay-A-w2 — `WidgetDecl.panel`, the packager's v2 layouts, the frozen v1 fixtures

Worker for lane **lay-A** (supervisor: lay-A). SDK repo `/home/jody/github/serene-pub-sdk`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context
The session layout's `panels` gains a version 2 (owner ruling 2026-11-05: "Get rid of pin." · "One type of group, each zone can have groups." · "introduce a fill/fit priority"): three plain lists of panels, no pin, a per-panel `priority`. Another worker (w1) is writing these types into `sdk/src/sessionLayout.ts` RIGHT NOW (its first step) — you import them, you never edit that file:
```ts
export type PanelPriority = 'high' | 'normal' | 'low'
export interface PanelV2 { key: string; tabs: string[]; open?: string; height?: PanelHeightV1; priority?: PanelPriority; title?: string }
export interface PanelLayoutV2 { version: 2; left: PanelV2[]; middle: PanelV2[]; right: PanelV2[]; backing?: 'card'|'glass'|'none'; opacity?: number; gap?: 'tight'|'comfortable'|'spacious' }
// SessionLayoutV1.panels?: PanelLayoutV1 | PanelLayoutV2
```
Before you type-check, `grep -n "export type PanelPriority\|export interface PanelLayoutV2" /home/jody/github/serene-pub-sdk/sdk/src/sessionLayout.ts`. If they aren't there yet, do the other steps first; if they still aren't there at the end, report "tsc pending w1's types" — the supervisor re-runs it.

## Files owned (edit only these)
- `/home/jody/github/serene-pub-sdk/sdk/src/layout.ts`
- `/home/jody/github/serene-pub-sdk/sdk/src/widgetDecls.ts`
- `/home/jody/github/serene-pub-sdk/cli/src/compiler.ts` — **the `genreLayouts` function only** (≈ lines 2040–2134, and the `PanelV1` import on line 29 if you need `PanelV2` beside it). Nothing else in that file.
- `/home/jody/github/serene-pub-sdk/sdk-tests/widgetDecls.test.ts`
- `/home/jody/github/serene-pub-sdk/sdk-tests/fixtures/core-layouts-old-slots.ts`

Readable: everything. Never touch `sdk/src/sessionLayout.ts` (w1), `core-catalog/**` (lane lay-B, editing it now), or any other test.

## Steps
### 1. Freeze the shipped v1 layouts (do this first)
Lane lay-B is about to rewrite core's shipped layouts (`core-catalog/src/registry/layouts.ts`) to v2, so tests that compare against "the literal the catalogue ships" must stop reading it. The supervisor snapshotted the CURRENT literals before anyone edited them:
- JSON: `/tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-A-shipped-v1-layouts.json` (keys `STORY_LAYOUT`, `STORY_WORLD_LAYOUT`, `LAIR_LAYOUT`, `LAIR_PARTY_LAYOUT`, `DUNGEON_CRAWLER_LAYOUT`)
- the source file as it was: `…/scratchpad/lay-A-layouts.ts.snapshot` (same dir).

Append to `sdk-tests/fixtures/core-layouts-old-slots.ts` five exports typed `SessionLayoutV1`, values exactly the JSON (key for key, written as TS literals in the file's style — tabs, the file's quote style), comments left out:
`V1_STORY_LAYOUT`, `V1_STORY_WORLD_LAYOUT`, `V1_LAIR_LAYOUT`, `V1_LAIR_PARTY_LAYOUT`, `V1_DUNGEON_CRAWLER_LAYOUT`.
Extend the file's header JSDoc with one paragraph: these are core's layouts as they shipped as `panels` version 1 (until 2026-11-05, PLAN-session-layout-simplify), frozen so the converters' goldens don't read the catalogue's v2 literals. Leave the three `OLD_*` exports untouched. Add a quick self-check while you work (not committed as a test): a tsx one-liner that `deepEqual`s each export against the JSON.

### 2. `WidgetDecl.panel` (sdk/src/layout.ts)
Add to `WidgetDecl`, after `maxInstances`:
```ts
panel?: { height?: 'fit' | 'fill'; priority?: PanelPriority }
```
with `import type { PanelPriority } from './sessionLayout.js'` (type-only; this module imports only types). JSDoc (🚧, the file's voice): how the host sizes and weighs the panel that shows this widget when the layout doesn't say — `height`: `fit` its content or `fill` a share of what is left (absent: `fill`); `priority`: when a zone runs short, `low` gives way first, then `normal` (absent: `normal`). A layout's own `PanelV2.height` / `priority` win. Core's: Messages `{ height: 'fill', priority: 'low' }`, Composer `{ height: 'fit', priority: 'high' }`, Turn line `{ height: 'fit', priority: 'normal' }`. `@ruling` the owner, 2026-11-05 (R8: "an expanding composer weighs more than the activity/turn, and it weighs more than the messages").

### 3. Validate it in `widget()` (sdk/src/widgetDecls.ts)
Inside `widget()`'s `problems` list, beside `maxInstances`:
- `d.panel` present and not a plain object → `widget '<id>' panel: { height?, priority? } — an object`
- `panel.height` present and not `'fit' | 'fill'` → `widget '<id>' panel.height: 'fit' or 'fill'`
- `panel.priority` present and not `'high' | 'normal' | 'low'` → `widget '<id>' panel.priority: 'high', 'normal' or 'low'`
Nothing else (no unknown-key check). `WidgetInput` extends `WidgetDecl`, so it inherits the field.

### 4. The packager (cli/src/compiler.ts, `genreLayouts` only)
Its `namespaced(layout)` maps every tab and open tab of `layout.panels` through `q`. Add the v2 case: when `layout.panels.version === 2`, `out.panels = { ...layout.panels, left: …map(panel), middle: …map(panel), right: …map(panel) }` (the look fields carried as written). Leave the v1 branch exactly as it is (narrow on `version`). Type the panel mapper so it serves `PanelV1` and `PanelV2` (a generic `<P extends { tabs: string[]; open?: string }>(p: P): P` is fine). Update the function's JSDoc in one clause (both versions).

### 5. Tests (sdk-tests/widgetDecls.test.ts)
- `widget()`: accepts `panel: { height: 'fit', priority: 'high' }` and `panel: {}`, keeps it on the declaration; refuses each bad shape above with its sentence (assert the regex).
- the packager: a v2 layout (`{ version: 2, left: [...], middle: [...], right: [...], gap: 'tight' }`) — every tab and open tab namespaced (widget half only), keys, `priority`, `height` and the look fields untouched. Model it on the existing test "namespaces the panels slot the same way…" (≈ line 240) and keep that v1 test as it is.
Note: `layout()` (in widgetDecls.ts) runs `validateSessionLayout`, which w1 is changing; a v2 layout literal must have a non-empty `middle` and no `pinned`.

## Rules (quoted)
- "Published SDK names are never removed or renamed in this build: mark ⏳ deprecated instead." (Nothing to remove here.)
- New exported names: none beyond `WidgetDecl.panel` and the five test fixtures. Anything else → stop and report.
- Do what was asked, at the size asked. Findings go under **Noticed, not done** in your report, never fixed in passing. (Known and NOT yours: `forGuests` is dropped by the CLI manifest type, compiler.ts:315; `descriptors.ts` `widgetDeclsFindings` doesn't check `panel`.)

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need `sdk:build` — don't run it.)

Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## Stop and ask (in your report) when
A rule can't hold; a name collides; you'd need to edit a file you don't own.

## Done means
- `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsx --test widgetDecls.test.ts` green (if a failure traces to w1's in-progress `sessionLayout.ts` or lay-B's `core-catalog`, report it with the test name; don't fix).
- Typecheck: `cd /home/jody/github/serene-pub-sdk/sdk-tests && npx tsc --noEmit 2>&1 | grep -E "layout\.ts|widgetDecls|compiler\.ts|core-layouts-old-slots"` empty (sdk-tests' tsconfig maps the SDK to `src`, so it sees w1's types; the CLI's own tsconfig reads the SDK's `dist`, which nobody rebuilds in this lane).
- Formatting: these files are NOT prettier-formatted today, so never run `prettier --write` on them (it would rewrite the whole file); match the surrounding style by hand.
- Report (as your final message): changed files, exported names + signatures, test results, Noticed-not-done.
