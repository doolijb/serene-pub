import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { audiocppSettings } from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { AUDIOCPP_DEFAULT_PORT, ensureAudioCppSettings } from "./settings"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client
		.close()
		.catch(() => {})
})

const count = async () => (await db.select().from(audiocppSettings)).length

describe("ensureAudioCppSettings", () => {
	test("first call inserts one row with defaults", async () => {
		const row = await ensureAudioCppSettings(db as never)
		expect(row.port).toBe(AUDIOCPP_DEFAULT_PORT)
		expect(row.port).toBe(5002)
		expect(row.enabled).toBe(false)
		expect(row.subprocessTimeoutMinutes).toBe(30)
		expect(await count()).toBe(1)
	}, 60_000)

	test("second call returns the same row", async () => {
		const a = await ensureAudioCppSettings(db as never)
		const b = await ensureAudioCppSettings(db as never)
		expect(b.id).toBe(a.id)
		expect(await count()).toBe(1)
	}, 60_000)

	test("concurrent calls on an empty table converge on the oldest row", async () => {
		await db.delete(audiocppSettings)
		const rows = await Promise.all([
			ensureAudioCppSettings(db as never),
			ensureAudioCppSettings(db as never),
			ensureAudioCppSettings(db as never)
		])
		const all = await db.select().from(audiocppSettings)
		const oldest = Math.min(...all.map((r) => r.id))
		for (const r of rows) expect(r.id).toBe(oldest)
	}, 60_000)
})
