/**
 * 🚧 Core's shipped scripts (2026-10-15): seeded by seed key, refreshed when
 * they drift, never over a person's row — and named by seed key in a spec's
 * author preset, so the shipped config holds this install's row id.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	CORE_SCRIPTS,
	DUNGEON_CRAWLER_INTERVIEW_SCRIPT,
	DUNGEON_CRAWLER_INTERVIEW_SPEC_ID,
	DUNGEON_CRAWLER_ROUND_SCRIPT,
	DUNGEON_CRAWLER_TURN_ORDER_SPEC_ID
} from "@serene-pub/core-catalog"
import { seedCoreScripts, scriptIdFor } from "./seedScripts"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "seed-scripts-test-secret" }
})

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-seed-scripts-test-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("./bootstrap")
	await bootstrapPipelines(db)
}, 180_000)

/** The shipped config's value at one address of one spec. */
async function shippedValue(specSlug: string, nodeKey: string, slot: string, p: string) {
	const [config] = await db
		.select({ id: schema.pipelineConfigs.id })
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, `pipeline-default:${specSlug}`))
	const [row] = await db
		.select({ value: schema.pipelineConfigValues.value })
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, config!.id),
				eq(schema.pipelineConfigValues.nodeKey, nodeKey),
				eq(schema.pipelineConfigValues.slot, slot),
				eq(schema.pipelineConfigValues.path, p)
			)
		)
	return row?.value
}

describe("core's shipped scripts", () => {
	it("boot seeds every one by seed key, immutable; a second pass changes nothing", async () => {
		for (const s of CORE_SCRIPTS) {
			const [row] = await db
				.select()
				.from(schema.pipelineScripts)
				.where(eq(schema.pipelineScripts.seedKey, s.seedKey))
			expect(row, s.seedKey).toBeDefined()
			expect(row!.isImmutable).toBe(true)
			expect(row!.typeId).toBe(s.typeId)
			expect(row!.source).toBe(s.source)
			expect(row!.varsIn).toEqual([...s.varsIn])
		}
		const again = await seedCoreScripts(db as any)
		expect(again.created).toEqual([])
		expect(again.refreshed).toEqual([])
		expect(again.present).toHaveLength(CORE_SCRIPTS.length)
	})

	it("a drifted row is corrected; a person's row of the same name is never touched, the shipped one yields", async () => {
		const key = DUNGEON_CRAWLER_ROUND_SCRIPT.seedKey
		await db
			.update(schema.pipelineScripts)
			.set({ source: "return selection", isImmutable: false })
			.where(eq(schema.pipelineScripts.seedKey, key))
		// A person's script holding the catalogue's name, after a rename of ours.
		await db
			.update(schema.pipelineScripts)
			.set({ name: "Renamed" })
			.where(eq(schema.pipelineScripts.seedKey, key))
		const [mine] = await db
			.insert(schema.pipelineScripts)
			.values({
				typeId: DUNGEON_CRAWLER_ROUND_SCRIPT.typeId,
				name: DUNGEON_CRAWLER_ROUND_SCRIPT.name,
				source: "return selection"
			})
			.returning()
		const out = await seedCoreScripts(db as any)
		expect(out.refreshed).toEqual([key])
		const [shipped] = await db
			.select()
			.from(schema.pipelineScripts)
			.where(eq(schema.pipelineScripts.seedKey, key))
		expect(shipped!.source).toBe(DUNGEON_CRAWLER_ROUND_SCRIPT.source)
		expect(shipped!.isImmutable).toBe(true)
		expect(shipped!.name).toBe(`${DUNGEON_CRAWLER_ROUND_SCRIPT.name} (Built-in)`)
		const [theirs] = await db
			.select()
			.from(schema.pipelineScripts)
			.where(eq(schema.pipelineScripts.id, mine!.id))
		expect(theirs!.source).toBe("return selection")
		expect(theirs!.seedKey).toBeNull()
	})

	it("a spec's preset names a script by seed key; the shipped config holds this install's row id", async () => {
		const round = await scriptIdFor(db as any, DUNGEON_CRAWLER_ROUND_SCRIPT.seedKey)
		expect(round).toBeTypeOf("number")
		expect(await shippedValue(DUNGEON_CRAWLER_TURN_ORDER_SPEC_ID, "strategy", "scripts", "select")).toEqual([round])
		const step = await scriptIdFor(db as any, DUNGEON_CRAWLER_INTERVIEW_SCRIPT.seedKey)
		expect(await shippedValue(DUNGEON_CRAWLER_INTERVIEW_SPEC_ID, "step", "scripts", "")).toEqual([step])
	})
})
