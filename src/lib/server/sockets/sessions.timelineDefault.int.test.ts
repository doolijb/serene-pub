/**
 * 🚧 A new session whose lorebook is its own notes gets notes with or without
 * a timeline by its preset and genre (`timelineDefaultFor`); an attached
 * lorebook's switch is never touched; the start form's preset rows carry the
 * resolved default.
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

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "timeline-default-test-secret" }
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
	broadcastToSessionUsers: async () => {},
	emitToInterested: async () => 0
}))
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => {
		throw new Error("no model is called on create")
	}
}))

let ownerId: number
/** A character to seat where a genre needs one (the Lair's floor is one). */
let characterId: number
const quietIo = () => ({
	sockets: {
		adapter: { rooms: { get: () => undefined } },
		sockets: { get: () => undefined, values: () => [].values() }
	},
	to: () => ({ emit: () => {} })
})
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}

const OFF = ["core-story-minimal", "core-chat-basic", "core-chat-agentic", "core-guide-default"]
const ON = [
	"core-story-living",
	"core-story-rule-based",
	"core-lair-words-only",
	"core-lair-default",
	"core-lair-rules-and-dice",
	"core-dungeon-crawler-default"
]

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-timeline-default-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "timeline-default-owner")).id
	const [c] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Wren", description: "A quiet companion.", isPersona: false } as any)
		.returning()
	characterId = c!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function presetId(seedKey: string) {
	const [preset] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	return preset!.id
}

async function create(seedKey: string, lorebookId?: number) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: {
				name: seedKey,
				presetId: await presetId(seedKey),
				...(lorebookId != null ? { lorebookId } : {})
			},
			characterIds: seedKey.startsWith("core-lair-") ? [characterId] : [],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, `${seedKey}: ${res?.error}`).toBeUndefined()
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return res.session.id as number
}

const notesSwitch = async (sessionId: number) => {
	const [b] = await db
		.select({ on: schema.lorebooks.timelineEnabled })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
	return b!.on
}

describe("a new session's own notes", () => {
	it.each(OFF)("%s starts them without a timeline", async (key) => {
		expect(await notesSwitch(await create(key))).toBe(false)
	})
	it.each(ON)("%s starts them with a timeline", async (key) => {
		expect(await notesSwitch(await create(key))).toBe(true)
	})
})

describe("an attached lorebook", () => {
	it.each([true, false])("keeps its switch (%s) under Story Minimal and Living", async (on) => {
		for (const key of ["core-story-minimal", "core-story-living"]) {
			const [book] = await db
				.insert(schema.lorebooks)
				.values({ name: `Attached ${key} ${on}`, userId: ownerId, timelineEnabled: on } as any)
				.returning()
			const sessionId = await create(key, book!.id)
			const [after] = await db.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, book!.id))
			expect(after!.timelineEnabled).toBe(on)
			expect(await notesSwitch(sessionId)).toBe(on)
		}
	})
})

describe("the start form's preset rows", () => {
	it("carry the resolved default", async () => {
		const { sessionPresetsList } = await import("$lib/server/sockets/sessionAdmin")
		const res: any = await sessionPresetsList.handler(fakeSocket(ownerId), {} as any, emit as any)
		const bySeed = new Map<string, boolean | undefined>()
		for (const row of res.presets as any[]) {
			const [r] = await db
				.select({ seedKey: schema.sessionPresets.seedKey })
				.from(schema.sessionPresets)
				.where(eq(schema.sessionPresets.id, row.id))
			if (r?.seedKey) bySeed.set(r.seedKey, row.timelineDefault)
		}
		for (const key of OFF) expect(bySeed.get(key), key).toBe(false)
		for (const key of ON) expect(bySeed.get(key), key).toBe(true)
	})
})
