import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import fsSync from "fs"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"

// The db module is mocked so `defaults.sync()` and `bootstrapPipelines` run
// against a test database, in the order `db/index.ts` guarantees at boot.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "retrieval-strategy-cull-secret" }
})

/** Does this table have this column, according to the database itself? */
const hasColumn = async (db: any, table: string, column: string) => {
	const rows: any = await db.execute(
		`SELECT 1 FROM information_schema.columns
		 WHERE table_name = '${table}' AND column_name = '${column}'`
	)
	return (rows.rows ?? rows).length > 0
}

describe("the boot that follows", () => {
	let db: TestDb

	beforeAll(async () => {
		process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
			path.join(os.tmpdir(), "serene-pub-retrieval-strategy-cull-")
		)
		db = (await import("$lib/server/db")).db as unknown as TestDb
		await (await import("$lib/server/db/defaults")).sync()
	}, 120_000)

	it("is clean, with no type re-projection to do", async () => {
		// The one way a column drop could kill an install. The entry-type
		// projection re-runs on every boot and puts CHECK constraints and a
		// `NOT VALID` foreign key over this table; a tier-one column vanishing
		// from underneath it would surface as `report.conflict` and an early
		// return — no specs seeded, pipelines dead everywhere — which is the
		// outcome 0203 had to delete four registry rows to avoid.
		//
		// Nothing declares this column, so nothing re-projects. That is the
		// difference between a column change and a contract change, stated as a
		// result rather than as reasoning: `registryHashes.test.ts` holds the
		// four pins 0203 moved, and none of them moves again here.
		const report = await bootstrapPipelines(db as any)
		expect(report.conflict, JSON.stringify(report.conflict)).toBeFalsy()
		expect(report.specs.length).toBeGreaterThan(0)
		expect(
			await hasColumn(db, "lorebook_entries", "retrieval_strategy")
		).toBe(false)
	}, 120_000)
})
