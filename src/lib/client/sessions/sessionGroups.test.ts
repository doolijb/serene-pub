import { describe, expect, test } from "vitest"
import {
	groupSessions,
	isAwaitingUser,
	RECENT_WINDOW_MS
} from "./sessionGroups"

const NOW = Date.parse("2026-09-26T12:00:00.000Z")
const HOUR = 3_600_000

function row(
	id: number,
	opts: { isUser?: boolean; agoMs?: number; noMessage?: boolean } = {}
) {
	const at = new Date(NOW - (opts.agoMs ?? HOUR)).toISOString()
	return {
		id,
		updatedAt: at,
		...(opts.noMessage
			? {}
			: {
					lastMessage: {
						excerpt: "…",
						speakerName: opts.isUser ? "You" : "Wren",
						isUser: !!opts.isUser,
						createdAt: at
					}
				})
	}
}

describe("isAwaitingUser", () => {
	test("somebody else spoke last: your turn", () => {
		expect(isAwaitingUser(row(1))).toBe(true)
	})
	test("you spoke last: not your turn", () => {
		expect(isAwaitingUser(row(1, { isUser: true }))).toBe(false)
	})
	test("nothing said yet: nobody's turn", () => {
		expect(isAwaitingUser(row(1, { noMessage: true }))).toBe(false)
		expect(isAwaitingUser({ lastMessage: null })).toBe(false)
	})
	test("a reply being written is not your turn", () => {
		expect(isAwaitingUser(row(1), true)).toBe(false)
	})
})

describe("groupSessions", () => {
	test("your turn first, then recent, then older, empty groups dropped", () => {
		const groups = groupSessions(
			[
				row(1, { isUser: true, agoMs: HOUR }),
				row(2, { agoMs: 30 * 24 * HOUR }),
				row(3, { isUser: true, agoMs: 30 * 24 * HOUR }),
				row(4, { isUser: true, agoMs: 2 * 24 * HOUR })
			],
			{ now: NOW }
		)
		expect(
			groups.map((g) => [g.key, g.label, g.rows.map((r) => r.id)])
		).toEqual([
			["yourTurn", "Your turn", [2]],
			["recent", "Recent", [1, 4]],
			["older", "Older", [3]]
		])
	})

	test("an old session waiting on you is still under Your turn", () => {
		const [group] = groupSessions([row(1, { agoMs: 400 * 24 * HOUR })], {
			now: NOW
		})
		expect(group.key).toBe("yourTurn")
	})

	test("the week boundary is rolling and inclusive", () => {
		const groups = groupSessions(
			[
				row(1, { isUser: true, agoMs: RECENT_WINDOW_MS }),
				row(2, { isUser: true, agoMs: RECENT_WINDOW_MS + 1 })
			],
			{ now: NOW }
		)
		expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
			["recent", [1]],
			["older", [2]]
		])
	})

	test("a running session falls back to its activity group", () => {
		const groups = groupSessions([row(1), row(2)], {
			now: NOW,
			isRunning: (r) => r.id === 1
		})
		expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
			["yourTurn", [2]],
			["recent", [1]]
		])
	})

	test("no timestamp at all reads as older", () => {
		const [group] = groupSessions([{ updatedAt: null }], { now: NOW })
		expect(group.key).toBe("older")
	})

	test("an empty list has no groups", () => {
		expect(groupSessions([], { now: NOW })).toEqual([])
	})
})
