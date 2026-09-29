/**
 * The parity fixture's fake server answers as `entries:sessionEntries` does
 * (finding #171) — where the recorded cases do not already pin it down.
 */
import { describe, expect, test } from "vitest"
import { fullBook, page } from "./loreEntriesParity.fixture"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

describe("the parity fixture's session-entries fake", () => {
	test("rows carry a declared entry type", () => {
		expect(fullBook().rows.every((r) => r.typeId === WORLD_LORE_TYPE_ID)).toBe(true)
	})

	test("'fired' is read LAST time, as the server filters (lastIncluded), not ever read", () => {
		const book = fullBook()
		// Read before, left out last time: not fired.
		book.rows[0]!.lastIncluded = false
		expect(page(book, { filter: "fired" }).rows).toEqual([])
		book.rows[0]!.lastIncluded = true
		expect(page(book, { filter: "fired" }).rows.map((r) => r.id)).toEqual([1])
	})

	test("refuses 'query', the socket's word, as the request adapter does", () => {
		expect(() => page(fullBook(), { query: "mira" } as never)).toThrow(/titleOrKey/)
		expect(page(fullBook(), { titleOrKey: "  SMITH " }).rows.map((r) => r.id)).toEqual([1])
	})

	test("sorts as the server does, an unnamed sort by name", () => {
		expect(page(fullBook(), {}).rows.map((r) => r.id)).toEqual([3, 1, 2])
		expect(page(fullBook(), { sort: "lastRead" }).rows.map((r) => r.id)).toEqual([1, 2, 3])
		expect(page(fullBook(), { sort: "timesRead" }).rows.map((r) => r.id)).toEqual([1, 2, 3])
	})

	test("a page past the end answers the last real page", () => {
		const res = page(fullBook(), { sort: "rank", offset: 10, limit: 2 })
		expect(res.offset).toBe(2)
		expect(res.rows.map((r) => r.id)).toEqual([3])
	})
})
