import { describe, expect, test } from "vitest"
import { booksReadBy, loreWriteRoute } from "./ownBook"

describe("booksReadBy", () => {
	test("the attached book, then the notes — each only when there", () => {
		expect(booksReadBy(null, null)).toEqual({ attachedId: null, ownBookId: null, ids: [] })
		expect(booksReadBy(3, null).ids).toEqual([3])
		expect(booksReadBy(null, 9).ids).toEqual([9])
		expect(booksReadBy(3, 9)).toEqual({ attachedId: 3, ownBookId: 9, ids: [3, 9] })
	})
	test("a book is never read twice", () => {
		expect(booksReadBy(3, 3)).toEqual({ attachedId: 3, ownBookId: null, ids: [3] })
	})
})

describe("loreWriteRoute", () => {
	const own = { attachedId: 3, bookOwnerId: 1, bookProvided: false, sessionOwnerId: 1 }
	test("the book only when the session's owner owns it and writes in full", () => {
		expect(loreWriteRoute({ ...own, mode: "full" })).toBe("book")
		expect(loreWriteRoute({ ...own, mode: "review" })).toBe("own-book")
		expect(loreWriteRoute({ ...own, mode: "off" })).toBe("own-book")
	})
	test("no book, or someone else's, goes to the notes", () => {
		expect(loreWriteRoute({ ...own, attachedId: null, mode: "full" })).toBe("own-book")
		expect(loreWriteRoute({ ...own, bookOwnerId: 2, mode: "full" })).toBe("own-book")
	})
	test("a live provided lorebook goes to the notes even for its enabling owner, in full", () => {
		expect(loreWriteRoute({ ...own, bookProvided: true, mode: "full" })).toBe("own-book")
	})
	test.each([
		// attachedId, bookOwnerId, sessionOwnerId, route under full, provided
		[3, 1, 1, "book"],
		[3, 1, 1, "own-book", true],
		[3, 2, 1, "own-book"],
		[3, null, 1, "own-book"],
		[null, 1, 1, "own-book"],
		[null, null, 1, "own-book"]
	] as [number | null, number | null, number, "book" | "own-book", boolean?][])(
		"full: attached %s, book owner %s, session owner %s is %s",
		(a, b, s, route, provided) => {
			expect(
				loreWriteRoute({ attachedId: a, bookOwnerId: b, bookProvided: provided ?? false, sessionOwnerId: s, mode: "full" })
			).toBe(route)
		}
	)
})
