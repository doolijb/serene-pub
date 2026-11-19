/**
 * 🚧 A seat moved from the AI to a person (owner rulings S2, MV1, MV2,
 * 2026-11-17): the session's owner moves a character seat to a person's
 * Personas group. The seat becomes a player seat of the same card or cast
 * member, the character row stays (soft-removed) so its lines resolve it, and
 * every earlier line keeps its stamp and its kind. Every refusal is a
 * sentence and writes nothing.
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
import { insertLegacyMany } from "$lib/server/messages/store"
import { SEAT_MOVE_REFUSALS as R } from "$lib/server/sessions/seats"
import { SEAT_HANDOVER_REFUSALS as H } from "$lib/server/sessions/guestSeats"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

const GENRES = vi.hoisted(() => ({ noPersonas: "test:genre/no-personas@1" }))

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb, testDbModule } = await import(
		"$lib/server/utils/testDb"
	)
	return {
		...testDbModule(await createTestDb()),
		getCryptoSecretKey: () => "seat-move-person-test-secret"
	}
})
// One genre whose shape has no persona seats; everything else is the real registry.
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
		path.join(os.tmpdir(), "serene-pub-vitest-seatmovetoperson-")
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
	const owner = await user("mp-owner")
	const g1 = await user("mp-g1")
	const g2 = await user("mp-g2")
	const watcher = await user("mp-watcher")
	const outsider = await user("mp-outsider")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			...(genreId ? { genreId } : {})
		} as any)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionGuests).values([
		{ sessionId, userId: g1.id, isPlayer: true },
		{ sessionId, userId: g2.id, isPlayer: true },
		{ sessionId, userId: watcher.id, isPlayer: false }
	])
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Notes ${++n}`, sessionId } as any)
		.returning()
	return { owner, g1, g2, watcher, outsider, sessionId, bookId: book!.id }
}
type T = Awaited<ReturnType<typeof table>>

const memberOf = async (t: T, characterId: number | null, name: string) =>
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

/** A character (AI) seat on a card with its member, or a card-less one. */
async function aiSeat(
	t: T,
	o: {
		cardOwner?: number
		seatedBy: number
		name: string
		cardless?: boolean
		isActive?: boolean
		position?: number
	}
) {
	const c = o.cardless ? null : await card(o.cardOwner ?? t.owner.id, o.name)
	const member = await memberOf(t, c?.id ?? null, o.name)
	const [seat] = await testDb
		.insert(schema.sessionCharacters)
		.values({
			sessionId: t.sessionId,
			characterId: c?.id ?? null,
			castMemberId: member.id,
			seatedByUserId: o.seatedBy,
			isActive: o.isActive ?? true,
			position: o.position ?? ++n
		} as any)
		.returning()
	return { card: c, member, seat: seat! }
}

const aiLine = async (t: T, s: Awaited<ReturnType<typeof aiSeat>>, speaker?: string) =>
	(
		await insertLegacyMany(testDb, [
			{
				sessionId: t.sessionId,
				userId: t.owner.id,
				characterId: s.card?.id ?? null,
				personaId: null,
				role: "assistant",
				content: "The AI speaks.",
				metadata: { speaker: speaker ?? `seated-member:${s.member.id}` }
			} as any
		])
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

const refOf = async (seatId: number, castMemberId: number, cardId: number | null) =>
	(await import("$lib/server/pipelines/prompt/seatCards")).hostSeatRefOf({
		kind: "character",
		seatId,
		castMemberId,
		cardId
	})!

async function orderAndTally(t: T, aiRef: string, headRef: string) {
	const { writeTurnOrder } = await import("$lib/server/sessions/turnOrder")
	const { EMPTY_TURN_ORDER } = await import("@serene-pub/sdk")
	await writeTurnOrder(testDb as any, t.sessionId, {
		...EMPTY_TURN_ORDER,
		order: [
			{ ref: headRef as any, via: "pick" },
			{ ref: aiRef as any, via: "pick" }
		],
		candidates: [
			{ ref: headRef, kind: "character", name: "Head", position: 0 },
			{ ref: aiRef, kind: "character", name: "AI", position: 1 }
		] as any,
		basedOnAt: 5_000
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
	const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
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
const toPerson = (
	userId: number,
	t: T,
	characterSeatId: number,
	toUserId: number
) => update(userId, t.sessionId, { seatMoves: [{ characterSeatId, toUserId }] })
const toAi = (userId: number, t: T, playerSeatId: number) =>
	update(userId, t.sessionId, { seatMoves: [{ playerSeatId }] })

async function refused(
	userId: number,
	t: T,
	characterSeatId: number,
	toUserId: number,
	sentence: string | RegExp
) {
	const before = await snapshot(t.sessionId)
	const { error } = await toPerson(userId, t, characterSeatId, toUserId)
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
const playerSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(asc(schema.sessionPersonas.id))
const charRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.id, id))
	)[0]!
const linesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
const liveCharSeats = async (t: T) =>
	(await charSeats(t.sessionId)).filter((r) => r.removedAt == null)
const livePlayerSeats = async (t: T) =>
	(await playerSeats(t.sessionId)).filter((r) => r.removedAt == null)
const valueOwners = async (t: T) =>
	(
		await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, t.sessionId))
	).map((v) => `${v.ownerKind}:${v.ownerId}`)

