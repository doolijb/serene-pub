/**
 * 🚧 `seatOf` (`sessions/seats.ts`, plan §27 v2 S2): a participant ref resolved
 * to the session's seat.
 *
 * Claims: each ref form finds its seat; a card that is a character seat and a
 * player seat is the character seat; a live seat beats a departed one; a
 * player-seat ref of another session finds nothing; ids that coincide across
 * cards, members and seats are told apart by their form; an envoy seat is
 * never returned.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { seatOf } from "./seats"

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
		path.join(os.tmpdir(), "serene-pub-vitest-seatOf-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`
const asDb = () => testDb as unknown as Db

async function user() {
	const [row] = await testDb
		.insert(schema.users)
		.values({ username: uniq("seat-of-user") })
		.returning()
	return row!
}

async function card(userId: number, name: string, id?: number) {
	const [row] = await testDb
		.insert(schema.characters)
		.values({
			...(id != null ? { id } : {}),
			userId,
			name,
			description: ""
		})
		.returning()
	return row!
}

async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	return row!
}

async function member(
	lorebookId: number,
	characterId: number | null,
	id?: number
) {
	const [row] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			...(id != null ? { id } : {}),
			lorebookId,
			binding: uniq("{{char:x}}"),
			characterId,
			name: ""
		})
		.returning()
	return row!
}

async function session(userId: number) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Run") })
		.returning()
	return row!
}

async function characterSeat(
	sessionId: number,
	p: Partial<typeof schema.sessionCharacters.$inferInsert>
) {
	const [row] = await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, ...p })
		.returning()
	return row!
}

async function playerSeat(
	sessionId: number,
	p: Partial<typeof schema.sessionPersonas.$inferInsert>
) {
	const [row] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId, ...p })
		.returning()
	return row!
}

const gone = new Date("2026-01-01T00:00:00Z")

describe("each ref form", () => {
	test("character:<cardId> finds the character seat of that card", async () => {
		const u = await user()
		const c = await card(u.id, "Maren")
		const s = await session(u.id)
		const seat = await characterSeat(s.id, { characterId: c.id })
		expect(await seatOf(asDb(), s.id, `character:${c.id}`)).toEqual({
			kind: "character",
			seatId: seat.id,
			castMemberId: null,
			cardId: c.id,
			departed: false,
			actingUserId: null
		})
	})

	test("character:<cardId> finds a player seat that has that card", async () => {
		const u = await user()
		const c = await card(u.id, "Player card")
		const s = await session(u.id)
		const seat = await playerSeat(s.id, { personaId: c.id })
		expect(await seatOf(asDb(), s.id, `character:${c.id}`)).toEqual({
			kind: "player",
			seatId: seat.id,
			castMemberId: null,
			cardId: c.id,
			departed: false,
			actingUserId: null
		})
	})

	test("seated-member:<memberId> finds the character seat, else the player seat, of that member", async () => {
		const u = await user()
		const b = await book(u.id)
		const c1 = await card(u.id, "One")
		const c2 = await card(u.id, "Two")
		const m1 = await member(b.id, c1.id)
		const m2 = await member(b.id, c2.id)
		const s = await session(u.id)
		const char = await characterSeat(s.id, {
			characterId: c1.id,
			castMemberId: m1.id
		})
		const player = await playerSeat(s.id, {
			personaId: c2.id,
			castMemberId: m2.id
		})
		expect(
			await seatOf(asDb(), s.id, `seated-member:${m1.id}`)
		).toMatchObject({
			kind: "character",
			seatId: char.id,
			castMemberId: m1.id
		})
		expect(
			await seatOf(asDb(), s.id, `seated-member:${m2.id}`)
		).toMatchObject({
			kind: "player",
			seatId: player.id,
			castMemberId: m2.id,
			cardId: c2.id
		})
	})

	test("player-seat:<seatId> finds a player seat, with or without a card", async () => {
		const u = await user()
		const c = await card(u.id, "Carded")
		const s = await session(u.id)
		const carded = await playerSeat(s.id, { personaId: c.id })
		const cardless = await playerSeat(s.id, { seatName: "Pip" })
		expect(
			await seatOf(asDb(), s.id, `player-seat:${carded.id}`)
		).toMatchObject({ kind: "player", seatId: carded.id, cardId: c.id })
		expect(
			await seatOf(asDb(), s.id, `player-seat:${cardless.id}`)
		).toEqual({
			kind: "player",
			seatId: cardless.id,
			castMemberId: null,
			cardId: null,
			departed: false,
			actingUserId: null
		})
	})

	test("an unparseable ref, and a ref nothing matches, are null", async () => {
		const u = await user()
		const s = await session(u.id)
		expect(await seatOf(asDb(), s.id, "narrator")).toBeNull()
		expect(await seatOf(asDb(), s.id, "character:0")).toBeNull()
		expect(await seatOf(asDb(), s.id, "character:999999999")).toBeNull()
		expect(await seatOf(asDb(), s.id, "seated-member:999999999")).toBeNull()
		expect(await seatOf(asDb(), s.id, "player-seat:999999999")).toBeNull()
	})
})

describe("which seat wins", () => {
	test("a card that is both a character seat and a player seat: the character seat", async () => {
		const u = await user()
		const c = await card(u.id, "Both")
		const s = await session(u.id)
		await playerSeat(s.id, { personaId: c.id })
		const char = await characterSeat(s.id, { characterId: c.id })
		expect(await seatOf(asDb(), s.id, `character:${c.id}`)).toMatchObject({
			kind: "character",
			seatId: char.id
		})
	})

	test("live before departed: a departed character seat does not hide a live seat of the card", async () => {
		const u = await user()
		const c = await card(u.id, "Back again")
		const s = await session(u.id)
		await characterSeat(s.id, { characterId: c.id, removedAt: gone })
		const live = await playerSeat(s.id, { personaId: c.id })
		expect(await seatOf(asDb(), s.id, `character:${c.id}`)).toMatchObject({
			kind: "player",
			seatId: live.id,
			departed: false
		})
	})

	test("a departed seat is returned, marked departed, when it is all there is", async () => {
		const u = await user()
		const c = await card(u.id, "Left")
		const s = await session(u.id)
		const seat = await characterSeat(s.id, {
			characterId: c.id,
			removedAt: gone
		})
		expect(await seatOf(asDb(), s.id, `character:${c.id}`)).toMatchObject({
			kind: "character",
			seatId: seat.id,
			departed: true
		})
	})

	test("several seats of one member: live first, then the lowest position, then the lowest id", async () => {
		const u = await user()
		const b = await book(u.id)
		const c1 = await card(u.id, "A")
		const c2 = await card(u.id, "B")
		const c3 = await card(u.id, "C")
		const c4 = await card(u.id, "D")
		const m = await member(b.id, c1.id)
		const s = await session(u.id)
		await characterSeat(s.id, {
			characterId: c1.id,
			castMemberId: m.id,
			position: 0,
			removedAt: gone
		})
		await characterSeat(s.id, {
			characterId: c2.id,
			castMemberId: m.id,
			position: 5
		})
		const low1 = await characterSeat(s.id, {
			characterId: c3.id,
			castMemberId: m.id,
			position: 2
		})
		const low2 = await characterSeat(s.id, {
			characterId: c4.id,
			castMemberId: m.id,
			position: 2
		})
		expect(low1.id).toBeLessThan(low2.id)
		expect(
			await seatOf(asDb(), s.id, `seated-member:${m.id}`)
		).toMatchObject({ seatId: low1.id })
	})
})

describe("scope", () => {
	test("a player-seat ref from another session is null; so are the card and member forms", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, "Elsewhere")
		const m = await member(b.id, c.id)
		const other = await session(u.id)
		const mine = await session(u.id)
		const pSeat = await playerSeat(other.id, { personaId: c.id })
		await characterSeat(other.id, { characterId: c.id, castMemberId: m.id })
		expect(
			await seatOf(asDb(), mine.id, `player-seat:${pSeat.id}`)
		).toBeNull()
		expect(await seatOf(asDb(), mine.id, `character:${c.id}`)).toBeNull()
		expect(
			await seatOf(asDb(), mine.id, `seated-member:${m.id}`)
		).toBeNull()
		expect(
			await seatOf(asDb(), other.id, `player-seat:${pSeat.id}`)
		).toMatchObject({ seatId: pSeat.id })
	})

	test("an envoy seat is never returned", async () => {
		const u = await user()
		const s = await session(u.id)
		const envoy = await characterSeat(s.id, { envoySlug: "guide" })
		for (const ref of [
			`character:${envoy.id}`,
			`seated-member:${envoy.id}`,
			`player-seat:${envoy.id}`
		])
			expect(await seatOf(asDb(), s.id, ref), ref).toBeNull()
	})
})

describe("overlapping id ranges", () => {
	test("a card, a member, a character seat and a player seat all numbered N: each form finds its own seat", async () => {
		const u = await user()
		const N = 700_000 + Math.floor(Math.random() * 100_000)
		const b = await book(u.id)
		// Card N, and a second card that is the member's.
		const cardN = await card(u.id, "Card N", N)
		const other = await card(u.id, "Other card")
		const memberN = await member(b.id, other.id, N)
		const s = await session(u.id)
		// Character seat with id N: it seats card N.
		const seatForCard = await characterSeat(s.id, {
			id: N,
			characterId: cardN.id
		})
		// A character seat whose member is member N (a different card, a different seat).
		const seatForMember = await characterSeat(s.id, {
			characterId: other.id,
			castMemberId: memberN.id
		})
		// Player seat with id N: card-less.
		const seatN = await playerSeat(s.id, { id: N, seatName: "Seat N" })
		expect(seatForMember.id).not.toBe(N)
		expect(seatForCard.id).toBe(N)
		expect(seatN.id).toBe(N)
		expect(cardN.id).toBe(N)
		expect(memberN.id).toBe(N)

		expect(await seatOf(asDb(), s.id, `character:${N}`)).toMatchObject({
			kind: "character",
			seatId: seatForCard.id,
			cardId: cardN.id
		})
		expect(await seatOf(asDb(), s.id, `seated-member:${N}`)).toMatchObject({
			kind: "character",
			seatId: seatForMember.id,
			castMemberId: memberN.id
		})
		expect(await seatOf(asDb(), s.id, `player-seat:${N}`)).toMatchObject({
			kind: "player",
			seatId: seatN.id,
			cardId: null
		})
	})
})
