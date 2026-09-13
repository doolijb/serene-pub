/**
 * Pure mapping helpers for exporting Serene Pub's lorebook entries into a
 * single flat, Character Card V3-spec-compliant `entries[]` array. Kept free of
 * DB imports so the mapping logic can be unit tested without a database — the
 * type declarations it reads are code, not rows.
 *
 * Every type exports as a plain V3 entry (so an external reader —
 * SillyTavern etc. — gets one usable flat list), with
 * `extensions.serenepub.entryType` telling Serene Pub which type to restore a
 * given entry as on re-import. Any *foreign* extensions data on an entry (eg. a
 * previous import's preserved SillyTavern extension bag, stored verbatim in
 * `extraJson`) is spread in alongside `serenepub`, not replaced by it.
 *
 * ⚠ **`entryType` is a wire name and never a type id.** `world` / `character` /
 * `history` are what every lorebook Serene Pub has ever written carries, and a
 * file is read by installs whose type registry is not this one. Writing
 * `core:entry/world-lore@1` into a file would make the registry a public
 * contract, versioned, forever.
 */

import {
	declaredFields,
	entryDeclaration
} from "$lib/server/entries/declarations"
import {
	isSelectiveLogic,
	SELECTIVE_LOGIC_BY_ST_CODE
} from "$lib/server/pipelines/ranking/signals"
import {
	ENTRY_EXPORT_KEY,
	ENTRY_TYPE_IDS,
	WORLD_LORE_TYPE_ID,
	type EntryTypeId
} from "$lib/shared/entries/types"

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
	/** Both spec fields, written only by an entry that has a condition. */
	secondary_keys?: string[]
	selective?: boolean
	id: number
	extensions: Record<string, any>
}

/**
 * What the exporter needs off a row, whatever type it is.
 *
 * A `LorebookEntry` satisfies this; so does a plain object in a test. Kept as a
 * structural minimum rather than the branded row itself so the mapper stays
 * usable on the entry-shaped things the round-trip tests build by hand.
 */
export interface ExportableEntry {
	id: number
	typeId: string
	content: string
	keys: string
	enabled: boolean
	constant: boolean
	useRegex: boolean | null
	caseSensitive: boolean
	extraJson: Record<string, any> | null
	name?: string | null
	/**
	 * The condition, in the row's own spelling: comma-joined keys and a mode
	 * *name*. Optional because an entry-shaped object in a test may predate
	 * either column, and an absent condition is what every row that has never
	 * been given one holds. See `exportedCondition`.
	 */
	secondaryKeys?: string | null
	selectiveLogic?: string | null
	/**
	 * The declared half, read by name.
	 *
	 * ⚠ An index signature is why a `LorebookEntry` needs a cast to reach here:
	 * TypeScript does not give an interface an implicit index signature, so the
	 * branded row satisfies this structurally and not nominally. The cast is at
	 * the one production call site and says so.
	 */
	[field: string]: unknown
}

/**
 * Escapes every *unescaped* `/` in a stored pattern so the delimited form can
 * be parsed back out of it. Walks the string rather than a blanket
 * `replace(/\//g, "\\/")`: a pattern that already spells the delimiter `\/`
 * (perfectly legal, and what a re-imported key looks like — parseDelimitedRegexKey
 * returns the body verbatim, escapes included) would otherwise become `\\/`,
 * which is a literal backslash followed by a slash, not a slash. Consuming
 * backslash pairs is also what keeps `\\/` — an escaped backslash before a
 * *real* delimiter — from being mistaken for an already-escaped one.
 */
function escapeRegexDelimiters(pattern: string): string {
	let out = ""
	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i]
		if (ch === "\\") {
			// The backslash and whatever it escapes travel together, untouched.
			out += pattern.slice(i, i + 2)
			i++
		} else if (ch === "/") {
			out += "\\/"
		} else {
			out += ch
		}
	}
	return out
}

