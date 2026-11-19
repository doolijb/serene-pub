/**
 * 🚧 Seat handovers (owner rulings S1, S2, S4, 2026-11-17): the owner gives a
 * saved seat to another person of the session; a guest takes, and hands back,
 * a card-less character seat no person plays. Every refusal is a sentence and
 * writes nothing; a taken seat is rewritten in place, never a second row.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { GUEST_SEAT_SENTENCES } from "$lib/shared/sessions/guestSeats"
import { SEAT_HANDOVER_REFUSALS as R } from "$lib/server/sessions/guestSeats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "seat-handover-test-secret"
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

let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-seathandover-")
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

const TAKE = GUEST_SEAT_SENTENCES.takeCastOff

const memberRow = async (lorebookId: number, name: string) =>
	(
		await insertCastMember(
			testDb as any,
			{
				lorebookId,
				characterId: null,
				binding: `{{char:${++n}}}`,
				name
			} as any
		)
	).member

async function table() {
	const owner = await user("sh-owner")
	const g1 = await user("sh-g1")
	const g2 = await user("sh-g2")
	const w = await user("sh-w")
	const outsider = await user("sh-out")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true } as any)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: g1.id, isPlayer: true },
		{ sessionId, userId: g2.id, isPlayer: true },
		{ sessionId, userId: w.id, isPlayer: false }
	])
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Notes ${++n}`, sessionId } as any)
		.returning()
	return { owner, g1, g2, w, outsider, sessionId, bookId: book!.id }
}

/** A card-less character seat of a fresh member, seated by `by`. */
async function memberSeat(
	t: { sessionId: number; bookId: number },
	name: string,
	by: number | null,
	isActive = true
) {
	const m = await memberRow(t.bookId, name)
	const [seat] = await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: t.sessionId,
			castMemberId: m.id,
			seatedByUserId: by,
			isActive,
			position: ++n
		} as any)
		.returning()
	return { member: m, seat: seat! }
}

const seater = async (seatId: number) =>
	(
		await testDb
			.select({ by: schema.sessionCharacters.seatedByUserId })
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.id, seatId))
	)[0]!.by
const playerOf = async (seatId: number) =>
	(
		await testDb
			.select({ u: schema.sessionPersonas.userId })
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, seatId))
	)[0]!.u

async function takeList(userId: number, sessionId: number) {
	const res = await door<any>("sessionsCastToTakeHandler", userId, {
		sessionId
	})
	return res.members.map((m: any) => m.name) as string[]
}

