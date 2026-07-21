/**
 * Pure mapping helpers for importing a parsed CharacterBook (lorebook/world
 * info, CCv2/CCv3 spec) into Serene Pub's world lore entry shape. Kept free
 * of DB imports so the mapping logic can be unit tested without a database.
 */

/**
 * True if a lorebook-shaped object actually has entries — handles both a
 * proper array and the legacy object-keyed-by-index shape (see
 * normalizeLegacyLorebookData). CharacterCard's own `character_book` getter
 * always returns a placeholder object (`{entries: [], ...}`) even for cards
 * with no book at all, so a plain truthiness check on the book itself isn't
 * enough — this is what actually distinguishes "has a book" from "doesn't".
 */
export function hasLorebookEntries(book: unknown): boolean {
	const entries = (book as any)?.entries
	if (Array.isArray(entries)) return entries.length > 0
	if (entries && typeof entries === "object") return Object.keys(entries).length > 0
	return false
}

/**
 * Normalizes older/legacy lorebook JSON shapes before handing off to
 * CharacterBook.from_json(), which only understands a narrow set of shapes
 * (a raw array, `{entries: [...]}`, or a full card's nested
 * `data.character_book.entries`) and silently produces an *empty* book —
 * not an error — for anything else. Two real-world legacy shapes this
 * patches:
 *   - SillyTavern's older World Info export keys entries by a numeric index
 *     object (`{entries: {"0": {...}, "1": {...}}}`) rather than an array.
 *   - Some tools write a single-string `key`/`keysecondary` field instead
 *     of the `keys`/`secondary_keys` arrays the spec expects.
 */
export function normalizeLegacyLorebookData(rawData: unknown): any {
	if (!rawData || typeof rawData !== "object") return rawData

	let entries = (rawData as any).entries
	if (entries && !Array.isArray(entries) && typeof entries === "object") {
		entries = Object.values(entries)
	}
	if (!Array.isArray(entries)) return rawData

	// Only touches a field when it actually needs normalizing (present, but
	// not already array-shaped) — never invents `key`/`keysecondary` on an
	// entry that never had them. An already-normalized entry (eg. Serene
	// Pub's own prior export) is returned untouched, byte-for-byte; without
	// this, every re-import of an unedited lorebook would gain phantom empty
	// `keysecondary: []`/duplicate `key: [...]` fields the original export
	// never had, making its hash never match the existing row's and turning
	// every "unchanged" re-import into a false "conflict".
	const normalizedEntries = entries.map((entry: any) => {
		if (!entry || typeof entry !== "object") return entry
		const patch: Record<string, unknown> = {}

		if ("key" in entry && !Array.isArray(entry.key)) {
			patch.key = entry.key ? [entry.key] : []
		}
		if (!Array.isArray(entry.keys)) {
			patch.keys = Array.isArray(entry.key)
				? entry.key
				: entry.key
					? [entry.key]
					: []
		}
		if ("keysecondary" in entry && !Array.isArray(entry.keysecondary)) {
			patch.keysecondary = entry.keysecondary ? [entry.keysecondary] : []
		}

		return Object.keys(patch).length > 0 ? { ...entry, ...patch } : entry
	})

	return { ...rawData, entries: normalizedEntries }
}

/**
 * Resolves narrative graph nodes' real `parentNodeId` links from their
 * exported `localId`/`parentLocalId` pairs, enforcing the app's own
 * `narrativeNodes.parentNodeId` invariant ("2-level max": a node's parent
 * must not itself have a parent). A crafted or malformed import can
 * otherwise link a node to itself, or chain aliases deeper than the schema
 * is meant to support — both silently, since the DB column itself has no
 * constraint preventing either. Two cases are skipped rather than linked:
 *   - a node listing itself as its own parent (`parentLocalId === localId`)
 *   - a node whose chosen parent already has its own parent in the source
 *     data (linking would create a 3rd alias level)
 * Pure/DB-free so this logic can be unit tested without a database —
 * restoreNarrativeGraph (lorebooks.ts) does the actual DB update per link.
 */
export function resolveParentNodeLinks(
	rawNodes: Array<{ localId?: unknown; parentLocalId?: unknown }>,
	nodeLocalIdToRealId: Map<number, number>
): Array<{ realId: number; parentRealId: number }> {
	const parentLocalIdByLocalId = new Map<number, number>()
	for (const node of rawNodes) {
		if (typeof node?.localId === "number" && typeof node?.parentLocalId === "number") {
			parentLocalIdByLocalId.set(node.localId, node.parentLocalId)
		}
	}

	const links: Array<{ realId: number; parentRealId: number }> = []
	for (const node of rawNodes) {
		if (typeof node?.localId !== "number" || typeof node?.parentLocalId !== "number") {
			continue
		}
		const { localId, parentLocalId } = node as {
			localId: number
			parentLocalId: number
		}
		if (parentLocalId === localId) continue
		if (parentLocalIdByLocalId.has(parentLocalId)) continue

		const realId = nodeLocalIdToRealId.get(localId)
		const parentRealId = nodeLocalIdToRealId.get(parentLocalId)
		if (!realId || !parentRealId) continue
		links.push({ realId, parentRealId })
	}
	return links
}

