/**
 * `sessions:rowChanged` — the push that keeps a session's list row current.
 *
 * Two things are pinned here, and they are the two that would rot silently:
 *
 *   1. **The push and the list agree.** They are the same projection
 *      (`sessions/rowProjection.ts`) asked for one session and for all of
 *      them, so a row patched by a push and the same row in the next
 *      `sessions:list` must say the same thing — the three exclusions
 *      included. A card that quotes a hidden line after a push and the real
 *      line after a reload is the failure this prevents.
 *   2. **A burst is one push.** A streamed reply announces its row every few
 *      hundred milliseconds; the debounce is what keeps that from being two
 *      queries and a broadcast per chunk.
 *
 * Real timers rather than fake ones: the callback runs a PGlite read and a
 * socket fan-out, and faking the clock out from under those buys a quarter of
 * a second at the price of testing the mock.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-row-push-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	const { __resetRowPushForTests } = await import("./rowPush")
	__resetRowPushForTests()
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeSession(userId: number, name: string) {
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name })
		.returning()
	return session
}

/**
 * The half of a Socket.IO server the interest gate and the emit read, with one
 * connected socket holding a BARE `sessions:rowChanged` — the sidebar's own
 * declaration.
 */
function fakeIo(userId: number) {
	const emitted: Array<{ event: string; payload: any }> = []
	const socket = {
		id: "socket-1",
		user: { id: userId, isAdmin: false },
		interest: new Set(["sessions:rowChanged"])
	}
	const io = {
		sockets: {
			adapter: { rooms: { get: () => new Set(["socket-1"]) } },
			sockets: {
				get: () => socket,
				values: () => [socket][Symbol.iterator]()
			}
		},
		to: () => ({
			emit: (event: string, payload: any) =>
				emitted.push({ event, payload })
		})
	}
	return { io: io as any, emitted, socket }
}

/** Long enough for the trailing debounce plus the read behind it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 600))

describe("sessions:rowChanged (PGlite integration)", () => {
	test("the pushed row is the row sessions:list projects", async () => {
		const owner = await makeUser("rowpush-parity")
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: "Brother Alder", description: "" })
			.returning()
		const session = await makeSession(owner.id, "The Chapel")

		await testDb.insert(schema.sessionMessages).values([
			{
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "The candles have not been lit since *Tuesday*."
			},
			{
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "Hidden by the owner.",
				isHidden: true
			},
			{
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "",
				isGenerating: true
			},
			{
				sessionId: session.id,
				characterId: character.id,
				role: "assistant",
				content: "\n \t "
			}
		])

		const { sessionRowFrame } = await import("./rowPush")
		const { sessionsListHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const listed = (
			await sessionsListHandler.handler(
				{
					user: { id: owner.id },
					io: { to: () => ({ emit: () => {} }) }
				} as any,
				{},
				() => {}
			)
		)!.sessionList.find((s) => s.id === session.id)!
		const pushed = await sessionRowFrame(testDb as any, session.id)

		expect(pushed).not.toBeNull()
		// The hidden row, the placeholder and the blank one are all excluded
		// from the quote on BOTH paths, and counted by neither's exclusions.
		expect(pushed!.lastMessage).toEqual(listed.lastMessage)
		expect(pushed!.lastMessage!.excerpt).toBe(
			"The candles have not been lit since Tuesday."
		)
		expect(pushed!.messageCount).toBe(listed.messageCount)
		expect(pushed!.messageCount).toBe(4)
		expect(pushed!.updatedAt).toBe(String(listed.updatedAt))
	}, 60_000)

	test("a session with nothing visible pushes a null quote", async () => {
		const owner = await makeUser("rowpush-empty")
		const session = await makeSession(owner.id, "Nothing yet")
		const { sessionRowFrame } = await import("./rowPush")

		const empty = await sessionRowFrame(testDb as any, session.id)
		expect(empty!.lastMessage).toBeNull()
		expect(empty!.messageCount).toBe(0)

		// The one visible line, then hidden: the quote has to go back to null
		// rather than keep what it was.
		const [message] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				content: "A line somebody thought better of."
			})
			.returning()
		expect((await sessionRowFrame(testDb as any, session.id))!.lastMessage)
			.not.toBeNull()

		await testDb
			.update(schema.sessionMessages)
			.set({ isHidden: true })
			.where(eq(schema.sessionMessages.id, message.id))
		const hidden = await sessionRowFrame(testDb as any, session.id)
		expect(hidden!.lastMessage).toBeNull()
		// Hiding removes the quote, never the row from the count.
		expect(hidden!.messageCount).toBe(1)
	}, 60_000)

	test("a session that has gone pushes nothing at all", async () => {
		const { sessionRowFrame } = await import("./rowPush")
		expect(await sessionRowFrame(testDb as any, 9_999_999)).toBeNull()
	}, 60_000)

	test("a burst of calls is one broadcast, carrying the state at the end of it", async () => {
		const owner = await makeUser("rowpush-debounce")
		const session = await makeSession(owner.id, "The Long Stream")
		const { broadcastSessionRow, __resetRowPushForTests } = await import(
			"./rowPush"
		)
		__resetRowPushForTests()
		const { io, emitted } = fakeIo(owner.id)

		// Five announcements in the time one chunk takes — what a streamed
		// reply does.
		for (let i = 0; i < 5; i++) {
			await testDb.insert(schema.sessionMessages).values({
				sessionId: session.id,
				role: "assistant",
				content: `chunk ${i}`
			})
			broadcastSessionRow(io, session.id)
		}
		await settle()

		expect(emitted).toHaveLength(1)
		expect(emitted[0].event).toBe("sessions:rowChanged")
		expect(emitted[0].payload.sessionId).toBe(session.id)
		// The read happens when the debounce fires, so the frame is the state
		// after the last call rather than at any one of them.
		expect(emitted[0].payload.messageCount).toBe(5)
		expect(emitted[0].payload.lastMessage.excerpt).toBe("chunk 4")

		// A later burst is its own push — the map empties between them.
		broadcastSessionRow(io, session.id)
		await settle()
		expect(emitted).toHaveLength(2)
	}, 60_000)

	test("nobody holding the key means no read and no emit", async () => {
		const owner = await makeUser("rowpush-gate")
		const session = await makeSession(owner.id, "Unwatched")
		const { broadcastSessionRow, __resetRowPushForTests } = await import(
			"./rowPush"
		)
		__resetRowPushForTests()
		const { io, emitted, socket } = fakeIo(owner.id)
		socket.interest = new Set(["sessions:list"])

		broadcastSessionRow(io, session.id)
		await settle()
		expect(emitted).toHaveLength(0)
	}, 60_000)
})
