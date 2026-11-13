/**
 * Benched seats at the socket doors (owner 2026-11-10): `sessions:setCastSeatEnabled`
 * benches and brings back through `setSeatBench` (one `cast-changed` enabled per
 * move, none on a repeat); `sessions:removeGuest` benches the guest's player seats
 * and leaves everyone else's; `sessions:reassignRemovedParticipant` takes a benched
 * seat as well as a removed one, and says the old member left.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import { sessionEvents } from "@serene-pub/sdk"
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
		getCryptoSecretKey: () => "benched-seats-test-secret"
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
		path.join(os.tmpdir(), "serene-pub-vitest-benchedSeats-sockets-")
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

const recorder = () => {
	const emitted: { event: string; data: any }[] = []
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
	return createTestUser(testDb, `benched-seats-owner-${++n}`)
}

async function ownBook(userId: number) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` } as any)
		.returning()
	return book!
}

/** A card with its member in the book. */
async function carded(userId: number, lorebookId: number, name: string) {
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "" })
		.returning()
	const { member } = await insertCastMember(
		testDb as any,
		{
			lorebookId,
			characterId: card!.id,
			binding: `{{char:${++n}}}`,
			name,
			ownName: name
		} as any
	)
	return { card: card!, member }
}

async function cardless(lorebookId: number, name: string) {
	const { member } = await insertCastMember(
		testDb as any,
		{
			lorebookId,
			characterId: null,
			binding: `{{char:${++n}}}`,
			name
		} as any
	)
	return member
}

async function make(userId: number, lorebookId: number) {
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emit } = recorder()
	const res = (await sessionsCreateHandler.handler(
		socket(userId),
		{
			characterIds: [],
			personaIds: [],
			characterPositions: {},
			session: { name: "S", lorebookId }
		} as any,
		emit
	)) as any
	return res.session.id as number
}

async function update(userId: number, body: Record<string, unknown>) {
	const { sessionsUpdateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emit } = recorder()
	await sessionsUpdateHandler.handler(socket(userId), body as any, emit)
}

/** What a door did to the ledger of a session: the member and cast events it fired. */
async function fired(sessionId: number, door: () => Promise<unknown>) {
	const ledger = async () => {
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
		return testDb
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
			.orderBy(asc(schema.sessionChanges.id))
	}
	const before = new Set((await ledger()).map((c) => c.id))
	await door()
	const rows = (await ledger()).filter((c) => !before.has(c.id))
	return {
		members: rows
			.filter(
				(c) =>
					c.event === sessionEvents.memberAdded ||
					c.event === sessionEvents.memberRemoved
			)
			.map((c) => {
				const p = c.payload as { ref: string; change: string }
				return `${c.event}:${p.ref}`
			}),
		enabled: rows
			.filter(
				(c) =>
					c.event === sessionEvents.castChanged &&
					(c.payload as { change?: string }).change === "enabled"
			)
			.map((c) => {
				const p = c.payload as { ref: string; value: boolean }
				return `${p.ref}:${p.value}`
			}),
		positions: rows.filter(
			(c) =>
				c.event === sessionEvents.castChanged &&
				(c.payload as { change?: string }).change === "position"
		)
	}
}

const added = (ref: string) => [`${sessionEvents.memberAdded}:${ref}`]
const removed = (ref: string) => [`${sessionEvents.memberRemoved}:${ref}`]

const playerSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.id))

/** The `cast-changed` `enabled` events a door fired: `ref:value`. */
async function enabledBy(sessionId: number, door: () => Promise<unknown>) {
	const r = await fired(sessionId, door)
	return r.enabled
}

/** The member events a door fired, in order. */
async function membersBy(sessionId: number, door: () => Promise<unknown>) {
	return (await fired(sessionId, door)).members
}

async function press(
	userId: number,
	sessionId: number,
	key: { characterId?: number; castMemberId?: number; playerSeatId?: number },
	enabled: boolean
) {
	const { sessionsSetCastSeatEnabledHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const { emit } = recorder()
	return (await sessionsSetCastSeatEnabledHandler.handler(
		socket(userId),
		{ sessionId, enabled, ...key } as any,
		emit
	)) as any
}

const characterSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.id))

describe("sessions:setCastSeatEnabled through the bench", () => {
	test("benches and brings back: the row moves, one cast-changed each, a repeat writes nothing", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const a = await carded(u.id, b.id, "Ada")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [a.card.id]
		})
		const ref = `seated-member:${a.member.id}`
		const key = { characterId: a.card.id }

		expect(
			await enabledBy(sessionId, () => press(u.id, sessionId, key, false))
		).toEqual([`${ref}:false`])
		expect((await characterSeats(sessionId))[0]).toMatchObject({
			isActive: false,
			removedAt: null
		})

		const repeat = await press(u.id, sessionId, key, false)
		expect(repeat.error).toBeUndefined()
		expect(
			await enabledBy(sessionId, () => press(u.id, sessionId, key, false))
		).toEqual([])

		expect(
			await enabledBy(sessionId, () => press(u.id, sessionId, key, true))
		).toEqual([`${ref}:true`])
		expect((await characterSeats(sessionId))[0]).toMatchObject({
			isActive: true,
			removedAt: null
		})
	})
})

