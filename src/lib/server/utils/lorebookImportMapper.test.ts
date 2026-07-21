import { describe, expect, test } from "vitest"
import {
	normalizeLorebookEntryPriority,
	mapLorebookEntryToWorldLoreEntry,
	mapLorebookEntryToCharacterLoreEntry,
	mapLorebookEntryToHistoryEntry,
	entryTypeOf,
	hasLorebookEntries,
	normalizeLegacyLorebookData,
	resolveParentNodeLinks
} from "./lorebookImportMapper"

describe("normalizeLorebookEntryPriority", () => {
	test("defaults null/undefined to 1", () => {
		expect(normalizeLorebookEntryPriority(null)).toBe(1)
		expect(normalizeLorebookEntryPriority(undefined)).toBe(1)
	})

	test("clamps values below 1 up to 1", () => {
		expect(normalizeLorebookEntryPriority(0)).toBe(1)
		expect(normalizeLorebookEntryPriority(-5)).toBe(1)
	})

	test("clamps values above 3 down to 3", () => {
		expect(normalizeLorebookEntryPriority(4)).toBe(3)
		expect(normalizeLorebookEntryPriority(100)).toBe(3)
	})

	test("passes through in-range values unchanged", () => {
		expect(normalizeLorebookEntryPriority(1)).toBe(1)
		expect(normalizeLorebookEntryPriority(2)).toBe(2)
		expect(normalizeLorebookEntryPriority(3)).toBe(3)
	})
})

describe("mapLorebookEntryToWorldLoreEntry", () => {
	test("maps a full entry", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{
				keys: ["alpha", "beta"],
				content: "Some lore content",
				enabled: true,
				constant: true,
				name: "Entry Name",
				priority: 2
			},
			3
		)

		expect(mapped).toEqual({
			name: "Entry Name",
			content: "Some lore content",
			position: 3,
			keys: "alpha, beta",
			enabled: true,
			constant: true,
			caseSensitive: false,
			useRegex: false,
			priority: 2,
			category: null,
			extraJson: {}
		})
	})

	test("restores case_sensitive/use_regex from the incoming entry", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: true, case_sensitive: true, use_regex: true },
			0
		)
		expect(mapped.caseSensitive).toBe(true)
		expect(mapped.useRegex).toBe(true)
	})

	test("preserves foreign extension data into extraJson", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{
				keys: [],
				content: "",
				enabled: true,
				extensions: { probability: 80, depth: 4, group: "weather" }
			},
			0
		)
		expect(mapped.extraJson).toEqual({ probability: 80, depth: 4, group: "weather" })
	})

	test("strips a previously-exported serenepub key out of extraJson, restoring category instead", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{
				keys: [],
				content: "",
				enabled: true,
				extensions: {
					probability: 80,
					serenepub: { entryType: "world", category: "Locations" }
				}
			},
			0
		)
		expect(mapped.category).toBe("Locations")
		expect(mapped.extraJson).toEqual({ probability: 80 })
	})

	test("falls back to comment, then 'Imported Entry', when name is missing", () => {
		const withComment = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: true, comment: "A comment" },
			0
		)
		expect(withComment.name).toBe("A comment")

		const withNeither = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: true },
			0
		)
		expect(withNeither.name).toBe("Imported Entry")
	})

	test("joins multiple keys with a comma-space separator", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{ keys: ["one", "two", "three"], content: "", enabled: true },
			0
		)
		expect(mapped.keys).toBe("one, two, three")
	})

	test("defaults enabled to true and constant to false when omitted", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: undefined as unknown as boolean },
			0
		)
		expect(mapped.enabled).toBe(true)
		expect(mapped.constant).toBe(false)
	})

	test("normalizes out-of-range priority", () => {
		const mapped = mapLorebookEntryToWorldLoreEntry(
			{ keys: [], content: "", enabled: true, priority: 99 },
			0
		)
		expect(mapped.priority).toBe(3)
	})
})

