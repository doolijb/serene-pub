/**
 * Pure mapping helpers for exporting Serene Pub's lorebook data (world lore,
 * character lore, and history entries) into a single flat, Character Card
 * V3-spec-compliant `entries[]` array. Kept free of DB imports so the
 * mapping logic can be unit tested without a database.
 *
 * World, character, and history entries all export as plain V3 entries (so
 * an external reader — SillyTavern etc. — gets one usable flat list), with
 * `extensions.serenepub.entryType` telling Serene Pub which table to
 * restore a given entry to on re-import. Any *foreign* extensions data on
 * an entry (eg. a previous import's preserved SillyTavern extension bag,
 * stored verbatim in extraJson) is spread in alongside `serenepub`, not
 * replaced by it.
 */

export type SpecV3Entry = {
	keys: string[]
	content: string
	enabled: boolean
	insertion_order: number
	case_sensitive: boolean
	use_regex: boolean
	constant: boolean
	name?: string
	comment?: string
	priority?: number
	id: number
	extensions: Record<string, any>
}

// Fields common to all three source tables. `name`/`priority` are NOT here
// — historyEntries has neither column, only worldLoreEntries/
// characterLoreEntries do (see NamedEntryLike below).
interface BaseEntryLike {
	id: number
	content: string
	keys: string
	enabled: boolean
	constant: boolean
	useRegex: boolean | null
	caseSensitive: boolean
	extraJson: Record<string, any> | null
}

interface NamedEntryLike extends BaseEntryLike {
	name: string
	priority: number
}

function baseEntryFields(entry: BaseEntryLike, insertionOrder: number) {
	return {
		keys: entry.keys
			.split(",")
			.map((k) => k.trim())
			.filter(Boolean),
		content: entry.content,
		enabled: entry.enabled,
		insertion_order: insertionOrder,
		case_sensitive: entry.caseSensitive,
		use_regex: entry.useRegex ?? false,
		constant: entry.constant,
		id: entry.id
	}
}

function namedEntryFields(entry: NamedEntryLike) {
	return { name: entry.name, comment: entry.name, priority: entry.priority }
}

export function mapWorldEntry(
	entry: NamedEntryLike & { category: string | null },
	insertionOrder: number
): SpecV3Entry {
	return {
		...baseEntryFields(entry, insertionOrder),
		...namedEntryFields(entry),
		extensions: {
			...(entry.extraJson ?? {}),
			serenepub: {
				entryType: "world",
				...(entry.category ? { category: entry.category } : {})
			}
		}
	}
}

export function mapCharacterEntry(
	entry: NamedEntryLike,
	insertionOrder: number,
	bindingLocalId: number | null
): SpecV3Entry {
	return {
		...baseEntryFields(entry, insertionOrder),
		...namedEntryFields(entry),
		extensions: {
			...(entry.extraJson ?? {}),
			serenepub: {
				entryType: "character",
				...(bindingLocalId !== null ? { bindingLocalId } : {})
			}
		}
	}
}

interface HistoryEntryLike extends BaseEntryLike {
	year: number
	month: number | null
	day: number | null
	isCompleted: boolean
	graphed: boolean
}

export interface ExportedScene {
	localId: number
	name: string | null
	summary: string | null
	participantCharacters: string[]
	mentionedCharacters: string[]
}

export function mapHistoryEntry(
	entry: HistoryEntryLike,
	insertionOrder: number,
	localId: number,
	scenes: ExportedScene[]
): SpecV3Entry {
	return {
		...baseEntryFields(entry, insertionOrder),
		extensions: {
			...(entry.extraJson ?? {}),
			serenepub: {
				entryType: "history",
				localId,
				year: entry.year,
				month: entry.month,
				day: entry.day,
				isCompleted: entry.isCompleted,
				graphed: entry.graphed,
				...(scenes.length > 0 ? { scenes } : {})
			}
		}
	}
}

export type SpecV3LorebookLike = {
	name: string
	description: string
	scan_depth?: number
	token_budget?: number
	recursive_scanning?: boolean
	extensions: Record<string, any>
	entries: SpecV3Entry[]
}

interface LorebookLike {
	name: string
	description: string
	uuid: string
	extraJson: Record<string, any> | null
}

/**
 * Assigns each history entry a synthetic, per-export sequential localId
 * (1-based, ordered by position) — the single source of truth for that
 * numbering, so buildSpecV3Lorebook and a caller building narrativeGraph
 * references (Part 4) always agree on the same ids without duplicating the
 * sort-and-index logic in two places.
 */
export function assignHistoryEntryLocalIds(
	historyEntries: { id: number; position: number }[]
): Map<number, number> {
	const sorted = [...historyEntries].sort((a, b) => a.position - b.position)
	const map = new Map<number, number>()
	sorted.forEach((e, i) => map.set(e.id, i + 1))
	return map
}

