/**
 * Stage only — the shell's "just the conversation" mode (`panelsCtx.stageOnly`,
 * Ctrl/⌘ + .). The session's side zones, its strips, every flyout, sheet,
 * scrim and the panels menu go away, and only the STAGE stays, taking the
 * whole body: the layout's primary log, wherever it is placed
 * (./placementRules `stageOf` — QE, brief 7a). In the middle that is the unit
 * holding it (`primaryUnitKey`, below); in a side it is that side's mount,
 * drawn in ./sideSlot's `stage` slot while the middle is hidden. Turning it off restores
 * exactly what was there: nothing here writes the layout, and nothing is
 * unmounted — a hidden widget is `display: none` around its mount (the
 * mount-on-first-show rule, ../components/host/firstShow.ts), so an iframe
 * under it keeps running and a native widget keeps its state.
 *
 * The shell draws it at desktop width only (`data-stage-only` on its root is
 * gated on `desktop.matches`), so the session reads the same two facts.
 */

/** Whether the session should draw stage-only now. */
export function stageOnlyActive(
	ctx: { stageOnly?: boolean } | undefined,
	isDesktop: boolean
): boolean {
	return !!ctx?.stageOnly && isDesktop
}

/**
 * The key of the middle unit that holds the stage's widget (`primaryId`: the
 * instance `stageOf` picked), or null when no unit does — in which case
 * nothing in the middle is hidden, because hiding every unit would leave the
 * session blank.
 */
export function primaryUnitKey(
	units: readonly { key: string; memberIds: readonly string[] }[],
	primaryId: string
): string | null {
	return units.find((u) => u.memberIds.includes(primaryId))?.key ?? null
}
