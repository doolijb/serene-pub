/**
 * 🚧 A seat moved from a person to the AI (owner rulings S2, MV1, MV2,
 * 2026-11-17): the session's owner moves a player seat to the AI-played group.
 * The seat becomes a character seat of the same card or cast member, the
 * player row stays (soft-removed) so its lines resolve it, and every earlier
 * line keeps its stamp and its kind. Every refusal is a sentence and writes
 * nothing.
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
import { SEAT_MOVE_REFUSALS as R } from "$lib/server/sessions/seats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

const GENRES = vi.hoisted(() => ({ noCharacters: "test:genre/no-characters@1" }))

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "seat-move-test-secret"
	}
})
// One genre whose shape has no character seats; everything else is the real registry.
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
				id === GENRES.noCharacters
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
		path.join(os.tmpdir(), "serene-pub-vitest-seatmove-")
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

async function table(genreId?: string) {
	const owner = await user("mv-owner")
	const g1 = await user("mv-g1")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			...(genreId ? { genreId } : {})
		} as any)
		.returning()
	const sessionId = session!.id
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: g1.id, isPlayer: true })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Notes ${++n}`, sessionId } as any)
		.returning()
	return { owner, g1, sessionId, bookId: book!.id }
}
type T = Awaited<ReturnType<typeof table>>

const memberOf = async (
	t: T,
	characterId: number | null,
	name: string
) =>
	(
		await insertCastMember(
			testDb as any,
			{
				lorebookId: t.bookId,
				characterId,
				binding: `{{char:${++n}}}`,
				name
			} as any
		)
	).member

/** A player seat on a card, with its linked member unless `withMember` is false. */
async function cardedSeat(
	t: T,
	o: {
		cardOwner: number
		person: number
		name: string
		withMember?: boolean
		isActive?: boolean
	}
) {
	const c = await card(o.cardOwner, o.name)
	const member =
		o.withMember === false ? null : await memberOf(t, c.id, o.name)
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: t.sessionId,
			personaId: c.id,
			castMemberId: member?.id ?? null,
			userId: o.person,
			isActive: o.isActive ?? true,
			position: ++n
		} as any)
		.returning()
	return { card: c, member, seat: seat! }
}

const line = async (
	t: T,
	o: { personaId: number; userId: number; speaker?: string }
) =>
	(
		await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: t.sessionId,
				role: "user",
				content: "I speak.",
				personaId: o.personaId,
				userId: o.userId,
				...(o.speaker ? { metadata: { speaker: o.speaker } } : {})
			} as any)
			.returning()
	)[0]!

async function valueOf(t: T, ownerKind: string, ownerId: number) {
	await testDb.insert(schema.attributeValues).values({
		sessionId: t.sessionId,
		ownerKind,
		ownerId,
		slotId: "core:slot/hp@1",
		value: { v: ownerId },
		updatedBy: "user:1"
	})
}

const sheetsInit = async () =>
	testDb
		.insert(schema.attributeSheets)
		.values({ id: "test:sheet/wounds@1" })
		.onConflictDoNothing()

async function orderAndTally(t: T, X: number, headRef = "character:1") {
	const { writeTurnOrder } = await import("$lib/server/sessions/turnOrder")
	const { writeTurnTally } = await import(
		"$lib/server/pipelines/routines/turnTally"
	)
	const { EMPTY_TURN_ORDER } = await import("@serene-pub/sdk")
	await writeTurnOrder(testDb as any, t.sessionId, {
		...EMPTY_TURN_ORDER,
		order: [
			{ ref: headRef as any, via: "pick" },
			{ ref: `player-seat:${X}`, via: "pick" }
		],
		candidates: [
			{ ref: headRef, kind: "character", name: "Head", position: 0 },
			{ ref: `player-seat:${X}`, kind: "persona", name: "X", position: 1 }
		] as any,
		basedOnAt: 5_000
	})
	await writeTurnTally(testDb as any, t.sessionId, {
		v: 1,
		lanes: {
			main: {
				turn: 1,
				lastMessageId: 0,
				lastSpeaker: "narrator",
				turnsBy: {},
				spoke: [],
				persons: [`player-seat:${X}`, "character:9"]
			}
		}
	})
}

