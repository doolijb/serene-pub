import { describe, expect, test } from "vitest"
import {
	mapEntry,
	buildSpecV3Lorebook,
	assignHistoryEntryLocalIds,
	mapSceneForExport,
	mapNarrativeNode,
	mapNarrativeRelationship,
	attachNarrativeGraph,
	type SpecV3LorebookLike
} from "./lorebookExportMapper"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

const baseEntry = {
	id: 1,
	typeId: WORLD_LORE_TYPE_ID as string,
	name: "Entry Name",
	content: "Some content",
	keys: "alpha, beta",
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: true,
	priority: 2,
	extraJson: {}
}

describe("mapEntry — world lore", () => {
	test("maps a full entry, splitting keys back into an array", () => {
		const mapped = mapEntry({ ...baseEntry, category: "Locations" }, 0)
		expect(mapped).toEqual({
			keys: ["alpha", "beta"],
			content: "Some content",
			enabled: true,
			insertion_order: 0,
			case_sensitive: true,
			use_regex: false,
			constant: false,
			name: "Entry Name",
			comment: "Entry Name",
			priority: 2,
			id: 1,
			extensions: {
				serenepub: { entryType: "world", category: "Locations" }
			}
		})
	})

	test("omits category from extensions when null", () => {
		const mapped = mapEntry({ ...baseEntry, category: null }, 0)
		expect(mapped.extensions).toEqual({ serenepub: { entryType: "world" } })
	})

	test("preserves foreign extraJson alongside serenepub, not replaced by it", () => {
		const mapped = mapEntry(
			{ ...baseEntry, category: null, extraJson: { probability: 80 } },
			0
		)
		expect(mapped.extensions).toEqual({
			probability: 80,
			serenepub: { entryType: "world" }
		})
	})

	test("defaults use_regex to false when the DB column is null", () => {
		const mapped = mapEntry(
			{ ...baseEntry, category: null, useRegex: null },
			0
		)
		expect(mapped.use_regex).toBe(false)
	})
})

