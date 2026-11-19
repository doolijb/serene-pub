/**
 * 🚧 The guest seat switches (owner rulings G3, G4, 2026-11-16): per session,
 * both on by default. Off freezes a guest's seats of that kind as they are —
 * every door refuses in words and changes nothing — and the owner is never
 * frozen. The genre's opt-in holds on adds, for the owner too.
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
import {
	GUEST_SEAT_SENTENCES,
	storedGuestSeatSwitches
} from "$lib/shared/sessions/guestSeats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

const GENRES = vi.hoisted(() => ({
	noPersonas: "test:genre/no-personas@1",
	noCharacters: "test:genre/no-characters@1"
}))

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "guest-seats-test-secret"
	}
})
// Two genres whose shape lacks one kind; everything else is the real registry.
vi.mock(
	"$lib/server/pipelines/entities/sessionGenres",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("$lib/server/pipelines/entities/sessionGenres")
			>()
		return {
			...actual,
			getSessionGenre: async (db: any, id: string) =>
				id === GENRES.noPersonas
					? {
							genreId: id,
							name: "No personas",
							shape: { characters: { min: 0 } }
						}
					: id === GENRES.noCharacters
						? {
								genreId: id,
								name: "No characters",
								shape: { personas: { min: 0 } }
							}
						: actual.getSessionGenre(db, id)
		}
	}
)
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

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-guestseats-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socket = (userId: number) =>
	({
		id: `s-${userId}`,
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const user = async (label: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `${label}-${++n}`)
}

const card = async (userId: number, name: string) =>
	(
		await testDb
			.insert(schema.characters)
			.values({ userId, name, description: "" })
			.returning()
	)[0]!

/** An owner, a guest who plays, and a session with its own notes book. */
async function table(genreId?: string) {
	const owner = await user("gs-owner")
	const guest = await user("gs-guest")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			...(genreId ? { genreId } : {})
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id, isPlayer: true })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({
			userId: owner.id,
			name: `Notes ${++n}`,
			sessionId: session!.id
		} as any)
		.returning()
	return { owner, guest, sessionId: session!.id, bookId: book!.id }
}

const member = async (
	lorebookId: number,
	name: string,
	characterId: number | null = null
) =>
	(
		await insertCastMember(
			testDb as any,
			{
				lorebookId,
				characterId,
				binding: `{{char:${++n}}}`,
				name
			} as any
		)
	).member

const cardSeat = (sessionId: number, characterId: number, position = 0) =>
	testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, position })

const personaSeat = (
	sessionId: number,
	personaId: number,
	userId: number,
	position = 0
) =>
	testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId, userId, position })

async function setSwitches(sessionId: number, meta: Record<string, unknown>) {
	await testDb
		.update(schema.sessions)
		.set({ metadata: meta } as any)
		.where(eq(schema.sessions.id, sessionId))
}
const off = { guestsBringOwn: false, guestsTakeCast: false }

/** Both seat tables and the metadata, as a refusal must leave them. */
async function snapshot(sessionId: number) {
	const cs = await testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.id))
	const ps = await testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.id))
	const [s] = await testDb
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return JSON.stringify({ cs, ps, metadata: s?.metadata ?? null })
}

