/**
 * 🚧 A channel's `audience: { participants }` (M0, SHAPES L6; lane S4) —
 * the one in-session predicate (`audienceHiddenSlugsFor`) behind the readers,
 * the pushes, the send door, `sessions:view`, `sessions:channelLanes` and
 * `session-history@1`, over PGlite.
 *
 * The genre is a stand-in (sessionGenres mocked) whose shape is rebuilt per
 * table with the user ids it names: `phone` is for guest A and character C
 * (played by guest P); `sanctum` is the owner's alone, as ever.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let SHAPE: unknown = { channels: [] }

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
			genreId === "test:genre/audience" ? { genreId, name: "Audience", shape: SHAPE } : null,
		sessionGenreAvailable: async () => ({ available: true })
	}
})

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-audience-int-test-"))
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

/** An owner, guests A, B and P (who plays character C), and one session whose `phone` is for A and C. */
async function table() {
	const owner = await makeUser("owner")
	const a = await makeUser("a")
	const b = await makeUser("b")
	const p = await makeUser("p")
	const [character] = await db
		.insert(schema.characters)
		.values({ userId: p.id, name: "Cee", description: "A caller." } as any)
		.returning()
	SHAPE = {
		channels: [
			{
				slug: "phone",
				audience: { participants: [`user:${a.id}`, `character:${character!.id}`] }
			},
			{ slug: "sanctum", audience: "owner" }
		]
	}
	const { forgetLaneShapes } = await import("./lanes")
	forgetLaneShapes()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, genreId: "test:genre/audience" } as any)
		.returning()
	await db.insert(schema.sessionGuests).values([
		{ sessionId: session!.id, userId: a.id },
		{ sessionId: session!.id, userId: b.id },
		{ sessionId: session!.id, userId: p.id }
	])
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: session!.id, personaId: character!.id, userId: p.id } as any)
	return { owner, a, b, p, character: character!, session: session! }
}

async function line(sessionId: number, channel: string, content: string) {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", channel, content })
		.returning()
	return row!
}

const fakeSocket = (userId: number) => ({ user: { id: userId }, io: { to: () => ({ emit: () => {} }) } }) as any
const noop = () => {}
const contents = (rows: any[]) => rows.map((r) => r.content).sort()

