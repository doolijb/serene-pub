# BRIEF lay-C-w1 — pure layout modules: heights, zone switch, panel backing, composer target

Worker for lane lay-C (supervisor: lay-C). App: /home/jody/github/serene-pub. SDK (read only): /home/jody/github/serene-pub-sdk.
Context: the owner ruled (2026-11-05) session layouts v2: every zone (Left · Middle · Right) is a stack of panels; no pin, no rail of icons; panels have a height (Fit / Fill / divider share) and a **priority** (high · normal · low); a **zone switch** shows one zone at a time when the sides don't fit; the panel (not the widget) draws the card ("backing") from layout-level settings; Messages, Composer and Turn line are three widgets. You build the PURE pieces (plus one small component). Another worker later wires them into the live render — do not touch any file not listed below.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Files owned (create these; edit nothing else)
- `src/lib/client/sessionLayout/zoneHeights.ts` + `zoneHeights.test.ts`
- `src/lib/client/sessionLayout/sessionZones.svelte.ts` + `sessionZones.test.ts`
- `src/lib/client/sessionLayout/ZoneSwitch.svelte` + `zoneSwitch.dom.test.svelte.ts`
- `src/lib/client/sessionLayout/panelBacking.ts` + `panelBacking.test.ts`
- `src/lib/client/sessionLayout/conversationTarget.ts` + `conversationTarget.test.ts`

## Files readable
`src/lib/client/sessionLayout/{tuckedSides.ts,sideRail.ts,sideSlot.ts,sessionLayoutModel.svelte.ts,PanelTabs.svelte,panelTabs.dom.test.svelte.ts}`, `src/lib/shared/widgets/messageBacking.ts` (+ its test — the regex reader you generalize), `src/app.css` (glass tokens ~100-155), the SDK dist types `/home/jody/github/serene-pub-sdk/sdk/dist/sessionLayout.d.ts` (`DrawnPanel`, `DrawnLayout`, `PanelLook`, `PanelPriority`, `PanelBacking`, `PANEL_GAP_PX`, `isInstanceOf`, `widgetOfInstance`), STYLE-GUIDE.md §6.5 (lines ~1165-1204).

