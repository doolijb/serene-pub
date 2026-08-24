export interface PendingAbortableEntry<T> {
	promise: Promise<T>
	controller: AbortController
	waiterCount: number
}

/**
 * Returns the existing pending entry for `key`, or starts one via
 * `start(signal)`. Either way, returns THIS caller's own independently
 * cancelable promise: aborting `signal` rejects only this caller's promise
 * and decrements the shared entry's waiterCount; the underlying `start()`
 * call's own controller is only actually aborted once every attached
 * caller has done this (waiterCount reaches 0 via an *abort*, never via
 * normal settlement — see attachWaiter) — one caller giving up must never
 * cancel work other callers currently attached to the same key still want.
 */
export function getOrStartAbortable<T>(
	pending: Map<string, PendingAbortableEntry<T>>,
	key: string,
	start: (signal: AbortSignal) => Promise<T>,
	signal?: AbortSignal
): Promise<T> {
	const existing = pending.get(key)
	if (existing) return attachWaiter(existing, signal)

	// Fresh key: don't start real work at all if the caller has already
	// given up — nothing else depends on it yet. (This makes the
	// `signal?.aborted` check inside attachWaiter below unreachable for
	// this call site specifically — signal is guaranteed not aborted by
	// the time we get there. It's only ever exercised via the `existing`
	// branch above, where a late-arriving already-aborted caller correctly
	// must not touch waiterCount at all.)
	if (signal?.aborted) return Promise.reject(signal.reason)

	const controller = new AbortController()
	const promise = start(controller.signal).finally(() => pending.delete(key))
	const entry: PendingAbortableEntry<T> = {
		promise,
		controller,
		waiterCount: 0
	}
	pending.set(key, entry)
	return attachWaiter(entry, signal)
}

function attachWaiter<T>(
	entry: PendingAbortableEntry<T>,
	signal?: AbortSignal
): Promise<T> {
	if (signal?.aborted) return Promise.reject(signal.reason)

	entry.waiterCount++
	let detached = false
	// Split deliberately: waiterCount hitting 0 must only ever trigger
	// controller.abort() when it got there via an *abort*, not via normal
	// settlement. Every waiter's .then()/.catch() also decrements when the
	// shared promise resolves/rejects normally — if that path could also
	// trigger abort(), the last waiter to "finish" on a *successful* shared
	// fetch would call abort() on already-completed work. Harmless in that
	// moment, but it breaks the invariant a later caller can rely on
	// (waiterCount === 0 meaning "abandoned") for the narrow window between
	// that resolution and the entry's own `.finally(() => pending.delete(key))`
	// actually running — a new caller arriving in that window would attach
	// to an entry whose controller was already (spuriously) aborted.
	const detachOnAbort = () => {
		if (detached) return
		detached = true
		if (--entry.waiterCount <= 0) entry.controller.abort()
	}
	const detachQuietly = () => {
		if (detached) return
		detached = true
		entry.waiterCount--
	}

	if (!signal) return entry.promise.finally(detachQuietly)

	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			detachOnAbort()
			reject(signal.reason)
		}
		signal.addEventListener("abort", onAbort, { once: true })
		entry.promise.then(
			(value) => {
				signal.removeEventListener("abort", onAbort)
				detachQuietly()
				resolve(value)
			},
			(err) => {
				signal.removeEventListener("abort", onAbort)
				detachQuietly()
				reject(err)
			}
		)
	})
}
