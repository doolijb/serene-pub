import { describe, expect, it } from "vitest"
import { sharedFromLine, splitSharedRows, withoutShared } from "./sharedRows"

describe("splitSharedRows", () => {
	it("keeps each side in the order given", () => {
		const rows = [
			{ id: 1 },
			{ id: 2, isSharedWithMe: true, ownerName: "Ada" },
			{ id: 3, isSharedWithMe: false },
			{ id: 4, isSharedWithMe: true, ownerName: null }
		]
		const { own, shared } = splitSharedRows(rows)
		expect(own.map((r) => r.id)).toEqual([1, 3])
		expect(shared.map((r) => r.id)).toEqual([2, 4])
	})

	it("answers two empty lists for none", () => {
		expect(splitSharedRows([])).toEqual({ own: [], shared: [] })
	})
})

describe("withoutShared", () => {
	it("drops shared rows and tolerates a missing list", () => {
		expect(
			withoutShared([{ id: 1 }, { id: 2, isSharedWithMe: true }])
		).toEqual([{ id: 1 }])
		expect(withoutShared(undefined)).toEqual([])
		expect(withoutShared(null)).toEqual([])
	})
})

describe("sharedFromLine", () => {
	it("names the sharer, else says it was shared", () => {
		expect(sharedFromLine({ ownerName: "Ada" })).toBe("From Ada")
		expect(sharedFromLine({ ownerName: null })).toBe("Shared with you")
	})
})
