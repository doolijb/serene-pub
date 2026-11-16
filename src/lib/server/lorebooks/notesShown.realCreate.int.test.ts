/**
 * 🚧 The "written notes" rule (`notesShown.ts`) against the real create and
 * seat paths: a session made through `sessions:create` (and seated through
 * `sessions:update`) must read **unwritten** — its notes hold only the cast
 * members a seat points at — until something is really written into them.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertWorldLoreEntryRow } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "notes-real-create-test-secret"
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

const PLAIN = "test:genre/notes-real-create-plain"
let n = 0

/** Publish one test genre as a create spec, the way a plugin genre arrives. */
async function publishGenre(genreId: string) {
	const { genre, spec, compile, sessionEvents } = await import(
		"@serene-pub/sdk"
	)
	const C = await import("@serene-pub/contracts")
	const decl = genre(genreId, {
		name: { en: "Notes real create (plain)" },
		family: "fixture",
		shape: {
			characters: { min: 0 },
			personas: { min: 0, max: 1 },
			lorebook: "optional",
			composer: "text",
			voice: "narrator",
			greeting: { enabled: false }
		} as any,
		events: { [sessionEvents.messageRespond]: { required: true } }
	})
	const doc = compile(
		spec(`${genreId.replace("genre/", "spec/")}-create`, {
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-notes-real-create-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	await publishGenre(PLAIN)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const recorder = () => ({ emit: (_event: string, _data: unknown) => {} })

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `notes-real-${label}-${++n}`)
}

async function card(userId: number, name: string, persona = false) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name: `${name} ${++n}`,
			description: "",
			uuid: crypto.randomUUID(),
			isPersona: persona
		} as any)
		.returning()
	return row!
}

async function make(
	userId: number,
	p: {
		lorebookId?: number
		characterIds?: number[]
		personaIds?: number[]
	}
) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res = (await sessionsCreateHandler.handler(
		socket(userId),
		{
			session: {
				name: "S",
				genreId: PLAIN,
				...(p.lorebookId != null ? { lorebookId: p.lorebookId } : {})
			},
			characterIds: p.characterIds ?? [],
			personaIds: p.personaIds ?? []
		} as any,
		recorder().emit
	)) as any
	expect(res.error).toBeUndefined()
	return res.session.id as number
}

async function notesOf(sessionId: number) {
	const books = await testDb
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
	expect(books).toHaveLength(1)
	return books[0]!
}

const membersOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))

async function written(lorebookId: number) {
	const { writtenNotesOf } = await import("$lib/server/lorebooks/notesShown")
	return (await writtenNotesOf(testDb as any, [lorebookId])).has(lorebookId)
}

describe("the written-notes rule on a really created session", () => {
	test("1. notes-only session with two characters and a persona: members in notes, unwritten", async () => {
		const u = await user("one")
		const a = await card(u.id, "A")
		const b = await card(u.id, "B")
		const p = await card(u.id, "P", true)
		const sessionId = await make(u.id, {
			characterIds: [a.id, b.id],
			personaIds: [p.id]
		})
		const notes = await notesOf(sessionId)
		expect(await membersOf(notes.id)).toHaveLength(3)
		expect(await written(notes.id)).toBe(false)
	})

	test("2. session reading a marked (provided) book: members in notes, unwritten", async () => {
		// The book is not shareable into a session (only an owned book can be read), so the
		// marked case stands for "an attached book that cannot take members".
		const u = await user("reader")
		const uuid = crypto.randomUUID()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({
				userId: u.id,
				name: `Provided ${++n}`,
				uuid,
				extraJson: {
					provided: {
						plugin: "acme.notesreal",
						slug: "world",
						version: "0.1.0",
						sha256: "x",
						uuid,
						entries: {}
					}
				}
			} as any)
			.returning()
		const c = await card(u.id, "Reader's")
		const sessionId = await make(u.id, {
			lorebookId: book!.id,
			characterIds: [c.id]
		})
		const notes = await notesOf(sessionId)
		expect(notes.id).not.toBe(book!.id)
		expect(await membersOf(notes.id)).toHaveLength(1)
		expect(await written(notes.id)).toBe(false)
	})

	test("3. a character added through sessions:update stays unwritten", async () => {
		const u = await user("three")
		const a = await card(u.id, "A")
		const sessionId = await make(u.id, { characterIds: [a.id] })
		const notes = await notesOf(sessionId)
		const b = await card(u.id, "B")
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsUpdateHandler.handler(
			socket(u.id),
			{ session: { id: sessionId }, characterIds: [a.id, b.id] } as any,
			recorder().emit
		)
		expect(await membersOf(notes.id)).toHaveLength(2)
		expect(await written(notes.id)).toBe(false)
	})

	test("4. one real entry in the notes reads written", async () => {
		const u = await user("four")
		const a = await card(u.id, "A")
		const sessionId = await make(u.id, { characterIds: [a.id] })
		const notes = await notesOf(sessionId)
		expect(await written(notes.id)).toBe(false)
		await insertWorldLoreEntryRow(testDb, notes.id)
		expect(await written(notes.id)).toBe(true)
	})

	test("5. a seated member's base version edited in place reads written", async () => {
		const u = await user("five")
		const a = await card(u.id, "A")
		const sessionId = await make(u.id, { characterIds: [a.id] })
		const notes = await notesOf(sessionId)
		expect(await written(notes.id)).toBe(false)
		const { and, eq, isNotNull } = await import("drizzle-orm")
		const V = schema.characterVersions
		const [version] = await testDb
			.select({ id: V.id })
			.from(V)
			.where(and(eq(V.lorebookId, notes.id), isNotNull(V.castMemberId)))
			.limit(1)
		await new Promise((r) => setTimeout(r, 5))
		await testDb.update(V).set({ description: "Edited by hand." }).where(eq(V.id, version!.id))
		expect(await written(notes.id)).toBe(true)
	})
})
