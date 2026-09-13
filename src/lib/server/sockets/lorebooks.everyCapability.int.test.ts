/**
 * Every capability is on, in every book.
 *
 * The feature switches are gone (0124): a lorebook no longer stores which
 * sections it has, `system_settings` no longer holds a default, and the two
 * create paths that used to refuse — a history entry, a cast member — run on
 * any book the user owns. What survives from the switches' own suite is this
 * half: the write paths work and `lorebooks:list` reports every section's rows
 * rather than only the ones a switch admitted.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lorebook-capabilities-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}

async function createBook(userId: number, name: string) {
	const { lorebooksCreateHandler } = await import("./lorebooks")
	return lorebooksCreateHandler.handler(
		fakeSocket(userId),
		{ name } as any,
		noopEmit
	)
}

describe("a brand new lorebook", () => {
	test("takes a history entry", async () => {
		const { createEntryHandler } = await import("./entries")
		const user = await makeUser("capabilities-history")
		const { lorebook } = await createBook(user.id, "Fresh Book")

		await expect(
			createEntryHandler.handler(
				fakeSocket(user.id),
				{
					entry: {
						typeId: HISTORY_TYPE_ID,
						lorebookId: lorebook.id,
						content: "The city fell.",
						year: 812
					}
				} as any,
				noopEmit
			)
		).resolves.toBeTruthy()
	}, 60_000)

	test("takes a cast member", async () => {
		const { createLorebookBindingHandler } = await import("./lorebooks")
		const user = await makeUser("capabilities-cast")
		const { lorebook } = await createBook(user.id, "Castable Book")

		await expect(
			createLorebookBindingHandler.handler(
				fakeSocket(user.id),
				{
					lorebookBinding: {
						lorebookId: lorebook.id,
						name: "The Archivist"
					}
				} as any,
				noopEmit
			)
		).resolves.toBeTruthy()
	}, 60_000)
})

describe("lorebooks:list", () => {
	test("reports the rows of every section the book holds", async () => {
		const { createEntryHandler } = await import("./entries")
		const { createLorebookBindingHandler, lorebooksListHandler } =
			await import("./lorebooks")
		const user = await makeUser("capabilities-list-counts")
		const { lorebook } = await createBook(user.id, "Full Book")

		await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: lorebook.id,
					name: "Umber City",
					content: "A city of ash."
				}
			} as any,
			noopEmit
		)
		await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: HISTORY_TYPE_ID,
					lorebookId: lorebook.id,
					content: "The city fell.",
					year: 812
				}
			} as any,
			noopEmit
		)
		await createLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{
				lorebookBinding: {
					lorebookId: lorebook.id,
					name: "The Archivist"
				}
			} as any,
			noopEmit
		)

		const { lorebookList } = await lorebooksListHandler.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)
		const listed = lorebookList.find(
			(b: any) => b.id === lorebook.id
		) as any

		expect(listed.worldLoreEntries).toHaveLength(1)
		expect(listed.historyEntries).toHaveLength(1)
		expect(listed.lorebookBindings).toHaveLength(1)
		expect(listed.features).toBeUndefined()
	}, 60_000)
})