describe("the owner hands over", () => {
	test("a card-less character seat: G1, G2, back to the owner, one row throughout", async () => {
		const t = await table()
		const { seat } = await memberSeat(t, "Mira", t.owner.id)
		for (const to of [t.g1.id, t.g2.id, t.owner.id]) {
			const { error } = await update(t.owner.id, t.sessionId, {
				seatHandovers: [
					{ castMemberId: seat.castMemberId!, toUserId: to }
				]
			})
			expect(error).toBeNull()
			expect(await seater(seat.id)).toBe(to)
		}
		const rows = await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, t.sessionId))
		expect(rows).toHaveLength(1)
	})

	test("the owner's own carded character seat goes to G1", async () => {
		const t = await table()
		const c = await card(t.owner.id, "Ownercard")
		const [seat] = await cardSeat(t.sessionId, c.id).returning()
		await testDb
			.update(schema.sessionCharacters)
			.set({ seatedByUserId: t.owner.id })
			.where(eq(schema.sessionCharacters.id, seat!.id))
		const { error } = await update(t.owner.id, t.sessionId, {
			seatHandovers: [{ characterId: c.id, toUserId: t.g1.id }]
		})
		expect(error).toBeNull()
		expect(await seater(seat!.id)).toBe(t.g1.id)
	})

	test("a benched card-less seat goes to G1, with both guest switches off", async () => {
		const t = await table()
		await setSwitches(t.sessionId, off)
		const { seat } = await memberSeat(t, "Benchy", t.owner.id, false)
		const { error } = await update(t.owner.id, t.sessionId, {
			seatHandovers: [
				{ castMemberId: seat.castMemberId!, toUserId: t.g1.id }
			]
		})
		expect(error).toBeNull()
		expect(await seater(seat.id)).toBe(t.g1.id)
	})

	test("a card-less player seat goes to G1 (user_id) and back", async () => {
		const t = await table()
		const [ps] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				userId: t.owner.id,
				seatName: "Named",
				position: 0
			} as any)
			.returning()
		for (const to of [t.g1.id, t.owner.id]) {
			const { error } = await update(t.owner.id, t.sessionId, {
				seatHandovers: [{ playerSeatId: ps!.id, toUserId: to }]
			})
			expect(error).toBeNull()
			expect(await playerOf(ps!.id)).toBe(to)
		}
	})

	test("refusals say why and write nothing, not even a seat change sent in the same save", async () => {
		const t = await table()
		const { seat } = await memberSeat(t, "Mira", t.owner.id)
		const g1card = await card(t.g1.id, "G1card")
		await cardSeat(t.sessionId, g1card.id)
		// A guest's own persona: its seat never goes to another person (S2). The
		// owner's own card may be handed over (PS1, `sessions.ownerCardForGuest`).
		const g1Persona = await card(t.g1.id, "G1persona")
		const [carded] = await personaSeat(
			t.sessionId,
			g1Persona.id,
			t.g1.id
		).returning()
		const gone = await memberSeat(t, "Gone", t.owner.id)
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.id, gone.seat.id))
		const extra = await memberRow(t.bookId, "Extra")
		const add = { castMemberIds: [seat.castMemberId!, extra.id] }
		const m = seat.castMemberId!
		const cases: [Record<string, unknown>, string][] = [
			[
				{
					seatHandovers: [
						{ characterId: g1card.id, toUserId: t.g2.id }
					]
				},
				R.notYourCard("G1card")
			],
			[
				{
					seatHandovers: [
						{ characterId: g1card.id, toUserId: t.owner.id }
					]
				},
				R.notYourCard("G1card")
			],
			[
				{
					seatHandovers: [
						{ playerSeatId: carded!.id, toUserId: t.g2.id }
					]
				},
				R.cardedPlayerSeat("G1persona")
			],
			[
				{
					seatHandovers: [
						{ castMemberId: m, toUserId: t.outsider.id }
					]
				},
				R.notInSession
			],
			[
				{ seatHandovers: [{ castMemberId: m, toUserId: t.w.id }] },
				R.watcher(t.w.username)
			],
			[
				{
					seatHandovers: [
						{ castMemberId: gone.member.id, toUserId: t.g1.id }
					]
				},
				R.seatGone
			],
			[
				{
					seatHandovers: [
						{
							castMemberId: m,
							playerSeatId: carded!.id,
							toUserId: t.g1.id
						}
					]
				},
				R.oneSeat
			],
			[{ seatHandovers: [{ toUserId: t.g1.id }] }, R.oneSeat]
		]
		for (const [body, sentence] of cases)
			await refused(
				t.owner.id,
				t.sessionId,
				{ ...add, ...body },
				sentence
			)
		expect(await seater(seat.id)).toBe(t.owner.id)
	})
})

