/**
 * A place's Stats section, as arithmetic (plan places-graph L4).
 *
 * What the lorebook holds for a place before play — its inventory, and the
 * place stats the book records — read and written at the line and moment
 * the place editor reads. The value is the book's (the durable layer); the
 * section never guesses: every row it draws is the server's last read.
 */
import { describe, expect, it } from "vitest"
import type { PoolItem } from "../poolFilter"
import {
	placeStatPicks,
	placeStatRows,
	placeStatsDating,
	placeStatsReadParams,
	placeStatsWriteParams
} from "./placeStats"

const BOOK = 12
const CRYPT = 42
const HARBOR = 43
const KEY = 60
const LAMP = 61
const INVENTORY = "core:slot/inventory@1"
const LAMPS = "test:slot/lamps@1"
const OLD = "test:slot/old@1"

const slot = (
	slotId: string,
	over: Partial<Sockets.State.SlotDescriptor> = {}
): Sockets.State.SlotDescriptor => ({
	slotId,
	key: slotId.split("/")[1]!.split("@")[0]!,
	qualifiedKey: slotId,
	label: slotId,
	type: "integer",
	appliesTo: ["location"],
	...over
})

const read = (over: Partial<Sockets.LorebookState.Get.Response> = {}): Sockets.LorebookState.Get.Response => ({
	lorebookId: BOOK,
	owner: { kind: "location", id: CRYPT },
	branchId: null,
	moment: null,
	slots: [
		slot(INVENTORY, { label: "Inventory", type: "list", field: { type: "list" } as any, appliesTo: ["cast", "world", "location"] }),
		slot(LAMPS, { label: "Lamps lit" }),
		slot(OLD, { label: "Old stat", retired: true })
	],
	values: {
		[INVENTORY]: [{ entryId: KEY, count: 2, name: "Rusty key" }, "lantern"],
		[LAMPS]: 3,
		[OLD]: 1
	},
	configs: { [INVENTORY]: {}, [LAMPS]: { min: 0, max: 6 }, [OLD]: {} },
	heldSince: {},
	writeDatedBy: null,
	...over
})

const poolItem = (id: number, kind: string, name: string, over: Partial<PoolItem> = {}): PoolItem => ({
	key: `entry#${id}`,
	id,
	kind,
	name,
	content: "",
	keys: [],
	pinned: false,
	off: false,
	archived: false,
	machineWritten: false,
	parentKey: null,
	order: 0,
	position: id,
	priority: 0,
	createdAt: 0,
	updatedAt: 0,
	...over
})

describe("placeStatRows", () => {
	it("draws each offered stat by its shape, in the order offered", () => {
		const rows = placeStatRows(read(), () => undefined)
		expect(rows.map((r) => [r.slot.slotId, r.kind, r.writable])).toEqual([
			[INVENTORY, "list", true],
			[LAMPS, "number", true],
			// A retired stat is shown, greyed: its value still counts, nothing new is written.
			[OLD, "number", false]
		])
		expect(rows[1]!.text).toBe("3")
		expect(rows[1]!.config).toEqual({ min: 0, max: 6 })
	})

	it("lists a list's items: a lore entry by the pool's name and how many, a word as itself", () => {
		const names: Record<number, string> = { [KEY]: "The Rusty Key" }
		const [inventory] = placeStatRows(read(), (id) => names[id])
		expect(inventory!.items).toEqual([
			{ key: `0:entry:${KEY}`, index: 0, name: "The Rusty Key", text: "The Rusty Key ×2", entryId: KEY, count: 2 },
			{ key: "1:lantern", index: 1, name: "lantern", text: "lantern", entryId: null, count: 1 }
		])
		// With no pool name, the name the server read.
		expect(placeStatRows(read(), () => undefined)[0]!.items[0]!.text).toBe("Rusty key ×2")
	})

	it("a stat the book never set is empty, not zero", () => {
		const rows = placeStatRows(read({ values: {} }), () => undefined)
		expect(rows[0]!.value).toBeUndefined()
		expect(rows[0]!.items).toEqual([])
		expect(rows[1]!.text).toBe("")
	})

	it("says the date a dated value holds from; an undated one, none", () => {
		const y7 = { year: 7, month: null, day: null }
		const rows = placeStatRows(read({ heldSince: { [INVENTORY]: y7 } }), () => undefined)
		expect(rows.map((r) => r.heldSince)).toEqual([y7, null, null])
	})
})

describe("placeStatsReadParams / placeStatsWriteParams", () => {
	it("reads the place on the line and at the moment being read", () => {
		expect(placeStatsReadParams(BOOK, CRYPT, { branchId: 5, moment: "Y7-2" })).toEqual({
			lorebookId: BOOK,
			owner: { kind: "location", id: CRYPT },
			branchId: 5,
			moment: { year: 7, month: 2, day: null }
		})
		expect(placeStatsReadParams(BOOK, CRYPT, { branchId: null, moment: null }).moment).toBeNull()
	})

	it("writes a stat whole, naming the value it was made from; the server dates it", () => {
		expect(
			placeStatsWriteParams(BOOK, CRYPT, { branchId: null, moment: "Y7" }, INVENTORY, [{ entryId: KEY }, "lamp"], [
				{ entryId: KEY, name: "Rusty key" }
			])
		).toEqual({
			lorebookId: BOOK,
			owner: { kind: "location", id: CRYPT },
			branchId: null,
			moment: { year: 7, month: null, day: null },
			slotId: INVENTORY,
			value: [{ entryId: KEY }, "lamp"],
			readValue: [{ entryId: KEY, name: "Rusty key" }]
		})
		// A stat the book never set was read as nothing.
		expect(placeStatsWriteParams(BOOK, CRYPT, { branchId: null, moment: null }, INVENTORY, ["x"], undefined).readValue).toBeNull()
	})
})

describe("placeStatsDating", () => {
	it("at now, a change keeps the date of the value it changes", () => {
		expect(placeStatsDating(null, null)).toBe(
			"A change here keeps the date of the value it changes: from the start of the story, or from the date beside the stat."
		)
	})

	it("at a moment with a history entry, it is dated then", () => {
		expect(placeStatsDating("Year 7", "Year 7")).toBe(
			"Set here, a stat is dated Year 7 and holds from then on."
		)
	})

	it("at a moment nothing in the history is dated, it keeps the value's date — and says so", () => {
		expect(placeStatsDating("Year 5", null)).toBe(
			"Nothing in the history is dated Year 5, so a change here keeps the date of the value it changes: from the start of the story, or from the date beside the stat."
		)
	})
})

describe("placeStatPicks", () => {
	it("offers the book's items first, then its other lore; never a place, a date, a scene or what is archived", () => {
		const pool = [
			poolItem(HARBOR, "core:entry/location", "Harbor"),
			poolItem(CRYPT, "core:entry/location", "The Crypt"),
			poolItem(LAMP, "core:entry/item", "Brass lamp"),
			poolItem(KEY, "core:entry/item", "Rusty key"),
			poolItem(70, "core:entry/item", "Lost ring", { archived: true }),
			poolItem(71, "scene", "A scene"),
			poolItem(72, "core:entry/history", "Year 7"),
			poolItem(73, "core:entry/world-lore", "The Lamplighters' Guild")
		]
		const picks = placeStatPicks(pool, CRYPT, [{ entryId: KEY, count: 2 }])
		expect(picks.map((p) => [p.entryId, p.title, p.item, p.held])).toEqual([
			[LAMP, "Brass lamp", true, 0],
			[KEY, "Rusty key", true, 2],
			[73, "The Lamplighters' Guild", false, 0]
		])
	})
})
