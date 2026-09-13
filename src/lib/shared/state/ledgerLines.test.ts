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

const item = (over: Partial<LedgerRow> = {}): LedgerRow => ({
	id: 1,
	kind: "possession",
	messageId: 10,
	ownerKey: "verity",
	ownerLabel: "Verity",
	entryId: 7,
	itemName: "rusty key",
	quantity: 1,
	updatedBy: "user",
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

describe("possession lines", () => {
	test("arriving, leaving and changing each read differently", () => {
		const lines = ledgerLines([
			item({ id: 1, messageId: 10, quantity: 1 }),
			item({ id: 2, messageId: 11, quantity: 3 }),
			item({ id: 3, messageId: 12, quantity: 0 })
		])
		expect(lines.map((l) => l.text)).toEqual([
			"+rusty key",
			"rusty key ×1 → ×3",
			"-rusty key"
		])
	})

	test("arriving in a stack says how many", () => {
		expect(ledgerLines([item({ quantity: 2 })])[0].text).toBe(
			"+rusty key ×2"
		)
	})

	test("one item's history is per owner, never pooled", () => {
		const lines = ledgerLines([
			item({ id: 1, messageId: 10, quantity: 1 }),
			item({
				id: 2,
				messageId: 11,
				ownerKey: "marrow",
				ownerLabel: "Marrow",
				quantity: 1
			})
		])
		expect(lines.map((l) => l.text)).toEqual(["+rusty key", "+rusty key"])
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
			"+rusty key"
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
			"+rusty key"
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
		expect(
			describeProposal(
				{
					kind: "possession",
					payload: {
						owner: { kind: "session_cast", id: 11 },
						entryId: 7,
						delta: 2
					}
				},
				names
			)
		).toBe("Verity +rusty key ×2")
		expect(
			describeProposal(
				{
					kind: "possession",
					payload: {
						owner: { kind: "session_cast", id: 11 },
						entryId: 7,
						delta: -1
					}
				},
				names
			)
		).toBe("Verity -rusty key")
	})

	test("a payload nothing can name still says something true", () => {
		expect(describeProposal({ kind: "value", payload: {} }, {})).toBe(
			"a change this session cannot describe"
		)
	})
})
