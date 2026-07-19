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

const CACHE_DIR = path.join(os.tmpdir(), "serene-pub-card-cache")
const DEFAULT_TTL_MS = 24 * 60 * 60_000
const SWEEP_INTERVAL_MS = 60 * 60_000

function keyToFilename(key: string): string {
	return crypto.createHash("sha256").update(key).digest("hex")
}

export async function getCachedCardBytes(
	key: string,
	ttlMs = DEFAULT_TTL_MS
): Promise<Buffer | null> {
	try {
		const filePath = path.join(CACHE_DIR, keyToFilename(key))
		const stat = await fs.stat(filePath)
		if (Date.now() - stat.mtimeMs > ttlMs) return null
		return await fs.readFile(filePath)
	} catch {
		return null
	}
}

export async function setCachedCardBytes(
	key: string,
	data: Buffer
): Promise<void> {
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
}

/**
 * Wraps a fetcher that produces card bytes with the disk cache — the
 * common shape every CardSource's getCardBytes() and the CharaVault image
 * proxy route all want.
 */
export async function getOrFetchCardBytes(
	key: string,
	fetcher: () => Promise<Buffer>,
	ttlMs = DEFAULT_TTL_MS
): Promise<Buffer> {
	const cached = await getCachedCardBytes(key, ttlMs)
	if (cached) return cached

	const bytes = await fetcher()
	await setCachedCardBytes(key, bytes)
	return bytes
}

async function sweepStaleCacheFiles() {
	let entries: string[]
	try {
		entries = await fs.readdir(CACHE_DIR)
	} catch {
		// Cache dir doesn't exist yet (nothing has been cached) — nothing to do.
		return
	}

	const now = Date.now()
	await Promise.all(
		entries.map(async (name) => {
			const filePath = path.join(CACHE_DIR, name)
			try {
				const stat = await fs.stat(filePath)
				// Every current caller uses DEFAULT_TTL_MS, so sweeping against
				// it is accurate in practice; a hypothetical caller passing a
				// longer custom TTL to getCachedCardBytes() would just see that
				// entry re-fetched slightly earlier than necessary next time —
				// not a correctness issue, since freshness is always re-checked
				// on read regardless of what the sweep has or hasn't gotten to.
				if (now - stat.mtimeMs > DEFAULT_TTL_MS) {
					await fs.unlink(filePath)
				}
			} catch {
				// Already removed by a concurrent sweep/request — ignore.
			}
		})
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