describe("the owner moves a character seat to a person", () => {
	test("1. the owner's card, AI seat to a guest: one live player seat, the AI seat removed, values and order follow, the line and its blocks stay", async () => {
		const t = await table()
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: t.sessionId,
			personaId: (await card(t.g2.id, "Other")).id,
			userId: t.g2.id,
			position: 4
		})
		const s = await aiSeat(t, {
			seatedBy: t.owner.id,
			name: "Keeper",
			isActive: false
		})
		await valueOf(t, "seated_member", s.member.id)
		const line = await aiLine(t, s)
		const mirror = [line]
		await testDb.insert(schema.messageParts).values({
			messageId: mirror[0]!.id,
			type: "core:blocks",
			data: {
				blocks: [
					{
						kind: "choices",
						addressee: `seated-member:${s.member.id}`,
						actions: []
					}
				]
			}
		})
		const blocksBefore = JSON.stringify(
			await testDb
				.select()
				.from(schema.messageParts)
				.where(eq(schema.messageParts.messageId, mirror[0]!.id))
		)
		const ref = await refOf(s.seat.id, s.member.id, s.card!.id)
		await orderAndTally(t, ref, "character:999")
		const linesBefore = JSON.stringify(await linesOf(t.sessionId))

		const { error } = await toPerson(t.owner.id, t, s.seat.id, t.g1.id)
		expect(error).toBeNull()

		const live = (await livePlayerSeats(t)).filter(
			(r) => r.personaId === s.card!.id
		)
		expect(live).toHaveLength(1)
		expect(live[0]!.userId).toBe(t.g1.id)
		expect(live[0]!.isActive).toBe(false)
		expect(live[0]!.position).toBe(5)
		expect(live[0]!.castMemberId).toBe(s.member.id)

		const gone = await charRow(s.seat.id)
		expect(gone.removedAt).not.toBeNull()
		expect(gone.removedName).toBe("Keeper")
		expect(await liveCharSeats(t)).toHaveLength(0)

		expect(await valueOwners(t)).toEqual([`player_seat:${live[0]!.id}`])
		expect(JSON.stringify(await linesOf(t.sessionId))).toBe(linesBefore)
		expect(
			JSON.parse(JSON.stringify((await linesOf(t.sessionId))[0]!.metadata))
		).toEqual({ speaker: `seated-member:${s.member.id}` })
		expect(line.id).toBeGreaterThan(0)
		expect(
			JSON.stringify(
				await testDb
					.select()
					.from(schema.messageParts)
					.where(eq(schema.messageParts.messageId, mirror[0]!.id))
			)
		).toBe(blocksBefore)

		const after = await stored(t.sessionId)
		expect(JSON.stringify(after.order)).not.toContain(ref)
		expect(JSON.stringify(after.order)).toContain("character:999")
	})

	test("2. afterwards the guest speaks as the card, the owner does not; an earlier AI line stays the owner's; its stamp finds the departed seat; knowledge reads as before", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Mira" })
		const line = await aiLine(t, s)
		const { maySpeakAsCard, seatOf } = await import(
			"$lib/server/sessions/seats"
		)
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		const { loadEntryKnowledge } = await import(
			"$lib/server/lorebooks/entryKnowledge"
		)
		// A marked entry the member is kept from.
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: t.bookId,
				typeId: "core:entry/world-lore",
				typeVersion: 1,
				position: ++n,
				fields: {},
				notCommonKnowledge: true
			} as never)
			.returning()
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: t.bookId,
			fromNodeId: s.member.id,
			toEntryId: entry!.id,
			relationshipType: "kept from",
			knowledgeKind: "kept_from",
			status: "active"
		} as never)
		const stamp = `seated-member:${s.member.id}`
		const knowledgeBefore = JSON.stringify(
			await loadEntryKnowledge(testDb as any, {
				sessionId: t.sessionId,
				speaker: stamp
			})
		)
		expect(knowledgeBefore).toContain(String(entry!.id))
		expect(await canActOnMessage(testDb as any, line.id, t.owner.id)).toBe(true)
		expect(await canActOnMessage(testDb as any, line.id, t.g1.id)).toBe(false)

		expect((await toPerson(t.owner.id, t, s.seat.id, t.g1.id)).error).toBeNull()

		const may = (userId: number) =>
			maySpeakAsCard(testDb as any, {
				sessionId: t.sessionId,
				cardId: s.card!.id,
				userId
			})
		expect(await may(t.g1.id)).toBe(true)
		expect(await may(t.owner.id)).toBe(false)
		expect(await canActOnMessage(testDb as any, line.id, t.g1.id)).toBe(false)
		expect(await canActOnMessage(testDb as any, line.id, t.owner.id)).toBe(true)
		const found = await seatOf(testDb as any, t.sessionId, stamp, {
			kind: "character"
		})
		expect(found?.kind).toBe("character")
		expect(found?.seatId).toBe(s.seat.id)
		expect(
			JSON.stringify(
				await loadEntryKnowledge(testDb as any, {
					sessionId: t.sessionId,
					speaker: stamp
				})
			)
		).toBe(knowledgeBefore)
	})

	test("3. a card-less member to the owner: a card-less player seat; a departed one of the member a guest held is revived for the owner", async () => {
		const t = await table()
		const s = await aiSeat(t, {
			seatedBy: t.owner.id,
			name: "Wren",
			cardless: true
		})
		const [departed] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: null,
				castMemberId: s.member.id,
				userId: t.g1.id,
				removedAt: new Date(),
				position: 0
			} as any)
			.returning()
		const { error } = await toPerson(t.owner.id, t, s.seat.id, t.owner.id)
		expect(error).toBeNull()
		const rows = (await playerSeats(t.sessionId)).filter(
			(r) => r.castMemberId === s.member.id
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.id).toBe(departed!.id)
		expect(rows[0]!.removedAt).toBeNull()
		expect(rows[0]!.personaId).toBeNull()
		expect(rows[0]!.userId).toBe(t.owner.id)
		expect((await charRow(s.seat.id)).removedAt).not.toBeNull()
	})

	test("3b. a card-less member with no earlier seat: a new card-less player seat for the person", async () => {
		const t = await table()
		const s = await aiSeat(t, {
			seatedBy: t.owner.id,
			name: "Fresh",
			cardless: true
		})
		expect((await toPerson(t.owner.id, t, s.seat.id, t.g2.id)).error).toBeNull()
		const live = await livePlayerSeats(t)
		expect(live).toHaveLength(1)
		expect(live[0]!.personaId).toBeNull()
		expect(live[0]!.castMemberId).toBe(s.member.id)
		expect(live[0]!.userId).toBe(t.g2.id)
	})

	test("4. a guest's own card goes back to that guest; to another guest or the owner it is refused", async () => {
		const t = await table()
		const s = await aiSeat(t, {
			cardOwner: t.g1.id,
			seatedBy: t.g1.id,
			name: "Guestcard"
		})
		const notYours = /^Guestcard is not your card, so it can't be seated for someone else\.$/
		await refused(t.owner.id, t, s.seat.id, t.g2.id, notYours)
		await refused(t.owner.id, t, s.seat.id, t.owner.id, notYours)
		expect((await toPerson(t.owner.id, t, s.seat.id, t.g1.id)).error).toBeNull()
		const live = await livePlayerSeats(t)
		expect(live).toHaveLength(1)
		expect(live[0]!.userId).toBe(t.g1.id)
	})
})

