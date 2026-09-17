/**
 * The order maths: the draw sequence and the conversation index agree with each
 * other, an autoscroll lands at the end the newest message is at, the older
 * page is pulled from the far end, and the restore keeps the reader in place.
 */
import { describe, expect, it } from "vitest"
import {
	atOlderEdge,
	autoscrollTarget,
	conversationIndex,
	orderedMessages,
	restoredScrollTop
} from "./messageOrder"

const messages = [1, 2, 3, 4]

describe("draw sequence", () => {
	it("hands back the same array under oldest-first", () => {
		expect(orderedMessages(messages, "oldest-first")).toBe(messages)
	})

	it("reverses a copy under newest-first", () => {
		expect(orderedMessages(messages, "newest-first")).toEqual([4, 3, 2, 1])
		expect(messages).toEqual([1, 2, 3, 4])
	})

	it("indexes every row back to its place in the conversation", () => {
		for (const order of ["oldest-first", "newest-first"] as const) {
			const drawn = orderedMessages(messages, order)
			drawn.forEach((msg, row) => {
				const index = conversationIndex(row, messages.length, order)
				expect(messages[index]).toBe(msg)
			})
		}
	})
})

describe("autoscroll target", () => {
	it("is the far end under oldest-first and the top under newest-first", () => {
		expect(autoscrollTarget("oldest-first", { scrollHeight: 900 })).toBe(
			900
		)
		expect(autoscrollTarget("newest-first", { scrollHeight: 900 })).toBe(0)
	})
})

describe("older-message edge", () => {
	const metrics = (scrollTop: number) => ({
		scrollTop,
		scrollHeight: 2000,
		clientHeight: 500
	})

	it("is the top under oldest-first", () => {
		expect(atOlderEdge("oldest-first", metrics(199))).toBe(true)
		expect(atOlderEdge("oldest-first", metrics(201))).toBe(false)
	})

	it("is the bottom under newest-first", () => {
		// 2000 − 500 = 1500 is the bottom; 200px short of it is 1300.
		expect(atOlderEdge("newest-first", metrics(1301))).toBe(true)
		expect(atOlderEdge("newest-first", metrics(1299))).toBe(false)
	})

	it("takes a threshold of its own", () => {
		expect(atOlderEdge("oldest-first", metrics(400), 500)).toBe(true)
	})
})

describe("scroll restore after a prepend", () => {
	const anchor = { previousScrollTop: 120, previousScrollHeight: 2000 }

	it("moves down by the height added above under oldest-first", () => {
		expect(restoredScrollTop("oldest-first", anchor, 3200)).toBe(1320)
	})

	it("stays put under newest-first, where the rows land below", () => {
		expect(restoredScrollTop("newest-first", anchor, 3200)).toBe(120)
	})
})
