/**
 * `characterRowsPage`: cards shared with the asker, and the row fields the
 * Characters view reads (`isSharedWithMe`, `ownerName`, `isDefaultPersona`,
 * `embeddingModel`, `readableMember`), plus the tag-name search.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCard, insertCastMember } from "$lib/server/characters/versions"
import { characterRowsPage } from "./characterRows"

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
		path.join(os.tmpdir(), "serene-pub-vitest-chrrows-shared-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0
const uniq = (label: string) => `${label}${++n}`

async function mkUser(extra: { displayName?: string } = {}) {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: uniq("chrshared-user-"), ...extra })
		.returning()
	return u!
}

async function mkCard(
	userId: number,
	name: string,
	extra: Partial<typeof schema.characters.$inferInsert> = {}
) {
	const { card } = await insertCard(testDb, {
		userId,
		name,
		description: "A person.",
		...extra
	})
	return card
}

async function mkBook(
	userId: number,
	values: Partial<typeof schema.lorebooks.$inferInsert> = {}
) {
	const [b] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name: uniq("Book "), ...values })
		.returning()
	return b!
}

async function mkMember(bookId: number, cardId: number | null, name: string) {
	const { member } = await insertCastMember(db(), {
		lorebookId: bookId,
		characterId: cardId,
		overlayOf: null,
		binding: `{{char:${++n}}}`,
		name
	})
	return member
}

async function share(cardId: number, userId: number) {
	await testDb
		.insert(schema.characterShares)
		.values({ characterId: cardId, userId })
}

const keys = (r: { rows: { rowKey: string }[] }) => r.rows.map((x) => x.rowKey)
const page = (
	asker: number,
	q: string,
	filters: Record<string, unknown> = {},
	more: { cursor?: string | null; limit?: number } = {}
) =>
	characterRowsPage(db(), asker, {
		...more,
		filters: { q, ...filters } as any
	})

describe("characterRowsPage: shared cards", () => {
	test("a shared card is one card row, marked and named by its owner", async () => {
		const p = uniq("sc")
		const me = await mkUser()
		const owner = await mkUser({ displayName: `${p} Owner Name` })
		const card = await mkCard(owner.id, `${p} Shared`)
		await share(card.id, me.id)

		const r = await page(me.id, p)
		expect(keys(r)).toEqual([`card:${card.id}`])
		expect(r.rows[0]).toMatchObject({
			hasCard: true,
			cardIsMine: false,
			isSharedWithMe: true,
			ownerName: `${p} Owner Name`,
			isFavorite: false,
			isPersona: false,
			isDefaultPersona: false,
			folderId: null,
			embeddingModel: null,
			readableMember: null
		})

		// The owner's username stands in without a display name.
		const plain = await mkUser()
		const c2 = await mkCard(plain.id, `${p} Plain owner`)
		await share(c2.id, me.id)
		const row2 = (await page(me.id, `${p} Plain`)).rows[0]!
		expect(row2.ownerName).toBe(plain.username)

		// Not listed once the share is removed.
		await testDb
			.delete(schema.characterShares)
			.where(
				and(
					eq(schema.characterShares.characterId, card.id),
					eq(schema.characterShares.userId, me.id)
				)
			)
		expect(keys(await page(me.id, `${p} Shared`))).toEqual([])
	})

	test("not listed when deleted or a hidden carrier; an unshared card never", async () => {
		const p = uniq("sd")
		const me = await mkUser()
		const owner = await mkUser()
		const gone = await mkCard(owner.id, `${p} Gone`)
		const carrier = await mkCard(owner.id, `${p} Carrier`)
		const unshared = await mkCard(owner.id, `${p} Unshared`)
		const ok = await mkCard(owner.id, `${p} Ok`)
		await share(gone.id, me.id)
		await share(carrier.id, me.id)
		await share(ok.id, me.id)
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, gone.id))
		await testDb
			.update(schema.characters)
			.set({
				extensions: {
					serenepub: {
						provided: {
							plugin: "p",
							slug: "s",
							uuid: carrier.uuid
						}
					}
				}
			} as any)
			.where(eq(schema.characters.id, carrier.id))

		expect(keys(await page(me.id, p))).toEqual([`card:${ok.id}`])
		expect(unshared.id).toBeGreaterThan(0)
	})

	test("one row, not two, when it also has a member in a readable book", async () => {
		const p = uniq("s1")
		const me = await mkUser()
		const owner = await mkUser()
		const card = await mkCard(owner.id, `${p} Both`)
		await share(card.id, me.id)
		const book = await mkBook(me.id)
		const m = await mkMember(book.id, card.id, `${p} Both`)

		const r = await page(me.id, p)
		expect(keys(r)).toEqual([`card:${card.id}`])
		expect(r.rows[0]).toMatchObject({
			isSharedWithMe: true,
			readableMember: { castMemberId: m.id, lorebookId: book.id }
		})
	})

	test("favorites and personas exclude it; tags filter and tag search apply", async () => {
		const p = uniq("sf")
		const me = await mkUser()
		const owner = await mkUser()
		const card = await mkCard(owner.id, `${p} Shared`, {
			isFavorite: true,
			isPersona: true
		})
		await share(card.id, me.id)
		const [tag] = await testDb
			.insert(schema.tags)
			.values({ userId: owner.id, name: `${p}Spicy` })
			.returning()
		await testDb
			.insert(schema.characterTags)
			.values({ characterId: card.id, tagId: tag!.id })

		expect(keys(await page(me.id, p, { favorites: true }))).toEqual([])
		expect(keys(await page(me.id, p, { personas: true }))).toEqual([])
		expect(keys(await page(me.id, "", { tags: [`${p}SPICY`] }))).toEqual([
			`card:${card.id}`
		])
		expect(keys(await page(me.id, "", { tags: [`${p}other`] }))).toEqual([])
		// q matches the card by a tag name though its name has no such text.
		expect(keys(await page(me.id, `${p}spic`))).toEqual([`card:${card.id}`])
	})

	test("a lorebook / session filter lists it only through a member there", async () => {
		const p = uniq("sl")
		const me = await mkUser()
		const owner = await mkUser()
		const withMember = await mkCard(owner.id, `${p} A`)
		const without = await mkCard(owner.id, `${p} B`)
		await share(withMember.id, me.id)
		await share(without.id, me.id)
		const book = await mkBook(me.id)
		await mkMember(book.id, withMember.id, `${p} A`)

		expect(keys(await page(me.id, p, { lorebookId: book.id }))).toEqual([
			`card:${withMember.id}`
		])
	})

	test("keyset paging across a page boundary yields each row once", async () => {
		const p = uniq("sp")
		const me = await mkUser()
		const owner = await mkUser()
		const book = await mkBook(me.id)
		const want: string[] = []
		for (let i = 0; i < 5; i++) {
			const own = await mkCard(me.id, `${p} ${i}a own`)
			const sh = await mkCard(owner.id, `${p} ${i}b shared`)
			await share(sh.id, me.id)
			want.push(`card:${own.id}`, `card:${sh.id}`)
		}
		const m = await mkMember(book.id, null, `${p} 9 member`)
		want.push(`member:${m.id}`)

		const seen: string[] = []
		let cursor: string | null = null
		for (let guard = 0; guard < 10; guard++) {
			const r: Awaited<ReturnType<typeof page>> = await page(
				me.id,
				p,
				{},
				{ cursor, limit: 3 }
			)
			seen.push(...keys(r))
			cursor = r.nextCursor
			if (!cursor) break
		}
		expect(seen).toEqual(want)
	})
})

describe("characterRowsPage: row fields", () => {
	test("isDefaultPersona and embeddingModel only on the asker's own card", async () => {
		const p = uniq("rf")
		const me = await mkUser()
		const owner = await mkUser()
		const mine = await mkCard(me.id, `${p} Mine`, {
			isPersona: true,
			embeddingModel: "emb-x"
		})
		await testDb
			.update(schema.characters)
			.set({ isDefaultPersona: true })
			.where(eq(schema.characters.id, mine.id))
		const his = await mkCard(owner.id, `${p} His`, {
			isPersona: true,
			embeddingModel: "emb-y"
		})
		await share(his.id, me.id)

		const r = await page(me.id, p)
		const byKey = new Map(r.rows.map((x) => [x.rowKey, x]))
		expect(byKey.get(`card:${mine.id}`)).toMatchObject({
			isDefaultPersona: true,
			embeddingModel: "emb-x",
			isSharedWithMe: false,
			ownerName: null
		})
		expect(byKey.get(`card:${his.id}`)).toMatchObject({
			isDefaultPersona: false,
			embeddingModel: null
		})
	})

	test("readableMember prefers a readable book over a story's notes; null on member rows", async () => {
		const p = uniq("rm")
		const me = await mkUser()
		const card = await mkCard(me.id, `${p} Card`)
		const sess = await testDb
			.insert(schema.sessions)
			.values({
				userId: me.id,
				isGroup: false,
				name: uniq("Story ")
			} as any)
			.returning()
		const notes = await mkBook(me.id, {
			name: "notes",
			sessionId: sess[0]!.id
		})
		const book = await mkBook(me.id)
		// The story-notes member has the lower id; the readable book's still wins.
		const inNotes = await mkMember(notes.id, card.id, `${p} Card`)
		const inBook = await mkMember(book.id, card.id, `${p} Card`)
		const back = await mkMember(book.id, null, `${p} Backdrop`)

		const r = await page(me.id, p, { inMyStories: true })
		const row = r.rows.find((x) => x.rowKey === `card:${card.id}`)!
		expect(inNotes.id).toBeLessThan(inBook.id)
		expect(row.readableMember).toEqual({
			castMemberId: inBook.id,
			lorebookId: book.id
		})
		const memberRow = r.rows.find((x) => x.rowKey === `member:${back.id}`)!
		expect(memberRow.readableMember).toBeNull()

		// A card with no member in reach carries none.
		const lone = await mkCard(me.id, `${p} Lone`)
		const loneRow = (await page(me.id, `${p} Lone`)).rows[0]!
		expect(loneRow.rowKey).toBe(`card:${lone.id}`)
		expect(loneRow.readableMember).toBeNull()
	})

	test("q matches a card by a tag name; member rows by name only", async () => {
		const p = uniq("qt")
		const me = await mkUser()
		const card = await mkCard(me.id, `${p} Plain`)
		const [tag] = await testDb
			.insert(schema.tags)
			.values({ userId: me.id, name: `${p}Wizard` })
			.returning()
		await testDb
			.insert(schema.characterTags)
			.values({ characterId: card.id, tagId: tag!.id })
		const book = await mkBook(me.id)
		await mkMember(book.id, null, `${p} Backdrop`)

		expect(keys(await page(me.id, `${p}wiz`))).toEqual([`card:${card.id}`])
	})
})
