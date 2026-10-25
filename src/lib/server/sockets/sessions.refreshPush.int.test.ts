/**
 * pr-6 B §B-1: the two session payload shapes. `sessions:get` answers an ask
 * (the first page per channel, ascending, rows read once); every member push is
 * `sessions:refresh` (`coversFromId` + the newest REFRESH_ROWS live rows,
 * narrowed per member by lane). `rewindStateOf` carries `regenerate`, and
 * `sessions:view` sends the turn order to the viewer alone.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const SHAPE = { channels: ["phone", { slug: "parley", lanes: "personal" }] }

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/pipelines/entities/sessionGenres", async (orig) => {
	const real = (await orig()) as Record<string, unknown>
	return {
		...real,
		getSessionGenre: async (_db: unknown, genreId: string) =>
			genreId === "test:genre/lanes" ? { genreId, name: "Lanes", shape: SHAPE } : null,
		sessionGenreAvailable: async () => ({ available: true })
	}
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-refresh-push-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(name: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(db, `${name}-${Math.random().toString(36).slice(2, 7)}`)
}

async function table(genreId = "test:genre/lanes") {
	const owner = await makeUser("owner")
	const ann = await makeUser("ann")
	const bo = await makeUser("bo")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId } as any)
		.returning()
	await db.insert(schema.sessionGuests).values([
		{ sessionId: session.id, userId: ann.id },
		{ sessionId: session.id, userId: bo.id }
	])
	return { owner, ann, bo, session }
}

async function line(sessionId: number, channel: string, content: string, userId?: number) {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: userId ? "user" : "assistant", channel, content, ...(userId ? { userId } : {}) })
		.returning()
	return row
}

const fakeSocket = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noop = () => {}

/** An io whose members each hold one socket wanting `events`; every emit is captured per user. */
function capturingIo(userIds: number[], events: string[]) {
	const sockets = new Map<string, any>()
	const rooms = new Map<string, Set<string>>()
	const sent: { userId: number; event: string; data: any }[] = []
	for (const userId of userIds) {
		const id = `s${userId}`
		sockets.set(id, { id, user: { id: userId }, interest: new Set(events) })
		rooms.set(`user_${userId}`, new Set([id]))
	}
	return {
		sent,
		sockets: { adapter: { rooms }, sockets },
		to: (id: string) => ({
			emit: (event: string, data: any) => {
				const userId = Number(id.slice(1))
				sent.push({ userId, event, data })
			}
		})
	} as any
}

describe("sessions:get — shape 1", () => {
	it("first page: ascending by id, at most `limit` per channel, olderIn names a channel with more", async () => {
		const { sessionsGetHandler } = await import("./sessions")
		const { owner, session } = await table()
		for (let i = 0; i < 5; i++) await line(session.id, "main", `m${i}`)
		await line(session.id, "phone", "p0")
		await line(session.id, "phone", "p1")
		const res = (await sessionsGetHandler.handler(fakeSocket(owner.id), { id: session.id, limit: 3 } as any, noop)) as any
		const ids: number[] = res.messages.map((r: any) => r.id)
		expect(ids).toEqual([...ids].sort((a, b) => a - b))
		const per = (c: string) => res.messages.filter((r: any) => r.channel === c).length
		expect(per("main")).toBe(3)
		expect(per("phone")).toBe(2)
		expect(res.pagination.olderIn).toEqual(["main"])
		expect(res.session.sessionMessages.map((r: any) => r.id)).toEqual(ids)
		expect(res.session).toHaveProperty("settledLine")
		expect(res.session).toHaveProperty("ownBookId")
		expect(res.session.rewind).toHaveProperty("regenerate")
	})
})

describe("sessions:refresh — shape 2", () => {
	it("is the push event, carries coversFromId and no pagination, and a guest is not sent another's personal lane", async () => {
		const { pushSessionToParticipants } = await import("./sessions")
		const { laneFor } = await import("$lib/server/channels/lanes")
		const { owner, ann, bo, session } = await table()
		const annLane = (await laneFor(db as any, session.id, "parley", ann.id)).channel
		const boLane = (await laneFor(db as any, session.id, "parley", bo.id)).channel
		const first = await line(session.id, "main", "everyone")
		await line(session.id, annLane, "ann's secret", ann.id)
		await line(session.id, boLane, "bo's secret", bo.id)
		const io = capturingIo([owner.id, ann.id, bo.id], ["sessions:refresh"])
		await pushSessionToParticipants(io, session.id, owner.id)
		const to = (u: number) => io.sent.filter((s: any) => s.userId === u)
		expect(io.sent.every((s: any) => s.event === "sessions:refresh")).toBe(true)
		expect(to(ann.id).length).toBe(1)
		const annData = to(ann.id)[0].data
		expect(annData.coversFromId).toBe(first.id)
		expect(annData).not.toHaveProperty("pagination")
		expect(annData).not.toHaveProperty("userDraft")
		expect(annData.messages.map((r: any) => r.content)).toEqual(["everyone", "ann's secret"])
		expect(to(bo.id)[0].data.session.sessionMessages.map((r: any) => r.content)).toEqual(["everyone", "bo's secret"])
		expect(to(owner.id)[0].data.messages.length).toBe(3)
		expect(annData.session.channels).toBeTruthy()
	})

	it("120 live rows: the push carries the newest 100 and coversFromId is the 100th newest id", async () => {
		const { pushSessionToParticipants } = await import("./sessions")
		const { owner, session } = await table()
		const rows = await db
			.insert(schema.sessionMessages)
			.values(Array.from({ length: 120 }, (_, i) => ({ sessionId: session.id, role: "assistant", channel: "main", content: `l${i}` })))
			.returning()
		const ids = rows.map((r) => r.id).sort((a, b) => a - b)
		const io = capturingIo([owner.id], ["sessions:refresh"])
		await pushSessionToParticipants(io, session.id, owner.id)
		const data = io.sent[0].data
		expect(data.messages.length).toBe(100)
		expect(data.coversFromId).toBe(ids[20])
		expect(data.messages[0].id).toBe(ids[20])
	})
})

describe("rewindStateOf — regenerate", () => {
	it("names the refusal: empty on an empty session, ownLine when the newest story line is a person's", async () => {
		const { rewindStateOf, REWIND_REFUSALS } = await import("$lib/server/sessions/rewind")
		const { owner, session } = await table()
		expect((await rewindStateOf(db as any, session.id)).regenerate).toBe(REWIND_REFUSALS.empty)
		await line(session.id, "main", "my line", owner.id)
		expect((await rewindStateOf(db as any, session.id)).regenerate).toBe(REWIND_REFUSALS.ownLine)
	})
})

describe("sessions:view — the turn order", () => {
	it("goes to the viewer alone", async () => {
		const { sessionsViewHandler } = await import("./sessions")
		const { owner, ann, session } = await table()
		const io = capturingIo([owner.id, ann.id], ["sessions:turnOrder"])
		const heard: { event: string }[] = []
		const socket = { user: { id: owner.id }, io } as any
		await sessionsViewHandler.handler(socket, { sessionId: session.id } as any, (event: string) => {
			heard.push({ event })
		})
		expect(heard.some((h) => h.event === "sessions:turnOrder")).toBe(true)
		expect(io.sent.filter((s: any) => s.event === "sessions:turnOrder")).toEqual([])
	})
})