describe("entryTypeOf", () => {
	test("defaults to 'world' for entries with no serenepub marker", () => {
		expect(entryTypeOf({ keys: [], content: "", enabled: true })).toBe("world")
	})

	test("defaults to 'world' for an unrecognized entryType value", () => {
		expect(
			entryTypeOf({
				keys: [],
				content: "",
				enabled: true,
				extensions: { serenepub: { entryType: "something-else" } }
			})
		).toBe("world")
	})

	test("routes character and history entries by their serenepub marker", () => {
		expect(
			entryTypeOf({
				keys: [],
				content: "",
				enabled: true,
				extensions: { serenepub: { entryType: "character" } }
			})
		).toBe("character")
		expect(
			entryTypeOf({
				keys: [],
				content: "",
				enabled: true,
				extensions: { serenepub: { entryType: "history" } }
			})
		).toBe("history")
	})
})

describe("mapLorebookEntryToCharacterLoreEntry", () => {
	test("maps shared fields, with no category field (world-only)", () => {
		const mapped = mapLorebookEntryToCharacterLoreEntry(
			{ keys: ["a"], content: "c", enabled: true, name: "N", priority: 2 },
			1
		)
		expect(mapped).toEqual({
			name: "N",
			content: "c",
			position: 1,
			keys: "a",
			enabled: true,
			constant: false,
			caseSensitive: false,
			useRegex: false,
			priority: 2,
			extraJson: {}
		})
	})
})

describe("mapLorebookEntryToHistoryEntry", () => {
	test("maps year/month/day/isCompleted/graphed from extensions.serenepub, with no name/priority field", () => {
		const mapped = mapLorebookEntryToHistoryEntry(
			{
				keys: ["a"],
				content: "c",
				enabled: true,
				extensions: {
					serenepub: { entryType: "history", year: 5, month: 3, day: 12, isCompleted: true, graphed: true }
				}
			},
			2
		)
		expect(mapped).toEqual({
			content: "c",
			position: 2,
			keys: "a",
			enabled: true,
			constant: false,
			caseSensitive: false,
			useRegex: false,
			extraJson: {},
			year: 5,
			month: 3,
			day: 12,
			isCompleted: true,
			graphed: true
		})
	})

	test("defaults year to 1 and month/day to null when missing", () => {
		const mapped = mapLorebookEntryToHistoryEntry(
			{ keys: [], content: "", enabled: true },
			0
		)
		expect(mapped.year).toBe(1)
		expect(mapped.month).toBeNull()
		expect(mapped.day).toBeNull()
	})
})

describe("hasLorebookEntries", () => {
	test("true for a non-empty entries array", () => {
		expect(hasLorebookEntries({ entries: [{ keys: [] }] })).toBe(true)
	})

	test("false for an empty entries array", () => {
		expect(hasLorebookEntries({ entries: [] })).toBe(false)
	})

	test("true for legacy object-keyed-by-index entries", () => {
		expect(hasLorebookEntries({ entries: { "0": {}, "1": {} } })).toBe(true)
	})

	test("false for an empty object-keyed entries value", () => {
		expect(hasLorebookEntries({ entries: {} })).toBe(false)
	})

	test("false for a missing/null book, or a book with no entries key", () => {
		expect(hasLorebookEntries(null)).toBe(false)
		expect(hasLorebookEntries(undefined)).toBe(false)
		expect(hasLorebookEntries({})).toBe(false)
	})
})

