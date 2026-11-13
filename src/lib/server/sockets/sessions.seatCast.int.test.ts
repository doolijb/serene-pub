/**
 * 🚧 Every seat a session's socket handlers write goes through the one seat
 * writer (`sessions/seats.ts`, plan §27 v2 S1): the card AND the cast member
 * it is, together.
 *
 * Claims: `sessions:create` (a persona, picked characters and a book, members
 * found in the book or made in it; a session whose lorebook is its own book,
 * the own book takes the member), `sessions:update` (a character added, a removed one
 * revived, a persona added and revived), `sessions:addPersona`, and
 * `sessions:reassignRemovedParticipant` (a character and a persona) each write
 * the member beside the card. A seat whose card no book of the session knows
 * (and the attached book may not take) gets a member made in the session's own
 * book (owner ★B-5, 2026-11-08). One cast member is one character seat (owner
 * 2026-11-05): two cards of one member are refused in words at create and at
 * update, nothing written. The book's seated cast never seats a second card of
 * a member the request already seats. The session cast check
 * (`runLorebookBindingCheck`) settles seats on attach, mints nothing into a
 * provided book, and relists the book's cast when it made members.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { BOOK_LOCK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

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
		getCryptoSecretKey: () => "seat-cast-test-secret"
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
		path.join(os.tmpdir(), "serene-pub-vitest-seat-cast-")
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
	const [row] = await testDb
		.insert(schema.characters)
		.values({
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
		} as any)
		.returning()
	return row!
}

/** Members of a book, in binding order, each linked to its card. */
async function members(lorebookId: number, cards: { id: number }[]) {
	for (const c of cards)
		await testDb.insert(schema.lorebookBindings).values({
			lorebookId,
			characterId: c.id,
			binding: `{{char:${++n}}}`,
			name: `m${c.id}`
		} as any)
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
	// Members: two provided-marked cards, an admin persona (marked too), an unmarked admin card.
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

// ── helpers of this file ────────────────────────────────────────────────────

type Emitted = { event: string; data: any }
const recorder = () => {
	const emitted: Emitted[] = []
	const emit = (event: string, data: any) => {
		emitted.push({
			event,
			data: typeof data === "function" ? undefined : data
		})
	}
	return { emitted, emit }
}

async function owner() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `seat-cast-owner-${++n}`)
}

async function ownBook(owner: { id: number }, name = "Book") {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `${name} ${++n}` } as any)
		.returning()
	return book!
}

/** One member of a book, linked to a card. */
async function linkMember(lorebookId: number, cardId: number, name: string) {
	const { member } = await insertCastMember(testDb as any, {
		lorebookId,
		characterId: cardId,
		binding: `{{char:${++n}}}`,
		name
	} as any)
	return member
}

/** A member whose linked card is `linked` and who a dated change draws with `dated`. */
async function datedMember(userId: number, memberName = "Captain Maren") {
	const linked = await card(userId, "Maren")
	const dated = await card(userId, "Maren, younger")
	const book = await ownBook({ id: userId })
	const m = await linkMember(book.id, linked.id, memberName)
	// Drawn with the dated card, under the member's own name (not the card's).
	const version = await insertDatedCardVersion(testDb, m.id, dated.id, 1)
	await testDb
		.update(schema.characterVersions)
		.set({
			name: memberName,
			follows: version.follows.filter((f) => f !== "name")
		})
		.where(eq(schema.characterVersions.id, version.id))
	return { linked, dated, book, m }
}

async function make(
	userId: number,
	p: {
		genreId?: string
		lorebookId?: number
		characterIds?: number[]
		personaIds?: number[]
	},
	isAdmin = false
) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emitted, emit } = recorder()
	const res = (await sessionsCreateHandler.handler(
		socket(userId, isAdmin),
		{
			session: {
				name: "S",
				genreId: p.genreId ?? PLAIN,
				...(p.lorebookId != null ? { lorebookId: p.lorebookId } : {})
			},
			characterIds: p.characterIds ?? [],
			personaIds: p.personaIds ?? []
		} as any,
		emit
	)) as any
	return { res, emitted }
}

