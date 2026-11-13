/**
 * 🚧 (M3b, owner 2026-11-05 ★M3-4 "the book seats its cast, genre-declared";
 * PLAN-sdk-creation-seams §23) A genre that declares `castFromLorebook` has the
 * attached book seat its cast at `sessions:create` — whoever owns the cards,
 * never a persona card, and for a provided book every member but a persona's
 * (★S4-1, plan §34.2). Off for every other genre, off by the genre's switch field, and the
 * binding check adds no member rows into a provided book for anyone.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { BOOK_LOCK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

// Off by default, so every other test keeps the real seat writer. On, a seat by
// card is refused (and its session id recorded).
const refuseSeats = vi.hoisted(() => ({
	on: false,
	sessionIds: [] as number[]
}))

vi.mock("$lib/server/sessions/seats", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/server/sessions/seats")>()
	return {
		...actual,
		seatCast: async (
			...args: Parameters<typeof actual.seatCast>
		): ReturnType<typeof actual.seatCast> => {
			const input = args[1] as { sessionId: number; cardId?: number }
			if (refuseSeats.on && input.cardId != null) {
				refuseSeats.sessionIds.push(input.sessionId)
				return {
					ok: false,
					refusal: "Test refusal: the seat writer said no."
				} as any
			}
			return actual.seatCast(...args)
		}
	}
})

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		...actual,
		db,
		getCryptoSecretKey: () => "cast-from-book-test-secret"
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

const DECLARED = "test:genre/cast-from-book"
const PLAIN = "test:genre/cast-from-book-plain"
const noEmit = () => {}
let n = 0

/** Publish one test genre as a create spec, the way a plugin genre arrives. */
async function publishGenre(genreId: string, declare: boolean) {
	const { genre, spec, compile, sessionEvents } = await import(
		"@serene-pub/sdk"
	)
	const C = await import("@serene-pub/contracts")
	const decl = genre(genreId, {
		name: { en: declare ? "Cast from book" : "Cast from book (plain)" },
		family: "fixture",
		shape: {
			characters: { min: 0 },
			personas: { min: 0, max: 1 },
			lorebook: "optional",
			composer: "text",
			voice: "narrator",
			greeting: { enabled: false },
			fields: {
				examples: {
					type: "boolean",
					label: { en: "Examples" },
					default: true
				}
			},
			...(declare ? { castFromLorebook: { field: "examples" } } : {})
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
		path.join(os.tmpdir(), "serene-pub-vitest-cast-from-book-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	await publishGenre(DECLARED, true)
	await publishGenre(PLAIN, false)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number, isAdmin: boolean) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function admin() {
	const a = await testDb.query.users.findFirst({
		where: (u, { eq }) => eq(u.isAdmin, true),
		orderBy: (u, { asc }) => [asc(u.id)]
	})
	return a!
}

async function member() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `cast-from-book-member-${++n}`)
}

async function card(
	userId: number,
	name: string,
	opts: { persona?: boolean; mark?: string } = {}
) {
	const uuid = crypto.randomUUID()
	const { card: row } = await insertCard(
		testDb as any,
		{
			userId,
			name: `${name} ${++n}`,
			description: "",
			uuid,
			isPersona: !!opts.persona,
			...(opts.mark
				? {
						extensions: {
							serenepub: {
								provided: {
									plugin: opts.mark,
									slug: "cast",
									version: "0.1.0",
									uuid
								}
							}
						}
					}
				: {})
		} as any
	)
	return row!
}

/** Members of a book, in binding order, each linked to its card. */
async function members(lorebookId: number, cards: { id: number }[]) {
	for (const c of cards)
		await insertCastMember(
			testDb as any,
			{
				lorebookId,
				characterId: c.id,
				binding: `{{char:${++n}}}`,
				name: `m${c.id}`
			} as any
		)
}

/** A plugin's provided book owned by the admin (genuine mark, owner row present). */
async function providedBook() {
	const k = ++n
	const pluginId = `acme.castbook${k}`
	const a = await admin()
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
	const uuid = crypto.randomUUID()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: a.id,
			name: `Provided ${k}`,
			uuid,
			extraJson: {
				provided: {
					plugin: pluginId,
					slug: "world",
					version: "0.1.0",
					sha256: "x",
					uuid,
					entries: {}
				}
			}
		} as any)
		.returning()
	// Members: two provided-marked cards, an admin persona (marked too), a plain admin card; a provided book seats all but the persona.
	const one = await card(a.id, "Provided one", { mark: pluginId })
	const two = await card(a.id, "Provided two", { mark: pluginId })
	const persona = await card(a.id, "Admin persona", {
		persona: true,
		mark: pluginId
	})
	const plain = await card(a.id, "Admin plain")
	await members(book.id, [one, persona, plain, two])
	return { book, pluginId, one, two, persona, plain, admin: a }
}

