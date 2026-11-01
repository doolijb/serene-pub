/**
 * audio.cpp, run by Serene Pub — the socket path that first creates the
 * managed row: `audiocpp:setPackageEnabled` for a package on disk leaves the
 * managed connection row + its model row in the DB and re-emits
 * `connections:list` to the user. Nothing is spawned (the binary is never
 * even installed here). Real test DB, real handler, fake admin socket.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "test-crypto-secret-key" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => [],
	isLocalEmbeddingSupported: async () => false
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	stopVectorization: () => {},
	startVectorizationQueue: async () => {},
	clearVectorizationFailureTracking: () => {},
	clearInlineEmbedCooldown: () => {}
}))
vi.mock("$lib/server/connectionAdapters/audioCppReady", async (orig) => ({
	...(await orig<typeof import("$lib/server/connectionAdapters/audioCppReady")>()),
	ensureAudioCppReadyUrl: async () => {
		throw new Error("setPackageEnabled must never start audio.cpp")
	}
}))
const KOKORO = {
	id: "kokoro_82m_q8_0",
	displayName: "Kokoro 82M (q8)",
	family: "kokoro_tts",
	task: "tts",
	revision: "main",
	name: "audio-cpp/audio.cpp-gguf",
	tags: [],
	recommendedVram: 0,
	details: { description: "" },
	files: ["Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf"],
	targetDirectory: "Kokoro-82M-GGUF",
	stripPrefix: "Kokoro-82M-GGUF",
	sizeBytes: 1000
}
vi.mock("$lib/server/audio/audioList", async (orig) => ({
	...(await orig<typeof import("$lib/server/audio/audioList")>()),
	getAudioLists: async () => ({ entries: [KOKORO], families: [] })
}))
vi.mock("$lib/server/audio/familyOf", () => ({ familyOf: () => null }))

let db: TestDb
let tmp: string

beforeAll(async () => {
	tmp = mkdtempSync(join(tmpdir(), "acpp-sock-resync-"))
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	const { ensureAudioCppSettings } = await import("$lib/server/audiocpp/settings")
	const s = await ensureAudioCppSettings(db as never)
	await db.update(schema.audiocppSettings).set({ modelsDir: tmp, port: 5063 }).where(eq(schema.audiocppSettings.id, s.id))
	const p = join(tmp, "tts/kokoro_tts/Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf")
	mkdirSync(dirname(p), { recursive: true })
	writeFileSync(p, "x")
}, 120_000)

afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client.close().catch(() => {})
	rmSync(tmp, { recursive: true, force: true })
})

describe("audiocpp:setPackageEnabled creates the managed row", () => {
	it("enabling an on-disk package creates the managed row + model row, re-emits connections:list, and spawns nothing", async () => {
		const [admin] = await db.insert(schema.users).values({ username: "acpp-admin", isAdmin: true }).returning()
		const { audioCppSetPackageEnabled } = await import("./audiocpp")
		const { getStatus } = await import("$lib/server/audiocpp/process")

		const emits: { event: string; data: any }[] = []
		const emitToUser = async (event: string, data: any) => {
			emits.push({ event, data: typeof data === "function" ? await data() : data })
		}
		expect(
			await db.select().from(schema.connections).where(eq(schema.connections.type, CONNECTION_TYPE.AUDIOCPP_MANAGED))
		).toHaveLength(0)

		const res = await audioCppSetPackageEnabled.handler(
			{ user: { id: admin.id, isAdmin: true } } as any,
			{ id: KOKORO.id, enabled: true } as any,
			emitToUser as any
		)
		expect((res as any).package.state).toBe("enabled")

		const rows = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.type, CONNECTION_TYPE.AUDIOCPP_MANAGED))
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe("audio.cpp")
		const models = await db
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.connectionId, rows[0].id))
		expect(models.map((m) => m.model)).toEqual([KOKORO.id])

		// The handler emits the list (a thunk resolved here) and its own result.
		const list = emits.find((e) => e.event === "connections:list")
		expect(list).toBeTruthy()
		const listed = (list!.data as any).connections ?? list!.data
		const names = JSON.stringify(listed)
		expect(names).toContain("audio.cpp")
		expect(emits.some((e) => e.event === "audiocpp:setPackageEnabled")).toBe(true)

		// Nothing was started.
		expect(getStatus().status).toBe("stopped")
	})
})
