import { describe, expect, it } from "vitest"
import {
	bookIsEmpty,
	CAST_KIND,
	facetCounts,
	mergeCastCount,
	poolSummary,
	railScopes,
	readingLine,
	SAVED_SCOPES,
	savedScopeCount,
	savedScopeFilters,
	readingIntoSentence,
	scopeKinds
} from "./scopes"
import { emptyFilters, SCENE_KIND, type PoolItem } from "./poolFilter"

const WORLD = "core:entry/world-lore"
const CHARACTER = "core:entry/character-lore"
const HISTORY = "core:entry/history"

function item(over: Partial<PoolItem> & { id: number }): PoolItem {
	return {
		key: `entry#${over.id}`,
		kind: WORLD,
		name: `Entry ${over.id}`,
		content: "",
		keys: "",
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: over.id,
		position: over.id,
		priority: 1,
		createdAt: 0,
		updatedAt: 0,
		...over
	}
}

/** The artifact's book: 12 world lore, 7 cast, 9 history, 2 scenes, 0 places. */
const COUNTS = {
	[WORLD]: 12,
	[CHARACTER]: 7,
	[HISTORY]: 9,
	[SCENE_KIND]: 2,
	[CAST_KIND]: 7
}

describe("railScopes — the kind facets, with their figures", () => {
	it("counts the whole pool as every kind the pool draws", () => {
		const scopes = railScopes(COUNTS)
		expect(scopes.find((s) => s.id === "all")?.count).toBe(30)
	})

	it("counts each scope from the figure the server sent", () => {
		const by = Object.fromEntries(
			railScopes(COUNTS).map((s) => [s.id, s.count])
		)
		expect(by).toEqual({
			all: 30,
			cast: 7,
			world: 12,
			history: 9,
			scenes: 2,
			places: 0
		})
	})

	it("reads a book with no places as none rather than as unknown", () => {
		expect(railScopes(COUNTS).find((s) => s.id === "places")).toMatchObject(
			{ count: 0, empty: true }
		)
	})

	it("sorts empty facets last and hides nothing", () => {
		const scopes = railScopes({ ...COUNTS, [HISTORY]: 0, [SCENE_KIND]: 0 })
		expect(scopes.map((s) => s.id)).toEqual([
			"all",
			"cast",
			"world",
			"history",
			"scenes",
			"places"
		])
		expect(scopes.filter((s) => s.empty).map((s) => s.id)).toEqual([
			"history",
			"scenes",
			"places"
		])
	})

	it("says nothing about a figure that has not arrived", () => {
		const scopes = railScopes(null)
		expect(scopes.map((s) => s.count)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined
		])
		expect(scopes.some((s) => s.empty)).toBe(false)
	})

	it("names the kinds a scope's pool draws", () => {
		expect(scopeKinds("world")).toEqual([WORLD])
		expect(scopeKinds("all")).toEqual([])
		expect(scopeKinds("cast")).toEqual([CHARACTER])
	})
})

describe("bookIsEmpty — whether day one is the right screen", () => {
	it("reads a book with nothing of any kind in it as empty", () => {
		expect(
			bookIsEmpty({
				[WORLD]: 0,
				[CHARACTER]: 0,
				[HISTORY]: 0,
				[SCENE_KIND]: 0,
				[CAST_KIND]: 0
			})
		).toBe(true)
	})

	it("counts cast members as content, whatever else the book holds", () => {
		expect(
			bookIsEmpty({
				[WORLD]: 0,
				[CHARACTER]: 0,
				[HISTORY]: 0,
				[SCENE_KIND]: 0,
				[CAST_KIND]: 2
			})
		).toBe(false)
	})

	it("counts entries as content when the cast is empty", () => {
		expect(bookIsEmpty({ ...COUNTS, [CAST_KIND]: 0 })).toBe(false)
	})

	it("reads a figure that has not arrived as no answer rather than none", () => {
		expect(bookIsEmpty(null)).toBe(false)
	})
})

describe("mergeCastCount — the cast figure, from the list of bindings", () => {
	it("counts the bindings the server listed", () => {
		expect(mergeCastCount(COUNTS, [{ id: 4 }, { id: 9 }])).toEqual({
			...COUNTS,
			[CAST_KIND]: 2
		})
	})

	it("leaves every other kind's figure alone", () => {
		expect(mergeCastCount(COUNTS, [])).toEqual({
			...COUNTS,
			[CAST_KIND]: 0
		})
	})

	it("answers nothing for kinds whose figures have not arrived", () => {
		expect(mergeCastCount(null, [{ id: 4 }])).toBe(null)
	})
})

