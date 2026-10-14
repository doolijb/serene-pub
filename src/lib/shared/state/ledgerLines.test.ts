/**
 * The ledger: anchored rows read back as what changed on a message.
 *
 * The rows are the truth and the line is a reading of them, so every assertion
 * here is about the reading — which row a change is measured against, and what
 * a change with nothing behind it is allowed to claim.
 */
import { describe, expect, test } from "vitest"
import {
	describeProposal,
	groupLinesByOwner,
	ledgerHeadLines,
	ledgerLines,
	linesByMessage,
	type LedgerRow
} from "./ledgerLines"

const value = (over: Partial<LedgerRow> = {}): LedgerRow => ({
	id: 1,
	kind: "value",
	messageId: 10,
	ownerKey: "verity",
	ownerLabel: "Verity",
	slotId: "core:slot/hp@1",
	slotLabel: "hp",
	value: 14,
	updatedBy: "user",
	...over
})

/** An inventory row (phase 3b: items are the `inventory` stat's values, not edges). */
const item = (over: Partial<LedgerRow> = {}): LedgerRow =>
	value({
		slotId: "core:slot/inventory@1",
		slotLabel: "Inventory",
		value: [{ entryId: 7, name: "rusty key" }],
		...over
	})

describe("value lines", () => {
	test("a change is measured against the row before it", () => {
		const lines = ledgerLines([
			value({ id: 1, messageId: 10, value: 20 }),
			value({ id: 2, messageId: 12, value: 14 })
		])
		expect(lines.map((l) => l.text)).toEqual(["hp → 20", "hp 20 → 14"])
		expect(lines[1]).toMatchObject({ before: 20, after: 14, messageId: 12 })
	})

	test("the first change is measured against what the session inherited", () => {
		const lines = ledgerLines(
			[value({ value: 14 })],
			[{ ownerKey: "verity", slotId: "core:slot/hp@1", value: 20 }]
		)
		expect(lines[0].text).toBe("hp 20 → 14")
		expect(lines[0].before).toBe(20)
	})

	test("a baseline for another owner is not this owner's baseline", () => {
		const lines = ledgerLines(
			[value({ value: 14 })],
			[{ ownerKey: "marrow", slotId: "core:slot/hp@1", value: 20 }]
		)
		expect(lines[0].text).toBe("hp → 14")
		expect(lines[0].before).toBeUndefined()
	})

	test("a cleared value says so rather than reading as a number", () => {
		const lines = ledgerLines([
			value({ id: 1, value: "wary" }),
			value({ id: 2, messageId: 11, value: null })
		])
		expect(lines[1].text).toBe("hp wary → cleared")
	})

	test("two rows on one message are two lines, in row order", () => {
		const lines = ledgerLines([
			value({ id: 2, value: 14 }),
			value({ id: 1, value: 18 })
		])
		expect(lines.map((l) => l.text)).toEqual(["hp → 18", "hp 18 → 14"])
	})
})

describe("inventory lines", () => {
	test("an inventory reads as the list it became, measured against the one before", () => {
		const lines = ledgerLines([
			item({ id: 1, messageId: 10 }),
			item({ id: 2, messageId: 11, value: [{ entryId: 7, name: "rusty key", count: 3 }] }),
			item({ id: 3, messageId: 12, value: [] })
		])
		expect(lines.map((l) => l.text)).toEqual([
			"Inventory → rusty key",
			"Inventory rusty key → rusty key ×3",
			expect.stringMatching(/^Inventory rusty key ×3 → /)
		])
	})

	test("one owner's inventory is never measured against another's", () => {
		const lines = ledgerLines([
			item({ id: 1, messageId: 10 }),
			item({ id: 2, messageId: 11, ownerKey: "marrow", ownerLabel: "Marrow" })
		])
		expect(lines.map((l) => l.text)).toEqual(["Inventory → rusty key", "Inventory → rusty key"])
	})
})

describe("reading a message's ledger", () => {
	test("lines are indexed by the message they are anchored to", () => {
		const byMessage = linesByMessage(
			ledgerLines([
				value({ id: 1, messageId: 10, value: 14 }),
				item({ id: 2, messageId: 10 }),
				value({ id: 3, messageId: 11, value: 12 })
			])
		)
		expect(byMessage.get(10)?.map((l) => l.text)).toEqual([
			"hp → 14",
			"Inventory → rusty key"
		])
		expect(byMessage.get(11)?.map((l) => l.text)).toEqual(["hp 14 → 12"])
	})

	test("a row anchored to no message is in no message's ledger", () => {
		const lines = ledgerLines([value({ messageId: null })])
		expect(lines).toHaveLength(1)
		expect(linesByMessage(lines).size).toBe(0)
	})

	test("a message's lines are grouped under the owner that changed", () => {
		const groups = groupLinesByOwner(
			ledgerLines([
				value({ id: 1, value: 14 }),
				item({ id: 2 }),
				value({
					id: 3,
					ownerKey: "world",
					ownerLabel: "World",
					slotLabel: "weather",
					slotId: "core:slot/weather@1",
					value: "storm"
				})
			])
		)
		expect(groups.map((g) => g.ownerLabel)).toEqual(["Verity", "World"])
		expect(groups[0].lines.map((l) => l.text)).toEqual([
			"hp → 14",
			"Inventory → rusty key"
		])
	})
})

