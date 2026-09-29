/**
 * The graph, as arithmetic: who is a node, which edges are drawable, which way
 * each one points from the node that is open, and where it came from.
 */
import { describe, expect, it } from "vitest"
import {
	bumpLinkCounts,
	castKey,
	endpointKey,
	entriesWithLinks,
	entryKey,
	graphEdges,
	graphHeaderLine,
	graphNodes,
	nodeNames,
	panelEdges,
	ceilingFactsFrom,
	ceilingLine,
	parseGraphKey,
	provenanceOf,
	toGraphEdge,
	type RelationshipLike
} from "./graphModel"

const cast = (id: number, name: string) => ({
	id,
	name,
	binding: `{{char:${id}}}`,
	nodeState: "active",
	nodeVisibility: "normal"
})

const rel = (over: Partial<RelationshipLike> & { id: number }) =>
	({
		from: { kind: "cast", bindingId: 1 },
		to: { kind: "cast", bindingId: 2 },
		relationshipType: "ally",
		status: "active",
		description: "",
		historyEntryId: null,
		sceneId: null,
		...over
	}) satisfies RelationshipLike

describe("keys — two id spaces, one set of nodes", () => {
	it("names a cast endpoint and an entry endpoint apart", () => {
		expect(endpointKey({ kind: "cast", bindingId: 3 })).toBe("cast#3")
		expect(endpointKey({ kind: "entry", entryId: 3 })).toBe("entry#3")
	})

	it("reads a key back into the thing it names", () => {
		expect(parseGraphKey("entry#7")).toEqual({ kind: "entry", id: 7 })
		expect(parseGraphKey("cast#7")).toEqual({ kind: "cast", id: 7 })
	})

	it("reads a key that is not one as nothing", () => {
		expect(parseGraphKey("scene#7")).toBeNull()
		expect(parseGraphKey("cast#")).toBeNull()
	})
})

describe("graphNodes — cast members, and entries that have an edge", () => {
	const relationships = [
		rel({
			id: 10,
			from: { kind: "cast", bindingId: 1 },
			to: { kind: "entry", entryId: 40, name: "The Archive" }
		}),
		rel({
			id: 11,
			from: { kind: "entry", entryId: 40, name: "The Archive" },
			to: { kind: "entry", entryId: 41, name: "The Undercroft" }
		})
	]

	it("draws every cast member, edge or no edge", () => {
		const nodes = graphNodes({
			cast: [cast(1, "Verity"), cast(2, "Marrow")],
			relationships: [],
			scopeEntries: []
		})
		expect(nodes.map((n) => n.key)).toEqual(["cast#1", "cast#2"])
	})

	it("draws an entry once it has an edge, named off the edge itself", () => {
		const nodes = graphNodes({
			cast: [cast(1, "Verity")],
			relationships,
			scopeEntries: []
		})
		expect(nodes.map((n) => n.key)).toEqual([
			"cast#1",
			"entry#40",
			"entry#41"
		])
		expect(nodes.find((n) => n.key === "entry#40")?.name).toBe(
			"The Archive"
		)
	})

	it("leaves an entry with no edge off the graph", () => {
		const nodes = graphNodes({
			cast: [],
			relationships: [],
			scopeEntries: [{ id: 90, name: "A room nobody links to" }]
		})
		expect(nodes).toEqual([])
	})

	it("draws an edgeless entry that is in the scope and selected", () => {
		const nodes = graphNodes({
			cast: [],
			relationships: [],
			scopeEntries: [{ id: 90, name: "A room nobody links to" }],
			selectedKey: "entry#90"
		})
		expect(nodes.map((n) => n.name)).toEqual(["A room nobody links to"])
	})

	it("refuses to invent a node for a selection the scope does not hold", () => {
		expect(
			graphNodes({
				cast: [],
				relationships: [],
				scopeEntries: [],
				selectedKey: "entry#90"
			})
		).toEqual([])
	})

	it("names a cast row by its tag when the row carries no name", () => {
		const nodes = graphNodes({
			cast: [{ id: 5, name: "", binding: "{{char:5}}" }],
			relationships: [],
			scopeEntries: []
		})
		expect(nodes[0].name).toBe("{{char:5}}")
	})
})

describe("graphEdges — an edge is drawable when both ends are drawn", () => {
	const keys = new Set(["cast#1", "entry#40"])

	it("keeps an edge whose two ends are both on the graph", () => {
		const edges = graphEdges(
			[
				rel({
					id: 10,
					from: { kind: "cast", bindingId: 1 },
					to: { kind: "entry", entryId: 40 }
				})
			],
			keys
		)
		expect(edges.map((e) => [e.fromKey, e.toKey])).toEqual([
			["cast#1", "entry#40"]
		])
	})

	it("drops an edge that reaches somewhere the graph is not drawing", () => {
		expect(
			graphEdges(
				[
					rel({
						id: 11,
						from: { kind: "cast", bindingId: 1 },
						to: { kind: "cast", bindingId: 99 }
					})
				],
				keys
			)
		).toEqual([])
	})

	it("labels the line with the relationship type, spaced out", () => {
		expect(
			toGraphEdge(rel({ id: 12, relationshipType: "life_debt" })).label
		).toBe("life debt")
	})
})