describe("a participants channel", () => {
	it("is read by the owner, the named guest and the player of the named character — not by another guest", async () => {
		const { sessionsGetHandler, sessionsMessagesPageHandler } = await import("$lib/server/sockets/sessions")
		const { laneViewFor, laneViewAllows } = await import("./lanes")
		const { owner, a, b, p, session } = await table()
		await line(session.id, "main", "everyone")
		await line(session.id, "phone", "ring ring")

		for (const reader of [owner, a, p]) {
			const view = (await laneViewFor(db as any, session.id, reader.id))!
			expect(laneViewAllows(view, "phone")).toBe(true)
			const got: any = await sessionsGetHandler.handler(fakeSocket(reader.id), { id: session.id, limit: 50 } as any, noop)
			expect(contents(got.messages)).toEqual(["everyone", "ring ring"])
			const page: any = await sessionsMessagesPageHandler.handler(
				fakeSocket(reader.id),
				{ sessionId: session.id, channel: "phone" } as any,
				noop
			)
			expect(contents(page.rows)).toEqual(["ring ring"])
		}
		const viewB = (await laneViewFor(db as any, session.id, b.id))!
		expect(laneViewAllows(viewB, "phone")).toBe(false)
		const gotB: any = await sessionsGetHandler.handler(fakeSocket(b.id), { id: session.id, limit: 50 } as any, noop)
		expect(contents(gotB.messages)).toEqual(["everyone"])
		const pageB: any = await sessionsMessagesPageHandler.handler(
			fakeSocket(b.id),
			{ sessionId: session.id, channel: "phone" } as any,
			noop
		)
		expect(contents(pageB.rows ?? [])).toEqual([])
	})

	it("laneReadersOf: the owner, A and the player of C", async () => {
		const { laneReadersOf } = await import("./lanes")
		const { owner, a, p, session } = await table()
		const readers = await laneReadersOf(db as any, session.id, "phone")
		expect([...(readers ?? [])].sort()).toEqual([owner.id, a.id, p.id].sort())
		expect([...((await laneReadersOf(db as any, session.id, "sanctum")) ?? [])]).toEqual([owner.id])
		expect(await laneReadersOf(db as any, session.id, "main")).toBeNull()
	})

	it("the send door refuses B with the participants sentence and lets A through its gate", async () => {
		const { offerMessage } = await import("$lib/server/sessions/offerMessage")
		const { laneViewFor, laneViewAllows } = await import("./lanes")
		const { a, b, session } = await table()
		const refused: any = await offerMessage(db as any, {
			sessionId: session.id,
			userId: b.id,
			speaker: null,
			channel: "phone",
			text: "hello?",
			trayItemIds: []
		})
		expect(refused.refused).toContain("That channel is only for the people in it.")
		// A is not stopped by the audience gate (the gate is laneViewAllows).
		expect(laneViewAllows((await laneViewFor(db as any, session.id, a.id))!, "phone")).toBe(true)
	})

	it("sessions:view omits phone for B, lists it for A", async () => {
		const { sessionsViewHandler } = await import("$lib/server/sockets/sessions")
		const { a, b, session } = await table()
		const viewFor = async (uid: number) =>
			(await sessionsViewHandler.handler(fakeSocket(uid), { sessionId: session.id } as any, noop)) as any
		expect((await viewFor(a.id)).channels).toContain("phone")
		expect((await viewFor(b.id)).channels).not.toContain("phone")
	})

	it("the channel-lanes answer omits phone for B", async () => {
		const { sessionsChannelLanesHandler } = await import("$lib/server/sockets/sessions")
		const { a, b, session } = await table()
		await line(session.id, "phone:2", "second line")
		const lanesFor = async (uid: number) =>
			(await sessionsChannelLanesHandler.handler(
				fakeSocket(uid),
				{ sessionId: session.id, channel: "phone" } as any,
				noop
			)) as any
		expect((await lanesFor(a.id)).lanes.length).toBeGreaterThan(0)
		expect((await lanesFor(b.id)).lanes ?? []).toEqual([])
	})

	it("session-history: an all-channels read leaves phone out; naming phone reads it", async () => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const { ALL_CHANNELS } = await import("$lib/server/messages/channels")
		const { session } = await table()
		await line(session.id, "main", "everyone")
		await line(session.id, "phone", "ring ring")
		const node = { key: "history", definitionId: "core:query/session-history@1" } as any
		const read = async (channel: string) =>
			(await createHost(db as any, { sessionId: session.id }).read!(
				"session_messages",
				{ sessionId: session.id, channel },
				node
			)) as any[]
		expect(contents(await read(ALL_CHANNELS))).toEqual(["everyone"])
		expect(contents(await read("phone"))).toEqual(["ring ring"])
	})

	it("an owner-only channel (the Sanctum) is unchanged: the owner alone, the owner's-alone sentence", async () => {
		const { laneReadersOf, hiddenChannelRefusal } = await import("./lanes")
		const { offerMessage } = await import("$lib/server/sessions/offerMessage")
		const { owner, a, session } = await table()
		expect([...((await laneReadersOf(db as any, session.id, "sanctum")) ?? [])]).toEqual([owner.id])
		const refused: any = await offerMessage(db as any, {
			sessionId: session.id,
			userId: a.id,
			speaker: null,
			channel: "sanctum",
			text: "psst",
			trayItemIds: []
		})
		expect(refused.refused).toContain("That channel is the session owner's alone.")
		expect(hiddenChannelRefusal(SHAPE, "sanctum")).toBe("That channel is the session owner's alone.")
		expect(hiddenChannelRefusal(SHAPE, "phone")).toBe("That channel is only for the people in it.")
	})
})
