/**
 * One image sampling preset per model family, and the numbers each one ships.
 *
 * The single image row used to carry `values: {}` — i.e. the shape's declared
 * defaults of 1024², 25 steps, CFG 5, which describe SDXL. A user running
 * sdxs-512-tinySDdistilled (512-native and guidance-distilled) got melted,
 * duplicated output from exactly that: an SD1.5-class model rendered at 1024
 * duplicates the subject, and a distilled model at CFG 5 burns.
 *
 * Every number here is a matched set chosen for its family, so the value most
 * likely to be "tidied" — CFG 1 on the guidance-distilled families, which looks
 * like a placeholder and is not — fails here rather than in somebody's render.
 *
 * ⚠ Its own file, on a PRISTINE database, deliberately. sync() only reaches the
 * `text->image` registration if the whole seeding block succeeded, so asserting
 * it means asserting the fresh-install path end to end. A test file that creates
 * sampling rows before the first sync() is handed id 2 by the sequence and
 * collides with the "Disabled" seed's explicit legacy id — a test-database
 * artefact (a real install has always had the seeds at 1 and 2), but one that
 * aborts the seeding block and would make this assertion measure the artefact
 * instead of the code.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { byCapability } from "$lib/server/connections/capabilityDefaults"
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
		path.join(os.tmpdir(), "serene-pub-image-presets-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const sync = async () => (await import("./defaults")).sync()

const IMAGE_PRESETS: Record<
	string,
	{ name: string; values: Record<string, number> }
> = {
	"sampling-image-default": {
		name: "SD 1.5",
		values: { steps: 25, cfg: 7, width: 512, height: 512 }
	},
	"sampling-image-sdxl": {
		name: "SDXL",
		values: { steps: 30, cfg: 6, width: 1024, height: 1024 }
	},
	"sampling-image-sd3": {
		name: "SD 3.x",
		values: { steps: 28, cfg: 4.5, width: 1024, height: 1024 }
	},
	"sampling-image-flux": {
		name: "Flux",
		values: { steps: 20, cfg: 1, width: 1024, height: 1024 }
	},
	"sampling-image-turbo": {
		name: "Turbo / Distilled",
		values: { steps: 4, cfg: 1, width: 512, height: 512 }
	}
}

const IMAGE_ENABLED = ["steps", "cfg", "width", "height", "batch", "seed"]

const bySeedKey = async (seedKey: string) => {
	const [row] = await testDb
		.select()
		.from(schema.samplingConfigs)
		.where(eq(schema.samplingConfigs.seedKey, seedKey))
	return row
}

describe("image sampling presets", () => {
	test("every family ships its whole matched set of numbers", async () => {
		await sync()
		for (const [seedKey, expected] of Object.entries(IMAGE_PRESETS)) {
			const row = await bySeedKey(seedKey)
			expect(row, seedKey).toBeDefined()
			expect(row.name).toBe(expected.name)
			expect(row.isImmutable).toBe(true)
			expect(row.shape).toBe("core:shape/image-gen@1")
			// toEqual, not toMatchObject: a preset that quietly grew a key — or
			// lost one back to "just take the declared default" — is precisely
			// the state being repaired.
			expect(row.values, seedKey).toEqual(expected.values)
			expect(row.enabled, seedKey).toEqual(IMAGE_ENABLED)
		}
	}, 60_000)

	test("CFG 1 is deliberate on the guidance-distilled families", async () => {
		// Flux and the turbo/distilled family bake the guidance signal into the
		// weights, so classifier-free guidance is applied on top of it. Raising
		// this off 1 burns them — blown highlights, posterised colour.
		await sync()
		expect((await bySeedKey("sampling-image-flux")).values.cfg).toBe(1)
		expect((await bySeedKey("sampling-image-turbo")).values.cfg).toBe(1)
	}, 60_000)

	test("no preset guesses a sampler or a scheduler", async () => {
		// Which names are valid is a property of the connection's checkpoint and
		// build, so the only backend-independent answer is "whatever it already
		// uses". Both halves matter: an ENABLED key with no stored value resolves
		// to the schema's default and is sent anyway.
		await sync()
		for (const seedKey of Object.keys(IMAGE_PRESETS)) {
			const row = await bySeedKey(seedKey)
			expect(row.values, seedKey).not.toHaveProperty("sampler")
			expect(row.values, seedKey).not.toHaveProperty("scheduler")
			expect(row.enabled, seedKey).not.toContain("sampler")
			expect(row.enabled, seedKey).not.toContain("scheduler")
		}
	}, 60_000)

	test("the five are five distinct rows", async () => {
		await sync()
		const ids = new Set<number>()
		for (const seedKey of Object.keys(IMAGE_PRESETS))
			ids.add((await bySeedKey(seedKey)).id)
		expect(ids.size).toBe(5)
	}, 60_000)

	test("nothing is seeded twice on a second boot", async () => {
		await sync()
		await sync()
		const rows = await testDb.select().from(schema.samplingConfigs)
		const imageKeys = rows
			.map((r) => r.seedKey)
			.filter((k): k is string => !!k && k.startsWith("sampling-image"))
		expect(new Set(imageKeys).size).toBe(imageKeys.length)
		expect(imageKeys).toHaveLength(5)
	}, 60_000)

	test("'Default (Image)' is RETARGETED in place, not replaced", async () => {
		// The upgrade contract, and the reason no row was deleted:
		// `sampling-image-default` holds the instance's text->image sampling
		// default and may also be named by a pipeline node or a session
		// override. Put the row back the way an install from before this change
		// set holds it, then sync and prove the SAME row was rewritten rather
		// than a new seedKey landing beside a stranded one.
		await sync()
		const before = await bySeedKey("sampling-image-default")
		await testDb
			.update(schema.samplingConfigs)
			.set({ name: "Default (Image)", values: {} })
			.where(eq(schema.samplingConfigs.id, before.id))

		await sync()

		const rows = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.seedKey, "sampling-image-default"))
		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe(before.id)
		expect(rows[0].name).toBe("SD 1.5")
		expect(rows[0].values).toEqual({
			steps: 25,
			cfg: 7,
			width: 512,
			height: 512
		})
	}, 60_000)

	test("the instance's text->image sampling default is the SD 1.5 row", async () => {
		// SD 1.5 is the shipped default because it is the safest of the five:
		// 512² avoids the worst failure mode outright, SDXL at 512 is soft rather
		// than broken, and CFG 7 suits the largest share of local models.
		//
		// This also proves the retarget needed no change to the registration
		// code: it still resolves by seedKey, and the seedKey did not move.
		await sync()
		const sd15 = await bySeedKey("sampling-image-default")
		const [registered] = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("text->image"))
		expect(registered).toBeDefined()
		expect(registered.samplingConfigId).toBe(sd15.id)
	}, 60_000)

	test("a user's own image config is never given a preset's numbers", async () => {
		// The seeding rule this table's history is built on, restated for the
		// four rows added here: they carry no `id`, so the sequence assigns, and
		// a user row can never be mistaken for one.
		await sync()
		const [mine] = await testDb
			.insert(schema.samplingConfigs)
			.values({
				name: "My Portrait Preset",
				shape: "core:shape/image-gen@1",
				values: { steps: 12, cfg: 2.5 },
				enabled: ["steps", "cfg"]
			})
			.returning()

		await sync()

		const [after] = await testDb
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, mine.id))
		expect(after).toEqual(mine)
		expect(after.seedKey).toBeNull()
	}, 60_000)
})
