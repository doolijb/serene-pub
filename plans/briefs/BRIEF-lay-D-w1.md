# BRIEF lay-D-w1 — the editor's pure ops on panels v2 (arrangeOps, mobileEdit, presetPreview)

Worker for lane lay-D (supervisor: lay-D). App: /home/jody/github/serene-pub. SDK (read only, built): /home/jody/github/serene-pub-sdk.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal
The session layout is now **panels v2** (owner ruling 2026-11-05 "Get rid of pin" + "One type of group, each zone can have groups"): `PanelLayoutV2 = { version: 2, left: PanelV2[], middle: PanelV2[], right: PanelV2[], backing?, opacity?, gap? }`, `PanelV2 = { key, tabs, open?, height?: 'fit'|'fill'|{share}, priority?: 'high'|'normal'|'low', title? }` (types from `@serene-pub/sdk`, see `/home/jody/github/serene-pub-sdk/sdk/dist/sessionLayout.d.ts:430-500`). There is NO pin, NO rail, NO primary panel, NO above/below strips: three plain stacks. Rewrite the editor's pure modules to edit v2 only.

## Files owned (edit only these)
- `src/lib/client/sessionLayout/arrangeOps.ts` + `arrangeOps.test.ts`
- `src/lib/client/sessionLayout/mobileEdit.ts` + `mobileEdit.test.ts`
- `src/lib/client/sessionLayout/presetPreview.ts` + `presetPreview.test.ts` + `PresetPicture.svelte`

Readable: `livePanels.ts` (`findPanel`, `openTabOf`, `withPanelOpen`, `PanelPlace` — already reads v2), `primaryFloor.ts` (`drawnOf`, `readStoredLayout`), `zoneHeights.ts`, `$lib/shared/widgets/types` (`CORE_WIDGETS`, each may carry `panel?: { height?: 'fit'|'fill'; priority? }` — messages {fill, low}, composer {fit, high}, turn-line {fit, normal}), `widgetInstances.ts`. Other files in the dir are other workers' — don't touch.

## 1. arrangeOps.ts (exact API — other workers code against it)
Keep the module's style (pure; an op answers `{ layout }` with a NEW object, the SAME object for a no-op, or `{ refused }`; input never mutated). Rewrite the header comment for v2.