## 1. `zoneHeights.ts` — `allocateZone` (PLAN D10)
```ts
export type ZoneHeight = "fit" | "fill" | { share: number }   // = SDK PanelHeightV1
export interface ZonePanelIn { key: string; height: ZoneHeight; priority: "high" | "normal" | "low"; wantPx: number | null; floorPx: number }
export interface ZonePanelOut { key: string; px: number; scrolls: boolean }
export function allocateZone(o: { columnPx: number; gapPx: number; panels: readonly ZonePanelIn[] }): ZonePanelOut[] | null
```
Rules, exactly:
- Returns `null` ("unmeasured — draw today's CSS tracks for this frame") when `columnPx <= 0`, or any `fit` panel has `wantPx === null`.
- `avail = max(0, columnPx − gapPx × (n − 1))`.
- Start every panel at its `floorPx` (the caller supplies floors: Messages 160, Fit `min(want, 120)`, others 0 — export `MESSAGES_FLOOR_PX = 160` and `FIT_FLOOR_PX = 120` and a helper `floorOf({ height, isMessages, wantPx })` that returns exactly that, so callers don't retype it).
- If the floors alone exceed `avail`: every panel gets its floor, `scrolls = want > floor` for fit panels (the zone itself scrolls; the caller makes the column `overflow-y: auto`).
- Otherwise grant WANTS in priority tiers high → normal → low, reading order inside a tier. A `fit` panel wants `wantPx`; a `{ share }` panel wants `clamp(share,1,12)/12 × avail`; a `fill` panel wants nothing here. Each grant is `min(want − px, rest)`; `rest` shrinks.
- What is left goes to the `fill` panels in equal parts (added to their floors). With no fill panel it stays unassigned (the column has space at its foot — today's behaviour).
- `scrolls`: a `fit` or share panel whose `px < want` (it scrolls inside itself — e.g. a tall Composer past which Messages hit its 160px floor). Fill panels never `scrolls`.
- Round px to whole pixels at the end without exceeding `avail` (floor each, then hand the remainder pixels to fill panels first, else the last panel).
- Pure; never mutates its input; same input → same output.
Also export `cssTrackOf(p: { height: ZoneHeight; isMessages: boolean }): string` — the first-frame fallback track: Messages fill `minmax(160px, 1fr)`, other fill `minmax(0, 1fr)`, fit `minmax(120px, auto)`, share exactly `minmax(0, calc(${share} / 12 * 100%))` (share clamped 1–12).
Tests (`zoneHeights.test.ts`, vitest): unmeasured → null; floors overflow; Composer (fit/high) + Turn line (fit/normal) + Messages (fill/low) where the composer grows until Messages hits 160 and then `composer.scrolls === true`; low gives way before normal; two fills split evenly; share holds when room, shrinks on overflow by tier; rounding sums ≤ avail; gap counted n−1 times; input not mutated.

## 2. `sessionZones.svelte.ts` — the zone switch's state (PLAN D11)
The session header (another component tree) and the live render share it, so it is a module singleton, like `mobileSidePanels.svelte.ts` (read it for the pattern; you do NOT edit or delete it).
```ts
export type ZoneId = "left" | "middle" | "right"
export const ZONE_LABELS: Readonly<Record<ZoneId, string>> = { left: "Left", middle: "Middle", right: "Right" }
/** Pure: is the switch on? Always below lg; on a desktop when the docked sides + their gaps + the stage's measure don't fit. */
export function switchOn(o: { narrow: boolean; bodyPx: number; leftPx: number; rightPx: number; gapPx: number }): boolean
```
`switchOn` = `narrow || (bodyPx > 0 && bodyPx < tuckThresholdPx({ leftPx, rightPx, gapPx }))` — import `tuckThresholdPx` from `./tuckedSides` (it stays; another worker removes the rest of the tuck code later). An unmeasured box (0) on a desktop is off.
```ts
class SessionZones {
  switchOn: boolean            // $state, published by the live render
  available: ZoneId[]          // $state — zones that draw at least one panel, in Left, Middle, Right order
  shown: ZoneId | null         // $state — the zone drawn while the switch is on; null while off
  /** The live render publishes each change. When the switch turns on, or `shown` is no longer available, `shown` becomes `opening` (else the first available). Off → shown = null. Same values → no writes (untrack reads). */
  publish(o: { switchOn: boolean; available: readonly ZoneId[]; opening: ZoneId }): void
  /** A press on the switch. Ignored unless the switch is on and `z` is available. */
  show(z: ZoneId): void
  /** Page teardown. */
  reset(): void
}
export const sessionZones = new SessionZones()
```
Also MOVE the two roving helpers here (copy them verbatim from `sideRail.ts:271-290`, with their doc comments re-worded for a switch): `export function rovingStep(key, index, count): number | null` and `export function rovingStop(remembered, count): number`. Do not edit `sideRail.ts`.
Rules: `publish` is called from an `$effect`; it must not read its own state reactively in a way that loops — wrap reads in `untrack` (CLAUDE.md: "Untrack reads in effect-called store methods"). Arrays: replace, never mutate in place. No `crypto.randomUUID`.
Tests (`sessionZones.test.ts`): `switchOn` truth table (narrow; wide enough; too narrow; unmeasured; both sides 0 → off on desktop); publish on → shown = opening; a `show()` choice survives a re-publish with the same available; shown removed from available → opening; off → null; `show` ignored when off or unavailable; rovingStep / rovingStop (wrap, Home/End, unknown key null).

## 3. `ZoneSwitch.svelte` — the segmented switch (PLAN ★2, D11)
Props: `{ zones?: typeof sessionZones; class?: string }` (default the singleton; tests pass their own instance — so export the class too: `export { SessionZones }`). Renders nothing unless `zones.switchOn`. Otherwise one `role="group"` element with NO aria-label (no new words beyond the three labels are allowed; a group of self-naming pressed buttons needs none). One `<button type="button">` per AVAILABLE zone in Left · Middle · Right order (a zone with no panels is not offered), label text from `ZONE_LABELS`, `aria-pressed={zone === zones.shown}`, the pressed one `preset-pressed`, others plain. STYLE-GUIDE §6.5 quote: *"A control that picks one value from a short fixed set is not a tab and may be segmented … a `role="group"` of options, the chosen one `preset-pressed` with `aria-pressed`"*; the track `surface-100-900` (class `bg-surface-100-900 rounded-container p-0.5 flex`), each button at least 44px tall and wide (`min-h-11 min-w-11 px-3`). Roving focus: the group is ONE tab stop (the pressed button `tabindex=0`, others `-1`); Arrow keys / Home / End move focus via `rovingStep` AND select (press) the zone; Enter/Space press natively. Click → `zones.show(z)`. No icons needed. Markup has no `id`s that could collide (use `$props.id()` if you need one).
Tests (`zoneSwitch.dom.test.svelte.ts`, vitest + happy-dom, pattern of `panelTabs.dom.test.svelte.ts`): hidden when off; only available zones drawn; aria-pressed follows shown; click shows; ArrowRight wraps and moves focus + selection; one tab stop. **Never hand a DOM node to an assertion** (`expect(el).toBeNull()` / `toBe(node)` balloon when they fail and have OOM-killed VS Code): compare `expect(el === null).toBe(true)`, assert on strings/booleans/counts only.

## 4. `panelBacking.ts` — the panel's card (PLAN R7, D9)
The host draws the backing on the PANEL box as four CSS custom properties; a widget's style may override them.
```ts
export const WIDGET_BOX_VARS = ["--sp-widget-margin", "--sp-widget-background", "--sp-widget-radius", "--sp-widget-border"] as const
export type WidgetBoxVar = (typeof WIDGET_BOX_VARS)[number]
export type WidgetBox = Partial<Record<WidgetBoxVar, string>>
/** The host's values for a layout look (`DrawnLayout.look`: backing card|glass|none, opacity 0–100). */
export function hostWidgetBox(look: { backing: "card" | "glass" | "none"; opacity: number }): Required<WidgetBox>
/** What a style declares for the four (vars first, then its CSS, last declaration wins; comments ignored) — generalize `declaredBacking` in messageBacking.ts. Values are passed through trimmed, but a value containing `;`, `{`, `}`, `<` or `url(` is dropped (it lands in an inline style). */
export function declaredWidgetBox(skin: { css?: string | null; vars?: Record<string, string> | null } | null | undefined): WidgetBox
/** host then declared on top, as one inline style string `--a: x; --b: y` (stable key order = WIDGET_BOX_VARS). */
export function widgetBoxStyle(look, skin): string
/** chrome.card for the envelope: the panel draws a backing (PLAN D4: "this panel's backing is not none"). */
export function backingShown(look): boolean
```
Values (theme tokens only — never literal colours; opacity clamps to 0–100, non-number → 100):
- card: margin `0`; background `color-mix(in oklab, var(--color-surface-100-900) <op>%, transparent)`; radius `var(--radius-container)`; border `1px solid var(--color-surface-200-800)`.
- glass: margin `0`; background `color-mix(in oklab, var(--sp-glass-bg) <op>%, transparent)`; radius `var(--radius-container)`; border `1px solid var(--sp-glass-bd)`.
- none: margin `0`; background `transparent`; radius `0`; border `none`.
`vars` keys may come with or without the leading `--` (as `declaredBacking` accepts `sp-backing`). Tests (`panelBacking.test.ts`): the three looks; opacity clamp; vars beat CSS; last CSS declaration wins; comments ignored; injection values dropped; key order of the style string. This replaces `messageBacking.test.ts` later (another worker deletes that file — you don't).

## 5. `conversationTarget.ts` — which Messages a Composer / Turn line follows (PLAN D7)
```ts
export interface TargetZones { left: readonly TargetPanel[]; middle: readonly TargetPanel[]; right: readonly TargetPanel[] }
export interface TargetPanel { key: string; tabs: readonly string[]; open: string }   // instance ids; `open` = shown tab
export interface ConversationTargetPick { target: string; writingTo: boolean }
export function conversationTargetOf(o: { zones: TargetZones; instanceId: string; isMessages(id: string): boolean; last?: string | null }): ConversationTargetPick | null
export type ConversationKind = "messages" | "composer" | "turn-line"
export function conversationKindOf(id: string): ConversationKind | null   // isInstanceOf(id, "messages" | "composer" | "turn-line") from @serene-pub/sdk
```
Rules (D7, quoted): *"the nearest panel ABOVE in the same zone whose open tab is a Messages copy; else the nearest Messages panel in its zone; else the layout's first Messages. If that panel is showing a non-Messages tab, keep the last channel and show Writing to ‹channel›."* Exactly:
1. Find the zone + index of the panel holding `instanceId` (any tab). Not found → null.
2. Walk UP from index−1 to 0 in that zone: the first panel whose `open` is a Messages copy → `{ target: open, writingTo: false }`.
3. Else the nearest panel in the zone (smallest |distance|; ties → the one above) holding ANY Messages tab; else the first panel in reading order middle, left, right holding one. For that panel: if its `open` is Messages → `{ target: open, writingTo: false }`; otherwise target = `last` when `last` is one of that panel's tabs, else its first Messages tab, and `writingTo: true`.
4. No Messages anywhere → null.
Pure. Tests: Story default (middle `[messages · stats#characters] [turn-line] [composer]`, open messages → messages/false; open stats → messages/true; `last` honoured); two Messages panels above (nearest wins); composer above its Messages (falls to step 3, below, writingTo false); composer in a side with Messages only in the middle → middle's; no Messages → null; Lair `messages#sanctum` copy as a tab.

## Rules (quoted, they bind you)
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." "It is a **session**, never a *chat*."
- New names: everything exported above is pre-approved by the supervisor; add NO other exported name, setting, event or user-visible word. The only user-visible words allowed are **Left**, **Middle**, **Right**. List every exported name in your report.
- Every test or typecheck run goes inside a memory-capped scope, never bare, one group at a time, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && timeout 900 npx vitest run <your test files> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-C-w1-t.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-C-w1-t.log'` then grep the log. `tsc`: same scope with `MemoryMax=12G` and `--max-old-space-size=8192`, `npx tsc --noEmit -p .`, then grep the log for YOUR files only (other files have known errors). `npm run check` likewise (12G) for your .svelte file.
- Never pipe vitest into `head` (SIGPIPE leaks PGlite temp dirs). Never hand a DOM node to an assertion.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to build the SDK at all — don't.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
- Do not start a dev server.

## Stop and ask (in your report, don't decide) when
A rule above can't hold as written; you want a name, word, setting or file not listed.

## Done means
The five test files green (vitest, capped); `npx tsc --noEmit -p .` shows no error in your files; `npm run check` clean for ZoneSwitch.svelte; `npx prettier --check` on your files. Report (final message): exported names + signatures, files created, test commands + pass counts, anything you could not do, Noticed-not-done.
