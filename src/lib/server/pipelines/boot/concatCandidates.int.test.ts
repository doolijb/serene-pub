import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// The db module is mocked so `defaults.sync()` and `bootstrapPipelines` run
// against the test database, in the order `db/index.ts` guarantees at boot.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "concat-candidates-secret" }
})

let db: TestDb
let respondSpecRow: { id: number }

const respondConfigIds = async (): Promise<number[]> =>
	(
		await db
			.select({ id: schema.pipelineConfigs.id })
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, respondSpecRow.id))
	).map((c: any) => c.id)

const deadAddresses = async () =>
	await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				inArray(
					schema.pipelineConfigValues.configId,
					await respondConfigIds()
				),
				eq(schema.pipelineConfigValues.nodeKey, "lore"),
				eq(schema.pipelineConfigValues.slot, "params")
			)
		)

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-concat-candidates-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	respondSpecRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
			.limit(1)
	)[0]
}, 120_000)

describe("the shipped reply pipeline after the bump", () => {
	it("runs its lore gather branches through the concatenating node, not the merge", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, respondSpecRow.id))
			.limit(1)

		const [node] = await db
			.select({ definitionId: schema.pipelineNodes.definitionId })
			.from(schema.pipelineNodes)
			.where(
				and(
					eq(
						schema.pipelineNodes.specVersionId,
						(spec as any).activeVersionId
					),
					eq(schema.pipelineNodes.nodeKey, "lore")
				)
			)
			.limit(1)

		expect(
			(node as any)?.definitionId,
			"the `lore` node is still fusing three disjoint gather branches, so every " +
				"signal weight downstream is inert"
		).toBe("core:task/concat-candidates")
	})

	it("declares no parameters at the `lore` node any more", async () => {
		// Both controls stored a value nothing ever read: `strategy` was 0.5's
		// engine choice, which pipelines replaced with wiring, and `dedup`
		// described what rank fusion does unconditionally.
		expect(await deadAddresses()).toEqual([])
	})
})
