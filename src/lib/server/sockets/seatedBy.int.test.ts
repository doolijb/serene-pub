/**
 * 🚧 A seat is seated by whoever acted (owner 2026-11-05: "The person who
 * seated it"): the socket handlers pass the acting user to the seat writer,
 * not the held card's owner.
 *
 * Claims: `sessions:create` seats a card it did not make (the book's seated
 * cast, here another person's) by the creator; `sessions:update` adding a
 * character seats it by the updater; a SillyTavern import seats the imported
 * card by the importing user.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seated-by-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
	await publishGenre()
}, 60_000)

const DECLARED = "test:genre/seated-by-cast-from-book"

/** A create spec whose genre seats the attached book's cast. */
async function publishGenre() {
	const { genre, spec, compile, sessionEvents } = await import(
		"@serene-pub/sdk"
	)
	const C = await import("@serene-pub/contracts")
	const decl = genre(DECLARED, {
		name: { en: "Seated by" },
		family: "fixture",
		shape: {
			characters: { min: 0 },
			personas: { min: 0, max: 1 },
			lorebook: "optional",
			composer: "text",
			voice: "narrator",
			greeting: { enabled: false },
			castFromLorebook: {}
		} as any,
		events: { [sessionEvents.messageRespond]: { required: true } }
	})
	const doc = compile(
		spec("test:spec/seated-by-cast-from-book-create", {
			version: "1.0.0",
			taxonomy: { role: "create" },
			genre: {
				name: decl.name,
				family: decl.family,
				shape: decl.shape,
				events: decl.events as Record<
					string,
					{ required?: boolean; open?: boolean }
				>
			}
		})
			.inlet("input", C.sessionCreated.v1(), {
				genre: decl,
				event: sessionEvents.sessionCreated
			})
			.query("collect", ($) =>
				C.sessionGreetings.v1({ scope: $.input.sessionScope })
			)
			.outlet("seed", ($) =>
				C.seedGreetings.v1({
					greetings: $.collect.greetings,
					channel: "main"
				})
			)
			.build()
	)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	await saveDocument(testDb as any, doc, { publish: true })
}

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const noEmit = () => {}
const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `seated-by-${++n}`)
}

async function card(userId: number) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name: `Card ${++n}`,
			description: "",
			uuid: crypto.randomUUID()
		} as any)
		.returning()
	return row!
}

const seatsOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))

describe("a seat is seated by whoever acted", () => {
	it("sessions:create seats the book's cast, the admin's card, by the creator", async () => {
		const creator = await user()
		const admin = (await testDb.query.users.findFirst({
			where: (u, { eq }) => eq(u.isAdmin, true),
			orderBy: (u, { asc }) => [asc(u.id)]
		}))!
		// A plugin's provided book, owned by the admin, whose member's card is
		// the admin's own and carries the same mark.
		const pluginId = `acme.seatedby${++n}`
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: pluginId,
			version: "0.1.0",
			bundleSource: "",
			bundleHash: "x",
			enabled: true,
			manifest: {},
			adminDenied: []
		} as any)
		const bookUuid = crypto.randomUUID()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: admin.id,
				name: `Provided ${n}`,
				uuid: bookUuid,
				extraJson: {
					provided: {
						plugin: pluginId,
						slug: "world",
						version: "0.1.0",
						sha256: "x",
						uuid: bookUuid,
						entries: {}
					}
				}
			} as any)
			.returning()
		const cardUuid = crypto.randomUUID()
		const [theirs] = await testDb
			.insert(schema.characters)
			.values({
				userId: admin.id,
				name: `Provided card ${++n}`,
				description: "",
				uuid: cardUuid,
				extensions: {
					serenepub: {
						provided: {
							plugin: pluginId,
							slug: "cast",
							version: "0.1.0",
							uuid: cardUuid
						}
					}
				}
			} as any)
			.returning()
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId: book!.id,
			characterId: theirs!.id,
			binding: `{{char:${++n}}}`,
			name: "Theirs"
		} as any)
		const { sessionsCreateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res = (await sessionsCreateHandler.handler(
			socket(creator.id),
			{
				session: { name: "S", genreId: DECLARED, lorebookId: book!.id },
				characterIds: [],
				personaIds: []
			} as any,
			noEmit
		)) as any
		expect(res.error).toBeUndefined()
		const seats = await seatsOf(res.session.id)
		expect(seats.map((r) => r.characterId)).toEqual([theirs!.id])
		expect(seats[0]!.seatedByUserId).toBe(creator.id)
		expect(creator.id).not.toBe(admin.id)
	})

	it("sessions:update seats an added character by the updater", async () => {
		const updater = await user()
		const theirs = await card(updater.id)
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: updater.id,
				isGroup: false,
				name: `Run ${++n}`,
				genreId: "core:genre/story"
			})
			.returning()
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsUpdateHandler.handler(
			socket(updater.id),
			{ session: { id: s!.id }, characterIds: [theirs.id] } as any,
			noEmit
		)
		const seats = await seatsOf(s!.id)
		expect(seats).toHaveLength(1)
		expect(seats[0]!.seatedByUserId).toBe(updater.id)
	})
})