async function update(userId: number, body: Record<string, unknown>) {
	const { sessionsUpdateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emitted, emit } = recorder()
	let error: unknown = null
	try {
		await sessionsUpdateHandler.handler(
			socket(userId, false),
			body as any,
			emit
		)
	} catch (e) {
		error = e
	}
	return { emitted, error }
}

const characterSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.id))

const playerSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.id))

const membersOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))

const sessionOwnBook = async (sessionId: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, sessionId))
	)[0]

const sessionCountOf = async (userId: number) =>
	(
		await testDb
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, userId))
	).length

// ── the writes carry the member ─────────────────────────────────────────────

describe("sessions:create seats a card and its cast member together", () => {
	test("picked characters, a persona and a book: members found in the book, or made in it", async () => {
		const u = await owner()
		const book = await ownBook(u)
		const known = await card(u.id, "Known")
		const fresh = await card(u.id, "Fresh")
		const player = await card(u.id, "Player", { persona: true })
		const knownMember = await linkMember(book.id, known.id, "Known")

		const { res, emitted } = await make(u.id, {
			lorebookId: book.id,
			characterIds: [known.id, fresh.id],
			personaIds: [player.id]
		})
		expect(res.error).toBeUndefined()
		const sessionId = res.session.id

		const inBook = await membersOf(book.id)
		const memberOfCard = (id: number) =>
			inBook.find((m) => m.characterId === id)?.id
		expect(knownMember.id).toBe(memberOfCard(known.id))
		expect(inBook).toHaveLength(3)

		const seats = await characterSeats(sessionId)
		expect(
			seats.map((s) => [s.characterId, s.castMemberId, s.position])
		).toEqual([
			[known.id, memberOfCard(known.id), 0],
			[fresh.id, memberOfCard(fresh.id), 0]
		])
		const players = await playerSeats(sessionId)
		expect(
			players.map((s) => [s.personaId, s.castMemberId, s.position])
		).toEqual([[player.id, memberOfCard(player.id), 0]])
		// It made members, so the book's cast is listed again for whoever watches it.
		expect(emitted.map((e) => e.event)).toContain("lorebooks:bindingList")
	})

	test("every card already a member: nothing made, nothing relisted", async () => {
		const u = await owner()
		const book = await ownBook(u)
		const a = await card(u.id, "A")
		const m = await linkMember(book.id, a.id, "A")
		const { res, emitted } = await make(u.id, {
			lorebookId: book.id,
			characterIds: [a.id]
		})
		expect(res.error).toBeUndefined()
		expect((await characterSeats(res.session.id))[0]!.castMemberId).toBe(
			m.id
		)
		expect(await membersOf(book.id)).toHaveLength(1)
		expect(emitted.map((e) => e.event)).not.toContain(
			"lorebooks:bindingList"
		)
	})

	test("a session whose lorebook is its own book: the seats get members made in it", async () => {
		const u = await owner()
		const c = await card(u.id, "Early")
		const p = await card(u.id, "Early player", { persona: true })
		const { res } = await make(u.id, {
			characterIds: [c.id],
			personaIds: [p.id]
		})
		expect(res.error).toBeUndefined()
		const sessionId = res.session.id
		const own = await sessionOwnBook(sessionId)
		expect(own).toBeTruthy()
		const inOwn = await membersOf(own!.id)
		expect(inOwn).toHaveLength(2)
		expect((await characterSeats(sessionId))[0]).toMatchObject({
			characterId: c.id,
			castMemberId: inOwn.find((m) => m.characterId === c.id)!.id
		})
		expect((await playerSeats(sessionId))[0]).toMatchObject({
			personaId: p.id,
			castMemberId: inOwn.find((m) => m.characterId === p.id)!.id
		})
	})

	test("a provided book gets no member made in it: the seat of a card it does not know gets a member in the own book, one it knows gets that member", async () => {
		const p = await providedBook()
		const mine = await card(p.admin.id, "Admin own")
		const before = await membersOf(p.book.id)
		const { res } = await make(
			p.admin.id,
			{ lorebookId: p.book.id, characterIds: [mine.id, p.plain.id] },
			true
		)
		expect(res.error).toBeUndefined()
		expect(await membersOf(p.book.id)).toHaveLength(before.length)
		const seats = await characterSeats(res.session.id)
		const seatOf = (cardId: number) =>
			seats.find((s) => s.characterId === cardId)!
		const own = await sessionOwnBook(res.session.id)
		const inOwn = await membersOf(own!.id)
		expect(inOwn.map((m) => m.characterId)).toEqual([mine.id])
		expect(seatOf(mine.id).castMemberId).toBe(inOwn[0]!.id)
		expect(seatOf(p.plain.id).castMemberId).toBe(
			before.find((m) => m.characterId === p.plain.id)!.id
		)
	})

	test("a session whose lorebook is its own book: the member is made there, and a later update cannot attach another book (the book lock)", async () => {
		const u = await owner()
		const c = await card(u.id, "Bookless")
		const { res } = await make(u.id, { characterIds: [c.id] })
		expect(res.error).toBeUndefined()
		const sessionId = res.session.id
		const own = await sessionOwnBook(sessionId)
		const inOwn = await membersOf(own!.id)
		expect(inOwn).toHaveLength(1)
		const seatMember = (await characterSeats(sessionId))[0]!.castMemberId
		expect(seatMember).toBe(inOwn[0]!.id)

		// The book is fixed at start (★B-5): a later update cannot give it a book.
		const book = await ownBook(u)
		const { error } = await update(u.id, {
			session: { id: sessionId, lorebookId: book.id }
		})
		expect(String(error)).toContain(BOOK_LOCK_REFUSAL)
		const [kept] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		expect(kept!.lorebookId).toBeNull()
		expect(await membersOf(book.id)).toHaveLength(0)
		expect((await characterSeats(sessionId))[0]!.castMemberId).toBe(
			seatMember
		)
	})

	test("the boot pass over a session whose lorebook is its own book, its seat already given a member: all zeros", async () => {
		const u = await owner()
		const c = await card(u.id, "Waiting")
		const { res } = await make(u.id, { characterIds: [c.id] })
		expect(res.error).toBeUndefined()
		const before = await characterSeats(res.session.id)
		expect(before[0]!.castMemberId).not.toBeNull()
		const { seatMembers } = await import("$lib/server/sessions/seatMembers")
		expect(await seatMembers(testDb as unknown as Db)).toEqual({
			sessions: 0,
			filled: 0,
			minted: 0,
			merged: 0,
			unexplained: 0,
			failed: 0
		})
		expect(await characterSeats(res.session.id)).toEqual(before)
	})
})

