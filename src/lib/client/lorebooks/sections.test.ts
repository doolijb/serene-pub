import { describe, expect, it } from "vitest"
import { LORE_SCOPES, SCOPE_LABELS, type LoreScope } from "./loreRoute"
import type { PoolItem } from "./poolFilter"
import { containedBy } from "./editor/partOf"
import {
	SECTION_DESCRIPTORS,
	bookPoolItems,
	descriptorFor,
	descriptorForKind,
	doorForKey,
	draftStale,
	editorPlaceholder,
	isScopeDoor,
	poolKindsOf
} from "./sections"

/**
 * The fallback is a bootstrap, never a destination.
 *
 * A section that ships without a curated row, a curated editor or its own
 * empty copy renders as the generic placeholder, and a placeholder that
 * reaches a user is indistinguishable from a finished screen nobody wrote
 * copy for. This is the alarm on that.
 */
describe("section descriptors", () => {
	it("covers every scope that draws a pool", () => {
		expect(SECTION_DESCRIPTORS.map((d) => d.id)).toEqual([
			"all",
			"world",
			"characters",
			"history",
			"scenes"
		])
	})

	for (const descriptor of SECTION_DESCRIPTORS) {
		describe(descriptor.id, () => {
			it("supplies a curated row", () => {
				expect(descriptor.row).toBeTruthy()
			})

			it("supplies a curated editor", () => {
				expect(descriptor.editor).toBeTruthy()
			})

			it("supplies empty copy that says what to do next", () => {
				expect(descriptor.emptyCopy.title.length).toBeGreaterThan(0)
				expect(descriptor.emptyCopy.body.length).toBeGreaterThan(0)
				expect(descriptor.emptyCopy.action.length).toBeGreaterThan(0)
			})

			it("has a non-empty label the navigation can print", () => {
				expect(descriptor.label.length).toBeGreaterThan(0)
				if (isScopeDoor(descriptor))
					expect(descriptor.label).toBe(
						SCOPE_LABELS[descriptor.id as LoreScope]
					)
			})

			it("has an icon", () => {
				expect(descriptor.icon).toBeTruthy()
			})

			it("declares at least one inspector tab slot", () => {
				expect(Array.isArray(descriptor.inspector)).toBe(true)
			})

			it("names a scope the route can address, or is curated inside one", () => {
				if (isScopeDoor(descriptor))
					expect(LORE_SCOPES).toContain(descriptor.id)
				else expect(descriptor.kind).toBeTruthy()
			})
		})
	}

	it("never says the words entry type in copy a user reads", () => {
		for (const d of SECTION_DESCRIPTORS) {
			const copy = [
				d.label,
				d.emptyCopy.title,
				d.emptyCopy.body,
				d.emptyCopy.action,
				d.newLabel
			].join(" ")
			expect(copy.toLowerCase()).not.toContain("entry type")
		}
	})

	it("resolves a scope to its descriptor", () => {
		expect(descriptorFor("world")?.id).toBe("world")
		// Cast is a board of people and Places has no kind yet, so neither
		// draws the pool.
		expect(descriptorFor("cast")).toBeUndefined()
		expect(descriptorFor("places")).toBeUndefined()
	})

	it("keeps Character Lore as a door with no scope, because Cast holds it", () => {
		const characters = SECTION_DESCRIPTORS.find(
			(d) => d.id === "characters"
		)!
		expect(isScopeDoor(characters)).toBe(false)
		expect(LORE_SCOPES as readonly string[]).not.toContain("characters")
		// Still in the pool: a member's lore is listed on their page AND in
		// All entries, and both read the same curated row.
		expect(descriptorForKind(characters.kind!)?.id).toBe("characters")
	})

	it("resolves a kind back to the descriptor that curates it", () => {
		const world = descriptorFor("world")!
		expect(descriptorForKind(world.typeId!)?.id).toBe("world")
		expect(descriptorForKind("scene")?.id).toBe("scenes")
		expect(descriptorForKind("core:entry/nothing")).toBeUndefined()
	})

	it("presets a narrowed scope to its one kind and leaves the pool open", () => {
		expect(poolKindsOf(descriptorFor("history")!)).toEqual([
			"core:entry/history"
		])
		expect(poolKindsOf(descriptorFor("all")!)).toEqual([])
	})
})

const WORLD = "core:entry/world-lore"
const HISTORY = "core:entry/history"

function poolItem(key: string, kind: string): PoolItem {
	return {
		key,
		id: Number(key.split("#")[1]),
		kind,
		name: key,
		content: "",
		keys: "",
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		order: 0,
		position: 0,
		priority: 0,
		createdAt: 0,
		updatedAt: 0
	}
}

/**
 * "All entries" is a list of several kinds, so the row that is open decides
 * which editor is drawn. A section that answered with its own door would open
 * every row in the generic one, which is the placeholder this pool exists to
 * avoid.
 */