async function create(
	userId: number,
	isAdmin: boolean,
	p: {
		genreId?: string
		mode?: "new-world"
		lorebookId?: number
		genreFields?: Record<string, unknown>
		characterIds?: number[]
		personaIds?: number[]
	}
) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return (await sessionsCreateHandler.handler(
		socket(userId, isAdmin),
		{
			...(p.mode ? { mode: p.mode } : {}),
			session: {
				name: "S",
				genreId: p.genreId ?? DECLARED,
				...(p.lorebookId != null ? { lorebookId: p.lorebookId } : {}),
				...(p.genreFields ? { genreFields: p.genreFields } : {})
			},
			characterIds: p.characterIds ?? [],
			personaIds: p.personaIds ?? []
		} as any,
		noEmit
	)) as any
}

const seatedOf = async (sessionId: number) =>
	(
		await testDb
			.select({
				id: schema.sessionCharacters.characterId,
				position: schema.sessionCharacters.position
			})
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
			.orderBy(asc(schema.sessionCharacters.position))
	).map((r) => r.id)

const bindingCount = async (lorebookId: number) =>
	(
		await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	).length

describe("the book seats its cast at sessions:create", () => {
	test("the admin: every member but the persona, in book order (★S4-1)", async () => {
		const p = await providedBook()
		const res = await create(p.admin.id, true, { lorebookId: p.book.id })
		expect(res.error).toBeUndefined()
		expect(await seatedOf(res.session.id)).toEqual([
			p.one.id,
			p.plain.id,
			p.two.id
		])
		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, res.session.id))
		expect(row!.isGroup).toBe(true)
	})

	test("a member gets every member but the persona, in book order, and is not refused", async () => {
		const p = await providedBook()
		const m = await member()
		const res = await create(m.id, false, { lorebookId: p.book.id })
		expect(res.error).toBeUndefined()
		expect(await seatedOf(res.session.id)).toEqual([
			p.one.id,
			p.plain.id,
			p.two.id
		])
	})

	test("the switch off, a genre without the declaration, and no book seat none", async () => {
		const p = await providedBook()
		const off = await create(p.admin.id, true, {
			lorebookId: p.book.id,
			genreFields: { examples: false }
		})
		expect(off.error).toBeUndefined()
		expect(await seatedOf(off.session.id)).toEqual([])
		const plain = await create(p.admin.id, true, {
			genreId: PLAIN,
			lorebookId: p.book.id
		})
		expect(plain.error).toBeUndefined()
		expect(await seatedOf(plain.session.id)).toEqual([])
		const noBook = await create(p.admin.id, true, {})
		expect(noBook.error).toBeUndefined()
		expect(await seatedOf(noBook.session.id)).toEqual([])
	})

	test("a picked character that is also a member is seated once, after the picks keep their place", async () => {
		const p = await providedBook()
		const res = await create(p.admin.id, true, {
			lorebookId: p.book.id,
			characterIds: [p.two.id]
		})
		expect(res.error).toBeUndefined()
		expect(await seatedOf(res.session.id)).toEqual([
			p.two.id,
			p.one.id,
			p.plain.id
		])
	})

	test("the admin's new persona per game: no persona or new card seated later, no binding row added", async () => {
		const p = await providedBook()
		const before = await bindingCount(p.book.id)
		const personaA = await card(p.admin.id, "Game persona A", {
			persona: true
		})
		const first = await create(p.admin.id, true, {
			lorebookId: p.book.id,
			personaIds: [personaA.id]
		})
		expect(first.error).toBeUndefined()
		const personaB = await card(p.admin.id, "Game persona B", {
			persona: true
		})
		const second = await create(p.admin.id, true, {
			lorebookId: p.book.id,
			personaIds: [personaB.id]
		})
		expect(second.error).toBeUndefined()
		const seated = await seatedOf(second.session.id)
		expect(seated).toEqual([p.one.id, p.plain.id, p.two.id])
		expect(seated).not.toContain(personaA.id)
		expect(await bindingCount(p.book.id)).toBe(before)
	})

	test("the binding gate: attaching a provided book on update is refused by the book lock and adds no binding row", async () => {
		const p = await providedBook()
		const mine = await card(p.admin.id, "Admin own")
		const created = await create(p.admin.id, true, {
			genreId: PLAIN,
			characterIds: [mine.id]
		})
		expect(created.error).toBeUndefined()
		const before = await bindingCount(p.book.id)
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await expect(
			sessionsUpdateHandler.handler(
				socket(p.admin.id, true),
				{
					session: { id: created.session.id, lorebookId: p.book.id }
				} as any,
				noEmit
			)
		).rejects.toThrow(BOOK_LOCK_REFUSAL)
		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, created.session.id))
		expect(row!.lorebookId).toBeNull()
		expect(await bindingCount(p.book.id)).toBe(before)
		expect(await seatedOf(created.session.id)).toEqual([mine.id])
	})

	test("an own (non-provided) book seats its non-persona members", async () => {
		const m = await member()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: m.id, name: `Own ${++n}` } as any)
			.returning()
		const a = await card(m.id, "Own a")
		const persona = await card(m.id, "Own persona", { persona: true })
		const b = await card(m.id, "Own b")
		await members(book!.id, [a, persona, b])
		const res = await create(m.id, false, { lorebookId: book!.id })
		expect(res.error).toBeUndefined()
		expect(await seatedOf(res.session.id)).toEqual([a.id, b.id])
	})

	test("a refused new-world create takes back the world copy, the session row and any own book", async () => {
		const m = await member()
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: m.id, name: `World ${++n}` } as any)
			.returning()
		const a = await card(m.id, "World a")
		await members(book!.id, [a])
		const booksOf = () =>
			testDb
				.select()
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.userId, m.id))
		const before = (await booksOf()).length
		refuseSeats.on = true
		refuseSeats.sessionIds = []
		let res: any
		try {
			res = await create(m.id, false, {
				mode: "new-world",
				lorebookId: book!.id
			})
		} finally {
			refuseSeats.on = false
		}
		expect(res.error).toBe("Test refusal: the seat writer said no.")
		// The catch ran: the seated-cast loop reached the writer inside the seats
		// transaction, so the session row and the world copy existed.
		expect(refuseSeats.sessionIds).toHaveLength(1)
		const sessionId = refuseSeats.sessionIds[0]!
		expect(typeof sessionId).toBe("number")
		expect(
			await testDb
				.select()
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
		).toHaveLength(0)
		expect(
			await testDb
				.select()
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.sessionId, sessionId))
		).toHaveLength(0)
		const after = await booksOf()
		expect(after).toHaveLength(before)
		expect(
			after.filter((b) => b.name === `${book!.name} (copy)`)
		).toHaveLength(0)
	})
})
