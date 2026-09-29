/**
 * TUCKED SIDES and the CENTRED STAGE (ruled 2026-09-27) — pure, and the whole
 * decision behind both.
 *
 * PLAN 25's model is three zones — Left, Middle, Right — and the middle is the
 * stage. Two rules about how the three share the session's width:
 *
 *   (1) The stage is centred in the width the session has. The side zones
 *       rarely match — the default puts everything on the right — so the
 *       lighter end needs a BALANCE as wide as the difference. The MIDDLE
 *       ZONE takes it (revised 2026-09-27, "the whole panel scrolls"): the
 *       middle widens by the balance, the widgets in it fill that width, and
 *       only the conversation's column is placed off the middle's own centre
 *       (`columnInsetPx`) so it sits on the body's. It is not padding on the
 *       body, which would leave a band outside every widget where the wheel
 *       does nothing. The balance adds no box of its own, and the model is
 *       still exactly three zones. An EMPTY side is not a missing one (ruled
 *       2026-09-29, "the columns shouldn't disappear if the pane is empty"):
 *       while there is room it keeps an empty column at its docked width
 *       (./sideSlot `emptyColumnsPx`) — the side's own box, aria-hidden and
 *       with no tab stop — so two columns of one ladder width centre the
 *       stage by themselves and the balance is 0. Only a side that has no
 *       column (none declared, hidden, on its drawer rung, or an empty column
 *       that gave way) leaves the middle a difference to balance. A balance
 *       is only ever paid out
 *       of SPARE room — room the stage's measure does not need — so centring
 *       never narrows the prose.
 *
 *   (2) When the session's box cannot hold the docked sides AND the stage at
 *       its measure, the sides TUCK: each side draws only its slim icon rail,
 *       every panel in it is put away, and the stage takes the width. A tucked
 *       panel is reached from its rail icon and shows as a FLYOUT over the
 *       session — one at a time, across both sides.
 *
 * Both are decided from the session's own measured box, never the viewport:
 * an open sidebar narrows the box without changing the window, and that is the
 * case (2) exists for. Below the app's 1024px breakpoint the sides are already
 * stowed (./sideSlot) and none of this applies.
 *
 * The threshold is not a magic number. It is the sum of the minimums the
 * layout already knows: each docked side's ladder footprint (what it would take
 * in the flow — `sideFlowPx` in ./sideSlot), a body gap per docked side, and
 * the stage's MEASURE — the conversation column's `--sp-measure` (40rem) plus
 * the avatar gutter (3.5rem), STYLE-GUIDE 3.4. Under that sum the sides would
 * squeeze the prose itself, which is what tucking them prevents.
 *
 * An empty side's column is NOT in that sum: it is not a footprint
 * (`sideFlowPx` is 0 for it) but a soft ask, granted only from room beyond it
 * (./sideSlot `emptyColumnsPx`). So it gives way before any populated side
 * tucks, and a session never tucks its panels just to keep a blank column.
 *
 * "Tucked" is not the mobile **stowed** slot (no rail at all, a sheet from the
 * header's panels menu) and not a widget tier (`compact` is the tier and the
 * layout v2 breakpoint's word — R1).
 */

/**
 * The stage's measure: the conversation column's `max-inline-size` under the
 * messages widget's Line width: Comfortable,
 * `calc(var(--sp-measure, 40rem) + 3.5rem)` in `styles/widgets.css` §conversation, at
 * the 16px root. A widget style may move `--sp-measure`; the default is what
 * the layout plans around.
 *
 * At Line width: Full (the default, ruled 2026-09-29) the rows and the
 * composer take the widget's whole box and no measure caps them; the layout
 * still plans around this width as the stage's MINIMUM — the room under which
 * the sides tuck — and the balance still centres a Comfortable column. The
 * balance moves nothing at Full: a column as wide as its box has no inset.
 */
export const STAGE_MEASURE_PX = (40 + 3.5) * 16

/**
 * What the balance plans the stage around: the measure plus
 * a classic scrollbar's width on EACH edge. The conversation's scroll region
 * keeps a scrollbar's width on both edges (`scrollbar-gutter: stable
 * both-edges`, styles/widgets.css §conversation) so its rows centre where the composer
 * does; a plan of the bare measure left no room for that and the rows were
 * pushed a scrollbar's width off centre. Overlay scrollbars measure 0, and
 * the plan is the measure. The tuck threshold is not planned this way — it
 * is about the prose's room, not its centring.
 */
export function stagePlanPx(scrollbarPx: number): number {
	return STAGE_MEASURE_PX + 2 * Math.max(0, scrollbarPx)
}

export interface TuckThresholdInput {
	/** Left side's footprint in the flow when docked (0 = nothing docked). */
	leftPx: number
	/** Right side's footprint, likewise. */
	rightPx: number
	/** `.layout-body`'s gap — one per docked side. */
	gapPx: number
	/** The stage's measure; defaults to `STAGE_MEASURE_PX`. */
	stagePx?: number
}