describe("normalizeLegacyLorebookData", () => {
	test("converts legacy object-keyed-by-index entries into an array", () => {
		const result = normalizeLegacyLorebookData({
			name: "Book",
			entries: { "0": { keys: ["a"] }, "1": { keys: ["b"] } }
		})
		expect(Array.isArray(result.entries)).toBe(true)
		expect(result.entries).toHaveLength(2)
	})

	test("normalizes a singular string 'key' field into a 'keys' array", () => {
		const result = normalizeLegacyLorebookData({
			entries: [{ key: "trigger", content: "..." }]
		})
		expect(result.entries[0].keys).toEqual(["trigger"])
		expect(result.entries[0].key).toEqual(["trigger"])
	})

	test("prefers an existing 'keys' array over a singular 'key' when both are present", () => {
		const result = normalizeLegacyLorebookData({
			entries: [{ key: "ignored", keys: ["real", "keys"], content: "..." }]
		})
		expect(result.entries[0].keys).toEqual(["real", "keys"])
	})

	test("normalizes a singular string 'keysecondary' into an array", () => {
		const result = normalizeLegacyLorebookData({
			entries: [{ keys: ["a"], keysecondary: "b", content: "..." }]
		})
		expect(result.entries[0].keysecondary).toEqual(["b"])
	})

	test("leaves an already-normalized (array-shaped, array keys) lorebook untouched in structure", () => {
		const input = {
			name: "Book",
			entries: [{ keys: ["a", "b"], keysecondary: ["c"], content: "..." }]
		}
		const result = normalizeLegacyLorebookData(input)
		expect(result.entries[0].keys).toEqual(["a", "b"])
		expect(result.entries[0].keysecondary).toEqual(["c"])
	})

	test("never invents key/keysecondary fields on an entry that never had them (round-trip stability)", () => {
		// A Serene-Pub-exported entry has neither a `key` nor a `keysecondary`
		// field at all (only `keys`) — this must come back byte-identical, or
		// re-importing an unedited export would always hash differently from
		// the original and never report "unchanged".
		const input = { entries: [{ keys: ["a", "b"], content: "..." }] }
		const result = normalizeLegacyLorebookData(input)
		expect(result.entries[0]).toEqual({ keys: ["a", "b"], content: "..." })
		expect("key" in result.entries[0]).toBe(false)
		expect("keysecondary" in result.entries[0]).toBe(false)
	})

	test("passes through non-object input unchanged", () => {
		expect(normalizeLegacyLorebookData(null)).toBe(null)
		expect(normalizeLegacyLorebookData(undefined)).toBe(undefined)
	})

	test("passes through when entries is missing or not array-like", () => {
		const noEntries = { name: "Book" }
		expect(normalizeLegacyLorebookData(noEntries)).toEqual(noEntries)
	})
})

describe("resolveParentNodeLinks", () => {
	test("resolves a simple parent link", () => {
		const nodes = [
			{ localId: 1, parentLocalId: 2 },
			{ localId: 2 }
		]
		const realIds = new Map([
			[1, 101],
			[2, 102]
		])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([
			{ realId: 101, parentRealId: 102 }
		])
	})

	test("drops a self-referencing node", () => {
		const nodes = [{ localId: 1, parentLocalId: 1 }]
		const realIds = new Map([[1, 101]])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([])
	})

	test("drops a link that would create a 3rd alias level", () => {
		// 1 -> 2 -> 3: linking 1 to 2 would make 1 a grandchild of 3 once
		// 2 -> 3 is linked, since 2 already has its own parent.
		const nodes = [
			{ localId: 1, parentLocalId: 2 },
			{ localId: 2, parentLocalId: 3 },
			{ localId: 3 }
		]
		const realIds = new Map([
			[1, 101],
			[2, 102],
			[3, 103]
		])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([
			{ realId: 102, parentRealId: 103 }
		])
	})

	test("skips links whose localId/parentLocalId never resolved to a real row", () => {
		const nodes = [{ localId: 1, parentLocalId: 99 }]
		const realIds = new Map([[1, 101]])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([])
	})

	test("ignores nodes with no parentLocalId or malformed localId types", () => {
		const nodes = [
			{ localId: 1 },
			{ localId: 2, parentLocalId: "3" },
			{ parentLocalId: 1 }
		]
		const realIds = new Map([
			[1, 101],
			[2, 102]
		])
		expect(resolveParentNodeLinks(nodes as any, realIds)).toEqual([])
	})
})