describe("sessions:update, sessions:addPersona and reassign carry the member", () => {
	async function sessionWithBook(
		characterIds: number[] = [],
		personaIds: number[] = []
	) {
		const u = await owner()
		const book = await ownBook(u)
		const { res } = await make(u.id, {
			lorebookId: book.id,
			characterIds,
			personaIds
		})
		return { u, book, sessionId: res.session.id as number }
	}

	test("a character added by update is seated with its member", async () => {
		const { u, book, sessionId } = await sessionWithBook()
		const c = await card(u.id, "Added")
		const { error } = await update(u.id, {
			session: { id: sessionId },
			characterIds: [c.id]
		})
		expect(error).toBeNull()
		const [seat] = await characterSeats(sessionId)
		const [m] = await membersOf(book.id)
		expect(seat).toMatchObject({ characterId: c.id, castMemberId: m!.id })
	})

	test("a removed character revived by update is seated again, with its member", async () => {
		const u = await owner()
		const book = await ownBook(u)
		const c = await card(u.id, "Back")
		const m = await linkMember(book.id, c.id, "Back")
		const { res } = await make(u.id, {
			lorebookId: book.id,
			characterIds: [c.id]
		})
		const sessionId = res.session.id
		// Benched first, then removed (a benched seat with no lines).
		await update(u.id, { session: { id: sessionId }, characterIds: [] })
		await update(u.id, { session: { id: sessionId }, characterIds: [] })
		expect((await characterSeats(sessionId))[0]!.removedAt).not.toBeNull()
		const { error } = await update(u.id, {
			session: { id: sessionId },
			characterIds: [c.id]
		})
		expect(error).toBeNull()
		const seats = await characterSeats(sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]).toMatchObject({
			removedAt: null,
			isActive: true,
			castMemberId: m.id
		})
	})

	test("a persona added by update, and one revived, carry their member", async () => {
		const { u, book, sessionId } = await sessionWithBook()
		const p = await card(u.id, "Reader", { persona: true })
		let r = await update(u.id, {
			session: { id: sessionId },
			personaIds: [p.id]
		})
		expect(r.error).toBeNull()
		const [m] = await membersOf(book.id)
		expect((await playerSeats(sessionId))[0]).toMatchObject({
			personaId: p.id,
			castMemberId: m!.id,
			removedAt: null
		})
		// Benched first, then removed (a benched seat with no lines).
		await update(u.id, { session: { id: sessionId }, personaIds: [] })
		await update(u.id, { session: { id: sessionId }, personaIds: [] })
		expect((await playerSeats(sessionId))[0]!.removedAt).not.toBeNull()
		r = await update(u.id, {
			session: { id: sessionId },
			personaIds: [p.id]
		})
		expect(r.error).toBeNull()
		const seats = await playerSeats(sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]).toMatchObject({ removedAt: null, castMemberId: m!.id })
	})

	test("sessions:addPersona seats the persona with its member", async () => {
		const { u, book, sessionId } = await sessionWithBook()
		const p = await card(u.id, "Late", { persona: true })
		const { sessionsAddPersonaHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionsAddPersonaHandler.handler(
			socket(u.id, false),
			{ sessionId, personaId: p.id } as any,
			noEmit
		)
		const [m] = await membersOf(book.id)
		expect(await playerSeats(sessionId)).toMatchObject([
			{ personaId: p.id, castMemberId: m!.id }
		])
	})

	test("reassigning a removed character, and a removed persona, seats the new one with its member", async () => {
		const u = await owner()
		const book = await ownBook(u)
		const oldC = await card(u.id, "Old")
		const newC = await card(u.id, "New")
		const oldP = await card(u.id, "Old player", { persona: true })
		const newP = await card(u.id, "New player", { persona: true })
		const { res } = await make(u.id, {
			lorebookId: book.id,
			characterIds: [oldC.id],
			personaIds: [oldP.id]
		})
		const sessionId = res.session.id
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [],
			personaIds: []
		})
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		for (const [type, oldId, newId] of [
			["character", oldC.id, newC.id],
			["persona", oldP.id, newP.id]
		] as const) {
			const out =
				(await sessionsReassignRemovedParticipantHandler.handler(
					socket(u.id, false),
					{ sessionId, type, oldId, newId } as any,
					noEmit
				)) as any
			expect(out.error).toBeUndefined()
		}
		const inBook = await membersOf(book.id)
		const idOf = (cardId: number) =>
			inBook.find((m) => m.characterId === cardId)!.id
		expect(await characterSeats(sessionId)).toMatchObject([
			{
				characterId: newC.id,
				castMemberId: idOf(newC.id),
				removedAt: null
			}
		])
		expect(await playerSeats(sessionId)).toMatchObject([
			{ personaId: newP.id, castMemberId: idOf(newP.id), removedAt: null }
		])
	})
})

