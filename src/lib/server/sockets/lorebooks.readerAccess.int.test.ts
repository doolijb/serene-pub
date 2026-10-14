/**
 * Lane A3 — a lorebook **share** reads everywhere, writes nowhere
 * (PLAN-private-messages §6.7, §9 Q3/Q4).
 *
 * A share recipient reads the book through every book-scoped read
 * (`assertReadableBook`): its entries, its row (`bookAccess: "shared"`), its
 * scenes, its graph, its story time; copies it with Duplicate (the copy is
 * theirs, unshared). Every write still answers the one refusal a stranger
 * gets, so a refusal never tells them more than a stranger learns. And an
 * owner's edit is relayed to the recipient's open tab, built as them.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { LOREBOOK_NOT_FOUND } from "$lib/server/utils/ownedBook"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

let db: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
}, 60_000)

let n = 0
/** Owner, recipient (Nia, shared), stranger; one book with one entry and a tag. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const k = n++
	const owner = await createTestUser(db, `reader-owner-${k}`)
	const nia = await createTestUser(db, `reader-nia-${k}`)
	const stranger = await createTestUser(db, `reader-stranger-${k}`)
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "Atlas" })
		.returning()
	await db
		.insert(schema.lorebookShares)
		.values({ lorebookId: book.id, userId: nia.id })
	const [tag] = await db
		.insert(schema.tags)
		.values({ userId: owner.id, name: "Maps" })
		.returning()
	await db.insert(schema.lorebookTags).values({ lorebookId: book.id, tagId: tag.id })
	const created = await call(
		(await import("./entries")).createEntryHandler,
		owner.id,
		{ entry: lore(book.id) }
	)
	expect(created.error).toBeUndefined()
	return { owner, nia, stranger, book, tag, entry: (created.res as any).entry }
}

const lore = (lorebookId: number) => ({
	typeId: WORLD_LORE_TYPE_ID,
	lorebookId,
	name: "The toll bridge",
	content: "A bridge the north road crosses.",
	keys: [],
	enabled: true,
	constant: false,
	useRegex: false,
	caseSensitive: false,
	priority: 1
})

function socket(userId: number, io?: unknown) {
	return { id: `s-${userId}`, user: { id: userId, isAdmin: false }, io } as any
}

/** Run a handler; collect what it emitted to the asker. */
async function call(handler: any, userId: number, params: unknown, io?: unknown) {
	const emitted: { event: string; data: any }[] = []
	let error: any
	const res = await handler
		.handler(socket(userId, io), params, async (event: string, data: any) => {
			emitted.push({
				event,
				data: typeof data === "function" ? await data() : data
			})
		})
		.catch((e: unknown) => {
			error = e
		})
	return { res, emitted, error }
}

describe("a share recipient reads the book", () => {
	test("entries, the book row, scenes, the graph, story time and lines", async () => {
		const { owner, nia, stranger, book, entry } = await world()
		const { entryListHandler, entryCountsHandler } = await import("./entries")
		const { lorebooksGetHandler, lorebooksListHandler, lorebookBindingListHandler } =
			await import("./lorebooks")
		const { sceneListByLorebookHandler } = await import("./scenes")
		const { narrativeGraphListHandler } = await import("./narrativeGraph")
		const { lorebookStoryTimeHandler, lorebookLinesHandler } = await import(
			"./lorebookStoryTime"
		)
		const { amendmentsListHandler } = await import("./amendments")

		const list = await call(entryListHandler, nia.id, {
			lorebookId: book.id,
			typeId: WORLD_LORE_TYPE_ID
		})
		expect(list.error).toBeUndefined()
		expect((list.res as any).entryList.map((e: any) => e.id)).toEqual([entry.id])

		const counts = await call(entryCountsHandler, nia.id, { lorebookId: book.id })
		expect(counts.error).toBeUndefined()

		const got = await call(lorebooksGetHandler, nia.id, { id: book.id })
		expect((got.res as any).lorebook).toMatchObject({
			id: book.id,
			bookAccess: "shared",
			isSharedWithMe: true
		})
		expect((got.res as any).lorebook.sharedWith).toBeUndefined()
		const mine = await call(lorebooksGetHandler, owner.id, { id: book.id })
		expect((mine.res as any).lorebook.bookAccess).toBe("owner")

		const rows = await call(lorebooksListHandler, nia.id, {})
		expect(
			(rows.res as any).lorebookList.find((b: any) => b.id === book.id)
		).toMatchObject({ bookAccess: "shared", isSharedWithMe: true })
		const ownRows = await call(lorebooksListHandler, owner.id, {})
		expect(
			(ownRows.res as any).lorebookList.find((b: any) => b.id === book.id)
		).toMatchObject({ bookAccess: "owner" })

		for (const [handler, params] of [
			[lorebookBindingListHandler, { lorebookId: book.id }],
			[sceneListByLorebookHandler, { lorebookId: book.id }],
			[narrativeGraphListHandler, { lorebookId: book.id }],
			[lorebookStoryTimeHandler, { lorebookId: book.id }],
			[lorebookLinesHandler, { lorebookId: book.id }],
			[amendmentsListHandler, { lorebookId: book.id }]
		] as const) {
			const r = await call(handler, nia.id, params)
			expect(r.error, handler.event).toBeUndefined()
			expect(r.res, handler.event).toBeTruthy()
			// A stranger: the one refusal, as if the book did not exist.
			const s = await call(handler, stranger.id, params)
			expect(s.error?.message, handler.event).toBe(LOREBOOK_NOT_FOUND)
		}
	})

	test("Duplicate: the copy is the recipient's, unshared, tags re-filed", async () => {
		const { owner, nia, stranger, book, tag } = await world()
		const { lorebooksDuplicateHandler } = await import("./lorebooks")

		const dup = await call(lorebooksDuplicateHandler, nia.id, {
			lorebookId: book.id
		})
		expect(dup.error).toBeUndefined()
		const copyId = (dup.res as any).lorebook.id
		expect(copyId).not.toBe(book.id)

		const [copy] = await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, copyId))
		expect(copy.userId).toBe(nia.id)
		expect(copy.name).toBe("Atlas (copy)")
		expect(
			await db
				.select()
				.from(schema.lorebookShares)
				.where(eq(schema.lorebookShares.lorebookId, copyId))
		).toEqual([])
		const entries = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, copyId))
		expect(entries).toHaveLength(1)

		// The copy's tag is Nia's own "Maps", never the owner's tag row.
		const links = await db
			.select({ tagId: schema.tags.id, userId: schema.tags.userId, name: schema.tags.name })
			.from(schema.lorebookTags)
			.innerJoin(schema.tags, eq(schema.tags.id, schema.lorebookTags.tagId))
			.where(eq(schema.lorebookTags.lorebookId, copyId))
		expect(links).toEqual([
			{ tagId: expect.any(Number), userId: nia.id, name: "Maps" }
		])
		expect(links[0].tagId).not.toBe(tag.id)

		// The original is untouched and still the owner's.
		const [original] = await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		expect(original.userId).toBe(owner.id)

		const refused = await call(lorebooksDuplicateHandler, stranger.id, {
			lorebookId: book.id
		})
		expect(refused.error?.message).toBe(LOREBOOK_NOT_FOUND)
	})
})

