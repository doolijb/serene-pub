import { beforeEach, describe, expect, test } from "vitest"
import {
	answerShowLine,
	clearShownLine,
	shownLineOf,
	shownLines
} from "./showLine"

describe("show-line", () => {
	beforeEach(() => clearShownLine())

	test("sets, overwrites and clears with null", () => {
		answerShowLine({ messageId: 5 }, 1)
		expect(shownLineOf(1)).toBe(5)
		answerShowLine({ messageId: 8 }, 1)
		expect(shownLineOf(1)).toBe(8)
		answerShowLine({ messageId: null }, 1)
		expect(shownLineOf(1)).toBeNull()
		expect(shownLines.size).toBe(0)
	})

	test("another session's entry is dropped, and is never read back", () => {
		answerShowLine({ messageId: 5 }, 1)
		expect(shownLineOf(2)).toBeNull()
		answerShowLine({ messageId: 6 }, 2)
		expect([...shownLines.entries()]).toEqual([[2, 6]])
		expect(shownLineOf(1)).toBeNull()
		expect(shownLineOf(null)).toBeNull()
	})

	test("the same value again writes nothing", () => {
		answerShowLine({ messageId: 5 }, 1)
		let writes = 0
		const set = shownLines.set.bind(shownLines)
		shownLines.set = (k, v) => {
			writes++
			return set(k, v)
		}
		answerShowLine({ messageId: 5 }, 1)
		expect(writes).toBe(0)
		shownLines.set = set
	})

	test("refuses no session and a message id that is not null or a positive whole number", () => {
		expect(() => answerShowLine({ messageId: 5 }, null)).toThrow(
			"show-line needs a session"
		)
		for (const bad of [
			{},
			{ messageId: 0 },
			{ messageId: -1 },
			{ messageId: 1.5 },
			{ messageId: "3" },
			{ messageId: NaN }
		])
			expect(() => answerShowLine(bad, 1)).toThrow(
				"show-line needs a message id (a whole number) or null"
			)
		expect(shownLines.size).toBe(0)
	})
})
