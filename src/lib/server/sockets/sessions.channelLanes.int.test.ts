/**
 * `sessions:channelLanes` (ruled 2026-10-12): the channel lanes under one
 * channel as the log shows them — one entry per lane with a line, its count
 * and newest line, lane 1 folded whether written bare or as `slug:1`; a lane
 * string answers one lane; a stranger is refused.
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
	const owner = await createTestUser(testDb, `cl-owner-${Date.now()}`)
	const stranger = await createTestUser(testDb, `cl-stranger-${Date.now()}`)
	const [session] = await testDb.insert(schema.sessions).values({ userId: owner.id, isGroup: true }).returning()
	const channels = ["main", "phone", "phone:1", "phone:2", "phone:2", "phone:3", "main"]
	const rows = await testDb
		.insert(schema.sessionMessages)
		.values(channels.map((channel, i) => ({ sessionId: session.id, userId: owner.id, role: "user", content: `line ${i + 1}`, channel })))
		.returning()
	return { owner, stranger, session, rows }
}

describe("sessions:channelLanes", () => {
	test("one entry per lane with a line, lane 1 folded, ordered by lane, with count and newest line", async () => {
		const { sessionsChannelLanesHandler: h } = await import("./sessions")
		const s = await scenario()
		const res = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, channel: "phone", requestId: "r" }, noopEmit)
		expect(res.error).toBeUndefined()
		expect(res.requestId).toBe("r")
		expect(res.lanes.map((l) => [l.channel, l.slug, l.lane, l.count])).toEqual([
			["phone", "phone", 1, 2],
			["phone:2", "phone", 2, 2],
			["phone:3", "phone", 3, 1]
		])
		const lane2Newest = s.rows.filter((r) => r.channel === "phone:2").map((r) => r.id).sort((a, b) => b - a)[0]
		expect(res.lanes[1]!.latest.messageId).toBe(lane2Newest)
		expect(res.lanes[1]!.latest.role).toBe("user")
		expect(typeof res.lanes[1]!.latest.at).toBe("string")
	}, 60_000)

	test("a lane string answers that lane alone; a channel with no lines answers none", async () => {
		const { sessionsChannelLanesHandler: h } = await import("./sessions")
		const s = await scenario()
		const one = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, channel: "phone:3" }, noopEmit)
		expect(one.lanes.map((l) => l.channel)).toEqual(["phone:3"])
		const none = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, channel: "radio" }, noopEmit)
		expect(none.lanes).toEqual([])
	}, 60_000)

	test("a stranger is refused in words; a missing channel too", async () => {
		const { sessionsChannelLanesHandler: h } = await import("./sessions")
		const s = await scenario()
		const refused = await h.handler(fakeSocket(s.stranger.id), { sessionId: s.session.id, channel: "phone" }, noopEmit)
		expect(refused).toMatchObject({ lanes: [], error: "This session is not yours to read." })
		const bad = await h.handler(fakeSocket(s.owner.id), { sessionId: s.session.id, channel: "" }, noopEmit)
		expect(bad.error).toMatch(/channel must be a channel slug/)
	}, 60_000)
})
