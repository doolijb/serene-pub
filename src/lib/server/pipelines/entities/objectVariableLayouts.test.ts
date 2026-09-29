/**
 * Every OBJECT variable gets a layout of its own, automatically (owner ruling
 * 2026-09-27); primitives get none. The rule, the source, the ids, and the
 * floor that keeps an object out of `String()`.
 */

import { describe, expect, it } from "vitest"
import { allVariables, type VariableDecl } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import {
	coreObjectLayouts,
	isObjectValued,
	isObjectVariable,
	objectLayoutSeedsFor,
	objectLayoutSource,
	objectLayoutTemplateId
} from "./objectVariableLayouts"
import { SHIPPED_VARIABLE_TEMPLATES, renderVariable } from "./variableLayouts"

const PLUGIN = "showcase.twenty-questions"
const RECORD = { type: "record", of: { type: "string" } } as const

const decl = (id: string, scope: VariableDecl["scope"]): VariableDecl => ({
	id,
	scope,
	sample: null
})

describe("which variables are objects", () => {
	it("counts object, record, a list of objects and the legacy field list", () => {
		expect(isObjectValued({ type: "object", fields: {} })).toBe(true)
		expect(isObjectValued(RECORD)).toBe(true)
		expect(
			isObjectValued({ type: "list", of: { type: "object", fields: {} } })
		).toBe(true)
		expect(
			isObjectValued({ type: "list", of: { type: "list", of: RECORD } })
		).toBe(true)
		expect(isObjectValued(["name", "description"])).toBe(true)
	})

	it("counts no primitive, no list of primitives and no unchecked 'any'", () => {
		for (const t of ["string", "number", "boolean"] as const)
			expect(isObjectValued({ type: t })).toBe(false)
		expect(isObjectValued({ type: "list", of: { type: "string" } })).toBe(false)
		expect(isObjectValued({ type: "list" })).toBe(false)
		expect(isObjectValued("any")).toBe(false)
		expect(isObjectValued(undefined)).toBe(false)
	})
})

describe("the automatic layout", () => {
	it("is minified JSON of each object root, and nothing for a primitive", () => {
		expect(objectLayoutSource(decl("a:var/x@1", { secretEntry: RECORD }))).toBe(
			"{{{json secretEntry}}}"
		)
		expect(
			objectLayoutSource(decl("a:var/x@1", { note: { type: "string" } }))
		).toBeNull()
	})

	it("takes a template id derived from the variable id", () => {
		expect(objectLayoutTemplateId(PLUGIN, `${PLUGIN}:var/secret-entry@1`)).toBe(
			`${PLUGIN}:template/secret-entry-json@1`
		)
		expect(objectLayoutTemplateId("a.b", "a.b:var/castNotes@2")).toBe(
			"a.b:template/cast-notes-json@2"
		)
		expect(objectLayoutTemplateId("a.b", "not a variable")).toBeNull()
	})

	it("renders the same bytes as the floor an unlaid-out object gets", async () => {
		const value = { "The Clocktower": 'Brass. "Late".' }
		const source = objectLayoutSource(decl("a:var/x@1", { secretEntry: RECORD }))!
		const viaLayout = await renderVariable(
			{ secretEntry: { engine: "core:template/handlebars@1", source } },
			"secretEntry",
			value
		)
		const viaFloor = await renderVariable(undefined, "secretEntry", value)
		expect(viaLayout).toBe(JSON.stringify(value))
		expect(viaFloor).toBe(viaLayout)
	})

	it("never floors an object to [object Object]", async () => {
		expect(await renderVariable(undefined, "somebodysBand", { a: 1 })).toBe(
			'{"a":1}'
		)
		expect(await renderVariable(undefined, "somebodysBand", [{ a: 1 }])).toBe(
			'[{"a":1}]'
		)
		// A primitive is unchanged.
		expect(await renderVariable(undefined, "somebodysBand", "plain")).toBe(
			"plain"
		)
	})
})

describe("a plugin's automatic layout seeds", () => {
	const manifest = {
		variables: [
			decl(`${PLUGIN}:var/secret-entry@1`, { secretEntry: RECORD }),
			decl(`${PLUGIN}:var/turn-note@1`, { turnNote: { type: "string" } })
		]
	}

	it("seeds an object variable and never a primitive one", () => {
		const seeds = objectLayoutSeedsFor(manifest, PLUGIN, [])
		expect(seeds).toEqual([
			{
				id: `${PLUGIN}:template/secret-entry-json@1`,
				kind: "variables",
				variableId: `${PLUGIN}:var/secret-entry@1`,
				engine: "core:template/handlebars@1",
				label: "JSON",
				body: "{{{json secretEntry}}}",
				automatic: true
			}
		])
	})

	it("leaves a variable alone when the package ships its own layout for it", () => {
		expect(
			objectLayoutSeedsFor(manifest, PLUGIN, [
				{
					id: `${PLUGIN}:template/secret-prose@1`,
					kind: "variables",
					variableId: `${PLUGIN}:var/secret-entry@1`
				}
			])
		).toEqual([])
	})

	it("skips a variable outside the package's namespace", () => {
		expect(
			objectLayoutSeedsFor(
				{ variables: [decl("other.pkg:var/x@1", { x: RECORD })] },
				PLUGIN,
				[]
			)
		).toEqual([])
	})
})

describe("core's catalog", () => {
	it("lays out every core object variable — by hand or automatically", () => {
		const shipped = new Set(SHIPPED_VARIABLE_TEMPLATES.map((t) => t.variableId))
		const automatic = new Set(coreObjectLayouts().map((t) => t.variableId))
		const objects = allVariables().filter(
			(d) => d.id.startsWith("core:") && isObjectVariable(d)
		)
		expect(objects.length).toBeGreaterThan(0)
		const bare = objects
			.map((d) => d.id)
			.filter((id) => !shipped.has(id) && !automatic.has(id))
		expect(bare).toEqual([])
	})

	it("adds an automatic row only for an object variable nothing lays out", () => {
		const rows = coreObjectLayouts([
			decl("core:var/test-object@1", { testObject: RECORD }),
			decl("core:var/test-primitive@1", { testPrimitive: { type: "string" } }),
			// Hand-written rows exist for this one; no automatic row beside them.
			decl("core:var/world-lore@1", { worldLore: RECORD })
		])
		expect(rows).toEqual([
			{
				variableId: "core:var/test-object@1",
				variant: "content",
				name: "JSON",
				source: "{{{json testObject}}}",
				seedKey: "pipeline-variable-template:core:var/test-object@1:content"
			}
		])
	})
})
