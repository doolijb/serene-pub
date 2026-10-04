/**
 * Where an entry is filed, as arithmetic.
 *
 * A tree the reader can draw is a tree with no rings in it, so the picker
 * refuses the entry itself and everything already inside it — the same refusal
 * the server makes, made here so the reader never offers a move that comes
 * back as an error.
 */
import { describe, expect, it } from "vitest"
import { SCENE_KIND, type PoolItem } from "../poolFilter"
import {
	anchorCandidates,
	canFileUnder,
	containedBy,
	deleteWarning,
	descendantCount,
	descendantKeys
} from "./partOf"

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

const city = item({ id: 1, name: "Umber City" })
const archive = item({ id: 2, name: "The Archive", parentKey: "entry#1" })
const stair = item({ id: 3, name: "The Archive stair", parentKey: "entry#2" })
const ferry = item({ id: 4, name: "Night Ferry" })
const scene = item({
	id: 5,
	key: `scene#5`,
	kind: SCENE_KIND,
	name: "Arrival at the door",
	parentKey: "entry#1"
})
const pool = [city, archive, stair, ferry, scene]

describe("descendantKeys", () => {
	it("names every row inside this one, however deep", () => {
		expect([...descendantKeys("entry#1", pool)]).toEqual(
			expect.arrayContaining(["entry#2", "entry#3"])
		)
	})

	it("names nothing for a row with nothing inside it", () => {
		expect(descendantKeys("entry#4", pool).size).toBe(0)
	})

	it("ends rather than circles when the anchors form a ring", () => {
		const a = item({ id: 6, parentKey: "entry#7" })
		const b = item({ id: 7, parentKey: "entry#6" })
		expect([...descendantKeys("entry#6", [a, b])]).toEqual(["entry#7"])
	})
})

describe("anchorCandidates", () => {
	it("offers every entry but this one and the ones inside it", () => {
		expect(anchorCandidates("entry#1", pool).map((i) => i.key)).toEqual([
			"entry#4"
		])
	})

	it("offers the whole book to a row that is filed nowhere", () => {
		expect(anchorCandidates("entry#4", pool).map((i) => i.key)).toEqual([
			"entry#1",
			"entry#2",
			"entry#3"
		])
	})

	it("offers the whole book to a row that does not exist yet", () => {
		expect(anchorCandidates(null, pool).map((i) => i.key)).toEqual([
			"entry#1",
			"entry#2",
			"entry#3",
			"entry#4"
		])
	})

	it("leaves scenes out: a scene is not an entry and cannot hold one", () => {
		expect(anchorCandidates(null, pool).map((i) => i.key)).not.toContain(
			"scene#5"
		)
	})
})

describe("canFileUnder", () => {
	it("allows a row that is neither this one nor inside it", () => {
		expect(canFileUnder("entry#4", "entry#1", pool)).toBe(true)
	})

	it("refuses the entry itself", () => {
		expect(canFileUnder("entry#1", "entry#1", pool)).toBe(false)
	})

	it("refuses a row already inside this one", () => {
		expect(canFileUnder("entry#1", "entry#3", pool)).toBe(false)
	})

	it("allows the top level, which is the absence of a parent", () => {
		expect(canFileUnder("entry#3", null, pool)).toBe(true)
	})

	it("refuses a scene as the parent", () => {
		expect(canFileUnder("entry#4", "scene#5", pool)).toBe(false)
	})
})

describe("containedBy", () => {
	it("lists the rows filed directly under this one", () => {
		expect(containedBy("entry#1", pool).map((i) => i.key)).toEqual([
			"entry#2"
		])
	})
})

describe("deleteWarning", () => {
	it("says how many rows go with it, because the delete cascades", () => {
		expect(deleteWarning(3)).toContain("Contains 3")
	})

	it("counts one row in the singular", () => {
		expect(deleteWarning(1)).toContain("Contains 1")
	})

	it("says nothing about contents when nothing is filed under it", () => {
		expect(deleteWarning(0)).not.toContain("Contains")
	})

	it("says a shared entry leaves every line, and names the line-only way", () => {
		const text = deleteWarning(0, { everyLine: true })
		expect(text).toContain("removes it from every line")
		expect(text).toContain("Off for a while")
		expect(deleteWarning(2, { everyLine: true })).toContain("Contains 2")
	})

	it("says nothing about lines for an entry that is not shared", () => {
		expect(deleteWarning(0)).not.toContain("every line")
	})
})

