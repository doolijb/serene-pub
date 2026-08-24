// Per-session in-process queue serializing calls for the same session. Without
// this, two near-simultaneous operations on the same session (two guests each
// sending a persona message back to back, a double-clicked manual "Trigger
// Character", or a background draft-save racing a user's Save click) can
// both read a check as still-valid before either has committed its own
// write, letting both proceed. This is a queue, not a reject-fast mutex —
// callers must re-check freshness *inside* fn (after the lock is held) if
// they need to actually reject a duplicate rather than just serialize it.
// Sessions are independent of each other, so only same-session calls serialize;
// different sessions still run fully in parallel.
//
// Non-reentrant: acquiring this again for the same sessionId from *within* an
// already-held acquire for that sessionId will deadlock (the inner call waits
// for the outer to finish, but the outer is waiting on the inner) — the
// same failure shape llmQueue.ts's AsyncLocalStorage-based fix exists to
// avoid for its own single-lane queue. Verify call graphs don't nest before
// wrapping a new code path in this.
const sessionTriggerLocks = new Map<number, Promise<unknown>>()

export async function withSessionTriggerLock<T>(
	sessionId: number,
	fn: () => Promise<T>
): Promise<T> {
	const prior = sessionTriggerLocks.get(sessionId) ?? Promise.resolve()
	const run = prior.catch(() => {}).then(fn)
	const tracked = run.catch(() => {})
	sessionTriggerLocks.set(sessionId, tracked)
	try {
		return await run
	} finally {
		if (sessionTriggerLocks.get(sessionId) === tracked) {
			sessionTriggerLocks.delete(sessionId)
		}
	}
}
