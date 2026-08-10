/**
 * Disk-backed cache for individual card bytes (PNG/JSON files fetched from
 * a CardSource's getCardBytes()), keyed by source+ref and stored under the
 * OS temp directory. This is separate from cache.ts's in-memory TtlCache
 * (which caches search *results*, small JSON) — card files are read
 * relatively rarely per key (once per card view/import) but are worth
 * caching on disk rather than in process memory, since:
 *   - They're larger (PNG images) and shouldn't bloat the Node heap.
 *   - They survive a server restart, unlike the in-memory caches.
 *   - Repeat views of the same card's thumbnail (the common case — a card
 *     shown in search results gets rendered every time the page is
 *     revisited) cost zero upstream requests once cached, which matters
 *     most for CharaVault's rate-limited API.
 *
 * The OS temp directory is NOT reliably cleared on its own — that's a
 * common assumption but doesn't hold across the platforms this app targets:
 * Windows never auto-clears %TEMP%, and plenty of Linux distros (Debian/
 * Ubuntu among them) keep /tmp on disk with no reboot-time wipe, only an
 * optional age-based janitor if one's configured. Left alone, this cache
 * would grow forever. A periodic sweep (below) actively deletes expired
 * entries instead of relying on the OS, matching the same
 * setInterval-based stale-session sweep pattern used for import.ts's temp
 * directories.
 */
import os from "os"
import path from "path"
import fs from "fs/promises"
import crypto from "crypto"
import {
	getOrStartAbortable,
	type PendingAbortableEntry
} from "./pendingAbortableFetch"

const CACHE_DIR = path.join(os.tmpdir(), "serene-pub-card-cache")
const DEFAULT_TTL_MS = 24 * 60 * 60_000
// CharaVault images are immutable once published under a given folder/file
// ref — safe to hold far longer than the general-purpose default, so a
// browsing session doesn't re-hit a rate-limited "cold grid" scenario every
// single day for images that were already fetched successfully once.
export const IMAGE_TTL_MS = 30 * 24 * 60 * 60_000
const SWEEP_INTERVAL_MS = 60 * 60_000

function keyToFilename(key: string): string {
	return crypto.createHash("sha256").update(key).digest("hex")
}

// sweepStaleCacheFiles() below fans out one fs.stat (+ conditionally
// fs.unlink) per file in the ENTIRE cache directory at once via
// Promise.all, and the image-proxy route's per-thumbnail reads/writes
// (getCachedCardBytes/setCachedCardBytes, called directly, not through the
// deduped getOrFetchCardBytes below) are explicitly not deduped — a single
// grid of results can fire DEFAULT_LIMIT (24) concurrent thumbnail cache
// operations from one ordinary page load. Both are uncapped sources of
// concurrent fs calls, which matters more here than it might elsewhere:
// this app's PGlite database is file-backed, and its Node storage backend
// (Emscripten's NODEFS) uses Node's *synchronous* fs calls — readSync/
// writeSync/etc. — meaning every DB read or write blocks the event loop
// directly for however long the OS takes to service it. A large burst of
// concurrent async fs work from this subsystem (which also queues against
// itself on libuv's thread pool — 4 threads by default, unconfigured)
// creates real OS-level disk contention that a synchronous PGlite call can
// get stuck behind, blocking every other request the process is handling,
// not just CharaVault's own. Bounding this subsystem's own concurrency to
// a small, fixed ceiling reduces that contention regardless of how much of
// the effect is thread-pool queueing versus direct disk contention.
// Deliberately below the pool's own default size (4), not equal to it — at
// 4 this subsystem could still occupy the entire pool by itself, leaving
// nothing for any other async fs/dns/crypto call elsewhere in the app;
// capping at 2 leaves at least half the pool free regardless of how busy
// this subsystem gets.
//
// Side effect worth knowing about, not a bug: sweeping a cache directory
// with thousands of entries now takes noticeably longer wall-clock time
// (a slow trickle instead of one big burst) — that's the intended trade
// (smooth beats spiky for exactly the contention reason this limiter
// exists), not a regression to "fix" by widening or removing the limit.
//
// Invariant: never call fsLimit(...) from inside a function that's already
// running under fsLimit — getOrFetchCardBytes below deliberately stays
// unwrapped itself, only calling the two already-wrapped leaf functions,
// precisely to avoid this. Nesting would let one caller hold an outer slot
// while waiting on an inner one; at FS_CONCURRENCY_LIMIT = 2, two such
// nested callers can hold both outer slots and deadlock each other
// permanently, since neither's inner acquisition can ever be granted.
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

const fsLimit = createLimiter(FS_CONCURRENCY_LIMIT)

