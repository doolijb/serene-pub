/**
 * Core's seeded template rows carry a namespaced **template id** (R19).
 *
 * A template row now has two identities. `seed_key` is storage identity — what
 * the seed pass matches on so a boot updates the row it wrote last time. It is
 * a bare string with no owner in it, which is fine while one party mints them
 * and useless the moment a second one does. `template_id` is the name a
 * DOCUMENT uses: `owner:template/name@N`, owned and pinned, so a spec somebody
 * else wrote can reference core's prompt and a new major is a different row
 * rather than a silent reword.
 *
 * ## What each test is for
 *
 * **Every core row gets one, and no two get the same one.** The unique index
 * would catch a collision loudly at seed time, but only on the exact catalog
 * that collides — this asserts the property over the whole shipped set, which
 * is what makes the derivation rule safe to keep applying as rows are added.
 *
 * **The derivation is the whole seed key, not its last segment.** Four of
 * core's prompt slugs name a row in three to five pools each, so the short,
 * readable id in R19's example is not available; this pins the reason so it is
 * not "simplified" back into a collision.
 *
 * **The migration and the seeder agree.** Migration 0143 backfills an upgraded
 * install in SQL, because a migration cannot call TypeScript. That is a
 * duplicated rule with teeth: if the regexp and `coreTemplateIdFor` ever
 * disagree, an upgraded install and a fresh one hold different ids for the same
 * row and every spec pinned to one of them resolves on exactly one of the two.
 * The test runs the **shipped SQL text**, read from the migration file, against
 * rows whose ids have been cleared — which is the upgrade, reproduced.
 *
 * **A row migrated from 0.5 gets none.** It carries a `seed_key` too
 * (`migrated-prompt:…`) and it came from a person's legacy configuration;
 * stamping it `core:` would claim it for core.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs"
import path from "path"
import { isNotNull, sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { coreTemplateIdFor } from "$lib/server/pipelines/entities/templateIds"
import { isTemplateId } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb

/** Every seeded row across the three template tables, as (table, key, id). */
async function seededRows(db: TestDb) {
	const out: Array<{ table: string; seedKey: string; templateId: string | null }> = []
	for (const [table, t] of [
		["pipeline_prompts", schema.pipelinePrompts],
		["pipeline_context_templates", schema.pipelineContextTemplates],
		["pipeline_variable_templates", schema.pipelineVariableTemplates]
	] as const) {
		const rows = await db
			.select({ seedKey: t.seedKey, templateId: t.templateId })
			.from(t)
			.where(isNotNull(t.seedKey))
		for (const r of rows)
			out.push({ table, seedKey: r.seedKey!, templateId: r.templateId })
	}
	return out
}

/** The UPDATE statements migration 0143 ships, read from the file it ships in. */
function backfillStatements(): string[] {
	const dir = path.resolve(process.cwd(), "drizzle")
	const file = fs
		.readdirSync(dir)
		.find((f) => f.startsWith("0143_") && f.endsWith(".sql"))
	expect(file, "migration 0143 is where the backfill lives").toBeTruthy()
	return fs
		.readFileSync(path.join(dir, file!), "utf8")
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter((s) => /^(--[^\n]*\n)*UPDATE/m.test(s) && s.includes("template_id"))
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
})

describe("core's template rows are referenceable by name", () => {
	it("gives every seeded row an id, and no two the same one", async () => {
		const rows = await seededRows(db)
		expect(
			rows.length,
			"the boot did not get as far as seeding the template rows"
		).toBeGreaterThan(30)

		const ids = new Set<string>()
		for (const r of rows) {
			expect(r.templateId, `${r.table} ${r.seedKey}`).toBe(
				coreTemplateIdFor(r.seedKey)
			)
			expect(isTemplateId(r.templateId), `${r.templateId} is a template id`).toBe(
				true
			)
			expect(ids.has(r.templateId!), `${r.templateId} is minted twice`).toBe(false)
			ids.add(r.templateId!)
		}
	})

	it("derives from the WHOLE seed key, because the last segment collides", () => {
		// `summarize-world-default` is a row in `summarize-batch`,
		// `summarize-synth` AND `name-entry`. A last-segment id would have
		// collided on the shipped catalog, and "disambiguate the ones that
		// collide" makes an id a function of which other rows exist.
		const pools = [
			"core:oracle/summarize-batch",
			"core:oracle/summarize-synth",
			"core:oracle/name-entry"
		]
		const ids = pools.map((p) =>
			coreTemplateIdFor(
				`pipeline-prompt:${p}:prompts:summarize-world-default`
			)
		)
		expect(new Set(ids).size).toBe(3)
	})

	it("is stable under punctuation, which is all the seed keys differ by", () => {
		expect(
			coreTemplateIdFor(
				"pipeline-prompt:core:task/build-planner-context:prompts:adventure-planner"
			)
		).toBe(
			"core:template/pipeline-prompt-core-task-build-planner-context-prompts-adventure-planner@1"
		)
		expect(coreTemplateIdFor("pipeline-context-template:core:default")).toBe(
			"core:template/pipeline-context-template-core-default@1"
		)
		// `@1` inside a variable id becomes `-1`; deterministic, and still unique.
		expect(
			coreTemplateIdFor(
				"pipeline-variable-template:core:var/characters@1:wrapped"
			)
		).toBe(
			"core:template/pipeline-variable-template-core-var-characters-1-wrapped@1"
		)
	})
})

describe("migration 0143's backfill and the seeder are one rule", () => {
	it("replays the shipped SQL over cleared ids and lands on the same names", async () => {
		const before = await seededRows(db)
		const wanted = new Map(before.map((r) => [r.seedKey, r.templateId]))

		// The upgrade, reproduced: rows that exist with no id yet.
		for (const table of [
			"pipeline_prompts",
			"pipeline_context_templates",
			"pipeline_variable_templates"
		])
			await db.execute(sql.raw(`UPDATE "${table}" SET "template_id" = NULL`))

		const statements = backfillStatements()
		expect(statements.length, "one UPDATE per template table").toBe(3)
		for (const statement of statements) await db.execute(sql.raw(statement))

		for (const r of await seededRows(db))
			expect(r.templateId, `${r.table} ${r.seedKey}`).toBe(
				wanted.get(r.seedKey)
			)
	})

	it("is idempotent — a second run writes nothing new", async () => {
		const before = await seededRows(db)
		for (const statement of backfillStatements())
			await db.execute(sql.raw(statement))
		expect(await seededRows(db)).toEqual(before)
	})

	it("leaves a row migrated from 0.5 unnamed, because it is not core's", async () => {
		await db.insert(schema.pipelinePrompts).values({
			nodeDefinitionId: "core:task/build-template-context",
			slot: "prompts",
			seedKey: "migrated-prompt:core:task/build-template-context#prompts:prompt_configs:7",
			name: "Somebody's 0.5 prompt",
			fields: { systemPrompt: "theirs" }
		})
		for (const statement of backfillStatements())
			await db.execute(sql.raw(statement))

		const [row] = await db
			.select({ templateId: schema.pipelinePrompts.templateId })
			.from(schema.pipelinePrompts)
			.where(
				sql`${schema.pipelinePrompts.seedKey} LIKE 'migrated-prompt:%'`
			)
			.limit(1)
		expect(row.templateId).toBeNull()
	})
})
