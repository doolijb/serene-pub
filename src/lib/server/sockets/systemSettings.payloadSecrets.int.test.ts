/**
 * The settings payload every client receives carries no credential material: not the recovery key's hash, not
 * the managed KoboldCpp admin password, not the CharaVault token columns.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { buildSystemSettingsGet } from "./systemSettings"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-settings-payload-secrets-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

describe("the settings payload", () => {
	test("never carries the recovery key's hash", async () => {
		const HASH = "f".repeat(64)
		await testDb.update(schema.systemSettings).set({ recoveryKeyHash: HASH }).where(eq(schema.systemSettings.id, 1))
		const payload = await buildSystemSettingsGet()
		const wire = JSON.stringify(payload)
		expect(wire).not.toContain(HASH)
		expect(wire).not.toContain("recoveryKeyHash")
	}, 60_000)
})