describe("sessions:removeGuest benches the guest's player seats", () => {
	test("a card-less and a carded player seat are benched and announced; the owner's and another guest's are left", async () => {
		const o = await owner()
		const g = await owner()
		const other = await owner()
		const b = await ownBook(o.id)
		const sessionId = await make(o.id, b.id)
		for (const who of [g, other])
			await testDb
				.insert(schema.sessionGuests)
				.values({ sessionId, userId: who.id, isPlayer: true })
		const [guestCard] = await testDb
			.insert(schema.characters)
			.values({ userId: g.id, name: "Gus card", description: "" })
			.returning()
		const seat = async (extra: Record<string, unknown>) =>
			(
				await testDb
					.insert(schema.sessionPersonas)
					.values({ sessionId, ...extra } as any)
					.returning()
			)[0]!
		const guestCardless = await seat({ userId: g.id, seatName: "Gus" })
		// A carded seat from before seats knew their player: no user, the card's owner is the guest.
		const guestCarded = await seat({ personaId: guestCard!.id })
		const ownersSeat = await seat({ userId: o.id, seatName: "Olive" })
		const othersSeat = await seat({ userId: other.id, seatName: "Otto" })

		const { sessionsRemoveGuestHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const announced = await enabledBy(sessionId, async () => {
			const { emit } = recorder()
			return sessionsRemoveGuestHandler.handler(
				socket(o.id),
				{ sessionId, guestUserId: g.id } as any,
				emit
			)
		})
		expect([...announced].sort()).toEqual(
			[
				`player-seat:${guestCardless.id}:false`,
				`player-seat:${guestCarded.id}:false`
			].sort()
		)
		const rows = new Map(
			(await playerSeats(sessionId)).map((r) => [r.id, r])
		)
		for (const gone of [guestCardless, guestCarded])
			expect(rows.get(gone.id)).toMatchObject({
				isActive: false,
				removedAt: null
			})
		for (const kept of [ownersSeat, othersSeat])
			expect(rows.get(kept.id)).toMatchObject({
				isActive: true,
				removedAt: null
			})
	})
})

describe("sessions:reassignRemovedParticipant takes a benched seat", () => {
	test("a benched carded character seat: history re-pointed, old row gone, new seat live, member-removed for the old", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const a = await carded(u.id, b.id, "Ada")
		const c = await carded(u.id, b.id, "Cy")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			characterIds: [a.card.id]
		})
		const [line] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				role: "assistant",
				content: "Hello",
				characterId: a.card.id
			})
			.returning()
		await press(u.id, sessionId, { characterId: a.card.id }, false)
		expect((await characterSeats(sessionId))[0]).toMatchObject({
			isActive: false,
			removedAt: null
		})

		const { sessionsReassignRemovedParticipantHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const members = await membersBy(sessionId, async () => {
			const { emit } = recorder()
			const res =
				(await sessionsReassignRemovedParticipantHandler.handler(
					socket(u.id),
					{
						sessionId,
						type: "character",
						oldId: a.card.id,
						newId: c.card.id
					} as any,
					emit
				)) as any
			expect(res.error).toBeUndefined()
		})
		expect([...members].sort()).toEqual(
			[
				...added(`seated-member:${c.member.id}`),
				...removed(`seated-member:${a.member.id}`)
			].sort()
		)
		const seats = await characterSeats(sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]).toMatchObject({
			characterId: c.card.id,
			isActive: true,
			removedAt: null
		})
		const [moved] = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, line!.id))
		expect(moved!.characterId).toBe(c.card.id)
	})

	test("a benched player seat: history re-pointed, old row gone, new seat live, member-removed for the old", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const p = await carded(u.id, b.id, "Pia")
		const q = await carded(u.id, b.id, "Quin")
		const sessionId = await make(u.id, b.id)
		await update(u.id, {
			session: { id: sessionId },
			personaIds: [p.card.id]
		})
		const [oldSeat] = await playerSeats(sessionId)
		const [line] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				role: "user",
				content: "Hi",
				personaId: p.card.id
			})
			.returning()
		const { setSeatBench } = await import("$lib/server/sessions/seats")
		const benched = await testDb.transaction(async (tx) =>
			setSeatBench(tx as any, {
				sessionId,
				kind: "player",
				seatId: oldSeat!.id,
				benched: true
			})
		)
		expect(benched.ok).toBe(true)

		const { sessionsReassignRemovedParticipantHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const members = await membersBy(sessionId, async () => {
			const { emit } = recorder()
			const res =
				(await sessionsReassignRemovedParticipantHandler.handler(
					socket(u.id),
					{
						sessionId,
						type: "persona",
						oldId: p.card.id,
						newId: q.card.id
					} as any,
					emit
				)) as any
			expect(res.error).toBeUndefined()
		})
		const seats = await playerSeats(sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]).toMatchObject({
			personaId: q.card.id,
			isActive: true,
			removedAt: null
		})
		expect(seats[0]!.id).not.toBe(oldSeat!.id)
		expect(members).toContain(
			`${sessionEvents.memberRemoved}:player-seat:${oldSeat!.id}`
		)
		expect(members).toContain(
			`${sessionEvents.memberAdded}:player-seat:${seats[0]!.id}`
		)
		const [moved] = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, line!.id))
		expect(moved!.personaId).toBe(q.card.id)
	})
})