describe("there and back", () => {
	test("5a. player to AI to player revives the first player row; a value keeps its owner; the line keeps its stamp and editor", async () => {
		const t = await table()
		const c = await card(t.g1.id, "Round")
		const member = await memberOf(t, c.id, "Round")
		const [seat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: c.id,
				castMemberId: member.id,
				userId: t.g1.id,
				position: 0
			} as any)
			.returning()
		const X = seat!.id
		await valueOf(t, "player_seat", X)
		const [lineRow] = await insertLegacyMany(testDb, [
			{
				sessionId: t.sessionId,
				userId: t.g1.id,
				characterId: null,
				personaId: c.id,
				role: "user",
				content: "Mine.",
				metadata: { speaker: `player-seat:${X}` }
			} as any
		])
		const linesBefore = JSON.stringify(await linesOf(t.sessionId))

		expect((await toAi(t.owner.id, t, X)).error).toBeNull()
		const ai = (await liveCharSeats(t))[0]!
		expect((await toPerson(t.owner.id, t, ai.id, t.g1.id)).error).toBeNull()

		const players = await playerSeats(t.sessionId)
		expect(players).toHaveLength(1)
		expect(players[0]!.id).toBe(X)
		expect(players[0]!.removedAt).toBeNull()
		expect(players[0]!.userId).toBe(t.g1.id)
		expect(await charSeats(t.sessionId)).toHaveLength(1)
		expect(await valueOwners(t)).toEqual([`player_seat:${X}`])
		expect(JSON.stringify(await linesOf(t.sessionId))).toBe(linesBefore)
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		expect(await canActOnMessage(testDb as any, lineRow!.id, t.g1.id)).toBe(true)
		expect(await canActOnMessage(testDb as any, lineRow!.id, t.owner.id)).toBe(
			false
		)
	})

	test("5b. AI to player to AI revives the first character row; a value keeps its owner; the AI line keeps its stamp and editor", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Back" })
		await valueOf(t, "seated_member", s.member.id)
		const line = await aiLine(t, s)
		const linesBefore = JSON.stringify(await linesOf(t.sessionId))

		expect((await toPerson(t.owner.id, t, s.seat.id, t.g1.id)).error).toBeNull()
		const P = (await livePlayerSeats(t))[0]!
		expect((await toAi(t.owner.id, t, P.id)).error).toBeNull()

		const seats = await charSeats(t.sessionId)
		expect(seats).toHaveLength(1)
		expect(seats[0]!.id).toBe(s.seat.id)
		expect(seats[0]!.removedAt).toBeNull()
		expect(await playerSeats(t.sessionId)).toHaveLength(1)
		expect((await livePlayerSeats(t)).length).toBe(0)
		expect(await valueOwners(t)).toEqual([`seated_member:${s.member.id}`])
		expect(JSON.stringify(await linesOf(t.sessionId))).toBe(linesBefore)
		const { canActOnMessage } = await import("$lib/server/messages/permissions")
		expect(await canActOnMessage(testDb as any, line.id, t.owner.id)).toBe(true)
		expect(await canActOnMessage(testDb as any, line.id, t.g1.id)).toBe(false)
	})
})

