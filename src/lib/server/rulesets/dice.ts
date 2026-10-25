/**
 * 🚧 The ruleset handler's dice and degrees (BACKBONE §4.7).
 *
 * One `rollDice`, reading the expression module's dice grammar
 * (`parseDice`) and drawing from the randomness it is handed — inside a run
 * that is the executor's `ctx.random`, seeded by the run, so a retake with
 * the same seed rolls the same dice. Degrees cross-walk a total onto the
 * ruleset's own bands and from them onto the five-band scale every prose
 * render reads.
 */

import type { DegreeBand, DegreeCrosswalk, FiveBand } from "@serene-pub/sdk"
import { parseDice } from "$lib/server/state/expressions"

/** One throw: each die's face, the flat modifier and the total. */
export interface DiceRoll {
	expr: string
	faces: number[]
	modifier: number
	total: number
}

/** Roll `expr` (`d20`, `2d6+1`) with `random`, or throw the grammar's sentence. */
export function rollDice(expr: string, random: () => number): DiceRoll {
	const dice = parseDice(expr)
	if ("refusal" in dice) throw new Error(dice.refusal)
	const faces: number[] = []
	for (let i = 0; i < dice.count; i++) faces.push(Math.floor(random() * dice.faces) + 1)
	return {
		expr: expr.trim(),
		faces,
		modifier: dice.modifier,
		total: faces.reduce((a, b) => a + b, dice.modifier)
	}
}

/** Where a check landed: the ruleset's band, its five-band value and its word. */
export interface Degree {
	band: DegreeBand
	index: number
	five: FiveBand
}

/** The five-band scale, worst first — the rank every step moves along. */
const FIVE_RANK: Readonly<Record<FiveBand, number>> = { "crit-fail": 0, fail: 1, partial: 2, success: 3, crit: 4 }

/**
 * The bands' declared indices in rank order: by five-band value, then by
 * margin (`from`), then as declared. A ruleset may declare its bands in any
 * order — Vis Itineris's hit-or-miss lists _Natural 1_ after _Success_ — so a
 * step up or down walks this order, never the declaration's (audit B: an
 * `adjustDegree +1` on a success must never land on _Natural 1_).
 */
function rankOrder(bands: readonly DegreeBand[]): number[] {
	return bands
		.map((b, i) => ({ i, rank: FIVE_RANK[b.five] ?? 0, from: typeof b.from === "number" ? b.from : -Infinity }))
		.sort((a, b) => a.rank - b.rank || a.from - b.from || a.i - b.i)
		.map((x) => x.i)
}

/**
 * The band a check lands in.
 *
 * - With margins (`from` on the bands) and a target: the highest band whose
 *   `from` the margin (total − target) reaches; a first band with no `from`
 *   is the floor.
 * - Without margins but with a target: the ruleset's `success` band when the
 *   total meets the target, else its `fail` band.
 * - No target: no band — a check against nothing has no verdict.
 *
 * Then `naturalShift` (a natural face at or past `high` moves one band up, at
 * or below `low` one down), then `natural` (a face that sets the band
 * outright — a classic critical and its threat range), then each
 * `adjustDegree` step — every step by rank, clamped to the ruleset's bands.
 */
export function degreeOf(
	crosswalk: DegreeCrosswalk,
	check: { total: number; natural: number; against?: number; adjust?: number }
): Degree | null {
	const bands = crosswalk.bands
	if (!bands.length || check.against === undefined) return null
	const margin = check.total - check.against
	let index: number
	if (bands.some((b) => typeof b.from === "number")) {
		index = 0
		bands.forEach((b, i) => {
			if (typeof b.from === "number" ? margin >= b.from : i === 0) index = i
		})
	} else {
		const want: FiveBand = margin >= 0 ? "success" : "fail"
		index = bands.findIndex((b) => b.five === want)
		if (index < 0) index = margin >= 0 ? bands.length - 1 : 0
	}
	const order = rankOrder(bands)
	const step = (from: number, by: number) => order[Math.max(0, Math.min(order.length - 1, order.indexOf(from) + by))]!
	const shift = crosswalk.naturalShift
	if (shift?.high !== undefined && check.natural >= shift.high) index = step(index, 1)
	if (shift?.low !== undefined && check.natural <= shift.low) index = step(index, -1)
	const set = crosswalk.natural
	const named = (id: string) => bands.findIndex((b) => b.id === id)
	if (set?.high && check.natural >= set.high.from && named(set.high.band) >= 0) index = named(set.high.band)
	else if (set?.low && check.natural <= set.low.to && named(set.low.band) >= 0) index = named(set.low.band)
	if (check.adjust) index = step(index, check.adjust)
	const band = bands[index]!
	return { band, index, five: band.five }
}

/**
 * 🚧 `degree` moved `by` steps along the five-band rank (2026-10-22): an
 * `adjustDegree`, a post-roll script's `shift` — clamped to the crosswalk's
 * bands, never by declaration order (`rankOrder`).
 */
export function stepDegree(crosswalk: DegreeCrosswalk, degree: Degree, by: number): Degree {
	if (!by) return degree
	const bands = crosswalk.bands
	const order = rankOrder(bands)
	const at = order.indexOf(degree.index)
	const index = order[Math.max(0, Math.min(order.length - 1, (at < 0 ? 0 : at) + by))]!
	const band = bands[index]!
	return { band, index, five: band.five }
}

/**
 * 🚧 The degree a band id names (a dice pool's count, a bid's cost row, a
 * judged outcome — 2026-10-22), then `adjust` steps; null when the crosswalk
 * has no such band.
 */
export function degreeNamed(crosswalk: DegreeCrosswalk, id: string, adjust = 0): Degree | null {
	const index = crosswalk.bands.findIndex((b) => b.id === id)
	if (index < 0) return null
	const band = crosswalk.bands[index]!
	return stepDegree(crosswalk, { band, index, five: band.five }, adjust)
}

/**
 * 🚧 The crosswalk's band for a step of the five-band scale — its first
 * band at that step, else the nearest below it (above for `crit-fail`) — then
 * `adjust` steps. What a pool with no count map reads (none: _fail_; any:
 * _success_). Null for a crosswalk with no bands.
 */
export function degreeOfFive(crosswalk: DegreeCrosswalk, five: FiveBand, adjust = 0): Degree | null {
	const bands = crosswalk.bands
	if (!bands.length) return null
	const want = FIVE_RANK[five]
	let index = bands.findIndex((b) => b.five === five)
	if (index < 0) {
		const order = rankOrder(bands)
		const below = order.filter((i) => FIVE_RANK[bands[i]!.five] <= want)
		index = below.length ? below[below.length - 1]! : order[0]!
	}
	const band = bands[index]!
	return stepDegree(crosswalk, { band, index, five: band.five }, adjust)
}
