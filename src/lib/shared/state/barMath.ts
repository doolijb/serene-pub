/**
 * Drawing a stat: when a number is a bar, and what one says.
 *
 * A bar is a claim about a range, so it is drawn only when the configuration in
 * force declares both ends of one. An integer with a floor and no ceiling is a
 * number, and drawing it as a half-full bar would invent the half.
 *
 * ⚠ Only the DRAWING is clamped. A value outside its bounds is a real value —
 * a cap that dropped after the write, a script that overshot — and the label
 * keeps saying what it is, because a bar that reads `20/20` for a stored 35 is
 * the surface lying about the row underneath it.
 */

/** The half of a slot's configuration a bar reads. */
export interface BarBounds {
	min?: number
	max?: number
	[key: string]: unknown
}

export interface BarView {
	min: number
	max: number
	/** The stored value, unclamped. */
	value: number
	/** Where the fill ends, 0 to 100. */
	percent: number
	/** `14/20` — the value as written, over the ceiling in force. */
	label: string
}

const finite = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v)

/** The bar this value and configuration describe, or `null` when they do not. */
export function barView(value: unknown, config: BarBounds): BarView | null {
	const { min, max } = config
	if (!finite(value) || !finite(min) || !finite(max)) return null
	if (max <= min) return null
	const span = max - min
	const percent = Math.min(100, Math.max(0, ((value - min) / span) * 100))
	return { min, max, value, percent, label: `${value}/${max}` }
}

/** Hold a number inside whichever bounds the configuration declares. */
export function clampToBounds(value: number, config: BarBounds): number {
	let out = value
	if (finite(config.min)) out = Math.max(config.min, out)
	if (finite(config.max)) out = Math.min(config.max, out)
	return out
}

/**
 * A stored value as a person reads it.
 *
 * `null` is a layer saying "cleared, read the one below", which is a different
 * sentence from a missing answer — so it is said in words rather than drawn as
 * a blank, and absence is the blank.
 */
export function formatSlotValue(value: unknown): string {
	if (value === null) return "cleared"
	if (value === undefined) return ""
	if (typeof value === "boolean") return value ? "on" : "off"
	return String(value)
}