const stored = async (sessionId: number) =>
	(
		await testDb
			.select({
				order: schema.sessions.turnOrder,
				tally: schema.sessions.turnTally
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!

/** Seats, values, sheets, lines, order and tally, as a refusal must leave them. */
async function snapshot(sessionId: number) {
	const sel = async (table: any, col: any) =>
		testDb.select().from(table).where(eq(col, sessionId)).orderBy(asc(table.id))
	return JSON.stringify({
		cs: await sel(schema.sessionCharacters, schema.sessionCharacters.sessionId),
		ps: await sel(schema.sessionPersonas, schema.sessionPersonas.sessionId),
		values: await sel(schema.attributeValues, schema.attributeValues.sessionId),
		sheets: await sel(schema.ownerSheets, schema.ownerSheets.sessionId),
		lines: await sel(schema.sessionMessages, schema.sessionMessages.sessionId),
		stored: await stored(sessionId)
	})
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
const move = (userId: number, t: T, ...seatIds: number[]) =>
	update(userId, t.sessionId, {
		seatMoves: seatIds.map((playerSeatId) => ({ playerSeatId }))
	})

async function refused(
	userId: number,
	t: T,
	seatIds: number[],
	sentence: string | RegExp
) {
	const before = await snapshot(t.sessionId)
	const { error } = await move(userId, t, ...seatIds)
	if (typeof sentence === "string") expect(error).toBe(sentence)
	else expect(error).toMatch(sentence)
	expect(await snapshot(t.sessionId)).toBe(before)
}

const charSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.id))
const playerRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, id))
	)[0]!
const linesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

