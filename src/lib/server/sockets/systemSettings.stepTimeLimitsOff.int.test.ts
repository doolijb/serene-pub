/**
 * 🚧 The diagnostic switch *Turn off step time limits* (lane dbg-1): the column, its reader, its admin-only
 * socket, and the standing notice per administrator, on a database built the way a real one is.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { stepTimeLimitsOff } from "$lib/server/pipelines/runtime/callTether"
import { systemSettingsUpdateStepTimeLimitsOff } from "./systemSettings"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-step-time-limits-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const KIND = "core:notification/step-time-limits-off@1"
let n = 0
async function user(isAdmin: boolean): Promise<number> {
	const [u] = await testDb
		.insert(schema.users)
		.values({ username: `stl-${n++}-${Math.random().toString(36).slice(2, 7)}`, isAdmin })
		.returning()
	return u.id
}
const rowsOf = (userId: number) =>
	testDb
		.select()
		.from(schema.notifications)
		.where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.kind, KIND)))
const socketOf = (id: number, isAdmin: boolean) => ({ user: { id, isAdmin } }) as any
const call = (socket: any, params: any) =>
	systemSettingsUpdateStepTimeLimitsOff.handler(socket, params, () => {})

describe("step time limits switch", () => {
	test("is off by default", async () => {
		const [row] = await testDb.select().from(schema.systemSettings).where(eq(schema.systemSettings.id, 1))
		expect(row.stepTimeLimitsOff).toBe(false)
		expect(await stepTimeLimitsOff(testDb as any)).toBe(false)
	}, 60_000)

	test("a member is refused and nothing is written", async () => {
		const member = await user(false)
		await expect(call(socketOf(member, false), { enabled: true })).rejects.toThrow(
			"Only an administrator can turn step time limits on or off."
		)
		expect(await stepTimeLimitsOff(testDb as any)).toBe(false)
		expect(await rowsOf(member)).toEqual([])
	}, 60_000)

	test("anything but on or off is refused", async () => {
		const admin = await user(true)
		await expect(call(socketOf(admin, true), { enabled: "yes" })).rejects.toThrow("Say on or off.")
		expect(await stepTimeLimitsOff(testDb as any)).toBe(false)
	}, 60_000)

	test("on raises one notice per administrator, off clears them as acted", async () => {
		const admin1 = await user(true)
		const admin2 = await user(true)
		const member = await user(false)

		const on: any = await call(socketOf(admin1, true), { enabled: true })
		expect(on).toEqual({ success: true, enabled: true })
		expect(await stepTimeLimitsOff(testDb as any)).toBe(true)
		for (const a of [admin1, admin2]) {
			const rows = await rowsOf(a)
			expect(rows.filter((r) => r.clearedAt === null)).toHaveLength(1)
		}
		expect(await rowsOf(member)).toEqual([])

		await call(socketOf(admin1, true), { enabled: false })
		expect(await stepTimeLimitsOff(testDb as any)).toBe(false)
		for (const a of [admin1, admin2]) {
			const rows = await rowsOf(a)
			expect(rows.filter((r) => r.clearedAt === null)).toHaveLength(0)
			expect(rows.at(-1)?.clearedHow).toBe("acted")
		}
	}, 60_000)
})
