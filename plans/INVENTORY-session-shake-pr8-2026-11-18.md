# The session display shakes sideways (pr-8 report) — diagnosis, 2026-11-18

Report (a tester, Windows 10, fresh user folder): the session display shakes horizontally when the window is maximized rather than fullscreen; also in a browser, when the left widget side is open. The owner promised a fix in pr-9. Read-only diagnosis; **not yet reproduced** (needs a browser with scrollbars that take width).

## Most likely: a widget's box is both the scroller and the size container
- `src/lib/client/components/host/ComponentMount.svelte:394`: every widget's box is `sp-remote-box h-full w-full overflow-auto`; `:436–438`: the same box is `container: sp-widget / inline-size`. Its own vertical scrollbar shrinks the width its `@container` rules, `cqi` units and `%` widths resolve against.
- `src/lib/client/sessionLayout/ZoneColumn.svelte` 142–160: `naturalHeight` forces the box to `height:auto !important` to read a Fit panel's want (so the want is always measured with no scrollbar, at full width); `:169`: a `ResizeObserver` on the widget root re-runs that measurement whenever the root changes size.
- `sessionLayout/zoneHeights.ts` 79–95: when a column's wants exceed its height, one Fit panel gets a partial remainder.
- Some core widgets get SHORTER when narrower: scene portraits (`styles/widgets.css` 6124–6146), the album's latest tile (`:7423`, `aspect-ratio: 4/3`), the stats sheet portrait (`:5539–5542`).
- **The loop**, for such a widget squeezed below its want: no scrollbar, width W, content taller than the box → the scrollbar appears → width W−17, content now fits → the scrollbar goes → back to the start; each flip resizes the root, the observer fires, and the measurement's two style writes force another layout. The unstable band is about 8–17px of window height per such widget.
- Why it fits the report: the side columns are all Fit panels with nothing to absorb slack, so squeezing happens there (left side open); fullscreen adds about 100px of height, so the panel gets its want and never scrolls (maximized, not fullscreen); with overlay scrollbars the scrollbar takes no width, so the two states are one (not seen on this machine).
- These files are unchanged since pr-8 (`ComponentMount.svelte`, `ZoneColumn.svelte`, `zoneHeights.ts`, `PanelTabs.svelte`, `SpScroll.svelte`, `stageBalance.svelte.ts`, `tuckedSides.ts`, `sideSlot.ts`).

## Reproduce
Chromium with scrollbars that take width (headless hides them: run headed or drop `--hide-scrollbars`; confirm with an `overflow:scroll` probe that `offsetWidth − clientWidth > 0`). Put Scene portraits (two characters), Album, or a Stats widget with a sheet portrait in the left column with enough other panels that the column's wants exceed its height. Sweep the viewport height 1px at a time at 1920 wide (~1010 down to 850), then 1536×~790 and 1366×~700; at each step sample every `[data-sp-widget-box]`'s `clientWidth` over 30 animation frames. An alternating value is the defect.

## Fix
Let the allocator decide the scrollbar: `allocateZone` already returns `scrolls` per panel (`zoneHeights.ts:94`). In `ZoneColumn.svelte`, stamp it on the cell: `overflow:hidden` on the box when the panel got its want, `overflow-y:scroll` when squeezed; and make `naturalHeight` force `overflow:hidden` during its read so the want stays measured at full width. (A one-line `scrollbar-gutter: stable` on `.sp-remote-box` would also stop it but costs a permanent gutter in every narrow rail on Windows.) Test: the sweep above as a browser check asserting a stable `clientWidth` for every widget box and a stable `.layout-center` box over 30 frames; a unit test that `scrolls` alone decides the overflow mode.

## Hardening found on the way
- `src/lib/client/components/Layout.svelte:3440`: the page's scroll area is `flex-1 overflow-auto` with no stable gutter, and every width threshold in the session reads the width beneath it (`SessionLayout.svelte` 258–262). Nothing on the session route overflows it today, but if a scrollbar ever appeared two knife-edges would flip: at a 1280px viewport (1920 at 150%) the width is exactly the 1216 zone-switch threshold (`tuckedSides.ts` 90–96, `sideSlot.ts` 248–251); at 1920 with the 400px dock open it is 16px above the 1440 step (`sideSlot.ts` 61–66). Fix: `overflow-hidden` on that area for session routes (the session scrolls internally) and a few px of hysteresis on those two thresholds.
- The composer and turn-line boxes have the same self-referential container query (`styles/widgets.css` 2041–2075, 681–971) but get their full want (the Messages panel absorbs slack), so they do not scroll.

## Cleared
Stage balance; the 900px view-mode tracker (not used by the session); the compact tier; zone-column floors; the widget frames (no size protocol exists; remote widgets render into the page); `SpScroll`; horizontal overflow (no `100vw` / `w-screen` on the session path).
