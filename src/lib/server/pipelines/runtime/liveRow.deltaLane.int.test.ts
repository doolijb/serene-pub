/**
 * 🚧 A personal lane's streamed deltas reach only the lane's readers.
 *
 * `sessionMessageDelta` carries no channel, so `laneScopedRecipients` cannot
 * narrow it; what keeps a personal lane private is that the run's recipients
 * memo is filled by the FULL `sessionMessage` row (which names its channel).
 * This drives the real live row, `broadcastToSessionUsers`,
 * `laneScopedRecipients` and interest gate over a recording io.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { insertLegacy } from "$lib/server/messages/store"
import { createLiveRow } from "./liveRow"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

const SHAPE = {
	channels: ["phone", { slug: "parley", lanes: "personal" }]
}

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})
vi.mock("$lib/server/pipelines/entities/sessionGenres", async (orig) => {
	const real = (await orig()) as Record<string, unknown>
	return {
		...real,
		getSessionGenre: async (_db: unknown, genreId: string) =>
			genreId === "test:genre/lanes"
				? { genreId, name: "Lanes", shape: SHAPE }
				: null,
		sessionGenreAvailable: async () => ({ available: true })
	}
})
vi.mock("$lib/server/sessions/rowPush", () => ({
	broadcastSessionRow: () => {}
}))

let db: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-deltalane-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(name: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(
		db,
		`${name}-${Math.random().toString(36).slice(2, 7)}`
	)
}

async function table() {
	const owner = await makeUser("owner")
	const ann = await makeUser("ann")
	const bo = await makeUser("bo")
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			genreId: "test:genre/lanes"
		} as any)
		.returning()
	await db.insert(schema.sessionGuests).values([
		{ sessionId: session!.id, userId: ann.id },
		{ sessionId: session!.id, userId: bo.id }
	])
	return { owner, ann, bo, session: session! }
}

type Emit = { target: string; event: string; payload: any }

/** One socket per user, all watching the session's message events; records emits. */
function recordingIo(userIds: number[], sessionId: number) {
	const emits: Emit[] = []
	const sockets = new Map(
		userIds.map((userId) => [
			`socket-${userId}`,
			{
				id: `socket-${userId}`,
				user: { id: userId, isAdmin: false },
				interest: new Set([
					`sessionMessage#${sessionId}`,
					`sessionMessageDelta#${sessionId}`
				])
			}
		])
	)
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) => {
						const m = /^user_(\d+)$/.exec(room)
						return m && sockets.has(`socket-${m[1]}`)
							? new Set([`socket-${m[1]}`])
							: undefined
					}
				}
			},
			sockets: {
				get: (id: string) => sockets.get(id),
				values: () => sockets.values()
			}
		},
		to: (target: string) => ({
			emit: (event: string, payload: any) => {
				emits.push({ target, event, payload })
			}
		})
	} as any
	return { io, emits }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One streamed run on `channel`; answers every emit the io recorded. */
async function run(
	channel: string | undefined,
	t: Awaited<ReturnType<typeof table>>
) {
	const { io, emits } = recordingIo(
		[t.owner.id, t.ann.id, t.bo.id],
		t.session.id
	)
	const row = await insertLegacy(db, {
		sessionId: t.session.id,
		role: "assistant",
		content: "",
		isGenerating: true,
		...(channel ? { channel } : {}),
		metadata: {}
	})
	const live = createLiveRow({
		db: db as any,
		io,
		sessionId: t.session.id,
		streamingNodes: new Set(["generate"])
	})
	live.opened(row)
	const stream = live.attach(row.id, "generate", {})!
	for (let i = 0; i < 4; i++) {
		await wait(140)
		stream.onChunk(`w${i} `)
		await wait(100)
	}
	await live.flush()
	await live.finish({ kind: "ok" } as any)
	return emits
}

const toUser = (emits: Emit[], userId: number) =>
	emits.filter((e) => e.target === `socket-${userId}`)

describe("a streamed run's deltas and the personal lane", () => {
	it("on ann's lane, owner and ann receive the frames and bo receives nothing", async () => {
		const { laneFor } = await import("$lib/server/channels/lanes")
		const t = await table()
		const { channel } = await laneFor(
			db as any,
			t.session.id,
			"parley",
			t.ann.id
		)
		const emits = await run(channel, t)

		expect(emits.length).toBeGreaterThan(0)
		expect(toUser(emits, t.bo.id)).toEqual([])
		expect(
			emits.every(
				(e) =>
					e.target === `socket-${t.owner.id}` ||
					e.target === `socket-${t.ann.id}`
			)
		).toBe(true)
		expect(emits.some((e) => e.event === "sessionMessageDelta")).toBe(true)
		for (const id of [t.owner.id, t.ann.id]) {
			const mine = toUser(emits, id)
			expect(mine.length).toBeGreaterThan(0)
			expect(mine[0]!.event).toBe("sessionMessage")
			expect(mine.some((e) => e.event === "sessionMessageDelta")).toBe(
				true
			)
		}
	})

	it("control: the same run on main reaches bo, deltas included", async () => {
		const t = await table()
		const emits = await run(undefined, t)

		const bo = toUser(emits, t.bo.id)
		expect(bo.length).toBeGreaterThan(0)
		expect(bo[0]!.event).toBe("sessionMessage")
		expect(bo.some((e) => e.event === "sessionMessageDelta")).toBe(true)
	})
})