describe("refusals write nothing", () => {
	test("a guest asks", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Asked" })
		await refused(t.g1.id, t, s.seat.id, t.g1.id, R.ownerOnlyToPerson)
	})

	test("an unknown seat, a removed seat and an envoy seat", async () => {
		const t = await table()
		await refused(t.owner.id, t, 999_999, t.g1.id, R.seatGone)
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Left" })
		await testDb
			.update(schema.sessionCharacters)
			.set({ removedAt: new Date() })
			.where(eq(schema.sessionCharacters.id, s.seat.id))
		await refused(t.owner.id, t, s.seat.id, t.g1.id, R.seatGone)
		const [envoy] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: t.sessionId,
				characterId: null,
				castMemberId: null,
				envoySlug: "test:envoy"
			} as any)
			.returning()
		await refused(t.owner.id, t, envoy!.id, t.g1.id, R.seatGone)
	})

	test("a character seat with no cast member", async () => {
		const t = await table()
		const c = await card(t.owner.id, "Memberless")
		const [seat] = await testDb
			.insert(schema.sessionCharacters)
			.values({
				sessionId: t.sessionId,
				characterId: c.id,
				seatedByUserId: t.owner.id,
				position: 0
			} as any)
			.returning()
		await refused(t.owner.id, t, seat!.id, t.g1.id, R.noMember)
	})

	test("a person who is not in the session, and a watcher", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Away" })
		await refused(t.owner.id, t, s.seat.id, t.outsider.id, H.notInSession)
		await refused(
			t.owner.id,
			t,
			s.seat.id,
			t.watcher.id,
			/ is watching this session, so they can't be given a seat\.$/
		)
	})

	test("a live player seat already on the card or the member (K-2), in play and benched", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Twice" })
		const [pseat] = await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId: t.sessionId,
				personaId: s.card!.id,
				castMemberId: s.member.id,
				userId: t.g2.id,
				position: 0
			} as any)
			.returning()
		await refused(t.owner.id, t, s.seat.id, t.g1.id, R.alreadyPerson("Twice"))
		await testDb
			.update(schema.sessionPersonas)
			.set({ isActive: false })
			.where(eq(schema.sessionPersonas.id, pseat!.id))
		await refused(t.owner.id, t, s.seat.id, t.g1.id, R.alreadyPerson("Twice"))

		const u = await aiSeat(t, {
			seatedBy: t.owner.id,
			name: "Cardless twice",
			cardless: true
		})
		await testDb.insert(schema.sessionPersonas).values({
			sessionId: t.sessionId,
			personaId: null,
			castMemberId: u.member.id,
			userId: t.g2.id,
			position: 1
		} as any)
		await refused(
			t.owner.id,
			t,
			u.seat.id,
			t.g1.id,
			R.alreadyPerson("Cardless twice")
		)
	})

	test("a genre whose shape has no persona seats", async () => {
		const t = await table(GENRES.noPersonas)
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Shaped" })
		await refused(
			t.owner.id,
			t,
			s.seat.id,
			t.g1.id,
			/^This session does not fit 'No personas': this genre has no personas/
		)
	})

	test("the seat holds the turn", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Next" })
		const ref = await refOf(s.seat.id, s.member.id, s.card!.id)
		await orderAndTally(t, "character:999", ref)
		await refused(t.owner.id, t, s.seat.id, t.g1.id, R.holdsTurn("Next"))
	})

	test("a counted run is in progress", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Busy" })
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		const runId = `seat-move-person-run-${++n}`
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
			await refused(t.owner.id, t, s.seat.id, t.g1.id, sentence!)
		} finally {
			reg.finish(runId)
		}
	})
})

