# REPORT shake-1 — the session display must hold still (pr-8 report) — 2026-11-18

Saved by the lead from the worker's hand-back. Brief: `briefs/BRIEF-shake-1.md`; diagnosis `INVENTORY-session-shake-pr8-2026-11-18.md`. **The defect has not been reproduced in a browser; the sweep script has not been run.**

## Built
- `sessionLayout/zoneHeights.ts`: `boxOverflowOf(scrolls)` → "hidden" | "scroll". `sessionLayout/ZoneColumn.svelte`: each Fit panel's cell carries `data-box-overflow` once the allocator has answered; a scoped rule sets the widget's box to `overflow: hidden` (it got its want) or `overflow-y: scroll` (squeezed); `naturalHeight` forces `overflow: hidden !important` during its read and restores the box's saved style exactly. Fill and share panels keep `auto` (no measured want; `hidden` would clip them). `ComponentMount.svelte` itself unchanged.
- `components/Layout.svelte`: `onSessionRoute` (path starts with `/sessions/`): the page's scroll area is `overflow-hidden` there, `overflow-auto` elsewhere (the session list still scrolls). Read in code only: session pages size themselves with `h-full` / `min-h-0 flex-1`; "session not found" is a short centred block. Not checked at runtime: the phone layout, the notes views.
- `sessionLayout/tuckedSides.ts` (`MODE_HYSTERESIS_PX` = 8, `belowThresholdKept`), `sessionLayout/sideSlot.ts` (`sideWidthKeptPx`, optional `wasGranted` on `emptyColumnsPx`): pure functions with the previous answer as an argument. **Not wired in:** the callers `sessionZones.svelte.ts` (`switchOn`) and `sessionLayoutModel.svelte.ts` (`sideWidthPx` ~365, `emptyColumnsPx` ~535) were outside the task's files → follow-up `shake-2`.
- STYLE-GUIDE (the container-query rule); `docs/session-layout.md` (one clause).
- The sweep script: `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/shake-1-sweep.mjs`.

## Tests
5 files, 104 pass (`zoneHeights`, `zoneColumn.dom`, `tuckedSides`, `sideSlot`, `componentMount.dom`): a squeezed Fit panel is stamped scroll, an unsqueezed one hidden, Fill gets no stamp, `naturalHeight` restores `style` exactly and reads with overflow hidden. `tsc` 0; `npm run check` 0 errors.

## Mounts of `ComponentMount`
Only through `RemoteWidget` and `PreviewPane`. In a session, `SessionLayoutRender` renders both inside `ZoneColumn` cells (Fit: hidden or scroll; Fill and share: auto). `Panel` in `SurfaceGrid` and `PanelFixture`, and `PreviewPane`, stay `auto`.

## Noticed
The SDK comment at `sdk/src/sessionLayout.ts` ~1270 still assumes an 8px gap.
