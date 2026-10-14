/**
 * The two readers behind "Needed" and "Off", over a real database: which
 * failures count, and where the library places a job's steps.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { readJobUse, readNeededJobs } from "./jobUse"

let db: TestDb
const NOW = Date.parse("2026-10-11T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000

const IMAGE = {
	id: "text->image",
	demanded: true,
	requiredBy: [{ definitionId: "core:oracle/generate-image", version: 1, slot: "connection" }],
	optionalFor: []
}
const VISION = {
	id: "text+image->text",
	demanded: true,
	requiredBy: [{ definitionId: "core:task/caption", version: 1, slot: "connection" }],
	optionalFor: []
}

let runSeq = 0
async function run(opts: {
	definitionId: string
	result: "ok" | "err"
	at: number
	preview?: boolean
}) {
	const [row] = await db
		.insert(schema.pipelineRuns)
		.values({
			runId: `run-${++runSeq}`,
			specSlug: "core:spec/test",
			specVersion: "1.0.0",
			outcome: opts.result,
			triggerSource: "test",
			seed: "0",
			isPreview: opts.preview ?? false,
			startedAt: new Date(opts.at),
			endedAt: new Date(opts.at),
			receipt: {}
		})
		.returning()
	await db.insert(schema.pipelineRunNodes).values({
		runId: row.id,
		seq: 0,
		nodeKey: "render",
		kind: "oracle",
		definitionId: opts.definitionId,
		result: opts.result
	})
}

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("readNeededJobs", () => {
	it("needs a job only after a real run's step failed without it, within the window", async () => {
		const read = () => readNeededJobs(db as unknown as Db, [IMAGE, VISION], NOW)
		expect(await read()).toEqual({})

		// Succeeded, previewed, or too long ago: none of these count.
		await run({ definitionId: "core:oracle/generate-image@1", result: "ok", at: NOW - DAY })
		await run({ definitionId: "core:oracle/generate-image@1", result: "err", at: NOW - DAY, preview: true })
		await run({ definitionId: "core:oracle/generate-image@1", result: "err", at: NOW - 8 * DAY })
		expect(await read()).toEqual({})

		await run({ definitionId: "core:oracle/generate-image@1", result: "err", at: NOW - DAY })
		expect(await read()).toEqual({ "text->image": "failedRun" })
	}, 60_000)
})

describe("readJobUse", () => {
	it("counts placed steps on active versions, and names their pipelines and actions", async () => {
		const [spec] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug: "core:spec/test-image", name: "Generate an image" })
			.returning()
		const [version] = await db
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				canonicalHash: "hash-test-image",
				contributes: { actions: [{ key: "generate-image", label: { en: "Image" } }] }
			})
			.returning()
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: version.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		await db.insert(schema.pipelineNodes).values({
			specVersionId: version.id,
			nodeKey: "render",
			kind: "oracle",
			definitionId: "core:oracle/generate-image",
			definitionVersion: 1,
			position: 0
		})

		const use = await readJobUse(db as unknown as Db, [IMAGE, VISION])
		expect(use["text->image"]).toEqual({
			steps: 1,
			pipelines: ["Generate an image"],
			actions: ["Image"]
		})
		expect(use["text+image->text"]).toEqual({ steps: 0, pipelines: [], actions: [] })
	}, 60_000)
})
