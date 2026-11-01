/**
 * Full screen — a session control (`panelsCtx.fullscreen`, Ctrl/⌘ + Shift + F,
 * `useSessionFullscreen`), at every width; the phone already draws the stage,
 * full screen also hides its panels menu and strips. The session's side zones,
 * its strips, every flyout, sheet, scrim and the panels menu go away, and only
 * the STAGE stays, taking the whole body: the layout's primary log, wherever
 * it is placed (./placementRules `stageOf` — QE, brief 7a) — or, in a layout
 * holding no conversation (R-B), the primary panel, whatever it holds. In the
 * middle that is the PANEL holding it (`stagePanelOf`, below;
 * PLAN-session-panels-2026-10-14); in a side it is that panel, in that side's
 * mount, drawn in ./sideSlot's `stage` slot while the middle is hidden.
 * Turning it off restores exactly what was there: nothing here writes the
 * layout, and nothing is unmounted — a hidden widget is `display: none` around
 * its mount (the mount-on-first-show rule, ../components/host/firstShow.ts),
 * so an iframe under it keeps running and a native widget keeps its state.
 */

/** Whether the session should draw full screen now. */
export function fullscreenActive(
	ctx: { fullscreen?: boolean } | undefined
): boolean {
	return !!ctx?.fullscreen
}

/**
 * The key of the panel that holds the stage's widget (`stageId`: the
 * instance `stageOf` picked) — as one of its tabs — or null when no panel
 * does, in which case nothing there is hidden, because hiding every panel
 * would leave the session blank.
 */
export function stagePanelOf(
	panels: readonly { key: string; tabs: readonly { instanceId: string }[] }[],
	stageId: string | null | undefined
): string | null {
	if (!stageId) return null
	return panels.find((p) => p.tabs.some((t) => t.instanceId === stageId))?.key ?? null
}
