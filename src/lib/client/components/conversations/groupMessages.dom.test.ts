import { describe, expect, it } from "vitest"
import type {
	ConversationMessageRow,
	ConversationSummary
} from "$lib/shared/sockets/conversations"
import {
	conversationMatches,
	conversationTitle,
	groupConversations,
	groupMessages
} from "./groupMessages"

const T0 = Date.parse("2026-10-12T12:00:00Z")
const min = 60_000

function msg(
	id: number,
	authorUserId: number | null,
	offsetMs: number,
	extra: Partial<ConversationMessageRow> = {}
): ConversationMessageRow {
	const iso = new Date(T0 + offsetMs).toISOString()
	return {
		id,
		conversationId: 1,
		authorUserId,
		body: `m${id}`,
		isEdited: false,
		deletedAt: null,
		createdAt: iso,
		updatedAt: iso,
		attachments: [],
		...extra
	}
}

describe("groupMessages", () => {
	it("collapses one author's follow-ons within five minutes", () => {
		const rows = groupMessages([
			msg(1, 7, 0),
			msg(2, 7, 2 * min),
			msg(3, 7, 6 * min), // 4 min after the one above: still collapsed
			msg(4, 7, 12 * min) // 6 min after: a new head
		])
		expect(rows.map((r) => r.showHead)).toEqual([true, false, false, true])
	})

	it("draws a head when the author changes", () => {
		const rows = groupMessages([msg(1, 7, 0), msg(2, 8, min), msg(3, 7, 2 * min)])
		expect(rows.map((r) => r.showHead)).toEqual([true, true, true])
	})

	it("never collapses former members (null author)", () => {
		const rows = groupMessages([msg(1, null, 0), msg(2, null, min)])
		expect(rows.map((r) => r.showHead)).toEqual([true, true])
	})

	it("keeps a tombstone in its author's block", () => {
		const rows = groupMessages([
			msg(1, 7, 0),
			msg(2, 7, min, { deletedAt: new Date(T0).toISOString(), body: "" })
		])
		expect(rows.map((r) => r.showHead)).toEqual([true, false])
	})

	it("is empty for no messages", () => {
		expect(groupMessages([])).toEqual([])
	})
})

function convo(
	id: number,
	extra: Partial<ConversationSummary> = {}
): ConversationSummary {
	return {
		id,
		kind: "direct",
		name: null,
		hostUserId: null,
		members: [
			{ id: 1, username: "me", displayName: null },
			{ id: 2, username: "aria", displayName: "Aria" }
		],
		lastMessage: null,
		unread: 0,
		mutedAt: null,
		lastMessageAt: null,
		createdAt: new Date(T0).toISOString(),
		...extra
	}
}

describe("conversation list helpers", () => {
	it("names a direct conversation after the other person", () => {
		expect(conversationTitle(convo(1), 1)).toBe("Aria")
		expect(conversationTitle(convo(1, { name: "Book club" }), 1)).toBe("Book club")
	})

	it("filters by name or member", () => {
		expect(conversationMatches(convo(1), 1, "ari")).toBe(true)
		expect(conversationMatches(convo(1), 1, "me")).toBe(false)
	})

	it("groups unread, recent and older, newest first", () => {
		const day = 86_400_000
		const groups = groupConversations(
			[
				convo(1, { lastMessageAt: new Date(T0 - 30 * day).toISOString() }),
				convo(2, { lastMessageAt: new Date(T0 - day).toISOString() }),
				convo(3, { unread: 2, lastMessageAt: new Date(T0 - 40 * day).toISOString() }),
				convo(4, { lastMessageAt: new Date(T0 - min).toISOString() })
			],
			T0
		)
		expect(groups.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
			["Unread", [3]],
			["Recent", [4, 2]],
			["Older", [1]]
		])
	})
})
