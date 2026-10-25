import { describe, expect, it } from "vitest"
import { mergeRefreshedRows } from "./refreshMerge"

const rows = (...ids: number[]) =>
	ids.map((id) => ({ id, channel: null as string | null, content: `m${id}` }))
const ids = (r: { id: number }[]) => r.map((x) => x.id)

describe("mergeRefreshedRows", () => {
	it("takes pushed rows at or above the page floor only", () => {
		const out = mergeRefreshedRows(
			rows(10, 11, 12),
			rows(5, 6, 7, 8, 9, 10, 11, 12, 13, 14),
			null
		)
		expect(ids(out)).toEqual([10, 11, 12, 13, 14])
	})

	it("drops a page row the push no longer holds", () => {
		const out = mergeRefreshedRows(rows(10, 11, 12), rows(10, 11, 13), null)
		expect(ids(out)).toEqual([10, 11, 13])
	})

	it("replaces a page row with the pushed object", () => {
		const pushedRow = { id: 11, channel: null, content: "changed" }
		const out = mergeRefreshedRows(
			rows(10, 11, 12),
			[pushedRow, ...rows(10, 12)],
			null
		)
		expect(out.find((r) => r.id === 11)).toBe(pushedRow)
	})

	it("keeps page rows below coversFromId and drops absent ones above", () => {
		const out = mergeRefreshedRows(rows(10, 11, 12, 13), rows(12, 14), 12)
		expect(ids(out)).toEqual([10, 11, 12, 14])
	})

	it("takes every pushed row when the page is empty, sorted", () => {
		const out = mergeRefreshedRows([], rows(3, 1, 2), null)
		expect(ids(out)).toEqual([1, 2, 3])
	})

	it("mutates neither input and returns a new array", () => {
		const page = rows(10, 11, 12)
		const pushed = rows(11, 12, 13)
		const pageCopy = structuredClone(page)
		const pushedCopy = structuredClone(pushed)
		const out = mergeRefreshedRows(page, pushed, null)
		expect(page).toEqual(pageCopy)
		expect(pushed).toEqual(pushedCopy)
		expect(out).not.toBe(page)
		expect(out).not.toBe(pushed)
	})
})