/**
 * Assembles the base spec-compliant shape from a lorebook's world/character/
 * history entries. Deliberately entries-only — Part 2.5 (bound characters/
 * personas/bindings) and Part 4 (narrative graph) layer additional
 * `extensions.serenepub` keys onto this function's output rather than being
 * handled here, so this stays usable on its own.
 *
 * `bindingLocalIdByRealId`, `scenesByHistoryEntryId`, and
 * `historyEntryLocalIdByRealId` default to empty — callers that don't yet
 * resolve bindings/scenes/graph refs (eg. before Part 2.5/4 land) can omit
 * them entirely; history entries still get correct, stable localIds via the
 * same sequential fallback assignHistoryEntryLocalIds() would produce.
 */
export function buildSpecV3Lorebook(
	lorebook: LorebookLike,
	worldEntries: (NamedEntryLike & {
		category: string | null
		position: number
	})[],
	characterEntries: (NamedEntryLike & {
		position: number
		lorebookBindingId: number | null
	})[],
	historyEntries: (HistoryEntryLike & { position: number })[],
	bindingLocalIdByRealId: Map<number, number> = new Map(),
	scenesByHistoryEntryId: Map<number, ExportedScene[]> = new Map(),
	historyEntryLocalIdByRealId: Map<number, number> = new Map()
): SpecV3LorebookLike {
	const sortedWorld = [...worldEntries].sort(
		(a, b) => a.position - b.position
	)
	const sortedChar = [...characterEntries].sort(
		(a, b) => a.position - b.position
	)
	const sortedHistory = [...historyEntries].sort(
		(a, b) => a.position - b.position
	)

	const entries: SpecV3Entry[] = [
		...sortedWorld.map((e, i) => mapWorldEntry(e, i)),
		...sortedChar.map((e, i) =>
			mapCharacterEntry(
				e,
				sortedWorld.length + i,
				e.lorebookBindingId !== null
					? (bindingLocalIdByRealId.get(e.lorebookBindingId) ?? null)
					: null
			)
		),
		// The history entry's own `localId` is a synthetic, per-export
		// sequential id — deliberately NOT the real DB `id`, so the exported
		// document never leaks/collides with this install's actual primary
		// keys. `e.id` is only used to look up this entry's scenes/localId in
		// the caller-provided maps, which are naturally keyed by real DB ids.
		...sortedHistory.map((e, i) =>
			mapHistoryEntry(
				e,
				sortedWorld.length + sortedChar.length + i,
				historyEntryLocalIdByRealId.get(e.id) ?? i + 1,
				scenesByHistoryEntryId.get(e.id) ?? []
			)
		)
	]

	return {
		name: lorebook.name,
		description: lorebook.description,
		scan_depth: lorebook.extraJson?.scanDepth,
		token_budget: lorebook.extraJson?.tokenBudget,
		recursive_scanning: lorebook.extraJson?.recursiveScanning,
		extensions: { serenepub: { version: 1, uuid: lorebook.uuid } },
		entries
	}
}

export interface ExportedBoundCharacter {
	localId: number
	card: unknown
}

export interface ExportedBoundPersona {
	localId: number
	card: unknown
}

export interface ExportedBinding {
	localId: number
	bindingText: string
	kind: "character" | "persona"
	characterLocalId: number | null
	personaLocalId: number | null
}

/**
 * Layers bound characters/personas/bindings onto a base SpecV3Lorebook
 * (from buildSpecV3Lorebook), under extensions.serenepub — always present,
 * even as empty arrays, so the importer never has to guess whether the key
 * is missing vs. genuinely empty. Kept as a separate step (rather than
 * folded into buildSpecV3Lorebook) so lorebook export can still work without
 * this richer embedding wired up.
 */
export function attachBoundEntities(
	book: SpecV3LorebookLike,
	characters: ExportedBoundCharacter[],
	personas: ExportedBoundPersona[],
	bindings: ExportedBinding[]
): SpecV3LorebookLike {
	return {
		...book,
		extensions: {
			...book.extensions,
			serenepub: {
				...book.extensions.serenepub,
				characters,
				personas,
				bindings
			}
		}
	}
}

export function mapSceneForExport(
	scene: {
		name: string | null
		summary: string | null
		participantCharacters: string[]
		mentionedCharacters: string[]
	},
	localId: number
): ExportedScene {
	return {
		localId,
		name: scene.name,
		summary: scene.summary,
		participantCharacters: scene.participantCharacters,
		mentionedCharacters: scene.mentionedCharacters
	}
}

