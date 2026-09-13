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
	descendantKeys
} from "./partOf"

function item(over: Partial<PoolItem> & { id: number }): PoolItem {
	return {
		key: `entry#${over.id}`,
		kind: "core:entry/world-lore",
		name: `Entry ${over.id}`,
		content: "",
		keys: "",
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
})
