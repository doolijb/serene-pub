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
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { isNotNull } from "drizzle-orm"
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
