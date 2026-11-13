/**
 * 🚧 The `seat-members` boot pass and the seats of deleted cards
 * (`sessions/seatMembers.ts` step 1, ★RF-1, 2026-11-10).
 *
 * Claims: a live seat of a soft-deleted card that no book knows, in a session
 * whose attached book may take a member or that has an own book, gets a new
 * card-less member made from the card's content, holding the card's words;
 * both seats of one card share it; a second boot writes nothing and selects
 * nothing; a card that has a member, a live card, and a departed seat are not
 * minted card-less; a session no book can take a member into is counted
 * `unexplained` on every boot and never worked.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { ownBookFor } from "$lib/server/lorebooks/ownBook"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { seatMembers } from "./seatMembers"

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
		path.join(os.tmpdir(), "serene-pub-vitest-seatMembersDeleted-")
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
		.values({ username: uniq("seat-deleted-user") })
		.returning()
	return row!
}
/** A card with a version and a description, soft-deleted when asked. */
async function card(userId: number, name: string, deleted = true) {
	const { card: row } = await insertCard(asDb(), {
		userId,
		name,
		description: `${name} keeps bees.`
	})
	if (deleted)
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, row.id))
	return row
}
async function book(userId: number) {
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book") })
		.returning()
	return row!
}
async function member(lorebookId: number, characterId: number, name: string) {
	const { member: row } = await insertCastMember(asDb(), {
		lorebookId,
		binding: uniq("{{char:x}}"),
		characterId,
		name,
		ownName: name
	})
	return row
}
async function session(userId: number, lorebookId: number | null) {
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: uniq("Run"), lorebookId })
		.returning()
	return row!
}
const charSeat = (
	sessionId: number,
	characterId: number,
	extra: Partial<typeof schema.sessionCharacters.$inferInsert> = {}
) =>
	testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId, characterId, ...extra })
const playerSeat = (sessionId: number, personaId: number) =>
	testDb.insert(schema.sessionPersonas).values({ sessionId, personaId })
const seatsOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(schema.sessionCharacters.id)
const playersOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(schema.sessionPersonas.id)
const bindingsOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
const everything = async () => ({
	characters: await testDb
		.select()
		.from(schema.sessionCharacters)
		.orderBy(schema.sessionCharacters.id),
	players: await testDb
		.select()
		.from(schema.sessionPersonas)
		.orderBy(schema.sessionPersonas.id),
	bindings: await testDb
		.select()
		.from(schema.lorebookBindings)
		.orderBy(schema.lorebookBindings.id),
	versions: await testDb
		.select()
		.from(schema.characterVersions)
		.orderBy(schema.characterVersions.id)
})
const retire = (sessionId: number) =>
	testDb.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))

const ZEROS = {
	sessions: 0,
	filled: 0,
	minted: 0,
	merged: 0,
	unexplained: 0,
	failed: 0
}

/** The member holds the card's words as its own, is card-less, and follows nothing. */
async function expectCardsWords(
	memberId: number,
	cardRow: { name: string; description: string | null },
	lorebookId: number
) {
	const [binding] = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, memberId))
	expect(binding!.characterId).toBeNull()
	expect(binding!.name).toBe(cardRow.name)
	expect(binding!.lorebookId).toBe(lorebookId)
	const read = (await membersAsRead(asDb(), [memberId])).get(memberId)!
	expect(read.name).toBe(cardRow.name)
	expect(read.description).toBe(cardRow.description)
	const versions = await testDb
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
	for (const v of versions) expect(v.follows).toEqual([])
}

async function expectSecondBootChangesNothing() {
	const settled = await everything()
	expect(await seatMembers(asDb())).toEqual(ZEROS)
	expect(await everything()).toEqual(settled)
}