describe("descendantCount", () => {
	it("counts the whole subtree, grandchildren included", () => {
		// Umber City holds the Archive, which holds the stair: two go with it.
		expect(descendantCount("entry#1", pool)).toBe(2)
	})

	it("leaves scenes out: the anchor cascade does not follow them", () => {
		expect(descendantKeys("entry#1", pool).has("scene#5")).toBe(true)
		expect(descendantCount("entry#1", pool)).toBe(2)
	})

	it("is zero for a leaf, and ends on a ring", () => {
		expect(descendantCount("entry#4", pool)).toBe(0)
		const a = item({ id: 6, parentKey: "entry#7" })
		const b = item({ id: 7, parentKey: "entry#6" })
		expect(descendantCount("entry#6", [a, b])).toBe(1)
	})
})

describe("canFileUnder — never under another line's own entry", () => {
	const shared = item({ id: 10, name: "Shared" })
	const forkOnly = item({ id: 11, name: "Fork only", branchId: 7 })
	const alsoFork = item({ id: 12, name: "Also fork", branchId: 7 })
	const sibling = item({ id: 13, name: "Sibling", branchId: 8 })
	const lines = [shared, forkOnly, alsoFork, sibling]

	it("refuses a shared entry under a branch-only parent (the cascade would take it)", () => {
		expect(canFileUnder("entry#10", "entry#11", lines)).toBe(false)
	})

	it("allows a branch entry under a parent on the same line, or a shared one", () => {
		expect(canFileUnder("entry#12", "entry#11", lines)).toBe(true)
		expect(canFileUnder("entry#12", "entry#10", lines)).toBe(true)
	})

	it("refuses a sibling line's parent", () => {
		expect(canFileUnder("entry#12", "entry#13", lines)).toBe(false)
	})

	it("checks a row being written against the line it lands on, when told", () => {
		expect(canFileUnder(null, "entry#11", lines, null)).toBe(false)
		expect(canFileUnder(null, "entry#11", lines, 7)).toBe(true)
		expect(anchorCandidates(null, lines, null).map((i) => i.id)).toEqual([10])
	})
})

describe("canFileUnder — only a type that declares a parent is filed (places plan B2)", () => {
	// `core:entry/location@1` declares no `parent` field role (owner ruling
	// 2026-09-29: places join by relationships, never by nesting). The picker
	// asks the role map, as the server does, never a type id of its own.
	const keep = item({ id: 20, name: "The Keep", kind: "core:entry/location" })
	const cellar = item({ id: 21, name: "The Cellar", kind: "core:entry/location" })
	const reach = item({ id: 22, name: "The Reach" })
	const altar = item({ id: 23, name: "The Altar" })
	const map = [keep, cellar, reach, altar]

	it("refuses a place filed under a place, or under world lore", () => {
		expect(canFileUnder("entry#21", "entry#20", map)).toBe(false)
		expect(canFileUnder("entry#21", "entry#22", map)).toBe(false)
		expect(anchorCandidates("entry#21", map)).toEqual([])
	})

	it("still lets a place be moved to the top level", () => {
		expect(canFileUnder("entry#21", null, map)).toBe(true)
	})

	it("leaves world lore filing as it was", () => {
		expect(canFileUnder("entry#23", "entry#22", map)).toBe(true)
	})

	// Q2 (a), the plan's default until the owner answers: a place is never a
	// child, but lore may sit under a place (the altar in the Chapel).
	it("still lets lore be filed under a place", () => {
		expect(canFileUnder("entry#23", "entry#20", map)).toBe(true)
		expect(anchorCandidates("entry#23", map).map((i) => i.id)).toEqual([
			20, 21, 22
		])
	})
})

/** Note 1 (owner, 2026-10-02): history is always top level. */
describe("history is never filed", () => {
	const HISTORY = "core:entry/history"
	const pool = [
		item({ id: 1 }),
		item({ id: 2, kind: HISTORY }),
		item({ id: 3 })
	]

	it("refuses filing a history entry under anything", () => {
		expect(canFileUnder("entry#2", "entry#1", pool)).toBe(false)
		expect(anchorCandidates("entry#2", pool)).toEqual([])
	})

	it("still lets other lore be filed under a history entry", () => {
		expect(canFileUnder("entry#3", "entry#2", pool)).toBe(true)
	})

	it("always lets a history entry go back to the top level", () => {
		expect(canFileUnder("entry#2", null, pool)).toBe(true)
	})
})
