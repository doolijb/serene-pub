/**
 * Tracks, per socket, the single most recent still-in-flight request of a
 * given kind (currently: CharaVault-bound library search and card-detail
 * fetches) — so that when the SAME socket fires a new request of the same
 * kind, the previous one is cancelled: removed from rateLimiter's queue if
 * not yet granted a slot, or has its in-flight fetch aborted if already
 * past the queue. See charaVault/rateLimiter.ts's acquire() and
 * cardSources/pendingAbortableFetch.ts for how the signal is honored
 * downstream.
 *
 * Not built on utils/activityStore.ts — that's a heavier abstraction for
 * named, user-visible, admin-broadcast, dismissable background activities
 * (graph builds, summarization) that outlive a single request/response
 * cycle. A CharaVault search has none of that; it just needs a controller
 * to supersede.
 */

const REQUEST_KINDS = ["characters:searchLibrary", "cardSources:cardDetail"] as const
type RequestKind = (typeof REQUEST_KINDS)[number]

const inFlight = new Map<string, AbortController>()

function keyFor(socketId: string, kind: RequestKind): string {
	return `${kind}:${socketId}`
}

/**
 * Runs `run` with a fresh AbortController's signal, first aborting any
 * previous still-tracked request for this exact (socketId, kind) pair.
 * Cleans up its own map entry once `run` settles — but only if nothing
 * newer has already superseded it in the meantime (a superseded call's own
 * belated cleanup must never clobber the newer controller that replaced
 * it).
 */
export async function withSupersession<T>(
	socketId: string,
	kind: RequestKind,
	run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
	const key = keyFor(socketId, kind)
	inFlight.get(key)?.abort()
	const controller = new AbortController()
	inFlight.set(key, controller)
	try {
		return await run(controller.signal)
	} finally {
		if (inFlight.get(key) === controller) {
			inFlight.delete(key)
		}
	}
}

/** Aborts and stops tracking every in-flight request for a socket — call on disconnect, so a client that's gone doesn't keep holding a rate-limiter queue slot. */
export function clearInFlightRequestsForSocket(socketId: string): void {
	for (const kind of REQUEST_KINDS) {
		const key = keyFor(socketId, kind)
		inFlight.get(key)?.abort()
		inFlight.delete(key)
	}
}
