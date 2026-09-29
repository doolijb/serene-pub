/**
 * What points at this entry, and what each reference would leave behind.
 *
 * ⚠ **A reference is a text match over the pool, never a retrieval decision.**
 * It answers "what else in this book talks about this", which is the question
 * a reader asks before deleting something; the Read in? tab is what says
 * whether an entry reached a prompt.
 */
import { describe, expect, it } from "vitest"
import { SCENE_KIND, type PoolItem } from "../poolFilter"
import { castMacroLines, entryRefs, refLinksFrom, type RefLink } from "./refs"

function item(over: Partial<PoolItem> & { id: number }): PoolItem {
	return {
		key: `entry#${over.id}`,
		kind: "core:entry/world-lore",
		name: `Entry ${over.id}`,
		content: "",
		keys: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: 0,
		position: over.id,
		priority: 0,
		createdAt: 0,
		updatedAt: 0,
		...over
	}
}

const city = item({ id: 1, name: "Umber City", keys: ["umber", "umber city"] })
const archive = item({
	id: 2,
	name: "The Archive",
	parentKey: "entry#1",
	content: "The great library of Umber City, kept by Verity."
})
const ferry = item({
	id: 3,
	name: "Night Ferry",
	content:
		"A flat-bottomed boat that has run the same route every night for as long as anyone in it can remember, from the Low Quarter of Umber City to the Archive stair, and back again before the bells."
})
const scene = item({
	id: 4,
	key: "scene#4",
	kind: SCENE_KIND,
	name: "Arrival at the door",
	content: "Wren asks whether this is Umber City."
})
const keeper = item({
	id: 5,
	name: "Verity",
	kind: "core:entry/character-lore",
	content: "Keeper of The Archive."
})
const elsewhere = item({ id: 6, name: "Salt Road", content: "It rains." })
const pool = [city, archive, ferry, scene, keeper, elsewhere]

const refsOf = (subject: PoolItem) => entryRefs(subject, pool)

describe("entryRefs — what points at this entry", () => {
	it("quotes the sentence a reference comes from", () => {
		const row = refsOf(city).find((r) => r.item.key === "entry#2")
		expect(row?.clauses[0]).toBe(
			"“The great library of Umber City, kept by Verity.”"
		)
	})

	it("says the reference plainly when the sentence is a paragraph", () => {
		const row = refsOf(city).find((r) => r.item.key === "entry#3")
		expect(row?.clauses).toEqual(["names Umber City in its content"])
	})

	it("says a row that is also filed under it sits inside it", () => {
		const row = refsOf(city).find((r) => r.item.key === "entry#2")
		expect(row?.clauses).toContain("and sits inside it")
	})

	it("marks a scene's mention as coming from a session", () => {
		const row = refsOf(city).find((r) => r.item.key === "scene#4")
		expect(row?.tag).toBe("session")
		expect(row?.clauses[0]).toBe("“Wren asks whether this is Umber City.”")
	})

	it("leaves out rows that name nothing", () => {
		expect(refsOf(city).map((r) => r.item.key)).not.toContain("entry#6")
	})

	it("does not report an entry as pointing at itself", () => {
		expect(refsOf(city).map((r) => r.item.key)).not.toContain("entry#1")
	})
})

describe("entryRefs — two steps away", () => {
	it("names the row it went through, and marks it indirect", () => {
		const row = refsOf(city).find((r) => r.item.key === "entry#5")
		expect(row?.tag).toBe("indirect")
		expect(row?.clauses).toEqual([
			"names The Archive, which is inside Umber City"
		])
	})

	it("puts the direct references first", () => {
		expect(
			refsOf(city)
				.map((r) => r.tag)
				.at(-1)
		).toBe("indirect")
	})

	it("counts a row that names the entry itself as direct, not indirect", () => {
		const row = refsOf(city).find((r) => r.item.key === "entry#2")
		expect(row?.tag).toBeNull()
	})
})

/**
 * The half of the Refs board no text scan can find.
 *
 * An edge is a typed join somebody drew, so it says what the join IS — "keeper
 * of", "connects to" — where a text match can only say a name occurred. Both
 * directions count: a road is drawn once and both places are on it.
 */
