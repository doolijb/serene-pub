/**
 * The cast list says a member is the asker's persona only while the asker
 * holds a live player seat on it in a session reading the book (its
 * lorebook, or its own notes): a card the AI plays, a card seated as a
 * guest's persona and a card nobody seats are characters to the asker.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-binding-persona-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

/**
 * A book, a session reading it, and one persona-flagged card bound as a
 * member. `notes`: the book is the session's own notes (the session's
 * `lorebookId` is not it), as the real app has it.
 */
async function world(opts: { notes?: boolean } = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `binding-persona-${++n}`)
	const [book] = opts.notes
		? [undefined]
		: await testDb
				.insert(schema.lorebooks)
				.values({ name: `Book ${n}`, userId: user.id })
				.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book?.id ?? null } as any)
		.returning()
	const bookRow = opts.notes
		? (
				await testDb
					.insert(schema.lorebooks)
					.values({ name: `Notes ${n}`, userId: user.id, sessionId: session!.id })
					.returning()
			)[0]!
		: book!
	const { card } = await insertCard(db(), {
		userId: user.id,
		name: `Wren ${n}`,
		description: "A card.",
		isPersona: true
	} as any)
	const { member } = await insertCastMember(db(), {
		lorebookId: bookRow.id,
		binding: `{{char:${n}}}`,
		characterId: card.id,
		name: `Wren ${n}`
	})
	const kindOfCard = async () => {
		const { buildLorebookBindingList } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res = await buildLorebookBindingList(user.id, bookRow.id)
		return res.lorebookBindingList.find((m) => m.id === member.id)!.character
			?.isPersona
	}
	const playerSeat = (removedAt: Date | null, seatedFor: number = user.id) =>
		testDb.insert(schema.sessionPersonas).values({
			sessionId: session!.id,
			personaId: card.id,
			castMemberId: member.id,
			userId: seatedFor,
			removedAt
		} as any)
	const characterSeat = (removedAt: Date | null) =>
		testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: card.id,
			castMemberId: member.id,
			removedAt
		} as any)
	const guest = async () =>
		(await createTestUser(testDb, `binding-persona-guest-${++n}`)).id
	return { kindOfCard, playerSeat, characterSeat, guest }
}

describe("lorebooks:bindingList persona flag follows the asker's live player seat", () => {
	test("a card with no seat anywhere is a character to the asker", async () => {
		const w = await world()
		expect(await w.kindOfCard()).toBe(false)
	})
	test("a live player seat: persona", async () => {
		const w = await world()
		await w.playerSeat(null)
		expect(await w.kindOfCard()).toBe(true)
	})
	test("a removed player seat and a live character seat: a character", async () => {
		const w = await world()
		await w.playerSeat(new Date())
		await w.characterSeat(null)
		expect(await w.kindOfCard()).toBe(false)
	})
	test("both seats live: still the asker's persona", async () => {
		const w = await world()
		await w.playerSeat(null)
		await w.characterSeat(null)
		expect(await w.kindOfCard()).toBe(true)
	})
	test("the session's own notes: the asker's live player seat is a persona", async () => {
		const w = await world({ notes: true })
		await w.playerSeat(null)
		expect(await w.kindOfCard()).toBe(true)
	})
	test("the session's own notes: a card the AI plays is a character", async () => {
		const w = await world({ notes: true })
		await w.playerSeat(new Date())
		await w.characterSeat(null)
		expect(await w.kindOfCard()).toBe(false)
	})
	test("seated as a guest's persona, then played by the AI: a character to the owner", async () => {
		const w = await world({ notes: true })
		await w.playerSeat(new Date(), await w.guest())
		await w.characterSeat(null)
		expect(await w.kindOfCard()).toBe(false)
	})
	test("seated as a guest's persona and still live: not the owner's", async () => {
		const w = await world({ notes: true })
		await w.playerSeat(null, await w.guest())
		expect(await w.kindOfCard()).toBe(false)
	})
})
