/**
 * Where the session's LOG is, and which zone a phone or full screen opens on
 * (PLAN 2026-11-05 ★3). The old "stage" (the one conversation drawn full
 * width, QE) is gone with the rail: a phone or full screen shows a whole
 * ZONE, and this module only says which.
 */
import { primaryLogOf } from "./channelClaims"

export type StageZone = "left" | "middle" | "right"

/** Where the log is: the widget instance, and its zone. */
export interface StagePick {
	id: string
	zone: StageZone
}

export interface StageInput {
	/** Each zone's placed ids, in reading order (top to bottom). */
	middle: readonly string[]
	left: readonly string[]
	right: readonly string[]
	/** Placed conversation copy → the channel it claims (./channelClaims). */
	claims: ReadonlyMap<string, string>
	/** The genre's primary widget: `messages`, or an R71 genre's own. */
	primaryId: string
}

/**
 * The layout's primary log and the zone holding it, wherever it sits
 * (`primaryLogOf`: the first unclaimed instance of the primary in reading
 * order, else the first instance), or null when none is placed.
 */
export function primaryLogPick(o: StageInput): StagePick | null {
	const id = primaryLogOf([...o.middle, ...o.left, ...o.right], o.claims, o.primaryId)
	if (!id) return null
	const zone: StageZone = o.middle.includes(id)
		? "middle"
		: o.left.includes(id)
			? "left"
			: "right"
	return { id, zone }
}

/**
 * The zone a phone or full screen opens on (★3): the zone of the layout's
 * primary log, else the first zone — middle, left, right — holding a
 * Messages copy, else the middle.
 */
export function openingZone(
	o: StageInput & { isMessages(id: string): boolean }
): StageZone {
	const log = primaryLogPick(o)
	if (log) return log.zone
	for (const zone of ["middle", "left", "right"] as const)
		if (o[zone].some(o.isMessages)) return zone
	return "middle"
}

/**
 * Full screen — a session control (`panelsCtx.fullscreen`, Ctrl/⌘ + Shift + F,
 * `useSessionFullscreen`), at every width. It shows the WHOLE opening zone
 * and no zone switch; the other zones stay mounted, `display: none` (the
 * mount-on-first-show rule, ../components/host/firstShow.ts), so an iframe
 * under them keeps running and a native widget keeps its state. Turning it
 * off restores exactly what was there: nothing here writes the layout.
 */
export function fullscreenActive(
	ctx: { fullscreen?: boolean } | undefined
): boolean {
	return !!ctx?.fullscreen
}
