import { describe, expect, it } from "vitest"
import {
	heldLibraryPieces,
	libraryOffered,
	libraryPoolItem,
	libraryRowsFor,
	librarySource,
	librarySourceLine,
	type BookLibrary
} from "./libraryRows"
import {
	activeFilterCount,
	emptyFilters,
	filterPool,
	libraryKey,
	needsKeywords,
	type PoolItem
} from "./poolFilter"
import { facetCounts, poolSummary } from "./scopes"

const WEAPONS = "core:entry/vis-itineris.weapons"
const SPELLS = "core:entry/vis-itineris.spells"
const SRD = { document: "SRD 5.2.1", licence: "CC-BY-4.0" }

const LIBRARY: BookLibrary = {
	name: "Vis Itineris library",
	source: SRD,
	rows: [
		{
			typeId: WEAPONS,
			repertoireId: "weapons",
			id: "longsword",
			version: "1.1.0",
			piece: {
				name: "Longsword",
				description: "A knight's blade.",
				damage: { dice: "1d8" }
			}
		},
		{
			typeId: WEAPONS,
			repertoireId: "weapons",
			id: "dagger",
			version: "1.1.0",
			piece: { name: "Dagger", description: "Short and quick." },
			source: { document: "House rules", licence: "CC0" }
		},
		{
			typeId: SPELLS,
			repertoireId: "spells",
			id: "light",
			version: "1.1.0",
			piece: { name: "Light" }
		}
	]
}

function own(over: Partial<PoolItem> & { id: number }): PoolItem {
	return {
		key: `entry#${over.id}`,
		kind: WEAPONS,
		name: `Entry ${over.id}`,
		content: "",
		keys: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: over.id,
		position: over.id,
		priority: 0,
		createdAt: 0,
		updatedAt: 0,
		...over
	}
}

describe("the rules library under a book", () => {
	it("keys a piece in its own key space", () => {
		const item = libraryPoolItem(LIBRARY.rows[0]!)
		expect(item.key).toBe(`library#${WEAPONS}/longsword`)
		expect(item.key).toBe(libraryKey(WEAPONS, "longsword"))
		expect(item.fromLibrary).toBe(true)
		expect(item.kind).toBe(WEAPONS)
		expect(item.name).toBe("Longsword")
		expect(item.content).toBe("A knight's blade.")
	})

	it("reads a piece as the entry a copy would be: name the title, description the content", () => {
		const source = librarySource(LIBRARY.rows[0]!, 7)
		expect(source.name).toBe("Longsword")
		expect(source.content).toBe("A knight's blade.")
		expect(source.typeId).toBe(WEAPONS)
		expect(source.lorebookId).toBe(7)
		expect(source.damage).toEqual({ dice: "1d8" })
		expect(source.keys).toEqual([])
	})

	it("names a piece by its id when it has no name", () => {
		const row = { ...LIBRARY.rows[2]!, piece: {} }
		expect(libraryPoolItem(row).name).toBe("light")
		expect(librarySource(row, 1).name).toBe("light")
	})

	it("lists only the list's kinds, and leaves out a piece the book holds a copy of", () => {
		const held = heldLibraryPieces({
			[WEAPONS]: [
				{
					id: 1,
					derivedFrom: {
						compendium: "vi",
						piece: "dagger",
						version: "1.1.0"
					}
				},
				{ id: 2, derivedFrom: null },
				{ id: 3 }
			]
		})
		expect([...held]).toEqual([`${WEAPONS}/dagger`])
		const rows = libraryRowsFor(LIBRARY, new Set([WEAPONS]), held)
		expect(rows.map((r) => r.id)).toEqual(["longsword"])
		expect(
			libraryRowsFor(LIBRARY, new Set([WEAPONS, SPELLS]), new Set()).map(
				(r) => r.id
			)
		).toEqual(["longsword", "dagger", "light"])
		expect(libraryRowsFor(null, new Set([WEAPONS]), new Set())).toEqual([])
	})

	it("a copy under another list does not hide a piece of the same id", () => {
		const held = heldLibraryPieces({
			[SPELLS]: [{ id: 9, derivedFrom: { piece: "longsword" } }]
		})
		expect(
			libraryRowsFor(LIBRARY, new Set([WEAPONS]), held).map((r) => r.id)
		).toContain("longsword")
	})

	it("offers the chip only where the list has library pieces", () => {
		expect(libraryOffered(LIBRARY, new Set([WEAPONS]))).toBe(true)
		expect(
			libraryOffered(LIBRARY, new Set(["core:entry/world-lore"]))
		).toBe(false)
		expect(
			libraryOffered(
				{ name: null, source: null, rows: [] },
				new Set([WEAPONS])
			)
		).toBe(false)
		expect(libraryOffered(null, new Set([WEAPONS]))).toBe(false)
	})

	it("says where a piece comes from, its own source before the library's", () => {
		expect(librarySourceLine(LIBRARY.rows[0]!, LIBRARY)).toBe(
			"SRD 5.2.1 · CC-BY-4.0"
		)
		expect(librarySourceLine(LIBRARY.rows[1]!, LIBRARY)).toBe(
			"House rules · CC0"
		)
		expect(librarySourceLine(LIBRARY.rows[2]!, null)).toBeNull()
	})
})

describe("the library chip, as arithmetic", () => {
	const pool = [
		own({ id: 1 }),
		own({ id: 2, pinned: true }),
		...LIBRARY.rows.map(libraryPoolItem)
	]

	it("is off in a fresh set of filters, and lists no library piece while off", () => {
		expect(emptyFilters().library).toBe(false)
		expect(filterPool(pool, emptyFilters()).map((i) => i.key)).toEqual([
			"entry#1",
			"entry#2"
		])
	})

	it("on, lists the library's pieces beside the book's rows", () => {
		const on = { ...emptyFilters(), library: true }
		expect(filterPool(pool, on)).toHaveLength(5)
		expect(activeFilterCount(on)).toBe(1)
		// The other chips still narrow: a piece is never pinned.
		expect(
			filterPool(pool, { ...on, pinned: true }).map((i) => i.key)
		).toEqual(["entry#2"])
	})

	it("never counts a piece as the book's, nor as a keyword chore", () => {
		const counts = facetCounts(pool, new Set())
		expect(counts.total).toBe(2)
		expect(counts.library).toBe(3)
		expect(counts.needsKeywords).toBe(1)
		expect(pool.filter(needsKeywords).map((i) => i.key)).toEqual([
			"entry#1"
		])
	})

	it("the summary counts the pieces apart from the entries", () => {
		expect(poolSummary(2, null)).toBe("2 entries")
		expect(
			poolSummary(2, null, { count: 3, name: "Vis Itineris library" })
		).toBe("2 entries · 3 from the Vis Itineris library")
		expect(
			poolSummary(2, null, { count: 0, name: "Vis Itineris library" })
		).toBe("2 entries")
	})
})