```ts
export type StackPlace = "left" | "middle" | "right"
export type PanelSlot = { place: StackPlace; index: number }
export type TabSlot = { panelKey: string; index?: number }               // unchanged
export type ArrangeOutcome = { layout: PanelLayoutV2; refused?: undefined } | { refused: string; layout?: undefined }
export type LookPatch = Partial<{ backing: PanelBacking; opacity: number; gap: PanelGap }>
export const MIDDLE_EMPTY = "Put something in the middle first."          // unchanged text
export const ALREADY_PLACED, UNKNOWN_PANEL, UNKNOWN_TAB                   // unchanged texts
// NOT_A_STACK: delete (nothing refuses by place any more)
export function isStackPlace(place: PanelPlace): place is StackPlace       // left|middle|right
export function stackOf(layout: PanelLayoutV2, place: StackPlace): PanelV2[]   // layout[place] ?? []
export function allPanels(layout): Array<{ panel: PanelV2; place: StackPlace }> // order: left, middle, right
export function placedIds(layout): string[]
export function nextPanelKey(layout): string                               // next unused p<n>
export function panelOfTab(layout, id): { panel: PanelV2; place: StackPlace } | null
export function removeRefusal(layout, id): string | null   // UNKNOWN_TAB; MIDDLE_EMPTY when it is the last tab of the middle's ONLY panel
export function addTab(layout, id, to: TabSlot): ArrangeOutcome
export function newPanel(layout, id, at: PanelSlot, init: Pick<PanelV2, "height" | "priority" | "title"> = {}): ArrangeOutcome
export function removeTab(layout, id): ArrangeOutcome
export function moveTab(layout, id, to: TabSlot): ArrangeOutcome
export function splitOut(layout, id, at: PanelSlot): ArrangeOutcome       // one-tab panel → movePanel
export function movePanel(layout, key, to: PanelSlot): ArrangeOutcome     // index counts the target stack WITHOUT this panel
export function setHeight(layout, key, asked: PanelHeightV1 | undefined): ArrangeOutcome
export function setPriority(layout, key, asked: PanelPriority | undefined): ArrangeOutcome
export function setLook(layout, patch: LookPatch): ArrangeOutcome
export function lookOf(layout): PanelLook                                  // effective: stored over DEFAULT_PANEL_LOOK
export function declaredPanelOf(instanceId: string | undefined): { height: "fit" | "fill"; priority: PanelPriority }
export function heightOf(panel: PanelV2): PanelHeightV1                    // effective: valid stored, else declaredPanelOf(openTabOf(panel)).height
export function priorityOf(panel: PanelV2): PanelPriority                  // effective: valid stored, else declared
export function setTitle(layout, key, title): ArrangeOutcome               // unchanged rule
export function setTabOrder(layout, key, tabs): ArrangeOutcome             // unchanged rule
export function samePanels(a, b): boolean                                 // JSON compare, unchanged
```
Rules:
- **The middle is never empty**: any op that would leave `middle` with no panel (removing/moving/splitting its last tab or moving its last panel to a side) answers `{ refused: MIDDLE_EMPTY }`. Moving within the middle is fine. No promotion logic any more (delete `promoted`, `asPrimary`, `setPrimary`, `setPinned`, all `above/below/primary` code; `withPanelPinned` no longer exists in livePanels — do not import it).
- A panel always holds at least one tab; detaching a panel's last tab drops the panel. `open` tidied as today (`tidyOpen`).
- `insertPanel` keeps the panel as is (no strip/pin special cases).
- `declaredPanelOf(id)`: look up `CORE_WIDGETS` by `widgetOfInstance(id)` (`@serene-pub/sdk`); `panel.height` / `panel.priority`, else `"fill"` / `"normal"`. Undefined id → fill/normal.
- `setHeight`: `undefined` means `"fill"`; a `{ share }` is held to a whole 1–12 (as today). The panel's DECLARED default is `declaredPanelOf(openTabOf(panel)).height`: when the asked value equals the declared default (a string), the field is REMOVED (stored form stays minimal: absent = declared, PLAN D1); otherwise it is written explicitly — so Fill on a Composer panel (declared fit) writes `height: "fill"`. Unchanged → same object.
- `setPriority`: same shape — `undefined` or the declared priority removes the field, anything else is written; a value outside high|normal|low → `{ layout }` unchanged; unchanged → same object.
- `setLook`: each patched key validated (backing card|glass|none, gap tight|comfortable|spacious, opacity a finite number → rounded and clamped 0–100; an invalid value is ignored); a value equal to `DEFAULT_PANEL_LOOK[key]` REMOVES the key from the layout, anything else writes it; nothing changed → same object. It never touches the panels.
- Use `findPanel` / `openTabOf` from `./livePanels` where useful (they already handle v2).

Tests (`arrangeOps.test.ts`, vitest — rewrite for v2; keep the existing intent where it still applies, including the "random edit sequences keep every rule" property test, rebuilt over v2 fixtures; drop setPinned/setPrimary/promotion tests): every op on v2; MIDDLE_EMPTY on each path; same-object no-ops; setHeight declared rule (composer panel: Fit removes, Fill writes `"fill"`; notes panel: Fill removes, Fit writes); share clamp; setPriority declared rule (composer: High removes, Low writes; invalid ignored); setLook (default removes, clamp 0–100 + rounding, invalid ignored, same object on no change, panels untouched); lookOf defaults; input never mutated.

