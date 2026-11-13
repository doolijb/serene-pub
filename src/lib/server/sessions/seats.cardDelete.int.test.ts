/**
 * 🚧 `fillSeatsBeforeCardDelete` (`sessions/seats.ts`) through both card-delete
 * writers, `characters:delete` and `deleteProvidedBooks` (★RF-1, 2026-11-09).
 *
 * Claims: a live seat of the card with no member takes the card's member from
 * the attached book, else the session's own book (its notes), else a new member
 * made from the card before it goes (in the attached book when it may mint,
 * else in the own book); the member ends card-less, named for the card, with
 * the card's words as its own, following nothing; a card-less seat and another
 * session's seat of another card are untouched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
		path.join(os.tmpdir(), "serene-pub-vitest-seatsCardDelete-")
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
		.values({ username: uniq("card-delete-user") })
		.returning()
	return row!
}
/** A card carrying a provided mark, so both delete paths can reach it. */
async function card(userId: number, pluginId: string, name: string) {
	const { card: row } = await insertCard(asDb(), {
		userId,
		name,
		description: `${name} keeps bees.`
	})
	await testDb
		.update(schema.characters)
		.set({
			extensions: {
				serenepub: {
					provided: {
						plugin: pluginId,
						slug: "x",
						version: "1",
						uuid: row.uuid
					}
				}
			}
		})
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
async function member(
	lorebookId: number,
	characterId: number | null,
	name: string
) {
	const { member: row } = await insertCastMember(asDb(), {
		lorebookId,
		binding: uniq("{{char:x}}"),
		characterId,
		name,
		ownName: name || null
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
async function ownBookOf(sessionId: number) {
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	return ownBookFor(asDb(), sessionId)
}
const seatOf = (sessionId: number, characterId: number | null) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				characterId == null
					? undefined
					: eq(schema.sessionCharacters.characterId, characterId)
			)
		)
const bindingsOf = (lorebookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))

type Deleter = (
	userId: number,
	cardId: number,
	pluginId: string
) => Promise<void>
const paths: [string, Deleter][] = [
	[
		"characters:delete",
		async (userId, cardId) => {
			const { charactersDelete } = await import(
				"$lib/server/sockets/characters"
			)
			await charactersDelete.handler(
				{
					user: { id: userId },
					io: { to: () => ({ emit() {} }) }
				} as any,
				{ id: cardId },
				(() => {}) as any
			)
		}
	],
	[
		"deleteProvidedBooks",
		async (_userId, _cardId, pluginId) => {
			const { deleteProvidedBooks } = await import(
				"$lib/server/plugins/providedBooks"
			)
			await deleteProvidedBooks(asDb(), pluginId)
		}
	]
]

describe.each(paths)("%s fills a deleted card's seats", (_label, remove) => {
	/** The seats of the case: a character seat and a player seat of the card, no member. */
	async function seatCard(sessionId: number, cardId: number) {
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId: cardId })
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId, personaId: cardId })
	}

	async function expectFilled(
		sessionId: number,
		cardRow: { id: number; name: string; description: string | null },
		memberId: number | null
	) {
		const [seat] = await seatOf(sessionId, cardRow.id)
		const [player] = await testDb
			.select()
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, sessionId))
		expect(seat!.castMemberId).not.toBeNull()
		expect(player!.castMemberId).toBe(seat!.castMemberId)
		if (memberId != null) expect(seat!.castMemberId).toBe(memberId)
		const id = seat!.castMemberId!
		const [binding] = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, id))
		expect(binding!.characterId).toBeNull()
		expect(binding!.name).toBe(cardRow.name)
		const read = (await membersAsRead(asDb(), [id])).get(id)!
		expect(read.name).toBe(cardRow.name)
		expect(read.description).toBe(cardRow.description)
		const versions = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.castMemberId, id))
		for (const v of versions) expect(v.follows).toEqual([])
	}

	test("(a) the card's member in the attached book: the seat takes it", async () => {
		const u = await user()
		const pluginId = uniq("acme.fill")
		const c = await card(u.id, pluginId, uniq("Ada"))
		const b = await book(u.id)
		const m = await member(b.id, c.id, c.name)
		const s = await session(u.id, b.id)
		await seatCard(s.id, c.id)

		await remove(u.id, c.id, pluginId)
		await expectFilled(s.id, c, m.id)
		expect(await bindingsOf(b.id)).toHaveLength(1)
	})

	test("(b) the card's member only in the session's own book: the seat takes it, nothing minted in the attached book", async () => {
		const u = await user()
		const pluginId = uniq("acme.fill")
		const c = await card(u.id, pluginId, uniq("Bea"))
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const own = await ownBookOf(s.id)
		const m = await member(own.id, c.id, c.name)
		await seatCard(s.id, c.id)

		await remove(u.id, c.id, pluginId)
		await expectFilled(s.id, c, m.id)
		expect(await bindingsOf(b.id)).toHaveLength(0)
		expect(await bindingsOf(own.id)).toHaveLength(1)
	})

	test("(c) no member anywhere: minted in the attached book when it may mint, else in the own book", async () => {
		const u = await user()
		const pluginId = uniq("acme.fill")
		const c = await card(u.id, pluginId, uniq("Cy"))
		const b = await book(u.id)
		const withBook = await session(u.id, b.id)
		const ownOnly = await session(u.id, null)
		const ownOnlyBook = await ownBookOf(ownOnly.id)
		await seatCard(withBook.id, c.id)
		await seatCard(ownOnly.id, c.id)

		await remove(u.id, c.id, pluginId)
		await expectFilled(withBook.id, c, null)
		await expectFilled(ownOnly.id, c, null)
		const inAttached = await bindingsOf(b.id)
		expect(inAttached).toHaveLength(1)
		expect((await seatOf(withBook.id, c.id))[0]!.castMemberId).toBe(
			inAttached[0]!.id
		)
		const inOwn = await bindingsOf(ownOnlyBook.id)
		expect(inOwn).toHaveLength(1)
		expect((await seatOf(ownOnly.id, c.id))[0]!.castMemberId).toBe(
			inOwn[0]!.id
		)
	})

	test("a card-less seat and another session's seat of another card are unchanged", async () => {
		const u = await user()
		const pluginId = uniq("acme.fill")
		const c = await card(u.id, pluginId, uniq("Dee"))
		const other = await card(u.id, uniq("acme.other"), uniq("Eli"))
		const b = await book(u.id)
		const s = await session(u.id, b.id)
		const cardless = await member(b.id, null, uniq("Nobody"))
		await seatCard(s.id, c.id)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: s.id,
			characterId: null,
			castMemberId: cardless.id
		})
		const t = await session(u.id, b.id)
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: t.id, characterId: other.id })

		await remove(u.id, c.id, pluginId)
		await expectFilled(s.id, c, null)
		const seats = await seatOf(s.id, null)
		expect(seats.find((r) => r.characterId == null)!.castMemberId).toBe(
			cardless.id
		)
		expect((await seatOf(t.id, other.id))[0]!.castMemberId).toBeNull()
	})
})
