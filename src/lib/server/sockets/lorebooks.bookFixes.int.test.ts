/**
 * The book-level fixes of the 2026-09-28 lorebooks programme (lane W1-books):
 * tags saved by `lorebooks:update`, delete refusing a book it did not delete,
 * list counts for every type, the cast-member guards (no client primary key,
 * no self-parent, refusals as real sentences), a card linked to a background
 * member keeping the member's names, export disabled, and the
 * `syncLorebookBindings` race.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lb-bookfixes-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
/** An emitter that records every event, for the `:error` assertions. */
function recorder() {
	const events: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		events.push({ event, data })
	}
	return { events, emit }
}

async function makeBook(userId: number, name = "Book") {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return book
}

let position = 0
async function addEntry(lorebookId: number, data: Record<string, any>) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				lorebookId,
				position: ++position,
				content: "x",
				...data
			} as any)
		)
		.returning()
	return row
}

describe("lorebooks:update — tags (findings #12/#107)", () => {
	test("adds, removes and clears tags, and answers with them", async () => {
		const { lorebooksUpdateHandler } = await import("./lorebooks")
		const user = await makeUser("tags-user")
		const book = await makeBook(user.id)
		const save = (tags?: string[]) =>
			lorebooksUpdateHandler.handler(
				fakeSocket(user.id),
				{ lorebook: { id: book.id, ...(tags ? { tags } : {}) } },
				noopEmit
			)
		const tagsOf = async () =>
			(
				await testDb
					.select({ name: schema.tags.name })
					.from(schema.lorebookTags)
					.innerJoin(
						schema.tags,
						eq(schema.tags.id, schema.lorebookTags.tagId)
					)
					.where(eq(schema.lorebookTags.lorebookId, book.id))
			)
				.map((t) => t.name)
				.sort()

		const added = await save(["fantasy", "grim"])
		expect(added.lorebook.tags.sort()).toEqual(["fantasy", "grim"])
		expect(await tagsOf()).toEqual(["fantasy", "grim"])

		await save(["fantasy"])
		expect(await tagsOf()).toEqual(["fantasy"])

		// No `tags` at all leaves them alone.
		const untouched = await save()
		expect(untouched.lorebook.tags).toEqual(["fantasy"])

		// An empty list clears them.
		const cleared = await save([])
		expect(cleared.lorebook.tags).toEqual([])
		expect(await tagsOf()).toEqual([])
	}, 60_000)
})

describe("lorebooks:delete (finding #20)", () => {
	test("refuses a book the caller does not own, and names the deleted book", async () => {
		const { lorebooksDeleteHandler } = await import("./lorebooks")
		const owner = await makeUser("delete-owner")
		const stranger = await makeUser("delete-stranger")
		const book = await makeBook(owner.id)

		const rec = recorder()
		await expect(
			lorebooksDeleteHandler.handler(
				fakeSocket(stranger.id),
				{ id: book.id },
				rec.emit
			)
		).rejects.toThrow("Lorebook not found.")
		expect(rec.events.map((e) => e.event)).toEqual(["lorebooks:delete:error"])
		expect(
			await testDb.query.lorebooks.findFirst({
				where: (l, { eq }) => eq(l.id, book.id)
			})
		).toBeTruthy()

		const res = await lorebooksDeleteHandler.handler(
			fakeSocket(owner.id),
			{ id: book.id },
			noopEmit
		)
		expect(res.id).toBe(book.id)
	}, 60_000)
})

describe("lorebooks:list counts (finding #17)", () => {
	test("counts every type and leaves archived rows out", async () => {
		const { lorebooksListHandler } = await import("./lorebooks")
		const user = await makeUser("counts-user")
		const book = await makeBook(user.id)
		await addEntry(book.id, { typeId: WORLD_LORE_TYPE_ID, name: "W" })
		await addEntry(book.id, {
			typeId: WORLD_LORE_TYPE_ID,
			name: "Gone",
			archived: true
		})
		await addEntry(book.id, { typeId: LOCATION_TYPE_ID, name: "Inn" })
		await addEntry(book.id, { typeId: ITEM_TYPE_ID, name: "Sword" })

		const { lorebookList } = await lorebooksListHandler.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)
		const row = lorebookList.find((l) => l.id === book.id)!
		expect(row.entryCount).toBe(3)
		expect(row.entryCounts).toEqual({
			[WORLD_LORE_TYPE_ID]: 1,
			[LOCATION_TYPE_ID]: 1,
			[ITEM_TYPE_ID]: 1
		})
	}, 60_000)
})

