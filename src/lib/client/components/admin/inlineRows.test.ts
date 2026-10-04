import { describe, expect, it } from "vitest"
import {
	inlineChangeCount,
	inlineChanges,
	newInlineKey,
	savedInlineRow,
	type InlineRow
} from "./inlineRows"

type V = { name: string; enabled: boolean }
const saved = [
	{ id: 1, values: { name: "Quick", enabled: true } },
	{ id: 2, values: { name: "Slow", enabled: false } }
]

describe("inlineChanges", () => {
	it("is empty when the rows are what is saved", () => {
		const rows = saved.map((s) => savedInlineRow(s.id, { ...s.values }))
		const c = inlineChanges<V>(saved, rows)
		expect(inlineChangeCount(c)).toBe(0)
	})

	it("splits adds, field changes and deletions", () => {
		const rows: InlineRow<V>[] = [
			savedInlineRow(1, { name: "Quick start", enabled: true }),
			{ ...savedInlineRow(2, { name: "Slow", enabled: true }), delete: true },
			{ key: newInlineKey(), id: null, values: { name: "New", enabled: true }, delete: false }
		]
		const c = inlineChanges<V>(saved, rows)
		expect(c.changed).toEqual([{ row: rows[0], fields: ["name"] }])
		expect(c.deleted).toEqual([rows[1]])
		expect(c.added).toEqual([rows[2]])
		expect(inlineChangeCount(c)).toBe(3)
	})

	it("drops a new row ticked for deletion and ignores a row deleted elsewhere", () => {
		const rows: InlineRow<V>[] = [
			{ key: newInlineKey(), id: null, values: { name: "Oops", enabled: true }, delete: true },
			savedInlineRow(9, { name: "Gone", enabled: true })
		]
		expect(inlineChangeCount(inlineChanges<V>(saved, rows))).toBe(0)
	})

	it("treats a value put back as no change", () => {
		const rows = [savedInlineRow(2, { name: "Slow", enabled: false })]
		expect(inlineChanges<V>(saved, rows).changed).toEqual([])
	})

	it("gives new rows keys that never collide with saved ones", () => {
		const a = newInlineKey()
		const b = newInlineKey()
		expect(a).not.toBe(b)
		expect(a.startsWith("id-")).toBe(false)
	})
})