describe("poolSummary — the pool header's sentence", () => {
	it("counts the entries and what reached the model", () => {
		expect(poolSummary(30, 4)).toBe("30 entries · 4 reached the last turn")
	})

	it("counts one entry as one", () => {
		expect(poolSummary(1, null)).toBe("1 entry")
	})

	it("says nothing about a turn when no session is reading the book", () => {
		expect(poolSummary(30, null)).toBe("30 entries")
	})

	it("says none reached rather than zero reached", () => {
		expect(poolSummary(30, 0)).toBe(
			"30 entries · nothing reached the last turn"
		)
	})
})

describe("readingLine — which session the book is read into", () => {
	it("names the session and what reached it", () => {
		expect(readingLine("The Open Door", 4)).toBe(
			"Reading into The Open Door · 4 entries reached the last turn"
		)
	})

	it("names the session that has read nothing yet", () => {
		expect(readingLine("The Open Door", 0)).toBe(
			"Reading into The Open Door · nothing reached the last turn"
		)
	})

	it("says so when no session reads this book", () => {
		expect(readingLine(null, null)).toBe("No session is reading this book")
	})
})

/**
 * A saved scope is a question about the pool, so it is a predicate and not a
 * stored list. Archived rows answer none of them: they are out of the book's
 * way on purpose, and a chore list that keeps offering them is not a chore
 * list.
 */
describe("saved scopes", () => {
	const pool = [
		item({ id: 1, keys: "umber" }),
		item({ id: 2, keys: "" }),
		item({ id: 3, keys: "   " }),
		item({ id: 4, keys: "", pinned: true }),
		item({ id: 5, keys: "", archived: true })
	]
	const readIn = new Set(["entry#2"])

	it("offers the three the rail names", () => {
		expect(SAVED_SCOPES.map((s) => s.id)).toEqual([
			"needs-keywords",
			"loose-ends",
			"pinned"
		])
	})

	it("counts entries with no keywords as needing them", () => {
		expect(savedScopeCount("needs-keywords", pool, readIn)).toBe(3)
	})

	it("counts a loose end as no keywords and never read in", () => {
		expect(savedScopeCount("loose-ends", pool, readIn)).toBe(2)
	})

	it("counts what is pinned", () => {
		expect(savedScopeCount("pinned", pool, readIn)).toBe(1)
	})

	it("narrows the pool the same way the count did", () => {
		expect(savedScopeFilters("needs-keywords")).toMatchObject({
			keywords: "none"
		})
		expect(savedScopeFilters("loose-ends")).toMatchObject({
			looseEnds: true
		})
		expect(savedScopeFilters("pinned")).toMatchObject({ pinned: true })
	})

	it("narrows nothing when no saved scope is chosen", () => {
		expect(savedScopeFilters(null)).toEqual({
			keywords: emptyFilters().keywords,
			looseEnds: false,
			pinned: false
		})
	})
})

describe("facetCounts — what the chips under the pool header say", () => {
	const pool = [
		item({ id: 1, kind: WORLD }),
		item({ id: 2, kind: WORLD, pinned: true }),
		item({ id: 3, kind: HISTORY, off: true }),
		item({ id: 4, kind: HISTORY, archived: true }),
		item({ id: 5, kind: SCENE_KIND, key: "scene#5", machineWritten: true })
	]
	const readIn = new Set(["entry#1", "entry#2"])

	it("counts each kind in the order the pool declares them", () => {
		expect(facetCounts(pool, readIn).kinds).toEqual([
			{ kind: WORLD, count: 2 },
			{ kind: HISTORY, count: 2 },
			{ kind: SCENE_KIND, count: 1 }
		])
	})

	it("counts each state a chip narrows to", () => {
		const counts = facetCounts(pool, readIn)
		expect(counts.readIn).toBe(2)
		expect(counts.pinned).toBe(1)
		expect(counts.off).toBe(1)
		expect(counts.archived).toBe(1)
		expect(counts.machineWritten).toBe(1)
		expect(counts.total).toBe(5)
	})

	it("counts a kind the pool does not hold as absent rather than as zero", () => {
		expect(
			facetCounts([item({ id: 1 })], new Set()).kinds.map((k) => k.kind)
		).toEqual([WORLD])
	})
})

describe("readingIntoSentence", () => {
	it("names the line and what reached, in one line", () => {
		expect(readingIntoSentence("marrow-stays", 4)).toBe(
			"Reading this book on marrow-stays, as of now · 4 entries reached the last turn"
		)
	})

	it("says nothing reached rather than zero", () => {
		expect(readingIntoSentence("main", 0)).toBe(
			"Reading this book on main, as of now · nothing reached the last turn"
		)
	})

	it("a run that has not happened reads the same as one that reached nothing", () => {
		// Both are "the model has not been given anything from this book yet",
		// and a reader does not need the two told apart here.
		expect(readingIntoSentence("main", null)).toBe(
			readingIntoSentence("main", 0)
		)
	})

	it("one entry is singular", () => {
		expect(readingIntoSentence("main", 1)).toContain("1 entry reached")
	})
})
