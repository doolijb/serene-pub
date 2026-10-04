/**
 * The Places lens, as arithmetic (plan places-graph §10.2, B4): every place on
 * the line is a node, whether or not anything joins it yet; every relationship
 * that touches a place is an edge, whatever its type; the cast members and the
 * other lore joined to a place come with it; and the names and archiving are
 * the RESOLVED rows', so an amended name and a dated archive show.
 */
import { describe, expect, it } from "vitest"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { RelationshipLike } from "../graphs/graphModel"
import {
	buildPlaceGraph,
	linkCandidates,
	newPlaceEntry,
	placeGraphHeadline,
	relationshipsOfPlaces,
	placeNode
} from "./placeGraph"
import { descriptorForKind } from "../sections"

const place = (
	id: number,
	name: string,
	over: { archived?: boolean; category?: string | null } = {}
) => ({ id, name, ...over })

const entryEnd = (entryId: number, name = `#${entryId}`) => ({
	kind: "entry" as const,
	entryId,
	name
})
const castEnd = (bindingId: number) => ({ kind: "cast" as const, bindingId })

const rel = (
	id: number,
	from: RelationshipLike["from"],
	to: RelationshipLike["to"],
	over: Partial<RelationshipLike> = {}
): RelationshipLike => ({
	id,
	from,
	to,
	relationshipType: "leads to",
	status: "active",
	description: "",
	historyEntryId: null,
	sceneId: null,
	...over
})

const cast = [
	{ id: 7, name: "Verity" },
	{ id: 8, name: "Marrow" }
]

const GUARDROOM = 1
const HALL = 2
const CRYPT = 3
const REACH = 50 // world lore: a region that is only lore

const places = [
	place(GUARDROOM, "The Guardroom", { category: "Keep" }),
	place(HALL, "The Drowned Hall", { category: "cellar" }),
	place(CRYPT, "The Crypt", { category: "Cellar" })
]

const build = (over: Partial<Parameters<typeof buildPlaceGraph>[0]> = {}) =>
	buildPlaceGraph({
		places,
		otherEntries: [{ id: REACH, name: "The Reach" }],
		cast,
		relationships: [],
		...over
	})

const keys = (g: ReturnType<typeof buildPlaceGraph>) =>
	g.nodes.map((n) => n.key)

describe("buildPlaceGraph — nodes", () => {
	it("draws every place, including one nothing joins yet", () => {
		const g = build()
		expect(keys(g)).toEqual(["entry#1", "entry#2", "entry#3"])
		expect(g.nodes.every((n) => n.typeId === LOCATION_TYPE_ID)).toBe(true)
		expect(g.edges).toEqual([])
	})

	it("names a place by its resolved row, not the edge's base name", () => {
		const g = build({
			places: [
				place(GUARDROOM, "The Watch Room"),
				place(HALL, "The Hall")
			],
			relationships: [
				rel(
					10,
					entryEnd(GUARDROOM, "The Guardroom"),
					entryEnd(HALL, "The Hall")
				)
			]
		})
		expect(g.nodes.find((n) => n.id === GUARDROOM)?.name).toBe(
			"The Watch Room"
		)
	})

	it("leaves out a place archived as of the moment, and its edges with it", () => {
		const g = build({
			places: [
				place(GUARDROOM, "The Guardroom"),
				place(HALL, "The Drowned Hall", { archived: true })
			],
			relationships: [rel(10, entryEnd(GUARDROOM), entryEnd(HALL))]
		})
		expect(keys(g)).toEqual(["entry#1"])
		expect(g.edges).toEqual([])
		expect(g.placeTotal).toBe(1)
	})

	it("brings a cast member joined to a place by any relationship", () => {
		const g = build({
			relationships: [
				rel(10, castEnd(7), entryEnd(CRYPT), {
					relationshipType: "haunts"
				})
			]
		})
		expect(keys(g)).toContain("cast#7")
		expect(keys(g)).not.toContain("cast#8")
		expect(g.nodes.find((n) => n.key === "cast#7")?.name).toBe("Verity")
	})

	it("brings other lore joined to a place — a region that is only lore", () => {
		const g = build({
			relationships: [
				rel(10, entryEnd(HALL), entryEnd(REACH, "Old Reach"), {
					relationshipType: "is inside",
					reverseRelationshipType: "holds"
				})
			]
		})
		const reach = g.nodes.find((n) => n.key === "entry#50")
		expect(reach?.name).toBe("The Reach")
		expect(reach?.typeId).not.toBe(LOCATION_TYPE_ID)
	})

	it("leaves out lore that is archived or off this line", () => {
		const g = build({
			otherEntries: [{ id: REACH, name: "The Reach", archived: true }],
			relationships: [
				rel(10, entryEnd(HALL), entryEnd(REACH)),
				rel(11, entryEnd(HALL), entryEnd(99, "Elsewhere"))
			]
		})
		expect(keys(g)).toEqual(["entry#1", "entry#2", "entry#3"])
		expect(g.edges).toEqual([])
	})
})