/**
 * A stored bare pattern in SillyTavern's `/pattern/flags` key form — the only
 * shape either scanner reads as a regex.
 *
 * Serene Pub's UI is a plain "Use Regex" toggle over a plain key field, so its
 * regex keys are stored bare (`a.b`). Both SillyTavern's `matchKeys` and (since
 * the `use_regex` flag proved worthless — every entry SillyTavern exports
 * carries it) Serene Pub's own importer decide regex-ness from the key's shape,
 * so a bare pattern is read as a literal by both. Exporting it delimited is
 * what makes a native regex entry survive its own round trip, and what finally
 * makes it work in SillyTavern.
 *
 * The flag: `i` exactly when the entry is not case-sensitive, nothing else.
 * Serene Pub has no flags column, so there is no `m`/`s`/`u` to emit, and `i`
 * is not a guess — it is the faithful translation of what Serene Pub does. Its
 * scanner (ranking/signals.ts) implements case-insensitivity by lowercasing
 * both the key and the text and compiling with `new RegExp(k)`, no flags;
 * SillyTavern lowercases only the *haystack* and, for a regex key, ignores
 * `case_sensitive` entirely ("if the needle is a regex ... override all the
 * other options"), so without the flag an exported `Alice` would be tested
 * against lowercased text and silently never fire there. Emitting `i` costs
 * nothing on the way back in — parseDelimitedRegexKey returns the body only —
 * so a Serene Pub row round-trips to itself either way; the flag is purely
 * what makes the file mean the same thing to a foreign reader.
 *
 * A pattern that does not compile is left bare. parseDelimitedRegexKey refuses
 * to parse one (as does SillyTavern), so delimiting it would only bake the
 * `/…/i` into the key text on re-import; bare, at least the user's key text
 * comes back as they typed it.
 */
export function toDelimitedRegexKey(
	pattern: string,
	caseSensitive: boolean
): string {
	const flags = caseSensitive ? "" : "i"
	const escaped = escapeRegexDelimiters(pattern)
	try {
		new RegExp(escaped, flags)
	} catch {
		return pattern
	}
	return `/${escaped}/${flags}`
}

/** A stored comma-joined key list, back to the array the wire carries. */
const splitStoredKeys = (keys: string | null | undefined): string[] =>
	(keys ?? "")
		.split(",")
		.map((k) => k.trim())
		.filter(Boolean)

/**
 * SillyTavern's integer for each mode — `SELECTIVE_LOGIC_BY_ST_CODE` inverted,
 * never restated. That table is the one place the enum's order is written down
 * (`AND_ANY = 0, NOT_ALL = 1, NOT_ANY = 2, AND_ALL = 3`, which is not the order
 * anybody guesses), and a second literal here would be a second thing to get
 * wrong in the opposite direction — an export mapping `notAll` to 3 inverts
 * exactly the books the importer gets right.
 */
const ST_CODE_BY_SELECTIVE_LOGIC: Readonly<Record<string, number>> =
	Object.fromEntries(
		Object.entries(SELECTIVE_LOGIC_BY_ST_CODE).map(([code, mode]) => [
			mode,
			Number(code)
		])
	)

interface ExportedCondition {
	/** The condition keys, delimited on a regex entry exactly as `keys` are. */
	keys: string[]
	/** ST's integer for the row's mode — absent when there is no condition. */
	logicCode?: number
}

/**
 * The entry's condition, as the wire spells it.
 *
 * **Keys and mode travel together or not at all.** A mode with no keys is a
 * rule about nothing — `selectiveLogicHolds` reads it as no condition — and
 * writing one would put SillyTavern's own `selectiveLogic`-on-every-entry noise
 * back into the file, which is precisely what the importer refuses to read. So
 * a row holding a mode and no keys exports as an entry with no condition, and
 * re-imports as the same thing it already behaved as.
 *
 * Condition keys are delimited for a regex entry for the same reason the
 * primary keys are: both scanners decide regex-ness from a key's shape, and
 * `selectiveLogicHolds` tests a condition key through the very same
 * `matchesKey`. A bare pattern written bare would be read back as a literal.
 */
function exportedCondition(entry: ExportableEntry): ExportedCondition {
	const useRegex = entry.useRegex ?? false
	const keys = splitStoredKeys(entry.secondaryKeys).map((k) =>
		useRegex ? toDelimitedRegexKey(k, entry.caseSensitive) : k
	)
	const mode = entry.selectiveLogic
	if (keys.length === 0 || !isSelectiveLogic(mode)) return { keys }
	return { keys, logicCode: ST_CODE_BY_SELECTIVE_LOGIC[mode] }
}

