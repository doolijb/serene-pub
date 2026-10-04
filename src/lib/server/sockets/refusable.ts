import type { Handler } from "$lib/shared/events"
import { isFailedQuery } from "$lib/server/db/errors"

/**
 * Answer a refusal with the sentence that says which one it was.
 *
 * `register()`'s own catch emits *"An error occurred while processing your
 * request"* — true and useless. A refusal a person can act on ("That character
 * is already in this lorebook.", "Nothing can be linked to itself.") has to reach them
 * as that sentence: emit `<event>:error` with the real message, then re-throw
 * so `register()` still logs it and skips its generic fallback (it notices the
 * specific `:error` went out). `register()` sends it to the socket that asked
 * and no other tab, where Layout's catch-all toasts the server's own words —
 * or the component that asked shows them in place and lists the event in
 * Layout's `HANDLED_ERROR_EVENTS`.
 *
 * `translate` maps an error the handler did not word itself (a database
 * constraint, say) onto a sentence; return `undefined` to keep the error's own
 * message. Two kinds of message are never kept, and answer with `fallback`:
 * a failed query's (it is SQL and the values the query wrote), and a bug's
 * (`TypeError`, `ReferenceError`, `RangeError` — "Cannot read properties of
 * undefined" is nothing a person can act on). The whole error still reaches
 * the server log through the re-throw.
 *
 * A failure AFTER the handler's own reply went out is not a refusal: the
 * request landed and the person was told so, and what failed is what followed
 * (a relist, a push to the other tabs). It is logged and the reply stands;
 * a refusal then would say "could not be saved" about a save that was.
 *
 * `echo` adds fields of the request to the refusal — the book it was about,
 * the writer's `requestId` — so the one component waiting on it can claim it
 * when several in the tab wait on the same event. It is handed the params as
 * they came off the wire, unchecked.
 */
export function refusable<P, R>(
	event: string,
	body: (
		socket: any,
		params: P,
		emitToUser: (event: string, data: any) => void
	) => Promise<R>,
	fallback: string,
	translate?: (e: any) => string | undefined,
	echo?: (params: unknown) => Record<string, unknown>
): Handler<P, R> {
	return {
		event,
		handler: async (socket, params, emitToUser) => {
			let replied: { data: unknown } | null = null
			const tracked = (e: string, data: any) => {
				if (e === event)
					replied = { data: typeof data === "function" ? undefined : data }
				return emitToUser(e, data)
			}
			try {
				return await body(socket, params, tracked)
			} catch (e: any) {
				if (replied) {
					console.error(`${event}: failed after its reply went out:`, e)
					return (replied as { data: unknown }).data as R
				}
				emitToUser(`${event}:error`, {
					...echo?.(params),
					error: translate?.(e) || ownWords(e) || fallback
				})
				throw e
			}
		}
	}
}

/**
 * The asker's `requestId`, when it sent a usable one — for a reply that goes
 * to every tab of the user (and to several surfaces in one tab) and for its
 * refusal (`refusable`'s `echo`): the id is how the one surface that asked
 * claims the answer.
 */
export function askerOf(raw: unknown): { requestId?: string } {
	const requestId = (raw as { requestId?: unknown } | undefined)?.requestId
	return typeof requestId === "string" && requestId.length <= 128
		? { requestId }
		: {}
}

/** The error's message when a handler wrote it for a person; else undefined. */
function ownWords(e: any): string | undefined {
	if (isFailedQuery(e) || isBug(e)) return undefined
	return typeof e?.message === "string" && e.message ? e.message : undefined
}

/** The errors the runtime throws for a mistake in the code, never a refusal. */
const isBug = (e: unknown) =>
	e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError
