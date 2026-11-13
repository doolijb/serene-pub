/** `ownNewestMessageId`: the newest loaded row the viewing user wrote. */
import { describe, expect, test } from "vitest"
import { ownNewestMessageIdOf } from "./sessionPageProjections"

const rows = [
	{ id: 4, role: "user", userId: 1 },
	{ id: 9, role: "user", userId: 1 },
	{ id: 12, role: "user", userId: 2 },
	{ id: 15, role: "assistant", userId: 1 },
	{ id: 6, role: "user", userId: 1, channel: "ooc" }
]

describe("ownNewestMessageIdOf", () => {
	test("is the greatest id among the viewer's own user rows, on any channel", () => {
		expect(ownNewestMessageIdOf(rows, 1)).toBe(9)
		expect(ownNewestMessageIdOf(rows, 2)).toBe(12)
	})

	test("does not count another person's row or an assistant row carrying the viewer's userId", () => {
		expect(ownNewestMessageIdOf(rows.slice(2, 4), 1)).toBeNull()
	})

	test("is null with no viewer, no rows or none of theirs", () => {
		expect(ownNewestMessageIdOf(rows, null)).toBeNull()
		expect(ownNewestMessageIdOf(rows, undefined)).toBeNull()
		expect(ownNewestMessageIdOf([], 1)).toBeNull()
		expect(ownNewestMessageIdOf(undefined, 1)).toBeNull()
		expect(ownNewestMessageIdOf(rows, 3)).toBeNull()
	})
})