describe("what stays as it was", () => {
	test("7. a second boot changes nothing for the moved session", async () => {
		const t = await table()
		const s = await aiSeat(t, { seatedBy: t.owner.id, name: "Boot" })
		await valueOf(t, "seated_member", s.member.id)
		await aiLine(t, s)
		expect((await toPerson(t.owner.id, t, s.seat.id, t.g1.id)).error).toBeNull()
		const before = await snapshot(t.sessionId)
		const { seatKeys } = await import("$lib/server/sessions/seatKeys")
		const { seatMembers } = await import("$lib/server/sessions/seatMembers")
		await seatKeys(testDb as any)
		await seatMembers(testDb as any)
		expect(await snapshot(t.sessionId)).toBe(before)
	})
})

describe("the door: a move and the lists of the same save", () => {
	async function carded(t: T) {
		return aiSeat(t, { seatedBy: t.owner.id, name: `Door ${++n}` })
	}
	const settled = async (t: T) => {
		expect(await liveCharSeats(t)).toHaveLength(0)
		expect(await livePlayerSeats(t)).toHaveLength(1)
	}

	test("8a. characterIds listing the moved card, or omitting it", async () => {
		for (const list of ["listed", "omitted"] as const) {
			const t = await table()
			const s = await carded(t)
			const { error } = await update(t.owner.id, t.sessionId, {
				seatMoves: [{ characterSeatId: s.seat.id, toUserId: t.g1.id }],
				characterIds: list === "listed" ? [s.card!.id] : []
			})
			expect(error, list).toBeNull()
			await settled(t)
		}
	})

	test("8b. castMemberIds listing the moved member (carded and card-less), or omitting it", async () => {
		for (const list of ["listed", "omitted"] as const) {
			for (const cardless of [false, true]) {
				const t = await table()
				const s = await aiSeat(t, {
					seatedBy: t.owner.id,
					name: `Member ${++n}`,
					cardless
				})
				const { error } = await update(t.owner.id, t.sessionId, {
					seatMoves: [{ characterSeatId: s.seat.id, toUserId: t.g1.id }],
					castMemberIds: list === "listed" ? [s.member.id] : []
				})
				expect(error, `${list} ${cardless}`).toBeNull()
				await settled(t)
			}
		}
	})

	test("8c. personaIds listing the moved card, or omitting it: the new player seat stays", async () => {
		for (const list of ["listed", "omitted"] as const) {
			const t = await table()
			const s = await carded(t)
			const { error } = await update(t.owner.id, t.sessionId, {
				seatMoves: [{ characterSeatId: s.seat.id, toUserId: t.g1.id }],
				personaIds: list === "listed" ? [s.card!.id] : []
			})
			expect(error, list).toBeNull()
			await settled(t)
			expect((await livePlayerSeats(t))[0]!.userId).toBe(t.g1.id)
		}
	})

	test("8d. characterIds and personaIds both listing the card", async () => {
		const t = await table()
		const s = await carded(t)
		const { error } = await update(t.owner.id, t.sessionId, {
			seatMoves: [{ characterSeatId: s.seat.id, toUserId: t.g1.id }],
			characterIds: [s.card!.id],
			personaIds: [s.card!.id]
		})
		expect(error).toBeNull()
		await settled(t)
	})
})

