import { describe, expect, test } from "vitest"
import {
	mapWorldEntry,
	mapCharacterEntry,
	mapHistoryEntry,
	buildSpecV3Lorebook,
	assignHistoryEntryLocalIds,
	mapSceneForExport,
	mapNarrativeNode,
	mapNarrativeRelationship,
	attachNarrativeGraph,
	type SpecV3LorebookLike
} from "./lorebookExportMapper"

const baseEntry = {
	id: 1,
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

describe("mapWorldEntry", () => {
	test("maps a full entry, splitting keys back into an array", () => {
		const mapped = mapWorldEntry({ ...baseEntry, category: "Locations" }, 0)
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
			extensions: { serenepub: { entryType: "world", category: "Locations" } }
		})
	})

	test("omits category from extensions when null", () => {
		const mapped = mapWorldEntry({ ...baseEntry, category: null }, 0)
		expect(mapped.extensions).toEqual({ serenepub: { entryType: "world" } })
	})

	test("preserves foreign extraJson alongside serenepub, not replaced by it", () => {
		const mapped = mapWorldEntry(
			{ ...baseEntry, category: null, extraJson: { probability: 80 } },
			0
		)
		expect(mapped.extensions).toEqual({
			probability: 80,
			serenepub: { entryType: "world" }
		})
	})

	test("defaults use_regex to false when the DB column is null", () => {
		const mapped = mapWorldEntry({ ...baseEntry, category: null, useRegex: null }, 0)
		expect(mapped.use_regex).toBe(false)
	})
})

describe("mapCharacterEntry", () => {
	test("includes bindingLocalId when resolved", () => {
		const mapped = mapCharacterEntry(baseEntry, 0, 5)
		expect(mapped.extensions).toEqual({
			serenepub: { entryType: "character", bindingLocalId: 5 }
		})
	})

	test("omits bindingLocalId when null (unbound entry)", () => {
		const mapped = mapCharacterEntry(baseEntry, 0, null)
		expect(mapped.extensions).toEqual({ serenepub: { entryType: "character" } })
	})
})

describe("mapHistoryEntry", () => {
	const historyEntry = {
		...baseEntry,
		year: 5,
		month: 3,
		day: null,
		isCompleted: true,
		graphed: false
	}

	test("maps history-specific fields under serenepub", () => {
		const mapped = mapHistoryEntry(historyEntry, 0, 1, [])
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
				participantCharacters: ["Aria"],
				mentionedCharacters: []
			}
		]
		const mapped = mapHistoryEntry(historyEntry, 0, 1, scenes)
		expect(mapped.extensions.serenepub.scenes).toEqual(scenes)
	})

	test("omits scenes key entirely when there are none", () => {
		const mapped = mapHistoryEntry(historyEntry, 0, 1, [])
		expect(mapped.extensions.serenepub.scenes).toBeUndefined()
	})
})

describe("buildSpecV3Lorebook", () => {
	test("concatenates world, character, then history entries with renumbered insertion_order", () => {
		const book = buildSpecV3Lorebook(
			{ name: "My Book", description: "A book", uuid: "abc-123", extraJson: {} },
			[{ ...baseEntry, id: 1, category: null, position: 0 }],
			[{ ...baseEntry, id: 2, position: 0, lorebookBindingId: null }],
			[
				{
					...baseEntry,
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
		expect(book.entries.map((e) => e.extensions.serenepub.entryType)).toEqual([
			"world",
			"character",
			"history"
		])
		expect(book.entries.map((e) => e.insertion_order)).toEqual([0, 1, 2])
	})

	test("resolves character-entry bindingLocalId via the provided map", () => {
		const book = buildSpecV3Lorebook(
			{ name: "Book", description: "", uuid: "u1", extraJson: {} },
			[],
			[{ ...baseEntry, id: 2, position: 0, lorebookBindingId: 42 }],
			[],
			new Map([[42, 7]])
		)
		expect(book.entries[0].extensions.serenepub.bindingLocalId).toBe(7)
	})

	test("assigns history entries a synthetic sequential localId, not the real DB id", () => {
		const book = buildSpecV3Lorebook(
			{ name: "Book", description: "", uuid: "u1", extraJson: {} },
			[],
			[],
			[
				{
					...baseEntry,
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
			[],
			[],
			[]
		)
		expect(book.extensions).toEqual({ serenepub: { version: 1, uuid: "the-uuid" } })
	})

	test("restores scan_depth/token_budget/recursive_scanning from lorebook.extraJson", () => {
		const book = buildSpecV3Lorebook(
			{
				name: "Book",
				description: "",
				uuid: "u1",
				extraJson: { scanDepth: 15, tokenBudget: 500, recursiveScanning: true }
			},
			[],
			[],
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
	test("maps scene fields with the given localId", () => {
		const mapped = mapSceneForExport(
			{
				name: "Scene A",
				summary: "Something happened",
				participantCharacters: ["Aria"],
				mentionedCharacters: ["Kael"]
			},
			7
		)
		expect(mapped).toEqual({
			localId: 7,
			name: "Scene A",
			summary: "Something happened",
			participantCharacters: ["Aria"],
			mentionedCharacters: ["Kael"]
		})
	})
})

const baseNode = {
	name: "Aria",
	nodeState: "active",
	nodeVisibility: "normal",
	aliases: [],
	summary: null,
	lorebookBindingId: null,
	parentNodeId: null,
	historyEntryId: null,
	sceneId: null
}

describe("mapNarrativeNode", () => {
	test("resolves bindingLocalId/parentLocalId/historyEntryLocalId/sceneLocalId via the provided maps", () => {
		const mapped = mapNarrativeNode(
			{ ...baseNode, lorebookBindingId: 10, parentNodeId: 20, historyEntryId: 30, sceneId: 40 },
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
		const node = mapNarrativeNode(baseNode, 1, [], new Map(), new Map(), new Map(), new Map())
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
