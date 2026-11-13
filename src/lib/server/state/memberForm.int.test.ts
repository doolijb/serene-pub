/**
 * 🚧 ⏳ S4 wave 1: the state core takes member form (plan §34.1) — behind
 * `memberFormSwitch`, which these tests turn on and always turn back off.
 * Off, nothing here changes behaviour (the other state suites say so).
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-memberForm-")
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

afterEach(() => {
	memberFormSwitch.on = false
})

const GRIT = "test:slot/member-form-grit@1"
const GRIT_KEY = "member-form-grit"
const grit = defineAttributeSlot(GRIT, {
	type: "integer",
	label: { en: "Grit" },
	descriptor: "How much is left in the tank.",
	appliesTo: ["cast"],
	config: { min: 0, max: 20 },
	default: 10
})

let n = 0
const db = () => testDb as unknown as Db

async function user(label: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `member-form-${label}-${++n}`))!
}

async function card(userId: number, name: string) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: "…" } as any)
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${++n}` })
		.returning()
	return row!
}

async function member(
	lorebookId: number,
	characterId: number | null,
	extra: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
) {
	return (
		await insertCastMember(testDb, {
			lorebookId,
			binding: `{{char:${++n}}}`,
			characterId,
			name: "",
			...extra
		})
	).member!
}

async function session(userId: number, lorebookId: number) {
	const genreId = `test:genre/member-form-${++n}`
	genreKeeping(genreId, {
		name: { en: "Member form" },
		family: "test",
		slots: [grit],
		events: {}
	})
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: `Run ${n}`,
			genreId,
			lorebookId
		})
		.returning()
	return row!
}

const seatCharacter = async (
	sessionId: number,
	characterId: number,
	castMemberId: number | null,
	position = 0
) =>
	(
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId, castMemberId, position })
			.returning()
	)[0]!

const seatPlayer = async (
	sessionId: number,
	userId: number,
	personaId: number | null,
	castMemberId: number | null,
	position = 5
) =>
	(
		await testDb
			.insert(schema.sessionPersonas)
			.values({
				sessionId,
				userId,
				personaId,
				castMemberId,
				position,
				...(personaId == null ? { seatName: "Drifter" } : {})
			} as any)
			.returning()
	)[0]!

const rowsOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, sessionId),
				eq(schema.attributeValues.slotId, GRIT)
			)
		)

function fakeSocket(userId: number) {
	return {
		user: { id: userId },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
async function set(
	userId: number,
	sessionId: number,
	owner: unknown,
	value: number
) {
	const { stateSet } = await import("$lib/server/sockets/state")
	const errors: string[] = []
	const emit = (event: string, data: any) => {
		if (event.endsWith(":error")) errors.push(data.error)
	}
	const outcome = await stateSet
		.handler(
			fakeSocket(userId),
			{ sessionId, owner, slotId: GRIT, value } as any,
			emit
		)
		.then(
			() => "written" as const,
			(e: Error) => e.message
		)
	return { outcome, errors }
}

/** A session with one character seat (card + member) and one carded player seat (another card + member). */
async function world(label: string) {
	const u = await user(label)
	const attached = await book(u.id)
	const verity = await card(u.id, "Verity")
	const wren = await card(u.id, "Wren")
	const mVerity = await member(attached.id, verity.id, { name: "Verity" })
	const mWren = await member(attached.id, wren.id, { name: "Wren" })
	const s = await session(u.id, attached.id)
	const charSeat = await seatCharacter(s.id, verity.id, mVerity.id)
	const playerSeat = await seatPlayer(s.id, u.id, wren.id, mWren.id)
	return {
		u,
		attached,
		verity,
		wren,
		mVerity,
		mWren,
		s,
		charSeat,
		playerSeat
	}
}