async function update(
	userId: number,
	sessionId: number,
	body: Record<string, unknown>
) {
	const { sessionsUpdateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	let error: string | null = null
	try {
		await sessionsUpdateHandler.handler(
			socket(userId),
			{ session: { id: sessionId }, ...body } as any,
			() => {}
		)
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	}
	return { error }
}

/** An update that must be refused with `sentence`, leaving everything as it was. */
async function refused(
	userId: number,
	sessionId: number,
	body: Record<string, unknown>,
	sentence: string
) {
	const before = await snapshot(sessionId)
	const { error } = await update(userId, sessionId, body)
	expect(error).toBe(sentence)
	expect(await snapshot(sessionId)).toBe(before)
}

async function door<T>(
	name: string,
	userId: number,
	params: unknown
): Promise<T> {
	const m = await import("$lib/server/sockets/sessions")
	const handler = (m as any)[name]
	return (await handler.handler(socket(userId), params, () => {})) as T
}

const BRING = GUEST_SEAT_SENTENCES.bringOwnOff
const TAKE = GUEST_SEAT_SENTENCES.takeCastOff

describe("the two switches", () => {
	test("a session with no keys reads both on; the owner stores off and on; a save without them writes nothing", async () => {
		const t = await table()
		await setSwitches(t.sessionId, { other: 1 })
		const read = async () =>
			(
				await testDb
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.id, t.sessionId))
			)[0]!.metadata as Record<string, unknown>
		expect(storedGuestSeatSwitches(await read())).toEqual({
			bringOwn: true,
			takeCast: true
		})

		// A save without the switch params writes no key (nothing to do on a second boot).
		expect(
			(
				await update(t.owner.id, t.sessionId, {
					session: { id: t.sessionId, name: "Renamed" }
				})
			).error
		).toBeNull()
		expect(await read()).toEqual({ other: 1 })

		await update(t.owner.id, t.sessionId, off)
		expect(await read()).toEqual({
			other: 1,
			guestsBringOwn: false,
			guestsTakeCast: false
		})
		expect(storedGuestSeatSwitches(await read())).toEqual({
			bringOwn: false,
			takeCast: false
		})

		await update(t.owner.id, t.sessionId, { guestsBringOwn: true })
		expect(await read()).toEqual({ other: 1, guestsTakeCast: false })
		await update(t.owner.id, t.sessionId, { guestsTakeCast: true })
		expect(await read()).toEqual({ other: 1 })
	})

	test("a guest's values change nothing", async () => {
		const t = await table()
		const before = await snapshot(t.sessionId)
		expect((await update(t.guest.id, t.sessionId, off)).error).toBeNull()
		expect(await snapshot(t.sessionId)).toBe(before)
	})
})

describe("characterIds and personaIds", () => {
	test("bring own off: a guest's add and own remove are refused; a missing owner card is skipped silently; the owner is never frozen", async () => {
		const t = await table()
		const ownerCard = await card(t.owner.id, "Owner card")
		const mine = await card(t.guest.id, "Guest card")
		const extra = await card(t.guest.id, "Guest extra")
		const ownerExtra = await card(t.owner.id, "Owner extra")
		await cardSeat(t.sessionId, ownerCard.id, 0)
		await cardSeat(t.sessionId, mine.id, 1)
		await setSwitches(t.sessionId, off)

		await refused(
			t.guest.id,
			t.sessionId,
			{ characterIds: [ownerCard.id, mine.id, extra.id] },
			BRING
		)
		await refused(
			t.guest.id,
			t.sessionId,
			{ characterIds: [ownerCard.id] },
			BRING
		)

		// The guest's list misses the owner's card: skipped, no refusal, the seat stays.
		const { error } = await update(t.guest.id, t.sessionId, {
			characterIds: [mine.id]
		})
		expect(error).toBeNull()
		const seats = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(and(eq(schema.sessionCharacters.sessionId, t.sessionId)))
		expect(
			seats.find((s) => s.characterId === ownerCard.id)?.removedAt
		).toBeNull()
		expect(
			seats.find((s) => s.characterId === mine.id)?.removedAt
		).toBeNull()

		// The owner adds and removes freely.
		expect(
			(
				await update(t.owner.id, t.sessionId, {
					characterIds: [ownerCard.id, ownerExtra.id]
				})
			).error
		).toBeNull()
		const after = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, t.sessionId))
		expect(
			after.find((s) => s.characterId === ownerExtra.id)?.removedAt
		).toBeNull()
	})

	test("bring own off: personaIds add and own remove refused; the owner may", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest persona")
		const extra = await card(t.guest.id, "Guest extra persona")
		const ownerPersona = await card(t.owner.id, "Owner persona")
		await personaSeat(t.sessionId, mine.id, t.guest.id, 0)
		await setSwitches(t.sessionId, off)
		await refused(
			t.guest.id,
			t.sessionId,
			{ personaIds: [mine.id, extra.id] },
			BRING
		)
		await refused(t.guest.id, t.sessionId, { personaIds: [] }, BRING)
		expect(
			(
				await update(t.owner.id, t.sessionId, {
					personaIds: [mine.id, ownerPersona.id]
				})
			).error
		).toBeNull()
	})

	test("both on: add, bench-by-remove and re-add are unchanged for the guest and the owner", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest card")
		const ownerCard = await card(t.owner.id, "Owner card")
		expect(
			(await update(t.guest.id, t.sessionId, { characterIds: [mine.id] }))
				.error
		).toBeNull()
		expect(
			(
				await update(t.owner.id, t.sessionId, {
					characterIds: [mine.id, ownerCard.id]
				})
			).error
		).toBeNull()
		expect(
			(
				await update(t.guest.id, t.sessionId, {
					characterIds: [ownerCard.id]
				})
			).error
		).toBeNull()
		const rows = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, t.sessionId))
		const live = (id: number) => rows.find((r) => r.characterId === id)
		expect(live(ownerCard.id)?.removedAt).toBeNull()
		expect(
			live(mine.id)?.isActive === false ||
				live(mine.id)?.removedAt != null
		).toBe(true)
	})
})

