// Per-(key, id) in-process queue serializing calls on the same subject.
// Without this, two near-simultaneous operations on the same session (two
// guests each sending a persona message back to back, a double-clicked manual
// "Trigger Character", or a background draft-save racing a user's Save click)
// can both read a check as still-valid before either has committed its own
// write, letting both proceed. This is a queue, not a reject-fast mutex —
// callers must re-check freshness *inside* fn (after the lock is held) if
// they need to actually reject a duplicate rather than just serialize it.
// Subjects are independent of each other, so only same-(key, id) calls
// serialize; different ids — and different keys on one id — still run fully
// in parallel.
//
// The keys (PLAN-turn-order §4.2, A4): `trigger` is the reply trigger's
// (`withSessionTriggerLock`, the original single-purpose lock, generalised
// in place); `turnOrder` serialises the turn-order recompute per session
// (§3: one turn-order run per session at a time). A new key is a new
// serialisation domain — name it once, here in the comment, and nowhere else.
//
// Non-reentrant: acquiring this again for the same (key, id) from *within* an
// already-held acquire for that pair will deadlock (the inner call waits
// for the outer to finish, but the outer is waiting on the inner) — the
// same failure shape llmQueue.ts's AsyncLocalStorage-based fix exists to
// avoid for its own single-lane queue. Verify call graphs don't nest before
// wrapping a new code path in this.
const keyedLocks = new Map<string, Promise<unknown>>()

export async function withKeyedLock<T>(
	key: string,
	id: number,
	fn: () => Promise<T>
): Promise<T> {
	const slot = `${key}:${id}`
	const prior = keyedLocks.get(slot) ?? Promise.resolve()
	const run = prior.catch(() => {}).then(fn)
	const tracked = run.catch(() => {})
	keyedLocks.set(slot, tracked)
	try {
		return await run
	} finally {
		if (keyedLocks.get(slot) === tracked) {
			keyedLocks.delete(slot)
		}
	}
}

/** The reply trigger's lock: `withKeyedLock('trigger', sessionId, fn)`. */
export function withSessionTriggerLock<T>(
	sessionId: number,
	fn: () => Promise<T>
): Promise<T> {
	return withKeyedLock("trigger", sessionId, fn)
}