describe("a seat's values are stored and read in member form (switch on)", () => {
	test("a character seat and a carded player seat, written by card, are filed by seat and read back by key", async () => {
		const w = await world("a")
		memberFormSwitch.on = true

		expect(
			await set(
				w.u.id,
				w.s.id,
				{ kind: "session_cast", id: w.verity.id },
				7
			)
		).toEqual({
			outcome: "written",
			errors: []
		})
		expect(
			await set(
				w.u.id,
				w.s.id,
				{ kind: "session_cast", id: w.wren.id },
				4
			)
		).toEqual({
			outcome: "written",
			errors: []
		})
		expect(
			(await rowsOf(w.s.id)).map((r) => [r.ownerKind, r.ownerId]).sort()
		).toEqual(
			[
				["seated_member", w.mVerity.id],
				["player_seat", w.playerSeat.id]
			].sort()
		)

		const { stateFor } = await import("./resolve")
		const state = await stateFor(db(), w.s.id)
		const character = state.cast.byId[`seated_member:${w.mVerity.id}`]!
		const player = state.cast.byId[`player_seat:${w.playerSeat.id}`]!
		expect(character[GRIT_KEY]).toBe(7)
		expect(player[GRIT_KEY]).toBe(4)
		expect(character.ref).toBe(`seated-member:${w.mVerity.id}`)
		expect(player.ref).toBe(`player-seat:${w.playerSeat.id}`)
		expect(player.playerSeatId).toBe(w.playerSeat.id)
		// the id stays the card's
		expect([character.id, player.id]).toEqual([w.verity.id, w.wren.id])
		expect(state.cast.byId[String(w.verity.id)]).toBeUndefined()
	})

	test("a seated_member owner is accepted when its member sits in the session, refused when it sits nowhere", async () => {
		const w = await world("b")
		const stray = await member(w.attached.id, null, {
			name: "Nobody seated"
		})
		memberFormSwitch.on = true
		const { assertSessionOwner, StateRefusal } = await import("./write")
		await expect(
			assertSessionOwner(db(), w.s.id, {
				kind: "seated_member",
				id: w.mVerity.id
			})
		).resolves.toBeUndefined()
		// a carded player seat is an owner of its own
		await expect(
			assertSessionOwner(db(), w.s.id, {
				kind: "player_seat",
				id: w.playerSeat.id
			})
		).resolves.toBeUndefined()
		const refused = assertSessionOwner(db(), w.s.id, {
			kind: "seated_member",
			id: stray.id
		})
		await expect(refused).rejects.toBeInstanceOf(StateRefusal)
		await expect(refused).rejects.toThrow(
			"that character is not in this session's cast."
		)
	})

	test("switch off: a seated_member owner is not an owner kind and a carded player seat is refused", async () => {
		// Pinned off, whatever the file's config says: this asserts card form.
		memberFormSwitch.on = false
		const w = await world("b2")
		const { assertSessionOwner } = await import("./write")
		await expect(
			assertSessionOwner(db(), w.s.id, {
				kind: "seated_member",
				id: w.mVerity.id
			})
		).rejects.toThrow("is not an owner kind")
		await expect(
			assertSessionOwner(db(), w.s.id, {
				kind: "player_seat",
				id: w.playerSeat.id
			})
		).rejects.toThrow("that seat is not a player's seat")
	})
})

