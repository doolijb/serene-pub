/**
 * 🚧 Personal channel lanes on the server (owner ruling 2026-10-17;
 * INTEGRATING §1h) — the lane register, the readers' filter, the push
 * filter, the send door and the `channel-lane` query, over PGlite.
 *
 * The genre is a stand-in whose shape declares `parley` with
 * `lanes: 'personal'` (sessionGenres mocked), so the rule is pinned without
 * booting a catalogue. Two guests and an owner: a guest never receives the
 * other guest's lane, the owner receives both.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const SHAPE = {
	channels: ["phone", { slug: "parley", lanes: "personal" }]
}

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-lanes-int-test-"))
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

/** An owner, two guests, one session of the stand-in genre. */
async function table() {
	const owner = await makeUser("owner")
	const ann = await makeUser("ann")
	const bo = await makeUser("bo")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId: "test:genre/lanes" } as any)
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

describe("the lane register (laneFor)", () => {
	it("allocates one lane per person, past every lane already written, and answers the same lane twice", async () => {
		const { laneFor, laneOwner } = await import("./lanes")
		const { owner, ann, bo, session } = await table()
		// A lane written before the register knew it (a pipeline's): never re-handed.
		await line(session.id, "parley:2", "old talk")
		const first = await laneFor(db as any, session.id, "parley", owner.id)
		expect(first).toEqual({ channel: "parley:3", lane: 3, opened: true })
		const again = await laneFor(db as any, session.id, "parley", owner.id)
		expect(again).toEqual({ channel: "parley:3", lane: 3, opened: false })
		const a = await laneFor(db as any, session.id, "parley", ann.id)
		const b = await laneFor(db as any, session.id, "parley:9", bo.id)
		expect(a.channel).toBe("parley:4")
		expect(b.channel).toBe("parley:5")
		expect(await laneOwner(db as any, session.id, "parley:4")).toBe(ann.id)
		expect(await laneOwner(db as any, session.id, "parley:2")).toBeNull()
	})

	it("refuses a shared channel, main, and a person who is not at the table", async () => {
		const { laneFor, LaneRefusal } = await import("./lanes")
		const { owner, session } = await table()
		const stranger = await makeUser("stranger")
		await expect(laneFor(db as any, session.id, "phone", owner.id)).rejects.toBeInstanceOf(LaneRefusal)
		await expect(laneFor(db as any, session.id, "main", owner.id)).rejects.toBeInstanceOf(LaneRefusal)
		await expect(laneFor(db as any, session.id, "parley", stranger.id)).rejects.toBeInstanceOf(LaneRefusal)
	})

	it("two people asking at once get two lanes (the advisory lock)", async () => {
		const { laneFor } = await import("./lanes")
		const { ann, bo, session } = await table()
		const [a, b] = await Promise.all([
			laneFor(db as any, session.id, "parley", ann.id),
			laneFor(db as any, session.id, "parley", bo.id)
		])
		expect(new Set([a.lane, b.lane]).size).toBe(2)
	})
})