describe("every write still refuses the recipient", () => {
	test("entries:create · entries:update · lorebooks:update · lorebooks:delete · lorebooks:share", async () => {
		const { owner, nia, book, entry } = await world()
		const { createEntryHandler, updateEntryHandler } = await import("./entries")
		const { lorebooksUpdateHandler, lorebooksDeleteHandler, lorebooksShareHandler } =
			await import("./lorebooks")

		const create = await call(createEntryHandler, nia.id, { entry: lore(book.id) })
		expect(create.error?.message).toBe(LOREBOOK_NOT_FOUND)

		const update = await call(updateEntryHandler, nia.id, {
			entry: { id: entry.id, typeId: WORLD_LORE_TYPE_ID, name: "Mine now" }
		})
		// The entry-addressed refusal (`findOwnedEntry`): an entry of a book the
		// asker does not own reads as missing, exactly as a stranger's would.
		expect(update.error?.message).toBe("Entry not found or access denied.")

		const rename = await call(lorebooksUpdateHandler, nia.id, {
			lorebook: { id: book.id, name: "Mine now" }
		})
		expect(rename.error?.message).toBe(LOREBOOK_NOT_FOUND)

		const del = await call(lorebooksDeleteHandler, nia.id, { id: book.id })
		expect(del.error?.message).toBe(LOREBOOK_NOT_FOUND)

		const share = await call(lorebooksShareHandler, nia.id, {
			lorebookId: book.id,
			userIds: [nia.id]
		})
		expect(share.error?.message).toBe(LOREBOOK_NOT_FOUND)

		// Nothing moved.
		const [row] = await db
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		expect(row).toMatchObject({ name: "Atlas", userId: owner.id })
		const [kept] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, entry.id))
		expect(kept.title).toBe("The toll bridge")
		const count = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, book.id))
		expect(count).toHaveLength(1)
	})
})

describe("an owner's edit reaches the recipient's open tab", () => {
	test("entries:list is relayed to Nia, built as Nia", async () => {
		const { owner, nia, stranger, book } = await world()
		const { createEntryHandler } = await import("./entries")

		// A fake io: Nia and the stranger each have one tab wanting entries:list.
		const rooms = new Map<string, Set<string>>([
			[`user_${nia.id}`, new Set(["tab-nia"])],
			[`user_${stranger.id}`, new Set(["tab-stranger"])]
		])
		const sockets = new Map<string, any>([
			["tab-nia", { id: "tab-nia", user: { id: nia.id }, interest: new Set(["entries:list"]) }],
			[
				"tab-stranger",
				{ id: "tab-stranger", user: { id: stranger.id }, interest: new Set(["entries:list"]) }
			]
		])
		const sent: { target: string; event: string; data: any }[] = []
		const io = {
			to: (target: string) => ({
				emit: (event: string, data: any) => sent.push({ target, event, data })
			}),
			sockets: { adapter: { rooms }, sockets }
		}

		const made = await call(
			createEntryHandler,
			owner.id,
			{ entry: { ...lore(book.id), name: "The ferry" } },
			io
		)
		expect(made.error).toBeUndefined()

		const relayed = sent.filter((s) => s.event === "entries:list")
		expect(relayed.map((s) => s.target)).toEqual(["tab-nia"])
		expect(relayed[0].data.lorebookId).toBe(book.id)
		expect(relayed[0].data.entryList.map((e: any) => e.name).sort()).toEqual([
			"The ferry",
			"The toll bridge"
		])
	})
})
