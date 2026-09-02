import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, and } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "scratch-review-default-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-scratch-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
}, 300_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("scratch", () => {
	it("dumps the generate-image default config", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/generate-image"))
			.limit(1)
		console.log("SPEC", JSON.stringify(spec))
		const presets = await db
			.select()
			.from(schema.pipelinePresets)
		console.log(
			"PRESETS",
			JSON.stringify(presets.filter((p: any) => p.slug === "review-on"))
		)
		for (const p of presets.filter((p: any) => p.slug === "review-on")) {
			const vals = await db
				.select()
				.from(schema.pipelinePresetValues)
				.where(eq(schema.pipelinePresetValues.presetId, (p as any).id))
			console.log("PRESET VALUES", JSON.stringify(vals))
		}
		const [cfg] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					"pipeline-default:core:spec/generate-image"
				)
			)
			.limit(1)
		console.log("CONFIG", JSON.stringify(cfg))
		const vals = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, (cfg as any).id))
		console.log("CONFIG VALUES", JSON.stringify(vals, null, 1))
		expect(true).toBe(true)
	}, 300_000)
})
