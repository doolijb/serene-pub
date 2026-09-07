/**
 * A shipped layout keeps its identity when its name changes.
 *
 * The seeder matches core's rows on `seedKey`. That key used to include the
 * row's display name, so renaming a shipped layout minted a *different* key:
 * the seeder found nothing to update, inserted a second row, and left the
 * original in place — still in the picker, still selected by every config that
 * had chosen it, and now frozen at its old source while the code that defines
 * it moved on. Two rows for one layout, and the stale one is the one people are
 * pointing at.
 *
 * The key is the **variant** now (`wrapped` / `content`), which is structural:
 * a variable has exactly one of each and no rename changes which is which.
 *
 * These tests run against a database put back into the pre-migration state,
 * because the bug is invisible on a fresh one — a fresh install seeds the new
 * keys and agrees with itself either way. That is precisely how this survived
 * being written in the first place.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq, isNotNull } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { seedVariableTemplates } from "$lib/server/pipelines/boot/seedVariableTemplates"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	seedKeyFor
} from "$lib/server/pipelines/entities/variableLayouts"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "seed-variable-templates-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-seed-varlayouts-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const rowBySeedKey = async (key: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.seedKey, key))
	return row as { id: number; name: string; source: string } | undefined
}

describe("a renamed shipped layout is an update, not a second row", () => {
	it("refreshes the name in place and keeps the row's id", async () => {
		const t = SHIPPED_VARIABLE_TEMPLATES.find(
			(x) => x.variant === "wrapped"
		)!
		const before = await rowBySeedKey(seedKeyFor(t))

		// What a future release renaming this layout looks like from the
		// database's side: same variant key, a name that no longer matches.
		await db
			.update(schema.pipelineVariableTemplates)
			.set({ name: "Whatever it used to be called" })
			.where(eq(schema.pipelineVariableTemplates.id, before!.id))

		const report = await seedVariableTemplates(db as any)

		const after = await rowBySeedKey(seedKeyFor(t))
		expect(after!.id, "the rename minted a new row").toBe(before!.id)
		expect(after!.name).toBe(t.name)
		expect(report.refreshed).toContain(seedKeyFor(t))
		expect(report.created).toEqual([])
	})

	it("still ships exactly one row per shipped layout", async () => {
		await seedVariableTemplates(db as any)
		const seeded = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(isNotNull(schema.pipelineVariableTemplates.seedKey))
		expect(seeded.length).toBe(SHIPPED_VARIABLE_TEMPLATES.length)
		// One row per (variableId, variant), which is what the key now asserts.
		expect(new Set(seeded.map((r: any) => r.seedKey)).size).toBe(
			SHIPPED_VARIABLE_TEMPLATES.length
		)
	})
})