describe("entryRefs — edges", () => {
	const castEnd = { key: "cast#3", id: 3, kind: "cast", name: "Verity" }
	const archiveEnd = {
		key: "entry#2",
		id: 2,
		kind: "core:entry/world-lore",
		name: "The Archive"
	}
	const cityEnd = {
		key: "entry#1",
		id: 1,
		kind: "core:entry/world-lore",
		name: "Umber City"
	}
	const ferryEnd = {
		key: "entry#3",
		id: 3,
		kind: "core:entry/world-lore",
		name: "Night Ferry"
	}

	const keeps: RefLink = {
		id: 10,
		from: castEnd,
		to: archiveEnd,
		type: "keeper of"
	}

	it("counts a cast member joined to this entry as a direct reference", () => {
		const rows = entryRefs(archive, pool, [keeps])
		const row = rows.find((r) => r.item.key === "cast#3")
		expect(row?.tag).toBeNull()
		expect(row?.clauses).toContain("keeper of · The Archive")
		expect(row?.item.name).toBe("Verity")
	})

	it("counts the edge whichever end the subject is", () => {
		const drawn: RefLink = {
			id: 11,
			from: archiveEnd,
			to: ferryEnd,
			type: "connects to"
		}
		const rows = entryRefs(archive, pool, [drawn])
		expect(rows.find((r) => r.item.key === "entry#3")?.clauses).toContain(
			"connects to · The Archive"
		)
	})

	it("marks an edge that lands on this entry's parent as indirect", () => {
		const lives: RefLink = {
			id: 12,
			from: castEnd,
			to: cityEnd,
			type: "lives in"
		}
		const row = entryRefs(archive, pool, [lives]).find(
			(r) => r.item.key === "cast#3"
		)
		expect(row?.tag).toBe("indirect")
		expect(row?.clauses).toEqual([
			"lives in · Umber City, which this entry is inside"
		])
	})

	it("resolves an entry endpoint to the row the pool holds", () => {
		const drawn: RefLink = {
			id: 13,
			from: ferryEnd,
			to: archiveEnd,
			type: "runs past"
		}
		const row = entryRefs(archive, pool, [drawn]).find(
			(r) => r.item.key === "entry#3"
		)
		expect(row?.item).toBe(ferry)
	})

	it("lists a row that both names and is joined to this entry once", () => {
		const drawn: RefLink = {
			id: 14,
			from: { ...archiveEnd, key: "entry#5", id: 5, name: "Verity" },
			to: archiveEnd,
			type: "keeper of"
		}
		const rows = entryRefs(archive, pool, [drawn]).filter(
			(r) => r.item.key === "entry#5"
		)
		expect(rows).toHaveLength(1)
		expect(rows[0].clauses).toEqual([
			"“Keeper of The Archive.”",
			"keeper of · The Archive"
		])
	})

	it("says nothing about an entry whose edges the book has not loaded", () => {
		expect(entryRefs(archive, pool).map((r) => r.item.key)).not.toContain(
			"cast#3"
		)
	})
})

/**
 * The wire's edges, read the way the board needs them.
 *
 * ⚠ `from`/`to` and never the pair of node ids beside them: those are kept for
 * one release and are null on an entry endpoint, so a reader bound to them sees
 * every road in the book as having no ends.
 */
describe("refLinksFrom", () => {
	const row = (over: Record<string, any>) =>
		({
			id: 1,
			lorebookId: 1,
			fromNodeId: null,
			toNodeId: null,
			fromEntryId: null,
			toEntryId: null,
			historyEntryId: null,
			sceneId: null,
			relationshipType: "keeper of",
			description: "",
			visibility: "acknowledged",
			status: "active",
			reason: null,
			embedding: null,
			embeddingModel: null,
			createdAt: 0,
			updatedAt: 0,
			...over
		}) as any

	it("keys an entry endpoint the way the pool keys its rows", () => {
		const [link] = refLinksFrom(
			[
				row({
					from: {
						kind: "entry",
						entryId: 3,
						name: "Night Ferry",
						typeId: "core:entry/world-lore"
					},
					to: {
						kind: "entry",
						entryId: 2,
						name: "The Archive",
						typeId: "core:entry/world-lore"
					},
					relationshipType: "runs past"
				})
			],
			new Map()
		)
		expect(link.from.key).toBe("entry#3")
		expect(link.from.kind).toBe("core:entry/world-lore")
		expect(link.type).toBe("runs past")
	})

	it("names a cast endpoint from the nodes the list carries", () => {
		const [link] = refLinksFrom(
			[
				row({
					from: { kind: "cast", bindingId: 3 },
					to: {
						kind: "entry",
						entryId: 2,
						name: "The Archive",
						typeId: "core:entry/world-lore"
					}
				})
			],
			new Map([[3, "Verity"]])
		)
		expect(link.from).toEqual({
			key: "cast#3",
			id: 3,
			kind: "cast",
			name: "Verity"
		})
	})

	it("says which binding it is when the nodes do not name it", () => {
		const [link] = refLinksFrom(
			[
				row({
					from: { kind: "cast", bindingId: 9 },
					to: { kind: "cast", bindingId: 3 }
				})
			],
			new Map()
		)
		expect(link.from.name).toBe("#9")
	})
})

describe("castMacroLines — what a cast macro resolves to", () => {
	const resolve = (tag: string) => (tag === "{{char:1}}" ? "Verity" : null)

	it("names the session the resolution belongs to", () => {
		expect(
			castMacroLines(
				"{{char:1}} keeps the stair.",
				resolve,
				"The Open Door"
			)
		).toEqual([
			"{{char:1}} in this entry resolves to Verity in the attached session."
		])
	})

	it("says the name alone when no session is reading the book", () => {
		expect(
			castMacroLines("{{char:1}} keeps the stair.", resolve, null)
		).toEqual(["{{char:1}} in this entry resolves to Verity."])
	})

	it("says so when the slot names nobody", () => {
		expect(castMacroLines("{{char:9}}", resolve, null)).toEqual([
			"{{char:9}} in this entry resolves to nobody in this book."
		])
	})

	it("says one line per slot, however often each is written", () => {
		expect(
			castMacroLines("{{char:1}} and {{char:1}}", resolve, null)
		).toHaveLength(1)
	})

	it("says nothing about an entry with no cast macro in it", () => {
		expect(castMacroLines("Just words.", resolve, null)).toEqual([])
	})
})