describe("read equivalence: member-form rows read what card-form rows read", () => {
	test("session values, and inheritance from the cast member and the card", async () => {
		// Pinned off, whatever the file's config says: this asserts card form.
		memberFormSwitch.on = false
		const w = await world("c")
		const slotValue = (v: number) => ({ v })
		const put = (
			ownerKind: string,
			ownerId: number,
			v: number,
			sessionId: number | null
		) =>
			testDb.insert(schema.attributeValues).values({
				ownerKind,
				ownerId,
				slotId: GRIT,
				value: slotValue(v),
				sessionId
			} as any)
		const { stateFor } = await import("./resolve")
		const read = async (key: string) => {
			const entry = (await stateFor(db(), w.s.id)).cast.byId[key]!
			const { ref: _ref, playerSeatId: _seat, ...rest } = entry as any
			return rest
		}

		// Nothing in the session: the card's own value, then the attached member's, win by chain order.
		await put("card", w.verity.id, 15, null)
		const offCard = await read(String(w.verity.id))
		memberFormSwitch.on = true
		const onCard = await read(`seated_member:${w.mVerity.id}`)
		memberFormSwitch.on = false
		expect(offCard[GRIT_KEY]).toBe(15)
		expect(onCard).toEqual(offCard)

		await put("cast_member", w.mVerity.id, 12, null)
		const offMember = await read(String(w.verity.id))
		memberFormSwitch.on = true
		const onMember = await read(`seated_member:${w.mVerity.id}`)
		memberFormSwitch.on = false
		expect(onMember).toEqual(offMember)

		// The session's own row, filed by card (off) and refiled by member (on).
		await put("session_cast", w.verity.id, 3, w.s.id)
		await put("session_cast", w.wren.id, 6, w.s.id)
		const offSession = [
			await read(String(w.verity.id)),
			await read(String(w.wren.id))
		]
		expect(offSession.map((e) => e[GRIT_KEY])).toEqual([3, 6])
		await testDb
			.update(schema.attributeValues)
			.set({ ownerKind: "seated_member", ownerId: w.mVerity.id })
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "session_cast"),
					eq(schema.attributeValues.ownerId, w.verity.id)
				)
			)
		await testDb
			.update(schema.attributeValues)
			.set({ ownerKind: "player_seat", ownerId: w.playerSeat.id })
			.where(
				and(
					eq(schema.attributeValues.ownerKind, "session_cast"),
					eq(schema.attributeValues.ownerId, w.wren.id)
				)
			)
		memberFormSwitch.on = true
		const onSession = [
			await read(`seated_member:${w.mVerity.id}`),
			await read(`player_seat:${w.playerSeat.id}`)
		]
		expect(onSession).toEqual(offSession)
	})
})

describe("★K-2: a card in a character seat and a player seat", () => {
	test("two entries when on, one when off", async () => {
		// Pinned off, whatever the file's config says: this asserts card form.
		memberFormSwitch.on = false
		const u = await user("d")
		const attached = await book(u.id)
		const shared = await card(u.id, "Shared")
		const mChar = await member(attached.id, shared.id, { name: "Shared" })
		const mPlayer = await member(attached.id, null, {
			name: "Shared (player)"
		})
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, shared.id, mChar.id)
		const seat = await seatPlayer(s.id, u.id, shared.id, mPlayer.id)
		const { stateFor, sessionLinks } = await import("./resolve")

		expect(Object.keys((await stateFor(db(), s.id)).cast.byId)).toEqual([
			String(shared.id)
		])

		memberFormSwitch.on = true
		const state = await stateFor(db(), s.id)
		expect(Object.keys(state.cast.byId).sort()).toEqual(
			[`player_seat:${seat.id}`, `seated_member:${mChar.id}`].sort()
		)
		const links = await sessionLinks(db(), s.id)
		expect(
			links.cast.map((c) => [c.characterId, c.playerSeatId ?? null])
		).toEqual([
			[shared.id, null],
			[shared.id, seat.id]
		])
		// Two seats, two values: a write to one is not the other's.
		expect(
			await set(u.id, s.id, { kind: "player_seat", id: seat.id }, 2)
		).toEqual({ outcome: "written", errors: [] })
		const after = await stateFor(db(), s.id)
		expect(after.cast.byId[`player_seat:${seat.id}`]![GRIT_KEY]).toBe(2)
		expect(after.cast.byId[`seated_member:${mChar.id}`]![GRIT_KEY]).toBe(10)
	})
})

