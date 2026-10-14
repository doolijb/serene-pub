/**
 * The conversations store end to end against real migrations (0107):
 * membership scoping (one wording for a non-member), the direct pair dedupe,
 * host hand-over on leave and delete-on-last-leave, tombstones, read markers
 * clearing the notification row, the attachment gate refusing a send, and the
 * messaging switch refusing everything.
 *
 * Every store call is handed `testDb`; `$lib/server/db` is replaced so the
 * access helpers (which read the app handle) see the same database, and
 * `pushToUser` is a spy.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const { getDb, setDb, pushSpy } = vi.hoisted(() => {
	let current: unknown
	return {
		getDb: () => current,
		setDb: (db: unknown) => {
			current = db
		},
		pushSpy: vi.fn()
	}
})

vi.mock("$lib/server/db", () => ({
	get db() {
		return getDb()
	}
}))
vi.mock("$lib/server/sockets/utils/userPush", () => ({ pushToUser: pushSpy }))
vi.mock("$lib/server/notifications/viewing", () => ({
	userIsViewing: () => false
}))

import * as store from "./store"
import {
	CONVERSATION_NOT_FOUND,
	MESSAGING_OFF
} from "$lib/shared/sockets/conversations"
import { regardingFor } from "$lib/shared/notifications/kinds"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"

let testDb: TestDb
let db: Db
let n = 0

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	db = testDb as unknown as Db
	setDb(testDb)
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1, isAccountsEnabled: true })
		.onConflictDoUpdate({
			target: schema.systemSettings.id,
			set: { isAccountsEnabled: true, messagingEnabled: true }
		})
}, 60_000)

afterAll(async () => {
	await (testDb as any)?.$client?.close?.()
})

async function user(displayName?: string): Promise<number> {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: `pm-${n++}-${Math.random().toString(36).slice(2, 7)}`, displayName })
		.returning()
	return u.id
}

const notifRows = (userId: number) =>
	testDb
		.select()
		.from(schema.notifications)
		.where(eq(schema.notifications.userId, userId))

const T = 60_000

describe("conversations store (PGlite integration)", () => {
	test("a direct conversation is one per pair, whoever starts it", async () => {
		const a = await user()
		const b = await user()
		const first = await store.create(db, a, { userIds: [b] })
		expect(first.existing).toBe(false)
		expect(first.conversation.kind).toBe("direct")
		expect(first.conversation.members.map((m) => m.id).sort()).toEqual([a, b].sort())
		const again = await store.create(db, b, { userIds: [a] })
		expect(again.existing).toBe(true)
		expect(again.conversation.id).toBe(first.conversation.id)
		const [row] = await testDb
			.select()
			.from(schema.conversations)
			.where(eq(schema.conversations.id, first.conversation.id))
		expect(row.pairKey).toBe(store.pairKeyOf(a, b))
	}, T)

	test("membership scopes every read and write, with one wording", async () => {
		const a = await user()
		const b = await user()
		const stranger = await user()
		const { conversation } = await store.create(db, a, { userIds: [b] })
		await store.send(db, a, { conversationId: conversation.id, body: "hello" })

		expect((await store.listFor(db, stranger)).map((c) => c.id)).not.toContain(conversation.id)
		await expect(
			store.open(db, stranger, { conversationId: conversation.id })
		).rejects.toThrow(CONVERSATION_NOT_FOUND)
		await expect(
			store.send(db, stranger, { conversationId: conversation.id, body: "hi" })
		).rejects.toThrow(CONVERSATION_NOT_FOUND)
		await expect(
			store.markRead(db, stranger, { conversationId: conversation.id, upTo: 999 })
		).rejects.toThrow(CONVERSATION_NOT_FOUND)
		// A conversation that never existed reads exactly the same.
		await expect(
			store.open(db, stranger, { conversationId: 9_999_999 })
		).rejects.toThrow(CONVERSATION_NOT_FOUND)

		const page = await store.open(db, b, { conversationId: conversation.id })
		expect(page.messages.map((m) => m.body)).toEqual(["hello"])
		expect(page.hasEarlier).toBe(false)
		const [listed] = (await store.listFor(db, b)).filter((c) => c.id === conversation.id)
		expect(listed.unread).toBe(1)
		expect(listed.lastMessage?.excerpt).toBe("hello")
		// The author's own message is never unread for them.
		const [mine] = (await store.listFor(db, a)).filter((c) => c.id === conversation.id)
		expect(mine.unread).toBe(0)
	}, T)

	test("open pages backwards with hasEarlier", async () => {
		const a = await user()
		const b = await user()
		const { conversation } = await store.create(db, a, { userIds: [b] })
		for (let i = 0; i < 5; i++)
			await store.send(db, a, { conversationId: conversation.id, body: `m${i}` })
		const last = await store.open(db, b, { conversationId: conversation.id, limit: 2 })
		expect(last.messages.map((m) => m.body)).toEqual(["m3", "m4"])
		expect(last.hasEarlier).toBe(true)
		const earlier = await store.open(db, b, {
			conversationId: conversation.id,
			limit: 10,
			before: last.messages[0].id
		})
		expect(earlier.messages.map((m) => m.body)).toEqual(["m0", "m1", "m2"])
		expect(earlier.hasEarlier).toBe(false)
	}, T)

	test("send refuses an empty or over-long body", async () => {
		const a = await user()
		const b = await user()
		const { conversation } = await store.create(db, a, { userIds: [b] })
		await expect(
			store.send(db, a, { conversationId: conversation.id, body: "   " })
		).rejects.toThrow(store.BODY_EMPTY)
		await expect(
			store.send(db, a, { conversationId: conversation.id, body: "x".repeat(8_001) })
		).rejects.toThrow(store.BODY_TOO_LONG)
	}, T)

	test("send pushes to every member and notifies all but the author and the muted", async () => {
		const a = await user("Ana")
		const b = await user()
		const c = await user()
		const { conversation } = await store.create(db, a, {
			userIds: [b, c],
			name: "Crew"
		})
		await store.mute(db, c, { conversationId: conversation.id, muted: true })
		pushSpy.mockClear()
		await store.send(db, a, { conversationId: conversation.id, body: "Meet at dawn" })
		const pushed = pushSpy.mock.calls
			.filter(([, event]) => event === "conversations:message")
			.map(([id]) => id)
		expect(pushed.sort()).toEqual([a, b, c].sort())

		const regarding = regardingFor.conversation(conversation.id)
		const forB = (await notifRows(b)).filter((r) => r.regarding === regarding)
		expect(forB).toHaveLength(1)
		expect(forB[0].vars).toMatchObject({ author: "Ana", conversation: "Crew", excerpt: "Meet at dawn" })
		expect((await notifRows(a)).filter((r) => r.regarding === regarding)).toHaveLength(0)
		expect((await notifRows(c)).filter((r) => r.regarding === regarding)).toHaveLength(0)
	}, T)

	test("markRead moves the marker and clears the notification as viewed", async () => {
		const a = await user()
		const b = await user()
		const { conversation } = await store.create(db, a, { userIds: [b] })
		const { message } = await store.send(db, a, { conversationId: conversation.id, body: "ping" })
		const regarding = regardingFor.conversation(conversation.id)
		expect(
			(await notifRows(b)).filter((r) => r.regarding === regarding && !r.clearedAt)
		).toHaveLength(1)

		// Past the newest message is capped to it.
		const res = await store.markRead(db, b, { conversationId: conversation.id, upTo: message.id + 50 })
		expect(res.lastReadMessageId).toBe(message.id)
		const rows = (await notifRows(b)).filter((r) => r.regarding === regarding)
		expect(rows.every((r) => r.clearedAt && r.clearedHow === "viewed")).toBe(true)
		const [listed] = (await store.listFor(db, b)).filter((c) => c.id === conversation.id)
		expect(listed.unread).toBe(0)
		// Never backwards.
		const back = await store.markRead(db, b, { conversationId: conversation.id, upTo: 0 })
		expect(back.lastReadMessageId).toBe(message.id)
	}, T)

	test("edit and remove are the author's; remove leaves a tombstone", async () => {
		const a = await user()
		const b = await user()
		const { conversation } = await store.create(db, a, { userIds: [b] })
		const { message } = await store.send(db, a, { conversationId: conversation.id, body: "draft" })
		await expect(
			store.edit(db, b, { messageId: message.id, body: "mine now" })
		).rejects.toThrow(/Only the person who wrote/)
		const edited = await store.edit(db, a, { messageId: message.id, body: "final" })
		expect(edited.message).toMatchObject({ body: "final", isEdited: true })

		const removed = await store.remove(db, a, { messageId: message.id })
		expect(removed.message.body).toBe("")
		expect(removed.message.deletedAt).not.toBeNull()
		const page = await store.open(db, b, { conversationId: conversation.id })
		expect(page.messages).toHaveLength(1)
		expect(page.messages[0].deletedAt).not.toBeNull()
		const [listed] = (await store.listFor(db, b)).filter((c) => c.id === conversation.id)
		expect(listed.lastMessage?.excerpt).toBe("Message removed")
		expect(listed.unread).toBe(0)
		await expect(store.edit(db, a, { messageId: message.id, body: "back" })).rejects.toThrow()
	}, T)

	test("host only manages; leaving hands the host to the oldest member; last out deletes", async () => {
		const host = await user()
		const b = await user()
		const c = await user()
		const { conversation } = await store.create(db, host, { userIds: [b, c], name: "Trio" })
		expect(conversation.hostUserId).toBe(host)
		await expect(
			store.rename(db, b, { conversationId: conversation.id, name: "Mine" })
		).rejects.toThrow(store.NOT_HOST)
		const renamed = await store.rename(db, host, { conversationId: conversation.id, name: "Quartet" })
		expect(renamed.name).toBe("Quartet")

		pushSpy.mockClear()
		await store.removeMember(db, host, { conversationId: conversation.id, userId: c })
		expect(pushSpy).toHaveBeenCalledWith(c, "conversations:changed", {
			conversationId: conversation.id,
			removed: true
		})
		await expect(store.open(db, c, { conversationId: conversation.id })).rejects.toThrow(
			CONVERSATION_NOT_FOUND
		)
		await store.addMembers(db, host, { conversationId: conversation.id, userIds: [c] })

		await store.leave(db, host, { conversationId: conversation.id })
		const [after] = await testDb
			.select()
			.from(schema.conversations)
			.where(eq(schema.conversations.id, conversation.id))
		expect(after.hostUserId).toBe(b)

		await store.leave(db, b, { conversationId: conversation.id })
		const out = await store.leave(db, c, { conversationId: conversation.id })
		expect(out.deleted).toBe(true)
		expect(
			await testDb
				.select()
				.from(schema.conversations)
				.where(eq(schema.conversations.id, conversation.id))
		).toHaveLength(0)
	}, T)

	test("the gate refuses a session some member cannot open, naming them", async () => {
		const a = await user()
		const b = await user("Nia")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: a,
				isGroup: false,
				name: "The Long Night",
				sessionType: SessionTypes.ROLEPLAY
			})
			.returning()
		const { conversation } = await store.create(db, a, { userIds: [b] })
		const pick = { kind: "session" as const, subjectId: session.id }
		await expect(
			store.send(db, a, { conversationId: conversation.id, body: "look", attachments: [pick] })
		).rejects.toThrow("Nia can't see “The Long Night”. Add them as guests first, or send without it.")

		const offered = await store.attachable(db, a, {
			conversationId: conversation.id,
			kind: "session"
		})
		expect(offered.candidates.map((c) => c.subjectId)).not.toContain(session.id)

		await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: b })
		const sent = await store.send(db, a, {
			conversationId: conversation.id,
			body: "look",
			attachments: [pick]
		})
		expect(sent.message.attachments[0]).toMatchObject({
			kind: "session",
			subjectId: session.id,
			available: true,
			title: "The Long Night"
		})
		// Access revoked later: the reader sees "not shared", the text stands (Q6).
		await testDb
			.delete(schema.sessionGuests)
			.where(and(eq(schema.sessionGuests.sessionId, session.id), eq(schema.sessionGuests.userId, b)))
		const page = await store.open(db, b, { conversationId: conversation.id })
		const last = page.messages[page.messages.length - 1]
		expect(last.body).toBe("look")
		expect(last.attachments[0]).toMatchObject({ available: false, unavailableWhy: "not-shared" })
	}, T)

	test("person lists only what the viewer may see of theirs", async () => {
		const owner = await user()
		const viewer = await user()
		const [shared] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Shared book", userId: owner })
			.returning()
		await testDb
			.insert(schema.lorebooks)
			.values({ name: "Private book", userId: owner })
		await testDb.insert(schema.lorebookShares).values({ lorebookId: shared.id, userId: viewer })
		const res = await store.person(db, viewer, { userId: owner })
		expect(res.lorebooks.map((l) => l.title)).toEqual(["Shared book"])
		expect(res.directConversationId).toBeNull()
		const { conversation } = await store.create(db, viewer, { userIds: [owner] })
		expect((await store.person(db, viewer, { userId: owner })).directConversationId).toBe(
			conversation.id
		)
	}, T)

	test("messaging off refuses everything; the data stays", async () => {
		const a = await user()
		const b = await user()
		const { conversation } = await store.create(db, a, { userIds: [b] })
		await testDb
			.update(schema.systemSettings)
			.set({ messagingEnabled: false })
			.where(eq(schema.systemSettings.id, 1))
		try {
			await expect(store.listFor(db, a)).rejects.toThrow(MESSAGING_OFF)
			await expect(store.people(db, a)).rejects.toThrow(MESSAGING_OFF)
			await expect(
				store.send(db, a, { conversationId: conversation.id, body: "hi" })
			).rejects.toThrow(MESSAGING_OFF)
		} finally {
			await testDb
				.update(schema.systemSettings)
				.set({ messagingEnabled: true })
				.where(eq(schema.systemSettings.id, 1))
		}
		expect((await store.listFor(db, a)).map((c) => c.id)).toContain(conversation.id)
	}, T)
})
