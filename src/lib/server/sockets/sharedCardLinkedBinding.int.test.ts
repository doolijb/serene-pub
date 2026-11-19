/**
 * A card shared with someone is read and copy only (owner ruling Q3,
 * 2026-10-12): a forged request that links it to a cast member through any
 * of the four doors is refused with that door's sentence and writes nothing.
 * A linked binding stays open for the caller's own card, and for a card seen
 * through a session's seat.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { CHARACTER_LORE_TYPE_ID } from "$lib/shared/entries/types"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-sharedcardlink-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
let n = 0

const BIND_DENIED =
	"Access denied. You don't have permission to bind that character or persona."
const ENTRY_DENIED = "You can't add that character to this book's cast."
const DRAW_DENIED =
	"That card is not one this cast member can be drawn with."

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const caller = await createTestUser(testDb, `scl-caller-${++n}`)
	const sharer = await createTestUser(testDb, `scl-sharer-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${++n}`, userId: caller.id })
		.returning()
	return { caller, sharer, book: book! }
}

async function cardOf(userId: number, sharedWith: number | null) {
	const { card } = await insertCard(db(), {
		userId,
		name: `Card ${++n}`,
		description: "Words."
	} as any)
	if (sharedWith != null)
		await testDb
			.insert(schema.characterShares)
			.values({ characterId: card.id, userId: sharedWith })
	return card
}

async function plainMember(bookId: number) {
	return (
		await insertCastMember(db(), {
			lorebookId: bookId,
			binding: `{{char:${++n}}}`,
			characterId: null,
			name: `Member ${n}`
		} as any)
	).member
}

/** Everything a forged link could write in the book. */
async function bookState(bookId: number) {
	const members = await testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, bookId))
	const versions = members.length
		? await testDb
				.select({ id: schema.characterVersions.id })
				.from(schema.characterVersions)
				.where(
					inArray(
						schema.characterVersions.castMemberId,
						members.map((m) => m.id)
					)
				)
		: []
	const entries = await testDb
		.select({ id: schema.lorebookEntries.id })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, bookId))
	return JSON.stringify({ members, versions, entries })
}

const lore = (lorebookId: number) => ({
	typeId: CHARACTER_LORE_TYPE_ID,
	lorebookId,
	name: "A rumour",
	content: "Said in the market.",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	priority: 1
})

type World = Awaited<ReturnType<typeof world>>

/** Each door's forged request; `memberId` is the card-less member the two edit doors act on. */
const doors = {
	createBinding: async (w: World, cardId: number) => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		return createLorebookBindingHandler.handler(
			fakeSocket(w.caller.id),
			{ lorebookBinding: { lorebookId: w.book.id, characterId: cardId } } as any,
			noopEmit
		)
	},
	updateBinding: async (w: World, cardId: number, memberId: number) => {
		const { updateLorebookBindingHandler } = await import("./lorebooks")
		return updateLorebookBindingHandler.handler(
			fakeSocket(w.caller.id),
			{ lorebookBinding: { id: memberId, characterId: cardId } } as any,
			noopEmit
		)
	},
	entrySave: async (w: World, cardId: number) => {
		const { createEntryHandler } = await import("./entries")
		return createEntryHandler.handler(
			fakeSocket(w.caller.id),
			{ entry: lore(w.book.id), lorebookBindingCharacterId: cardId } as any,
			noopEmit
		)
	},
	amendment: async (w: World, cardId: number, memberId: number) => {
		const { amendmentsCreateHandler } = await import("./amendments")
		return amendmentsCreateHandler.handler(
			fakeSocket(w.caller.id),
			{
				lorebookId: w.book.id,
				castId: memberId,
				year: 20,
				fields: { characterId: cardId }
			} as any,
			noopEmit
		)
	}
}

describe("a card shared with the caller cannot be linked, by any door", () => {
	const cases: Array<[keyof typeof doors, string]> = [
		["createBinding", BIND_DENIED],
		["updateBinding", BIND_DENIED],
		["entrySave", ENTRY_DENIED],
		["amendment", DRAW_DENIED]
	]
	for (const [door, sentence] of cases)
		test(`${door}: refused with its sentence, nothing written`, async () => {
			const w = await world()
			const card = await cardOf(w.sharer.id, w.caller.id)
			const member = await plainMember(w.book.id)
			const before = await bookState(w.book.id)
			await expect(
				doors[door](w, card.id, member.id)
			).rejects.toThrow(sentence)
			expect(await bookState(w.book.id)).toBe(before)
		})
})

describe("the twins that still pass", () => {
	test("the caller's own card links through createBinding", async () => {
		const w = await world()
		const card = await cardOf(w.caller.id, null)
		await doors.createBinding(w, card.id)
		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, w.book.id))
		expect(members.map((m) => m.characterId)).toEqual([card.id])
	})

	test("a card seated in a session the caller is a guest of links through createBinding", async () => {
		const w = await world()
		const card = await cardOf(w.sharer.id, null)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.sharer.id, isGroup: false } as any)
			.returning()
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session!.id, userId: w.caller.id, isPlayer: true })
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: session!.id, characterId: card.id, position: 0 })
		await doors.createBinding(w, card.id)
		const members = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, w.book.id))
		expect(members.map((m) => m.characterId)).toEqual([card.id])
	})
})
