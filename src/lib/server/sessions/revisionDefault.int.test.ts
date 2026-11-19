/**
 * 🚧 `onRevisionDefaultFor`: a person's default for the sessions they start —
 * their own, else the pub's, else `overwrite`. Pinned as it reads today: no
 * genre or preset enters it, and nothing in the app writes either column.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-revision-default-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("onRevisionDefaultFor", () => {
	test("Overwrite for everyone while nothing is stored; the person's own beats the pub's; no genre or preset enters", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { onRevisionDefaultFor } = await import("./revision")
		const a = await createTestUser(testDb, "rev-default-a")
		const b = await createTestUser(testDb, "rev-default-b")
		expect(await onRevisionDefaultFor(testDb as any, a.id)).toBe("overwrite")
		expect(await onRevisionDefaultFor(testDb as any, null)).toBe("overwrite")

		await testDb.insert(schema.systemSettings).values({ id: 1 } as any).onConflictDoNothing()
		await testDb.update(schema.systemSettings).set({ onRevisionDefault: "branch" } as any).where(eq(schema.systemSettings.id, 1))
		expect(await onRevisionDefaultFor(testDb as any, a.id)).toBe("branch")
		expect(await onRevisionDefaultFor(testDb as any, null)).toBe("branch")

		await testDb.insert(schema.userSettings).values({ userId: b.id, onRevisionDefault: "overwrite" } as any)
		expect(await onRevisionDefaultFor(testDb as any, b.id)).toBe("overwrite")
		expect(await onRevisionDefaultFor(testDb as any, a.id)).toBe("branch")
	})
})
