import { describe, expect, it } from "vitest"
import { guestChanges } from "./guestChanges"

describe("guestChanges", () => {
	it("is empty when the list matches what is saved, in any order", () => {
		expect(guestChanges([1, 2], [2, 1])).toEqual({ add: [], remove: [] })
	})

	it("adds the wanted ids the session does not have", () => {
		expect(guestChanges([1], [1, 3, 4])).toEqual({ add: [3, 4], remove: [] })
	})

	it("removes the saved ids the form no longer holds", () => {
		expect(guestChanges([1, 2, 3], [2])).toEqual({ add: [], remove: [1, 3] })
	})

	it("adds and removes in one save, collapsing duplicates", () => {
		expect(guestChanges([1, 2], [2, 5, 5])).toEqual({
			add: [5],
			remove: [1]
		})
	})

	it("a guest added then removed before Save sends nothing", () => {
		expect(guestChanges([1], [1])).toEqual({ add: [], remove: [] })
	})
})
