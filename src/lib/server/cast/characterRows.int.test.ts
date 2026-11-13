/**
 * `characterRowsPage`: the Characters view's read (plan §34.4) — who may see
 * what, one row per character, the filters and the keyset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	newCardVersion,
	writeCastVersion
} from "$lib/server/characters/versions"
import { profileOf } from "$lib/shared/characters/profile"
import { CharacterRowsRefusal, characterRowsPage } from "./characterRows"

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
		path.join(os.tmpdir(), "serene-pub-vitest-chrrows-")
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

async function mkUser(isAdmin = false) {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: uniq("chrrows-user-"), isAdmin })
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

async function mkMember(
	bookId: number,
	opts: { cardId?: number | null; name: string; overlayOf?: number | null }
) {
	const { member } = await insertCastMember(db(), {
		lorebookId: bookId,
		characterId: opts.cardId ?? null,
		overlayOf: opts.overlayOf ?? null,
		binding: `{{char:${++n}}}`,
		name: opts.name
	})
	return member
}

async function mkSession(userId: number, name: string | null = uniq("Story ")) {
	const [s] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name } as any)
		.returning()
	const notes = await mkBook(userId, {
		name: `${name} notes`,
		sessionId: s!.id
	})
	return { session: s!, notes }
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

describe("characterRowsPage: who may see what", () => {
	test("permission matrix", async () => {
		const p = uniq("pm")
		const me = await mkUser()
		const other = await mkUser()
		const admin = await mkUser(true)

		const myCard = await mkCard(me.id, `${p} mine`)
		const hisCard = await mkCard(other.id, `${p} hers private`)
		const hisBook = await mkBook(other.id)
		await mkMember(hisBook.id, {
			cardId: hisCard.id,
			name: `${p} hers private`
		})
		await mkMember(hisBook.id, { name: `${p} hidden background` })

		const sharedBook = await mkBook(other.id)
		const sharedCard = await mkCard(other.id, `${p} shared card`)
		await mkMember(sharedBook.id, {
			cardId: sharedCard.id,
			name: `${p} shared card`
		})
		await mkMember(sharedBook.id, { name: `${p} shared background` })
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: sharedBook.id, userId: me.id })

		const kit = await mkBook(other.id, { kind: "starter_kit" })
		await mkMember(kit.id, { name: `${p} kit member` })
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: kit.id, userId: me.id })
		const myKit = await mkBook(me.id, { kind: "starter_kit" })
		await mkMember(myKit.id, { name: `${p} my kit member` })

		// A live provided book and its stamped carrier card.
		const owner = await mkUser()
		const provided = await mkBook(owner.id, { name: uniq("Provided ") })
		await testDb
			.update(schema.lorebooks)
			.set({
				extraJson: {
					provided: {
						plugin: "core",
						slug: "pm",
						version: "1",
						uuid: provided.uuid
					}
				}
			})
			.where(eq(schema.lorebooks.id, provided.id))
		const carrier = await mkCard(owner.id, `${p} carrier`)
		await testDb
			.update(schema.characters)
			.set({
				extensions: {
					serenepub: {
						provided: {
							plugin: "core",
							slug: "c",
							uuid: carrier.uuid
						}
					}
				}
			})
			.where(eq(schema.characters.id, carrier.id))
		const carried = await mkMember(provided.id, {
			cardId: carrier.id,
			name: `${p} carrier`
		})
		// A copy of a stamped card: the mark names another uuid, so it is a plain card.
		const copy = await mkCard(me.id, `${p} copy`)
		await testDb
			.update(schema.characters)
			.set({
				extensions: {
					serenepub: {
						provided: {
							plugin: "core",
							slug: "c",
							uuid: "00000000-0000-4000-8000-000000000001"
						}
					}
				}
			})
			.where(eq(schema.characters.id, copy.id))
		// A guest's view of a session's notes.
		const { session, notes } = await mkSession(other.id)
		await mkMember(notes.id, { name: `${p} story note` })
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: session.id, userId: me.id })

		const seen = await page(me.id, p, { inMyStories: false })
		const names = seen.rows.map((r) => r.shownName)
		expect(names).toContain(`${p} mine`)
		expect(names).toContain(`${p} copy`)
		expect(
			seen.rows.find((r) => r.shownName === `${p} copy`)
		).toMatchObject({
			hasCard: true,
			cardIsMine: true
		})
		expect(names).toContain(`${p} shared card`)
		expect(names).toContain(`${p} shared background`)
		expect(names).not.toContain(`${p} hers private`)
		expect(names).not.toContain(`${p} hidden background`)
		expect(names).not.toContain(`${p} kit member`)
		expect(names).not.toContain(`${p} my kit member`)
		expect(names).not.toContain(`${p} story note`)
		// The provided book's member is a member row; its carrier card is never a card row.
		const carrierRows = seen.rows.filter(
			(r) => r.shownName === `${p} carrier`
		)
		expect(carrierRows).toHaveLength(1)
		expect(carrierRows[0]).toMatchObject({
			hasCard: false,
			cardId: null,
			castMemberId: carried.id
		})

		const withStories = await page(me.id, p, { inMyStories: true })
		expect(withStories.rows.map((r) => r.shownName)).toContain(
			`${p} story note`
		)

		// An administrator sees no one else's private book.
		const adminSees = (await page(admin.id, p)).rows.map((r) => r.shownName)
		expect(adminSees).not.toContain(`${p} hers private`)
		expect(adminSees).not.toContain(`${p} hidden background`)
		// The carrier is not a card row even for its owner.
		const ownerRows = (await page(owner.id, p)).rows.filter(
			(r) => r.shownName === `${p} carrier`
		)
		expect(ownerRows.every((r) => !r.hasCard)).toBe(true)
	})
})

describe("characterRowsPage: one row per character", () => {
	test("a card and its members are one row, with its reach", async () => {
		const p = uniq("rc")
		const me = await mkUser()
		const card = await mkCard(me.id, `${p} Both`)
		const b1 = await mkBook(me.id, { name: `${p} one` })
		const b2 = await mkBook(me.id, { name: `${p} two` })
		await mkMember(b1.id, { cardId: card.id, name: `${p} Both` })
		await mkMember(b2.id, { cardId: card.id, name: `${p} Both` })
		const single = await mkCard(me.id, `${p} Single`)
		await mkMember(b1.id, { cardId: single.id, name: `${p} Single` })
		await mkCard(me.id, `${p} Unused`)
		const bare = await mkMember(b2.id, { name: `${p} Bare` })

		const r = await page(me.id, p)
		const by = (name: string) => r.rows.find((x) => x.shownName === name)!
		expect(r.rows).toHaveLength(4)
		expect(by(`${p} Both`)).toMatchObject({
			hasCard: true,
			cardId: card.id,
			castMemberId: null,
			cardIsMine: true,
			rowKey: `card:${card.id}`
		})
		expect(by(`${p} Both`).reach).toEqual({
			lorebookCount: 2,
			lorebook: null
		})
		expect(by(`${p} Single`).reach.lorebookCount).toBe(1)
		expect(by(`${p} Single`).reach.lorebook).toEqual({
			id: b1.id,
			name: `${p} one`,
			sessionId: null,
			sessionName: null
		})
		expect(by(`${p} Unused`).reach).toEqual({
			lorebookCount: 0,
			lorebook: null
		})
		expect(by(`${p} Unused`).hasOwnWords).toBe(false)
		expect(by(`${p} Bare`)).toMatchObject({
			hasCard: false,
			cardId: null,
			castMemberId: bare.id,
			hasOwnWords: true,
			rowKey: `member:${bare.id}`
		})
		expect(by(`${p} Bare`).reach.lorebook).toMatchObject({ id: b2.id })
		expect(by(`${p} Bare`).tags).toEqual([])
	})

	test("a member of a story's notes carries the session in its reach", async () => {
		const p = uniq("rs")
		const me = await mkUser()
		const { session, notes } = await mkSession(me.id, `${p} tale`)
		await mkMember(notes.id, { name: `${p} Extra` })
		const r = await page(me.id, p, { inMyStories: true })
		expect(r.rows).toHaveLength(1)
		expect(r.rows[0]!.reach.lorebook).toEqual({
			id: notes.id,
			name: `${p} tale notes`,
			sessionId: session.id,
			sessionName: `${p} tale`
		})
	})

	test("a member linked to a soft-deleted card is a member row; an overlay member has no row of its own", async () => {
		const p = uniq("rd")
		const me = await mkUser()
		const gone = await mkCard(me.id, `${p} Gone`)
		const book = await mkBook(me.id)
		const m = await mkMember(book.id, {
			cardId: gone.id,
			name: `${p} Gone`
		})
		await testDb
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(eq(schema.characters.id, gone.id))
		const live = await mkCard(me.id, `${p} Live`)
		const parent = await mkMember(book.id, {
			cardId: live.id,
			name: `${p} Live`
		})
		const { notes } = await mkSession(me.id)
		await mkMember(notes.id, {
			cardId: live.id,
			name: `${p} Live`,
			overlayOf: parent.id
		})
		const r = await page(me.id, p, { inMyStories: true })
		expect(keys(r).sort()).toEqual(
			[`card:${live.id}`, `member:${m.id}`].sort()
		)
		// The overlay member still counts toward the card row's reach.
		expect(
			r.rows.find((x) => x.cardId === live.id)!.reach.lorebookCount
		).toBe(2)
	})
})

describe("characterRowsPage: filters", () => {
	test("hasCard, favorites, personas, tags, q", async () => {
		const p = uniq("fl")
		const me = await mkUser()
		const book = await mkBook(me.id)
		const fav = await mkCard(me.id, `${p} Fav`, { isFavorite: true })
		const per = await mkCard(me.id, `${p} Per`, { isPersona: true })
		const tagged = await mkCard(me.id, `${p} Tagged`)
		const plain = await mkCard(me.id, `${p} Plain`)
		const member = await mkMember(book.id, { name: `${p} Back` })
		const pct = await mkCard(me.id, `${p} 100% pure`)
		const [t1] = await testDb
			.insert(schema.tags)
			.values({ userId: me.id, name: `${p}Red` })
			.returning()
		const [t2] = await testDb
			.insert(schema.tags)
			.values({ userId: me.id, name: `${p}Blue` })
			.returning()
		await testDb.insert(schema.characterTags).values([
			{ characterId: tagged.id, tagId: t1!.id },
			{ characterId: tagged.id, tagId: t2!.id },
			{ characterId: plain.id, tagId: t1!.id }
		])

		expect(keys(await page(me.id, p, { hasCard: false }))).toEqual([
			`member:${member.id}`
		])
		expect(
			(await page(me.id, p, { hasCard: true })).rows.every(
				(r) => r.hasCard
			)
		).toBe(true)
		expect(keys(await page(me.id, p, { favorites: true }))).toEqual([
			`card:${fav.id}`
		])
		expect(keys(await page(me.id, p, { personas: true }))).toEqual([
			`card:${per.id}`
		])
		expect(
			keys(await page(me.id, p, { tags: [`${p}red`, `${p}BLUE`] }))
		).toEqual([`card:${tagged.id}`])
		expect(
			keys(await page(me.id, p, { tags: [`${p}red`] })).sort()
		).toEqual([`card:${tagged.id}`, `card:${plain.id}`].sort())
		const tagRow = (await page(me.id, p, { tags: [`${p}red`, `${p}blue`] }))
			.rows[0]!
		expect(tagRow.tags.map((t) => t.name)).toEqual([`${p}Blue`, `${p}Red`])
		expect(keys(await page(me.id, `${p} 100%`))).toEqual([`card:${pct.id}`])
		expect(keys(await page(me.id, `${p} 100_`))).toEqual([])
		expect(keys(await page(me.id, `${p.toUpperCase()} FAV`))).toEqual([
			`card:${fav.id}`
		])
	})

	test("a non-integer id narrows to nothing", async () => {
		const me = await mkUser()
		expect((await page(me.id, "", { lorebookId: 1.5 })).rows).toEqual([])
		expect((await page(me.id, "", { sessionId: NaN })).rows).toEqual([])
	})

	test("lorebookId and sessionId", async () => {
		const p = uniq("lb")
		const me = await mkUser()
		const other = await mkUser()
		const mine = await mkBook(me.id)
		const m1 = await mkMember(mine.id, { name: `${p} A` })
		const secret = await mkBook(other.id)
		await mkMember(secret.id, { name: `${p} Secret` })
		const { session, notes } = await mkSession(me.id)
		const noteMember = await mkMember(notes.id, { name: `${p} Note` })
		const attached = await mkBook(me.id)
		const att = await mkMember(attached.id, { name: `${p} Attached` })
		await testDb
			.update(schema.sessions)
			.set({ lorebookId: attached.id })
			.where(eq(schema.sessions.id, session.id))
		const strangerSession = await mkSession(other.id)

		expect(keys(await page(me.id, p, { lorebookId: mine.id }))).toEqual([
			`member:${m1.id}`
		])
		expect((await page(me.id, p, { lorebookId: secret.id })).rows).toEqual(
			[]
		)
		// A story's own book, selected explicitly, lists with "In my stories" off.
		expect(
			keys(
				await page(me.id, p, {
					lorebookId: notes.id,
					inMyStories: false
				})
			)
		).toEqual([`member:${noteMember.id}`])
		expect(
			keys(await page(me.id, p, { sessionId: session.id })).sort()
		).toEqual([`member:${noteMember.id}`, `member:${att.id}`].sort())
		expect(
			(await page(me.id, p, { sessionId: strangerSession.session.id }))
				.rows
		).toEqual([])
	})

	test("follows: card and own", async () => {
		const p = uniq("fw")
		const me = await mkUser()
		const book = await mkBook(me.id)
		const followed = await mkCard(me.id, `${p} Followed`)
		await mkMember(book.id, { cardId: followed.id, name: `${p} Followed` })
		const told = await mkCard(me.id, `${p} Told`)
		const tm = await mkMember(book.id, {
			cardId: told.id,
			name: `${p} Told`
		})
		await writeCastVersion(db(), {
			member: tm.id,
			changes: { description: "Told in their own words." },
			writtenBy: `user:${me.id}`,
			at: { branchId: null, date: null, personalPosition: null }
		})
		const bare = await mkMember(book.id, { name: `${p} Bare` })

		const all = await page(me.id, p)
		expect(
			Object.fromEntries(
				all.rows.map((r) => [r.shownName, r.hasOwnWords])
			)
		).toEqual({
			[`${p} Followed`]: false,
			[`${p} Told`]: true,
			[`${p} Bare`]: true
		})
		expect(keys(await page(me.id, p, { follows: "card" }))).toEqual([
			`card:${followed.id}`
		])
		expect(keys(await page(me.id, p, { follows: "own" })).sort()).toEqual(
			[`card:${told.id}`, `member:${bare.id}`].sort()
		)
	})

	test("follows fills a page across batches and still pages on", async () => {
		const p = uniq("fp")
		const me = await mkUser()
		const book = await mkBook(me.id)
		for (let i = 0; i < 6; i++)
			await mkMember(book.id, { name: `${p} a${i}` })
		const c = await mkCard(me.id, `${p} z`)
		await mkMember(book.id, { cardId: c.id, name: `${p} z` })
		const seen: string[] = []
		let cursor: string | null = null
		for (let guard = 0; guard < 10; guard++) {
			const r = await page(
				me.id,
				p,
				{ follows: "card" },
				{ cursor, limit: 1 }
			)
			seen.push(...keys(r))
			if (!r.nextCursor) break
			cursor = r.nextCursor
		}
		expect(seen).toEqual([`card:${c.id}`])
	})

	test("inMyStories", async () => {
		const p = uniq("ms")
		const me = await mkUser()
		const { notes } = await mkSession(me.id)
		await mkMember(notes.id, { name: `${p} Kept` })
		expect((await page(me.id, p)).rows).toEqual([])
		expect((await page(me.id, p, { inMyStories: true })).rows).toHaveLength(
			1
		)
	})
})

describe("characterRowsPage: the keyset", () => {
	test("pages through every row once, in (name, kind, id) order, and survives inserts", async () => {
		const p = uniq("ks")
		const me = await mkUser()
		const book = await mkBook(me.id)
		const names = ["b", "d", "f", "h", "j", "l"]
		for (const nm of names) await mkCard(me.id, `${p} ${nm}`)
		const tieCard = await mkCard(me.id, `${p} d`)
		const tieMember = await mkMember(book.id, { name: `${p} d` })
		const tieCard2 = await mkCard(me.id, `${p} d`)

		const first = await page(me.id, p, {}, { limit: 2 })
		expect(first.rows).toHaveLength(2)
		expect(first.nextCursor).not.toBeNull()
		// One that sorts before the cursor and one after it, between two reads.
		const before = await mkCard(me.id, `${p} a`)
		const afterIt = await mkCard(me.id, `${p} k`)
		const all = [...keys(first)]
		let cursor = first.nextCursor
		while (cursor) {
			const r = await page(me.id, p, {}, { cursor, limit: 2 })
			all.push(...keys(r))
			cursor = r.nextCursor
		}
		expect(new Set(all).size).toBe(all.length)
		expect(all).not.toContain(`card:${before.id}`)
		expect(all).toContain(`card:${afterIt.id}`)
		const existed = (await page(me.id, p, {}, { limit: 100 })).rows
		expect(existed.map((r) => r.rowKey)).toContain(`card:${before.id}`)
		// The tie: same name, card (rank 0) by id, then the member.
		const tied = all.filter((k) =>
			[
				`card:${tieCard.id}`,
				`card:${tieCard2.id}`,
				`member:${tieMember.id}`
			].includes(k)
		)
		expect(tied).toEqual([
			...[`card:${tieCard.id}`, `card:${tieCard2.id}`].sort(),
			`member:${tieMember.id}`
		])
		// Order: names ascending.
		const order = (await page(me.id, p, {}, { limit: 100 })).rows.map(
			(r) => r.shownName
		)
		expect(order).toEqual([...order].sort())
		expect((await page(me.id, p, {}, { limit: 100 })).nextCursor).toBeNull()
	})

	test("a garbage cursor is refused", async () => {
		const me = await mkUser()
		for (const cursor of [
			"nonsense",
			Buffer.from("{}").toString("base64url"),
			Buffer.from(JSON.stringify({ n: "a", k: 2, i: 1 })).toString(
				"base64url"
			),
			Buffer.from(JSON.stringify({ n: "a", k: 0, i: 1, x: 1 })).toString(
				"base64url"
			)
		])
			await expect(
				page(me.id, "", {}, { cursor })
			).rejects.toBeInstanceOf(CharacterRowsRefusal)
	})

	test("limit is clamped", async () => {
		const p = uniq("lm")
		const me = await mkUser()
		await mkCard(me.id, `${p} a`)
		await mkCard(me.id, `${p} b`)
		expect((await page(me.id, p, {}, { limit: 0 })).rows).toHaveLength(1)
		expect((await page(me.id, p, {}, { limit: 1e9 })).rows).toHaveLength(2)
		expect(
			(await page(me.id, p, {}, { limit: Number.NaN })).rows
		).toHaveLength(2)
	})
})

describe("characterRowsPage: flags belong to the card's owner", () => {
	test("another user's card listed through a shared book shows no flags", async () => {
		const p = uniq("fg")
		const me = await mkUser()
		const owner = await mkUser()
		const folder = await testDb
			.insert(schema.characterFolders)
			.values({ userId: owner.id, name: uniq("f") } as any)
			.returning()
		const card = await mkCard(owner.id, `${p} Hers`, {
			isFavorite: true,
			isPersona: true,
			folderId: folder[0]!.id
		})
		const book = await mkBook(owner.id)
		await mkMember(book.id, { cardId: card.id, name: `${p} Hers` })
		await testDb
			.insert(schema.lorebookShares)
			.values({ lorebookId: book.id, userId: me.id })
		const r = await page(me.id, p)
		expect(r.rows).toHaveLength(1)
		expect(r.rows[0]).toMatchObject({
			hasCard: true,
			cardIsMine: false,
			isFavorite: false,
			isPersona: false,
			folderId: null
		})
		const mine = (await page(owner.id, p)).rows[0]!
		expect(mine).toMatchObject({
			cardIsMine: true,
			isFavorite: true,
			isPersona: true,
			folderId: folder[0]!.id
		})
	})

	test("a card's name and face come from its current version", async () => {
		const p = uniq("nv")
		const me = await mkUser()
		const { card, version } = await insertCard(testDb, {
			userId: me.id,
			name: `${p} Old`,
			description: "Brix is a quiet ferryman who watches the river."
		})
		await newCardVersion(testDb, card.id, {
			...profileOf(version),
			name: `${p} New`
		})
		const [file] = await testDb
			.insert(schema.files)
			.values({ userId: me.id, kind: "image", hash: uniq("h") } as any)
			.returning()
		await newCardVersion(testDb, card.id, {
			...profileOf(
				(
					await db()
						.select()
						.from(schema.characterVersions)
						.where(eq(schema.characterVersions.cardId, card.id))
						.orderBy(schema.characterVersions.number)
				).slice(-1)[0]!
			),
			faceMediaId: file!.id
		})
		const r = await page(me.id, p)
		expect(r.rows[0]).toMatchObject({
			shownName: `${p} New`,
			face: { uuid: file!.uuid, rev: file!.rev, frame: null }
		})
		expect(r.rows[0]!.summary).toContain("quiet ferryman")
	})
})
