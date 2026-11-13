/**
 * 🚧 A Story session with nobody in it refuses a line instead of answering
 * it with silence (owner ruling 2026-11-08). The genre closes the `main`
 * composer with a reason — at create (`createStorySpec`'s `seats` gate) and
 * from its turn order (`turnOrderSpec`'s `emptyCast`, on the pool's
 * candidates) — and the turn order lifts it the moment a character, persona
 * or envoy is seated. Core opens and closes nothing itself.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "story-empty-cast-test-secret" }
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
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-story-empty-cast-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "story-empty-cast-owner")).id
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

async function createStory(name: string, seats: { characterIds?: number[]; personaIds?: number[] } = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name, presetId: await presetId("core-story-living") },
			characterIds: seats.characterIds ?? [],
			personaIds: seats.personaIds ?? [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return res.session.id as number
}

async function composerStatesOf(sessionId: number) {
	const [row] = await db
		.select({ composerStates: schema.sessions.composerStates })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return row!.composerStates
}

const NOBODY = "No one is here to reply yet. Add a character or a persona to the session first."

describe("a Story session with nobody seated", () => {
	it("is born with its composer closed, and opens when a persona is seated", async () => {
		const sessionId = await createStory("empty")
		expect(await composerStatesOf(sessionId)).toEqual({
			main: { "*": { open: false, reason: NOBODY } }
		})

		const [me] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Wren", description: "Me.", isPersona: true })
			.returning()
		// Seated through the session editor's save (`sessions:update`), the
		// door that dispatches `member-added`; the turn order recomputes and
		// the gate lifts its own closure.
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const res: any = await sessionsUpdateHandler.handler(
			fakeSocket(ownerId),
			{ session: { id: sessionId }, personaIds: [me!.id] } as any,
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		await settle()
		expect(await composerStatesOf(sessionId)).toEqual({})
	}, 60_000)

	it("is born open when a character is seated", async () => {
		const [ch] = await db
			.insert(schema.characters)
			.values({ userId: ownerId, name: "Ash", description: "A traveller.", isPersona: false })
			.returning()
		const sessionId = await createStory("peopled", { characterIds: [ch!.id] })
		expect(await composerStatesOf(sessionId)).toEqual({})
	}, 60_000)
})
