/**
 * The Guide's shipped create configuration, re-projected so Serene greets.
 *
 * `core:spec/guide-create` writes Serene's declared greeting through its
 * `welcome` query, and the envoy it reads is a value on the spec's default
 * preset (`welcome` → `envoy: 'mascot'`). `ensureDefaultConfig` writes the
 * shipped config once, and `reconcileConfigs` back-fills a missing address from
 * the declaration rather than the preset, so a shipped config written before
 * the preset existed never learns the envoy and a new Guide session opens
 * silent. `create_guide_greeting_reprojection` (squashed away; see `migrationSql`) deletes that
 * immutable row so the next boot writes it again from the preset.
 *
 * Replays the real migration file against a database whose shipped row has
 * lost the value, then boots again.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { PRESQUASH_CHAIN } from "$lib/server/db/ledgerSpliceChain"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "create-guide-greeting-test-secret" }
})

const SEED_KEY = "pipeline-default:core:spec/guide-create"
/**
 * The same row's key as the migration names it: it was written before the
 * 2026-10-05 spec id rename (`create-guide` → `guide-create`), and the splice
 * replays it on a pre-squash database before boot renames anything.
 */
const SEED_KEY_AT_MIGRATION = "pipeline-default:core:spec/create-guide"

const boot = async () => {
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}

/** The shipped config's `welcome` params rows, keyed by path. */
const welcomeParams = async () => {
	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, SEED_KEY))
	expect(config, "guide-create has no shipped config").toBeTruthy()
	const rows = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, config.id),
				eq(schema.pipelineConfigValues.nodeKey, "welcome"),
				eq(schema.pipelineConfigValues.slot, "params")
			)
		)
	return { configId: config.id, byPath: new Map(rows.map((r) => [r.path, r.value])) }
}

/**
 * ⏳ The migration was squashed away before 0.6.0-pr-1 (archived in
 * `~/.claude/plans/ARCHIVE-drizzle-migrations-0094-0111-pr1.tar.gz`), and a
 * fresh or 0.5.3-upgraded pub never needs it. The ledger splice still replays
 * it on a pre-squash development database, from this byte-exact copy — so
 * this replay is that one, and goes when the splice goes.
 */
const migrationSql = async () => {
	const file = PRESQUASH_CHAIN.find((m) => m.tag.endsWith("_create_guide_greeting_reprojection"))
	expect(file?.sql, "no create_guide_greeting_reprojection migration").toBeTruthy()
	return file!.sql!
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-create-guide-greeting-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await boot()
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("guide-create's shipped config", () => {
	it("carries the welcome preset's envoy on a fresh install", async () => {
		const { byPath } = await welcomeParams()
		expect(byPath.get("envoy")).toBe("mascot")
	})

	it(
		"is written again from the preset after the migration, on an install that predates it",
		async () => {
			const before = await welcomeParams()
			await db
				.delete(schema.pipelineConfigValues)
				.where(
					and(
						eq(schema.pipelineConfigValues.configId, before.configId),
						eq(schema.pipelineConfigValues.nodeKey, "welcome")
					)
				)

			// A boot alone leaves the old row as it is: this is the gap.
			await boot()
			expect((await welcomeParams()).byPath.get("envoy")).toBeUndefined()

			// As a pre-squash database holds it when the splice replays.
			await db
				.update(schema.pipelineConfigs)
				.set({ seedKey: SEED_KEY_AT_MIGRATION })
				.where(eq(schema.pipelineConfigs.seedKey, SEED_KEY))
			for (const statement of (await migrationSql())
				.split("--> statement-breakpoint")
				.map((s) => s.trim())
				.filter(Boolean))
				await db.execute(sql.raw(statement))
			const [left] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.seedKey, SEED_KEY_AT_MIGRATION))
			expect(left, "the migration left the shipped row").toBeUndefined()
			await boot()

			const after = await welcomeParams()
			expect(after.configId).not.toBe(before.configId)
			expect(after.byPath.get("envoy")).toBe("mascot")
		},
		120_000
	)
})