describe("mapEntry — the condition", () => {
	const condition = (overrides: Record<string, any> = {}) => ({
		...baseEntry,
		category: null,
		secondaryKeys: "statue, mural",
		selectiveLogic: "notAll",
		...overrides
	})

	// ⚠ `AND_ANY = 0, NOT_ALL = 1, NOT_ANY = 2, AND_ALL = 3`. 1 and 3 are not
	// the pair anybody guesses, and an export that mapped `notAll` to 3 would
	// invert exactly the books the importer gets right — so both directions
	// are pinned here against the one table.
	test("writes the spec's keys, the selective gate, and ST's integer", () => {
		const mapped = mapEntry(condition(), 0)
		expect(mapped.secondary_keys).toEqual(["statue", "mural"])
		expect(mapped.selective).toBe(true)
		expect(mapped.extensions.selectiveLogic).toBe(1)

		expect(
			mapEntry(condition({ selectiveLogic: "andAll" }), 0).extensions
				.selectiveLogic
		).toBe(3)
		expect(
			mapEntry(condition({ selectiveLogic: "andAny" }), 0).extensions
				.selectiveLogic
		).toBe(0)
		expect(
			mapEntry(condition({ selectiveLogic: "notAny" }), 0).extensions
				.selectiveLogic
		).toBe(2)
	})

	test("an entry with no condition writes none of the three keys", () => {
		// Every book written before conditions existed exports byte-for-byte
		// what it exported before, so re-importing an older file still reports
		// "unchanged" rather than "conflict".
		const mapped = mapEntry(
			condition({ secondaryKeys: "", selectiveLogic: null }),
			0
		)
		expect("secondary_keys" in mapped).toBe(false)
		expect("selective" in mapped).toBe(false)
		expect(mapped.extensions).toEqual({
			serenepub: { entryType: "world" }
		})
	})

	test("a mode with no keys is a rule about nothing, and is not written", () => {
		const mapped = mapEntry(condition({ secondaryKeys: "" }), 0)
		expect("secondary_keys" in mapped).toBe(false)
		expect("selective" in mapped).toBe(false)
		expect(mapped.extensions.selectiveLogic).toBeUndefined()
	})

	test("keys with no mode travel, ungated", () => {
		const mapped = mapEntry(condition({ selectiveLogic: null }), 0)
		expect(mapped.secondary_keys).toEqual(["statue", "mural"])
		// No `selective`: SillyTavern gates its condition on that flag, and
		// with no mode there is no condition to gate.
		expect("selective" in mapped).toBe(false)
		expect(mapped.extensions.selectiveLogic).toBeUndefined()
	})

	test("the row's mode overrides a stale one in the preserved foreign bag", () => {
		// An imported SillyTavern entry keeps its whole extensions bag verbatim
		// in extraJson, integer and all. Spreading it unmodified would export
		// the mode the file arrived with rather than the one the author now
		// has, and the importer would read it straight back.
		const mapped = mapEntry(
			condition({
				selectiveLogic: "notAny",
				extraJson: { selectiveLogic: 0, probability: 80 }
			}),
			0
		)
		expect(mapped.extensions).toEqual({
			selectiveLogic: 2,
			probability: 80,
			serenepub: { entryType: "world" }
		})
	})

	test("a cleared mode removes the stale integer rather than resurrecting it", () => {
		const mapped = mapEntry(
			condition({
				selectiveLogic: null,
				extraJson: { selectiveLogic: 2, probability: 80 }
			}),
			0
		)
		expect(mapped.extensions).toEqual({
			probability: 80,
			serenepub: { entryType: "world" }
		})
	})

	test("leaves the foreign bag alone when the entry has no condition keys", () => {
		// With no keys the importer refuses to read a mode at all, so a stale
		// integer there is inert — and rewriting the bag would change the bytes
		// of every SillyTavern book ever imported, since ST stamps
		// `selectiveLogic` onto every entry it writes.
		const mapped = mapEntry(
			condition({
				secondaryKeys: "",
				selectiveLogic: null,
				extraJson: { selectiveLogic: 0, probability: 80 }
			}),
			0
		)
		expect(mapped.extensions).toEqual({
			selectiveLogic: 0,
			probability: 80,
			serenepub: { entryType: "world" }
		})
	})

	test("a regex entry's condition keys go out delimited, like its own keys", () => {
		const mapped = mapEntry(
			condition({
				keys: "dra.on",
				secondaryKeys: "stat.e",
				useRegex: true,
				caseSensitive: false
			}),
			0
		)
		expect(mapped.keys).toEqual(["/dra.on/i"])
		expect(mapped.secondary_keys).toEqual(["/stat.e/i"])
	})

	test("ignores a mode name that is not one of the four", () => {
		// A bad row does not take an export down; it exports as no condition,
		// which is how it already behaves (selectiveLogicHolds ignores it).
		const mapped = mapEntry(condition({ selectiveLogic: "xorSome" }), 0)
		expect(mapped.secondary_keys).toEqual(["statue", "mural"])
		expect("selective" in mapped).toBe(false)
		expect(mapped.extensions.selectiveLogic).toBeUndefined()
	})
})

describe("mapEntry — character lore", () => {
	test("includes bindingLocalId when resolved", () => {
		const mapped = mapEntry(
			{ ...baseEntry, typeId: CHARACTER_LORE_TYPE_ID },
			0,
			{ bindingLocalId: 5 }
		)
		expect(mapped.extensions).toEqual({
			serenepub: { entryType: "character", bindingLocalId: 5 }
		})
	})

	test("omits bindingLocalId when null (unbound entry)", () => {
		const mapped = mapEntry(
			{ ...baseEntry, typeId: CHARACTER_LORE_TYPE_ID },
			0,
			{ bindingLocalId: null }
		)
		expect(mapped.extensions).toEqual({
			serenepub: { entryType: "character" }
		})
	})
})

describe("mapEntry — history", () => {
	const historyEntry = {
		...baseEntry,
		typeId: HISTORY_TYPE_ID,
		year: 5,
		month: 3,
		day: null,
		isCompleted: true,
		graphed: false
	}

	test("maps history-specific fields under serenepub", () => {
		const mapped = mapEntry(historyEntry, 0, { localId: 1 })
		expect(mapped.extensions.serenepub).toEqual({
			entryType: "history",
			localId: 1,
			year: 5,
			month: 3,
			day: null,
			isCompleted: true,
			graphed: false
		})
	})

	test("nests scenes under the history entry when present", () => {
		const scenes = [
			{
				localId: 9,
				name: "Scene A",
				summary: "Something happened",
				participantCharacters: [1],
				mentionedCharacters: []
			}
		]
		const mapped = mapEntry(historyEntry, 0, { localId: 1, scenes })
		expect(mapped.extensions.serenepub.scenes).toEqual(scenes)
	})

	test("omits scenes key entirely when there are none", () => {
		const mapped = mapEntry(historyEntry, 0, { localId: 1, scenes: [] })
		expect(mapped.extensions.serenepub.scenes).toBeUndefined()
	})
})

