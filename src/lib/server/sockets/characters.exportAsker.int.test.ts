/**
 * `characters:exportCard` answers the asking socket only — one emit, to that
 * socket, none to the user's room — and the handler still returns the file.
 */
import { afterAll, beforeAll, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
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
		path.join(os.tmpdir(), "serene-pub-export-asker-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

test("json and charx exports reach only the asking socket", async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, "export-asker")
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Verity", description: "A delver." })
		.returning()
	const { charactersExportCard } = await import("./characters")
	const { unzipSync } = await import("fflate")

	for (const format of ["json", "charx"] as const) {
		const emit = vi.fn()
		const socket = {
			id: "tab-1",
			user: { id: user.id },
			interest: new Set(["characters:exportCard"]),
			emit
		} as any
		const toRoom = vi.fn()
		const res = await charactersExportCard.handler(
			socket,
			{ id: character.id, format },
			toRoom
		)
		expect(toRoom).not.toHaveBeenCalled()
		expect(emit).toHaveBeenCalledTimes(1)
		expect(emit.mock.calls[0][0]).toBe("characters:exportCard")
		expect(emit.mock.calls[0][1].filename).toBe(res.filename)
		if (format === "charx")
			expect(Object.keys(unzipSync(new Uint8Array(res.blob)))).toContain(
				"card.json"
			)
	}
}, 60_000)
