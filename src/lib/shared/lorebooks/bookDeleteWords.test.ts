/**
 * 🚧 A refused lorebook delete, as words (owner ruling D50, 2026-11-16:
 * "Refuse the delete while a session uses it, naming the sessions"). The way
 * out is named by its button, **Merge ‹lorebook› into these notes**; another
 * person's session is counted, never named.
 */
import { describe, expect, test } from "vitest"
import { bookDeleteSentence, bookDeleteWords } from "./sessionNotes"

const s = (id: number, name: string | null = `Run ${id}`) => ({ id, name })

describe("bookDeleteSentence", () => {
	test("one session of the asker's", () => {
		expect(
			bookDeleteSentence("Saltmarsh", {
				named: [s(1, "Fog run")],
				others: 0
			})
		).toBe(
			'"Saltmarsh" can\'t be deleted while this session plays on it: Fog run.'
		)
	})

	test("several, with an untitled one", () => {
		expect(
			bookDeleteSentence("Saltmarsh", {
				named: [s(1, "A"), s(2, null), s(3, "C")],
				others: 0
			})
		).toBe(
			'"Saltmarsh" can\'t be deleted while these sessions play on it: A, Untitled session and C.'
		)
	})

	test("past five: 'and n more'; one sentence", () => {
		const named = [1, 2, 3, 4, 5, 6, 7].map((i) => s(i))
		expect(bookDeleteSentence("Saltmarsh", { named, others: 2 })).toBe(
			'"Saltmarsh" can\'t be deleted while these sessions play on it: Run 1, Run 2, Run 3, Run 4, Run 5 and 2 more.'
		)
	})

	test("only other people's: counted, never named", () => {
		expect(bookDeleteSentence("Saltmarsh", { named: [], others: 1 })).toBe(
			"\"Saltmarsh\" can't be deleted while another person's session plays on it."
		)
		expect(bookDeleteSentence("", { named: [], others: 3 })).toBe(
			"This lorebook can't be deleted while 3 of other people's sessions play on it."
		)
	})
})

describe("bookDeleteWords", () => {
	test("the title and the pieces the confirm draws", () => {
		const w = bookDeleteWords("Saltmarsh", { named: [s(1)], others: 0 })
		expect(w.title).toBe('Can\'t delete "Saltmarsh"')
		expect(w.shown).toEqual([s(1)])
		expect(w.more).toBe(0)
		expect(w.others).toBeNull()
		expect(w.wayOut).toBe(
			"Delete that session first, or choose Merge Saltmarsh into these notes in it."
		)
		expect(
			bookDeleteWords("Saltmarsh", { named: [], others: 2 }).wayOut
		).toBe(
			"Ask their owners to delete them or to merge it into their notes."
		)
		expect(bookDeleteWords("  ", { named: [s(1)], others: 0 }).title).toBe(
			"Can't delete this lorebook"
		)
	})
})
