/**
 * The sampling config list is ordered built-ins first, then alphabetical.
 *
 * samplingConfigsList had no `orderBy` at all, so rows came back in whatever
 * order Postgres returned them. SamplingSidebar hides that — it renders two
 * `{#each}` blocks filtered on isImmutable — but the same response also feeds
 * EditSessionForm, which renders it flat and so interleaved presets with the
 * user's own configs. Ordering once at the source fixes both, and sorts within
 * the sidebar's two groups as well (its filters preserve input order).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-sampling-order-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

describe("config list ordering", () => {
	test("immutable presets come first, each group alphabetical", async () => {
		const { samplingConfigsListHandler } = await import("./samplingConfigs")
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: "sampling-order-user", isAdmin: true })
			.returning()

		// Inserted deliberately out of order — a user config first, and names
		// that would interleave if isImmutable were ignored.
		await testDb.insert(schema.samplingConfigs).values([
			{ name: "Zephyr (mine)", isImmutable: false },
			{ name: "Default", isImmutable: true, seedKey: "t-default" },
			{ name: "Aardvark (mine)", isImmutable: false },
			{
				name: "Precise (Extraction)",
				isImmutable: true,
				seedKey: "t-precise"
			}
		])

		const res = await samplingConfigsListHandler.handler(
			fakeSocket(admin.id),
			{},
			() => {}
		)
		const rows = res.samplingConfigsList

		// Every built-in precedes every user config.
		const lastImmutable = rows.map((r) => r.isImmutable).lastIndexOf(true)
		const firstMutable = rows.map((r) => r.isImmutable).indexOf(false)
		expect(lastImmutable).toBeLessThan(firstMutable)

		const names = (immutable: boolean) =>
			rows.filter((r) => r.isImmutable === immutable).map((r) => r.name)
		expect(names(true)).toEqual(["Default", "Precise (Extraction)"])
		expect(names(false)).toEqual(["Aardvark (mine)", "Zephyr (mine)"])
	})
})
