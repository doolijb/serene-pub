/**
 * 🚧 Seat cards read as the cast member each seat seats (plan §27 S2, lane
 * s27-S2-promptText): `seatCardsAsRead`, `cardsAsSeatsRead`, and `storedSeatRef` (the one door; `cardFormRef` retired 2026-11-05)
 * against a real database.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import { eq } from "drizzle-orm"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { storedSeatRef } from "$lib/server/state/seatRefs"
import {
	cardsAsSeatsRead,
	seatCardsAsRead,
	seatMembersAsRead
} from "./seatCards"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertDatedCardVersion } from "$lib/server/pipelines/testing/fixtures"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seatcards-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `seatcards-${++n}`)
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			userId,
			name,
			description: `${name}: the card's description.`,
			firstMessage: `${name}: the card says hello.`,
			strokes: [
				{
					kind: "description",
					text: "A stroke.",
					trigger: "always"
				} as any
			]
		})
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return row!
}

/** A session's own book, made the way a session is born with one. */
async function ownBookOfSession(sessionId: number, userId: number) {
	const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
	return insertOwnBook(db(), {
		sessionId,
		userId,
		name: null,
		overlayOf: null,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
}

async function member(
	lorebookId: number,
	characterId: number | null,
	over: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	const row = (
		await insertCastMember(testDb, {
			lorebookId,
			characterId,
			binding: `{{char:${++n}}}`,
			name: "member",
			...over
		} as any)
	).member
	return row!
}

async function session(userId: number, lorebookId: number | null) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId
		} as any)
		.returning()
	return row!
}

async function seat(
	sessionId: number,
	characterId: number,
	castMemberId: number | null,
	over: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, castMemberId, ...over } as any)
		.returning()
	return row!
}

async function rows(sessionId: number) {
	return testDb.query.sessionCharacters.findMany({
		where: (cc, { eq }) => eq(cc.sessionId, sessionId),
		with: { character: true },
		orderBy: (cc, { asc }) => [asc(cc.position), asc(cc.id)]
	}) as Promise<any[]>
}

