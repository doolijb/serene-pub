import { describe, expect, test } from "vitest"
import { booksReadBy, loreWriteRoute } from "./phantom"

describe("booksReadBy", () => {
	test("the attached book, then the notes — each only when there", () => {
		expect(booksReadBy(null, null)).toEqual({ attachedId: null, phantomId: null, ids: [] })
		expect(booksReadBy(3, null).ids).toEqual([3])
		expect(booksReadBy(null, 9).ids).toEqual([9])
		expect(booksReadBy(3, 9)).toEqual({ attachedId: 3, phantomId: 9, ids: [3, 9] })
	})
	test("a book is never read twice", () => {
		expect(booksReadBy(3, 3)).toEqual({ attachedId: 3, phantomId: null, ids: [3] })
	})
})

describe("loreWriteRoute", () => {
	const own = { attachedId: 3, bookOwnerId: 1, sessionOwnerId: 1 }
	test("the book only when the session's owner owns it and writes in full", () => {
		expect(loreWriteRoute({ ...own, mode: "full" })).toBe("book")
		expect(loreWriteRoute({ ...own, mode: "review" })).toBe("phantom")
		expect(loreWriteRoute({ ...own, mode: "off" })).toBe("phantom")
	})
	test("no book, or someone else's, goes to the notes", () => {
		expect(loreWriteRoute({ ...own, attachedId: null, mode: "full" })).toBe("phantom")
		expect(loreWriteRoute({ ...own, bookOwnerId: 2, mode: "full" })).toBe("phantom")
	})
})