describe("doorForKey — the door that owns the row an address names", () => {
	const pool = [
		poolItem("entry#1", WORLD),
		poolItem("entry#2", HISTORY),
		poolItem("scene#3", "scene")
	]

	it("opens a row of the pool in the door that curates its kind", () => {
		const all = descriptorFor("all")!
		expect(doorForKey("entry#1", pool, all).id).toBe("world")
		expect(doorForKey("entry#2", pool, all).id).toBe("history")
		expect(doorForKey("scene#3", pool, all).id).toBe("scenes")
	})

	it("stays on the scope's own door when nothing is addressed", () => {
		expect(doorForKey(null, pool, descriptorFor("world")!).id).toBe("world")
	})

	it("stays on the scope's own door for a row the pool does not hold", () => {
		expect(doorForKey("entry#404", pool, descriptorFor("all")!).id).toBe(
			"all"
		)
	})
})

/**
 * Empty copy is about an empty book. A pool with rows in it and nothing open
 * is a different fact, and answering it with "this lorebook is empty" is a
 * wrong one.
 */
describe("editorPlaceholder — the editor column with nothing open", () => {
	it("says what to do next when the pool has rows", () => {
		expect(
			editorPlaceholder({
				descriptor: descriptorFor("all")!,
				poolEmpty: false,
				canCreate: true
			})
		).toBe("Pick an entry to edit it, or press New.")
	})

	it("leaves out a New the door does not offer", () => {
		expect(
			editorPlaceholder({
				descriptor: descriptorFor("scenes")!,
				poolEmpty: false,
				canCreate: false
			})
		).toBe("Pick an entry to edit it.")
	})

	it("uses the door's empty copy only when the pool is empty", () => {
		expect(
			editorPlaceholder({
				descriptor: descriptorFor("all")!,
				poolEmpty: true,
				canCreate: true
			})
		).toBe(descriptorFor("all")!.emptyCopy.title)
	})
})

/**
 * A draft is discarded by a re-derivation it did not ask for, and an editor is
 * left empty by one it did. Both of those are this predicate.
 */
describe("draftStale — when the editor's draft is rebuilt", () => {
	it("rebuilds when the address moves to another row", () => {
		expect(
			draftStale({
				key: "entry#2",
				draftKey: "entry#1",
				hasDraft: true,
				hasSource: true
			})
		).toBe(true)
	})

	it("rebuilds when the addressed row arrives after the address does", () => {
		// The deep link, and the row that has just been created: the address
		// names a row the list had not sent yet.
		expect(
			draftStale({
				key: "entry#1",
				draftKey: "entry#1",
				hasDraft: false,
				hasSource: true
			})
		).toBe(true)
	})

	it("leaves a draft that is being typed in alone when the list arrives", () => {
		expect(
			draftStale({
				key: "entry#1",
				draftKey: "entry#1",
				hasDraft: true,
				hasSource: true
			})
		).toBe(false)
	})

	it("waits rather than emptying the editor for a row that has not arrived", () => {
		expect(
			draftStale({
				key: "entry#1",
				draftKey: "entry#1",
				hasDraft: false,
				hasSource: false
			})
		).toBe(false)
	})

	it("clears the draft when the address names no row at all", () => {
		expect(
			draftStale({
				key: null,
				draftKey: "entry#1",
				hasDraft: true,
				hasSource: false
			})
		).toBe(true)
	})
})

/**
 * The pool the editor resolves a parent, a reference and a cascade against.
 *
 * ⚠ **The book, not the scope.** Filing crosses kinds: a history entry can be
 * filed under a world entry, and a pool narrowed to World answers "nothing is
 * filed under this" about a row that has a child — which is then what the
 * delete confirmation promises before it cascades over it.
 */
describe("bookPoolItems — every row the book holds", () => {
	const city = { id: 4, name: "Umber City", typeId: WORLD } as any
	const winter = {
		id: 7,
		name: "The long winter",
		typeId: HISTORY,
		year: 2,
		anchorEntryId: 4
	} as any

	it("draws rows of every kind, scenes included", () => {
		const pool = bookPoolItems({ [WORLD]: [city], [HISTORY]: [winter] }, [
			{ id: 9, name: "Arrival at the door" } as any
		])
		expect(pool.map((item) => item.key)).toEqual(
			expect.arrayContaining(["entry#4", "entry#7", "scene#9"])
		)
	})

	it("sees a child of another kind, which one scope's pool cannot", () => {
		const worldScope = bookPoolItems({ [WORLD]: [city] }, [])
		expect(containedBy("entry#4", worldScope)).toEqual([])

		const book = bookPoolItems({ [WORLD]: [city], [HISTORY]: [winter] }, [])
		expect(containedBy("entry#4", book).map((item) => item.key)).toEqual([
			"entry#7"
		])
	})

	it("never draws a row twice for the door that holds every kind", () => {
		const pool = bookPoolItems({ [WORLD]: [city] }, [])
		expect(pool.filter((item) => item.key === "entry#4")).toHaveLength(1)
	})
})
