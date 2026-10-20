/**
 * 🚧 **A plugin's reference to a core id core has since renamed** (genre
 * restructure, 2026-10-19).
 *
 * Packages in the wild were built against the ids core shipped then —
 * `core:spec/chat-respond`, `core:spec/chat-turn-order#decide.rules.strategy`,
 * `core:genre/adventure` — and the restructure renamed them
 * (`RENAMED_CORE_IDS` in `@serene-pub/core-catalog`, old → new). Wherever the
 * host resolves a package's reference to a core id — the manifest's
 * `requires`, a `use()` reference compiled into a document's inlet lock or a
 * config's spec, a swap onto a spec, a preset's genre, bindings and included
 * actions, a layout's genre, an event's genre and recorders — it reads the id
 * through {@link resolveRenamedCoreId} first, so the package resolves against
 * what core ships now. The stored manifest stays as shipped: the alias is
 * applied where the reference is resolved, never written back.
 *
 * `core:genre/chat` is not aliased: it kept its id with the new meaning (the
 * assistant), and the table does not list it.
 */
import { RENAMED_CORE_IDS } from "@serene-pub/core-catalog"
import { storedSwapsOf, type StoredSwapContribution } from "$lib/shared/swaps"

const RENAMED: ReadonlyMap<string, string> = new Map(
	RENAMED_CORE_IDS.map((r) => [r.from, r.to])
)

/**
 * The id core ships now for a reference a package names. A renamed id maps
 * whole, or as the head of an address — `<spec>#<node or action key>`,
 * `<id>@<version or range>` — with the tail kept. Anything else, a plugin's
 * own ids among them, comes back unchanged.
 */
export function resolveRenamedCoreId(id: string): string {
	if (typeof id !== "string" || !id) return id
	const whole = RENAMED.get(id)
	if (whole !== undefined) return whole
	for (let i = 0; i < id.length; i++) {
		const ch = id[i]
		if (ch !== "#" && ch !== "@") continue
		const to = RENAMED.get(id.slice(0, i))
		if (to !== undefined) return to + id.slice(i)
	}
	return id
}

/** A manifest's swap contributions (`storedSwapsOf`), each onto the spec core ships now. */
export function pluginSwapsOf(manifest: unknown): StoredSwapContribution[] {
	return storedSwapsOf((manifest as { swaps?: unknown } | null)?.swaps).map((c) => ({
		...c,
		spec: resolveRenamedCoreId(c.spec)
	}))
}

/** A package document whose inlet lock names its genre through `use()`, read onto core's id now. */
export function documentWithRenamedCoreIds<T>(doc: T): T {
	const input = (doc as { input?: { genre?: unknown } } | null)?.input
	if (!input || typeof input.genre !== "string") return doc
	const genre = resolveRenamedCoreId(input.genre)
	return genre === input.genre ? doc : ({ ...doc, input: { ...input, genre } } as T)
}