describe("restoreRetractedState translates a stray card-form row (switch on)", () => {
	test("a row whose card has a seat goes back in member form; a row whose card has no seat goes back as it was", async () => {
		const w = await world("e")
		const loner = await card(w.u.id, "Loner")
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: w.s.id,
				role: "assistant",
				characterId: w.verity.id,
				content: "…",
				isNarratorResponse: false
			} as any)
			.returning()
		await testDb
			.insert(schema.messages)
			.values({
				id: legacy!.id,
				sessionId: w.s.id,
				characterId: w.verity.id,
				role: "assistant"
			} as any)
		const mk = (ownerId: number, v: number) => ({
			ownerKind: "session_cast",
			ownerId,
			slotId: GRIT,
			value: { v },
			sessionId: w.s.id
		})
		const inserted = await testDb
			.insert(schema.attributeValues)
			.values([
				mk(w.verity.id, 5),
				mk(loner.id, 6),
				mk(w.wren.id, 8)
			] as any)
			.returning()
		await testDb
			.delete(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, w.s.id))
		expect(await rowsOf(w.s.id)).toHaveLength(0)

		memberFormSwitch.on = true
		const { restoreRetractedState } = await import("./write")
		await restoreRetractedState(db(), {
			messageId: legacy!.id,
			values: inserted,
			configs: [],
			proposals: [],
			zones: [],
			imprints: [],
			ownBookEntries: [],
			clockSessions: [],
			sessionImprints: [],
			scenes: []
		} as any)
		const back = await rowsOf(w.s.id)
		expect(
			back.map((r) => [r.ownerKind, r.ownerId, (r.value as any).v]).sort()
		).toEqual(
			[
				["seated_member", w.mVerity.id, 5],
				["session_cast", loner.id, 6],
				["player_seat", w.playerSeat.id, 8]
			].sort()
		)
	})
})

describe("card ids and member ids never cross", () => {
	test("member N is not card N, in the owner check, the chain and the read", async () => {
		const u = await user("f")
		const attached = await book(u.id)
		const cardB = await card(u.id, "Second")
		// Make a member's id equal a card's id (the two share one range, from two sequences).
		let memberOfSeat2 = await member(attached.id, null, { name: "Second" })
		let cardOfSeat1 = await card(u.id, "First")
		let guard = 0
		while (cardOfSeat1.id < memberOfSeat2.id && guard++ < 500)
			cardOfSeat1 = await card(u.id, "First")
		while (memberOfSeat2.id < cardOfSeat1.id && guard++ < 500)
			memberOfSeat2 = await member(attached.id, null, { name: "Second" })
		expect(memberOfSeat2.id).toBe(cardOfSeat1.id)
		const m1seat = await member(attached.id, cardOfSeat1.id, {
			name: "First"
		})
		const c2 = cardB
		const s = await session(u.id, attached.id)
		await seatCharacter(s.id, cardOfSeat1.id, m1seat.id, 0)
		await seatCharacter(s.id, c2.id, memberOfSeat2.id, 1)
		memberFormSwitch.on = true

		// Member N (seat 2's) and card N (seat 1's): each owner finds only its own seat.
		expect(
			await set(
				u.id,
				s.id,
				{ kind: "seated_member", id: memberOfSeat2.id },
				3
			)
		).toEqual({ outcome: "written", errors: [] })
		expect(
			await set(
				u.id,
				s.id,
				{ kind: "session_cast", id: cardOfSeat1.id },
				9
			)
		).toEqual({ outcome: "written", errors: [] })
		expect(
			(await rowsOf(s.id))
				.map((r) => [r.ownerKind, r.ownerId, (r.value as any).v])
				.sort()
		).toEqual(
			[
				["seated_member", memberOfSeat2.id, 3],
				["seated_member", m1seat.id, 9]
			].sort()
		)
		const { stateFor } = await import("./resolve")
		const state = await stateFor(db(), s.id)
		expect(
			state.cast.byId[`seated_member:${memberOfSeat2.id}`]![GRIT_KEY]
		).toBe(3)
		expect(state.cast.byId[`seated_member:${m1seat.id}`]![GRIT_KEY]).toBe(9)
		expect(state.cast.byId[`seated_member:${memberOfSeat2.id}`]!.id).toBe(
			c2.id
		)
		expect(state.cast.byId[`seated_member:${m1seat.id}`]!.id).toBe(
			cardOfSeat1.id
		)
	})
})
