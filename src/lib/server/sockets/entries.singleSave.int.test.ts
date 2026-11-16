/**
 * A save costs one entry, not one book (perf-C).
 *
 *  - `entries:update` of one entry sends the targeted event and no
 *    `entries:list`; that event carries every field a list row carries.
 *  - `syncLorebookBindings` given the saved entry mints the rows the full scan
 *    minted for that entry's new tags.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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
		path.join(os.tmpdir(), "serene-pub-entries-singlesave-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function makeLorebook(userId: number, name: string) {
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name, userId })
		.returning()
	return lorebook
}

/** A fake emitter that resolves thunks as the real one does and keeps what was sent. */
function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	const emit = async (event: string, data: any) => {
		const resolved = typeof data === "function" ? await data() : data
		sent.push({ event, data: resolved })
		return resolved
	}
	return { sent, emit: emit as any }
}

const bytes = (data: unknown) => JSON.stringify(data).length

describe("a single-entry save", () => {
	test("sends the targeted event and no entries:list, and the event carries every list-row field", async () => {
		const { createEntryHandler, updateEntryHandler, entryListHandler } =
			await import("./entries")
		const { DEFAULT_VECTOR_NAME } = await import(
			"$lib/server/utils/lorebookEntries"
		)
		const user = await makeUser("single-save-user")
		const book = await makeLorebook(user.id, "Single Save Book")
		const quiet = recorder()
		let target: any
		for (let i = 0; i < 20; i++) {
			const { entry } = await createEntryHandler.handler(
				fakeSocket(user.id),
				{
					entry: {
						typeId: WORLD_LORE_TYPE_ID,
						lorebookId: book.id,
						name: `Place ${i}`,
						content: `A place numbered ${i}, with some prose to weigh.`,
						keys: [`place${i}`]
					} as any
				},
				quiet.emit
			)
			target = entry
		}
		// A vector, so the list row's embedding triple is not all null.
		await testDb.insert(schema.lorebookEntryVectors).values({
			entryId: target.id,
			vectorName: DEFAULT_VECTOR_NAME,
			dims: 3,
			vector: [0.1, 0.2, 0.3],
			model: "test-model"
		} as any)

		const loud = recorder()
		await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					id: target.id,
					keys: ["renamed"]
				} as any
			},
			loud.emit
		)

		expect(loud.sent.map((s) => s.event)).not.toContain("entries:list")
		const targeted = loud.sent.find((s) => s.event === "entries:update")!
		const list = await entryListHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, typeId: WORLD_LORE_TYPE_ID } as any,
			(() => {}) as any
		)
		const row = list.entryList.find((r: any) => r.id === target.id)!
		for (const field of Object.keys(row))
			expect(targeted.data.entry, field).toHaveProperty(field)
		expect(targeted.data.entry.embeddingModel).toBe("test-model")
		expect(targeted.data.entry.keys).toEqual(["renamed"])

		const after = loud.sent.reduce((n, s) => n + bytes(s.data), 0)
		const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
		const [stored] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, target.id))
		const before = bytes({ entry: toEntryRow(stored) }) + bytes(list)
		console.log(`PERF-C save bytes before=${before} after=${after}`)
		expect(after).toBeLessThan(before)
	}, 60_000)
})

describe("syncLorebookBindings with the saved entry", () => {
	test("mints for that entry's new tags the rows the full scan minted", async () => {
		const { syncLorebookBindings } = await import("./lorebooks")
		const user = await makeUser("single-sync-user")
		const content = "{{char:40}} meets {{char:41}} and {{char:40}}."
		const full = await makeLorebook(user.id, "Full scan")
		const one = await makeLorebook(user.id, "One entry")
		for (const book of [full, one])
			await testDb.insert(schema.lorebookEntries).values({
				lorebookId: book.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				title: "T",
				content,
				keys: [],
				position: 1
			} as any)
		// Another entry, naming a tag the saved one does not: the entry scan
		// leaves it to its own save.
		await testDb.insert(schema.lorebookEntries).values({
			lorebookId: one.id,
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			title: "Other",
			content: "{{char:50}}",
			keys: [],
			position: 2
		} as any)

		await syncLorebookBindings({ lorebookId: full.id })
		await syncLorebookBindings({ lorebookId: one.id, entry: { content } })

		const bindingsOf = async (id: number) =>
			(
				await testDb
					.select({ binding: schema.lorebookBindings.binding })
					.from(schema.lorebookBindings)
					.where(eq(schema.lorebookBindings.lorebookId, id))
			)
				.map((r) => r.binding)
				.sort()
		const fullRows = await bindingsOf(full.id)
		expect(fullRows.length).toBe(2)
		expect(await bindingsOf(one.id)).toEqual(fullRows)
		const [after] = await testDb
			.select({ next: schema.lorebooks.nextBindingNumber })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, one.id))
		expect(after.next).toBe(42)
	}, 60_000)
})

describe("reorderEntries in two statements", () => {
	test("a rotation of three positions lands, and a repeated id keeps its last position", async () => {
		const { reorderEntries } = await import("./entries")
		const user = await makeUser("reorder-user")
		const book = await makeLorebook(user.id, "Reorder Book")
		const ids: number[] = []
		for (const position of [1, 2, 3]) {
			const [row] = await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book.id,
					typeId: WORLD_LORE_TYPE_ID,
					typeVersion: 1,
					title: `R${position}`,
					content: "",
					keys: [],
					position
				} as any)
				.returning()
			ids.push(row.id)
		}
		await reorderEntries([
			{ id: ids[0], position: 2 },
			{ id: ids[1], position: 3 },
			{ id: ids[2], position: 1 },
			{ id: ids[2], position: 1 }
		])
		const rows = await testDb
			.select({
				id: schema.lorebookEntries.id,
				position: schema.lorebookEntries.position
			})
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, book.id))
		const at = new Map(rows.map((r) => [r.id, r.position]))
		expect([ids[0], ids[1], ids[2]].map((id) => at.get(id))).toEqual([
			2, 3, 1
		])
	}, 60_000)
})
