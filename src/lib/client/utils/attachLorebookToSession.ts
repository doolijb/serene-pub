import type { TypedSocket } from "$lib/client/sockets/typedSocket"

/**
 * Read a lorebook into a session (or, with `null`, stop reading one).
 *
 * The one client-side emit of `sessions:setLorebook`, so its callers share
 * one implementation rather than each emitting the event by hand:
 * SummarizeLoreModal's create-and-read flow, LorebookActions' "read the new
 * book into this session" switch on the create modal, and the lorebook
 * workspace's Read into this session / Stop reading control (book menu, Book
 * settings and the list of books). The handler itself lives, oddly, in
 * `src/lib/server/sockets/summarize.ts`, which is easy to lose track of;
 * keeping the client side in one function makes that indirection findable.
 */
export function attachLorebookToSession(
	socket: TypedSocket,
	sessionId: number,
	lorebookId: number | null
): void {
	socket.emit("sessions:setLorebook", { sessionId, lorebookId })
}