describe("readers", () => {
	test("9. pick-sprite after a card-less member moved to a person: the old AI speaker resolves to the member", async () => {
		const t = await table()
		const s = await aiSeat(t, {
			seatedBy: t.owner.id,
			name: "Sprite",
			cardless: true
		})
		expect((await toPerson(t.owner.id, t, s.seat.id, t.g1.id)).error).toBeNull()
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const calls: Array<Record<string, unknown>> = []
		const ctx = {
			call: async (payload: Record<string, unknown>) => {
				calls.push(payload)
				return { choices: null }
			},
			log: () => {}
		}
		await (coreBindings() as any)["core:oracle/pick-sprite@1"](
			{
				scope: { sessionId: t.sessionId },
				speaker: `seated-member:${s.member.id}`,
				text: "Hello.",
				params: {}
			},
			ctx
		)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toEqual(expect.objectContaining({ castMemberId: s.member.id }))
		expect("characterId" in calls[0]!).toBe(false)
	})

	test("10. a form addressed to the member's AI ref after the move (portrayals), reported as found", async () => {
		const t = await table()
		const s = await aiSeat(t, {
			seatedBy: t.owner.id,
			name: "Asked",
			cardless: true
		})
		expect((await toPerson(t.owner.id, t, s.seat.id, t.g1.id)).error).toBeNull()
		const { resolvePortrayals } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const P = (await livePlayerSeats(t))[0]!
		const got = await resolvePortrayals(testDb as any, {
			sessionId: t.sessionId,
			runOwnerUserId: t.owner.id,
			refs: [`seated-member:${s.member.id}`] as any
		})
		const portrayal = (got as any)[`seated-member:${s.member.id}`]
		expect(portrayal).toEqual({ by: "person", userId: String(t.g1.id) })
		expect(P.userId).toBe(t.g1.id)
	})
})
