/**
 * 🚧 The pending ask for a seat member's read-only sheet: one consume-once
 * hand-off from the session page (which sets it when a press on a person's
 * name lands on a member the viewer cannot open in its book) to the Sessions
 * view (which takes it once and draws `SeatMemberSheet` in its detail pane).
 *
 * The house pattern for a hand-off like this is a `panelsCtx.digest` key; this
 * store stands in until `src/app.d.ts` carries one (a ★ for the supervisor).
 * Nothing else reads it.
 */

/** Which seat of which session to read. */
export interface SeatMemberAsk {
	sessionId: number
	/** A seat ref: `character:<cardId>` | `seated-member:<id>` | `player-seat:<id>`. */
	ref: string
}

let pending = $state.raw<SeatMemberAsk | null>(null)

/** Set by the session page: the sheet to show next. */
export function askSeatMemberSheet(ask: SeatMemberAsk): void {
	pending = ask
}

/**
 * Taken once by the Sessions view (its `$effect` re-runs when an ask is
 * set): returns the pending ask and clears it, or null when none is waiting.
 */
export function takeSeatMemberSheet(): SeatMemberAsk | null {
	const ask = pending
	if (ask) pending = null
	return ask
}
