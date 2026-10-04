/**
 * The **import limit**: how many card and lorebook imports run at once — per
 * person, and on the server for everyone together (lorebooks plan S4).
 *
 * One import can cost a lot of memory while it parses: a CHARX may unpack to
 * ~300 MB of images under its own ceilings, and a card's JSON parses (and is
 * cloned by the card reader) under `IMPORT_JSON_LIMITS`, ~130 MB at worst.
 *
 * - **Per person** (`IMPORTS_RUNNING_PER_USER`), counted across every socket
 *   they hold, so more tabs or connections buy no more imports.
 * - **On the server** (`IMPORTS_RUNNING_ON_SERVER`). Per person alone left
 *   the total open-ended: two people with two imports each ran four at once,
 *   and under every byte ceiling that took the server past its heap limit
 *   (S4 review) — an out-of-memory abort, the hard kill that risks PGlite's
 *   write-ahead log. It is above the per-person number, so one person's
 *   imports never fill the server alone.
 *
 * Past either, an import is refused at once with a sentence rather than
 * queued: a queue would hold every waiting file in memory, which is the cost
 * being bounded. Cards and lorebooks share both counts, since they share the
 * memory. Opening a Library card's details fetches and parses a card too, and
 * counts (`charaVaultSource.getCardDetail`); the sentences say "cards or
 * lorebooks being read" so they fit both.
 */

export const IMPORTS_RUNNING_PER_USER = 2
export const IMPORTS_RUNNING_ON_SERVER = 3

export const TOO_MANY_IMPORTS = `You already have ${IMPORTS_RUNNING_PER_USER} cards or lorebooks being read. Wait for one to finish, then try again.`

export const SERVER_BUSY_IMPORTING =
	"Serene Pub is already reading as many cards and lorebooks as it can at once. Try again in a moment."

interface RunningImports {
	byUser: Map<number, number>
	total: number
}

// Process-wide, and one table across a Vite SSR module reload. (A new key:
// the per-person-only table before it was a bare Map.)
const RUNNING_KEY = Symbol.for("serene-pub.importLimit")
const running: RunningImports = ((globalThis as any)[RUNNING_KEY] ??= {
	byUser: new Map<number, number>(),
	total: 0
})

/**
 * Run `work` as one of `userId`'s imports, or refuse with `TOO_MANY_IMPORTS`
 * when they already have their limit running, or `SERVER_BUSY_IMPORTING`
 * when the server does. Both counts are released however `work` ends.
 */
export async function withImportLimit<T>(
	userId: number,
	work: () => Promise<T>
): Promise<T> {
	const mine = running.byUser.get(userId) ?? 0
	if (mine >= IMPORTS_RUNNING_PER_USER) throw new Error(TOO_MANY_IMPORTS)
	if (running.total >= IMPORTS_RUNNING_ON_SERVER) {
		throw new Error(SERVER_BUSY_IMPORTING)
	}
	running.byUser.set(userId, mine + 1)
	running.total++
	try {
		return await work()
	} finally {
		running.total--
		const left = (running.byUser.get(userId) ?? 1) - 1
		if (left > 0) running.byUser.set(userId, left)
		else running.byUser.delete(userId)
	}
}

/** How many imports `userId` has running — or everyone, without one. For tests. */
export function importsRunning(userId?: number): number {
	return userId === undefined
		? running.total
		: (running.byUser.get(userId) ?? 0)
}