describe("a guest takes and hands back", () => {
	test("take an in-play seat the owner seated, in place; hand it back", async () => {
		const t = await table()
		const { seat } = await memberSeat(t, "Mira", t.owner.id)
		const m = seat.castMemberId!
		let r = await update(t.g1.id, t.sessionId, {
			seatHandovers: [{ castMemberId: m, toUserId: t.g1.id }]
		})
		expect(r.error).toBeNull()
		expect(await seater(seat.id)).toBe(t.g1.id)
		expect(
			await testDb
				.select()
				.from(schema.sessionCharacters)
				.where(eq(schema.sessionCharacters.sessionId, t.sessionId))
		).toHaveLength(1)
		r = await update(t.g1.id, t.sessionId, {
			seatHandovers: [{ castMemberId: m, toUserId: t.owner.id }]
		})
		expect(r.error).toBeNull()
		expect(await seater(seat.id)).toBe(t.owner.id)
	})

	test("refusals say why and write nothing", async () => {
		const t = await table()
		const mine = await memberSeat(t, "Mira", t.owner.id)
		const benched = await memberSeat(t, "Benchy", t.owner.id, false)
		const theirs = await memberSeat(t, "Other", t.g2.id)
		const c = await card(t.owner.id, "Ownercard")
		await cardSeat(t.sessionId, c.id)
		const [ps] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				userId: t.owner.id,
				seatName: "Named",
				position: 0
			} as any)
			.returning()
		const take = (m: number) => ({
			seatHandovers: [{ castMemberId: m, toUserId: t.g1.id }]
		})
		await refused(
			t.g1.id,
			t.sessionId,
			take(benched.member.id),
			GUEST_SEAT_SENTENCES.memberHeld("Benchy")
		)
		await refused(
			t.g1.id,
			t.sessionId,
			take(theirs.member.id),
			GUEST_SEAT_SENTENCES.memberHeld("Other")
		)
		await refused(
			t.g1.id,
			t.sessionId,
			{
				seatHandovers: [
					{ castMemberId: theirs.member.id, toUserId: t.owner.id }
				]
			},
			R.ownerOnly
		)
		await refused(
			t.g1.id,
			t.sessionId,
			{
				seatHandovers: [
					{ castMemberId: mine.member.id, toUserId: t.g2.id }
				]
			},
			R.ownerOnly
		)
		await refused(
			t.g1.id,
			t.sessionId,
			{ seatHandovers: [{ characterId: c.id, toUserId: t.g1.id }] },
			R.ownerOnly
		)
		await refused(
			t.g1.id,
			t.sessionId,
			{ seatHandovers: [{ playerSeatId: ps!.id, toUserId: t.g1.id }] },
			R.ownerOnly
		)
		await setSwitches(t.sessionId, { guestsTakeCast: false })
		await refused(t.g1.id, t.sessionId, take(mine.member.id), TAKE)
		expect(await seater(mine.seat.id)).toBe(t.owner.id)
	})
})

describe("a seat that changes between the check and the write", () => {
	async function checked(
		t: { sessionId: number },
		callerId: number,
		castMemberId: number
	) {
		const { resolveSeatHandovers } = await import(
			"$lib/server/sessions/guestSeats"
		)
		const res = await resolveSeatHandovers(testDb as any, {
			sessionId: t.sessionId,
			callerId,
			isOwner: false,
			handovers: [{ castMemberId, toUserId: callerId }]
		})
		if (!res.ok) throw new Error(res.refusal)
		return res.writes
	}
	async function write(sessionId: number, writes: any[]) {
		const { writeSeatHandovers } = await import(
			"$lib/server/sessions/guestSeats"
		)
		return testDb.transaction((tx: any) =>
			writeSeatHandovers(tx, sessionId, writes)
		)
	}

	test("two guests take the same seat: the second is refused, the first keeps it", async () => {
		const t = await table()
		const { seat } = await memberSeat(t, "Mira", t.owner.id)
		const m = seat.castMemberId!
		const first = await checked(t, t.g1.id, m)
		const second = await checked(t, t.g2.id, m)
		await write(t.sessionId, first)
		await expect(write(t.sessionId, second)).rejects.toThrow(
			GUEST_SEAT_SENTENCES.memberHeld("Mira")
		)
		expect(await seater(seat.id)).toBe(t.g1.id)
	})

	test("a seat benched after the check is refused", async () => {
		const t = await table()
		const { seat } = await memberSeat(t, "Mira", t.owner.id)
		const writes = await checked(t, t.g1.id, seat.castMemberId!)
		await testDb
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(eq(schema.sessionCharacters.id, seat.id))
		await expect(write(t.sessionId, writes)).rejects.toThrow(
			GUEST_SEAT_SENTENCES.memberHeld("Mira")
		)
		expect(await seater(seat.id)).toBe(t.owner.id)
	})

	test("a seat removed after the check says it is gone", async () => {
		const t = await table()
		const { seat } = await memberSeat(t, "Mira", t.owner.id)
		const writes = await checked(t, t.g1.id, seat.castMemberId!)
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.id, seat.id))
		await expect(write(t.sessionId, writes)).rejects.toThrow(R.seatGone)
	})
})