export async function getCachedCardBytes(
	key: string,
	ttlMs = DEFAULT_TTL_MS
): Promise<Buffer | null> {
	return fsLimit(async () => {
		try {
			const filePath = path.join(CACHE_DIR, keyToFilename(key))
			const stat = await fs.stat(filePath)
			if (Date.now() - stat.mtimeMs > ttlMs) return null
			return await fs.readFile(filePath)
		} catch {
			return null
		}
	})
}

export async function setCachedCardBytes(
	key: string,
	data: Buffer
): Promise<void> {
	return fsLimit(async () => {
		try {
			await fs.mkdir(CACHE_DIR, { recursive: true })
			const filePath = path.join(CACHE_DIR, keyToFilename(key))
			await fs.writeFile(filePath, data)
		} catch (e) {
			// Cache is a pure optimization — a write failure (eg. a read-only
			// temp dir in some sandboxed environment) shouldn't fail the request
			// that triggered it.
			console.warn("[cardSources] Failed to write card cache file:", e)
		}
	})
}

// In-flight de-dup: concurrent getOrFetchCardBytes() calls for the same
// not-yet-cached key share one fetcher() call instead of each
// independently hitting CharaVault (or GitHub) — the same "cache
// stampede" this session's cache.ts TtlCache already solves for search
// results. Two browser tabs (or a page rendering the same card's avatar
// twice before the disk cache warms) previously burned two rate-limit
// slots for one logical fetch. Reference-counted via
// pendingAbortableFetch.ts so a caller's own cancellation only aborts the
// shared fetcher() once every attached caller has given up, not on the
// first one.
const pendingFetches = new Map<string, PendingAbortableEntry<Buffer>>()

/**
 * Wraps a fetcher that produces card bytes with the disk cache — the
 * common shape every CardSource's getCardBytes() wants. (The CharaVault
 * image-proxy route deliberately does NOT use this — it streams the
 * response through rather than buffering, so it can't share this same
 * in-flight-promise de-dup; a concurrent-request stampede there is a
 * known, accepted gap, not covered by this fix.)
 *
 * Deliberately not itself wrapped in fsLimit — see the no-nesting
 * invariant above. Its own fs footprint is entirely inside the two
 * already-wrapped functions it calls.
 */
export async function getOrFetchCardBytes(
	key: string,
	fetcher: (signal: AbortSignal) => Promise<Buffer>,
	signal?: AbortSignal,
	ttlMs = DEFAULT_TTL_MS
): Promise<Buffer> {
	const cached = await getCachedCardBytes(key, ttlMs)
	if (cached) return cached

	return getOrStartAbortable(
		pendingFetches,
		key,
		async (groupSignal) => {
			const bytes = await fetcher(groupSignal)
			await setCachedCardBytes(key, bytes)
			return bytes
		},
		signal
	)
}

async function sweepStaleCacheFiles() {
	let entries: string[]
	try {
		entries = await fsLimit(() => fs.readdir(CACHE_DIR))
	} catch {
		// Cache dir doesn't exist yet (nothing has been cached) — nothing to do.
		return
	}

	const now = Date.now()
	await Promise.all(
		entries.map((name) =>
			fsLimit(async () => {
				const filePath = path.join(CACHE_DIR, name)
				try {
					const stat = await fs.stat(filePath)
					// Must use the LONGEST TTL any caller currently requests
					// (IMAGE_TTL_MS, since the CharaVault image-proxy route reads
					// with that instead of DEFAULT_TTL_MS) — not DEFAULT_TTL_MS
					// itself. Sweeping against the shorter default would physically
					// delete an image cache entry from disk at the 24h mark even
					// though a read asks for a 30-day-long freshness window,
					// silently undermining that longer TTL. A caller using a
					// shorter effective TTL than the sweep's threshold is still
					// correctly treated as stale on its own next read regardless of
					// when the sweep gets to it, so this doesn't weaken freshness
					// for any other caller — it only stops the sweep from deleting
					// entries prematurely for the one that asked to keep them
					// longer.
					if (now - stat.mtimeMs > IMAGE_TTL_MS) {
						await fs.unlink(filePath)
					}
				} catch {
					// Already removed by a concurrent sweep/request — ignore.
				}
			})
		)
	)
}

// Runs independently of any request — a card cached once and never viewed
// again would otherwise sit on disk forever, since getCachedCardBytes()
// only checks staleness lazily, on read, for the one key being looked up.
setInterval(() => {
	sweepStaleCacheFiles().catch((e) => {
		console.warn("[cardSources] Card cache sweep failed:", e)
	})
}, SWEEP_INTERVAL_MS).unref()
