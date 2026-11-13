/**
 * `show-hidden-stats` (*Show hidden stats*): the page tells the state store which AI
 * seat the viewer reads; a malformed ask is refused in words.
 */
import { describe, expect, test, vi } from "vitest"
import { answerShowHiddenStats } from "./showHiddenStats"

describe("answerShowHiddenStats", () => {
	test("calls the store with the seat's ref", async () => {
		const set = vi.fn()
		await answerShowHiddenStats(
			{ owner: { kind: "seated_member", id: 42 }, on: true },
			set
		)
		await answerShowHiddenStats(
			{ owner: { kind: "seated_member", id: 42 }, on: false },
			set
		)
		expect(set.mock.calls).toEqual([
			["seated-member:42", true],
			["seated-member:42", false]
		])
	})

	test("rejects an owner that is not an AI character seat", async () => {
		const set = vi.fn()
		for (const owner of [
			{ kind: "player_seat", id: 3 },
			{ kind: "session_cast", id: 3 },
			{ kind: "seated_member", id: "3" },
			undefined
		])
			await expect(
				answerShowHiddenStats({ owner, on: true }, set)
			).rejects.toThrow(/show-hidden-stats/)
		expect(set).not.toHaveBeenCalled()
	})

	test("rejects a non-boolean on", async () => {
		const set = vi.fn()
		await expect(
			answerShowHiddenStats(
				{ owner: { kind: "seated_member", id: 1 }, on: "yes" },
				set
			)
		).rejects.toThrow(/true or false/)
		expect(set).not.toHaveBeenCalled()
	})
})
