/**
 * Disk-backed cache for BROWSE-side card bytes — the thumbnails and detail
 * PNGs behind a library search grid, fetched from a CardSource and shown to
 * whoever is browsing. It is the temp-directory half of the card-bytes split
 * (ruling 2026-09-09): "Image assets do NOT belong in temp and need to be saved
 * to the persistent Serene Pub users data directory. The exception are external
 * search results." These ARE the exception. Bytes fetched in order to IMPORT a
 * card are not, and go through `importCache.ts` instead, under the importing
 * user's own data directory.
 *
 * ⚠ Read the split before adding a caller. This cache is keyed by `source:ref`
 * ALONE — no user, no instance — which is correct for a public thumbnail and
 * wrong for anything that becomes a user's own asset. Two Serene Pub instances
 * on one machine share this directory, which is how a card fetched by one
 * instance was observed being shown by another; that is tolerable for a search
 * result and was a real defect for an import.
 *
 * Separate from cache.ts's in-memory TtlCache (which caches search *results*,
 * small JSON) — card files are read relatively rarely per key (once per card
 * view) but are worth caching on disk rather than in process memory, since:
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
import { fsLimit } from "./fsLimit"
import {
	getOrStartAbortable,
	type PendingAbortableEntry
} from "./pendingAbortableFetch"

// Renamed from "serene-pub-card-cache" when the cache split in two, so a
// directory listing says which half it is. Deliberately NOT migrated or
// deleted: the old directory is somebody else's temp files as far as this
// process knows, and a cache that rebuilds itself on the next page load is
// not worth reaching into /tmp to tidy. The OS (or the user) reclaims it.
const CACHE_DIR = path.join(os.tmpdir(), "serene-pub-browse-cache")
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
 * Wraps a fetcher that produces card bytes with the browse disk cache — the
 * common shape a CardSource's BROWSE-side reads want (a thumbnail, a card
 * detail's embedded description). An import wants
 * `importCache.getOrFetchImportedCardBytes` instead, which takes a userId.
 *
 * Deliberately not itself wrapped in fsLimit — see the no-nesting
 * invariant in fsLimit.ts. Its own fs footprint is entirely inside the two
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
