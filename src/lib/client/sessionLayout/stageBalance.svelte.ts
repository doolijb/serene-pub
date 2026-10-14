/**
 * The centred stage (ruled 2026-09-27; ./tuckedSides), measured. The live
 * layout (./SessionLayoutRender) calls it during initialisation
 * (its effect and its mount are the renderer's) and hands the balance to the
 * middle zone, and `flowEdge` to the tucked flyouts.
 */
import { onMount, untrack } from "svelte"
import { balancedGutters, stagePlanPx, type Gutters } from "./tuckedSides"
import {
	BODY_GAP_PX,
	type SessionLayoutModel
} from "./sessionLayoutModel.svelte"

export interface StageBalanceInput {
	readonly model: SessionLayoutModel
	/** `.layout-center`, the middle zone that carries the balance. */
	readonly centerEl: HTMLElement | null
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
	/** Body edge → the middle zone's edge: where a tucked flyout stops, against its rail. */
	let flowEdge = $state<Gutters>({ start: 0, end: 0 })
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
		const start = Math.max(0, Math.round(c.left - b.left))
		const end = Math.max(0, Math.round(b.right - c.right))
		// What the box just measured was drawn with: the gap already covered
		// or not yet.
		const drawn = middleOverGap
		const over = { start: start > 0, end: end > 0 }
		if (over.start !== drawn.start || over.end !== drawn.end)
			middleOverGap = over
		const next = balancedGutters({
			bodyPx: Math.round(b.width),
			startPx: start,
			endPx: end,
			stagePx: stagePlan
		})
		if (next.start !== gutters.start || next.end !== gutters.end)
			gutters = next
		// A tucked flyout stops at the middle's edge, past the gap as well —
		// never at the balance. The balance is inside the middle ("the whole
		// panel scrolls"), so stopping there floated the flyout inside the
		// conversation, a whole balance away from the rail that opened it
		// (264px with Chat's empty left column at 2540px, 2026-10-13).
		const edge = {
			start: start + (drawn.start ? BODY_GAP_PX : 0),
			end: end + (drawn.end ? BODY_GAP_PX : 0)
		}
		if (edge.start !== flowEdge.start || edge.end !== flowEdge.end)
			flowEdge = edge
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
	 * The balance the middle zone hands the conversation's column. Only a
	 * one-column middle has one column to centre: a middle arranged across
	 * has no single column, so it takes its whole width unbalanced — either
	 * way nothing between the sides is left outside a widget.
	 */
	let stageBalance = $derived<Gutters>(
		input.model.middleOneColumn ? gutters : { start: 0, end: 0 }
	)

	return {
		get flowEdge() {
			return flowEdge
		},
		get middleOverGap() {
			return middleOverGap
		},
		get stageBalance() {
			return stageBalance
		}
	}
}