describe("cast member guards", () => {
	test("createBinding ignores a client-supplied primary key (finding #18)", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("mass-assign-user")
		const book = await makeBook(user.id)
		const { lorebookBinding } = await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: { lorebookId: book.id, name: "N", id: 987654 }
			} as any,
			noopEmit
		)
		expect(lorebookBinding.id).not.toBe(987654)
	}, 60_000)

	test("updateBinding refuses a self-parent and a third level, as a sentence (findings #21/#22)", async () => {
		const { createLorebookBindingHandler, updateLorebookBindingHandler } =
			await import("./lorebooks")
		const user = await makeUser("self-parent-user")
		const book = await makeBook(user.id)
		const make = async (name: string) =>
			(
				await createLorebookBindingHandler.handler(
					fakeSocket(user.id),
					{ lorebookBinding: { lorebookId: book.id, name } } as any,
					noopEmit
				)
			).lorebookBinding
		const a = await make("A")
		const b = await make("B")
		const c = await make("C")

		const rec = recorder()
		await expect(
			updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { id: a.id, parentNodeId: a.id } } as any,
				rec.emit
			)
		).rejects.toThrow(/themselves/)
		const err = rec.events.find(
			(e) => e.event === "lorebooks:updateBinding:error"
		)
		expect(err?.data.error).toMatch(/cannot be filed under themselves/)

		// b under a is fine; c under b would be a third level.
		await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{ lorebookBinding: { id: b.id, parentNodeId: a.id } } as any,
			noopEmit
		)
		await expect(
			updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { id: c.id, parentNodeId: b.id } } as any,
				noopEmit
			)
		).rejects.toThrow(/already filed under someone else/)
		// a has an alias, so a cannot be filed under c.
		await expect(
			updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { id: a.id, parentNodeId: c.id } } as any,
				noopEmit
			)
		).rejects.toThrow(/aliases filed under them/)

		// The graph's own door applies the same rule.
		const { narrativeGraphUpdateNodeHandler } = await import(
			"./narrativeGraph"
		)
		await expect(
			narrativeGraphUpdateNodeHandler.handler(
				fakeSocket(user.id),
				{ node: { id: c.id, parentNodeId: c.id } } as any,
				noopEmit
			)
		).rejects.toThrow(/themselves/)
	}, 60_000)

	test("createBinding's refusal reaches the user as its own sentence", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("refusal-user")
		const rec = recorder()
		await expect(
			createLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { lorebookId: 99999999, name: "N" } } as any,
				rec.emit
			)
		).rejects.toThrow()
		expect(rec.events).toEqual([
			{
				event: "lorebooks:createBinding:error",
				data: { error: "Lorebook not found." }
			}
		])
	}, 60_000)

	test("linking a card keeps the background member's names as absorbed aliases (finding #109)", async () => {
		const { createLorebookBindingHandler, updateLorebookBindingHandler } =
			await import("./lorebooks")
		const user = await makeUser("absorb-user")
		const book = await makeBook(user.id)
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name: "Maren", description: "" })
			.returning()
		const { lorebookBinding: member } =
			await createLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{
					lorebookBinding: {
						lorebookId: book.id,
						name: "The innkeeper",
						aliases: ["barkeep"]
					}
				} as any,
				noopEmit
			)
		const { lorebookBinding: linked } =
			await updateLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{ lorebookBinding: { id: member.id, characterId: card.id } } as any,
				noopEmit
			)
		expect(linked.name).toBe("Maren")
		expect(linked.absorbedAliases).toEqual(["The innkeeper", "barkeep"])
	}, 60_000)
})

describe("export is disabled (owner ruling 2026-09-28)", () => {
	test("the handler refuses with the sentence the disabled button shows", async () => {
		const { lorebookExportHandler } = await import("./lorebooks")
		const user = await makeUser("export-user")
		const book = await makeBook(user.id)
		const rec = recorder()
		await expect(
			lorebookExportHandler.handler(
				fakeSocket(user.id),
				{ id: book.id },
				rec.emit
			)
		).rejects.toThrow(LOREBOOK_EXPORT_PAUSED)
		expect(rec.events).toEqual([
			{
				event: "lorebooks:export:error",
				data: { error: LOREBOOK_EXPORT_PAUSED }
			}
		])
	}, 60_000)
})

describe("syncLorebookBindings (finding #24)", () => {
	test("two concurrent syncs of the same new token make one row", async () => {
		const { syncLorebookBindings } = await import("./lorebooks")
		const user = await makeUser("sync-user")
		const book = await makeBook(user.id)
		await addEntry(book.id, {
			typeId: WORLD_LORE_TYPE_ID,
			name: "Mentions",
			content: "{{char:7}} was here."
		})
		await Promise.all([
			syncLorebookBindings({ lorebookId: book.id }),
			syncLorebookBindings({ lorebookId: book.id })
		])
		const rows = await testDb
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, book.id))
		expect(rows.map((r) => r.binding)).toEqual(["{{char:7}}"])
		const [after] = await testDb
			.select({ n: schema.lorebooks.nextBindingNumber })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
		expect(after.n).toBe(8)
	}, 60_000)
})
