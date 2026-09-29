import { describe, expect, it } from "vitest"
import {
	bookIsEmpty,
	CAST_KIND,
	facetCounts,
	mergeCastCount,
	nothingMatchesLine,
	poolSummary,
	railScopes,
	readingLine,
	SAVED_SCOPES,
	savedScopeCount,
	savedScopeFilters,
	readingIntoSentence,
	scopeKinds,
	BOOK_ENTRY_TYPES,
	entryTotal,
	matchSessionRoute,
	readingActionLabel,
	replaceReadingSentence,
	sessionMomentKey,
	timeLensEntries,
	timeLensKinds
} from "./scopes"
import { emptyRoute, type LoreRoute } from "$lib/shared/lorebooks/loreRoute"
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
		keys: [],
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
			places: 0,
			items: 0
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
			"places",
			"items"
		])
		expect(scopes.filter((s) => s.empty).map((s) => s.id)).toEqual([
			"history",
			"scenes",
			"places",
			"items"
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
			undefined,
			undefined
		])
		expect(scopes.some((s) => s.empty)).toBe(false)
	})

	it("names the kinds a scope's pool draws", () => {
		expect(scopeKinds("world")).toEqual([WORLD])
		expect(scopeKinds("all")).toEqual([])
		expect(scopeKinds("cast")).toEqual([CHARACTER])
		expect(scopeKinds("items")).toEqual(["core:entry/item"])
	})

	it("counts items as a scope of their own, and in the whole pool (phase 3c)", () => {
		const by = Object.fromEntries(
			railScopes({ ...COUNTS, "core:entry/item": 4 }).map((s) => [s.id, s.count])
		)
		expect(by).toMatchObject({ all: 34, items: 4, world: 12 })
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
		item({ id: 1, keys: ["umber"] }),
		item({ id: 2, keys: [] }),
		item({ id: 3, keys: ["   "] }),
		item({ id: 4, keys: [], pinned: true }),
		item({ id: 5, keys: [], archived: true })
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

	it("counts the saved scopes by the rail's own rule (archived answers none)", () => {
		const counts = facetCounts(pool, readIn)
		// No keywords: 1 and 2 were read in; 3 is live; 4 is archived; 5 a scene.
		expect(counts.needsKeywords).toBe(4)
		expect(counts.looseEnds).toBe(2)
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

describe("readingIntoSentence — the session's clock (ruling 3, #145)", () => {
	it("names the session's clock when it keeps one", () => {
		expect(readingIntoSentence("main", 2, "Year 3, Mo. 2")).toBe(
			"Reading this book on main, as of Year 3, Mo. 2, the session's clock · 2 entries reached the last turn"
		)
	})
})

describe("sessionMomentKey / matchSessionRoute — stand where the session stands", () => {
	const base: LoreRoute = {
		...emptyRoute(),
		lorebookId: 4,
		moment: "Y1-5",
		branch: 7
	}

	it("a session with no clock reads at now", () => {
		expect(sessionMomentKey(null)).toBeUndefined()
		expect(sessionMomentKey({ year: 3, month: 2, day: null })).toBe("Y3-2")
	})

	it("moves line AND moment in one route, so one guarded transition does both (#81)", () => {
		const next = matchSessionRoute(base, { branchId: null, clock: null })
		expect(next.branch).toBeUndefined()
		expect(next.moment).toBeUndefined()
		const atClock = matchSessionRoute(base, {
			branchId: 9,
			clock: { year: 12, month: 1, day: 4 }
		})
		expect(atClock.branch).toBe(9)
		expect(atClock.moment).toBe("Y12-1-4")
		expect(atClock.lorebookId).toBe(4)
	})
})

describe("reading verbs (NOMENCLATURE §8)", () => {
	it("offers one action, named by what it does", () => {
		expect(readingActionLabel(false)).toBe("Read into this session")
		expect(readingActionLabel(true)).toBe("Stop reading")
	})

	it("the replace confirmation names both books and says nothing changes in them", () => {
		const sentence = replaceReadingSentence("The Open Door", "Old Book", "New Book")
		expect(sentence).toContain("The Open Door reads Old Book")
		expect(sentence).toContain("stops reading Old Book")
		expect(sentence).toContain("nothing in either book changes")
	})
})

describe("book entry types and figures (#85, #89)", () => {
	it("loads every entry kind the pool draws, items included, plus places", () => {
		expect(BOOK_ENTRY_TYPES).toContain("core:entry/item")
		expect(BOOK_ENTRY_TYPES).toContain("core:entry/location")
		expect(BOOK_ENTRY_TYPES).toContain(HISTORY)
		expect(BOOK_ENTRY_TYPES).not.toContain(SCENE_KIND)
	})

	it("totals every entry type, and leaves scenes and cast out", () => {
		expect(entryTotal(null)).toBeUndefined()
		expect(
			entryTotal({
				[WORLD]: 2,
				"core:entry/location": 1,
				"core:entry/item": 3,
				[SCENE_KIND]: 9,
				cast: 4
			})
		).toBe(6)
	})

	it("a place is a location entry — the Places scope narrows to them", () => {
		expect(scopeKinds("places")).toEqual(["core:entry/location"])
	})
})

describe("timeLensEntries — the Time lens honours the scope (#88)", () => {
	const rows = [
		{ id: 1, typeId: WORLD },
		{ id: 2, typeId: HISTORY },
		{ id: 3, typeId: "core:entry/location" },
		{ id: 4, typeId: CHARACTER }
	]

	it("narrows to the scope's kind", () => {
		expect(timeLensEntries(rows, "world").map((r) => r.id)).toEqual([1])
		expect(timeLensEntries(rows, "places").map((r) => r.id)).toEqual([3])
		expect(timeLensEntries(rows, "cast").map((r) => r.id)).toEqual([4])
	})

	it("all is every pool kind; scenes keeps History, where scenes sit", () => {
		expect(timeLensEntries(rows, "all").map((r) => r.id)).toEqual([1, 2, 4])
		expect(timeLensKinds("scenes")).toEqual([HISTORY])
	})
})

describe("nothingMatchesLine", () => {
	it("quotes the search back when there is one", () => {
		expect(nothingMatchesLine("  harbour ")).toBe(
			"Nothing matches “harbour” with these filters."
		)
	})

	it("speaks of the filters alone when nothing is typed", () => {
		expect(nothingMatchesLine("")).toBe("Nothing matches these filters.")
	})
})