// ── one cast member is one character seat ───────────────────────────────────

describe("two cards of one member are refused in words", () => {
	test("create with a linked card and a dated card of one member: refused, no session is made", async () => {
		const u = await owner()
		const w = await datedMember(u.id)
		const before = await sessionCountOf(u.id)
		const { res, emitted } = await make(u.id, {
			lorebookId: w.book.id,
			characterIds: [w.linked.id, w.dated.id]
		})
		const sentence = `Captain Maren is already in this session as ${w.linked.name}.`
		expect(res.error).toBe(sentence)
		expect(emitted).toContainEqual({
			event: "sessions:create:error",
			data: { error: sentence }
		})
		expect(res.session).toBeUndefined()
		expect(await sessionCountOf(u.id)).toBe(before)
	})

	test("update adding a second card of a seated member: refused, nothing written", async () => {
		const u = await owner()
		const w = await datedMember(u.id)
		const { res } = await make(u.id, {
			lorebookId: w.book.id,
			characterIds: [w.linked.id]
		})
		const sessionId = res.session.id
		const before = await characterSeats(sessionId)
		const { error, emitted } = await update(u.id, {
			session: { id: sessionId },
			characterIds: [w.linked.id, w.dated.id]
		})
		const sentence = `Captain Maren is already in this session as ${w.linked.name}.`
		expect((error as Error).message).toBe(sentence)
		expect(emitted).toContainEqual({
			event: "sessions:update:error",
			data: { error: sentence }
		})
		expect(await characterSeats(sessionId)).toEqual(before)
	})

	test("reassigning a removed character to a second card of a seated member: refused in words, rolled back", async () => {
		const u = await owner()
		const w = await datedMember(u.id)
		const gone = await card(u.id, "Gone")
		const { res } = await make(u.id, {
			lorebookId: w.book.id,
			characterIds: [gone.id, w.linked.id]
		})
		const sessionId = res.session.id
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [w.linked.id]
		})
		const before = await characterSeats(sessionId)
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const out = (await sessionsReassignRemovedParticipantHandler.handler(
			socket(u.id, false),
			{
				sessionId,
				type: "character",
				oldId: gone.id,
				newId: w.dated.id
			} as any,
			noEmit
		)) as any
		expect(out.error).toBe(
			`Captain Maren is already in this session as ${w.linked.name}.`
		)
		expect(await characterSeats(sessionId)).toEqual(before)
	})

	test("the book's seated cast skips a member whose dated card the request already picked", async () => {
		const u = await owner()
		const w = await datedMember(u.id)
		const other = await card(u.id, "Other")
		await linkMember(w.book.id, other.id, "Other")
		const { res } = await make(u.id, {
			genreId: DECLARED,
			lorebookId: w.book.id,
			characterIds: [w.dated.id]
		})
		expect(res.error).toBeUndefined()
		const live = (await characterSeats(res.session.id)).filter(
			(s) => s.removedAt === null
		)
		expect(live.map((s) => s.characterId).sort()).toEqual(
			[w.dated.id, other.id].sort()
		)
		expect(live.every((s) => s.castMemberId != null)).toBe(true)
		const ids = live.map((s) => s.castMemberId)
		expect(new Set(ids).size).toBe(ids.length)
	})
})