export interface LorebookEntryLike {
	keys: string[]
	content: string
	enabled: boolean
	constant?: boolean
	name?: string
	comment?: string
	priority?: number
	case_sensitive?: boolean
	use_regex?: boolean
	extensions?: Record<string, any>
}

/**
 * Strips Serene Pub's own `serenepub` bookkeeping key out of an entry's
 * `extensions` bag before stashing the rest into `extraJson`. Without this,
 * re-importing something Serene Pub itself exported would nest last time's
 * `serenepub` metadata inside `extraJson`, which the next export would then
 * wrap in a *new* `serenepub` key — accumulating a layer of stale nesting on
 * every round trip. `serenepub` metadata is always re-derived fresh from the
 * DB row's real columns at export time, so it never needs to be preserved as
 * opaque foreign data.
 */
function omitSerenepubExtension(
	extensions: Record<string, any> | undefined
): Record<string, any> {
	if (!extensions) return {}
	const { serenepub, ...rest } = extensions
	return rest
}

/** Clamp an entry's priority into Serene Pub's supported 1-3 range, defaulting to 1. */
export function normalizeLorebookEntryPriority(
	priority: number | null | undefined
): number {
	if (priority === null || priority === undefined || priority < 1) {
		return 1
	}
	if (priority > 3) {
		return 3
	}
	return priority
}

/**
 * Which Serene Pub table a parsed entry should be restored to. Entries
 * carrying our own `extensions.serenepub.entryType` marker (ie. anything
 * previously exported by Serene Pub) route to their original table;
 * anything else (an external tool's lorebook, or a bare CCv2/CCv3 file)
 * falls back to world lore — the most agnostic table, matching this
 * importer's pre-existing behavior for non-Serene-Pub sources.
 */
export function entryTypeOf(entry: LorebookEntryLike): "world" | "character" | "history" {
	const marked = entry.extensions?.serenepub?.entryType
	if (marked === "character" || marked === "history") return marked
	return "world"
}

// Fields common to all three destination tables. `name`/`priority` are
// deliberately NOT here — historyEntries has neither column, only
// worldLoreEntries/characterLoreEntries do.
function sharedEntryFields(entry: LorebookEntryLike) {
	return {
		content: entry.content || "",
		keys: entry.keys?.join(", ") || "",
		enabled: entry.enabled ?? true,
		constant: entry.constant ?? false,
		caseSensitive: entry.case_sensitive ?? false,
		useRegex: entry.use_regex ?? false,
		// Preserves any *foreign* extension data verbatim (eg. SillyTavern's
		// rich per-entry bag: position, probability, depth, group, sticky,
		// cooldown, role, vectorized, etc.) so re-exporting later reproduces
		// it faithfully instead of silently discarding it, as this used to.
		extraJson: omitSerenepubExtension(entry.extensions)
	}
}

function nameAndPriority(entry: LorebookEntryLike) {
	return {
		name: entry.name || entry.comment || "Imported Entry",
		priority: normalizeLorebookEntryPriority(entry.priority)
	}
}

/**
 * Map a single parsed lorebook entry to the plain values used to insert a
 * worldLoreEntries row (minus lorebookId, which the caller assigns after
 * creating the lorebook).
 */
export function mapLorebookEntryToWorldLoreEntry(
	entry: LorebookEntryLike,
	position: number
) {
	return {
		...sharedEntryFields(entry),
		...nameAndPriority(entry),
		position,
		// Restores a category previously round-tripped via
		// extensions.serenepub.category (see lorebookExportMapper.ts) — falls
		// back to null (matches the column's own default) for entries that
		// never had one, eg. anything imported from an external tool.
		category: entry.extensions?.serenepub?.category ?? null
	}
}

/**
 * Map a single parsed lorebook entry to the plain values used to insert a
 * characterLoreEntries row (minus lorebookId/lorebookBindingId, which the
 * caller assigns — binding restoration isn't wired up until Part 2.5).
 */
export function mapLorebookEntryToCharacterLoreEntry(
	entry: LorebookEntryLike,
	position: number
) {
	return {
		...sharedEntryFields(entry),
		...nameAndPriority(entry),
		position
	}
}

/**
 * Map a single parsed lorebook entry to the plain values used to insert a
 * historyEntries row (minus lorebookId, which the caller assigns). Unlike
 * the other two tables, historyEntries has no `name`/`priority` column.
 */
export function mapLorebookEntryToHistoryEntry(
	entry: LorebookEntryLike,
	position: number
) {
	const meta = entry.extensions?.serenepub ?? {}
	return {
		...sharedEntryFields(entry),
		position,
		year: typeof meta.year === "number" ? meta.year : 1,
		month: typeof meta.month === "number" ? meta.month : null,
		day: typeof meta.day === "number" ? meta.day : null,
		isCompleted: meta.isCompleted ?? false,
		graphed: meta.graphed ?? false
	}
}
