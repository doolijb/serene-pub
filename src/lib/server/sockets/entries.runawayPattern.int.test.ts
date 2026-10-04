/**
 * A runaway pattern is refused on write (plan lorebooks-consolidation S3):
 * `entries:create`, `entries:update` and an entry amendment, through the real
 * handlers — and an entry that already held one stays editable.
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
		path.join(os.tmpdir(), "serene-pub-entries-runaway-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
const REFUSED = /The pattern “\(a\+\)\+\$” can't be saved/

async function setup(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, username)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `${username} book`, userId: user.id })
		.returning()
	return { user, book }
}

const storedKeys = async (id: number) =>
	(
		await testDb
			.select({ keys: schema.lorebookEntries.keys })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!.keys

describe("runaway patterns on write (S3)", () => {
	test("create, update and amendment refuse one; the row is left as it was", async () => {
		const { createEntryHandler, updateEntryHandler } = await import("./entries")
		const { amendmentsCreateHandler } = await import("./amendments")
		const { user, book } = await setup("runaway-writes")

		await expect(
			createEntryHandler.handler(
				fakeSocket(user.id),
				{
					entry: {
						typeId: WORLD_LORE_TYPE_ID,
						lorebookId: book.id,
						name: "Runaway",
						content: "",
						keys: ["(a+)+$"],
						matchMode: "regex"
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(REFUSED)

		const { entry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book.id,
					name: "Safe",
					content: "",
					keys: ["\\bdragons?\\b"],
					matchMode: "regex"
				} as any
			},
			noopEmit
		)

		await expect(
			updateEntryHandler.handler(
				fakeSocket(user.id),
				{
					entry: {
						typeId: WORLD_LORE_TYPE_ID,
						id: entry.id,
						keys: ["\\bdragons?\\b", "(a+)+$"]
					} as any
				},
				noopEmit
			)
		).rejects.toThrow(REFUSED)
		expect(await storedKeys(entry.id)).toEqual(["\\bdragons?\\b"])

		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					entryId: entry.id,
					year: 3,
					fields: { keys: ["(a+)+$"] }
				},
				noopEmit
			)
		).rejects.toThrow(REFUSED)
	}, 60_000)

	test("amendments are judged together: the mode from one, the keys from another", async () => {
		const { createEntryHandler, updateEntryHandler } = await import("./entries")
		const { amendmentsCreateHandler, amendmentsUpdateHandler } = await import(
			"./amendments"
		)
		const { user, book } = await setup("runaway-layers")
		const { entry } = await createEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book.id,
					name: "Plain",
					content: "",
					keys: ["dragon"]
				} as any
			},
			noopEmit
		)
		// Plain text at its date, so it is only a string: allowed.
		const listed = await amendmentsCreateHandler.handler(
			fakeSocket(user.id),
			{ lorebookId: book.id, entryId: entry.id, year: 3, fields: { keys: ["(a+)+$"] } },
			noopEmit
		)
		const keysOverlay = listed.entries.find((a: any) => a.entryId === entry.id)!
		// A later overlay that only switches to regex would read it as one.
		await expect(
			amendmentsCreateHandler.handler(
				fakeSocket(user.id),
				{ lorebookId: book.id, entryId: entry.id, year: 5, fields: { matchMode: "regex" } },
				noopEmit
			)
		).rejects.toThrow(REFUSED)
		// So would the row itself switching.
		await expect(
			updateEntryHandler.handler(
				fakeSocket(user.id),
				{ entry: { typeId: WORLD_LORE_TYPE_ID, id: entry.id, useRegex: true } as any },
				noopEmit
			)
		).rejects.toThrow(REFUSED)
		// And the overlay rewritten to carry both.
		await expect(
			amendmentsUpdateHandler.handler(
				fakeSocket(user.id),
				{
					lorebookId: book.id,
					id: keysOverlay.id,
					subject: "entry",
					fields: { keys: ["(a+)+$"], matchMode: "regex" }
				},
				noopEmit
			)
		).rejects.toThrow(REFUSED)
		// An ordinary edit of the entry still saves.
		const { entry: edited } = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{ entry: { typeId: WORLD_LORE_TYPE_ID, id: entry.id, content: "edited" } as any },
			noopEmit
		)
		expect(edited.content).toBe("edited")
	}, 60_000)

	test("an entry that already held one can still have its content edited", async () => {
		const { updateEntryHandler } = await import("./entries")
		const { user, book } = await setup("runaway-legacy")
		// Written before the check existed: straight into the table.
		const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
		const [row] = await testDb
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: WORLD_LORE_TYPE_ID,
					lorebookId: book.id,
					name: "Legacy",
					content: "old",
					keys: ["(a+)+$"],
					matchMode: "regex",
					position: 1
				} as any)
			)
			.returning()

		const { entry } = await updateEntryHandler.handler(
			fakeSocket(user.id),
			{
				entry: {
					typeId: WORLD_LORE_TYPE_ID,
					id: row!.id,
					keys: ["(a+)+$"],
					matchMode: "regex",
					content: "new"
				} as any
			},
			noopEmit
		)
		expect(entry.content).toBe("new")
	}, 60_000)
})
