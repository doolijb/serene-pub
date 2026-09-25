/**
 * The default sprite picker's arithmetic (`core:task/pick-sprite-similarity@1`,
 * DESIGN-sprites §5.2). Pure — no db, no model — so it is unit-tested here and
 * the binding is a wrapper.
 *
 * 1. Cosine similarity between the line and each sprite label.
 * 2. A small **recency penalty** on labels the speaker showed in its recent
 *    lines (RisuAI's idea), so a face does not settle on one expression — but
 *    never on the LAST label, because keeping that one is the next rule's job.
 * 3. A **stickiness margin**: the last shown sprite is kept unless the best
 *    beats it by `margin`. This is what stops a face flickering every line.
 * 4. A **floor**: a line that resembles no label at all keeps the last sprite
 *    (or `neutral`) rather than jumping to a meaningless best.
 *
 * No vectors (no embedding model loaded) → no pick. An absent mechanism
 * subtracts a signal; it never guesses.
 */

import { NEUTRAL_SPRITE_LABEL } from "./index"

export interface SpritePickInput {
	set: string | null
	labels: string[]
	last: { set: string; label: string } | null
	recent?: string[]
}

export interface SpritePickV1 {
	set: string
	label: string
	/** The chosen label's similarity, after any penalty. */
	score: number
	runnerUp?: { label: string; score: number }
	/** True when stickiness or the floor kept the last sprite. */
	held?: boolean
}

export interface SpritePickParams {
	/** How much closer a new label must be before the face changes. */
	margin?: number
	/** Below this similarity to every label, the line keeps its last face. */
	floor?: number
	/** The recency penalty's size for the most recent repeat. */
	recency?: number
}

export const DEFAULT_SPRITE_MARGIN = 0.04
export const DEFAULT_SPRITE_FLOOR = 0.1
export const DEFAULT_SPRITE_RECENCY = 0.02

export function cosine(a: readonly number[], b: readonly number[]): number {
	let dot = 0
	let na = 0
	let nb = 0
	const n = Math.min(a.length, b.length)
	for (let i = 0; i < n; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if (na === 0 || nb === 0) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const isVector = (v: unknown): v is number[] =>
	Array.isArray(v) && v.length > 0 && typeof v[0] === "number"

export function pickSpriteBySimilarity(
	choices: SpritePickInput,
	lineVector: unknown,
	labelVectors: unknown,
	params: SpritePickParams = {}
): SpritePickV1 | null {
	const set = choices.set
	const labels = choices.labels ?? []
	if (!set || labels.length === 0) return null
	if (!isVector(lineVector)) return null
	if (!Array.isArray(labelVectors) || labelVectors.length !== labels.length)
		return null
	if (!labelVectors.every(isVector)) return null

	const margin = params.margin ?? DEFAULT_SPRITE_MARGIN
	const floor = params.floor ?? DEFAULT_SPRITE_FLOOR
	const recency = params.recency ?? DEFAULT_SPRITE_RECENCY

	const lastLabel =
		choices.last && choices.last.set === set && labels.includes(choices.last.label)
			? choices.last.label
			: null
	const recent = choices.recent ?? []

	const scored = labels.map((label, i) => {
		let score = cosine(lineVector, labelVectors[i] as number[])
		const at = recent.indexOf(label)
		if (at >= 0 && label !== lastLabel) {
			// Newest repeat costs most, fading over the window.
			score -= recency * (1 - at / Math.max(recent.length, 1))
		}
		return { label, score }
	})
	scored.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
	const best = scored[0]
	const runnerUp = scored[1]
		? { label: scored[1].label, score: scored[1].score }
		: undefined

	const keepLast = (why: "floor" | "margin"): SpritePickV1 | null => {
		if (lastLabel) {
			const s = scored.find((x) => x.label === lastLabel)!
			return { set, label: lastLabel, score: s.score, runnerUp: { label: best.label, score: best.score }, held: true }
		}
		if (why === "floor" && labels.includes(NEUTRAL_SPRITE_LABEL)) {
			const s = scored.find((x) => x.label === NEUTRAL_SPRITE_LABEL)!
			return { set, label: NEUTRAL_SPRITE_LABEL, score: s.score, held: true }
		}
		return null
	}

	if (best.score < floor) return keepLast("floor")
	if (lastLabel && best.label !== lastLabel) {
		const lastScore = scored.find((x) => x.label === lastLabel)!.score
		if (best.score < lastScore + margin) return keepLast("margin")
	}
	return { set, label: best.label, score: best.score, ...(runnerUp ? { runnerUp } : {}) }
}