describe("castMemberIds", () => {
	test("take cast off: a guest's add and own remove are refused; others' seats missing are skipped; the owner may", async () => {
		const t = await table()
		const a = await member(t.bookId, "Ada")
		const b = await member(t.bookId, "Bo")
		const c = await member(t.bookId, "Cy")
		// The owner seats Ada; the guest seats Bo (take cast on).
		expect(
			(await update(t.owner.id, t.sessionId, { castMemberIds: [a.id] }))
				.error
		).toBeNull()
		expect(
			(
				await update(t.guest.id, t.sessionId, {
					castMemberIds: [a.id, b.id]
				})
			).error
		).toBeNull()
		await setSwitches(t.sessionId, off)

		await refused(
			t.guest.id,
			t.sessionId,
			{ castMemberIds: [a.id, b.id, c.id] },
			TAKE
		)
		await refused(t.guest.id, t.sessionId, { castMemberIds: [a.id] }, TAKE)
		// The owner's seat (Ada) missing from the guest's list is skipped, not refused.
		const same = await update(t.guest.id, t.sessionId, {
			castMemberIds: [b.id]
		})
		expect(same.error).toBeNull()
		const held = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, t.sessionId))
		expect(held.find((s) => s.castMemberId === a.id)?.removedAt).toBeNull()

		expect(
			(
				await update(t.owner.id, t.sessionId, {
					castMemberIds: [a.id, b.id, c.id]
				})
			).error
		).toBeNull()
	})

	test("take cast on: a guest takes a free card-less member; a carded one, one of another book and a held one (benched too) are refused", async () => {
		const t = await table()
		const other = await table()
		const free = await member(t.bookId, "Free")
		const held = await member(t.bookId, "Held")
		const benched = await member(t.bookId, "Benched")
		const stranger = await member(other.bookId, "Stranger")
		const hostCard = await card(t.owner.id, "Carded")
		const carded = await member(t.bookId, "Carded", hostCard.id)
		// Held by a live player seat, and by a benched one.
		await testDb.insert(schema.sessionPersonas).values([
			{
				sessionId: t.sessionId,
				personaId: null,
				userId: t.owner.id,
				seatName: "Held",
				castMemberId: held.id,
				position: 0
			},
			{
				sessionId: t.sessionId,
				personaId: null,
				userId: t.owner.id,
				seatName: "Benched",
				castMemberId: benched.id,
				position: 1,
				isActive: false
			}
		] as any)

		await refused(
			t.guest.id,
			t.sessionId,
			{ castMemberIds: [carded.id] },
			GUEST_SEAT_SENTENCES.cardedMember("Carded")
		)
		await refused(
			t.guest.id,
			t.sessionId,
			{ castMemberIds: [stranger.id] },
			"Stranger isn't in this session's lorebook. Seat someone from its cast instead."
		)
		await refused(
			t.guest.id,
			t.sessionId,
			{ castMemberIds: [held.id] },
			GUEST_SEAT_SENTENCES.memberHeld("Held")
		)
		await refused(
			t.guest.id,
			t.sessionId,
			{ castMemberIds: [benched.id] },
			GUEST_SEAT_SENTENCES.memberHeld("Benched")
		)
		// Refused as a whole: a free member listed with a carded one is not seated either.
		await refused(
			t.guest.id,
			t.sessionId,
			{ castMemberIds: [free.id, carded.id] },
			GUEST_SEAT_SENTENCES.cardedMember("Carded")
		)

		expect(
			(
				await update(t.guest.id, t.sessionId, {
					castMemberIds: [free.id]
				})
			).error
		).toBeNull()
		const seat = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, t.sessionId),
					eq(schema.sessionCharacters.castMemberId, free.id)
				)
			)
		expect(seat).toHaveLength(1)
		expect(seat[0]).toMatchObject({
			seatedByUserId: t.guest.id,
			removedAt: null
		})

		// The owner may still seat a carded member.
		expect(
			(
				await update(t.owner.id, t.sessionId, {
					castMemberIds: [free.id, carded.id]
				})
			).error
		).toBeNull()
	})

	test("both on: a guest leaves the seat they took; the owner removes any", async () => {
		const t = await table()
		const a = await member(t.bookId, "Ada")
		const b = await member(t.bookId, "Bo")
		expect(
			(
				await update(t.guest.id, t.sessionId, {
					castMemberIds: [a.id, b.id]
				})
			).error
		).toBeNull()
		expect(
			(await update(t.guest.id, t.sessionId, { castMemberIds: [b.id] }))
				.error
		).toBeNull()
		expect(
			(await update(t.owner.id, t.sessionId, { castMemberIds: [] })).error
		).toBeNull()
		const rows = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, t.sessionId))
		expect(
			rows.every((r) => r.removedAt != null || r.isActive === false)
		).toBe(true)
	})
})