function baseEntryFields(
	entry: ExportableEntry,
	insertionOrder: number,
	condition: ExportedCondition
) {
	const useRegex = entry.useRegex ?? false
	const keys = splitStoredKeys(entry.keys)
	return {
		// A regex entry's keys go out delimited so both scanners read them as
		// patterns; a literal entry's keys are its keys. Note the pre-existing
		// comma split above: a pattern containing `,` (`a{1,3}`) was already
		// torn in two by Serene Pub's comma-joined key storage, and still is —
		// each fragment simply goes out delimited now.
		keys: useRegex
			? keys.map((k) => toDelimitedRegexKey(k, entry.caseSensitive))
			: keys,
		content: entry.content,
		enabled: entry.enabled,
		insertion_order: insertionOrder,
		case_sensitive: entry.caseSensitive,
		use_regex: useRegex,
		constant: entry.constant,
		// Both keys omitted entirely for an entry with no condition — which is
		// every entry of every book written before conditions existed, so
		// their exports stay byte-for-byte what they were and a re-import of
		// an older file still reports "unchanged" rather than "conflict".
		//
		// `selective` is SillyTavern's gate on the condition and rides with the
		// mode, never with the keys alone: keys with no mode are keys nothing
		// reads, here and there alike.
		...(condition.keys.length
			? {
					secondary_keys: condition.keys,
					...(condition.logicCode !== undefined
						? { selective: true }
						: {})
				}
			: {}),
		id: entry.id
	}
}

/**
 * Extras that only exist inside one exported document.
 *
 * `bindingLocalId` and `localId` are **document-local ids**, deliberately not
 * this install's primary keys: an exported file must not leak or collide with
 * them. Scenes nest under their owning entry.
 */
export interface EntryExportRefs {
	localId?: number
	bindingLocalId?: number | null
	scenes?: ExportedScene[]
	/**
	 * This entry's id in the document's **entry** space — its own numbering,
	 * like the dated entries' `localId`. An edge endpoint of kind `entry` and
	 * another entry's `anchorEntryLocalId` are the only things that read it, so
	 * an entry nothing points at is given none. See `assignEntryLocalIds`.
	 */
	entryLocalId?: number
	/** The `parent` role — the entry this one is filed under, in that space. */
	anchorEntryLocalId?: number
}

export interface ExportedScene {
	localId: number
	name: string | null
	summary: string | null
	// localIds into the export's bindings[] array, not raw DB ids (see the
	// merge plan — these used to be name strings, matched by name on
	// import; now they're direct binding references, translated the same
	// way bindingLocalId is elsewhere in this format).
	participantCharacters: number[]
	mentionedCharacters: number[]
}

/**
 * One entry as a spec V3 entry, with the type deciding what travels where.
 *
 * Three mappers where there is now one, and the differences are the
 * declaration's:
 *
 *  · **a `title` role** puts the title in the spec's own `name` and `comment`.
 *    History declares none, because it is dated rather than named.
 *  · **a `priority` role** puts the tier in the spec's own `priority`.
 *  · **every other declared field** rides in the `serenepub` bag under its own
 *    name, so the importer reads it back under that name.
 *
 * The **condition** is not a declared field and belongs to no type in
 * particular — every type carries it, so it goes out under the spec's own
 * `secondary_keys`/`selective` plus SillyTavern's `extensions.selectiveLogic`,
 * which is where both scanners look. See `exportedCondition`.
 *
 * ⚠ **An `order` key always travels, whole, including its nulls.** Everything
 * else in the bag is omitted when it has no value. The asymmetry is the point:
 * the order keys are what put a row back in its place on re-import, and a
 * partially-dated entry (a year with no month) has to come back partially
 * dated rather than as a year that lost its precision. A field with no value is
 * a field the row does not have — which is exactly what `fields` jsonb stores,
 * and reproducing it here is what keeps a re-export byte-identical.
 */