describe("provenanceOf — where an edge came from", () => {
	it("says lore when nothing dates it", () => {
		expect(provenanceOf(rel({ id: 1 }))).toBe("lore")
	})

	it("says history when a history entry dates it", () => {
		expect(provenanceOf(rel({ id: 1, historyEntryId: 4 }))).toBe("history")
	})

	it("says scene when a scene dates it", () => {
		expect(provenanceOf(rel({ id: 1, sceneId: 9 }))).toBe("scene")
	})

	it("says this session for an edge this session's build made", () => {
		expect(provenanceOf(rel({ id: 1, sceneId: 9 }), new Set([1]))).toBe(
			"new"
		)
	})
})

describe("panelEdges — the open node's own edges, said from its side", () => {
	const names = nodeNames([
		{
			key: "cast#1",
			kind: "cast",
			id: 1,
			name: "Verity",
			state: "active",
			visibility: "normal"
		},
		{
			key: "entry#40",
			kind: "entry",
			id: 40,
			name: "The Archive",
			state: "active",
			visibility: "normal"
		},
		{
			key: "cast#2",
			kind: "cast",
			id: 2,
			name: "Marrow",
			state: "active",
			visibility: "normal"
		}
	])

	const edges = graphEdges(
		[
			rel({
				id: 10,
				relationshipType: "keeper of",
				from: { kind: "cast", bindingId: 1 },
				to: { kind: "entry", entryId: 40 }
			}),
			rel({
				id: 11,
				relationshipType: "ferried by",
				status: "broken",
				from: { kind: "cast", bindingId: 2 },
				to: { kind: "cast", bindingId: 1 }
			}),
			rel({
				id: 12,
				relationshipType: "near",
				from: { kind: "cast", bindingId: 2 },
				to: { kind: "entry", entryId: 40 }
			})
		],
		new Set(["cast#1", "cast#2", "entry#40"])
	)

	it("points an outbound edge away and names the far end", () => {
		const row = panelEdges(castKey(1), edges, names)[0]
		expect(row.arrow).toBe("→")
		expect(row.otherName).toBe("The Archive")
		expect(row.provenanceWord).toBe("from lore")
	})

	it("points an inbound edge back and still names the far end", () => {
		const row = panelEdges(castKey(1), edges, names)[1]
		expect(row.arrow).toBe("←")
		expect(row.otherName).toBe("Marrow")
	})

	it("leaves out an edge the open node is not an end of", () => {
		expect(
			panelEdges(castKey(1), edges, names).map((r) => r.edge.id)
		).toEqual([10, 11])
	})

	it("draws a broken edge as cut", () => {
		const rows = panelEdges(castKey(1), edges, names)
		expect(rows.map((r) => r.cut)).toEqual([false, true])
	})

	it("says a resolved edge's own word rather than calling it cut (#123)", () => {
		const resolved = graphEdges(
			[
				rel({
					id: 20,
					relationshipType: "rival",
					status: "resolved",
					from: { kind: "cast", bindingId: 1 },
					to: { kind: "cast", bindingId: 2 }
				})
			],
			new Set(["cast#1", "cast#2"])
		)
		const [row] = panelEdges(castKey(1), resolved, names)
		expect(row.cut).toBe(false)
		expect(row.statusWord).toBe("resolved")
	})

	it("says nothing beside an active edge", () => {
		expect(panelEdges(castKey(1), edges, names)[0].statusWord).toBeNull()
	})

	it("says nothing about a node that is not open", () => {
		expect(panelEdges(null, edges, names)).toEqual([])
	})

	it("falls back to the key when nothing named the far end", () => {
		expect(panelEdges(entryKey(40), edges, new Map())[0].otherName).toBe(
			"cast#1"
		)
	})
})

describe("entriesWithLinks — how much of the scope is on the graph", () => {
	it("counts scope entries that are an end of at least one edge", () => {
		const relationships = [
			rel({
				id: 10,
				from: { kind: "cast", bindingId: 1 },
				to: { kind: "entry", entryId: 40 }
			}),
			rel({
				id: 11,
				from: { kind: "entry", entryId: 40 },
				to: { kind: "entry", entryId: 99 }
			})
		]
		expect(
			entriesWithLinks(
				[
					{ id: 40, name: "a" },
					{ id: 41, name: "b" }
				],
				relationships
			)
		).toBe(1)
	})
})

