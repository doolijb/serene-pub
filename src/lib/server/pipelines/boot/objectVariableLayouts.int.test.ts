/**
 * Core's side of "every OBJECT variable gets a layout" (owner ruling
 * 2026-09-27): after a boot, every registered object variable has a live
 * layout row; a core object variable nothing lays out by hand gets an
 * automatic "JSON" row under its `content` seed key; a primitive gets none;
 * re-seeding is idempotent and never touches a person's edited copy.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { and, eq, isNull } from "drizzle-orm"
import { allVariables, defineVariable } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { seedVariableTemplates } from "./seedVariableTemplates"
import { isObjectVariable } from "$lib/server/pipelines/entities/objectVariableLayouts"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

// A core object variable no hand-written layout covers, and a primitive one —
// what a future core release adding either looks like to the seeder.
const OBJECT_VAR = "core:var/test-object-ledger@1"
const PRIMITIVE_VAR = "core:var/test-primitive-mood@1"
const OBJECT_KEY = `pipeline-variable-template:${OBJECT_VAR}:content`

let db: TestDb

const rowsFor = async (variableId: string) =>
	(await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.variableId, variableId))) as any[]

beforeAll(async () => {
	defineVariable({
		id: OBJECT_VAR,
		scope: { testLedger: { type: "record", of: { type: "string" } } },
		sample: { Rent: "Due Friday." }
	})
	defineVariable({
		id: PRIMITIVE_VAR,
		scope: { testMood: { type: "string" } },
		sample: "calm"
	})
	db = await createTestDb()
	const { bootstrapPipelines } = await import("./bootstrap")
	await bootstrapPipelines(db)
})

describe("core object variables always have a layout", () => {
	it("every registered object variable has a live layout row after boot", async () => {
		const live = await db
			.select({ variableId: schema.pipelineVariableTemplates.variableId })
			.from(schema.pipelineVariableTemplates)
			.where(isNull(schema.pipelineVariableTemplates.withdrawnAt))
		const laidOut = new Set(live.map((r) => r.variableId))
		const missing = allVariables()
			.filter(isObjectVariable)
			.map((d) => d.id)
			.filter((id) => !laidOut.has(id))
		expect(missing).toEqual([])
	})

	it("seeds an immutable JSON row under the variable's content seed key", async () => {
		const [row, ...more] = await rowsFor(OBJECT_VAR)
		expect(more).toEqual([])
		expect(row.seedKey).toBe(OBJECT_KEY)
		expect(row.name).toBe("JSON")
		expect(row.source).toBe("{{{json testLedger}}}")
		expect(row.isImmutable).toBe(true)
		expect(row.templateId).toBe(
			"core:template/pipeline-variable-template-core-var-test-object-ledger-1-content@1"
		)
	})

	it("seeds nothing for a primitive variable", async () => {
		expect(await rowsFor(PRIMITIVE_VAR)).toEqual([])
	})

	it("re-seeding is idempotent", async () => {
		const before = (await rowsFor(OBJECT_VAR)).map((r) => r.id)
		const report = await seedVariableTemplates(db)
		expect(report.created).toEqual([])
		expect(report.present).toContain(OBJECT_KEY)
		expect((await rowsFor(OBJECT_VAR)).map((r) => r.id)).toEqual(before)
	})

	it("an edited copy survives a re-seed", async () => {
		const { duplicateVariableTemplate, updateVariableTemplate } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		const [auto] = await rowsFor(OBJECT_VAR)
		const copy = await duplicateVariableTemplate(db, auto.id, "Ledger lines")
		await updateVariableTemplate(db, copy.id, {
			source: "{{#each testLedger}}{{@key}}: {{this}}\n{{/each}}"
		})
		await seedVariableTemplates(db)
		const [kept] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(
				and(
					eq(schema.pipelineVariableTemplates.id, copy.id),
					isNull(schema.pipelineVariableTemplates.seedKey)
				)
			)
		expect(kept?.source).toBe("{{#each testLedger}}{{@key}}: {{this}}\n{{/each}}")
		expect(kept?.name).toBe("Ledger lines")
	})

	it("the automatic row is what a declaration of the variable defaults to", async () => {
		const { defaultVariableTemplateFor } = await import("./seedVariableTemplates")
		const [auto] = (await rowsFor(OBJECT_VAR)).filter((r) => r.seedKey)
		expect(await defaultVariableTemplateFor(db, OBJECT_VAR)).toBe(auto.id)
	})
})