describe("readers and pushes see only the lanes they may read", () => {
	it("history, the page reader, the lanes list and the push: a guest never gets the other guest's lane; the owner gets both", async () => {
		const { laneFor } = await import("./lanes")
		const { laneScopedRecipients } = await import("./lanePush")
		const { sessionsGetHandler, sessionsMessagesPageHandler, sessionsChannelLanesHandler, sessionMessageHandler } =
			await import("$lib/server/sockets/sessions")
		const { owner, ann, bo, session } = await table()
		const annLane = (await laneFor(db as any, session.id, "parley", ann.id)).channel
		const boLane = (await laneFor(db as any, session.id, "parley", bo.id)).channel
		await line(session.id, "main", "everyone")
		const annRow = await line(session.id, annLane, "ann's secret", ann.id)
		const boRow = await line(session.id, boLane, "bo's secret", bo.id)
		await line(session.id, "phone:2", "a shared lane")

		const contents = (rows: any[]) => rows.map((r) => r.content).sort()

		// sessions:get — the history window.
		const getFor = async (userId: number) =>
			(await sessionsGetHandler.handler(fakeSocket(userId), { id: session.id, limit: 50 } as any, noop)) as any
		expect(contents((await getFor(ann.id)).messages)).toEqual(["a shared lane", "ann's secret", "everyone"])
		expect(contents((await getFor(bo.id)).messages)).toEqual(["a shared lane", "bo's secret", "everyone"])
		expect(contents((await getFor(owner.id)).messages)).toEqual(["a shared lane", "ann's secret", "bo's secret", "everyone"])
		// …with the viewer's channels view.
		const annView = (await getFor(ann.id)).session.channels
		expect(annView.find((c: any) => c.slug === "parley")).toMatchObject({ lanes: "personal", mine: annLane })
		expect(annView.find((c: any) => c.slug === "phone")).toMatchObject({ lanes: "shared" })
		expect((await getFor(ann.id)).pagination.total).toBe(3)

		// sessions:messagesPage — "all rows of channel X".
		const pageFor = async (userId: number) =>
			(await sessionsMessagesPageHandler.handler(fakeSocket(userId), { sessionId: session.id, channel: "parley" } as any, noop)) as any
		expect(contents((await pageFor(ann.id)).rows)).toEqual(["ann's secret"])
		expect(contents((await pageFor(owner.id)).rows)).toEqual(["ann's secret", "bo's secret"])

		// sessions:channelLanes — the lanes under parley.
		const lanesFor = async (userId: number) =>
			(await sessionsChannelLanesHandler.handler(fakeSocket(userId), { sessionId: session.id, channel: "parley" } as any, noop)) as any
		expect((await lanesFor(bo.id)).lanes.map((l: any) => l.channel)).toEqual([boLane])
		expect((await lanesFor(owner.id)).lanes.map((l: any) => l.channel).sort()).toEqual([annLane, boLane].sort())

		// sessionMessage by id — another's lane refused.
		await expect(sessionMessageHandler.handler(fakeSocket(bo.id), { id: annRow.id } as any, noop)).rejects.toThrow()
		expect(((await sessionMessageHandler.handler(fakeSocket(owner.id), { id: annRow.id } as any, noop)) as any).sessionMessage.id).toBe(annRow.id)

		// The push: one row reaches its person and the owner.
		const members = [owner.id, ann.id, bo.id]
		const toAnn = await laneScopedRecipients(db as any, session.id, "sessionMessage", { sessionMessage: annRow }, members)
		expect(toAnn.map((r) => r.userId).sort()).toEqual([owner.id, ann.id].sort())
		const toBo = await laneScopedRecipients(db as any, session.id, "sessionMessage", { sessionMessage: boRow }, members)
		expect(toBo.map((r) => r.userId).sort()).toEqual([owner.id, bo.id].sort())
		const mainRow = { sessionId: session.id, channel: "main", content: "x" }
		expect((await laneScopedRecipients(db as any, session.id, "sessionMessage", { sessionMessage: mainRow }, members)).length).toBe(3)

		// The whole-session push: each member their own rows.
		const all = await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, session.id))
		const pushed = await laneScopedRecipients(db as any, session.id, "sessions:get", { session: { id: session.id, sessionMessages: all }, messages: all }, members)
		const byUser = new Map(pushed.map((r) => [r.userId, r.data]))
		expect(contents(byUser.get(ann.id).messages)).toEqual(["a shared lane", "ann's secret", "everyone"])
		expect(contents(byUser.get(bo.id).session.sessionMessages)).toEqual(["a shared lane", "bo's secret", "everyone"])
		expect(byUser.get(owner.id).messages.length).toBe(4)
		expect(byUser.get(bo.id).session.channels.find((c: any) => c.slug === "parley").mine).toBe(boLane)
	})
})

describe("unseen and the read mark", () => {
	it("counts others' lines since the mark on lanes the viewer reads; laneRead moves the mark", async () => {
		const { laneViewFor } = await import("./lanes")
		const { sessionChannelsFor } = await import("./attention")
		const { laneFor } = await import("./lanes")
		const { sessionsLaneReadHandler } = await import("$lib/server/sockets/sessions")
		const { owner, ann, session } = await table()
		const annLane = (await laneFor(db as any, session.id, "parley", ann.id)).channel
		await line(session.id, annLane, "planner says hi")
		await line(session.id, annLane, "ann answers", ann.id)
		await line(session.id, "main", "story line")
		const view = (await laneViewFor(db as any, session.id, ann.id))!
		const before = await sessionChannelsFor(db as any, view)
		expect(before.find((c) => c.slug === "parley")?.unseen).toBe(1)
		expect(before.find((c) => c.slug === "main")?.unseen).toBe(1)
		const res = (await sessionsLaneReadHandler.handler(fakeSocket(ann.id), { sessionId: session.id, channel: annLane } as any, noop)) as any
		expect(res.channels.find((c: any) => c.slug === "parley").unseen).toBeUndefined()
		expect(res.channels.find((c: any) => c.slug === "main").unseen).toBe(1)
		// Another person's lane is not theirs to mark.
		const ownerLane = (await laneFor(db as any, session.id, "parley", owner.id)).channel
		const refused = (await sessionsLaneReadHandler.handler(fakeSocket(ann.id), { sessionId: session.id, channel: ownerLane } as any, noop)) as any
		expect(refused.error).toBeTruthy()
	})
})

describe("the channel-lane query", () => {
	it("opens the person's lane once and answers it after", async () => {
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const { ann, session } = await table()
		const binding = (coreBindings() as any)["core:query/channel-lane@1"]
		const run = (input: Record<string, unknown>) =>
			(binding.handler ?? binding)({ scope: { sessionId: session.id }, ...input }, {} as any)
		const first = await run({ channel: "parley", person: `user:${ann.id}` })
		expect(JSON.stringify(first)).toContain('"opened":true')
		const again = await run({ channel: "parley", person: `user:${ann.id}` })
		expect(JSON.stringify(again)).toContain('"opened":false')
		const [row] = await db
			.select()
			.from(schema.channelLanes)
			.where(and(eq(schema.channelLanes.sessionId, session.id), eq(schema.channelLanes.userId, ann.id)))
		expect(JSON.stringify(again)).toContain(row.lane === 1 ? '"lane":"parley"' : `"lane":"parley:${row.lane}"`)
		const shared = await run({ channel: "phone", person: `user:${ann.id}` })
		expect(JSON.stringify(shared)).toContain("not a channel of personal lanes")
	})
})