describe("seatCardsAsRead", () => {
	test("a stored member's own name and retold text read over the card", async () => {
		const u = await user()
		const c = await card(u.id, "Verity")
		const b = await book(u.id)
		const m = await member(b.id, c.id, {
			ownName: "Vee",
			description: "The member's description.",
			retold: { description: true }
		})
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)
		const [out] = await seatCardsAsRead(db(), s.id, await rows(s.id))
		expect(out.character.name).toBe("Vee")
		expect(out.character.description).toBe("The member's description.")
		// Not retold: the card's.
		expect(out.character.firstMessage).toBe("Verity: the card says hello.")
		// "Everything in session is cast -> active card." (owner, 2026-11-05):
		// strokes are a profile field like any other — the member's as read
		// (here still the card version's, which the member follows), never
		// nulled because the description is the member's own.
		const [asRead] = await seatMembersAsRead(db(), s.id, await rows(s.id))
		expect(out.character.strokes).toEqual(asRead!.strokes)
		expect(out.castMemberId).toBe(m.id)
	})

	test("a seat with no member stored reads the member the writer would find; one with none anywhere reads the card", async () => {
		const u = await user()
		const found = await card(u.id, "Found")
		const alone = await card(u.id, "Alone")
		const b = await book(u.id)
		await member(b.id, found.id, { ownName: "Located" })
		const s = await session(u.id, b.id)
		await seat(s.id, found.id, null, { position: 0 })
		await seat(s.id, alone.id, null, { position: 1 })
		const before = await rows(s.id)
		const out = await seatCardsAsRead(db(), s.id, before)
		expect(out[0].character.name).toBe("Located")
		expect(out[1].character).toBe(before[1].character)
		expect(out[1].character.name).toBe("Alone")
	})

	test("a session whose lorebook is its own book reads the member of its own book", async () => {
		const u = await user()
		const c = await card(u.id, "Wren")
		const s = await session(u.id, null)
		const own = await ownBookOfSession(s.id, u.id)
		const m = await member(own.id, c.id, {
			ownName: "Wren of the Notes",
			firstMessage: "The member greets.",
			retold: { firstMessage: true }
		})
		// Stored on the seat, and found by the card when not stored.
		await seat(s.id, c.id, m.id)
		let [out] = await seatCardsAsRead(db(), s.id, await rows(s.id))
		expect(out.character.name).toBe("Wren of the Notes")
		expect(out.character.firstMessage).toBe("The member greets.")

		const c2 = await card(u.id, "Sparrow")
		await member(own.id, c2.id, { ownName: "Sparrow of the Notes" })
		await seat(s.id, c2.id, null, { position: 1 })
		const all = await seatCardsAsRead(db(), s.id, await rows(s.id))
		expect(all.map((r) => r.character.name)).toEqual([
			"Wren of the Notes",
			"Sparrow of the Notes"
		])
	})

	test("a stored member in a book the session no longer reads is not read", async () => {
		const u = await user()
		const c = await card(u.id, "Cass")
		const b1 = await book(u.id)
		const b2 = await book(u.id)
		const m1 = await member(b1.id, c.id, { ownName: "Old" })
		const m2 = await member(b2.id, c.id, { ownName: "New" })
		const s = await session(u.id, b2.id)
		await seat(s.id, c.id, m1.id)
		const [out] = await seatCardsAsRead(db(), s.id, await rows(s.id))
		expect(out.character.name).toBe("New")

		// The attached book holds no member for the card: the card as it is.
		await testDb
			.delete(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, m2.id))
		const before = await rows(s.id)
		const [bare] = await seatCardsAsRead(db(), s.id, before)
		expect(bare.character.name).toBe("Cass")
		expect(bare.character).toBe(before[0].character)
	})

	test("a stored member in the session's own book is read", async () => {
		const u = await user()
		const c = await card(u.id, "Dove")
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const own = await ownBookOfSession(s.id, u.id)
		const m = await member(own.id, c.id, { ownName: "Dove of the Notes" })
		await seat(s.id, c.id, m.id)
		const [out] = await seatCardsAsRead(db(), s.id, await rows(s.id))
		expect(out.character.name).toBe("Dove of the Notes")
	})

	// Owner ruling 2026-11-05: "Everything in session is cast -> active card."
	test("a seat reads its member over the dated (active) card the story clock draws, keeping the seat's card id", async () => {
		const u = await user()
		const a = await card(u.id, "Maren")
		const bCard = await card(u.id, "Maren, younger")
		const b = await book(u.id)
		const m = await member(b.id, a.id, {
			ownName: "Captain Maren",
			description: "The member's description.",
			retold: { description: true }
		})
		await insertDatedCardVersion(testDb, m.id, bCard.id, 1)
		const s = await session(u.id, b.id)
		await seat(s.id, a.id, m.id)
		const [out] = await seatCardsAsRead(db(), s.id, await rows(s.id))
		expect(out.character.id).toBe(a.id)
		expect(out.character.name).toBe("Captain Maren")
		expect(out.character.description).toBe("The member's description.")
		// The active (dated) card supplies what is not retold.
		expect(out.character.firstMessage).toBe(
			"Maren, younger: the card says hello."
		)
	})

	// Owner ruling 2026-11-05: two seats on one member read the same thing.
	test("two seats on one member holding different cards read the member over its one active card", async () => {
		const u = await user()
		const a = await card(u.id, "Ada")
		const a2 = await card(u.id, "Ada, later")
		const b = await book(u.id)
		const m = await member(b.id, a.id, {
			ownName: "Ada Prime",
			scenario: "Member scenario.",
			retold: { scenario: true }
		})
		await insertDatedCardVersion(testDb, m.id, a2.id, 1)
		const s = await session(u.id, b.id)
		await seat(s.id, a.id, m.id, { position: 0 })
		await seat(s.id, a2.id, m.id, { position: 1 })
		const out = await seatCardsAsRead(db(), s.id, await rows(s.id))
		expect(out.map((r) => r.character.id)).toEqual([a.id, a2.id])
		expect(out.map((r) => r.character.name)).toEqual([
			"Ada Prime",
			"Ada Prime"
		])
		expect(out.map((r) => r.character.scenario)).toEqual([
			"Member scenario.",
			"Member scenario."
		])
		expect(out[0].character.description).toBe(
			"Ada, later: the card's description."
		)
		expect(out[1].character.description).toBe(
			"Ada, later: the card's description."
		)
	})
})