describe("attach and overwrite never depart a seat", () => {
	test("two live seats of one member stay seated through runLorebookBindingCheck; neither is merged_into the other", async () => {
		const u = await owner()
		const w = await datedMember(u.id)
		const { res } = await make(u.id, {
			lorebookId: w.book.id,
			characterIds: [w.linked.id]
		})
		expect(res.error).toBeUndefined()
		const sessionId = res.session.id as number
		// A second card of the member seated by a bulk path ("allow"), as an import or a branch does.
		const { seatCast } = await import("$lib/server/sessions/seats")
		const second = await seatCast(testDb as unknown as Db, {
			sessionId,
			cardId: w.dated.id,
			secondCard: "allow"
		})
		expect(second.ok).toBe(true)

		const { runLorebookBindingCheck } = await import(
			"$lib/server/sockets/sessions"
		)
		const { emit } = recorder()
		await runLorebookBindingCheck(
			socket(u.id, false),
			sessionId,
			w.book.id,
			emit
		)
		await runLorebookBindingCheck(
			socket(u.id, false),
			sessionId,
			w.book.id,
			emit
		)

		const seats = await characterSeats(sessionId)
		expect(seats).toHaveLength(2)
		expect(seats.every((s) => s.removedAt === null)).toBe(true)
		expect(seats.every((s) => s.mergedInto === null)).toBe(true)
		expect(seats.map((s) => s.castMemberId)).toEqual([w.m.id, w.m.id])
	})
})
