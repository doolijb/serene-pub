/**
 * 🚧 A preset switch is atomic: the preset id, the genre fields and How strict
 * land together, so a failure after the genre-fields write leaves the session
 * as it was.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string
let failAfterGenreFields = false

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "preset-switch-atomic-test-secret" }
})
vi.mock("$lib/server/sessions/settingsWrite", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/sessions/settingsWrite")>()
	return {
		...actual,
		writeGenreFields: async (...args: Parameters<typeof actual.writeGenreFields>) => {
			const out = await actual.writeGenreFields(...args)
			if (failAfterGenreFields) throw new Error("boom after genre fields")
			return out
		}
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
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

let ownerId: number
const fakeSocket = (uid: number) =>
	({
		user: { id: uid, isAdmin: false },
		io: {
			sockets: {
				adapter: { rooms: { get: () => undefined } },
				sockets: { get: () => undefined, values: () => [].values() }
			},
			to: () => ({ emit: () => {} })
		}
	}) as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-preset-switch-atomic-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "preset-switch-atomic")).id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const presetOf = async (seedKey: string) =>
	(await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey)))[0]!.id

async function seed() {
	const living = await presetOf("core-story-living")
	const ruleBased = await presetOf("core-story-rule-based")
	const [made] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			name: "Atomic switch",
			genreId: "core:genre/story",
			presetId: living,
			primaryRuleset: "core:ruleset/vis-itineris@1",
			rigour: "prose",
			genreFields: { tasks: ["x"], keep: "me" }
		} as any)
		.returning()
	return { id: made!.id, living, ruleBased }
}

const rowOf = async (id: number) =>
	(
		await db
			.select({ presetId: schema.sessions.presetId, genreFields: schema.sessions.genreFields, rigour: schema.sessions.rigour })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

describe("sessions:setSessionPreset is atomic", () => {
	it("a failure after the genre-fields write rolls back the preset id, fields and rigour", async () => {
		const { sessionsSetSessionPresetHandler } = await import("./sessions")
		const { id, living, ruleBased } = await seed()
		failAfterGenreFields = true
		try {
			await expect(
				sessionsSetSessionPresetHandler.handler(fakeSocket(ownerId), { sessionId: id, presetId: ruleBased } as any, () => {})
			).rejects.toThrow("boom after genre fields")
		} finally {
			failAfterGenreFields = false
		}
		expect(await rowOf(id)).toEqual({ presetId: living, genreFields: { tasks: ["x"], keep: "me" }, rigour: "prose" })
	})

	it("without a failure the switch writes the preset id and rigour, drops tasks and keeps the other key", async () => {
		const { sessionsSetSessionPresetHandler } = await import("./sessions")
		const { id, ruleBased } = await seed()
		const res: any = await sessionsSetSessionPresetHandler.handler(fakeSocket(ownerId), { sessionId: id, presetId: ruleBased } as any, () => {})
		expect(res?.error).toBeUndefined()
		expect(await rowOf(id)).toEqual({ presetId: ruleBased, genreFields: { keep: "me" }, rigour: "scripts" })
	})
})