describe("buildSpecV3Lorebook", () => {
	test("concatenates world, character, then history entries with renumbered insertion_order", () => {
		const book = buildSpecV3Lorebook(
			{
				name: "My Book",
				description: "A book",
				uuid: "abc-123",
				extraJson: {}
			},
			[
				{ ...baseEntry, id: 1, category: null, position: 0 },
				{
					...baseEntry,
					typeId: CHARACTER_LORE_TYPE_ID,
					id: 2,
					position: 0,
					lorebookBindingId: null
				},
				{
					...baseEntry,
					typeId: HISTORY_TYPE_ID,
					id: 3,
					position: 0,
					year: 1,
					month: null,
					day: null,
					isCompleted: false,
					graphed: false
				}
			]
		)
		expect(
			book.entries.map((e) => e.extensions.serenepub.entryType)
		).toEqual(["world", "character", "history"])
		expect(book.entries.map((e) => e.insertion_order)).toEqual([0, 1, 2])
	})

	test("resolves character-entry bindingLocalId via the provided map", () => {
		const book = buildSpecV3Lorebook(
			{ name: "Book", description: "", uuid: "u1", extraJson: {} },
			[
				{
					...baseEntry,
					typeId: CHARACTER_LORE_TYPE_ID,
					id: 2,
					position: 0,
					lorebookBindingId: 42
				}
			],
			new Map([[42, 7]])
		)
		expect(book.entries[0].extensions.serenepub.bindingLocalId).toBe(7)
	})

	test("assigns history entries a synthetic sequential localId, not the real DB id", () => {
		const book = buildSpecV3Lorebook(
			{ name: "Book", description: "", uuid: "u1", extraJson: {} },
			[
				{
					...baseEntry,
					typeId: HISTORY_TYPE_ID,
					id: 999,
					position: 0,
					year: 1,
					month: null,
					day: null,
					isCompleted: false,
					graphed: false
				}
			]
		)
		expect(book.entries[0].extensions.serenepub.localId).toBe(1)
	})

	test("includes uuid and version in top-level extensions.serenepub", () => {
		const book = buildSpecV3Lorebook(
			{ name: "Book", description: "", uuid: "the-uuid", extraJson: {} },
			[]
		)
		expect(book.extensions).toEqual({
			serenepub: { version: 1, uuid: "the-uuid" }
		})
	})

	test("restores scan_depth/token_budget/recursive_scanning from lorebook.extraJson", () => {
		const book = buildSpecV3Lorebook(
			{
				name: "Book",
				description: "",
				uuid: "u1",
				extraJson: {
					scanDepth: 15,
					tokenBudget: 500,
					recursiveScanning: true
				}
			},
			[]
		)
		expect(book.scan_depth).toBe(15)
		expect(book.token_budget).toBe(500)
		expect(book.recursive_scanning).toBe(true)
	})
})

describe("assignHistoryEntryLocalIds", () => {
	test("assigns sequential 1-based localIds ordered by position, not real id", () => {
		const map = assignHistoryEntryLocalIds([
			{ id: 99, position: 2 },
			{ id: 5, position: 0 },
			{ id: 42, position: 1 }
		])
		expect(map.get(5)).toBe(1)
		expect(map.get(42)).toBe(2)
		expect(map.get(99)).toBe(3)
	})
})

describe("mapSceneForExport", () => {
	test("maps scene fields with the given localId, translating binding ids to their export localIds", () => {
		const mapped = mapSceneForExport(
			{
				name: "Scene A",
				summary: "Something happened",
				participantCharacters: [10],
				mentionedCharacters: [20]
			},
			7,
			new Map([
				[10, 100],
				[20, 200]
			])
		)
		expect(mapped).toEqual({
			localId: 7,
			name: "Scene A",
			summary: "Something happened",
			participantCharacters: [100],
			mentionedCharacters: [200]
		})
	})

	test("drops ids with no matching binding in the map", () => {
		const mapped = mapSceneForExport(
			{
				name: "Scene A",
				summary: null,
				participantCharacters: [10, 999],
				mentionedCharacters: []
			},
			7,
			new Map([[10, 100]])
		)
		expect(mapped.participantCharacters).toEqual([100])
	})
})

