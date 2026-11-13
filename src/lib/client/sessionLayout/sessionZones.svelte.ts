/**
 * The zone switch's state (PLAN D11): which zone is drawn while the sides do
 * not fit. The session header and the live render share it, so it is a module
 * singleton (as ./layoutEditor is).
 */
import { untrack } from "svelte"
import { tuckThresholdPx } from "./tuckedSides"

export type ZoneId = "left" | "middle" | "right"

export const ZONE_LABELS: Readonly<Record<ZoneId, string>> = {
	left: "Left",
	middle: "Middle",
	right: "Right"
}

/** Is the switch on? Always below lg; on a desktop when the docked sides, their gaps and the stage's measure do not fit. An unmeasured box is off. */
export function switchOn(o: {
	narrow: boolean
	bodyPx: number
	leftPx: number
	rightPx: number
	gapPx: number
}): boolean {
	return (
		o.narrow ||
		(o.bodyPx > 0 &&
			o.bodyPx <
				tuckThresholdPx({
					leftPx: o.leftPx,
					rightPx: o.rightPx,
					gapPx: o.gapPx
				}))
	)
}

class SessionZones {
	/** Published by the live render. */
	switchOn = $state(false)
	/** Zones that draw at least one panel, in Left, Middle, Right order. */
	available = $state<ZoneId[]>([])
	/** The zone drawn while the switch is on; null while off. */
	shown = $state<ZoneId | null>(null)

	/**
	 * The live render publishes each change. When the switch turns on, or
	 * `shown` is not among the available zones, `shown` becomes `opening` (else the
	 * first available). Off clears it, and the switch is off while fewer
	 * than two zones are available. Same values write nothing.
	 */
	publish(o: {
		switchOn: boolean
		available: readonly ZoneId[]
		opening: ZoneId
	}): void {
		untrack(() => {
			// A lone zone has nothing to switch to: the switch needs two.
			const on = o.switchOn && o.available.length >= 2
			if (this.switchOn !== on) this.switchOn = on
			const same =
				this.available.length === o.available.length &&
				this.available.every((z, i) => z === o.available[i])
			if (!same) this.available = [...o.available]
			let next: ZoneId | null = null
			if (on) {
				next =
					this.shown !== null && o.available.includes(this.shown)
						? this.shown
						: o.available.includes(o.opening)
							? o.opening
							: (o.available[0] ?? null)
			}
			if (this.shown !== next) this.shown = next
		})
	}

	/** A press on the switch. Ignored unless the switch is on and `z` is available. */
	show(z: ZoneId): void {
		untrack(() => {
			if (!this.switchOn || !this.available.includes(z)) return
			if (this.shown !== z) this.shown = z
		})
	}

	/** Page teardown. */
	reset(): void {
		this.switchOn = false
		this.available = []
		this.shown = null
	}
}

export { SessionZones }
export const sessionZones = new SessionZones()

/**
 * The key a roving switch handles: both arrow axes step, Home and End jump,
 * and it wraps at both ends.
 *
 * Returns the index to focus, or `null` for a key the switch does not handle
 * (which the caller must then leave alone, so Tab and Enter still work).
 */
export function rovingStep(
	key: string,
	index: number,
	count: number
): number | null {
	if (count <= 0) return null
	let next: number
	if (key === "ArrowDown" || key === "ArrowRight") next = index + 1
	else if (key === "ArrowUp" || key === "ArrowLeft") next = index - 1
	else if (key === "Home") next = 0
	else if (key === "End") next = count - 1
	else return null
	return (next + count) % count
}

/** The index that holds a switch's tab stop, kept inside a switch that shrank. */
export function rovingStop(
	remembered: number | undefined,
	count: number
): number {
	if (count <= 0) return 0
	return Math.min(Math.max(0, remembered ?? 0), count - 1)
}
