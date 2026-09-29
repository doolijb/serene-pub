import type { Handler } from "$lib/shared/events"

/**
 * Answer a refusal with the sentence that says which one it was.
 *
 * `register()`'s own catch emits *"An error occurred while processing your
 * request"* — true and useless. A refusal a person can act on ("That character
 * is already in this lorebook.", "Parent node not found.") has to reach them
 * as that sentence: emit `<event>:error` with the real message, then re-throw
 * so `register()` still logs it and skips its generic fallback (it notices the
 * specific `:error` went out). Layout's catch-all then toasts the server's own
 * words, so no client change is needed.
 *
 * `translate` maps an error the handler did not word itself (a database
 * constraint, say) onto a sentence; return `undefined` to keep the error's own
 * message.
 */
export function refusable<P, R>(
	event: string,
	body: (
		socket: any,
		params: P,
		emitToUser: (event: string, data: any) => void
	) => Promise<R>,
	fallback: string,
	translate?: (e: any) => string | undefined
): Handler<P, R> {
	return {
		event,
		handler: async (socket, params, emitToUser) => {
			try {
				return await body(socket, params, emitToUser)
			} catch (e: any) {
				emitToUser(`${event}:error`, {
					error: translate?.(e) || e?.message || fallback
				})
				throw e
			}
		}
	}
}

/** Postgres' unique-violation code, however the driver nests it. */
export function isUniqueViolation(e: any): boolean {
	return e?.code === "23505" || e?.cause?.code === "23505"
}