const baseNode = {
	id: 999,
	name: "Aria",
	nodeState: "active",
	nodeVisibility: "normal",
	aliases: [],
	absorbedAliases: [],
	summary: null,
	parentNodeId: null,
	historyEntryId: null,
	sceneId: null
}

describe("mapNarrativeNode", () => {
	test("resolves bindingLocalId/parentLocalId/historyEntryLocalId/sceneLocalId via the provided maps", () => {
		const mapped = mapNarrativeNode(
			{
				...baseNode,
				id: 10,
				parentNodeId: 20,
				historyEntryId: 30,
				sceneId: 40
			},
			1,
			["uuid-a"],
			new Map([[10, 100]]),
			new Map([[20, 200]]),
			new Map([[30, 300]]),
			new Map([[40, 400]])
		)
		expect(mapped.bindingLocalId).toBe(100)
		expect(mapped.parentLocalId).toBe(200)
		expect(mapped.historyEntryLocalId).toBe(300)
		expect(mapped.sceneLocalId).toBe(400)
		expect(mapped.characterUuids).toEqual(["uuid-a"])
	})

	test("nulls out references that are themselves null, without a map lookup", () => {
		const mapped = mapNarrativeNode(
			baseNode,
			1,
			[],
			new Map(),
			new Map(),
			new Map(),
			new Map()
		)
		expect(mapped.bindingLocalId).toBeNull()
		expect(mapped.parentLocalId).toBeNull()
		expect(mapped.historyEntryLocalId).toBeNull()
		expect(mapped.sceneLocalId).toBeNull()
	})

	test("passes absorbedAliases through unchanged, independent of characterId/personaId", () => {
		const mapped = mapNarrativeNode(
			{ ...baseNode, absorbedAliases: ["Old Name", "Prior Alias"] },
			1,
			[],
			new Map(),
			new Map(),
			new Map(),
			new Map()
		)
		expect(mapped.absorbedAliases).toEqual(["Old Name", "Prior Alias"])
	})
})

const baseRelationship = {
	fromNodeId: 1,
	toNodeId: 2,
	relationshipType: "ally",
	description: "desc",
	visibility: "acknowledged",
	status: "active",
	reason: null,
	historyEntryId: null,
	sceneId: null
}

describe("mapNarrativeRelationship", () => {
	test("resolves fromLocalId/toLocalId via the node map", () => {
		const mapped = mapNarrativeRelationship(
			baseRelationship,
			new Map([
				[1, 10],
				[2, 20]
			]),
			new Map(),
			new Map()
		)
		expect(mapped).toEqual({
			fromLocalId: 10,
			toLocalId: 20,
			relationshipType: "ally",
			description: "desc",
			visibility: "acknowledged",
			status: "active",
			reason: null,
			historyEntryLocalId: null,
			sceneLocalId: null
		})
	})

	test("returns null when either endpoint doesn't resolve to an exported node", () => {
		const mapped = mapNarrativeRelationship(
			baseRelationship,
			new Map([[1, 10]]), // toNodeId (2) missing
			new Map(),
			new Map()
		)
		expect(mapped).toBeNull()
	})
})

describe("attachNarrativeGraph", () => {
	const emptyBook: SpecV3LorebookLike = {
		name: "Book",
		description: "",
		extensions: { serenepub: { version: 1, uuid: "u1" } },
		entries: []
	}

	test("omits the narrativeGraph key entirely when there's nothing to include", () => {
		const book = attachNarrativeGraph(emptyBook, [], [])
		expect(book.extensions.serenepub.narrativeGraph).toBeUndefined()
	})

	test("attaches versioned nodes/relationships when present", () => {
		const node = mapNarrativeNode(
			baseNode,
			1,
			[],
			new Map(),
			new Map(),
			new Map(),
			new Map()
		)
		const book = attachNarrativeGraph(emptyBook, [node], [])
		expect(book.extensions.serenepub.narrativeGraph).toEqual({
			version: 1,
			nodes: [node],
			relationships: []
		})
		// Preserves existing serenepub keys (uuid/version) rather than replacing them.
		expect(book.extensions.serenepub.uuid).toBe("u1")
	})
})