describe("sessions:setCastSeatEnabled on a player seat", () => {
	const seatOf = async (
		sessionId: number,
		extra: Record<string, unknown>
	) =>
		(
			await testDb
				.insert(schema.sessionPersonas)
				.values({ sessionId, ...extra } as any)
				.returning()
		)[0]!

	test("benches and brings back a carded and a card-less seat; a repeat writes nothing", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Pia", description: "", isPersona: true })
			.returning()
		const carded = await seatOf(sessionId, { personaId: card!.id, userId: u.id })
		const bare = await seatOf(sessionId, { userId: u.id, seatName: "Bare" })

		for (const seat of [carded, bare]) {
			const off = await press(u.id, sessionId, { playerSeatId: seat.id }, false)
			expect(off).toMatchObject({
				sessionId,
				playerSeatId: seat.id,
				enabled: false
			})
			expect(off.error).toBeUndefined()
			const row = (await playerSeats(sessionId)).find((r) => r.id === seat.id)
			expect(row).toMatchObject({ isActive: false, removedAt: null })
			expect(
				await enabledBy(sessionId, () =>
					press(u.id, sessionId, { playerSeatId: seat.id }, false)
				)
			).toEqual([])
			const on = await press(u.id, sessionId, { playerSeatId: seat.id }, true)
			expect(on.error).toBeUndefined()
			expect(
				(await playerSeats(sessionId)).find((r) => r.id === seat.id)
			).toMatchObject({ isActive: true })
		}
	})

	test("refuses a seat in another session, a guest on someone else's seat, and two names", async () => {
		const o = await owner()
		const g = await owner()
		const b = await ownBook(o.id)
		const sessionId = await make(o.id, b.id)
		const otherSession = await make(o.id, b.id)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId, userId: g.id, isPlayer: true })
		const mine = await seatOf(sessionId, { userId: o.id, seatName: "Olive" })
		const theirs = await seatOf(sessionId, { userId: g.id, seatName: "Gus" })

		const wrong = await press(o.id, otherSession, { playerSeatId: mine.id }, false)
		expect(wrong.error).toBe("That seat is not in this session.")

		const denied = await press(g.id, sessionId, { playerSeatId: mine.id }, false)
		expect(denied.error).toBe(
			"Only the session owner or this seat's player can change this."
		)
		expect(
			(await playerSeats(sessionId)).find((r) => r.id === mine.id)
		).toMatchObject({ isActive: true })

		// The seat's own player may.
		const ok = await press(g.id, sessionId, { playerSeatId: theirs.id }, false)
		expect(ok.error).toBeUndefined()

		const two = await press(
			o.id,
			sessionId,
			{ playerSeatId: mine.id, characterId: 1 },
			false
		)
		expect(two.error).toBe(
			"Name one seat: a character, a cast member or a player seat."
		)
	})
})

describe("sessions:addPersona brings a benched persona back", () => {
	test("the same row is in play again; a seat in play still refuses", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: u.id, name: "Pax", description: "", isPersona: true })
			.returning()
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId,
				personaId: card!.id,
				userId: u.id,
				isActive: false
			} as any)
			.returning()
		const { sessionsAddPersonaHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const add = async () => {
			const { emit } = recorder()
			return (await sessionsAddPersonaHandler.handler(
				socket(u.id),
				{ sessionId, personaId: card!.id } as any,
				emit
			)) as any
		}
		const back = await add()
		expect(back).toMatchObject({ success: true })
		const rows = await playerSeats(sessionId)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({ id: seat!.id, isActive: true })

		const again = await add()
		expect(again).toMatchObject({
			success: false,
			error: "This persona is already in the session."
		})
		expect(await playerSeats(sessionId)).toHaveLength(1)
	})
})

