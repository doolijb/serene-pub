/**
 * 🚧 The host half of `core:outlet/note-scene@1` (★S4): one commit lands on
 * the lane's open scene and answers its id; a refusal is a `HostScopeError`
 * that starts with the node key.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
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
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let db: TestDb
let dataDir: string
let n = 0
const NOTE = { key: "note", definitionId: "core:outlet/note-scene" } as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-host-note-scene-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `note-scene-${suffix}`)
	const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `Book ${suffix}` }).returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	const { insertLegacy } = await import("$lib/server/messages/store")
	const line = await insertLegacy(db as any, { sessionId: session!.id, role: "user", content: "A line." } as any)
	const host = async () => {
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		return createHost(db as unknown as Db, { sessionId: session!.id, userId: user.id, runId: `run-${suffix}` })
	}
	return { user, session: session!, line, host }
}

describe("note-scene commit", () => {
	it("lands on the open scene and answers its id", async () => {
		const w = await world()
		const { openScene } = await import("$lib/server/scenes/liveScenes")
		const { scene } = await openScene(db as unknown as Db, {
			sessionId: w.session.id,
			userId: w.user.id,
			atMessageId: w.line.id
		})
		const res: any = await (await w.host()).commit!({ text: "The bridge fell." }, NOTE)
		expect(res).toMatchObject({ written: true, sessionId: w.session.id, sceneId: scene.id })
		const [row] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id))
		expect(row!.notes).toHaveLength(1)
		expect(row!.notes![0]).toMatchObject({ text: "The bridge fell.", runId: `run-${n}` })
	})

	it("refuses with the node key and the sentence when no scene is open", async () => {
		const w = await world()
		const { HostScopeError } = await import("$lib/server/pipelines/runtime/host")
		const p = (await w.host()).commit!({ text: "Nobody hears it." }, NOTE)
		await expect(p).rejects.toBeInstanceOf(HostScopeError)
		await expect(p).rejects.toThrow(/^note: no scene is open to note/)
	})
})
