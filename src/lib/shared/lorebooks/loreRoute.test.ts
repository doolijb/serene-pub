/**
 * The lorebook workspace's route — pure, so the whole navigation model is
 * covered without a component harness.
 */
import { describe, expect, it } from "vitest"
import {
	DEFAULT_SCOPE,
	compactStep,
	describeRoute,
	emptyRoute,
	fromHash,
	isListScope,
	listScope,
	listScopeType,
	reduce,
	scopeKind,
	scopeLabel,
	routeFromDigest,
	sameRoute,
	toHash,
	type LoreRoute
} from "./loreRoute"

/** A book open on one scope, nothing selected in it. */
function at(over: Partial<LoreRoute> = {}): LoreRoute {
	return { lorebookId: 12, scope: "world", ...over }
}

describe("reduce — openBook", () => {
	it("opens a book on the default scope", () => {
		expect(
			reduce(emptyRoute(), { type: "openBook", lorebookId: 12 })
		).toEqual({ lorebookId: 12, scope: DEFAULT_SCOPE })
	})

	it("opens a book on a named scope", () => {
		expect(
			reduce(emptyRoute(), {
				type: "openBook",
				lorebookId: 12,
				scope: "history"
			})
		).toEqual({ lorebookId: 12, scope: "history" })
	})

	it("drops what belonged to the book being left, and keeps the lens", () => {
		const from = at({
			entryId: 340,
			sceneId: 7,
			inspector: "fires",
			branch: 3,
			moment: "Y2-harvest",
			lens: "cards"
		})
		expect(reduce(from, { type: "openBook", lorebookId: 99 })).toEqual({
			lorebookId: 99,
			scope: DEFAULT_SCOPE,
			lens: "cards"
		})
	})

	it("closes the book, which is the list of books", () => {
		expect(
			reduce(at({ entryId: 340 }), { type: "openBook", lorebookId: null })
		).toEqual({ lorebookId: null, scope: DEFAULT_SCOPE })
	})
})

describe("reduce — openScope", () => {
	it("stays in the book and clears the selection", () => {
		expect(
			reduce(at({ entryId: 340, sceneId: 7, inspector: "fires" }), {
				type: "openScope",
				scope: "history"
			})
		).toEqual({ lorebookId: 12, scope: "history" })
	})

	it("keeps the lens, the branch and the moment, which are not the scope's", () => {
		expect(
			reduce(at({ lens: "graph", branch: 3, moment: "Y2-harvest" }), {
				type: "openScope",
				scope: "history"
			})
		).toEqual({
			lorebookId: 12,
			scope: "history",
			lens: "graph",
			branch: 3,
			moment: "Y2-harvest"
		})
	})

	it("drops the cast member, which belonged to the scope being left", () => {
		expect(
			reduce(at({ scope: "cast", castId: 9 }), {
				type: "openScope",
				scope: "world"
			})
		).toEqual({ lorebookId: 12, scope: "world" })
	})
})

describe("reduce — openCastMember", () => {
	it("selects a member and clears whatever was open on the last one", () => {
		expect(
			reduce(at({ scope: "cast", castId: 9, entryId: 340 }), {
				type: "openCastMember",
				castId: 11
			})
		).toEqual({ lorebookId: 12, scope: "cast", castId: 11 })
	})

	it("carries the member across to the scope it is named in", () => {
		expect(
			reduce(at({ scope: "all", castId: 9 }), {
				type: "openCastMember",
				castId: 9,
				scope: "cast"
			})
		).toEqual({ lorebookId: 12, scope: "cast", castId: 9 })
	})

	it("clears the member without leaving the scope", () => {
		expect(
			reduce(at({ scope: "cast", castId: 9 }), {
				type: "openCastMember",
				castId: null
			})
		).toEqual({ lorebookId: 12, scope: "cast" })
	})
})

describe("reduce — setLens", () => {
	it("draws the same set another way, without disturbing the selection", () => {
		expect(
			reduce(at({ entryId: 340, castId: 9 }), {
				type: "setLens",
				lens: "graph"
			})
		).toEqual({
			lorebookId: 12,
			scope: "world",
			entryId: 340,
			castId: 9,
			lens: "graph"
		})
	})

	it("survives a change of scope, because a lens is a way of reading", () => {
		const drawn = reduce(at(), { type: "setLens", lens: "time" })
		expect(reduce(drawn, { type: "openScope", scope: "cast" }).lens).toBe(
			"time"
		)
	})
})

