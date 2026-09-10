/**
 * One concurrency ceiling for every fs call this subsystem makes.
 *
 * Extracted from diskCache.ts when the card-bytes cache split in two (the
 * browse cache in `os.tmpdir()`, the import cache under the user's data
 * directory — ruling 2026-09-09). The ceiling is a property of the SUBSYSTEM,
 * not of either cache: two modules each holding their own limiter of 2 is a
 * limiter of 4, which is exactly the number the comment below argues against.
 * A single shared instance is what keeps the guarantee the same after the split
 * as before it.
 *
 * ---
 *
 * The cache's fs work fans out: a sweep stats (and conditionally unlinks) every
 * file in a cache directory at once via Promise.all, and the image-proxy route's
 * per-thumbnail reads/writes are explicitly not deduped — a single grid of
 * results can fire DEFAULT_LIMIT (24) concurrent thumbnail cache operations from
 * one ordinary page load. Both are uncapped sources of concurrent fs calls,
 * which matters more here than it might elsewhere: this app's PGlite database is
 * file-backed, and its Node storage backend (Emscripten's NODEFS) uses Node's
 * *synchronous* fs calls — readSync/writeSync/etc. — meaning every DB read or
 * write blocks the event loop directly for however long the OS takes to service
 * it. A large burst of concurrent async fs work from this subsystem (which also
 * queues against itself on libuv's thread pool — 4 threads by default,
 * unconfigured) creates real OS-level disk contention that a synchronous PGlite
 * call can get stuck behind, blocking every other request the process is
 * handling, not just CharaVault's own. Bounding this subsystem's own concurrency
 * to a small, fixed ceiling reduces that contention regardless of how much of
 * the effect is thread-pool queueing versus direct disk contention.
 *
 * Deliberately below the pool's own default size (4), not equal to it — at 4
 * this subsystem could still occupy the entire pool by itself, leaving nothing
 * for any other async fs/dns/crypto call elsewhere in the app; capping at 2
 * leaves at least half the pool free regardless of how busy this subsystem gets.
 *
 * Side effect worth knowing about, not a bug: sweeping a cache directory with
 * thousands of entries takes noticeably longer wall-clock time (a slow trickle
 * instead of one big burst) — that's the intended trade (smooth beats spiky for
 * exactly the contention reason this limiter exists), not a regression to "fix"
 * by widening or removing the limit.
 *
 * Invariant: never call fsLimit(...) from inside a function that's already
 * running under fsLimit — the cache modules' orchestrating functions
 * (getOrFetchCardBytes, getOrFetchImportedCardBytes) deliberately stay unwrapped
 * themselves, only calling the already-wrapped leaf functions, precisely to
 * avoid this. Nesting would let one caller hold an outer slot while waiting on
 * an inner one; at FS_CONCURRENCY_LIMIT = 2, two such nested callers can hold
 * both outer slots and deadlock each other permanently, since neither's inner
 * acquisition can ever be granted. The split makes this invariant load-bearing
 * across module boundaries too: an import-cache function must not call a
 * browse-cache one from inside a limited section, or vice versa.
 */
const FS_CONCURRENCY_LIMIT = 2

function createLimiter(maxConcurrent: number) {
	let active = 0
	const queue: Array<() => void> = []
	function runNext() {
		if (queue.length === 0 || active >= maxConcurrent) return
		active++
		const run = queue.shift()!
		run()
	}
	return function limit<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			queue.push(() => {
				// try/catch, not just relying on fn() rejecting: if fn() ever
				// threw synchronously instead of returning a rejected promise,
				// active would never decrement and this limiter would
				// permanently deadlock — indistinguishable from the bug this
				// exists to fix. Every current call site's fn() is an async
				// arrow (can't throw synchronously), but this makes that an
				// invariant the limiter itself enforces, not one every future
				// caller has to remember to uphold.
				try {
					fn()
						.then(resolve, reject)
						.finally(() => {
							active--
							runNext()
						})
				} catch (err) {
					active--
					reject(err)
					runNext()
				}
			})
			runNext()
		})
	}
}

export const fsLimit = createLimiter(FS_CONCURRENCY_LIMIT)
