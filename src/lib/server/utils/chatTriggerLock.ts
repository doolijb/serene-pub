// Per-chat in-process queue serializing calls for the same chat. Without
// this, two near-simultaneous operations on the same chat (two guests each
// sending a persona message back to back, a double-clicked manual "Trigger
// Character", or a background draft-save racing a user's Save click) can
// both read a check as still-valid before either has committed its own
// write, letting both proceed. This is a queue, not a reject-fast mutex —
// callers must re-check freshness *inside* fn (after the lock is held) if
// they need to actually reject a duplicate rather than just serialize it.
// Chats are independent of each other, so only same-chat calls serialize;
// different chats still run fully in parallel.
//
// Non-reentrant: acquiring this again for the same chatId from *within* an
// already-held acquire for that chatId will deadlock (the inner call waits
// for the outer to finish, but the outer is waiting on the inner) — the
// same failure shape llmQueue.ts's AsyncLocalStorage-based fix exists to
// avoid for its own single-lane queue. Verify call graphs don't nest before
// wrapping a new code path in this.
const chatTriggerLocks = new Map<number, Promise<unknown>>()

export async function withChatTriggerLock<T>(
	chatId: number,
	fn: () => Promise<T>
): Promise<T> {
	const prior = chatTriggerLocks.get(chatId) ?? Promise.resolve()
	const run = prior.catch(() => {}).then(fn)
	const tracked = run.catch(() => {})
	chatTriggerLocks.set(chatId, tracked)
	try {
		return await run
	} finally {
		if (chatTriggerLocks.get(chatId) === tracked) {
			chatTriggerLocks.delete(chatId)
		}
	}
}
