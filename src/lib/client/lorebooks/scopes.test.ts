import { describe, expect, it } from "vitest"
import {
	bookIsEmpty,
	CAST_KIND,
	facetCounts,
	mergeCastCount,
	nothingMatchesLine,
	POOL_KINDS,
	poolSummary,
	railScopes,
	readingLine,
	SAVED_SCOPES,
	savedScopeCount,
	savedScopeFilters,
	savedScopePool,
	savedScopeRoute,
	scopeRoute,
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
import {
	emptyFilters,
	filterPool,
	SCENE_KIND,
	type PoolItem
} from "./poolFilter"

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
	it("counts the whole pool as every kind the pool draws, the cast too (note 12)", () => {
		const scopes = railScopes(COUNTS)
		// 30 entries and scenes, and the 7 people All now lists.
		expect(scopes.find((s) => s.id === "all")?.count).toBe(37)
	})

	it("counts each scope from the figure the server sent", () => {
		const by = Object.fromEntries(
			railScopes(COUNTS).map((s) => [s.id, s.count])
		)
		expect(by).toEqual({
			all: 37,
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
			railScopes({ ...COUNTS, "core:entry/item": 4 }).map((s) => [
				s.id,
				s.count
			])
		)
		expect(by).toMatchObject({ all: 41, items: 4, world: 12 })
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

	it("offers Pinned alone — the Loose ends queue replaced the keyword two (note 5)", () => {
		expect(SAVED_SCOPES.map((s) => s.id)).toEqual(["pinned"])
	})

	it("counts entries with no keywords as needing them, pinned ones aside", () => {
		// 2 and 3; 4 is pinned (in every prompt anyway), 5 archived.
		expect(facetCounts(pool, readIn).needsKeywords).toBe(2)
	})

	/** Note 6: the badge counted rows keywords would never do anything for. */
	it("leaves off entries and scenes out of the keyword chore", () => {
		const more = [
			item({ id: 6, keys: [], off: true }),
			item({ id: 7, kind: SCENE_KIND, key: "scene#7", keys: [] })
		]
		expect(facetCounts(more, new Set()).needsKeywords).toBe(0)
	})

	it("lists exactly what it counts, so chip = list length", () => {
		const mixed = [
			...pool,
			item({ id: 6, keys: [], off: true }),
			item({ id: 7, kind: SCENE_KIND, key: "scene#7", keys: [] })
		]
		const keywordless = filterPool(
			mixed,
			{ ...emptyFilters(), needsKeywords: true },
			readIn
		)
		expect(keywordless.length).toBe(facetCounts(mixed, readIn).needsKeywords)
		const pinned = filterPool(
			mixed,
			{ ...emptyFilters(), ...savedScopeFilters("pinned") },
			readIn
		)
		expect(pinned.length).toBe(savedScopeCount("pinned", mixed))
	})

	it("counts over the scope being read, the whole book from All and Cast", () => {
		const book = [
			item({ id: 1, kind: WORLD, keys: [] }),
			item({ id: 2, kind: HISTORY, keys: [] })
		]
		expect(savedScopePool(book, "all").length).toBe(2)
		expect(savedScopePool(book, "cast").length).toBe(2)
		expect(savedScopePool(book, "world").map((i) => i.id)).toEqual([1])
		expect(savedScopePool(book, "history").map((i) => i.id)).toEqual([2])
	})

	it("takes the reader to a list when the lens or board has none", () => {
		const onCast: LoreRoute = {
			...emptyRoute(),
			lorebookId: 1,
			scope: "cast",
			lens: "time"
		}
		const next = savedScopeRoute(onCast)
		expect(next.scope).toBe("all")
		expect(next.lens).toBe("list")
		const onWorld: LoreRoute = {
			...emptyRoute(),
			lorebookId: 1,
			scope: "world",
			lens: "cards"
		}
		expect(savedScopeRoute(onWorld)).toBe(onWorld)
	})

	it("counts what is pinned", () => {
		expect(savedScopeCount("pinned", pool)).toBe(1)
	})

	it("narrows the pool the same way the count did", () => {
		expect(savedScopeFilters("pinned")).toMatchObject({ pinned: true })
	})

	it("narrows nothing when no saved scope is chosen", () => {
		expect(savedScopeFilters(null)).toEqual({
			keywords: emptyFilters().keywords,
			needsKeywords: false,
			pinned: false
		})
	})
})

describe("scopeRoute — a scope chosen is a scope shown (design §2, Cast × Places)", () => {
	const at = (lens?: LoreRoute["lens"]): LoreRoute => ({
		...emptyRoute(),
		lorebookId: 1,
		scope: "world",
		entryId: 7,
		...(lens ? { lens } : {})
	})

	it("keeps the lens when it draws the scope", () => {
		for (const lens of ["list", "cards", "tree", "graph", "time"] as const) {
			const next = scopeRoute(at(lens), "history")
			expect(next.scope).toBe("history")
			expect(next.lens, lens).toBe(lens)
		}
	})

	it("opens the scope in the default lens under Places and Lives, which draw their own set", () => {
		for (const lens of ["places", "lives"] as const) {
			const next = scopeRoute(at(lens), "cast")
			expect(next.scope).toBe("cast")
			expect(next.lens, lens).toBe("list")
		}
	})

	it("leaves the entry behind, as choosing a scope always has", () => {
		expect(scopeRoute(at("list"), "history").entryId).toBeUndefined()
	})

	it("reads an absent lens as the default, which draws every scope", () => {
		expect(scopeRoute(at(), "places").lens).toBeUndefined()
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

	it("counts Needs keywords by the queue's own rule (archived answers none)", () => {
		const counts = facetCounts(pool, readIn)
		// Only 1 needs keywords: 2 is pinned, 3 off, 4 archived, 5 a scene.
		expect(counts.needsKeywords).toBe(1)
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
		const sentence = replaceReadingSentence(
			"The Open Door",
			"Old Book",
			"New Book"
		)
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

	/**
	 * Places plan B5: places are pool entries. The pool draws them, so All
	 * counts them and a book holding only places is not an empty book.
	 */
	it("draws places in the pool, so All counts them", () => {
		expect(POOL_KINDS).toContain("core:entry/location")
		expect(
			BOOK_ENTRY_TYPES.filter((t) => t === "core:entry/location")
		).toHaveLength(1)
		const counts = { "core:entry/location": 3, places: 3, cast: 0 }
		expect(railScopes(counts).find((s) => s.id === "all")?.count).toBe(3)
		expect(railScopes(counts).find((s) => s.id === "places")?.count).toBe(3)
		expect(bookIsEmpty(counts)).toBe(false)
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

	it("all is every pool kind, places included (B5); scenes keeps History, where scenes sit", () => {
		expect(timeLensEntries(rows, "all").map((r) => r.id)).toEqual([
			1, 2, 3, 4
		])
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
