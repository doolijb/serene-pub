/**
 * The run's settings read uses the run's host (perf-2 w2): one host serves
 * the settings document and the run's cast reads, the document is the same
 * whichever host reads it, and nothing is cached across hosts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import "@serene-pub/core-catalog"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))
// A genre that shapes channels with a declared `voice` and lets the seats be benched.
vi.mock(
	"$lib/server/pipelines/entities/sessionGenres",
	async (importOriginal) => {
		const real =
			await importOriginal<
				typeof import("$lib/server/pipelines/entities/sessionGenres")
			>()
		return {
			...real,
			getSessionGenre: async (db: any, id: string) =>
				id === "test:genre/voiced"
					? {
							genreId: id,
							name: "Voiced",
							shape: {
								voice: "character",
								writes: { seats: true },
								channels: [
									{ slug: "main" },
									{ slug: "journal", role: "folio", voice: "narrator" }
								]
							}
						}
					: real.getSessionGenre(db, id)
		}
	}
)

const BENCH = {
	key: "bench",
	definitionId: "core:outlet/set-seat-bench",
	definitionVersion: 1
} as never
const castNode = {
	key: "read",
	definitionId: "core:query/session-cast@1"
} as never
const stubIo = { to: () => ({ emit() {} }), emit() {} } as never

let userId: number
let characterId: number
let sessionId: number
let seatId: number
let n = 0

const makeHost = async () => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(
		db as never,
		{
			sessionId,
			userId,
			channel: "journal",
			runId: `run-host-${++n}`,
			io: stubIo
		} as never
	)
}
const settings = async (host?: Awaited<ReturnType<typeof makeHost>>) => {
	const { resolveSessionSettings } = await import(
		"$lib/server/sessions/settings"
	)
	return resolveSessionSettings(db as never, sessionId, host ? { host } : {})
}
const readOn = async (host: Awaited<ReturnType<typeof makeHost>>) =>
	(await host.read!("session_cast", { sessionId }, castNode)) as any
const seatRow = (cast: any) =>
	(cast.sessionCharacters as any[]).find((r) => r.seatId === seatId)

const client = () =>
	(
		db as unknown as {
			$client: { query: (...a: unknown[]) => unknown }
		}
	).$client
async function counting<T>(fn: () => Promise<T>) {
	const c = client()
	const original = c.query
	let statements = 0
	c.query = (...args: unknown[]) => {
		statements++
		return original.apply(c, args)
	}
	try {
		return { value: await fn(), statements }
	} finally {
		c.query = original
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-settings-run-host-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "run-host-owner")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character!.id
	const [persona] = await db
		.insert(schema.characters)
		.values({
			userId,
			name: "Bram",
			description: "",
			isPersona: true,
			aliases: []
		} as never)
		.returning()
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Book" } as never)
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: "run-host",
			genreId: "test:genre/voiced",
			lorebookId: book!.id
		} as never)
		.returning()
	sessionId = session!.id
	const [seat] = await db
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, isActive: true })
		.returning()
	seatId = seat!.id
	await db
		.insert(schema.sessionPersonas)
		.values({
			sessionId,
			personaId: persona!.id,
			userId,
			isActive: true
		} as never)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the settings read on a run's host", () => {
	it("the run's host really adds both scope-only keys to the raw cast read", async () => {
		const raw = await readOn(await makeHost())
		expect(raw.viewerUserId).toBe(userId)
		expect(raw.turnChannelVoice).toBe("narrator")
	})

	it("is the same document as the own-host read", async () => {
		const own = await settings()
		const onRun = await settings(await makeHost())
		expect(own).not.toBeNull()
		expect(onRun).toStrictEqual(own)
		expect(JSON.stringify(onRun)).toBe(JSON.stringify(own))
		expect(JSON.stringify(onRun)).not.toContain("viewerUserId")
		expect(JSON.stringify(onRun)).not.toContain("turnChannelVoice")
	})

	it("one host serves both: the cast read after it issues no statements", async () => {
		const host = await makeHost()
		await settings(host)
		const after = await counting(() => readOn(host))
		expect(after.statements).toBe(0)
		expect(seatRow(after.value).enabled).toBe(true)
	})

	it("a same-run write is still seen, by the host and by a second settings read", async () => {
		const host = await makeHost()
		await settings(host)
		try {
			const out = (await host.commit!(
				{ seat: `character:${characterId}`, benched: true },
				BENCH
			)) as Record<string, unknown>
			expect(out).toMatchObject({ written: true })
			expect(seatRow(await readOn(host)).enabled).toBe(false)
			const again = await settings(host)
			expect(seatRow(again!.cast).enabled).toBe(false)
		} finally {
			await db
				.update(schema.sessionCharacters)
				.set({ isActive: true })
				.where(eq(schema.sessionCharacters.id, seatId))
		}
	})

	it("nothing is cached across runs: a change between two hosts is seen", async () => {
		const first = await makeHost()
		expect(seatRow((await settings(first))!.cast).enabled).toBe(true)
		await db
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(eq(schema.sessionCharacters.id, seatId))
		try {
			expect(seatRow((await settings(await makeHost()))!.cast).enabled).toBe(
				false
			)
		} finally {
			await db
				.update(schema.sessionCharacters)
				.set({ isActive: true })
				.where(eq(schema.sessionCharacters.id, seatId))
		}
	})
})
