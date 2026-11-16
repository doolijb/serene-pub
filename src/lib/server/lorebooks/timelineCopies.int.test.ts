/**
 * 🚧 A copy of a lorebook keeps its **Timeline** switch: a duplicate, and a
 * lorebook made from a starter kit.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-timelineCopies-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0

async function offBook(kind: "book" | "starter_kit") {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `timeline-copies-${++n}`)
	const [row] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Source ${n}`, kind, timelineEnabled: false })
		.returning()
	return { user, row: row! }
}

const flagOf = async (id: number) =>
	(await testDb.select().from(schema.lorebooks).where(eq(schema.lorebooks.id, id)))[0]!.timelineEnabled

describe("copies keep the switch", () => {
	test("a duplicate of an off book is off", async () => {
		const { lorebooksDuplicateHandler } = await import("$lib/server/sockets/lorebooks")
		const { user, row } = await offBook("book")
		const { lorebook } = await lorebooksDuplicateHandler.handler(
			{ user: { id: user.id } } as any,
			{ lorebookId: row.id },
			(() => {}) as any
		)
		expect(await flagOf(lorebook.id)).toBe(false)
	})

	test("a lorebook made from an off starter kit is off", async () => {
		const { bookFromKit, resolveKit } = await import("$lib/server/lorebooks/starterKits")
		const { user, row } = await offBook("starter_kit")
		const kit = await resolveKit(testDb as unknown as Db, { lorebookId: row.id })
		const made = await testDb.transaction((tx) =>
			bookFromKit(tx as unknown as Db, kit, { userId: user.id, name: "From kit", kind: "book" })
		)
		expect(await flagOf(made.lorebookId)).toBe(false)
	})
})
