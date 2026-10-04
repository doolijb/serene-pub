/**
 * **Held imports** — the file an import leaves on the server while the
 * person decides (lorebooks plan S4; NOMENCLATURE §16): a conflict's file, or
 * a created card's embedded book waiting on the "Import the lorebook?" dialog
 * (`Sockets.Characters.HeldCardBook`).
 *
 * A reply never carries the file back: it carries a `heldImportId`, and the
 * choice names it, so the file crosses the wire once. Echoing it would send up
 * to 100 MB three times, to every tab the person has open.
 *
 * **Owner-scoped.** Only the person whose import it is can settle it: a held
 * import asked for by anyone else, by the wrong kind of import, after it
 * expired or after it was settled gets the one `HELD_IMPORT_GONE` sentence, so
 * an id never tells a stranger whether it exists.
 *
 * **Taken once.** Settling takes the file out of the store before any work
 * starts, so two tabs answering the same prompt cannot both import it.
 *
 * **Bounded.** In memory, never on disk: a held import lives only between a
 * conflict reply and the answer to it. Each person keeps their newest
 * `perUser`; nothing outlives `ttlMs`; and the whole store stays under
 * `totalBytes`. Past that, the person holding the MOST gives way first (their
 * oldest), so other people's conflicts never push out someone holding less
 * than they do — dropping the oldest whoever owned it let two people empty a
 * third's in seconds (S4 review). A dropped import is asked for again with the
 * same sentence as an expired one.
 *
 * ⚠ Not the SillyTavern folder import's staging directory (`import.ts`), which
 * is an admin's upload spread over many files for a multi-step import. A held
 * import is one file waiting on one question.
 */

export type HeldImportKind = "card" | "lorebook"

export interface HeldLorebookImport {
	/** The lorebook file's text, exactly as it arrived. */
	lorebookJson: string
	/** The name the person gave it in the import dialog, if they changed it. */
	name?: string
}

interface HeldImportPayloads {
	/** The card file's bytes, already decoded from base64. */
	card: Buffer
	lorebook: HeldLorebookImport
}

interface HeldImport {
	userId: number
	kind: HeldImportKind
	payload: HeldImportPayloads[HeldImportKind]
	bytes: number
	heldAt: number
}

export const HELD_IMPORT_LIMITS = {
	/** Long enough to read the prompt and decide; short enough to forget. */
	ttlMs: 15 * 60 * 1000,
	/** The newest this many per person; an older one is dropped. */
	perUser: 2,
	/** Every held import together, oldest dropped first. */
	totalBytes: 256 * 1024 * 1024
} as const

export const HELD_IMPORT_GONE =
	"This import is no longer waiting — it expired or was already settled. Choose the file again."

// One store per process, even across a Vite SSR module reload: a reload
// between the conflict reply and the answer would otherwise lose the file.
const STORE_KEY = Symbol.for("serene-pub.heldImports")
const store: Map<string, HeldImport> = ((globalThis as any)[STORE_KEY] ??=
	new Map<string, HeldImport>())

// A file nobody answers for is let go even if no one imports again. Once per
// process, like the store, and never holding the process open.
const SWEEP_KEY = Symbol.for("serene-pub.heldImports.sweep")
;(globalThis as any)[SWEEP_KEY] ??= setInterval(
	() => sweep(Date.now()),
	60 * 1000
).unref()

function sizeOf(kind: HeldImportKind, payload: unknown): number {
	if (kind === "card") return (payload as Buffer).length
	const held = payload as HeldLorebookImport
	return Buffer.byteLength(held.lorebookJson) + (held.name?.length ?? 0)
}

function sweep(now: number): void {
	for (const [id, held] of store) {
		if (now - held.heldAt > HELD_IMPORT_LIMITS.ttlMs) store.delete(id)
	}
}

function totalBytes(): number {
	let total = 0
	for (const held of store.values()) total += held.bytes
	return total
}

/**
 * The oldest held import of whoever holds the most bytes — counting the
 * `incoming` bytes `userId` is about to hold — ties going to whoever's oldest
 * is oldest. Map order is insertion order, so each person's first is their
 * oldest.
 */
function heaviestHoldersOldest(
	userId: number,
	incoming: number
): [string, HeldImport] {
	const held = new Map<number, number>([[userId, incoming]])
	const oldest = new Map<number, [string, HeldImport]>()
	for (const entry of store) {
		const owner = entry[1].userId
		held.set(owner, (held.get(owner) ?? 0) + entry[1].bytes)
		if (!oldest.has(owner)) oldest.set(owner, entry)
	}
	// Owners in the order of their oldest hold, so the first maximum found
	// is the oldest among equals.
	let pick: [string, HeldImport] | undefined
	let most = -1
	for (const [owner, entry] of oldest) {
		const bytes = held.get(owner)!
		if (bytes > most) {
			most = bytes
			pick = entry
		}
	}
	return pick!
}

/**
 * Keep `payload` for `userId` until they answer the conflict; the id the
 * reply carries. Map order is insertion order, so the first match is always
 * the oldest.
 */
export function holdImport<K extends HeldImportKind>(
	userId: number,
	kind: K,
	payload: HeldImportPayloads[K]
): string {
	const now = Date.now()
	sweep(now)
	const mine = [...store.entries()].filter(([, h]) => h.userId === userId)
	for (const [id] of mine.slice(
		0,
		Math.max(0, mine.length - HELD_IMPORT_LIMITS.perUser + 1)
	)) {
		store.delete(id)
	}
	const bytes = sizeOf(kind, payload)
	let total = totalBytes()
	while (total + bytes > HELD_IMPORT_LIMITS.totalBytes && store.size > 0) {
		const [id, held] = heaviestHoldersOldest(userId, bytes)
		store.delete(id)
		total -= held.bytes
	}
	const id = crypto.randomUUID()
	store.set(id, { userId, kind, payload, bytes, heldAt: now })
	return id
}

/**
 * Take the held import `id` out of the store for `userId` to settle. Throws
 * `HELD_IMPORT_GONE` for anything that is not this person's waiting import of
 * this kind — never a different sentence for someone else's.
 */
export function takeHeldImport<K extends HeldImportKind>(
	userId: number,
	kind: K,
	id: unknown
): HeldImportPayloads[K] {
	sweep(Date.now())
	const held = typeof id === "string" ? store.get(id) : undefined
	if (!held || held.userId !== userId || held.kind !== kind) {
		throw new Error(HELD_IMPORT_GONE)
	}
	store.delete(id as string)
	return held.payload as HeldImportPayloads[K]
}

/** How many imports are held, for tests. */
export function heldImportCount(userId?: number): number {
	if (userId === undefined) return store.size
	return [...store.values()].filter((h) => h.userId === userId).length
}

/** Empty the store, for tests. */
export function clearHeldImports(): void {
	store.clear()
}
