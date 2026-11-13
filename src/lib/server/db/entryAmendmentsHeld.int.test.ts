/**
 * The held amendment's schema: `entry_amendments` may be undated only when it
 * is held (`base` set, no month), and `lore_imprints` carries an origin.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let bookId: number
let entryId: number
let sessionId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entry-amendments-held-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const { createTestDb, createTestUser } = await import("$lib/server/utils/testDb")
	testDb = await createTestDb()
	const userId = (await createTestUser(testDb, "amendments-held")).id
	const [book] = await testDb.insert(schema.lorebooks).values({ userId, name: "Harbour" }).returning()
	bookId = book!.id
	const [entry] = await testDb
		.insert(schema.lorebookEntries)
		.values({ lorebookId: bookId, typeId: "core:entry/location", typeVersion: 1, position: 0, title: "Docks", content: "…" })
		.returning()
	entryId = entry!.id
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: bookId } as any)
		.returning()
	sessionId = session!.id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const amend = (v: Partial<typeof schema.entryAmendments.$inferInsert>) =>
	testDb.insert(schema.entryAmendments).values({ lorebookId: bookId, entryId, fields: {}, ...v })

describe("entry_amendments undated check", () => {
	test("an undated row without a base is refused", async () => {
		await expect(amend({ year: null })).rejects.toThrow()
	})
	test("an undated row with a base and a month is refused", async () => {
		await expect(amend({ year: null, month: 3, base: { name: { v: "x" } } })).rejects.toThrow()
	})
	test("an undated held row is accepted", async () => {
		await expect(amend({ year: null, base: { name: { v: "x" } }, sourceMessageId: 7 })).resolves.toBeDefined()
	})
	test("a dated row without a base is still accepted", async () => {
		await expect(amend({ year: 2, month: 3 })).resolves.toBeDefined()
	})
})

describe("lore_imprints origin", () => {
	const imprint = (v: Record<string, unknown> = {}) =>
		testDb
			.insert(schema.loreImprints)
			.values({ sessionId, lorebookId: bookId, subjectKind: "entry", subjectId: entryId, ...v })
			.returning()
	test("defaults to run, with no batch or cause", async () => {
		const [row] = await imprint()
		expect(row).toMatchObject({ origin: "run", batch: null, cause: null })
	})
	test("an unknown origin is refused; a reserved one is accepted", async () => {
		await expect(imprint({ origin: "magic" })).rejects.toThrow()
		await expect(imprint({ origin: "apply", batch: "b1", cause: { by: 1 } })).resolves.toBeDefined()
	})
})

describe("a second boot", () => {
	test("migrating again changes nothing", async () => {
		const { migrate } = await import("drizzle-orm/pglite/migrator")
		const before = await testDb.select().from(schema.entryAmendments)
		await migrate(testDb as any, { migrationsFolder: path.resolve("drizzle") })
		const after = await testDb.select().from(schema.entryAmendments)
		expect(after).toEqual(before)
	})
})