export function mapEntry(
	entry: ExportableEntry,
	insertionOrder: number,
	refs: EntryExportRefs = {}
): SpecV3Entry {
	const decl = entryDeclaration(entry.typeId)
	const titleRole = decl?.roles.title
	const priorityRole = decl?.roles.priority
	const orderFields = new Set((decl?.roles.order ?? []).map((k) => k.field))

	const row = entry as Record<string, unknown>
	const condition = exportedCondition(entry)

	// The foreign bag, with the one key the row is now authoritative for
	// re-derived from the row.
	//
	// ⚠ **A stale `selectiveLogic` has to be overwritten, and sometimes
	// removed.** An imported SillyTavern entry keeps its whole `extensions`
	// bag verbatim in `extraJson`, integer and all, so an author who changes
	// the mode — or clears it while keeping the keys — would otherwise export
	// the *old* integer beside the new keys and have the importer read it
	// straight back, silently undoing the edit. Only an entry with condition
	// keys is touched: with no keys the importer refuses to read a mode at
	// all, so a stale integer there is inert and the bag is left exactly as
	// the file it came from wrote it.
	const foreign: Record<string, any> = { ...(entry.extraJson ?? {}) }
	if (condition.keys.length) {
		if (condition.logicCode !== undefined)
			foreign.selectiveLogic = condition.logicCode
		else delete foreign.selectiveLogic
	}

	const bag: Record<string, any> = {}
	for (const field of declaredFields(entry.typeId)) {
		if (field === priorityRole) continue
		const value = row[field]
		if (orderFields.has(field)) bag[field] = value ?? null
		else if (value !== undefined && value !== null && value !== "")
			bag[field] = value
	}

	return {
		...baseEntryFields(entry, insertionOrder, condition),
		...(titleRole
			? {
					name: (entry.name ?? "") as string,
					comment: (entry.name ?? "") as string
				}
			: {}),
		...(priorityRole ? { priority: row[priorityRole] as number } : {}),
		extensions: {
			...foreign,
			serenepub: {
				entryType:
					ENTRY_EXPORT_KEY[entry.typeId as EntryTypeId] ??
					ENTRY_EXPORT_KEY[WORLD_LORE_TYPE_ID],
				...(refs.localId !== undefined
					? { localId: refs.localId }
					: {}),
				...(refs.entryLocalId !== undefined
					? { entryLocalId: refs.entryLocalId }
					: {}),
				...(refs.anchorEntryLocalId !== undefined
					? { anchorEntryLocalId: refs.anchorEntryLocalId }
					: {}),
				...bag,
				...(refs.bindingLocalId != null
					? { bindingLocalId: refs.bindingLocalId }
					: {}),
				...(refs.scenes?.length ? { scenes: refs.scenes } : {})
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

/** An entry as the export reads it: the row, plus the slot it sits in. */
export type ExportableEntryWithPosition = ExportableEntry & {
	position: number
}

/**
 * Assigns each dated entry a synthetic, per-export sequential localId (1-based,
 * ordered by position) — the single source of truth for that numbering, so
 * `buildSpecV3Lorebook` and a caller building narrativeGraph references always
 * agree on the same ids without duplicating the sort-and-index logic.
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
 * Numbers the entries the document points at, 1-based, in the entries' own
 * order.
 *
 * Two things point at an entry: another entry's `anchorEntryId` (the `parent`
 * role, read off the rows themselves) and an edge endpoint of kind `entry`
 * (`edgeEntryIds`, which only the caller holding the relationships knows). An
 * entry neither names is given no id at all, so a book with no nesting and no
 * entry edges exports exactly the bytes it did before entry endpoints existed
 * — which is what lets its own re-import still report "unchanged".
 *
 * The numbering is its own space, deliberately separate from the document
 * counter that numbers bindings, scenes and nodes: an `{ kind: "entry" }`
 * endpoint and an `anchorEntryLocalId` both read this one, and nothing reads
 * both spaces at once.
 */
export function assignEntryLocalIds(
	entries: ExportableEntryWithPosition[],
	edgeEntryIds: Iterable<number> = []
): Map<number, number> {
	const referenced = new Set<number>(edgeEntryIds)
	for (const entry of entries) {
		const anchorEntryId = entry.anchorEntryId as number | null | undefined
		if (anchorEntryId != null) referenced.add(anchorEntryId)
	}

	const map = new Map<number, number>()
	let next = 1
	for (const entry of entries)
		if (referenced.has(entry.id)) map.set(entry.id, next++)
	return map
}

/**
 * Assembles the base spec-compliant shape from a lorebook's entries.
 *
 * One list in, grouped by declared type in the order the tabs read — world,
 * then character, then history — and ordered by `position` within each group.
 * That grouping *is* the `insertion_order` numbering, which is why it is stated
 * rather than left to the caller: a flat list in a different order would
 * renumber every entry in the file.
 *
 * Deliberately entries-only — bound characters/personas/bindings and the
 * narrative graph layer additional `extensions.serenepub` keys onto this
 * function's output rather than being handled here, so it stays usable alone.
 *
 * Every map defaults to empty: a caller that does not resolve bindings,
 * scenes, graph refs or entry references can omit them, and dated entries still
 * get correct, stable localIds from the same sequential fallback
 * `assignHistoryEntryLocalIds` would produce.
 *
 * ⚠ Two entry-keyed maps, two spaces: `historyEntryLocalIdByRealId` numbers
 * the dated entries for the graph's `historyEntryLocalId`, and
 * `entryLocalIdByRealId` numbers whichever entries the document points at for
 * its anchors and entry endpoints. An entry can appear in both under different
 * numbers; each key names the space it reads.
 */
export function buildSpecV3Lorebook(
	lorebook: LorebookLike,
	entries: ExportableEntryWithPosition[],
	bindingLocalIdByRealId: Map<number, number> = new Map(),
	scenesByEntryId: Map<number, ExportedScene[]> = new Map(),
	historyEntryLocalIdByRealId: Map<number, number> = new Map(),
	entryLocalIdByRealId: Map<number, number> = new Map()
): SpecV3LorebookLike {
	const specEntries: SpecV3Entry[] = []
	let insertionOrder = 0

	for (const typeId of ENTRY_TYPE_IDS) {
		const decl = entryDeclaration(typeId)
		const group = entries
			.filter((e) => e.typeId === typeId)
			.sort((a, b) => a.position - b.position)

		group.forEach((entry, i) => {
			const refs: EntryExportRefs = {}
			// ⚠ Two cross-references, and each belongs to whoever reads it.
			// `localId` numbers the dated type alone, for `narrativeGraph`'s
			// `historyEntryLocalId` and the scenes that nest under their entry;
			// the `order` role is what says which type that is.
			// `entryLocalId` numbers entries of any type, for the anchors and
			// entry endpoints that name them.
			//
			// Neither is the real DB `id`: an exported document must never leak
			// or collide with this install's primary keys. `entry.id` below is
			// only a lookup key into the caller's maps, which are naturally
			// keyed by real ids.
			if (decl?.roles.order)
				refs.localId =
					historyEntryLocalIdByRealId.get(entry.id) ?? i + 1
			refs.entryLocalId = entryLocalIdByRealId.get(entry.id)
			const anchorEntryId = entry.anchorEntryId as
				| number
				| null
				| undefined
			if (anchorEntryId != null)
				refs.anchorEntryLocalId =
					entryLocalIdByRealId.get(anchorEntryId)
			if (decl?.roles.anchor) {
				const bindingId = entry.lorebookBindingId as number | null
				refs.bindingLocalId =
					bindingId != null
						? (bindingLocalIdByRealId.get(bindingId) ?? null)
						: null
			}
			const scenes = scenesByEntryId.get(entry.id)
			if (scenes?.length) refs.scenes = scenes

			specEntries.push(mapEntry(entry, insertionOrder++, refs))
		})
	}

	return {
		name: lorebook.name,
		description: lorebook.description,
		scan_depth: lorebook.extraJson?.scanDepth,
		token_budget: lorebook.extraJson?.tokenBudget,
		recursive_scanning: lorebook.extraJson?.recursiveScanning,
		extensions: { serenepub: { version: 1, uuid: lorebook.uuid } },
		entries: specEntries
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
		participantCharacters: number[]
		mentionedCharacters: number[]
	},
	localId: number,
	bindingLocalIdByRealId: Map<number, number>
): ExportedScene {
	const toLocalIds = (ids: number[]) =>
		ids
			.map((id) => bindingLocalIdByRealId.get(id))
			.filter((id): id is number => id !== undefined)
	return {
		localId,
		name: scene.name,
		summary: scene.summary,
		participantCharacters: toLocalIds(scene.participantCharacters ?? []),
		mentionedCharacters: toLocalIds(scene.mentionedCharacters ?? [])
	}
}

export interface ExportedNarrativeNode {
	localId: number
	name: string
	nodeState: string
	nodeVisibility: string
	aliases: string[]
	// Identity names folded in via a completed graph "Absorb" merge — kept
	// separate from `aliases` (see lorebookBindings.absorbedAliases) and,
	// unlike aliases, never entity-synced even for a character/persona-linked
	// binding, so it must always round-trip regardless of link status.
	absorbedAliases: string[]
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
	// Post-merge (see the lorebookBindings/narrativeNodes merge plan): a
	// node's own id doubles as its binding id — this row IS the binding —
	// so bindingLocalId resolves via the node's own id, not a separate FK
	// field like the old lorebookBindingId.
	id: number
	name: string
	nodeState: string
	nodeVisibility: string
	aliases: string[]
	absorbedAliases: string[]
	summary: string | null
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
		absorbedAliases: node.absorbedAliases,
		summary: node.summary,
		bindingLocalId: bindingLocalIdByRealId.get(node.id) ?? null,
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

/**
 * One end of an edge, naming which kind of thing it is: a cast binding's node
 * local id, or an entry's entry local id. A road between two places is an edge
 * whose two ends are entries.
 */
export type ExportedEndpoint =
	| { kind: "cast"; node: number }
	| { kind: "entry"; entry: number }

export interface ExportedNarrativeRelationship {
	from: ExportedEndpoint
	to: ExportedEndpoint
	/**
	 * The flat cast spelling, written for a cast endpoint beside the kinded
	 * one so an importer that reads only these still gets the cast graph. An
	 * entry endpoint has no flat spelling, so such an importer skips the whole
	 * row rather than reading half of it.
	 */
	fromLocalId?: number
	toLocalId?: number
	relationshipType: string
	description: string
	visibility: string
	status: string
	reason: string | null
	historyEntryLocalId: number | null
	sceneLocalId: number | null
}

interface NarrativeRelationshipLike {
	fromNodeId: number | null
	toNodeId: number | null
	fromEntryId: number | null
	toEntryId: number | null
	relationshipType: string
	description: string
	visibility: string
	status: string
	reason: string | null
	historyEntryId: number | null
	sceneId: number | null
}

/** One endpoint as the file addresses it, or null when this export has no id for it. */
function exportedEndpoint(
	nodeId: number | null,
	entryId: number | null,
	nodeLocalIdByRealId: Map<number, number>,
	entryLocalIdByRealId: Map<number, number>
): ExportedEndpoint | null {
	if (nodeId !== null) {
		const node = nodeLocalIdByRealId.get(nodeId)
		return node === undefined ? null : { kind: "cast", node }
	}
	if (entryId !== null) {
		const entry = entryLocalIdByRealId.get(entryId)
		return entry === undefined ? null : { kind: "entry", entry }
	}
	return null
}

export function mapNarrativeRelationship(
	rel: NarrativeRelationshipLike,
	nodeLocalIdByRealId: Map<number, number>,
	historyEntryLocalIdByRealId: Map<number, number>,
	sceneLocalIdByRealId: Map<number, number>,
	entryLocalIdByRealId: Map<number, number> = new Map()
): ExportedNarrativeRelationship | null {
	const from = exportedEndpoint(
		rel.fromNodeId,
		rel.fromEntryId,
		nodeLocalIdByRealId,
		entryLocalIdByRealId
	)
	const to = exportedEndpoint(
		rel.toNodeId,
		rel.toEntryId,
		nodeLocalIdByRealId,
		entryLocalIdByRealId
	)
	// Both endpoints must resolve — a relationship pointing at a node or entry
	// this export didn't include can't be represented.
	if (from === null || to === null) return null

	return {
		from,
		to,
		...(from.kind === "cast" ? { fromLocalId: from.node } : {}),
		...(to.kind === "cast" ? { toLocalId: to.node } : {}),
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
