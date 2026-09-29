/**
 * The composer's turn controls — Continue, "Pick who speaks" and the
 * narrator's turn — as the
 * page presses them: one `sessions:fireTurn` (PLAN-turn-order §4.7), whose
 * refusal answers on `sessions:fireTurn:error` with a sentence to show.
 */

import { DEFAULT_CHANNEL } from "@serene-pub/sdk"

/** Just the emit the controls need, so a test can record it. */
export interface FireTurnSocket {
	emit(event: "sessions:fireTurn", params: Sockets.Sessions.FireTurn.Params): void
}

/**
 * Press a turn: Continue (`advance`) — the first entry prepared on
 * `channel`, the channel of the composer it was pressed in (lair re-plan
 * R5; `main`, the default, is not said); with `characterId` the named
 * character, recorded as a pick (Pick who speaks, §4.6); with `narrator`
 * the genre's own voice (the `narrate` turn control, B8) — the null ref,
 * with the composer's `channel` so the server knows where Narrate was
 * pressed (R8). The server judges each against the genre's turn controls.
 */
export function fireTurn(
	socket: FireTurnSocket,
	sessionId: number,
	pick?: { characterId: number } | { narrator: true },
	channel?: string
): void {
	const onChannel = channel && channel !== DEFAULT_CHANNEL ? { channel } : {}
	socket.emit(
		"sessions:fireTurn",
		pick
			? {
					sessionId,
					entry: {
						ref:
							"characterId" in pick
								? `character:${pick.characterId}`
								: null,
						via: "pick"
					},
					// Narrate says where it was pressed (lair pass R8): the
					// narration lands on `main` either way, and the run can
					// tell a Sanctum press from a story one.
					...("narrator" in pick ? onChannel : {})
				}
			: { sessionId, ...onChannel }
	)
}

/**
 * The sentence to show for a fire that was refused on this page's session,
 * or `null` — another session's reply, or a person's own turn (`reason:
 * 'person'`, which carries no `error`).
 */
export function fireTurnRefusal(
	msg: Sockets.Sessions.FireTurn.Response,
	sessionId: number
): string | null {
	if (msg.sessionId !== sessionId) return null
	return msg.error ?? null
}

/**
 * Whether a `sessions:turnOrder` push says no reply is coming from the
 * change it answers (lair pass B9): the server's own auto-advance decision,
 * `autoAdvancing: false`. The page stops waiting on its send and shows the
 * next-speaker block at once, rather than after a backstop. The view's push
 * carries no decision and says nothing; the client never works it out.
 */
export function pushSaysNoReply(
	msg: Sockets.Sessions.TurnOrder.Push,
	sessionId: number
): boolean {
	return msg.sessionId === sessionId && msg.autoAdvancing === false
}