describe("the owner moves a player seat to the AI", () => {
	test("1. a guest's persona: one AI seat for the card, seated by the guest, bench and position kept; lines and values follow", async () => {
		const t = await table()
		const npc = await card(t.owner.id, "Keeper")
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: t.sessionId, characterId: npc.id, position: 3 })
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Elara",
			isActive: false
		})
		const X = s.seat.id
		await valueOf(t, "player_seat", X)
		await line(t, {
			personaId: s.card.id,
			userId: t.g1.id,
			speaker: `player-seat:${X}`
		})
		const linesBefore = JSON.stringify(await linesOf(t.sessionId))

		const { error } = await move(t.owner.id, t, X)
		expect(error).toBeNull()

		const mine = (await charSeats(t.sessionId)).filter(
			(r) => r.characterId === s.card.id
		)
		expect(mine).toHaveLength(1)
		expect(mine[0]!.removedAt).toBeNull()
		expect(mine[0]!.seatedByUserId).toBe(t.g1.id)
		expect(mine[0]!.isActive).toBe(false)
		expect(mine[0]!.position).toBe(4)
		expect(mine[0]!.castMemberId).toBe(s.member!.id)

		const gone = await playerRow(X)
		expect(gone.removedAt).not.toBeNull()
		expect(gone.removedName).toBe("Elara")

		const values = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, t.sessionId))
		expect(values.map((v) => `${v.ownerKind}:${v.ownerId}`)).toEqual([
			`seated_member:${s.member!.id}`
		])
		expect(JSON.stringify(await linesOf(t.sessionId))).toBe(linesBefore)
	})

	test("2. after it: nobody speaks as the card, the guest's old lines stay theirs, order and tally drop the seat, the pool lists the AI seat", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Mira"
		})
		const X = s.seat.id
		await orderAndTally(t, X)
		const stamped = await line(t, {
			personaId: s.card.id,
			userId: t.g1.id,
			speaker: `player-seat:${X}`
		})
		const plain = await line(t, { personaId: s.card.id, userId: t.g1.id })
		const { maySpeakAsCard } = await import("$lib/server/sessions/seats")
		expect(
			await maySpeakAsCard(testDb as any, {
				sessionId: t.sessionId,
				cardId: s.card.id,
				userId: t.g1.id
			})
		).toBe(true)

		const { error } = await move(t.owner.id, t, X)
		expect(error).toBeNull()

		for (const userId of [t.g1.id, t.owner.id])
			expect(
				await maySpeakAsCard(testDb as any, {
					sessionId: t.sessionId,
					cardId: s.card.id,
					userId
				})
			).toBe(false)

		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		for (const m of [stamped, plain]) {
			expect(await canActOnMessage(testDb as any, m.id, t.g1.id)).toBe(true)
			expect(await canActOnMessage(testDb as any, m.id, t.owner.id)).toBe(
				false
			)
		}

		const after = await stored(t.sessionId)
		expect(JSON.stringify(after.order)).not.toContain(`player-seat:${X}`)
		expect(JSON.stringify(after.tally)).not.toContain(`player-seat:${X}`)
		expect(JSON.stringify(after.tally)).toContain("character:9")

		const { readSessionCast } = await import(
			"$lib/server/pipelines/runtime/host.read.sessionCast"
		)
		const cast = await readSessionCast(
			{
				db: testDb,
				scope: { sessionId: t.sessionId },
				node: undefined,
				q: { sessionId: t.sessionId }
			} as any,
			async () => null,
			async () => null
		)
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const pooled = await (coreBindings() as any)["core:task/turn-pool@1"]({
			cast,
			messages: []
		})
		expect(pooled.value.main.map((c: any) => c.ref)).toContain(
			`seated-member:${s.member!.id}`
		)
	})

	test("3. the owner's card in a guest's seat: seated by the owner; the guest's stamped and unstamped lines stay the guest's", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.owner.id,
			person: t.g1.id,
			name: "Ownercard"
		})
		const X = s.seat.id
		const stamped = await line(t, {
			personaId: s.card.id,
			userId: t.g1.id,
			speaker: `player-seat:${X}`
		})
		const plain = await line(t, { personaId: s.card.id, userId: t.g1.id })

		const { error } = await move(t.owner.id, t, X)
		expect(error).toBeNull()

		const mine = (await charSeats(t.sessionId)).filter(
			(r) => r.characterId === s.card.id
		)
		expect(mine).toHaveLength(1)
		expect(mine[0]!.seatedByUserId).toBe(t.owner.id)
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		for (const m of [stamped, plain]) {
			expect(await canActOnMessage(testDb as any, m.id, t.g1.id)).toBe(true)
			expect(await canActOnMessage(testDb as any, m.id, t.owner.id)).toBe(
				false
			)
		}
	})

	test("4. a card-less member a guest plays: a card-less AI seat seated by the owner", async () => {
		const t = await table()
		const m = await memberOf(t, null, "Wren")
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				castMemberId: m.id,
				userId: t.g1.id,
				position: 0
			} as any)
			.returning()
		const { error } = await move(t.owner.id, t, seat!.id)
		expect(error).toBeNull()
		const mine = (await charSeats(t.sessionId)).filter(
			(r) => r.castMemberId === m.id
		)
		expect(mine).toHaveLength(1)
		expect(mine[0]!.characterId).toBeNull()
		expect(mine[0]!.seatedByUserId).toBe(t.owner.id)
		expect((await playerRow(seat!.id)).removedAt).not.toBeNull()
	})

	test("5. the owner's own persona: seated by the owner, a seat with no member yet mints one", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.owner.id,
			person: t.owner.id,
			name: "Mine",
			withMember: false
		})
		const { error } = await move(t.owner.id, t, s.seat.id)
		expect(error).toBeNull()
		const mine = (await charSeats(t.sessionId)).filter(
			(r) => r.characterId === s.card.id
		)
		expect(mine).toHaveLength(1)
		expect(mine[0]!.seatedByUserId).toBe(t.owner.id)
		expect(mine[0]!.castMemberId).not.toBeNull()
	})

	test("6. a departed AI seat of the member is revived: same row, one row, the moved seat's sheet wins", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Revived"
		})
		const [departed] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: t.sessionId,
				characterId: s.card.id,
				castMemberId: s.member!.id,
				removedAt: new Date(),
				position: 9
			})
			.returning()
		await sheetsInit()
		await testDb.insert(schema.ownerSheets).values([
			{
				sessionId: t.sessionId,
				ownerKind: "seated_member",
				ownerId: s.member!.id,
				sheetId: "test:sheet/wounds@1",
				position: 9
			},
			{
				sessionId: t.sessionId,
				ownerKind: "player_seat",
				ownerId: s.seat.id,
				sheetId: "test:sheet/wounds@1",
				position: 2
			}
		])

		const { error } = await move(t.owner.id, t, s.seat.id)
		expect(error).toBeNull()

		const rows = (await charSeats(t.sessionId)).filter(
			(r) => r.characterId === s.card.id
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.id).toBe(departed!.id)
		expect(rows[0]!.removedAt).toBeNull()
		expect(rows[0]!.seatedByUserId).toBe(t.g1.id)
		const sheets = await testDb
			.select()
			.from(schema.ownerSheets)
			.where(eq(schema.ownerSheets.sessionId, t.sessionId))
		expect(sheets).toHaveLength(1)
		expect(sheets[0]!.ownerKind).toBe("seated_member")
		expect(sheets[0]!.ownerId).toBe(s.member!.id)
		expect(sheets[0]!.position).toBe(2)
	})
})