export interface ExportedNarrativeNode {
	localId: number
	name: string
	nodeState: string
	nodeVisibility: string
	aliases: string[]
	summary: string | null
	bindingLocalId: number | null
	parentLocalId: number | null
	historyEntryLocalId: number | null
	sceneLocalId: number | null
	// Resolved to stable per-character uuids rather than this install's raw
	// DB ids (narrativeNodes.characterIds) — those wouldn't mean anything on
	// a different install. Callers look these up before calling this mapper;
	// any character that doesn't resolve to a uuid is simply omitted.
	characterUuids: string[]
}

interface NarrativeNodeLike {
	name: string
	nodeState: string
	nodeVisibility: string
	aliases: string[]
	summary: string | null
	lorebookBindingId: number | null
	parentNodeId: number | null
	historyEntryId: number | null
	sceneId: number | null
}

export function mapNarrativeNode(
	node: NarrativeNodeLike,
	localId: number,
	characterUuids: string[],
	bindingLocalIdByRealId: Map<number, number>,
	nodeLocalIdByRealId: Map<number, number>,
	historyEntryLocalIdByRealId: Map<number, number>,
	sceneLocalIdByRealId: Map<number, number>
): ExportedNarrativeNode {
	return {
		localId,
		name: node.name,
		nodeState: node.nodeState,
		nodeVisibility: node.nodeVisibility,
		aliases: node.aliases,
		summary: node.summary,
		bindingLocalId:
			node.lorebookBindingId !== null
				? (bindingLocalIdByRealId.get(node.lorebookBindingId) ?? null)
				: null,
		parentLocalId:
			node.parentNodeId !== null
				? (nodeLocalIdByRealId.get(node.parentNodeId) ?? null)
				: null,
		historyEntryLocalId:
			node.historyEntryId !== null
				? (historyEntryLocalIdByRealId.get(node.historyEntryId) ?? null)
				: null,
		sceneLocalId:
			node.sceneId !== null
				? (sceneLocalIdByRealId.get(node.sceneId) ?? null)
				: null,
		characterUuids
	}
}

export interface ExportedNarrativeRelationship {
	fromLocalId: number
	toLocalId: number
	relationshipType: string
	description: string
	visibility: string
	status: string
	reason: string | null
	historyEntryLocalId: number | null
	sceneLocalId: number | null
}

interface NarrativeRelationshipLike {
	fromNodeId: number
	toNodeId: number
	relationshipType: string
	description: string
	visibility: string
	status: string
	reason: string | null
	historyEntryId: number | null
	sceneId: number | null
}

export function mapNarrativeRelationship(
	rel: NarrativeRelationshipLike,
	nodeLocalIdByRealId: Map<number, number>,
	historyEntryLocalIdByRealId: Map<number, number>,
	sceneLocalIdByRealId: Map<number, number>
): ExportedNarrativeRelationship | null {
	const fromLocalId = nodeLocalIdByRealId.get(rel.fromNodeId)
	const toLocalId = nodeLocalIdByRealId.get(rel.toNodeId)
	// Both endpoints must resolve — a relationship pointing at a node this
	// export didn't include (shouldn't normally happen, all of a lorebook's
	// own nodes are always exported together) can't be represented.
	if (fromLocalId === undefined || toLocalId === undefined) return null

	return {
		fromLocalId,
		toLocalId,
		relationshipType: rel.relationshipType,
		description: rel.description,
		visibility: rel.visibility,
		status: rel.status,
		reason: rel.reason,
		historyEntryLocalId:
			rel.historyEntryId !== null
				? (historyEntryLocalIdByRealId.get(rel.historyEntryId) ?? null)
				: null,
		sceneLocalId:
			rel.sceneId !== null
				? (sceneLocalIdByRealId.get(rel.sceneId) ?? null)
				: null
	}
}

/**
 * Layers the narrative graph onto a base SpecV3Lorebook — omitted entirely
 * when there's nothing to include, rather than an empty object, since
 * (unlike bindings) most lorebooks won't have graph data at all and an
 * absent key is a clearer signal than an empty one. Best-effort/versioned by
 * design (see lorebookImportMapper's graph restoration) since this feature
 * is still evolving — a future version bump only needs an importer update,
 * never breaks older exports.
 */
export function attachNarrativeGraph(
	book: SpecV3LorebookLike,
	nodes: ExportedNarrativeNode[],
	relationships: ExportedNarrativeRelationship[]
): SpecV3LorebookLike {
	if (nodes.length === 0 && relationships.length === 0) return book
	return {
		...book,
		extensions: {
			...book.extensions,
			serenepub: {
				...book.extensions.serenepub,
				narrativeGraph: { version: 1, nodes, relationships }
			}
		}
	}
}