describe("seat names and player seats", () => {
	test("bring own off: naming opens no seat, a retire is refused, a rename of a held seat is allowed", async () => {
		const t = await table()
		const before = await snapshot(t.sessionId)
		await setSwitches(t.sessionId, off)
		const frozen = await snapshot(t.sessionId)
		await refused(t.guest.id, t.sessionId, { seatName: "Newcomer" }, BRING)

		const { writeSeatName, SeatNameRefusal } = await import(
			"$lib/server/sessions/seatName"
		)
		// As a run calls it: not the owner, directly.
		await expect(
			writeSeatName(testDb as any, {
				sessionId: t.sessionId,
				userId: t.guest.id,
				isOwner: false,
				name: "Run name"
			})
		).rejects.toThrow(BRING)
		await expect(
			writeSeatName(testDb as any, {
				sessionId: t.sessionId,
				userId: t.guest.id,
				isOwner: false,
				name: "Run name"
			})
		).rejects.toBeInstanceOf(SeatNameRefusal)
		expect(await snapshot(t.sessionId)).toBe(frozen)
		expect(before).not.toBe(frozen)

		// The owner opens a seat for themselves freely.
		expect(
			(await update(t.owner.id, t.sessionId, { seatName: "Owner Char" }))
				.error
		).toBeNull()

		// A guest who holds a named seat may rename it, and may not retire it.
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				userId: t.guest.id,
				seatName: "Old",
				position: 5
			} as any)
			.returning()
		const frozen2 = await snapshot(t.sessionId)
		await expect(
			writeSeatName(testDb as any, {
				sessionId: t.sessionId,
				userId: t.guest.id,
				isOwner: false,
				name: "Fresh",
				retireSeatId: seat!.id
			})
		).rejects.toThrow(BRING)
		expect(await snapshot(t.sessionId)).toBe(frozen2)
		expect(
			(await update(t.guest.id, t.sessionId, { seatName: "Renamed" }))
				.error
		).toBeNull()
		const [row] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, seat!.id))
		expect(row!.seatName).toBe("Renamed")
	})

	test("bring own off: a seat name that would open a seat, sent with other seat changes, writes none of them", async () => {
		const t = await table()
		await setSwitches(t.sessionId, { guestsBringOwn: false })
		const free = await member(t.bookId, "Free")
		await refused(
			t.guest.id,
			t.sessionId,
			{ castMemberIds: [free.id], seatName: "Newcomer" },
			BRING
		)
	})

	test("bring own off: playerSeatChanges remove is refused, a rename is allowed", async () => {
		const t = await table()
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				userId: t.guest.id,
				seatName: "Mine",
				position: 0
			} as any)
			.returning()
		await setSwitches(t.sessionId, off)
		await refused(
			t.guest.id,
			t.sessionId,
			{ playerSeatChanges: [{ playerSeatId: seat!.id, remove: true }] },
			BRING
		)
		expect(
			(
				await update(t.guest.id, t.sessionId, {
					playerSeatChanges: [
						{ playerSeatId: seat!.id, seatName: "Theirs" }
					]
				})
			).error
		).toBeNull()
		const [row] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, seat!.id))
		expect(row!.seatName).toBe("Theirs")
	})

	test("both on: a guest names a seat, renames it and removes it", async () => {
		const t = await table()
		expect(
			(await update(t.guest.id, t.sessionId, { seatName: "Ann" })).error
		).toBeNull()
		const [seat] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, t.sessionId))
		expect(seat!.seatName).toBe("Ann")
		expect(
			(
				await update(t.guest.id, t.sessionId, {
					playerSeatChanges: [
						{ playerSeatId: seat!.id, seatName: "Anna" }
					]
				})
			).error
		).toBeNull()
		expect(
			(
				await update(t.guest.id, t.sessionId, {
					playerSeatChanges: [
						{ playerSeatId: seat!.id, remove: true }
					]
				})
			).error
		).toBeNull()
	})
})