describe("refusals write nothing", () => {
	test("a guest asks", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Guestcard"
		})
		await refused(t.g1.id, t, [s.seat.id], R.ownerOnly)
	})

	test("an unknown seat and a removed seat", async () => {
		const t = await table()
		await refused(t.owner.id, t, [999_999], R.seatGone)
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Left"
		})
		await testDb
			.update(schema.sessionPersonas)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionPersonas.id, s.seat.id))
		await refused(t.owner.id, t, [s.seat.id], R.seatGone)
	})

	test("a player seat with neither member nor card", async () => {
		const t = await table()
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				castMemberId: null,
				seatName: "Nobody",
				userId: t.g1.id,
				position: 0
			} as any)
			.returning()
		await refused(t.owner.id, t, [seat!.id], R.noCast)
	})

	test("a live AI seat already on the card (K-2), and a benched one", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Twice"
		})
		const [ai] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: t.sessionId,
				characterId: s.card.id,
				castMemberId: s.member!.id,
				position: 0
			})
			.returning()
		await refused(t.owner.id, t, [s.seat.id], R.alreadyAi("Twice"))
		await testDb
			.update(schema.sessionCharacters)
			.set({ isActive: false })
			.where(eq(schema.sessionCharacters.id, ai!.id))
		await refused(t.owner.id, t, [s.seat.id], R.alreadyAi("Twice"))
	})

	test("a genre whose shape has no character seats", async () => {
		const t = await table(GENRES.noCharacters)
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Shaped"
		})
		await refused(
			t.owner.id,
			t,
			[s.seat.id],
			/^This session does not fit 'No characters': this genre has no characters/
		)
	})

	test("the seat holds the turn", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Next"
		})
		await orderAndTally(t, s.seat.id, `player-seat:${s.seat.id}`)
		await refused(t.owner.id, t, [s.seat.id], R.holdsTurn("Next"))
	})

	test("a counted run is in progress", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Busy"
		})
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		const runId = `seat-move-run-${++n}`
		reg.start({
			runId,
			userId: t.owner.id,
			sessionId: t.sessionId,
			kind: "reply",
			name: "Wren"
		})
		try {
			const { quietRefusal } = await import(
				"$lib/server/pipelines/runtime/runsInProgress"
			)
			const sentence = await quietRefusal(testDb as any, t.sessionId)
			expect(sentence).toBeTruthy()
			await refused(t.owner.id, t, [s.seat.id], sentence!)
		} finally {
			reg.finish(runId)
		}
	})
})

describe("what stays as it was", () => {
	test("8. removing a benched player seat with lines still says it has lines, with a live AI seat on the same card (K-2)", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Lined",
			isActive: false
		})
		await line(t, { personaId: s.card.id, userId: t.g1.id })
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: t.sessionId,
			characterId: s.card.id,
			castMemberId: s.member!.id,
			position: 0
		})
		const { unseat } = await import("$lib/server/sessions/seats")
		await expect(
			unseat(testDb as any, {
				sessionId: t.sessionId,
				kind: "player",
				seatId: s.seat.id,
				removedName: "Lined"
			})
		).rejects.toThrow(/has lines/)
		expect((await playerRow(s.seat.id)).removedAt).toBeNull()
	})

	test("9. a second boot changes nothing for the moved session", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Boot"
		})
		await valueOf(t, "player_seat", s.seat.id)
		await line(t, {
			personaId: s.card.id,
			userId: t.g1.id,
			speaker: `player-seat:${s.seat.id}`
		})
		expect((await move(t.owner.id, t, s.seat.id)).error).toBeNull()
		const before = await snapshot(t.sessionId)
		const { seatKeys } = await import("$lib/server/sessions/seatKeys")
		const { seatMembers } = await import("$lib/server/sessions/seatMembers")
		await seatKeys(testDb as any)
		await seatMembers(testDb as any)
		expect(await snapshot(t.sessionId)).toBe(before)
	})

	test("10. a card with a live player seat and a live AI seat is still spoken by the seat's person (K-2)", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Both"
		})
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: t.sessionId,
			characterId: s.card.id,
			castMemberId: s.member!.id,
			position: 0
		})
		const { maySpeakAsCard } = await import("$lib/server/sessions/seats")
		expect(
			await maySpeakAsCard(testDb as any, {
				sessionId: t.sessionId,
				cardId: s.card.id,
				userId: t.g1.id
			})
		).toBe(true)
	})
})

