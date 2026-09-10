/**
 * Disk-backed cache for IMPORT-side card bytes, under the importing user's own
 * data directory.
 *
 * The data-directory half of the card-bytes split (ruling 2026-09-09): "Image
 * assets do NOT belong in temp and need to be saved to the persistent Serene
 * Pub users data directory. The exception are external search results." A
 * thumbnail in a search grid is that exception and stays in `diskCache.ts`. The
 * bytes fetched to import a card are not: they are handed straight to
 * `charactersImportCard` / `personasImportCard`, which decode them into the
 * character's avatar. They are the user's asset from the moment they arrive.
 *
 * **The defect this replaces, not a hypothetical.** The old shared cache lived
 * at `os.tmpdir()/serene-pub-card-cache` and was keyed by `sha256(source:ref)`
 * with no user and no instance in the key. On a machine running two Serene Pub
 * instances with separate data directories, one instance's imported cards were
 * served to the other — same key, same file. Keying per user AND rooting the
 * directory at `getAppDataDir()` closes both halves: a second data directory is
 * a second root, and a second user is a second directory inside it.
 *
 * **No TTL.** A cache whose whole purpose is "the bytes I am about to turn into
 * an avatar" has nothing to go stale against — a CharaVault ref is immutable
 * once published, and re-fetching an expired entry costs a rate-limited request
 * for bytes that are already correct. Size is bounded by `IMPORT_CACHE_MAX_FILES`
 * per user instead of by age, which is the thing that actually needed bounding.
 */
import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import {
	cardImportCacheRelPath,
	resolveMediaPath
} from "$lib/server/media/paths"
import { fsLimit } from "./fsLimit"
import {
	getOrStartAbortable,
	type PendingAbortableEntry
} from "./pendingAbortableFetch"

/**
 * Per-user ceiling on cached import bytes, enforced by count rather than by
 * bytes so the common path costs one `readdir` and no `stat` at all.
 *
 * 64 is sized off what the cache is FOR: importing a card you just looked at,
 * and re-importing it after a conflict or a failed decode. Nobody needs the
 * 65th-most-recent card they considered importing to still be warm. A character
 * card PNG is typically well under 4 MB, so the worst case is a couple of
 * hundred megabytes per user and the realistic case is tens.
 */
export const IMPORT_CACHE_MAX_FILES = 64

/**
 * Card bytes are Character Card PNGs at both current sources, and the extension
 * is cosmetic either way: every read addresses the file by its exact
 * content-derived path, never by scanning for one. It is here because rule 3 in
 * `media/paths.ts` asks that a directory listing stay legible to the admin
 * reading it, and `.png` is honest about what is in there today.
 */
const CACHE_EXT = "png"

function cachePathFor(userId: number, key: string): string {
	const hash = crypto.createHash("sha256").update(key).digest("hex")
	// Through `resolveMediaPath` rather than a hand-built join, so the
	// containment assertion covers this bucket the way it covers every other
	// media path. Belt and braces given `hash` is a hex digest and `userId` a
	// number — but the assertion is one line and it is forever.
	return resolveMediaPath(cardImportCacheRelPath(userId, hash, CACHE_EXT))
}

/**
 * The user's cache directory, taken as the parent of a path the real builder
 * produced rather than re-spelled here — `relDir`'s `data/users/{id}` rule is
 * private to `media/paths.ts`, and restating it is how two layouts for one
 * thing start. The key is a throwaway; only the directory is used.
 */
function cacheDirFor(userId: number): string {
	return path.dirname(cachePathFor(userId, ""))
}

async function readCachedImportBytes(
	userId: number,
	key: string
): Promise<Buffer | null> {
	return fsLimit(async () => {
		try {
			return await fs.readFile(cachePathFor(userId, key))
		} catch {
			return null
		}
	})
}

async function writeCachedImportBytes(
	userId: number,
	key: string,
	data: Buffer
): Promise<void> {
	return fsLimit(async () => {
		try {
			const filePath = cachePathFor(userId, key)
			await fs.mkdir(path.dirname(filePath), { recursive: true })
			await fs.writeFile(filePath, data)
		} catch (e) {
			// The cache is a pure optimization — the import itself already has
			// the bytes in hand. A write failure (a full disk, a read-only
			// mount) must not fail the import that triggered it.
			console.warn("[cardSources] Failed to write import cache file:", e)
		}
	})
}

/**
 * Trim a user's import cache back to `IMPORT_CACHE_MAX_FILES`, oldest first.
 *
 * Runs after a write rather than on a timer: the only thing that can push a
 * user over the ceiling is that user importing, so the check belongs where the
 * growth is. The `readdir` is the whole cost in the common case — `stat` is
 * only paid when the directory is actually over the line.
 *
 * Not wrapped in fsLimit itself (see the no-nesting invariant in fsLimit.ts);
 * each leaf call takes its own slot.
 */
async function trimImportCache(userId: number): Promise<void> {
	const dir = cacheDirFor(userId)
	let names: string[]
	try {
		names = await fsLimit(() => fs.readdir(dir))
	} catch {
		// Nothing cached for this user yet.
		return
	}
	if (names.length <= IMPORT_CACHE_MAX_FILES) return

	const stamped = await Promise.all(
		names.map((name) =>
			fsLimit(async () => {
				try {
					const stat = await fs.stat(path.join(dir, name))
					return { name, mtimeMs: stat.mtimeMs }
				} catch {
					// Removed underneath us — treat as already gone.
					return null
				}
			})
		)
	)
	const present = stamped.filter((e) => e !== null)
	present.sort((a, b) => a.mtimeMs - b.mtimeMs)

	const doomed = present.slice(0, present.length - IMPORT_CACHE_MAX_FILES)
	await Promise.all(
		doomed.map((entry) =>
			fsLimit(async () => {
				try {
					await fs.unlink(path.join(dir, entry.name))
				} catch {
					// Already removed by a concurrent trim — ignore.
				}
			})
		)
	)
}

/**
 * In-flight de-dup, keyed by USER AND ref rather than ref alone.
 *
 * Sharing one fetch between two users would be free upstream and wrong on
 * disk: the shared body writes exactly one file, so the second user would get
 * the bytes but no cached copy of their own — the cross-owner leak the split
 * exists to close, one level up from the filesystem.
 */
const pendingImportFetches = new Map<string, PendingAbortableEntry<Buffer>>()

/**
 * Fetch a card's bytes for import, through the importing user's own cache.
 *
 * Deliberately not itself wrapped in fsLimit — see the no-nesting invariant in
 * fsLimit.ts. Its fs footprint is entirely inside the already-wrapped functions
 * it calls.
 */
export async function getOrFetchImportedCardBytes(
	userId: number,
	key: string,
	fetcher: (signal: AbortSignal) => Promise<Buffer>,
	signal?: AbortSignal
): Promise<Buffer> {
	const cached = await readCachedImportBytes(userId, key)
	if (cached) return cached

	return getOrStartAbortable(
		pendingImportFetches,
		`${userId}:${key}`,
		async (groupSignal) => {
			const bytes = await fetcher(groupSignal)
			await writeCachedImportBytes(userId, key, bytes)
			await trimImportCache(userId)
			return bytes
		},
		signal
	)
}