describe("the participants doors", () => {
	test("addPersona: bring own off refuses a guest (a bench-back too), never the owner", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest persona")
		const theirs = await card(t.owner.id, "Owner persona")
		await personaSeat(t.sessionId, mine.id, t.guest.id, 0)
		await testDb
			.update(schema.sessionPersonas)
			.set({ isActive: false })
			.where(eq(schema.sessionPersonas.personaId, mine.id))
		await setSwitches(t.sessionId, off)
		const before = await snapshot(t.sessionId)
		for (const personaId of [mine.id, (await card(t.guest.id, "New")).id]) {
			const res = await door<any>(
				"sessionsAddPersonaHandler",
				t.guest.id,
				{ sessionId: t.sessionId, personaId }
			)
			expect(res).toEqual({ success: false, error: BRING })
		}
		expect(await snapshot(t.sessionId)).toBe(before)
		const owner = await door<any>("sessionsAddPersonaHandler", t.owner.id, {
			sessionId: t.sessionId,
			personaId: theirs.id
		})
		expect(owner.success).toBe(true)
	})

	test("addPersona: with it on a guest adds and brings a benched seat back", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest persona")
		const res = await door<any>("sessionsAddPersonaHandler", t.guest.id, {
			sessionId: t.sessionId,
			personaId: mine.id
		})
		expect(res.success).toBe(true)
		await testDb
			.update(schema.sessionPersonas)
			.set({ isActive: false })
			.where(eq(schema.sessionPersonas.personaId, mine.id))
		const back = await door<any>("sessionsAddPersonaHandler", t.guest.id, {
			sessionId: t.sessionId,
			personaId: mine.id
		})
		expect(back.success).toBe(true)
		const [row] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.personaId, mine.id))
		expect(row!.isActive).toBe(true)
	})

	test("reassignRemovedParticipant: bring own off refuses a guest and changes nothing", async () => {
		const t = await table()
		const old = await card(t.guest.id, "Old")
		const next = await card(t.guest.id, "Next")
		await cardSeat(t.sessionId, old.id, 0)
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.characterId, old.id))
		await setSwitches(t.sessionId, off)
		const before = await snapshot(t.sessionId)
		const res = await door<any>(
			"sessionsReassignRemovedParticipantHandler",
			t.guest.id,
			{
				sessionId: t.sessionId,
				type: "character",
				oldId: old.id,
				newId: next.id
			}
		)
		expect(res).toEqual({ error: BRING })
		expect(await snapshot(t.sessionId)).toBe(before)
	})

	test("setCastSeatEnabled: off refuses a guest's bench and bring-back by kind; a repeated set stays a success; the owner may", async () => {
		const t = await table()
		const mine = await card(t.guest.id, "Guest card")
		const m = await member(t.bookId, "Ada")
		await cardSeat(t.sessionId, mine.id, 0)
		await update(t.guest.id, t.sessionId, { castMemberIds: [m.id] })
		const [named] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				userId: t.guest.id,
				seatName: "Mine",
				position: 3
			} as any)
			.returning()
		await setSwitches(t.sessionId, { guestsBringOwn: false })
		const set = (userId: number, p: Record<string, unknown>) =>
			door<any>("sessionsSetCastSeatEnabledHandler", userId, {
				sessionId: t.sessionId,
				...p
			})

		const before = await snapshot(t.sessionId)
		expect(
			(await set(t.guest.id, { characterId: mine.id, enabled: false }))
				.error
		).toBe(BRING)
		expect(
			(await set(t.guest.id, { playerSeatId: named!.id, enabled: false }))
				.error
		).toBe(BRING)
		expect(await snapshot(t.sessionId)).toBe(before)
		// A repeated set (already in play) is a no-op success.
		expect(
			(await set(t.guest.id, { characterId: mine.id, enabled: true }))
				.error
		).toBeUndefined()
		// Take cast is still on: the cast seat benches and comes back.
		expect(
			(await set(t.guest.id, { castMemberId: m.id, enabled: false }))
				.error
		).toBeUndefined()
		expect(
			(await set(t.guest.id, { castMemberId: m.id, enabled: true })).error
		).toBeUndefined()

		await setSwitches(t.sessionId, off)
		const frozen = await snapshot(t.sessionId)
		const refusedBench = await set(t.guest.id, {
			castMemberId: m.id,
			enabled: false
		})
		expect(refusedBench).toMatchObject({ error: TAKE, enabled: true })
		expect(await snapshot(t.sessionId)).toBe(frozen)
		// The owner benches and brings back, frozen or not.
		expect(
			(await set(t.owner.id, { castMemberId: m.id, enabled: false }))
				.error
		).toBeUndefined()
		// A guest cannot bring it back while frozen.
		const backRefused = await set(t.guest.id, {
			castMemberId: m.id,
			enabled: true
		})
		expect(backRefused).toMatchObject({ error: TAKE, enabled: false })
		expect(
			(await set(t.owner.id, { castMemberId: m.id, enabled: true })).error
		).toBeUndefined()
	})
})

