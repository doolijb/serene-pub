/**
 * A template's language: chosen once, at creation, and checked before it is
 * stored.
 *
 * Two rules, both of which exist because the failure they prevent is silent and
 * late. A template that does not parse is a pipeline that dies at generation
 * time, with an error nobody reading a session can act on. A template whose
 * engine was switched under it parses perfectly and sends its own markup to the
 * model as prose — the exact shape of the delivery bug this table's `engine`
 * column was added to close.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	ContextTemplateNotUsableError,
	createContextTemplate,
	updateContextTemplate
} from "$lib/server/pipelines/entities/contextTemplates"
import {
	VariableTemplateNotUsableError,
	createVariableTemplate,
	updateVariableTemplate
} from "$lib/server/pipelines/entities/variableTemplates"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"
import { renderTemplate } from "$lib/server/pipelines/prompt/renderers"

const NODE_TYPE = "core:task/assemble"
const VARIABLE = "core:var/characters@1"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

let n = 0
const unique = (s: string) => `${s} ${++n}`

describe("a context template's engine", () => {
	it("stores Liquid as itself, and renders through it", async () => {
		const row = await createContextTemplate(db, {
			nodeTypeId: NODE_TYPE,
			name: unique("Liquid default"),
			source: "{% if scenario %}{{ scenario }}{% endif %}",
			engine: CORE_LIQUID_ENGINE
		})
		expect(row.engine).toBe(CORE_LIQUID_ENGINE)
		expect(
			await renderTemplate(row.engine, {
				template: row.source,
				variables: { scenario: "a storm" }
			})
		).toBe("a storm")
	})

	it("refuses a source that does not parse, naming the line", async () => {
		await expect(
			createContextTemplate(db, {
				nodeTypeId: NODE_TYPE,
				name: unique("Broken"),
				source: 'a\n{% include "secrets" %}',
				engine: CORE_LIQUID_ENGINE
			})
		).rejects.toThrow(
			/not valid Liquid \(line 2\)[\s\S]*'include' is not available/
		)
	})

	it("refuses a Handlebars source that does not parse", async () => {
		await expect(
			createContextTemplate(db, {
				nodeTypeId: NODE_TYPE,
				name: unique("Broken hbs"),
				source: "{{#if x}}{{/each}}",
				engine: CORE_TEMPLATE_ENGINE
			})
		).rejects.toThrow(/not valid Handlebars[\s\S]*doesn't match/)
	})

	it("refuses an edit that breaks a template that used to parse", async () => {
		const row = await createContextTemplate(db, {
			nodeTypeId: NODE_TYPE,
			name: unique("Editable"),
			source: "{{#if scenario}}{{{scenario}}}{{/if}}"
		})
		await expect(
			updateContextTemplate(db, row.id, { source: "{{#if scenario}}" })
		).rejects.toThrow(ContextTemplateNotUsableError)

		// The refusal is a refusal: the stored row is untouched.
		const [stored] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, row.id))
			.limit(1)
		expect(stored!.source).toBe("{{#if scenario}}{{{scenario}}}{{/if}}")
	})

	it("refuses switching the engine of a row that has been written in", async () => {
		const row = await createContextTemplate(db, {
			nodeTypeId: NODE_TYPE,
			name: unique("Written"),
			source: "{{#if scenario}}{{{scenario}}}{{/if}}"
		})
		await expect(
			updateContextTemplate(db, row.id, { engine: CORE_LIQUID_ENGINE })
		).rejects.toThrow(
			/written in Handlebars[\s\S]*Duplicate it and rewrite the copy in Liquid/
		)
	})

	it("allows the engine to be chosen while the row is still empty", async () => {
		const row = await createContextTemplate(db, {
			nodeTypeId: NODE_TYPE,
			name: unique("Blank"),
			source: ""
		})
		await updateContextTemplate(db, row.id, {
			engine: CORE_LIQUID_ENGINE,
			source: "{% if scenario %}{{ scenario }}{% endif %}"
		})
		const [stored] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(eq(schema.pipelineContextTemplates.id, row.id))
			.limit(1)
		expect(stored!.engine).toBe(CORE_LIQUID_ENGINE)
	})
})

describe("a variable layout's engine", () => {
	it("refuses a source that does not parse", async () => {
		await expect(
			createVariableTemplate(db, {
				variableId: VARIABLE,
				name: unique("Broken layout"),
				source: "{{ characters | nosuchfilter }}",
				engine: CORE_LIQUID_ENGINE
			})
		).rejects.toThrow(
			/not valid Liquid[\s\S]*undefined filter: nosuchfilter/
		)
	})

	it("refuses switching the engine of a row that has been written in", async () => {
		const row = await createVariableTemplate(db, {
			variableId: VARIABLE,
			name: unique("Written layout"),
			source: "{{{json characters 2}}}"
		})
		await expect(
			updateVariableTemplate(db, row.id, { engine: CORE_LIQUID_ENGINE })
		).rejects.toThrow(VariableTemplateNotUsableError)
	})

	it("allows the engine to be chosen while the row is still empty", async () => {
		const row = await createVariableTemplate(db, {
			variableId: VARIABLE,
			name: unique("Blank layout"),
			source: ""
		})
		await updateVariableTemplate(db, row.id, {
			engine: CORE_LIQUID_ENGINE,
			source: "{{ characters | json: 2 }}"
		})
		const [stored] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, row.id))
			.limit(1)
		expect(stored!.engine).toBe(CORE_LIQUID_ENGINE)
		expect(stored!.source).toBe("{{ characters | json: 2 }}")
	})
})