describe("buildPlaceGraph — edges", () => {
	it("draws every place↔place relationship, whatever its type", () => {
		const g = build({
			relationships: [
				rel(10, entryEnd(GUARDROOM), entryEnd(HALL), {
					relationshipType: "is haunted by the memory of"
				}),
				rel(11, entryEnd(HALL), entryEnd(CRYPT))
			]
		})
		expect(g.edges.map((e) => e.id)).toEqual([10, 11])
	})

	it("draws nothing that does not touch a place", () => {
		const g = build({
			relationships: [
				rel(10, castEnd(7), entryEnd(CRYPT), {
					relationshipType: "lives in"
				}),
				rel(11, castEnd(8), entryEnd(HALL), {
					relationshipType: "keeper of"
				}),
				// Two members both on the map: a tie between them is not a place's.
				rel(12, castEnd(7), castEnd(8), { relationshipType: "ally" }),
				// Two lore entries: no way anywhere.
				rel(13, entryEnd(REACH), entryEnd(51, "The Order"))
			],
			otherEntries: [
				{ id: REACH, name: "The Reach" },
				{ id: 51, name: "The Order" }
			]
		})
		expect(g.edges.map((e) => e.id)).toEqual([10, 11])
	})

	it("reads a both-ways relationship both ways, and a one-way one once", () => {
		const g = build({
			relationships: [
				rel(10, entryEnd(GUARDROOM), entryEnd(HALL), {
					relationshipType: "leads north to",
					reverseRelationshipType: "leads south to",
					name: "the rusted iron door"
				}),
				rel(11, entryEnd(HALL), entryEnd(CRYPT))
			]
		})
		expect(g.edges.map((e) => [e.label, e.bothWays])).toEqual([
			["the rusted iron door", true],
			["leads to", false]
		])
	})

	it("marks what this session's build proposed", () => {
		const g = build({
			relationships: [rel(10, entryEnd(GUARDROOM), entryEnd(HALL))],
			newIds: new Set([10])
		})
		expect(g.edges[0].provenance).toBe("new")
	})
})

describe("buildPlaceGraph — category", () => {
	it("tints each place by its category and lists the categories once", () => {
		const g = build()
		expect(g.nodes.map((n) => n.category ?? null)).toEqual([
			"Keep",
			"cellar",
			"Cellar"
		])
		expect(g.categories).toEqual(["cellar", "Keep"])
	})

	it("narrows the places to one category, whatever its case", () => {
		const g = build({
			category: "CELLAR",
			relationships: [
				rel(10, entryEnd(GUARDROOM), entryEnd(HALL)),
				rel(11, entryEnd(HALL), entryEnd(CRYPT))
			]
		})
		expect(keys(g)).toEqual(["entry#2", "entry#3"])
		expect(g.edges.map((e) => e.id)).toEqual([11])
		expect(g.placeCount).toBe(2)
		expect(g.placeTotal).toBe(3)
	})
})

