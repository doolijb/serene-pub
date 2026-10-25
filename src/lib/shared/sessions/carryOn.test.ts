/**
 * A member's Continue (Dungeon Crawler walk round 2, 2026-10-15): the chip
 * reads the same rule the server's door does (`sentSinceReply`).
 */
import { describe, expect, test } from "vitest"
import { mayContinue, sentSinceReplyIn } from "./carryOn"

const GUEST = 2
const reply = { role: "assistant", userId: null, channel: "main" }
const mine = { role: "user", userId: GUEST, channel: "main" }
const theirs = { role: "user", userId: 1, channel: "main" }

describe("may a member press Continue", () => {
	test("the owner always may", () => {
		expect(mayContinue({ isOwner: true, userId: 1, rows: [reply], turnOrder: { order: [] } })).toBe(true)
	})
	test("a member with a line since the last reply may; one without may not", () => {
		const base = { isOwner: false, userId: GUEST, turnOrder: { order: [] } }
		expect(mayContinue({ ...base, rows: [reply, mine, theirs] })).toBe(true)
		expect(mayContinue({ ...base, rows: [mine, reply, theirs] })).toBe(false)
		expect(mayContinue({ ...base, rows: [] })).toBe(false)
	})
	test("hidden rows, narration and other channels do not count", () => {
		const rows = [
			reply,
			mine,
			{ role: "assistant", channel: "main", isNarratorResponse: true },
			{ role: "assistant", channel: "main", isHidden: true },
			{ role: "assistant", channel: "parley:2" }
		]
		expect(sentSinceReplyIn(rows, GUEST)).toBe(true)
	})
	test("off main, only a prepared entry there lets a member continue", () => {
		const base = { isOwner: false, userId: GUEST, rows: [reply, mine], channel: "parley:2" }
		expect(mayContinue({ ...base, turnOrder: { order: [] } })).toBe(false)
		expect(
			mayContinue({
				...base,
				turnOrder: { order: [{ ref: null, via: "rotation", channel: "parley:2" }] } as never
			})
		).toBe(true)
	})
})
