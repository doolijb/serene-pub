import type { TypedSocket } from "$lib/client/sockets/typedSocket"

/**
 * Attach (or, with `null`, detach) a lorebook on a session.
 *
 * Exists so the two callers — SummarizeLoreModal's "create and attach" flow and
 * the Lorebooks sidebar's opt-in checkbox — share one implementation rather than
 * emitting the event by hand in two places. The handler itself lives, oddly, in
 * `src/lib/server/sockets/summarize.ts`, which is easy to lose track of; keeping
 * the client side in one function makes that indirection findable.
 */
export function attachLorebookToSession(
	socket: TypedSocket,
	sessionId: number,
	lorebookId: number | null
): void {
	socket.emit("sessions:setLorebook", { sessionId, lorebookId })
}
