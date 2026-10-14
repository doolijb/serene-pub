/**
 * How a series of pictures becomes calls (DESIGN-image-generation §4.7, §4.11).
 *
 * A spec says WHAT pictures it wants — a series of `{ key, vars }` — and never
 * how many calls that costs. The host decides that here, from the pair's
 * drawing sheet, in this order:
 *
 *   1. **keyed graph** — the adapter draws the whole series in one call with
 *      its outputs keyed by node (ComfyUI). Asked through the adapter's
 *      `packKeyedGraph`; every adapter answers `null` today.
 *   2. **batch** — every item renders the same prompt: one call per
 *      `perCall` items, with `count`, outputs keyed by ORDER (the items are
 *      interchangeable, so order is correct by construction).
 *   3. **loop** — otherwise one call per item.
 *
 * Pure: no adapter, no database, so the decision is testable and the action's
 * form can show the same plan before the run (*12 pictures · 3 calls*).
 *
 * Keys come from the plan, never from the pixels. What comes back is matched
 * to keys by `assignCallMedia`, which is where surplus and shortfall are
 * decided — host rules, not spec rules.
 */

import type { DrawingSheet } from "$lib/shared/imageGen/types"

/** One series item after its prompt rows rendered. */
export interface RenderedSeriesItem {
	key: string
	/** The label the key was sanitised from, for the receipt and the meta. */
	label: string
	prompt: string
	negative?: string
	/**
	 * The item's `vars`, for a backend that renders a document per item (a
	 * keyed graph, §4.7 rule 1). Flat dialects never read them.
	 */
	vars?: Record<string, unknown>
}

export type ImagePacking = "keyed-graph" | "batch" | "loop"

/** One call the host will make, before it is made. */
export interface PlannedImageCall {
	index: number
	/** The items this call draws, in order. A batch call's items share a prompt. */
	keys: string[]
	/** Pictures asked of this call (`batch` on the request). */
	count: number
	/** Filled in after the call: what the adapter sent and could not. */
	applied?: string[]
	ignored?: string[]
	/** Filled in after the call: how many pictures came back. */
	returned?: number
}

/** The plan, as written to the receipt BEFORE the first adapter call. */
export interface ImageCallPlan {
	packing: ImagePacking
	/** Pictures the series asked for. */
	pictures: number
	calls: PlannedImageCall[]
	/** Size the request asked for, and the size fitted to the sheet. */
	size?: {
		asked: { width?: number; height?: number }
		sent: { width?: number; height?: number; aspect?: string }
	}
	/** Keys that came back short, filled in after the calls. */
	missing?: Array<{ key: string; wanted: number; got: number }>
	/** Pictures kept with no key (surplus outside any key's call). */
	unkeyed?: number
}

/**
 * The keyed-graph seam's signature — what an adapter that can draw a whole
 * series in one call implements (`ImageAdapterExports.packKeyedGraph`).
 * `null` means "not this way".
 */
export type PackKeyedGraph = (
	items: readonly RenderedSeriesItem[],
	sheet: DrawingSheet
) => PlannedImageCall[] | null

/**
 * Rule 1's extension point: the ComfyUI adapter implements `packKeyedGraph`
 * and this hands it over; every flat adapter answers `null`.
 */
export function packKeyedGraph(
	items: readonly RenderedSeriesItem[],
	sheet: DrawingSheet,
	adapter?: { packKeyedGraph?: PackKeyedGraph } | null
): PlannedImageCall[] | null {
	return adapter?.packKeyedGraph?.(items, sheet) ?? null
}

/** Pack rendered items into calls. Never returns zero calls for a non-empty series. */
export function planImageCalls(
	items: readonly RenderedSeriesItem[],
	sheet: DrawingSheet,
	adapter?: { packKeyedGraph?: PackKeyedGraph } | null
): ImageCallPlan {
	const pictures = items.length
	const keyed = pictures ? packKeyedGraph(items, sheet, adapter) : null
	if (keyed?.length) return { packing: "keyed-graph", pictures, calls: keyed }

	const perCall = Math.max(1, Math.floor(sheet.perCall || 1))
	const first = items[0]
	const identical =
		!!first &&
		items.every(
			(i) =>
				i.prompt === first.prompt &&
				(i.negative ?? "") === (first.negative ?? "")
		)

	if (identical && perCall > 1 && pictures > 1) {
		const calls: PlannedImageCall[] = []
		for (let at = 0; at < pictures; at += perCall) {
			const chunk = items.slice(at, at + perCall)
			calls.push({
				index: calls.length,
				keys: chunk.map((i) => i.key),
				count: chunk.length
			})
		}
		return { packing: "batch", pictures, calls }
	}

	return {
		packing: "loop",
		pictures,
		calls: items.map((i, index) => ({ index, keys: [i.key], count: 1 }))
	}
}

/**
 * Which key each returned picture belongs to, for one call.
 *
 *  - a **loop** call (one key): everything back is that key — surplus is
 *    variants of it;
 *  - a **batch** call (several keys): keyed by order; surplus past the last
 *    key has no key context and comes back `null` (kept unkeyed on the run).
 *
 * Shortfall is not decided here; `missingKeys` counts it over the whole plan.
 */
export function assignCallMedia(
	call: Pick<PlannedImageCall, "keys">,
	returned: number
): Array<string | null> {
	if (call.keys.length === 1)
		return Array.from({ length: returned }, () => call.keys[0]!)
	return Array.from({ length: returned }, (_, i) => call.keys[i] ?? null)
}

/** The keys that came back with fewer pictures than asked. */
export function missingKeys(
	items: readonly Pick<RenderedSeriesItem, "key">[],
	got: ReadonlyMap<string, number>
): Array<{ key: string; wanted: number; got: number }> {
	const wanted = new Map<string, number>()
	for (const i of items) wanted.set(i.key, (wanted.get(i.key) ?? 0) + 1)
	const out: Array<{ key: string; wanted: number; got: number }> = []
	for (const [key, n] of wanted) {
		const g = got.get(key) ?? 0
		if (g < n) out.push({ key, wanted: n, got: g })
	}
	return out
}

/**
 * Keys made safe before anything renders (§4.11): trimmed, case-folded,
 * spaces to `-`, anything not filename-safe dropped, collisions suffixed
 * (`joy`, `joy-2`). An empty result becomes the item's position. Returns the
 * keys in input order; the caller keeps the raw labels beside them.
 */
export function sanitiseSeriesKeys(raw: readonly string[]): string[] {
	const seen = new Set<string>()
	return raw.map((label, i) => {
		const base =
			String(label ?? "")
				.trim()
				.toLowerCase()
				.replace(/\s+/g, "-")
				.replace(/[^a-z0-9._-]/g, "")
				.replace(/^[-.]+|[-.]+$/g, "") || String(i + 1)
		let key = base
		for (let n = 2; seen.has(key); n++) key = `${base}-${n}`
		seen.add(key)
		return key
	})
}