describe("a move and the persona and character lists of the same or a later save", () => {
	const maySpeak = async (t: T, cardId: number, userId: number) =>
		(await import("$lib/server/sessions/seats")).maySpeakAsCard(testDb as any, {
			sessionId: t.sessionId,
			cardId,
			userId
		})
	const livePlayerSeats = async (t: T, cardId: number) =>
		(
			await testDb
				.select()
				.from(schema.sessionPersonas)
				.where(eq(schema.sessionPersonas.sessionId, t.sessionId))
		).filter((r) => r.personaId === cardId && r.removedAt == null)
	const liveAiSeats = async (t: T, cardId: number) =>
		(await charSeats(t.sessionId)).filter(
			(r) => r.characterId === cardId && r.removedAt == null
		)

	test("11. the card left out of personaIds: the AI seat is in play, not benched", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Left out"
		})
		const { error } = await update(t.owner.id, t.sessionId, {
			seatMoves: [{ playerSeatId: s.seat.id }],
			personaIds: []
		})
		expect(error).toBeNull()
		const ai = await liveAiSeats(t, s.card.id)
		expect(ai).toHaveLength(1)
		expect(ai[0]!.isActive).toBe(true)
		expect(await livePlayerSeats(t, s.card.id)).toHaveLength(0)
	})

	test("12. a benched seat with no lines, card left out of personaIds: moves, no seatGone", async () => {
		const t = await table()
		const s = await cardedSeat(t, {
			cardOwner: t.g1.id,
			person: t.g1.id,
			name: "Benched",
			isActive: false
		})
		const { error } = await update(t.owner.id, t.sessionId, {
			seatMoves: [{ playerSeatId: s.seat.id }],
			personaIds: []
		})
		expect(error).toBeNull()
		expect(await liveAiSeats(t, s.card.id)).toHaveLength(1)
	})

	test("13. the card listed in characterIds, or left out of it: one AI seat, no error", async () => {
		for (const listed of [true, false]) {
			const t = await table()
			const s = await cardedSeat(t, {
				cardOwner: t.g1.id,
				person: t.g1.id,
				name: "Listed"
			})
			const other = await card(t.owner.id, "Other")
			const { error } = await update(t.owner.id, t.sessionId, {
				seatMoves: [{ playerSeatId: s.seat.id }],
				characterIds: listed ? [s.card.id, other.id] : [other.id]
			})
			expect(error).toBeNull()
			expect(await liveAiSeats(t, s.card.id)).toHaveLength(1)
			expect(await liveAiSeats(t, other.id)).toHaveLength(1)
		}
	})

	test("14. a later save whose personaIds still lists the moved card: nothing changes, no error", async () => {
		for (const cardOwnerIsGuest of [false, true]) {
			const t = await table()
			const s = await cardedSeat(t, {
				cardOwner: cardOwnerIsGuest ? t.g1.id : t.owner.id,
				person: cardOwnerIsGuest ? t.g1.id : t.owner.id,
				name: "Stale"
			})
			expect(
				(await update(t.owner.id, t.sessionId, {
					seatMoves: [{ playerSeatId: s.seat.id }]
				})).error
			).toBeNull()
			const before = await snapshot(t.sessionId)
			const { error } = await update(t.owner.id, t.sessionId, {
				personaIds: [s.card.id]
			})
			expect(error).toBeNull()
			expect(await snapshot(t.sessionId)).toBe(before)
			expect(await livePlayerSeats(t, s.card.id)).toHaveLength(0)
		}
	})

	test("15. sessions:addPersona on a card with a character seat still makes the K-2 pair", async () => {
		const t = await table()
		const c = await card(t.owner.id, "Pair")
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: t.sessionId,
			characterId: c.id,
			position: 0
		})
		const { sessionsAddPersonaHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res = await sessionsAddPersonaHandler.handler(
			socket(t.owner.id),
			{ sessionId: t.sessionId, personaId: c.id } as any,
			() => {}
		)
		expect(res).toMatchObject({ success: true })
		expect(await livePlayerSeats(t, c.id)).toHaveLength(1)
		expect(await liveAiSeats(t, c.id)).toHaveLength(1)
		expect(await maySpeak(t, c.id, t.owner.id)).toBe(true)
	})

	test("16. maySpeakAsCard: a card that only ever had a character seat is still its owner's", async () => {
		const t = await table()
		const c = await card(t.g1.id, "Only AI")
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: t.sessionId,
			characterId: c.id,
			position: 0
		})
		expect(await maySpeak(t, c.id, t.g1.id)).toBe(true)
		expect(await maySpeak(t, c.id, t.owner.id)).toBe(false)
	})
})
