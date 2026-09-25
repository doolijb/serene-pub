/**
 * Auto-advance (PLAN-turn-order §4.6, R16): whether the head turn fires by
 * itself once the order has been written, and how far.
 *
 * One listener, run by `emitSessionEvent` on `turn-order-changed` and
 * nowhere else. It reads two things — the session's `autoAdvance` field
 * (through the settings document, so the §4.13 cascade applies) and the
 * `cause` the recompute carried — and fires the head entry or does not.
 *
 * ```
 * off    never
 * next   the head, once, iff the cause is a person's (`user`)
 * round  the head on a person's cause, AND again on an auto run's own
 *        cause, until the order empties or reaches a person's entry
 * ```
 *
 * ## Why it keys on the cause
 *
 * Every event recomputes the order (R1) — an edit, a hide, a settings save,
 * a cast toggle. Firing on all of them would mean deleting a message
 * generates a reply, which is not what anybody means by "auto-advance". So
 * `edit`, `settings` and `system` never fire, and a run's cause fires only
 * when that run was itself fired automatically. A person's press is the one
 * thing that always may.
 *
 * ## The cap, and why it is in memory
 *
 * `round` continues by re-entering: the fired run writes a row, the row
 * emits `message-completed`, the spec recomputes, and this listener sees a
 * fresh `turn-order-changed` with an auto cause. A pool that never empties
 * — a plugin strategy that always seats somebody — would ride that loop
 * forever. `MAX_AUTO_ADVANCE_PER_SEND` counts the fires since the last
 * person's cause, per session, in memory: the same idiom `lineage.ts` uses
 * for descendants, and for the same reason — it is a fact about this
 * process's in-flight work, not about the data.
 */

import { readTurnOrder, type EventCause } from "@serene-pub/sdk"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { fireTurnEntry } from "$lib/server/sessions/fireTurn"

/** How many turns one send may fire before the round is declared runaway. */
export const MAX_AUTO_ADVANCE_PER_SEND = 12

/** Fires since the last person's cause, per session. */
const fired = new Map<number, number>()

/** For tests, and for a session being deleted. */
export function _resetAutoAdvance(sessionId?: number): void {
	if (sessionId === undefined) fired.clear()
	else fired.delete(sessionId)
}

/** How many auto-advances this session has done since the last send. */
export function autoAdvanceCount(sessionId: number): number {
	return fired.get(sessionId) ?? 0
}

export type AutoAdvanceMode = "off" | "next" | "round"

/** What the listener did, for the caller's log and for the tests. */
export interface AutoAdvanceOutcome {
	fired: boolean
	mode: AutoAdvanceMode
	/** Why not, when it did not: cause · empty · person · cap · off. */
	reason?: string
	runId?: string
}

/**
 * The listener (§4.6). Called by `emitSessionEvent` for
 * `core:event/turn-order-changed@1`, with the payload that event carried.
 *
 * Never throws: an auto-advance that cannot happen is not a reason to fail
 * the write that caused it, and the person can always press Continue.
 */
export async function onTurnOrderChanged(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		cause?: EventCause
		/** The order as written — read off the row when absent. */
		turnOrder?: unknown
		io?: SessionIo
	}
): Promise<AutoAdvanceOutcome> {
	const cause = opts.cause
	const kind = cause?.kind

	// A person's send resets the round: whatever the previous send spent is
	// spent, and this one starts with a full budget. Done before the mode is
	// read, so a session switched to `off` mid-round still resets.
	if (kind === "user") fired.delete(opts.sessionId)

	// Only two causes may ever fire (§4.6): a person's, and an auto run's.
	const mayFire =
		kind === "user" || (kind === "run" && cause?.auto === true)
	if (!mayFire) return { fired: false, mode: "off", reason: "cause" }

	let mode: AutoAdvanceMode = "next"
	try {
		const { resolveSessionSettings } = await import(
			"$lib/server/sessions/settings"
		)
		const doc = await resolveSessionSettings(db, opts.sessionId)
		const declared = doc?.fields?.autoAdvance
		if (declared === "off" || declared === "next" || declared === "round")
			mode = declared
	} catch (err) {
		// The settings document is the cascade (§4.13); if it cannot be read
		// the safe answer is core's own default, not a guess at the genre's.
		console.warn("[autoAdvance] could not read the session's settings:", err)
	}

	if (mode === "off") return { fired: false, mode, reason: "off" }
	// `next` fires once per send, and only on the send itself.
	if (mode === "next" && kind !== "user")
		return { fired: false, mode, reason: "cause" }

	const order = opts.turnOrder
		? readTurnOrder({ turnOrder: opts.turnOrder }).order
		: (
				await (async () => {
					const { headTurnEntry } = await import(
						"$lib/server/sessions/fireTurn"
					)
					const head = await headTurnEntry(db, opts.sessionId)
					return head ? [head] : []
				})()
			)
	const head = order[0]
	if (!head) return { fired: false, mode, reason: "empty" }

	const spent = fired.get(opts.sessionId) ?? 0
	if (spent >= MAX_AUTO_ADVANCE_PER_SEND) {
		console.warn(
			`[autoAdvance] session ${opts.sessionId} reached the cap of ` +
				`${MAX_AUTO_ADVANCE_PER_SEND} automatic turns since the last send — ` +
				`stopping. Press Continue to go on.`
		)
		return { fired: false, mode, reason: "cap" }
	}

	fired.set(opts.sessionId, spent + 1)
	try {
		const result = await fireTurnEntry(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			entry: head,
			// The fire's own cause: a run, started automatically. Every write
			// the run makes carries it, so the recompute that follows can tell
			// this apart from a person's press and continue the round.
			cause: { kind: "run", auto: true, userId: opts.userId },
			io: opts.io
		})
		if (!result.fired) {
			// A person's entry ends the round: it is their turn, and the
			// budget goes back so their next press starts fresh.
			if (result.reason === "person") fired.delete(opts.sessionId)
			return { fired: false, mode, reason: result.reason }
		}
		return { fired: true, mode, ...(result.runId ? { runId: result.runId } : {}) }
	} catch (err) {
		console.warn("[autoAdvance] the fire failed:", err)
		return { fired: false, mode, reason: "error" }
	}
}