describe("seats of deleted cards at boot", () => {
	test("a character seat of a deleted card, attached book may mint: a card-less member in it; a second boot changes nothing", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, uniq("Ada"))
		const s = await session(u.id, b.id)
		await charSeat(s.id, c.id)

		expect(await seatMembers(asDb())).toEqual({
			sessions: 1,
			filled: 1,
			minted: 1,
			merged: 0,
			unexplained: 0,
			failed: 0
		})
		const [seat] = await seatsOf(s.id)
		expect(seat!.castMemberId).not.toBeNull()
		await expectCardsWords(seat!.castMemberId!, c, b.id)
		expect(await bindingsOf(b.id)).toHaveLength(1)
		await expectSecondBootChangesNothing()
		await retire(s.id)
	})

	test("a player seat of a deleted card, own-book-only session: a card-less member in the own book; a second boot changes nothing", async () => {
		const u = await user()
		const s = await session(u.id, null)
		const own = await ownBookFor(asDb(), s.id)
		const c = await card(u.id, uniq("Bryn"))
		await playerSeat(s.id, c.id)

		expect(await seatMembers(asDb())).toMatchObject({
			sessions: 1,
			filled: 1,
			minted: 1,
			unexplained: 0,
			failed: 0
		})
		const [player] = await playersOf(s.id)
		expect(player!.castMemberId).not.toBeNull()
		await expectCardsWords(player!.castMemberId!, c, own.id)
		await expectSecondBootChangesNothing()
		await retire(s.id)
	})

	test("a character seat and a player seat of one deleted card take the same member", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, uniq("Cass"))
		const s = await session(u.id, b.id)
		await charSeat(s.id, c.id)
		await playerSeat(s.id, c.id)

		expect(await seatMembers(asDb())).toEqual({
			sessions: 1,
			filled: 2,
			minted: 1,
			merged: 0,
			unexplained: 0,
			failed: 0
		})
		const [seat] = await seatsOf(s.id)
		const [player] = await playersOf(s.id)
		expect(seat!.castMemberId).not.toBeNull()
		expect(player!.castMemberId).toBe(seat!.castMemberId)
		await expectCardsWords(seat!.castMemberId!, c, b.id)
		expect(await bindingsOf(b.id)).toHaveLength(1)
		await expectSecondBootChangesNothing()
		await retire(s.id)
	})

	test("a deleted card the attached book already has a member for: the seat takes it, nothing card-less is minted", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, uniq("Dov"))
		const m = await member(b.id, c.id, c.name)
		const s = await session(u.id, b.id)
		await charSeat(s.id, c.id)

		expect(await seatMembers(asDb())).toMatchObject({
			sessions: 1,
			filled: 1,
			minted: 0,
			unexplained: 0,
			failed: 0
		})
		const [seat] = await seatsOf(s.id)
		expect(seat!.castMemberId).toBe(m.id)
		const bindings = await bindingsOf(b.id)
		expect(bindings).toHaveLength(1)
		expect(bindings[0]!.characterId).toBe(c.id)
		await expectSecondBootChangesNothing()
		await retire(s.id)
	})

	test("a live card's seat with no member: settling mints a linked member, not a card-less one", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, uniq("Eve"), false)
		const s = await session(u.id, b.id)
		await charSeat(s.id, c.id)

		expect(await seatMembers(asDb())).toMatchObject({
			sessions: 1,
			filled: 1,
			minted: 1,
			unexplained: 0,
			failed: 0
		})
		const [seat] = await seatsOf(s.id)
		const [minted] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, seat!.castMemberId!))
		expect(minted!.characterId).toBe(c.id)
		await expectSecondBootChangesNothing()
		await retire(s.id)
	})

	test("a departed seat of a deleted card with no member is untouched and its session not counted", async () => {
		const u = await user()
		const b = await book(u.id)
		const c = await card(u.id, uniq("Finn"))
		const s = await session(u.id, b.id)
		await charSeat(s.id, c.id, { removedAt: new Date(), isActive: false })
		const before = await everything()

		expect(await seatMembers(asDb())).toEqual(ZEROS)
		const [seat] = await seatsOf(s.id)
		expect(seat!.castMemberId).toBeNull()
		expect(await bindingsOf(b.id)).toHaveLength(0)
		expect(await everything()).toEqual(before)
		expect(await seatMembers(asDb())).toEqual(ZEROS)
		expect(await everything()).toEqual(before)
		await retire(s.id)
	})

	test("an attached book owned by another user and no own book: the live seat stays empty, counted unexplained on every boot, never worked", async () => {
		const owner = await user()
		const other = await user()
		const foreign = await book(other.id)
		const c = await card(owner.id, uniq("Gwen"))
		const s = await session(owner.id, foreign.id)
		await charSeat(s.id, c.id)
		const before = await everything()

		const expected = {
			sessions: 0,
			filled: 0,
			minted: 0,
			merged: 0,
			unexplained: 1,
			failed: 0
		}
		expect(await seatMembers(asDb())).toEqual(expected)
		expect(await everything()).toEqual(before)
		expect(await seatMembers(asDb())).toEqual(expected)
		expect(await everything()).toEqual(before)
		const [seat] = await seatsOf(s.id)
		expect(seat!.castMemberId).toBeNull()
		expect(await bindingsOf(foreign.id)).toHaveLength(0)
		await retire(s.id)
	})
})
