import {
	declareInterest,
	type InterestEvent
} from "$lib/client/sockets/interest.svelte"
import type {
	SocketEventMap,
	TypedSocket
} from "$lib/client/sockets/typedSocket"
import type { InterestKey } from "$lib/shared/sockets/interest"

const DEFAULT_TIMEOUT_MS = 15000

/**
 * What a timeout rejects with. Exported so a caller can tell "the server said
 * no" — which Layout's catch-all `:error` toast has already shown — from
 * "nobody answered", which nothing else will say.
 */
export const REPLY_TIMEOUT_MESSAGE = "The server did not answer in time."

/** Whether a rejection from `awaitReply` was its timeout. */
export function isReplyTimeout(err: unknown): boolean {
	return err instanceof Error && err.message === REPLY_TIMEOUT_MESSAGE
}

export interface AwaitReplyOptions<
	K extends InterestEvent,
	E extends InterestEvent
> {
	socket: Pick<TypedSocket, "emit">
	event: K
	params: SocketEventMap[K]["params"]
	/**
	 * The key the reply is heard on — `interestKey(event, scopeId)` for a
	 * scoped event, so the gate lets it through. Defaults to the bare event.
	 */
	replyKey?: InterestKey
	/** The `{event}:error` sibling, never gated, so it is always bare. */
	errorEvent: E
	/**
	 * Is this reply the answer to THIS request? Most create replies are
	 * broadcasts to every tab the user has open, so a reply for somebody
	 * else's create must not settle this promise.
	 */
	match: (data: SocketEventMap[K]["response"]) => boolean
	/**
	 * Is this refusal the answer to THIS request? For a family whose refusals
	 * echo the request's id (`lorebookState:*`): a refusal naming another
	 * request — another stat's save, another tab's — is not this one's.
	 * Omitted, every refusal of the event settles the call.
	 */
	matchError?: (data: unknown) => boolean
	timeoutMs?: number
	/** What the rejection says when the server's error carries no sentence. */
	fallbackError?: string
}

/**
 * Send one request and wait for ITS reply.
 *
 * For the saves that must not claim success — toast, dismiss an activity,
 * close a modal — before the row exists. Resolves with the matching reply;
 * rejects on the `{event}:error` sibling or on timeout. Every exit releases
 * both interests.
 *
 * ⚠ The error sibling carries no correlation id (the `register()` wrapper
 * writes only `{ error }`), so a concurrent failure of the same event from
 * elsewhere in this tab rejects this promise too. A caller holds one such
 * save at a time, so that is a false failure it can retry, never a lost row.
 * A family whose refusals do echo an id passes `matchError`.
 *
 * The error interest is declared BEFORE the emit, and the typed `emit`
 * flushes the pending interest sync ahead of the request, so neither answer
 * can overtake the key it needs.
 */
export function awaitReply<K extends InterestEvent, E extends InterestEvent>(
	opts: AwaitReplyOptions<K, E>
): Promise<SocketEventMap[K]["response"]> {
	return new Promise((resolve, reject) => {
		let settled = false
		let releaseReply = () => {}
		let releaseError = () => {}
		const finish = () => {
			settled = true
			clearTimeout(timer)
			releaseReply()
			releaseError()
		}

		releaseError = declareInterest<E>(opts.errorEvent, (data) => {
			if (settled || (opts.matchError && !opts.matchError(data))) return
			finish()
			const message = (data as { error?: unknown } | undefined)?.error
			reject(
				new Error(
					typeof message === "string" && message
						? message
						: (opts.fallbackError ??
							"The server refused the request.")
				)
			)
		})
		releaseReply = declareInterest<K>(
			opts.replyKey ?? opts.event,
			(data) => {
				if (settled || !opts.match(data)) return
				finish()
				resolve(data)
			}
		)

		const timer = setTimeout(() => {
			if (settled) return
			finish()
			reject(new Error(REPLY_TIMEOUT_MESSAGE))
		}, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)

		opts.socket.emit(opts.event, opts.params)
	})
}
