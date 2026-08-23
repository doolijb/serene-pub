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

/** The key scheme 0113 replaced. */
const oldKeyFor = (t: { variableId: string; name: string }) =>
	`pipeline-variable-template:${t.variableId}:${t.name}`

const migration = async () =>
	(await import("node:fs")).readFileSync(
		"drizzle/0113_variable_template_seed_keys.sql",
		"utf8"
	)

const rowBySeedKey = async (key: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.seedKey, key))
	return row as { id: number; name: string; source: string } | undefined
}

/** Put one shipped row back the way 0.6.0-pre seeded it. */
const regress = async (t: (typeof SHIPPED_VARIABLE_TEMPLATES)[number]) => {
	const before = await rowBySeedKey(seedKeyFor(t))
	expect(before, `${t.variableId}/${t.variant} was never seeded`).toBeTruthy()
	await db
		.update(schema.pipelineVariableTemplates)
		.set({ seedKey: oldKeyFor(t) })
		.where(eq(schema.pipelineVariableTemplates.id, before!.id))
	return before!
}

/**
 * The `(old, new)` pairs the migration itself names.
 *
 * Read out of the SQL rather than rebuilt from `SHIPPED_VARIABLE_TEMPLATES` and
 * today's `name`. The old keys are a *historical* fact — what earlier builds
 * actually wrote — and deriving them from current names quietly asserted that
 * no shipped layout has been renamed since. One has: the graph summary's bare
 * row went from "As written" to "JSON" when it stopped being a passthrough. The
 * migration is right to keep saying "As written", because that is what is in
 * the databases it runs against, and this test now checks the migration rather
 * than a restatement of it.
 */
const migrationPairs = async (): Promise<Array<[string, string]>> => {
	const sql = await migration()
	const named = [...sql.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map(
		(m) => [m[1]!, m[2]!] as [string, string]
	)

	// Pairs for variables this build no longer ships are dropped, not asserted
	// against. `core:var/speaker-relationships@1` split into two in 0124, so
	// its rows are gone and `0113` has nothing of its to re-key — while
	// remaining exactly right for the databases it actually runs against,
	// which is why the migration keeps naming it.
	const shipped = new Set(SHIPPED_VARIABLE_TEMPLATES.map(seedKeyFor))
	const live = named.filter(([, newKey]) => shipped.has(newKey))
	if (live.length === 0)
		throw new Error(
			"0113 names no pair this build still ships — the test would pass vacuously"
		)
	return live
}

describe("0113 re-keys the shipped layouts", () => {
	it("moves every name-keyed row onto its variant key, keeping its id", async () => {
		const pairs = await migrationPairs()
		expect(pairs.length).toBeGreaterThan(0)

		const ids = new Map<string, number>()
		for (const [oldKey, newKey] of pairs) {
			const before = await rowBySeedKey(newKey)
			expect(before, `${newKey} was never seeded`).toBeTruthy()
			await db
				.update(schema.pipelineVariableTemplates)
				.set({ seedKey: oldKey })
				.where(eq(schema.pipelineVariableTemplates.id, before!.id))
			ids.set(newKey, before!.id)
		}
		// Nothing is reachable by the new scheme while the database is regressed.
		for (const key of ids.keys()) {
			expect(await rowBySeedKey(key), `${key} resolved too early`).toBeFalsy()
		}

		await db.execute(await migration())

		for (const [key, id] of ids) {
			const row = await rowBySeedKey(key)
			expect(row, `${key} was not re-keyed`).toBeTruthy()
			// The id is the whole point: `pipeline_configs` stores row ids, so a
			// re-key that minted a new row would silently drop every selection.
			expect(row!.id, `${key} changed identity`).toBe(id)
		}
	})

	it("leaves a row alone when the variant key is already taken", async () => {
		const t = SHIPPED_VARIABLE_TEMPLATES[0]
		const keeper = await rowBySeedKey(seedKeyFor(t))
		const [intruder] = await db
			.insert(schema.pipelineVariableTemplates)
			.values({
				variableId: t.variableId,
				seedKey: oldKeyFor(t),
				name: `${t.name} (duplicate)`,
				source: t.source,
				isImmutable: true
			})
			.returning()

		await db.execute(await migration())

		// The keeper still owns the variant key, and the duplicate kept the old
		// one rather than colliding with it.
		expect((await rowBySeedKey(seedKeyFor(t)))!.id).toBe(keeper!.id)
		expect((await rowBySeedKey(oldKeyFor(t)))!.id).toBe(intruder.id)
		await db
			.delete(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, intruder.id))
	})
})

describe("a renamed shipped layout is an update, not a second row", () => {
	it("refreshes the name in place and keeps the row's id", async () => {
		const t = SHIPPED_VARIABLE_TEMPLATES.find((x) => x.variant === "wrapped")!
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
