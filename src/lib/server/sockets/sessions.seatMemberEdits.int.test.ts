/**
 * 🚧 The session edits that name or stamp a seat read the seated cast member
 * (plan §27 S2).
 *
 * Claims: `sessions:update` removing a character seat keeps the name of the
 * MEMBER as read (its own name over the card's), and the card's nickname or
 * name when the member has none of its own; `sessions:reassignRemovedParticipant`
 * stamps the re-pointed lines with the new seat's member, for a character and
 * for a player seat; `sessions:accountVisibility` lists a person's card that a
 * seated member is linked to (once, whichever seat names it), as the inverse
 * of `canViewCharacter`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"

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
		getCryptoSecretKey: () => "seat-member-edits-test-secret"
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seat-member-edits-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noEmit = () => {}
let n = 0

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `seat-member-edits-${++n}`)
}

async function card(
	userId: number,
	name: string,
	over: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name: `${name} ${++n}`, description: "", ...over })
		.returning()
	return row!
}

async function ownBook(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return book!
}

/** One member of a book, linked to a card. */
async function member(
	lorebookId: number,
	cardId: number,
	over: Record<string, unknown> = {}
) {
	const row = (
		await insertCastMember(testDb, {
			lorebookId,
			characterId: cardId,
			binding: `{{char:${++n}}}`,
			name: `m${n}`,
			...over
		} as any)
	).member
	return row!
}

async function sessionOf(userId: number, lorebookId: number | null = null) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: `Run ${++n}`,
			...(lorebookId != null ? { lorebookId } : {})
		})
		.returning()
	return row!
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

describe("sessions:update, removing a character seat", () => {
	test("keeps the member's own name; a member with none keeps the card's nickname", async () => {
		const u = await user()
		const book = await ownBook(u.id)
		const named = await card(u.id, "Maren card")
		const plain = await card(u.id, "Plain card", { nickname: "Pip" })
		const mNamed = await member(book.id, named.id, {
			ownName: "Captain Maren",
			name: "Captain Maren"
		})
		const mPlain = await member(book.id, plain.id)
		const s = await sessionOf(u.id, book.id)
		await testDb.insert(schema.sessionCharacters).values([
			{
				sessionId: s.id,
				characterId: named.id,
				castMemberId: mNamed.id,
				position: 0
			},
			{
				sessionId: s.id,
				characterId: plain.id,
				castMemberId: mPlain.id,
				position: 1
			}
		] as any)
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		// Benched first, then removed (the name is snapshotted on removal).
		for (let pass = 0; pass < 2; pass++)
			await sessionsUpdateHandler.handler(
				socket(u.id),
				{ session: { id: s.id }, characterIds: [] } as any,
				noEmit
			)
		const seats = await characterSeats(s.id)
		const byCard = (id: number) => seats.find((x) => x.characterId === id)!
		expect(byCard(named.id).removedAt).not.toBeNull()
		expect(byCard(named.id).removedName).toBe("Captain Maren")
		expect(byCard(plain.id).removedAt).not.toBeNull()
		expect(byCard(plain.id).removedName).toBe("Pip")
	})
})

describe("sessions:reassignRemovedParticipant stamps the new seat's member", () => {
	test("a character and a player seat", async () => {
		const u = await user()
		const book = await ownBook(u.id)
		const oldC = await card(u.id, "Old")
		const newC = await card(u.id, "New")
		const oldP = await card(u.id, "Old player", { isPersona: true })
		const newP = await card(u.id, "New player", { isPersona: true })
		const mOldC = await member(book.id, oldC.id)
		const mNewC = await member(book.id, newC.id)
		const mOldP = await member(book.id, oldP.id)
		const mNewP = await member(book.id, newP.id)
		const s = await sessionOf(u.id, book.id)
		const gone = new Date()
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: oldC.id,
			castMemberId: mOldC.id,
			removedAt: gone,
			isActive: false
		} as any)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: oldP.id,
			castMemberId: mOldP.id,
			removedAt: gone
		} as any)
		const lines = await testDb
			.insert(schema.sessionMessages)
			.values([
				{
					sessionId: s.id,
					role: "assistant",
					content: "from the old character",
					characterId: oldC.id,
					castMemberId: mOldC.id
				},
				{
					sessionId: s.id,
					role: "user",
					content: "from the old player",
					personaId: oldP.id,
					castMemberId: mOldP.id
				}
			] as any)
			.returning()
		const { sessionsReassignRemovedParticipantHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		for (const [type, oldId, newId] of [
			["character", oldC.id, newC.id],
			["persona", oldP.id, newP.id]
		] as const) {
			const out =
				(await sessionsReassignRemovedParticipantHandler.handler(
					socket(u.id),
					{ sessionId: s.id, type, oldId, newId } as any,
					noEmit
				)) as any
			expect(out.error).toBeUndefined()
		}
		const seatC = (await characterSeats(s.id)).find(
			(x) => x.characterId === newC.id
		)!
		const seatP = (await playerSeats(s.id)).find(
			(x) => x.personaId === newP.id
		)!
		expect(seatC.castMemberId).toBe(mNewC.id)
		expect(seatP.castMemberId).toBe(mNewP.id)
		const after = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, s.id))
			.orderBy(asc(schema.sessionMessages.id))
		const lineC = after.find((m) => m.id === lines[0]!.id)!
		const lineP = after.find((m) => m.id === lines[1]!.id)!
		expect(lineC).toMatchObject({
			characterId: newC.id,
			castMemberId: seatC.castMemberId
		})
		expect(lineP).toMatchObject({
			personaId: newP.id,
			castMemberId: seatP.castMemberId
		})
	})
})

describe("sessions:accountVisibility follows the seated member's card", () => {
	test("a card a seated member is linked to is exposed, once", async () => {
		const owner = await user()
		const guest = await user()
		const book = await ownBook(owner.id)
		const A = await card(owner.id, "Seat card")
		const B = await card(guest.id, "Guest card")
		const P = await card(owner.id, "Voice card", { isPersona: true })
		const Q = await card(guest.id, "Guest voice card", { isPersona: true })
		const ofB = await member(book.id, B.id)
		const viaP = await member(book.id, Q.id)
		const s = await sessionOf(owner.id, book.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: s.id, userId: guest.id, isPlayer: true })
		await testDb.insert(schema.sessionCharacters).values([
			// The seat holds the owner's card A, its member is the guest's B.
			{
				sessionId: s.id,
				characterId: A.id,
				castMemberId: ofB.id,
				position: 0
			},
			// A second seat holds B itself: B must still be listed once.
			{
				sessionId: s.id,
				characterId: B.id,
				castMemberId: ofB.id,
				position: 1
			}
		] as any)
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: s.id,
			personaId: P.id,
			castMemberId: viaP.id
		} as any)
		const { sessionsAccountVisibilityHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res = await sessionsAccountVisibilityHandler.handler(
			socket(guest.id),
			{ sessionId: s.id } as any,
			noEmit
		)
		expect(res.error).toBeUndefined()
		expect(res.exposed.characters.map((c) => c.id)).toEqual([B.id])
		expect(res.exposed.personas.map((c) => c.id)).toEqual([Q.id])
		// The owner holds neither of the guest's cards: nothing of theirs is linked.
		const ownerRes = await sessionsAccountVisibilityHandler.handler(
			socket(owner.id),
			{ sessionId: s.id } as any,
			noEmit
		)
		expect(ownerRes.exposed.characters.map((c) => c.id)).toEqual([A.id])
		expect(ownerRes.exposed.personas.map((c) => c.id)).toEqual([P.id])
	})
})