/** The narrowest box that holds the docked sides and the stage at its measure. */
export function tuckThresholdPx(o: TuckThresholdInput): number {
	const left = Math.max(0, o.leftPx)
	const right = Math.max(0, o.rightPx)
	if (left + right <= 0) return 0
	const gaps = (left > 0 ? o.gapPx : 0) + (right > 0 ? o.gapPx : 0)
	return left + right + gaps + (o.stagePx ?? STAGE_MEASURE_PX)
}

export interface SidesTuckedInput extends TuckThresholdInput {
	/** Measured width of the row the sides and the stage share. 0 = unmeasured. */
	bodyPx: number
}

/**
 * Rule (2): do the sides tuck to their rails?
 *
 * Decided on the sides' DOCKED footprints, never on what they occupy once
 * tucked — so tucking cannot free the room that would untuck them and flicker.
 * An unmeasured box (0) is left docked, like every other first-frame decision
 * in this layout (`railFit`, `collapseColumn`).
 */
export function sidesTucked(o: SidesTuckedInput): boolean {
	if (!(o.bodyPx > 0)) return false
	const need = tuckThresholdPx(o)
	return need > 0 && o.bodyPx < need
}

export interface BalancedGuttersInput {
	/** Width of the body row, px. */
	bodyPx: number
	/** What the flow holds before the stage on the START side (side + its gap). */
	startPx: number
	/** And on the END side. */
	endPx: number
	/** The stage's measure; defaults to `STAGE_MEASURE_PX`. */
	stagePx?: number
}

export interface Gutters {
	start: number
	end: number
}

/**
 * Rule (1): the balance each end of the middle zone carries so the column
 * sits in the middle of the BODY. The lighter end gets the difference — as
 * much of it as the spare room beyond the stage's measure allows, so a window
 * too tight to centre fully centres as far as it can without narrowing the
 * prose. It is width the middle zone owns, never padding outside it.
 */
export function balancedGutters(o: BalancedGuttersInput): Gutters {
	const start = Math.max(0, o.startPx)
	const end = Math.max(0, o.endPx)
	const diff = Math.abs(end - start)
	if (diff === 0) return { start: 0, end: 0 }
	const spare = Math.max(
		0,
		o.bodyPx - start - end - (o.stagePx ?? STAGE_MEASURE_PX)
	)
	const g = Math.floor(Math.min(diff, spare))
	return end > start ? { start: g, end: 0 } : { start: 0, end: g }
}

export interface MiddleZone {
	/** The balance the middle carries at each end (`balancedGutters`). */
	balance: Gutters
	/** Body edge → the middle's start edge: the start side and its gap. */
	startPx: number
	/** The middle's width: everything between the sides, balance included. */
	middlePx: number
}

/**
 * The middle zone under rule (1): it runs from the start side to the end side
 * with nothing between — no body padding — and carries the balance inside
 * itself, so a widget filling it covers the whole width, gutter included.
 */
export function middleZone(o: BalancedGuttersInput): MiddleZone {
	const start = Math.max(0, o.startPx)
	const end = Math.max(0, o.endPx)
	return {
		balance: balancedGutters(o),
		startPx: start,
		middlePx: Math.max(0, o.bodyPx - start - end)
	}
}

export interface ColumnInsetInput {
	/** The middle zone's (the conversation box's) width. */
	middlePx: number
	/** The column's drawn width: its measure, or the box when narrower. */
	columnPx: number
	/** The middle's balance. */
	balance: Gutters
}

/**
 * Where the column starts inside the middle zone: centred in it, moved by
 * half the balance difference, and never past either edge. The CSS mirror is
 * the stage's (`messages.stage`) `margin-inline-start` in `styles/widgets.css` §conversation, fed by
 * `--sp-stage-balance-start` / `-end`.
 */
export function columnInsetPx(o: ColumnInsetInput): number {
	const free = Math.max(0, o.middlePx - o.columnPx)
	const want = free / 2 + (o.balance.start - o.balance.end) / 2
	return Math.min(free, Math.max(0, want))
}

/** The one tucked panel out over the session: which side, which rail icon. */
export interface TuckedFlyout {
	side: "left" | "right"
	/** The rail icon's key: a render unit's key, or a zone widget's id. */
	key: string
}

/**
 * A rail icon pressed while the sides are tucked. The panel it names comes
 * out; if it was already out it goes back; any OTHER panel — on either side —
 * goes back as this one comes out. Esc and an outside click are `null`.
 */
export function toggleTuckedFlyout(
	current: TuckedFlyout | null,
	next: TuckedFlyout
): TuckedFlyout | null {
	if (current && current.side === next.side && current.key === next.key)
		return null
	return { side: next.side, key: next.key }
}
