/**
 * THE ZONE'S HEIGHTS (PLAN D10) — pure. One column of panels, each Fit, Fill
 * or a divider share, each with a priority; this says how many pixels each
 * draws at. Nothing here reads the DOM: the caller measures and passes.
 */

/** = the SDK's `PanelHeightV1`. */
export type ZoneHeight = "fit" | "fill" | { share: number }

export interface ZonePanelIn {
	key: string
	height: ZoneHeight
	priority: "high" | "normal" | "low"
	/** A Fit panel's content height; null = not measured yet. */
	wantPx: number | null
	/** The least it may be given (see `floorOf`). */
	floorPx: number
}

export interface ZonePanelOut {
	key: string
	px: number
	/** It holds less than it wants, so it scrolls inside itself (or, when the floors overflow, the zone does). */
	scrolls: boolean
}

export const MESSAGES_FLOOR_PX = 160
export const FIT_FLOOR_PX = 120

const clampShare = (s: number): number =>
	Math.min(12, Math.max(1, Number.isFinite(s) ? s : 1))

/** The floor a caller hands to `allocateZone`: Messages 160, Fit min(want, 120), the rest 0. */
export function floorOf(o: {
	height: ZoneHeight
	isMessages: boolean
	wantPx: number | null
}): number {
	if (o.isMessages) return MESSAGES_FLOOR_PX
	if (o.height === "fit")
		return Math.min(o.wantPx ?? FIT_FLOOR_PX, FIT_FLOOR_PX)
	return 0
}

/** The first-frame fallback CSS track, before anything is measured. */
export function cssTrackOf(p: {
	height: ZoneHeight
	isMessages: boolean
}): string {
	if (p.height === "fill")
		return p.isMessages ? "minmax(160px, 1fr)" : "minmax(0, 1fr)"
	if (p.height === "fit") return "minmax(120px, auto)"
	return `minmax(0, calc(${clampShare(p.height.share)} / 12 * 100%))`
}

const TIERS = ["high", "normal", "low"] as const

export function allocateZone(o: {
	columnPx: number
	gapPx: number
	panels: readonly ZonePanelIn[]
}): ZonePanelOut[] | null {
	const { panels } = o
	if (o.columnPx <= 0) return null
	if (panels.some((p) => p.height === "fit" && p.wantPx === null)) return null
	const n = panels.length
	if (n === 0) return []
	const avail = Math.max(0, o.columnPx - o.gapPx * (n - 1))
	const floors = panels.map((p) => Math.max(0, p.floorPx))
	const wants = panels.map((p, i) => {
		if (p.height === "fit") return Math.max(floors[i], p.wantPx ?? 0)
		if (p.height === "fill") return 0
		return Math.max(floors[i], (clampShare(p.height.share) / 12) * avail)
	})
	const hasWant = (i: number) => panels[i].height !== "fill"
	const px = floors.slice()
	const floorSum = floors.reduce((a, b) => a + b, 0)
	let fillIdx: number[] = []
	if (floorSum <= avail) {
		let rest = avail - floorSum
		for (const tier of TIERS) {
			panels.forEach((p, i) => {
				if (p.priority !== tier || !hasWant(i)) return
				const g = Math.min(Math.max(0, wants[i] - px[i]), rest)
				px[i] += g
				rest -= g
			})
		}
		fillIdx = panels.flatMap((p, i) => (p.height === "fill" ? [i] : []))
		if (fillIdx.length > 0 && rest > 0)
			for (const i of fillIdx) px[i] += rest / fillIdx.length
	}
	const scrolls = panels.map((_, i) => hasWant(i) && px[i] < wants[i] - 1e-6)
	// Whole pixels, never past avail.
	const out = px.map((v) => Math.floor(v + 1e-9))
	const target = Math.min(
		Math.floor(avail),
		Math.round(px.reduce((a, b) => a + b, 0))
	)
	let rem = target - out.reduce((a, b) => a + b, 0)
	if (rem > 0) {
		if (fillIdx.length > 0) {
			for (let k = 0; rem > 0; k = (k + 1) % fillIdx.length, rem--)
				out[fillIdx[k]] += 1
		} else out[n - 1] += rem
	}
	return panels.map((p, i) => ({
		key: p.key,
		px: out[i],
		scrolls: scrolls[i]
	}))
}