## 2. mobileEdit.ts (the phone editor's pure model)
- `PHONE_SECTIONS: ReadonlyArray<{ place: StackPlace; label: string }> = [{left,"Left"},{middle,"Middle"},{right,"Right"}]` — in that order.
- Delete `SideGroup`, `SIDE_GROUPS`, `groups`, `canMakeMain`, `makeMain`, the rail-crossing logic and `placeInGroup`.
- `AddTarget = { kind: "panel"; panelKey: string } | { kind: "stack"; place: StackPlace }`; every section's `add` is `{ kind: "stack", place }` (a new panel at the end of that zone).
- `PhoneRow = { key; place: StackPlace; tabs: string[]; title?; height: "fit" | "fill" /* effective via heightOf; a share reads as fill */; priority: PanelPriority /* effective via priorityOf */; canMoveUp; canMoveDown; aboveKey: string | null; belowKey: string | null }` — neighbours and moves are within the row's zone only.
- `PhoneSection = { place: StackPlace; label; rows: PhoneRow[]; add: AddTarget }`.
- Keep (adapted to v2): `NO_PANEL_ABOVE`, `NO_PANEL_BELOW`, `phoneSections`, `phoneRows`, `moveRow` (a step within its zone; at an end → same object), `moveRowTo`, `moveTabWithin`, `moveTabInto`, `canSplitOut`, `splitTab` (right after its own panel, same zone), `mintFor`, `addAt`, `duplicateTab`, `removeTabFrom`, `setRowHeight(layout, key, "fit" | "fill")` (→ `setHeight`), and add `setRowPriority(layout, key, p: PanelPriority)` (→ `setPriority`).
- Rewrite the header comment (three sections, no groups, no Make main).
Tests (`mobileEdit.test.ts`): rewrite for v2 — three sections in order, rows' effective height/priority (a composer row reads fit/high with nothing stored), moves within a zone, ends are no-ops, moveRowTo, tab moves/into/split/duplicate/remove, MIDDLE_EMPTY on removing the middle's last tab, setRowPriority.

## 3. presetPreview.ts + PresetPicture.svelte
- `drawnOf(readStoredLayout(layout, primaryId), { inline: 0 }, { widgets: CORE_WIDGETS })` so declared heights apply; `drawn.middle` is now a plain `DrawnZone` (`.panels`) like the sides.
- Every zone is a stack by the same rule: a `{ share }` its twelfths, `fit` a small box (SMALL), `fill` an equal share of what is left. No primary special case, no rail: remove `PreviewCell.rail`, the `!p.pinned` branch, `.pv-rail` in PresetPicture. Middle cells keep the `.pv-middle` colour. Drop panels with no tabs.
- Update the header comments (no "rail", no "primary panel").
Tests (`presetPreview.test.ts`): rewrite expectations for v2 (empty preset → the conversation's middle; malformed → same default; side stacks; share/fit; tab counts and labels; retired widget draws nothing; old-slot preset read through the converter — note the converter now ADDS turn-line + composer fit panels after Messages, so the middle shows them; no-conversation layout drawn as is; the genre's own primary kept by the floor). Read the SDK's `panelsV2Of`/`resolveDrawn` behaviour rather than guessing (lay-A: v1/old slots convert to v2; a Messages panel gets a `turn-line` (fit) then `composer` (fit) panel after it).

## Rules (quoted from CLAUDE.md / the lane's common brief)
- Published SDK names are never removed or renamed; you only consume them.
- "session", never "chat". Every new user-visible word must be in this brief; you add none (the section labels Left · Middle · Right exist).
- Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- **Every test or typecheck run goes inside a memory-capped scope** (VS Code has been OOM-killed by bare runs), never bare, one group at a time, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <your test files> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w1-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-D-w1-t.log'` then grep the log. `tsc`: the same scope with `MemoryMax=12G` and `--max-old-space-size=8192`, `npx tsc --noEmit -p .` into `lay-D-w1-tsc.log`, then grep for YOUR files only (other files have known errors owned by other workers — ArrangeCanvas, editorMembership, SessionLayoutEditor, MobileLayoutEditor will break against your new API; that is expected and not yours).
- Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs). Never hand a DOM node to an assertion (compare `x === null` to `true`).
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need sdk:build at all — the SDK is built.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.

## Stop and ask (in your report, don't decide)
A new user-visible word; anything outside the files owned; an SDK change.

## Done means
The three test files green (capped vitest); `npx tsc --noEmit -p .` shows no error in your six files; `npx prettier --check` on them. Report (final message): exported names + signatures, test commands + pass counts, anything you could not do, Noticed-not-done.
