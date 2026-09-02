/**
 * Seeded rows are identified by `seedKey`, never by `id`.
 *
 * The seed used to upsert on a hardcoded `id`. Seeded ids run 1..N and
 * `resyncIdSequences()` sets each sequence to MAX(id), so the first row a user
 * creates takes the very next id a newly added seeded row would claim — and the
 * UPDATE branch overwrites it. A "Precise (Extraction)" preset added at
 * sampling_configs id 3 destroyed a real user's config on their next boot, and
 * `isImmutable: true` left the wreckage un-editable in the UI.
 *
 * These pin the properties that make that impossible to repeat.
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
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-seedkey-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const sync = async () => (await import("./defaults")).sync()

describe("seeded rows are keyed by seedKey", () => {
	test("a user's own config survives sync() byte-for-byte", async () => {
		// The exact shape of the incident: a hand-tuned row sitting at whatever
		// id the sequence handed out, which a seeded row would once have claimed.
		const [mine] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "My Tuned Config",
				isImmutable: false,
				values: { temperature: 0.84, topK: 110, minP: 0.025 },
				enabled: ["temperature", "topK", "minP"]
			})
			.returning()

		await sync()

		const [after] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, mine.id))
		expect(after).toEqual(mine)
		expect(after.seedKey).toBeNull()
	})

	test("running sync() twice does not duplicate the built-ins", async () => {
		// The new failure shape once matching moved off `id`: if the match
		// misses, every seeded row is INSERTed again on each boot.
		await sync()
		await sync()

		const seeded = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-default"))
		expect(seeded).toHaveLength(1)

		const prompts = await testDb.select().from(schema.promptConfigs)
		const keys = prompts.map((p) => p.seedKey).filter(Boolean)
		expect(new Set(keys).size).toBe(keys.length)
	})

	test("a NEWLY ADDED default lands beside user rows without touching them", async () => {
		// The exact scenario the seedKey column exists for, and the one that
		// caused the incident: the extraction preset used to be appended at a
		// hardcoded id 3, which on any existing install was the first config the
		// user had created. Here a user row is made FIRST, so it occupies the id
		// the preset would have taken, and the preset must land elsewhere.
		const [theirs] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "Ollama",
				isImmutable: false,
				values: { temperature: 0.66 },
				enabled: ["temperature"]
			})
			.returning()

		await sync()

		const [preset] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(
				eq(
					schema.samplingConfigs.seedKey,
					"sampling-precise-extraction"
				)
			)
		expect(preset).toBeDefined()
		expect(preset.id).not.toBe(theirs.id)
		expect(preset.isImmutable).toBe(true)
		expect(preset.values.temperature).toBe(0.2)
		// Set-but-not-enabled is inert, so `enabled` matters as much as `values`.
		expect(preset.enabled).toContain("topK")
		expect(preset.enabled).toContain("topP")

		const [stillTheirs] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, theirs.id))
		expect(stillTheirs).toEqual(theirs)
	})

	test("the Default preset ships the 8192 context window", async () => {
		await sync()
		const [def] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-default"))
		// The seed states 8192 explicitly because the shape's declared default is
		// 4096, so this is a real stored value and not a resolution artefact.
		expect(def.values.contextTokens).toBe(8192)
		expect(def.enabled).toContain("contextTokens")
	})

	test("every seeded row carries a seedKey, and user rows never do", async () => {
		await sync()
		const rows = await testDb.select().from(schema.samplingConfigs)
		for (const r of rows) {
			// isImmutable and seedKey must agree: a built-in is a seed, and a
			// seed is a built-in. The incident produced a row that was flagged
			// immutable while belonging to the user, which is what made it
			// unrepairable through the UI.
			expect(!!r.seedKey).toBe(r.isImmutable)
		}
	})

	test("a seeded row edited in place is restored by the next sync", async () => {
		// The other half of the contract: seeds are owned by the app, so their
		// content re-syncs. Only the identity mechanism changed.
		await sync()
		const [def] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-default"))
		await testDb
			.update(schema.samplingConfigs)
			.set({ name: "tampered" })
			.where(eq(schema.samplingConfigs.id, def.id))

		await sync()

		const [restored] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-default"))
		expect(restored.name).toBe("Default")
		expect(restored.id).toBe(def.id) // and it is the same row, not a new one
	})
})
