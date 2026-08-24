/**
 * 3b: several koboldCppSettings updates (koboldCppSetManagedMode,
 * koboldCppSetManagedPort, etc.) previously did `.update(...).set({...})`
 * with no `.where(...)`, updating every row in the table — masked only by
 * the table being a de-facto singleton (id defaults to 1, nothing else
 * ever inserts a row). Now scoped to `.where(eq(koboldCppSettings.id, 1))`.
 * This seeds a second row to prove the scoping actually holds, not just
 * that the singleton assumption happens to still be true.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
		path.join(
			os.tmpdir(),
			"serene-pub-koboldcpp-settings-scoping-int-test-"
		)
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

function fakeAdminSocket() {
	return { user: { id: 1, isAdmin: true } } as any
}

const noopEmit = () => {}

describe("koboldCppSettings updates — WHERE-clause scoping (PGlite integration)", () => {
	test("koboldcpp:setManagedMode only changes the id=1 row, not a second row", async () => {
		const { koboldCppSetManagedMode } = await import("./koboldcpp")

		// Both handlers re-fetch systemSettings:get at the end to push the
		// updated config back to the client — needs a systemSettings row.
		await testDb.insert(schema.systemSettings).values({ id: 1 })
		await testDb.insert(schema.koboldCppSettings).values({ id: 1 })
		await testDb.insert(schema.koboldCppSettings).values({
			id: 2,
			koboldCppManagedMode: "external"
		})

		await koboldCppSetManagedMode.handler(
			fakeAdminSocket(),
			{ mode: "managed" },
			noopEmit
		)

		const row1 = await testDb.query.koboldCppSettings.findFirst({
			where: eq(schema.koboldCppSettings.id, 1)
		})
		const row2 = await testDb.query.koboldCppSettings.findFirst({
			where: eq(schema.koboldCppSettings.id, 2)
		})

		expect(row1!.koboldCppManagedMode).toBe("managed")
		// The second row must be untouched by the id=1-scoped update.
		expect(row2!.koboldCppManagedMode).toBe("external")
	})

	test("koboldcpp:setManagedPort only changes the id=1 row, not a second row", async () => {
		const { koboldCppSetManagedPort } = await import("./koboldcpp")

		await testDb
			.delete(schema.koboldCppSettings)
			.where(eq(schema.koboldCppSettings.id, 1))
		await testDb
			.delete(schema.koboldCppSettings)
			.where(eq(schema.koboldCppSettings.id, 2))
		await testDb.insert(schema.koboldCppSettings).values({ id: 1 })
		await testDb.insert(schema.koboldCppSettings).values({
			id: 2,
			koboldCppManagedPort: 6001
		})

		await koboldCppSetManagedPort.handler(
			fakeAdminSocket(),
			{ port: 7001 },
			noopEmit
		)

		const row1 = await testDb.query.koboldCppSettings.findFirst({
			where: eq(schema.koboldCppSettings.id, 1)
		})
		const row2 = await testDb.query.koboldCppSettings.findFirst({
			where: eq(schema.koboldCppSettings.id, 2)
		})

		expect(row1!.koboldCppManagedPort).toBe(7001)
		expect(row2!.koboldCppManagedPort).toBe(6001)
	})
})
