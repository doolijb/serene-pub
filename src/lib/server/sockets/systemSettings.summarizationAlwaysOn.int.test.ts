/**
 * Summarization is a capability, not a switch.
 *
 * The global toggle is gone (0126): `system_settings` no longer holds
 * `summarization_enabled`, the wizard step that set it is gone with it, and
 * nothing asks the instance for permission before offering a summary. What
 * that costs is a column the settings payload used to carry, so this is the
 * half that has to hold on a database built the way a real one is — the real
 * migrations, then the boot defaults sync that writes the settings row.
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

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-summarization-always-on-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** Columns of one table, as the migrated database actually has them. */
async function columnsOf(table: string): Promise<string[]> {
	const res: any = await testDb.execute(
		`SELECT column_name FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = '${table}'`
	)
	return (res.rows ?? res).map((r: any) => r.column_name as string)
}

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: true } }) as any
const noopEmit = () => {}

describe("the migrated schema", () => {
	test("has no summarization switch to read", async () => {
		expect(await columnsOf("system_settings")).not.toContain(
			"summarization_enabled"
		)
		expect(await columnsOf("setup")).not.toContain(
			"summarization_step_complete"
		)
	}, 60_000)
})

describe("systemSettings:get", () => {
	test("sends a settings row with no summarization field", async () => {
		const { systemSettingsGet } = await import("./systemSettings")
		const [user] = await testDb
			.insert(schema.users)
			.values({ username: "summarization-payload-admin", isAdmin: true })
			.returning()

		const res = await systemSettingsGet.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)

		// The row itself exists — boot's defaults sync wrote it — so an absent
		// key is the column being gone, not the query having found nothing.
		const settings = res.systemSettings as Record<string, unknown>
		expect(settings).toBeTruthy()
		expect("summarizationEnabled" in settings).toBe(false)
		// An unrelated column still rides along.
		expect("scriptsEnabled" in settings).toBe(true)
	}, 60_000)
})

describe("setup:get", () => {
	test("tracks only the step that is left", async () => {
		const { setupGet } = await import("./setup")
		const [user] = await testDb
			.insert(schema.users)
			.values({ username: "summarization-setup-user" })
			.returning()

		const { setup } = await setupGet.handler(
			fakeSocket(user.id),
			{},
			noopEmit
		)

		expect("summarizationStepComplete" in setup).toBe(false)
		expect(setup.ragStepComplete).toBe(false)

		const row = await testDb.query.setup.findFirst({
			where: eq(schema.setup.userId, user.id)
		})
		expect(row).toBeTruthy()
	}, 60_000)
})