describe("reduce — setMoment", () => {
	it("reads the book as of a date", () => {
		expect(
			reduce(at({ entryId: 340 }), {
				type: "setMoment",
				moment: "Y3-frostfall-12"
			})
		).toEqual({
			lorebookId: 12,
			scope: "world",
			entryId: 340,
			moment: "Y3-frostfall-12"
		})
	})

	it("returns to now, which is the absence of a moment", () => {
		expect(
			reduce(at({ moment: "Y2-harvest" }), { type: "setMoment" })
		).toEqual({ lorebookId: 12, scope: "world" })
	})
})

describe("reduce — openEntry", () => {
	it("selects an entry in the scope already open", () => {
		expect(reduce(at(), { type: "openEntry", entryId: 340 })).toEqual({
			lorebookId: 12,
			scope: "world",
			entryId: 340
		})
	})

	it("crosses into another scope with the entry", () => {
		expect(
			reduce(at(), {
				type: "openEntry",
				scope: "all",
				entryId: 55
			})
		).toEqual({ lorebookId: 12, scope: "all", entryId: 55 })
	})

	it("carries a scene, which hangs off the entry it was compiled into", () => {
		expect(
			reduce(at(), {
				type: "openEntry",
				scope: "scenes",
				entryId: 340,
				sceneId: 7
			})
		).toEqual({
			lorebookId: 12,
			scope: "scenes",
			entryId: 340,
			sceneId: 7
		})
	})

	it("keeps the cast member whose lore is being opened", () => {
		expect(
			reduce(at({ scope: "cast", castId: 9 }), {
				type: "openEntry",
				entryId: 340
			})
		).toEqual({
			lorebookId: 12,
			scope: "cast",
			castId: 9,
			entryId: 340
		})
	})

	it("lets go of the member when told to (castId: null)", () => {
		// An entry node picked on the graph while a member is selected: the
		// entry is not that member's lore, so the member must not stay open.
		expect(
			reduce(at({ scope: "all", castId: 9 }), {
				type: "openEntry",
				entryId: 340,
				castId: null
			})
		).toEqual({ lorebookId: 12, scope: "all", entryId: 340 })
	})

	it("replaces the previously selected scene", () => {
		expect(
			reduce(at({ entryId: 1, sceneId: 7 }), {
				type: "openEntry",
				entryId: 2
			})
		).toEqual({ lorebookId: 12, scope: "world", entryId: 2 })
	})
})

describe("reduce — back", () => {
	it("pops the selection first", () => {
		expect(
			reduce(at({ entryId: 340, sceneId: 7, inspector: "fires" }), {
				type: "back"
			})
		).toEqual({ lorebookId: 12, scope: "world" })
	})

	it("pops the anchored entry before the member it hangs off", () => {
		const onLore = at({ scope: "cast", castId: 9, entryId: 340 })
		const onMember = reduce(onLore, { type: "back" })
		expect(onMember).toEqual({
			lorebookId: 12,
			scope: "cast",
			castId: 9
		})
		expect(reduce(onMember, { type: "back" })).toEqual({
			lorebookId: 12,
			scope: "cast"
		})
	})

	it("pops the book once nothing is selected", () => {
		expect(reduce(at({ lens: "cards" }), { type: "back" })).toEqual({
			lorebookId: null,
			scope: DEFAULT_SCOPE,
			lens: "cards"
		})
	})

	it("stays put at the list of books", () => {
		expect(reduce(emptyRoute(), { type: "back" })).toEqual(emptyRoute())
	})
})

describe("toHash / fromHash", () => {
	it("writes the documented address", () => {
		expect(
			toHash({
				lorebookId: 12,
				scope: "world",
				lens: "graph",
				moment: "Y2-harvest"
			})
		).toBe("#lore=12/world?lens=graph&as=Y2-harvest")
	})

	it("has no address for the list of books", () => {
		expect(toHash(emptyRoute())).toBe("")
		expect(fromHash("")).toBeNull()
	})

	it("ignores a fragment that is not a lore address", () => {
		expect(fromHash("#section-two")).toBeNull()
	})

	it("reads an address that lost its '#'", () => {
		expect(fromHash("lore=12/history")).toEqual({
			lorebookId: 12,
			scope: "history"
		})
	})

	it("refuses an unknown scope rather than guessing one", () => {
		expect(fromHash("#lore=12/nonesuch")).toBeNull()
	})

	it("has no address of its own for Character Lore, which Cast holds", () => {
		expect(fromHash("#lore=12/characters")).toBeNull()
	})

	it("round-trips every field", () => {
		const routes: LoreRoute[] = [
			{ lorebookId: 12, scope: "all" },
			{ lorebookId: 12, scope: "world", entryId: 340 },
			{ lorebookId: 1, scope: "scenes", entryId: 340, sceneId: 7 },
			{ lorebookId: 4, scope: "all", lens: "cards" },
			{
				lorebookId: 4,
				scope: "places",
				lens: "places",
				branch: 3,
				castId: 9,
				moment: "Y3-thaw-2"
			},
			{
				lorebookId: 4,
				scope: "cast",
				castId: 9,
				entryId: 340,
				inspector: "suggestions"
			}
		]
		for (const route of routes) {
			expect(fromHash(toHash(route))).toEqual(route)
		}
	})
})