describe("seatMembersAsRead", () => {
	test("one entry per row: the member as read over the seat's card, a found member for an unfilled seat, null for none", async () => {
		const u = await user()
		const stored = await card(u.id, "Stored")
		const found = await card(u.id, "Found")
		const alone = await card(u.id, "Alone")
		const b = await book(u.id)
		const ms = await member(b.id, stored.id, { ownName: "Kept" })
		const mf = await member(b.id, found.id, { ownName: "Located" })
		const s = await session(u.id, b.id)
		await seat(s.id, stored.id, ms.id, { position: 0 })
		await seat(s.id, found.id, null, { position: 1 })
		await seat(s.id, alone.id, null, { position: 2 })
		const before = await rows(s.id)
		const out = await seatMembersAsRead(db(), s.id, before)
		expect(out).toHaveLength(3)
		expect(out[0]?.name).toBe("Kept")
		expect(out[0]?.activeCardId).toBe(stored.id)
		expect(out[1]?.name).toBe("Located")
		expect(out[1]?.activeCardId).toBe(found.id)
		expect(out[2]).toBeNull()
		// seatCardsAsRead is these, filled into each row's card.
		const cards = await seatCardsAsRead(db(), s.id, before)
		expect(cards.map((r: any) => r.character.name)).toEqual([
			"Kept",
			"Located",
			"Alone"
		])
		expect(out[1]?.castMemberId).toBe(mf.id)
	})
})

describe("storedSeatRef (was cardFormRef)", () => {
	// ⏳ The door's flip-off reading (card form); its flip-on reading is
	// `state/seatRefs.test.ts` / `state/memberForm.int.test.ts`'s.
	let was = false
	beforeEach(async () => {
		const { memberFormSwitch } = await import("$lib/server/state/memberForm")
		was = memberFormSwitch.on
		memberFormSwitch.on = false
	})
	afterEach(async () => {
		const { memberFormSwitch } = await import("$lib/server/state/memberForm")
		memberFormSwitch.on = was
	})
	test("seated-member becomes the seat's card form; a card-less player seat its own ref; unknown null; other refs unchanged", async () => {
		const u = await user()
		const c = await card(u.id, "Seated")
		const b = await book(u.id)
		const m = await member(b.id, c.id)
		const cardless = await member(b.id, null, { name: "Voice" })
		const s = await session(u.id, b.id)
		await seat(s.id, c.id, m.id)
		const [ps] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: s.id,
				personaId: null,
				castMemberId: cardless.id
			} as any)
			.returning()
		expect(await storedSeatRef(db(), s.id, `seated-member:${m.id}`)).toBe(
			`character:${c.id}`
		)
		expect(
			await storedSeatRef(db(), s.id, `seated-member:${cardless.id}`)
		).toBe(`player-seat:${ps!.id}`)
		expect(
			await storedSeatRef(db(), s.id, "seated-member:999999")
		).toBeNull()
		expect(await storedSeatRef(db(), s.id, `character:${c.id}`)).toBe(
			`character:${c.id}`
		)
		expect(await storedSeatRef(db(), s.id, "envoy:scribe")).toBe(
			"envoy:scribe"
		)
	})
})

describe("cardsAsSeatsRead", () => {
	test("a departed seat's member names the card; an unseated card in the attached book reads the book's member", async () => {
		const u = await user()
		const gone = await card(u.id, "Gone")
		const offered = await card(u.id, "Offered")
		const plain = await card(u.id, "Plain")
		const b = await book(u.id)
		const mGone = await member(b.id, gone.id, { ownName: "Departed Name" })
		await member(b.id, offered.id, { ownName: "Offered Name" })
		const s = await session(u.id, b.id)
		await seat(s.id, gone.id, mGone.id, { removedAt: new Date() })
		const out = await cardsAsSeatsRead(db(), s.id, [gone, offered, plain])
		expect(out.map((c) => c.name)).toEqual([
			"Departed Name",
			"Offered Name",
			"Plain"
		])
		expect(out[2]).toBe(plain)
		expect(await cardsAsSeatsRead(db(), s.id, [])).toEqual([])
	})
})
