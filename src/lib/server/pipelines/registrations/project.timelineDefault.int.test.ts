/**
 * 🚧 Story Minimal's shipped `defaults.timeline: false` reaches its core row at
 * boot and stays; an administrator's copy is never touched.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-project-timeline-default-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	// Seeds core's presets (and runs the boot's own projection once).
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const rowOf = async (where: ReturnType<typeof eq>) => {
	const [r] = await testDb.select().from(schema.sessionPresets).where(where)
	return r!
}

describe("projectRegistrations and Story Minimal's timeline default", () => {
	test("the first run forces it, a second changes nothing, an admin's copy is untouched", async () => {
		const { projectRegistrations } = await import("./project")
		const core = () => rowOf(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
		const seeded = await core()
		const oldDefaults = { ...((seeded.defaults as object | null) ?? {}) }
		delete (oldDefaults as any).timeline
		// The copy an administrator made before this build: the old defaults.
		const [copy] = await testDb
			.insert(schema.sessionPresets)
			.values({
				name: "Admin copy of Story Minimal",
				genreId: seeded.genreId,
				bindings: {},
				defaults: oldDefaults,
				enabled: true,
				isDefault: false,
				isImmutable: false
			} as any)
			.returning()
		const copyBefore = await rowOf(eq(schema.sessionPresets.id, copy!.id))
		// The core row as an older build left it.
		await testDb
			.update(schema.sessionPresets)
			.set({ defaults: oldDefaults } as any)
			.where(eq(schema.sessionPresets.id, seeded.id))

		const first = await projectRegistrations(testDb as any)
		const afterFirst = await core()
		expect((afterFirst.defaults as any).timeline).toBe(false)
		expect(first.presets.find((p) => p.seedKey === "core-story-minimal")).toBeDefined()

		const second = await projectRegistrations(testDb as any)
		expect(await core()).toEqual(afterFirst)
		expect(second.presets.find((p) => p.seedKey === "core-story-minimal")?.changed).toBe(false)
		expect(await rowOf(eq(schema.sessionPresets.id, copy!.id))).toEqual(copyBefore)
	})
})