describe("buildPlaceGraph — a category no place carries", () => {
	it("narrows nothing, and says no category is in force", () => {
		const g = build({ category: "Tower" })
		expect(g.placeCount).toBe(3)
		expect(g.category).toBeNull()
	})

	it("names the category in force as the places first wrote it", () => {
		expect(build({ category: "CELLAR" }).category).toBe("cellar")
	})
})

describe("relationshipsOfPlaces — the relationships a place is an end of", () => {
	it("keeps those with a drawn place at either end", () => {
		const rels = [
			rel(10, entryEnd(GUARDROOM), entryEnd(HALL)),
			rel(11, castEnd(7), entryEnd(CRYPT)),
			rel(12, castEnd(7), castEnd(8))
		]
		expect(
			relationshipsOfPlaces(rels, new Set([GUARDROOM, CRYPT])).map(
				(r) => r.id
			)
		).toEqual([10, 11])
	})
})

describe("linkCandidates — every place on the line, and the canvas", () => {
	it("offers the canvas nodes and every live place not already on it", () => {
		const onCanvas = build({ category: "Keep" }).nodes
		const offered = linkCandidates(onCanvas, [
			...places,
			place(4, "The Old Well", { archived: true })
		])
		expect(offered.map((n) => [n.key, n.name])).toEqual([
			["entry#1", "The Guardroom"],
			["entry#2", "The Drowned Hall"],
			["entry#3", "The Crypt"]
		])
	})

	it("offers a member no link has put on the map yet, once", () => {
		const onCanvas = build({ category: "Keep" }).nodes
		const verity = {
			key: "cast#7",
			kind: "cast" as const,
			id: 7,
			name: "Verity",
			state: "active",
			visibility: "normal"
		}
		const offered = linkCandidates(onCanvas, places, [verity, verity])
		expect(offered.map((n) => n.key)).toEqual([
			"entry#1",
			"entry#2",
			"entry#3",
			"cast#7"
		])
	})
})

describe("placeGraphHeadline — the drawing, said out loud", () => {
	it("says there are no places yet, and how to make one", () => {
		expect(placeGraphHeadline(build({ places: [] }), null)).toBe(
			"Places · none yet · New place adds the first"
		)
	})

	it("counts the places, the links, and the places nothing joins", () => {
		const g = build({
			relationships: [rel(10, entryEnd(GUARDROOM), entryEnd(HALL))]
		})
		expect(placeGraphHeadline(g, null)).toBe(
			"Places · 3 places · 1 link · 1 with no links"
		)
	})

	it("says which category it is narrowed to", () => {
		expect(
			placeGraphHeadline(build({ category: "cellar" }), "cellar")
		).toBe("Places · 2 of 3 places in cellar · 0 links · 2 with no links")
	})
})

describe("newPlaceEntry — what making a place sends", () => {
	it("makes a named Places entry on the line being read", () => {
		const { entry } = newPlaceEntry(9, "  The Old Well ", 4) as any
		expect(entry.typeId).toBe(LOCATION_TYPE_ID)
		expect(entry.lorebookId).toBe(9)
		expect(entry.name).toBe("The Old Well")
		expect(entry.branchId).toBe(4)
		expect(entry.enabled).toBe(true)
	})

	it("sends no line on main", () => {
		const { entry } = newPlaceEntry(9, "The Old Well", null) as any
		expect("branchId" in entry).toBe(false)
	})

	it("is the Places door's own New place, named — one draft for every way a place is made", () => {
		const door = descriptorForKind(LOCATION_TYPE_ID)!
		const { entry } = newPlaceEntry(9, "The Old Well", null) as any
		expect(entry).toEqual({ ...door.newDraft(9), name: "The Old Well" })
	})
})

describe("placeNode — a place row, as a node", () => {
	it("is an entry node that says it is a place", () => {
		expect(placeNode({ id: 4, name: " ", category: "well" })).toMatchObject(
			{
				key: "entry#4",
				kind: "entry",
				id: 4,
				name: "#4",
				typeId: LOCATION_TYPE_ID,
				category: "well"
			}
		)
	})
})
