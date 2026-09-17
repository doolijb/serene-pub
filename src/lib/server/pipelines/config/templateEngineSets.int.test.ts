/**
 * A template slot accepts a SET of languages, and every layer that asks "may
 * this row go here" asks it of the set.
 *
 * The pool is still `(node type, engine)` — a Liquid row and a Handlebars row
 * are not interchangeable and neither renders the other. What widens is the
 * slot: `core:task/assemble@2` declares both of core's engines, so both pools
 * feed one picker, and a Liquid template becomes selectable somewhere for the
 * first time. The first engine declared stays the default, which is what keeps
 * an untouched install byte-identical.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	ContextTemplateNotUsableError,
	assertEngineAccepted,
	assertSelectable,
	createContextTemplate,
	listContextTemplates
} from "$lib/server/pipelines/entities/contextTemplates"
import {
	contextTemplateOptionGate,
	namespaceView,
	optionId,
	type ConfigOption,
	type NamespaceView
} from "$lib/server/pipelines/config/panel"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"

const SECRET = "test-instance-secret"
const NODE_TYPE = "core:task/assemble"
const FOREIGN_ENGINE = "core:template/jinja2@1"
const BOTH = [CORE_TEMPLATE_ENGINE, CORE_LIQUID_ENGINE]

let db: TestDb
let adminId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "engine-set-admin", isAdmin: true })
		.returning()
	adminId = admin.id
}, 60_000)

let n = 0
const unique = (s: string) => `${s} ${++n}`

const admin = () => ({ userId: adminId, isAdmin: true })

/** The assemble node's template setting in the shipped reply pipeline. */
const templateOption = () => optionId(SECRET, "prompt", "template", "")

describe("assertSelectable against a set", () => {
	it("accepts a Liquid template for a slot that declares both engines", async () => {
		const row = await createContextTemplate(db, {
			nodeDefinitionId: NODE_TYPE,
			name: unique("Liquid story string"),
			source: "{% if scenario %}{{ scenario }}{% endif %}",
			engine: CORE_LIQUID_ENGINE
		})
		const got = await assertSelectable(db, NODE_TYPE, row.id, BOTH)
		expect(got.engine).toBe(CORE_LIQUID_ENGINE)
	})

	it("still accepts the single-engine spelling", async () => {
		const row = await createContextTemplate(db, {
			nodeDefinitionId: NODE_TYPE,
			name: unique("Handlebars story string"),
			source: "{{#if scenario}}{{scenario}}{{/if}}",
			engine: CORE_TEMPLATE_ENGINE
		})
		const got = await assertSelectable(
			db,
			NODE_TYPE,
			row.id,
			CORE_TEMPLATE_ENGINE
		)
		expect(got.engine).toBe(CORE_TEMPLATE_ENGINE)
	})

	it("refuses an engine the slot does not accept, naming both languages", async () => {
		const [row] = await db
			.insert(schema.pipelineContextTemplates)
			.values({
				nodeDefinitionId: NODE_TYPE,
				name: unique("Jinja story string"),
				source: "{{ scenario }}",
				engine: FOREIGN_ENGINE
			})
			.returning()
		await expect(
			assertSelectable(db, NODE_TYPE, row.id, BOTH)
		).rejects.toThrow(ContextTemplateNotUsableError)
		await expect(
			assertSelectable(db, NODE_TYPE, row.id, BOTH)
		).rejects.toThrow(/Jinja2[\s\S]*Handlebars or Liquid/)
	})
})

describe("listContextTemplates across a set", () => {
	it("returns every accepted engine's rows in one list", async () => {
		const rows = await listContextTemplates(db, NODE_TYPE, BOTH)
		const engines = new Set(rows.map((r) => r.engine))
		expect(engines.has(CORE_TEMPLATE_ENGINE)).toBe(true)
		expect(engines.has(CORE_LIQUID_ENGINE)).toBe(true)
		expect(engines.has(FOREIGN_ENGINE)).toBe(false)
	})
})

describe("assertEngineAccepted", () => {
	it("defaults to the first engine the slot declares", () => {
		expect(assertEngineAccepted(BOTH, undefined)).toBe(CORE_TEMPLATE_ENGINE)
		expect(assertEngineAccepted(BOTH, null)).toBe(CORE_TEMPLATE_ENGINE)
	})

	it("passes through an engine the slot accepts", () => {
		expect(assertEngineAccepted(BOTH, CORE_LIQUID_ENGINE)).toBe(
			CORE_LIQUID_ENGINE
		)
	})

	it("refuses one it does not", () => {
		expect(() => assertEngineAccepted(BOTH, FOREIGN_ENGINE)).toThrow(
			ContextTemplateNotUsableError
		)
	})
})

describe("the panel's template setting", () => {
	it("reports both of core's engines for the assemble slot", async () => {
		const gate = await contextTemplateOptionGate(
			db,
			SECRET,
			RESPOND_SPEC_ID,
			admin(),
			templateOption()
		)
		expect(gate.engines).toEqual(BOTH)
		// The single-engine field stays the slot's DEFAULT, so every caller
		// that never learned about sets keeps writing Handlebars.
		expect(gate.engine).toBe(CORE_TEMPLATE_ENGINE)
	})

	it("creates a Liquid row when the panel asks for one", async () => {
		const gate = await contextTemplateOptionGate(
			db,
			SECRET,
			RESPOND_SPEC_ID,
			admin(),
			templateOption()
		)
		const created = await createContextTemplate(db, {
			nodeDefinitionId: gate.nodeDefinitionId,
			name: unique("From the panel"),
			source: "{% if scenario %}{{ scenario }}{% endif %}",
			engine: assertEngineAccepted(gate.engines, CORE_LIQUID_ENGINE),
			createdForSpecId: gate.specId
		})
		expect(created.engine).toBe(CORE_LIQUID_ENGINE)
		await expect(
			assertSelectable(db, gate.nodeDefinitionId, created.id, gate.engines)
		).resolves.toMatchObject({ engine: CORE_LIQUID_ENGINE })
	})
})

describe("the picker the panel renders", () => {
	/** The assemble step's template option, as the panel receives it. */
	const templateSetting = async (): Promise<ConfigOption> => {
		const v = (await namespaceView(
			db,
			SECRET,
			RESPOND_SPEC_ID,
			admin()
		)) as NamespaceView
		const all = v.steps.flatMap((s) => [...s.options, ...s.advanced])
		return all.find((o) => o.id === templateOption())!
	}

	it("carries the accepted languages so the create button can offer them", async () => {
		expect((await templateSetting()).templateEngines).toEqual(BOTH)
	})

	it("offers rows from every accepted engine, each naming its language", async () => {
		const liquid = await createContextTemplate(db, {
			nodeDefinitionId: NODE_TYPE,
			name: unique("Liquid in the picker"),
			source: "{% if scenario %}{{ scenario }}{% endif %}",
			engine: CORE_LIQUID_ENGINE
		})
		const choices = (await templateSetting()).choices ?? []
		const offered = choices.find((c: any) => c.id === liquid.id)
		expect(offered, "the Liquid row is not offered at all").toBeTruthy()
		// The language rides in the subtitle, because a slot rendering two of
		// them lists two rows that may share a name.
		expect((offered as any).description).toContain("Liquid")
		// Both pools feed one list: the languages present across it are the
		// slot's, not whichever pool happened to be looked up.
		const languages = new Set(
			choices.map((c: any) => String(c.description ?? "").split(" ·")[0])
		)
		expect(languages.has("Handlebars")).toBe(true)
		expect(languages.has("Liquid")).toBe(true)
	})
})
