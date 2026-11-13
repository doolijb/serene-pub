/**
 * The centred stage (ruled 2026-09-27; ./tuckedSides), measured. The live
 * layout (./SessionLayoutRender) calls it during initialisation
 * (its effect and its mount are the renderer's) and hands the balance to the
 * middle zone.
 */
import { onMount, untrack } from "svelte"
import { balancedGutters, stagePlanPx, type Gutters } from "./tuckedSides"
import { type SessionLayoutModel } from "./sessionLayoutModel.svelte"

export interface StageBalanceInput {
	readonly model: SessionLayoutModel
	/** `.layout-center`, the middle zone that carries the balance. */
	readonly centerEl: HTMLElement | null
}

/**
 * How far the middle zone sits from each of the body's CONTENT edges, and the
 * content's width. The widget gap pads the body (PLAN 2026-11-05 ★9), and
 * that padding is not a side: measured from the border edge, a body with no
 * side in the flow read its padding as one, the middle reached over it, the
 * distance fell to 0, the reach came off — and the layout flipped every frame.
 */
export function middleEdgesPx(o: {
	body: { left: number; right: number }
	center: { left: number; right: number }
	padStart: number
	padEnd: number
}): { start: number; end: number; bodyPx: number } {
	const left = o.body.left + o.padStart
	const right = o.body.right - o.padEnd
	return {
		start: Math.max(0, Math.round(o.center.left - left)),
		end: Math.max(0, Math.round(right - o.center.right)),
		bodyPx: Math.round(right - left)
	}
}

export function createStageBalance(input: StageBalanceInput) {
	/* ── the centred stage (ruled 2026-09-27; ./tuckedSides) ────────────────
	 * The conversation's column sits in the middle of the body, not in the
	 * middle of what the sides leave: the lighter end needs a balance as wide
	 * as the difference, paid only out of room the stage's measure does not
	 * need. The MIDDLE ZONE carries it ("the whole panel scrolls"):
	 * `.layout-center` runs from side to side with no body padding, the widgets
	 * in it fill that width, and the balance reaches the column as
	 * `--sp-stage-balance-start` / `-end` (styles/conversation.css). Measured
	 * rather than summed — a side is a rail, an icon strip or an arranged
	 * column, each with its own box — as the distance from each body edge to
	 * the middle; the balance is inside the middle, so writing it cannot
	 * change what it was computed from. */
	/**
	 * A classic scrollbar's width on this platform (0 for overlay scrollbars),
	 * measured once on mount. The balance plans the stage as its measure plus
	 * one of these on each edge (`stagePlanPx`), the room the conversation's
	 * scroll region keeps so its rows centre where the composer does.
	 */
	let scrollbarPx = $state(0)
	let stagePlan = $derived(stagePlanPx(scrollbarPx))
	let gutters = $state<Gutters>({ start: 0, end: 0 })
	/**
	 * Which ends of the middle zone have a side in the flow next to them. The
	 * middle reaches over the body gap on those ends (a negative margin of the
	 * gap), so the conversation covers the gap too and no strip between a side
	 * and the column is outside a widget. Stable: covering the gap leaves the
	 * side itself between the body edge and the middle, so the measure that
	 * set it still reads > 0.
	 */
	let middleOverGap = $state({ start: false, end: false })
	function measureStage() {
		const bodyEl = input.model.bodyEl
		const centerEl = input.centerEl
		if (!bodyEl || !centerEl) return
		const b = bodyEl.getBoundingClientRect()
		const c = centerEl.getBoundingClientRect()
		if (!(b.width > 0) || !(c.width > 0)) return
		const cs = getComputedStyle(bodyEl)
		const { start, end, bodyPx } = middleEdgesPx({
			body: b,
			center: c,
			padStart: Number.parseFloat(cs.paddingLeft) || 0,
			padEnd: Number.parseFloat(cs.paddingRight) || 0
		})
		// What the box just measured was drawn with: the gap already covered
		// or not yet.
		const drawn = middleOverGap
		const over = { start: start > 0, end: end > 0 }
		if (over.start !== drawn.start || over.end !== drawn.end)
			middleOverGap = over
		const next = balancedGutters({
			bodyPx,
			startPx: start,
			endPx: end,
			stagePx: stagePlan
		})
		if (next.start !== gutters.start || next.end !== gutters.end)
			gutters = next
	}
	$effect(() => {
		const body = input.model.bodyEl
		const centre = input.centerEl
		if (!body || !centre) return
		const ro = new ResizeObserver(() => measureStage())
		ro.observe(body)
		ro.observe(centre)
		untrack(measureStage)
		return () => ro.disconnect()
	})
	onMount(() => {
		const host = input.model.bodyEl
		if (!host) return
		const probe = document.createElement("div")
		probe.style.cssText =
			"position:absolute;inset-block-start:-9999px;inline-size:100px;block-size:100px;overflow:auto;scrollbar-gutter:stable;visibility:hidden"
		// What a `scrollbar-gutter: stable` region RESERVES — the room the
		// conversation's scroll region keeps — rather than what a drawn
		// scrollbar takes: a browser run with hidden scrollbars (headless
		// Chromium) draws none yet still reserves the gutter.
		host.appendChild(probe)
		scrollbarPx = Math.max(0, probe.offsetWidth - probe.clientWidth)
		probe.remove()
	})
	/**
	 * The balance the middle zone hands the conversation's column. The middle
	 * is always one column, so it always has one column to centre.
	 */
	let stageBalance = $derived<Gutters>(gutters)

	return {
		get middleOverGap() {
			return middleOverGap
		},
		get stageBalance() {
			return stageBalance
		}
	}
}
