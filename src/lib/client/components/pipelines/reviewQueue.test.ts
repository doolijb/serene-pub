/**
 * The review and cap-pause queues' wording (owner note 15, 2026-10-02): the
 * card on screen is `queue[0]`, so "1 more waiting" read as if it were not
 * one of them. The line now says what comes after the card being looked at.
 */
import { describe, expect, test } from "vitest"
import { queueAfterThis, queuePosition } from "./reviewQueue"

describe("review queue wording", () => {
	test("a lone card says nothing about a queue", () => {
		expect(queuePosition(1)).toBeNull()
		expect(queueAfterThis(1)).toBeNull()
		expect(queueAfterThis(0)).toBeNull()
	})
	test("two cards: the one on screen is 1 of 2, one more follows it", () => {
		expect(queuePosition(2)).toBe("1 of 2")
		expect(queueAfterThis(2)).toBe("1 more after this one")
	})
	test("never says 'waiting' for the card already being reviewed", () => {
		expect(queueAfterThis(3)).toBe("2 more after this one")
		expect(queueAfterThis(3)).not.toMatch(/waiting/)
	})
})