describe("a held change", () => {
	const names = {
		ownerLabel: () => "Verity",
		slotLabel: () => "hp",
		itemName: () => "rusty key"
	}

	test("reads as what it would do, not as what it did", () => {
		expect(
			describeProposal(
				{
					kind: "value",
					payload: {
						owner: { kind: "session_cast", id: 11 },
						slotId: "core:slot/hp@1",
						value: 6
					}
				},
				names
			)
		).toBe("Verity hp → 6")
	})

	test("an item arriving and an item leaving are different sentences", () => {
		const inventory = (op: "add" | "remove", count: number) =>
			describeProposal(
				{
					kind: "value",
					payload: {
						owner: { kind: "session_cast", id: 11 },
						slotId: "core:slot/inventory@1",
						op,
						items: [{ entryId: 7, count }]
					}
				},
				{ ...names, slotLabel: () => "Inventory" }
			)
		expect(inventory("add", 2)).toBe("Verity Inventory +rusty key ×2")
		expect(inventory("remove", 1)).toBe("Verity Inventory -rusty key")
	})

	test("a place moved to reads by its title, never `entry N` (Lair W-GATE D4)", () => {
		const move = (value: unknown, itemName?: (id: number) => string | undefined) =>
			describeProposal(
				{ kind: "value", payload: { slotId: "core:slot/location@1", value } },
				{ slotLabel: () => "Location", itemName }
			)
		// The host named it on the way out…
		expect(move({ entryId: 2, name: "The Guard Room" })).toBe("Location → The Guard Room")
		// …or the surface can: the same names a list item reads by.
		expect(move({ entryId: 2 }, () => "The Guard Room")).toBe("Location → The Guard Room")
		expect(move([{ entryId: 2 }], () => "The Guard Room")).toBe("Location → The Guard Room")
	})

	test("a payload nothing can name still says something true", () => {
		expect(describeProposal({ kind: "value", payload: {} }, {})).toBe(
			"a change this session cannot describe"
		)
	})
})

describe("a held clock move (live scenes ★3)", () => {
	const clock = (by: unknown, unit: unknown) =>
		describeProposal({ kind: "clock", payload: { kind: "clock", by, unit } }, {})

	test("reads as the time that would pass, in the unit the keeper named", () => {
		expect(clock(3, "hours")).toBe("Time passes: 3 hours")
		expect(clock(1, "days")).toBe("Time passes: 1 day")
		expect(clock(1, "minutes")).toBe("Time passes: 1 minute")
	})

	test("a payload that is not a forward step says so rather than drawing a blank", () => {
		expect(clock(-2, "hours")).toBe("a clock move this session cannot describe")
		expect(clock(2, undefined)).toBe("a clock move this session cannot describe")
	})
})

describe("a clock move in the ledger (live scenes §15 G5)", () => {
	const move = (over: Partial<LedgerRow> = {}): LedgerRow => ({
		id: 3,
		kind: "clock",
		messageId: 10,
		ownerKey: "world",
		ownerLabel: "The run",
		updatedBy: "run:abc",
		clock: { by: 3, unit: "hours", cause: "action", fromLabel: "Day 4, 14:00", toLabel: "Day 4, 17:00" },
		...over
	})

	test("says how much time passed, and where the clock went", () => {
		const [line] = ledgerLines([move()])
		expect(line).toMatchObject({ key: "c3", kind: "clock", messageId: 10, ownerKey: "world" })
		expect(line.text).toBe("Time passes: 3 hours (Day 4, 14:00 → Day 4, 17:00)")
		expect(
			ledgerLines([move({ clock: { by: -1, unit: "days", fromLabel: "Day 4", toLabel: "Day 3" } })])[0].text
		).toBe("Time goes back: 1 day (Day 4 → Day 3)")
	})

	test("a skipped move says it is not on the clock, and why", () => {
		const [line] = ledgerLines([move({ clock: { by: 3, unit: "hours", skipped: "This story has no clock yet." } })])
		expect(line.text).toBe("Time passes: 3 hours, not on the clock. This story has no clock yet.")
	})

	test("sits after the message's values, whatever its id, and never feeds a value's trail", () => {
		const lines = ledgerLines([
			move({ id: 1 }),
			value({ id: 9, messageId: 10, ownerKey: "world", slotLabel: "Weather", value: "rain" })
		])
		expect(lines.map((l) => l.kind)).toEqual(["value", "clock"])
		expect(lines[0].text).toBe("Weather → rain")
		expect(groupLinesByOwner(lines)).toHaveLength(1)
	})

	test("🚧 a move made before any line is the ledger head (§15 G13): first, under no message; a value with no anchor is not", () => {
		const lines = ledgerLines([
			move({ id: 5, messageId: 10 }),
			move({ id: 6, messageId: null, clock: { by: 2, unit: "hours", skipped: "No clock." } }),
			value({ id: 9, messageId: null })
		])
		// Sorted before every anchored line: before anything was said.
		expect(lines.map((l) => l.key)).toEqual(["v9", "c6", "c5"])
		expect(ledgerHeadLines(lines).map((l) => l.text)).toEqual([
			"Time passes: 2 hours, not on the clock. No clock."
		])
		expect([...linesByMessage(lines).keys()]).toEqual([10])
	})
})