describe("removing a guest", () => {
	test("a member they took goes back to the owner and is offered again; their own card stays", async () => {
		const t = await table()
		const { seat } = await memberSeat(t, "Mira", t.owner.id)
		const own = await card(t.g1.id, "Gilcard")
		const [ownSeat] = await cardSeat(t.sessionId, own.id).returning()
		await testDb
			.update(schema.sessionCharacters)
			.set({ seatedByUserId: t.g1.id })
			.where(eq(schema.sessionCharacters.id, ownSeat!.id))
		expect(
			(
				await update(t.g1.id, t.sessionId, {
					seatHandovers: [
						{ castMemberId: seat.castMemberId!, toUserId: t.g1.id }
					]
				})
			).error
		).toBeNull()
		expect(await takeList(t.g2.id, t.sessionId)).toEqual([])
		const res = await door<any>("sessionsRemoveGuestHandler", t.owner.id, {
			sessionId: t.sessionId,
			guestUserId: t.g1.id
		})
		expect(res.success).toBe(true)
		expect(await seater(seat.id)).toBe(t.owner.id)
		expect(await seater(ownSeat!.id)).toBe(t.g1.id)
		expect(await takeList(t.g2.id, t.sessionId)).toEqual(["Mira"])
	})
})

describe("the take list", () => {
	test("lists unseated and owner-seated in-play card-less members only", async () => {
		const t = await table()
		await memberSeat(t, "OwnerSeated", t.owner.id)
		await memberSeat(t, "G1Seated", t.g1.id)
		await memberSeat(t, "G2Seated", t.g2.id)
		await memberSeat(t, "Benched", t.owner.id, false)
		const playerHeld = await memberRow(t.bookId, "PlayerHeld")
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: t.sessionId,
			personaId: null,
			userId: t.owner.id,
			seatName: "PlayerHeld",
			castMemberId: playerHeld.id,
			position: 0
		} as any)
		await memberRow(t.bookId, "Unseated")
		const carded = await card(t.owner.id, "Carded")
		await insertCastMember(
			testDb as any,
			{
				lorebookId: t.bookId,
				characterId: carded.id,
				binding: `{{char:${++n}}}`,
				name: "Carded"
			} as any
		)
		expect(await takeList(t.g1.id, t.sessionId)).toEqual([
			"OwnerSeated",
			"Unseated"
		])
	})
})

describe("the payload", () => {
	test("sessions:get shows the new seater, to the owner and to a guest", async () => {
		const t = await table()
		const c = await card(t.owner.id, "Ownercard")
		const [seat] = await cardSeat(t.sessionId, c.id).returning()
		await testDb
			.update(schema.sessionCharacters)
			.set({ seatedByUserId: t.owner.id })
			.where(eq(schema.sessionCharacters.id, seat!.id))
		const { error } = await update(t.owner.id, t.sessionId, {
			seatHandovers: [{ characterId: c.id, toUserId: t.g1.id }]
		})
		expect(error).toBeNull()
		for (const asker of [t.owner.id, t.g1.id]) {
			const res = await door<any>("sessionsGetHandler", asker, {
				id: t.sessionId
			})
			expect(res.session.sessionCharacters[0].seatedByUserId).toBe(
				t.g1.id
			)
		}
	})
})
