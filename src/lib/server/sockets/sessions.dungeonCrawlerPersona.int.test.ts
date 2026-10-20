/**
 * 🚧 Dungeon Crawler never starts with the person's default persona
 * (owner, 2026-10-15): a persona there is only a seed for the character the
 * Planner builds, and the player is the **player seat**.
 *
 * The mechanism is the genre's declaration, `shape.personas.preselectDefault:
 * false`, read by the new-session form (`preselectsDefaultPersona`); the
 * server never attaches a persona the create did not name. Pinned here over
 * the REAL genre listing and create:
 *
 *  1. The listing carries the declaration: Dungeon Crawler does not
 *     preselect, Chat does.
 *  2. A Dungeon Crawler create by a person with a default persona, sending
 *     what the form sends (no persona), seats nobody; a seat name then opens
 *     a card-less player seat.
 *  3. A Chat create still carries the default the form preselected.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "dc-persona-test-secret" }
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
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => {
		throw new Error("no model is called on create")
	}
}))

let ownerId: number
let defaultPersonaId: number
const quietIo = () => ({
	sockets: {
		adapter: { rooms: { get: () => undefined } },
		sockets: { get: () => undefined, values: () => [].values() }
	},
	to: () => ({ emit: () => {} })
})
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-dc-persona-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "dc-persona-owner")).id
	const [persona] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Me", description: "", isPersona: true, isDefaultPersona: true } as any)
		.returning()
	defaultPersonaId = persona!.id
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

async function create(seedKey: string, personaIds: number[]) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{
			session: { name: seedKey, presetId: await presetId(seedKey) },
			characterIds: [],
			personaIds,
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return res.session.id as number
}

const seatsOf = (sessionId: number) =>
	db.select().from(schema.sessionPersonas).where(eq(schema.sessionPersonas.sessionId, sessionId))

describe("Dungeon Crawler's persona is opt-in", () => {
	it("the genre listing says Dungeon Crawler does not preselect the default persona, nor does Story", async () => {
		const { sessionsModesHandler } = await import("$lib/server/sockets/sessions")
		const { preselectsDefaultPersona } = await import(
			"$lib/client/components/sessionForms/createSession.svelte"
		)
		const { DUNGEON_CRAWLER_GENRE_ID } = await import("@serene-pub/core-catalog")
		let listing: any = null
		await sessionsModesHandler.handler(fakeSocket(ownerId), {} as any, ((_e: string, res: any) => {
			listing = res
		}) as any)
		const bare = (id: string) => id.replace(/@\d+$/, "")
		const shapeOf = (id: string) =>
			listing.genres.find((g: any) => bare(g.genreId) === bare(id))?.shape
		const dc = shapeOf(DUNGEON_CRAWLER_GENRE_ID)
		expect(dc?.personas?.preselectDefault).toBe(false)
		expect(preselectsDefaultPersona(dc)).toBe(false)
		// Ruled 2026-10-19: nothing chooses a default persona on create; a
		// genre has to say `preselectDefault: true` outright, and Story does not.
		expect(preselectsDefaultPersona(shapeOf("core:genre/story"))).toBe(false)
	})

	it("a create with no persona seats nobody, and a seat name opens a card-less player seat", async () => {
		const sessionId = await create("core-dungeon-crawler-default", [])
		expect(await seatsOf(sessionId)).toEqual([])

		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const res: any = await sessionsUpdateHandler.handler(
			fakeSocket(ownerId),
			{ session: { id: sessionId }, seatName: "Ann the Bold" } as any,
			emit
		)
		expect(res?.error, res?.error).toBeUndefined()
		const [seat] = await db
			.select()
			.from(schema.sessionPersonas)
			.where(and(eq(schema.sessionPersonas.sessionId, sessionId), eq(schema.sessionPersonas.userId, ownerId)))
		expect(seat?.personaId).toBeNull()
		expect(seat?.seatName).toBe("Ann the Bold")
	})

	it("Chat still seats the default persona the form preselects", async () => {
		const sessionId = await create("core-story-minimal", [defaultPersonaId])
		const seats = await seatsOf(sessionId)
		expect(seats.map((s) => s.personaId)).toEqual([defaultPersonaId])
	})
})
