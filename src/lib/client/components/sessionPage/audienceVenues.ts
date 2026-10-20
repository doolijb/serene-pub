/**
 * 🚧 What the composer offers is what the viewer may press (Dungeon Crawler
 * walk round 2, 2026-10-15): a guest saw _Rest_ listed with "'Rest' is not
 * yours to use here — its audience is owner." An action whose declared
 * audience (`act`) excludes the viewer is HIDDEN from every venue — the
 * chips, More, the `/` palette, the legend — rather than listed greyed with
 * a refusal. An item-gated action stays: whether it may be used is decided
 * per message. The server's door still refuses a press either way.
 */
export interface AudienceListed {
	canAct: boolean
	itemGated?: boolean
}

/** Whether a listed action is one the viewer may press (or decides per message). */
export const inAudience = (a: AudienceListed): boolean => a.canAct || !!a.itemGated

/** Every venue of a listing with the actions outside the viewer's audience removed. */
export function withinAudience<A extends AudienceListed>(
	venues: Record<string, { primary: A[]; overflow: A[] }> | null | undefined
): Record<string, { primary: A[]; overflow: A[] }> {
	const out: Record<string, { primary: A[]; overflow: A[] }> = {}
	for (const [kind, v] of Object.entries(venues ?? {}))
		out[kind] = {
			primary: (v?.primary ?? []).filter(inAudience),
			overflow: (v?.overflow ?? []).filter(inAudience)
		}
	return out
}