describe("sessions:get seat facts on benched seats", () => {
	async function getSession(userId: number, sessionId: number) {
		const { sessionsGetHandler } = await import("$lib/server/sockets/sessions")
		const { emit } = recorder()
		const res = (await sessionsGetHandler.handler(
			socket(userId),
			{ id: sessionId } as any,
			emit
		)) as any
		return res.session as {
			sessionCharacters: any[]
			sessionPersonas: any[]
		}
	}
	const seatOf = async (
		sessionId: number,
		a: Awaited<ReturnType<typeof carded>>,
		isActive: boolean
	) => {
		const [seat] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId,
				characterId: a.card.id,
				castMemberId: a.member.id,
				isActive
			} as any)
			.returning()
		return seat!
	}
	const rowOf = (rows: any[], id: number) => rows.find((r) => r.id === id)

	test("a seat in play carries neither field; a benched seat with no lines says so", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const live = await seatOf(sessionId, await carded(u.id, b.id, "Liv"), true)
		const benched = await seatOf(sessionId, await carded(u.id, b.id, "Ben"), false)
		const { sessionCharacters } = await getSession(u.id, sessionId)
		const liveRow = rowOf(sessionCharacters, live.id)
		expect("hasLines" in liveRow).toBe(false)
		expect("fellInStory" in liveRow).toBe(false)
		const row = rowOf(sessionCharacters, benched.id)
		expect(row.hasLines).toBe(false)
		expect(row.fellInStory).toBe(false)
	})

	test("a benched seat with a line has lines", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const a = await carded(u.id, b.id, "Lin")
		const seat = await seatOf(sessionId, a, false)
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as any, {
			sessionId,
			role: "assistant",
			characterId: a.card.id,
			content: "Hello."
		} as any)
		const { sessionCharacters } = await getSession(u.id, sessionId)
		expect(rowOf(sessionCharacters, seat.id).hasLines).toBe(true)
	})

	test("a standing bench imprint to=true: fell in the story; a newer one back to false: not", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const seat = await seatOf(sessionId, await carded(u.id, b.id, "Fal"), false)
		const { insertLegacy } = await import("$lib/server/messages/store")
		const { fileSessionImprint, seatBenchKey } = await import("$lib/server/sessions/sessionImprints")
		const turn = await insertLegacy(testDb as any, {
			sessionId,
			role: "assistant",
			content: "Fell."
		} as any)
		const file = (from: boolean, to: boolean) =>
			fileSessionImprint(
				testDb as any,
				{ sessionId, messageId: turn.id, runId: null },
				{ kind: "seat-bench", key: seatBenchKey("character", seat.id) },
				from,
				to
			)
		await file(false, true)
		expect(
			rowOf((await getSession(u.id, sessionId)).sessionCharacters, seat.id).fellInStory
		).toBe(true)
		// A newer standing row that brings the seat back: it did not fall.
		await file(true, false)
		const { sessionCharacters } = await getSession(u.id, sessionId)
		expect(rowOf(sessionCharacters, seat.id).fellInStory).toBe(false)
	})

	test("a deceased member's seat: fell in the story", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const a = await carded(u.id, b.id, "Dec")
		const seat = await seatOf(sessionId, a, false)
		const { writeCastVersion } = await import("$lib/server/characters/versions")
		const { insertLegacy } = await import("$lib/server/messages/store")
		const turn = await insertLegacy(testDb as any, {
			sessionId,
			role: "user",
			content: "A turn."
		} as any)
		await writeCastVersion(testDb as any, {
			member: a.member.id,
			changes: { nodeState: "deceased" },
			writtenBy: "test",
			session: { id: sessionId, messageId: turn.id, ownAnchor: true }
		})
		const { sessionCharacters } = await getSession(u.id, sessionId)
		expect(rowOf(sessionCharacters, seat.id).fellInStory).toBe(true)
	})

	test("a benched card-less player seat followed by a newer live one of the same user fell", async () => {
		const u = await owner()
		const b = await ownBook(u.id)
		const sessionId = await make(u.id, b.id)
		const [old] = await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId, userId: u.id, isActive: false } as any)
			.returning()
		const [newer] = await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId, userId: u.id, isActive: true } as any)
			.returning()
		const { sessionPersonas } = await getSession(u.id, sessionId)
		const oldRow = rowOf(sessionPersonas, old!.id)
		expect(oldRow.fellInStory).toBe(true)
		expect(oldRow.hasLines).toBe(false)
		expect("fellInStory" in rowOf(sessionPersonas, newer!.id)).toBe(false)
	})
})