/**
 * An address written before scopes and lenses still names somewhere. The
 * nearest new route, never null: a reader who bookmarked a graph gets the
 * graph, not the list of books.
 */
describe("fromHash — addresses written before scopes and lenses", () => {
	it("reads a section as the scope of the same name", () => {
		expect(fromHash("#lore=12/cast")).toEqual({
			lorebookId: 12,
			scope: "cast"
		})
	})

	it("reads the Overview, which is no longer a place, as the whole pool", () => {
		expect(fromHash("#lore=12/overview")).toEqual({
			lorebookId: 12,
			scope: "all"
		})
	})

	it("reads each Graphs drawing as the lens that draws it", () => {
		expect(fromHash("#lore=12/graphs?graph=timeline")).toEqual({
			lorebookId: 12,
			scope: "all",
			lens: "time"
		})
		expect(fromHash("#lore=12/graphs?graph=relationships")).toEqual({
			lorebookId: 12,
			scope: "all",
			lens: "graph"
		})
		expect(fromHash("#lore=12/graphs?graph=places")).toEqual({
			lorebookId: 12,
			scope: "all",
			lens: "places"
		})
		// Graphs with nothing named still draws a graph.
		expect(fromHash("#lore=12/graphs")).toEqual({
			lorebookId: 12,
			scope: "all",
			lens: "graph"
		})
	})

	it("reads the pool's old view as the lens of the same name", () => {
		expect(fromHash("#lore=12/world?view=cards")).toEqual({
			lorebookId: 12,
			scope: "world",
			lens: "cards"
		})
	})

	it("reads a single kind chip as the scope that holds that kind", () => {
		expect(fromHash("#lore=12/all?kinds=core:entry/history")).toEqual({
			lorebookId: 12,
			scope: "history"
		})
		// Several kinds at once is no one scope, so the pool stands.
		expect(fromHash("#lore=12/all?kinds=core:entry/history,scene")).toEqual(
			{ lorebookId: 12, scope: "all" }
		)
	})
})

describe("describeRoute — the breadcrumb", () => {
	it("names the workspace when no book is open", () => {
		expect(describeRoute(emptyRoute())).toEqual(["Lorebooks"])
	})

	it("names the book and the scope", () => {
		expect(describeRoute(at(), { book: "Archive of Verity" })).toEqual([
			"Archive of Verity",
			"World lore"
		])
	})

	it("falls back to a generic book name", () => {
		expect(describeRoute(at())).toEqual(["Lorebook", "World lore"])
	})

	it("adds the entry when one is named", () => {
		expect(
			describeRoute(at({ entryId: 340 }), {
				book: "Archive of Verity",
				entry: "Umber City"
			})
		).toEqual(["Archive of Verity", "World lore", "Umber City"])
	})
})

describe("routeFromDigest — one key, one address", () => {
	it("takes the route it is handed", () => {
		const lore: LoreRoute = {
			lorebookId: 3,
			scope: "cast",
			entryId: 9,
			inspector: "fires"
		}
		expect(routeFromDigest({ lore })).toEqual(lore)
	})

	it("normalizes what it is handed, so two spellings arrive as one", () => {
		expect(
			routeFromDigest({
				lore: { lorebookId: 3, scope: "world", entryId: undefined }
			})
		).toEqual({ lorebookId: 3, scope: "world" })
	})

	it("says nothing when the digest addresses no lorebook at all", () => {
		expect(routeFromDigest({})).toBeNull()
	})
})

