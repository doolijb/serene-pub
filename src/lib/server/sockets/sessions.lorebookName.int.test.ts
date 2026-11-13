/**
 * 🚧 `sessions:get` carries `lorebookName` (★bk-lock-2): the attached book's
 * name for every reader, even one who cannot list that book, else the own
 * notes' label.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { SESSION_NOTES_LABEL } from "$lib/shared/lorebooks/sessionNotes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "lorebook-name-test-secret"
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {},
	autoEnqueueCharacter: async () => {}
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lorebookname-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `lorebook-name-${++n}`)
}

async function get(userId: number, id: number) {
	const { sessionsGetHandler } = await import("$lib/server/sockets/sessions")
	return (await sessionsGetHandler.handler(
		socket(userId),
		{ id } as any,
		() => {}
	)) as any
}

describe("sessions:get lorebookName", () => {
	test("the attached book's name for the owner and for a guest who cannot list it; the own notes' label otherwise", async () => {
		const u = await user()
		const g = await user()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: "Private Atlas" } as any)
			.returning()
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const make = async (lorebookId?: number) => {
			const res = (await sessionsCreateHandler.handler(
				socket(u.id),
				{
					characterIds: [],
					personaIds: [],
					characterPositions: {},
					session: {
						name: "S",
						...(lorebookId ? { lorebookId } : {})
					}
				} as any,
				() => {}
			)) as any
			const id = res.session.id as number
			await testDb
				.insert(schema.sessionGuests)
				.values({ sessionId: id, userId: g.id } as any)
			return id
		}
		const attached = await make(book!.id)
		expect((await get(u.id, attached)).session.lorebookName).toBe(
			"Private Atlas"
		)
		expect((await get(g.id, attached)).session.lorebookName).toBe(
			"Private Atlas"
		)
		const own = await make()
		expect((await get(u.id, own)).session.lorebookName).toBe(
			SESSION_NOTES_LABEL
		)
		expect((await get(g.id, own)).session.lorebookName).toBe(
			SESSION_NOTES_LABEL
		)
	})
})