describe("graphHeaderLine — the drawing, said out loud", () => {
	it("says the scope, the reach, the links and the silent scenes", () => {
		expect(
			graphHeaderLine({
				scopeLabel: "All entries",
				entriesWithLinks: 6,
				entriesTotal: 30,
				linkCount: 9,
				scenesNamingNone: 1
			})
		).toBe(
			"All entries, as a graph · 6 of 30 entries have relationships · 9 links · 1 scene names none"
		)
	})

	it("says nothing about scenes when every scene names something", () => {
		expect(
			graphHeaderLine({
				scopeLabel: "World lore",
				entriesWithLinks: 1,
				entriesTotal: 2,
				linkCount: 1,
				scenesNamingNone: 0
			})
		).toBe(
			"World lore, as a graph · 1 of 2 entries have relationships · 1 link"
		)
	})

	it("counts more than one silent scene in the plural", () => {
		expect(
			graphHeaderLine({
				scopeLabel: "All entries",
				entriesWithLinks: 0,
				entriesTotal: 0,
				linkCount: 0,
				scenesNamingNone: 3
			})
		).toBe(
			"All entries, as a graph · 0 of 0 entries have relationships · 0 links · 3 scenes name none"
		)
	})
})

describe("ceilingLine — what the last turn actually sent", () => {
	it("says how many got through, what hit the ceiling, and how to raise it", () => {
		expect(
			ceilingLine({
				sent: 4,
				held: 5,
				cappedType: "ferried by",
				ceiling: 4
			})
		).toBe(
			"4 of 5 sent to the model last turn · ferried by hit the ceiling of 4"
		)
	})

	it("says only the count when nothing hit a ceiling", () => {
		expect(ceilingLine({ sent: 4, held: 5 })).toBe(
			"4 of 5 sent to the model last turn"
		)
	})

	it("says nothing at all when no run recorded a figure", () => {
		expect(ceilingLine({})).toBeNull()
		expect(ceilingLine({ held: 5 })).toBeNull()
	})
})

/**
 * The run's own figures, turned into the line's facts.
 *
 * ⚠ The denominator is what the run WALKED, not what a member holds: the
 * mechanism walks the speaker's whole graph under one ceiling, so the sentence
 * is about the turn.
 */
describe("ceilingFactsFrom — the run's relationship figures", () => {
	it("says what got through, out of what was walked, under which ceiling", () => {
		expect(
			ceilingFactsFrom({
				sent: 4,
				considered: 5,
				cap: 4,
				cappedType: "ferried by"
			})
		).toEqual({
			sent: 4,
			held: 5,
			ceiling: 4,
			cappedType: "ferried by"
		})
	})

	it("renders the whole sentence the panel shows", () => {
		expect(
			ceilingLine(
				ceilingFactsFrom({
					sent: 4,
					considered: 5,
					cap: 4,
					cappedType: "ferried by"
				})
			)
		).toBe(
			"4 of 5 sent to the model last turn · ferried by hit the ceiling of 4"
		)
	})

	it("leaves out a ceiling the run never declared", () => {
		expect(ceilingFactsFrom({ sent: 4, considered: 5 })).toEqual({
			sent: 4,
			held: 5
		})
	})

	it("says nothing at all when no run reported on the graph", () => {
		expect(ceilingFactsFrom(undefined)).toEqual({})
		expect(ceilingLine(ceilingFactsFrom(null))).toBeNull()
	})
})

describe("bumpLinkCounts — the Rebuild warning's counts stay true", () => {
	const zero = { total: 0, entryToEntry: 0, castToEntry: 0 }
	it("counts a road between two entries", () => {
		expect(
			bumpLinkCounts(
				zero,
				{ from: { kind: "entry", entryId: 1 }, to: { kind: "entry", entryId: 2 } },
				1
			)
		).toEqual({ total: 1, entryToEntry: 1, castToEntry: 0 })
	})
	it("counts a member-to-entry link", () => {
		expect(
			bumpLinkCounts(
				zero,
				{ from: { kind: "cast", bindingId: 1 }, to: { kind: "entry", entryId: 2 } },
				1
			)
		).toEqual({ total: 1, entryToEntry: 0, castToEntry: 1 })
	})
	it("takes one away and never goes below zero", () => {
		expect(
			bumpLinkCounts(
				{ total: 1, entryToEntry: 0, castToEntry: 0 },
				{ from: { kind: "cast", bindingId: 1 }, to: { kind: "cast", bindingId: 2 } },
				-1
			)
		).toEqual(zero)
		expect(
			bumpLinkCounts(
				zero,
				{ from: { kind: "entry", entryId: 1 }, to: { kind: "entry", entryId: 2 } },
				-1
			)
		).toEqual(zero)
	})
})