describe("sameRoute", () => {
	it("is true for two spellings of the same address", () => {
		expect(
			sameRoute(at(), {
				lorebookId: 12,
				scope: "world",
				entryId: undefined
			})
		).toBe(true)
	})

	it("is false when any field differs", () => {
		expect(sameRoute(at(), at({ entryId: 340 }))).toBe(false)
		expect(sameRoute(at({ castId: 1 }), at({ castId: 2 }))).toBe(false)
		expect(sameRoute(at({ lens: "list" }), at({ lens: "tree" }))).toBe(
			false
		)
		expect(sameRoute(at({ moment: "Y1" }), at({ moment: "Y2" }))).toBe(
			false
		)
	})
})

describe("compactStep — one column, three steps", () => {
	it("is the list when the address names no row", () => {
		expect(compactStep(at(), { hasSelection: false, isNew: false })).toBe(
			"list"
		)
	})

	it("is the editor for an addressed row, arrived or not", () => {
		// The row is the step. Waiting for the list to land before leaving the
		// list would strand a deep link on a screen the reader did not ask for.
		expect(
			compactStep(at({ entryId: 340 }), {
				hasSelection: true,
				isNew: false
			})
		).toBe("editor")
	})

	it("is the editor while a row is being written", () => {
		expect(compactStep(at(), { hasSelection: false, isNew: true })).toBe(
			"editor"
		)
	})

	it("is the inspector when the address names a tab of it", () => {
		expect(
			compactStep(at({ entryId: 340, inspector: "fires" }), {
				hasSelection: true,
				isNew: false
			})
		).toBe("inspector")
	})

	it("keeps a row being written on the editor, whatever else the address says", () => {
		// A row nothing has saved has nothing to report on, so the inspector is
		// not a step it has.
		expect(
			compactStep(at({ entryId: 340, inspector: "fires" }), {
				hasSelection: true,
				isNew: true
			})
		).toBe("editor")
	})
})

describe("comparing a line with main", () => {
	it("rides in the hash and comes back", () => {
		const route = reduce(
			reduce(
				{ lorebookId: 4, scope: "all" as const },
				{ type: "setBranch", branch: 7 }
			),
			{ type: "setCompare", compare: true }
		)
		expect(toHash(route)).toContain("compare=1")
		expect(fromHash(toHash(route))).toEqual(route)
	})

	it("is dropped without a branch — main has nothing to compare against", () => {
		const route = reduce(
			{ lorebookId: 4, scope: "all" as const },
			{ type: "setCompare", compare: true }
		)
		expect(route.compare).toBeUndefined()
		expect(toHash(route)).not.toContain("compare")
	})

	it("leaving the line leaves the comparison with it", () => {
		const onLine = reduce(
			reduce(
				{ lorebookId: 4, scope: "all" as const },
				{ type: "setBranch", branch: 7 }
			),
			{ type: "setCompare", compare: true }
		)
		const backToMain = reduce(onLine, {
			type: "setBranch",
			branch: undefined
		})
		expect(backToMain.compare).toBeUndefined()
		expect(backToMain.branch).toBeUndefined()
	})

	it("switching to ANOTHER line keeps the comparison open", () => {
		const onSeven = reduce(
			reduce(
				{ lorebookId: 4, scope: "all" as const },
				{ type: "setBranch", branch: 7 }
			),
			{ type: "setCompare", compare: true }
		)
		const onEight = reduce(onSeven, { type: "setBranch", branch: 8 })
		expect(onEight).toMatchObject({ branch: 8, compare: true })
	})
})

/**
 * Book settings is a route (design A.2, A-Q2): a flag over the route beneath
 * it, so Back and Escape return to exactly what was open, and every move that
 * picks something to look at leaves it.
 */