describe("the genre's opt-in, on adds only", () => {
	test("a genre without personas refuses adding one, the owner too; removals still save", async () => {
		const t = await table(GENRES.noPersonas)
		const p = await card(t.owner.id, "Persona")
		const sentence =
			"This session does not fit 'No personas': this genre has no personas — the session has 1."
		await refused(t.owner.id, t.sessionId, { personaIds: [p.id] }, sentence)
		const res = await door<any>("sessionsAddPersonaHandler", t.owner.id, {
			sessionId: t.sessionId,
			personaId: p.id
		})
		expect(res).toEqual({ success: false, error: sentence })

		// A session already outside its shape still saves a removal.
		await personaSeat(t.sessionId, p.id, t.owner.id, 0)
		expect(
			(await update(t.owner.id, t.sessionId, { personaIds: [] })).error
		).toBeNull()
		const [row] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.personaId, p.id))
		expect(row!.removedAt ?? row!.isActive === false).toBeTruthy()
	})

	test("a genre without characters refuses adding one by card or by cast member", async () => {
		const t = await table(GENRES.noCharacters)
		const c = await card(t.owner.id, "Card")
		const sentence =
			"This session does not fit 'No characters': this genre has no characters — the session has 1."
		await refused(
			t.owner.id,
			t.sessionId,
			{ characterIds: [c.id] },
			sentence
		)
		const free = await member(t.bookId, "Free")
		const carded = await member(t.bookId, "Linked", c.id)
		await refused(
			t.owner.id,
			t.sessionId,
			{ castMemberIds: [carded.id] },
			sentence
		)
		// A card-less member is no library character: not counted.
		void free
	})

	test("reassign to a kind the genre lacks is refused, the owner too", async () => {
		const t = await table(GENRES.noPersonas)
		const old = await card(t.owner.id, "Old")
		const next = await card(t.owner.id, "Next")
		await personaSeat(t.sessionId, old.id, t.owner.id, 0)
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.personaId, old.id))
		const before = await snapshot(t.sessionId)
		const res = await door<any>(
			"sessionsReassignRemovedParticipantHandler",
			t.owner.id,
			{
				sessionId: t.sessionId,
				type: "persona",
				oldId: old.id,
				newId: next.id
			}
		)
		expect(res.error).toBe(
			"This session does not fit 'No personas': this genre has no personas — the session has 1."
		)
		expect(await snapshot(t.sessionId)).toBe(before)
	})

	test("reassigning a BENCHED seat is a swap, never re-checked against the shape", async () => {
		const t = await table(GENRES.noPersonas)
		const old = await card(t.owner.id, "Old")
		const next = await card(t.owner.id, "Next")
		await personaSeat(t.sessionId, old.id, t.owner.id, 0)
		await testDb
			.update(schema.sessionPersonas)
			.set({ isActive: false })
			.where(eq(schema.sessionPersonas.personaId, old.id))
		const res = await door<any>(
			"sessionsReassignRemovedParticipantHandler",
			t.owner.id,
			{
				sessionId: t.sessionId,
				type: "persona",
				oldId: old.id,
				newId: next.id
			}
		)
		expect(res.error ?? null).toBeNull()
	})
})
