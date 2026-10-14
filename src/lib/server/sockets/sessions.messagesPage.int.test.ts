/**
 * `sessions:messagesPage` (D7 ruling A): one page of a session's lines for
 * one widget — by cursor, limit and channel, oldest first, with the next
 * cursor only while an older page exists; a guest reads, a stranger is refused.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(() => {})

const fakeSocket = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

async function scenario() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `mp-owner-${Date.now()}`)
	const guest = await createTestUser(testDb, `mp-guest-${Date.now()}`)
	const stranger = await createTestUser(testDb, `mp-stranger-${Date.now()}`)
	const [session] = await testDb.insert(schema.sessions).values({ userId: owner.id, isGroup: true }).returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: guest.id, isPlayer: true })
	const rows = await testDb
		.insert(schema.sessionMessages)
		.values(
			Array.from({ length: 7 }, (_, i) => ({
				sessionId: session.id,
				userId: owner.id,
				role: "user",
				content: `line ${i + 1}`,
				channel: i % 3 === 2 ? "sanctum" : i === 4 ? "main:2" : "main"
			}))
		)
		.returning()
	return { owner, guest, stranger, session, rows }
}

describe("sessions:messagesPage", () => {
	test("pages newest-first by cursor, oldest first within a page, and stops when nothing older remains", async () => {
		const { sessionsMessagesPageHandler: h } = await import("./sessions")
		const s = await scenario()
		const ids = s.rows.map((r) => r.id)
		const first = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, limit: 3, requestId: "a" }, noopEmit)
		expect(first.error).toBeUndefined()
		expect(first.requestId).toBe("a")
		expect(first.rows.map((r) => r.id)).toEqual(ids.slice(4, 7))
		expect(first.nextCursor).toBe(String(ids[4]))
		const second = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, limit: 3, beforeId: Number(first.nextCursor) }, noopEmit)
		expect(second.rows.map((r) => r.id)).toEqual(ids.slice(1, 4))
		const last = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, limit: 3, beforeId: Number(second.nextCursor) }, noopEmit)
		expect(last.rows.map((r) => r.id)).toEqual(ids.slice(0, 1))
		expect(last.nextCursor).toBeUndefined()
	}, 60_000)

	test("a bare slug is the whole channel, every lane; `slug:n` one lane; the limit is clamped", async () => {
		const { sessionsMessagesPageHandler: h } = await import("./sessions")
		const s = await scenario()
		const byChannel = (c: string) => s.rows.filter((r) => r.channel === c || r.channel.startsWith(c + ":")).map((r) => r.id)
		const main = await h.handler(fakeSocket(s.guest.id), { sessionId: s.session.id, channel: "main" }, noopEmit)
		expect(main.rows.map((r) => r.id)).toEqual(byChannel("main"))
		const lane2 = await h.handler(fakeSocket(s.guest.id), { sessionId: s.session.id, channel: "main:2" }, noopEmit)
		expect(lane2.rows.map((r) => r.channel)).toEqual(["main:2"])
		const sanctum = await h.handler(fakeSocket(s.guest.id), { sessionId: s.session.id, channel: "sanctum" }, noopEmit)
		expect(sanctum.rows.map((r) => r.channel)).toEqual(["sanctum", "sanctum"])
		const clamped = await h.handler(fakeSocket(s.guest.id), { sessionId: s.session.id, limit: 0 }, noopEmit)
		expect(clamped.rows).toHaveLength(1)
	}, 60_000)

	test("a stranger is refused in words with no rows; a bad cursor too", async () => {
		const { sessionsMessagesPageHandler: h } = await import("./sessions")
		const s = await scenario()
		const refused = await h.handler(fakeSocket(s.stranger.id), { sessionId: s.session.id }, noopEmit)
		expect(refused).toMatchObject({ sessionId: s.session.id, rows: [], error: "This session is not yours to read." })
		const bad = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, beforeId: "x" as never }, noopEmit)
		expect(bad.error).toMatch(/beforeId must be a message id/)
	}, 60_000)
})