describe("Book settings — a flag over the route beneath it", () => {
	const open = (over: Partial<LoreRoute> = {}) =>
		reduce(at(over), { type: "openSettings" })

	it("opens over the route, keeping the scope, the lens and the selection", () => {
		expect(open({ lens: "cards", entryId: 340, moment: "Y2" })).toEqual({
			lorebookId: 12,
			scope: "world",
			lens: "cards",
			entryId: 340,
			moment: "Y2",
			settings: true
		})
	})

	it("is popped first and alone by Back, returning to the route beneath", () => {
		const beneath = at({ lens: "cards", entryId: 340, castId: 9 })
		const settings = reduce(beneath, { type: "openSettings" })
		expect(reduce(settings, { type: "back" })).toEqual(beneath)
	})

	it("is left by closeSettings, and closing it twice changes nothing", () => {
		const beneath = at({ entryId: 340 })
		const closed = reduce(reduce(beneath, { type: "openSettings" }), {
			type: "closeSettings"
		})
		expect(closed).toEqual(beneath)
		expect(reduce(closed, { type: "closeSettings" })).toEqual(beneath)
	})

	it("is left by choosing a scope, a lens, an entry, a member or a book", () => {
		expect(reduce(open(), { type: "openScope", scope: "history" })).toEqual(
			{
				lorebookId: 12,
				scope: "history"
			}
		)
		expect(reduce(open(), { type: "setLens", lens: "graph" })).toEqual(
			at({ lens: "graph" })
		)
		expect(reduce(open(), { type: "openEntry", entryId: 7 })).toEqual(
			at({ entryId: 7 })
		)
		expect(
			reduce(open({ scope: "cast" }), {
				type: "openCastMember",
				castId: 9
			})
		).toEqual(at({ scope: "cast", castId: 9 }))
		expect(
			reduce(open(), { type: "openBook", lorebookId: 12 }).settings
		).toBeUndefined()
	})

	it("stays open while the moment or the line changes under it", () => {
		expect(reduce(open(), { type: "setMoment", moment: "Y3" })).toEqual(
			at({ moment: "Y3", settings: true })
		)
		expect(reduce(open(), { type: "setBranch", branch: 4 })).toEqual(
			at({ branch: 4, settings: true })
		)
	})

	it("rides in the hash as settings=1 and comes back", () => {
		const route = open({ lens: "cards", entryId: 340 })
		expect(toHash(route)).toBe("#lore=12/world/340?lens=cards&settings=1")
		expect(fromHash(toHash(route))).toEqual(route)
	})

	it("reads #lore=12/settings as Settings over Everything", () => {
		expect(fromHash("#lore=12/settings")).toEqual({
			lorebookId: 12,
			scope: "all",
			settings: true
		})
	})

	it("is not an address on the list of books", () => {
		expect(
			reduce(emptyRoute(), { type: "openSettings" }).settings
		).toBeUndefined()
	})

	it("is a different address from the route beneath it", () => {
		expect(sameRoute(at(), open())).toBe(false)
		expect(sameRoute(open(), { ...at(), settings: true })).toBe(true)
	})

	it("names Settings in the breadcrumb", () => {
		expect(describeRoute(open(), { book: "Archive of Verity" })).toEqual([
			"Archive of Verity",
			"Settings"
		])
	})
})

describe("🚧 rules list scopes (lane C1)", () => {
	const WEAPONS = "core:entry/vis-itineris.weapons"

	it("names a list by its derived entry type, qualified", () => {
		expect(listScope(WEAPONS)).toBe(`list:${WEAPONS}`)
		expect(isListScope(listScope(WEAPONS))).toBe(true)
		expect(listScopeType(listScope(WEAPONS))).toBe(WEAPONS)
		// The seven core scopes keep their spellings, and are not lists.
		expect(isListScope("items")).toBe(false)
		expect(listScopeType("items")).toBeNull()
		// A list scope names a derived entry type, nothing else.
		expect(isListScope("list:core:entry/world-lore")).toBe(false)
	})

	it("narrows to its own kind", () => {
		expect(scopeKind(listScope(WEAPONS))).toBe(WEAPONS)
		expect(scopeKind("items")).toBe("core:entry/item")
		expect(scopeKind("all")).toBeUndefined()
	})

	it("survives the address, slashes and all", () => {
		const route = at({ scope: listScope(WEAPONS), entryId: 7, lens: "list" })
		const hash = toHash(route)
		expect(hash.startsWith("#lore=12/list%3Acore%3Aentry%2Fvis-itineris.weapons/7")).toBe(true)
		expect(fromHash(hash)).toEqual(route)
	})

	it("keeps every core scope's address as it was", () => {
		expect(toHash(at({ scope: "items" }))).toBe("#lore=12/items")
	})

	it("is called by the list's own label, never the type id", () => {
		expect(scopeLabel(listScope(WEAPONS), "Weapons")).toBe("Weapons")
		expect(scopeLabel(listScope(WEAPONS))).toBe("Weapons")
		expect(scopeLabel("world")).toBe("World lore")
		expect(
			describeRoute(at({ scope: listScope(WEAPONS) }), {
				book: "Brackenvale",
				scope: "Weapons"
			})
		).toEqual(["Brackenvale", "Weapons"])
	})
})
