/**
 * 🚧 Background routines' caps (PLAN-layering R11; lane 7): the pub's two
 * limits set by an administrator only; each person's own at most the pub's,
 * empty following it, carried on `userSettings:get` beside the pub's.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-routine-caps-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	// The pub's settings row, as a boot writes it.
	await (await import("$lib/server/db/defaults")).sync()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketOf = (id: number, isAdmin = false) => ({ user: { id, isAdmin } }) as any
const noopEmit = () => {}

describe("routine caps", () => {
	test("the pub's: an administrator's alone, in bounds", async () => {
		const { systemSettingsUpdateRoutineCaps } = await import("./systemSettings")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const member = await createTestUser(testDb, "caps-member")
		const refused = await systemSettingsUpdateRoutineCaps.handler(
			socketOf(member.id),
			{ idleTimeoutMinutes: 60, maxRunsInRow: 3 },
			noopEmit
		)
		expect(refused).toMatchObject({ success: false })
		expect(
			await systemSettingsUpdateRoutineCaps.handler(socketOf(member.id, true), { idleTimeoutMinutes: 2, maxRunsInRow: 3 }, noopEmit)
		).toMatchObject({ success: false, error: expect.stringMatching(/at least 5 minutes/) })
		const ok = await systemSettingsUpdateRoutineCaps.handler(
			socketOf(member.id, true),
			{ idleTimeoutMinutes: 600, maxRunsInRow: 6 },
			noopEmit
		)
		expect(ok).toMatchObject({ success: true, idleTimeoutMinutes: 600, maxRunsInRow: 6 })
		const [row] = await testDb.select().from(schema.systemSettings).where(eq(schema.systemSettings.id, 1))
		expect(row).toMatchObject({ cronIdleTimeoutMinutes: 600, cronMaxRunsInRow: 6 })
	}, 60_000)

	test("a person's own: at most the pub's, empty following it", async () => {
		const { userSettingsUpdateRoutineCaps, buildUserSettingsGet } = await import("./userSettings")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "caps-user")
		await buildUserSettingsGet(user.id)
		const over = await userSettingsUpdateRoutineCaps.handler(
			socketOf(user.id),
			{ idleTimeoutMinutes: 6000, maxRunsInRow: null },
			noopEmit
		)
		expect(over).toMatchObject({ success: false, error: expect.stringMatching(/at most 600, the pub's limit/) })
		const ok = await userSettingsUpdateRoutineCaps.handler(
			socketOf(user.id),
			{ idleTimeoutMinutes: 120, maxRunsInRow: null },
			noopEmit
		)
		expect(ok).toMatchObject({
			success: true,
			routineCaps: { idleTimeoutMinutes: 120, maxRunsInRow: null, system: { idleTimeoutMinutes: 600, maxRunsInRow: 6 } }
		})
		const got = await buildUserSettingsGet(user.id)
		expect(got.userSettings.routineCaps).toMatchObject({ idleTimeoutMinutes: 120, maxRunsInRow: null })
	}, 60_000)
})
