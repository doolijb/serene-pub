/**
 * The variable layouts' admin events over a real (in-memory) DB, bootstrapped
 * with core's pipelines: W1 the list, W2 one variable, the pub's layout, W3's
 * counts, W5's per-template keys. Each event: its happy path and its refusals.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { definePluginVariable } from "@serene-pub/sdk"
import { createVariableTemplate } from "$lib/server/pipelines/entities/variableTemplates"
import { stepKeyFor } from "$lib/server/pipelines/config/panel/ids"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "variable-layouts-test-secret" }
})

const SECRET = "variable-layouts-test-secret"
const CHARACTERS = "core:var/characters@1"
const PERSONAS = "core:var/personas@1"
const PLUGIN_VARIABLE = "acme.riddles:var/riddle@1"

let db: TestDb
const ids: Record<string, number> = {}

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	// A plugin's plain-text variable with no layout row at all.
	await db.insert(schema.plugins).values({
		pluginId: "acme.riddles",
		name: "Riddles",
		bundleSource: "// x",
		bundleHash: "h-riddles",
		enabled: true,
		manifest: {} as any
	})
	definePluginVariable("acme.riddles", {
		id: PLUGIN_VARIABLE,
		i18n: { name: { en: "Riddle" } },
		description: { en: "Today's riddle." },
		scope: { riddle: { type: "string" } },
		sample: "What has keys but no locks?"
	} as any)
}, 120_000)

async function ask(
	handlerName: string,
	params: any,
	user: { isAdmin: boolean } | null = { isAdmin: true }
) {
	const mod = await import("./pipelinesVariableLayouts")
	// The library's own events (`pipelinesLibrary`) live in `pipelines.ts`.
	const h =
		(mod as any)[handlerName] ?? ((await import("./pipelines")) as any)[handlerName]
	const events: { event: string; data: any }[] = []
	const res = await h.handler(
		{ user: user ?? undefined } as any,
		params,
		(event: string, data: any) => events.push({ event, data })
	)
	return { res, events, event: h.event as string }
}

/** The steps of one pipeline's active version that render a variable. */
async function stepsRendering(specSlug: string, variableId: string) {
	const { declarationsAndVariableKeys } = await import(
		"$lib/server/pipelines/config/panel"
	)
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
	const { variableKeys } = await declarationsAndVariableKeys(
		db,
		spec.activeVersionId!
	)
	return variableKeys.filter((k) => k.variableId === variableId)
}

const ok = (r: { events: { event: string }[]; event: string }) =>
	r.events.some((e) => e.event === r.event)
const refused = (r: { events: { event: string }[]; event: string }) =>
	r.events.some((e) => e.event === `${r.event}:error`)

const EVENTS = [
	["pipelinesLibraryVariables", {}],
	["pipelinesLibraryVariable", { variableId: CHARACTERS }],
	[
		"pipelinesLibrarySetPubLayout",
		{ variableId: CHARACTERS, templateId: null }
	],
	["pipelinesLibraryUseEverywhereCounts", { variableId: CHARACTERS }],
	["pipelinesTemplateVariableLayouts", { nodeType: "x" }]
] as const

describe("every event is admin only", () => {
	for (const [name, params] of EVENTS)
		test(`${name} refuses a member and a signed-out socket`, async () => {
			for (const user of [{ isAdmin: false }, null]) {
				const r = await ask(name, params, user)
				expect(r.res.error).toMatch(/Only admin users/)
				expect(refused(r)).toBe(true)
				expect(ok(r)).toBe(false)
			}
		})
})

describe("pipelines:libraryVariables (W1)", () => {
	test("lists core's variables on their shelves with the layout in use", async () => {
		const r = await ask("pipelinesLibraryVariables", {})
		expect(ok(r)).toBe(true)
		const rows = r.res.variables as any[]
		const characters = rows.find((v) => v.variableId === CHARACTERS)
		expect(characters).toMatchObject({
			label: "Characters",
			shelfId: "characters",
			shelfLabel: "Characters and personas",
			supplier: "Serene Pub",
			reason: "default",
			inUse: {
				name: "Titled JSON block",
				reference: expect.stringMatching(/^core\//)
			},
			presetsDiffering: 0
		})
		expect(characters.layoutCount).toBeGreaterThanOrEqual(2)
		// Shelf order, then label.
		const order = rows.map((v) => v.shelfId)
		expect(order.indexOf("characters")).toBeLessThan(
			order.lastIndexOf("other")
		)
	})

	test("lists a plugin variable with no layout row, written as written", async () => {
		const r = await ask("pipelinesLibraryVariables", {})
		const riddle = (r.res.variables as any[]).find(
			(v) => v.variableId === PLUGIN_VARIABLE
		)
		expect(riddle).toMatchObject({
			label: "Riddle",
			supplier: "Riddles",
			inUse: null,
			reason: "as-written",
			layoutCount: 0
		})
	})

	test("says automatic for an object variable written by its automatic row", async () => {
		const r = await ask("pipelinesLibraryVariables", {})
		const automatic = (r.res.variables as any[]).filter(
			(v) => v.reason === "automatic"
		)
		expect(automatic.length).toBeGreaterThan(0)
		for (const v of automatic) expect(v.inUse.name).toBe("JSON")
	})
})

describe("pipelines:libraryVariable (W2)", () => {
	test("returns the variable, its default and its rows previewed against the sample", async () => {
		const r = await ask("pipelinesLibraryVariable", {
			variableId: CHARACTERS
		})
		expect(ok(r)).toBe(true)
		const v = r.res.variable
		expect(v).toMatchObject({
			variableId: CHARACTERS,
			label: "Characters",
			supplier: "Serene Pub",
			default: { name: "Titled JSON block" },
			pubDiffersFromDefault: false,
			inUse: { reason: "default" }
		})
		expect(v.scope).toHaveProperty("characters")
		expect(Array.isArray(v.sample)).toBe(true)
		const inUse = v.rows.filter((x: any) => x.inUse)
		expect(inUse).toHaveLength(1)
		expect(inUse[0].name).toBe("Titled JSON block")
		expect(inUse[0].preview).toContain(
			"Assistant Characters (AI-controlled):"
		)
		expect(inUse[0].ownerLabel).toBe("Serene Pub")
		expect(inUse[0].editable).toBe(false)
		expect(inUse[0].isImmutable).toBe(true)
		expect(inUse[0].previewError).toBeNull()
	})

	test("an engine error is a previewError, never a thrown handler", async () => {
		// A row stored with a broken source, as a plugin's engine failing at render would be.
		const [row] = await db
			.insert(schema.pipelineVariableTemplates)
			.values({
				variableId: CHARACTERS,
				name: "Broken",
				source: "{{#each characters}}",
				reference: "mypub/broken@1"
			})
			.returning()
		ids.broken = row.id
		const r = await ask("pipelinesLibraryVariable", {
			variableId: CHARACTERS
		})
		const broken = r.res.variable.rows.find((x: any) => x.id === ids.broken)
		expect(broken.preview).toBeNull()
		expect(broken.previewError).toBeTruthy()
		expect(broken).toMatchObject({ ownerLabel: "This pub", editable: true })
		await db
			.delete(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, ids.broken))
	})

	test("a plugin variable with no rows has an empty list", async () => {
		const r = await ask("pipelinesLibraryVariable", {
			variableId: PLUGIN_VARIABLE
		})
		expect(r.res.variable).toMatchObject({
			supplier: "Riddles",
			default: null,
			inUse: null,
			rows: []
		})
	})

	test("refuses an unknown variable and missing params", async () => {
		const unknown = await ask("pipelinesLibraryVariable", {
			variableId: "acme.nobody:var/ghost@1"
		})
		expect(refused(unknown)).toBe(true)
		expect(unknown.res.error).toMatch(/Nothing on this pub declares/)
		const bad = await ask("pipelinesLibraryVariable", {})
		expect(bad.res.error).toMatch(/Say which variable/)
	})
})

describe("pipelines:librarySetPubLayout (W2)", () => {
	test("sets the pub's layout, answers with the refreshed view, and goes back", async () => {
		const prose = await createVariableTemplate(db, {
			variableId: CHARACTERS,
			name: "Prose",
			source: "{{#each characters}}{{this.name}}\n{{/each}}",
			reference: { ownerSlug: "mypub", slug: "prose" }
		})
		ids.prose = prose.id

		const set = await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: prose.id
		})
		expect(ok(set)).toBe(true)
		expect(set.res.variable).toMatchObject({
			pubDiffersFromDefault: true,
			inUse: { id: prose.id, reason: "pub", reference: "mypub/prose@1" },
			default: { name: "Titled JSON block" }
		})
		expect(set.res.warnings).toBeUndefined()
		expect(
			set.res.variable.rows.find((x: any) => x.id === prose.id).inUse
		).toBe(true)

		// W1 agrees.
		const list = await ask("pipelinesLibraryVariables", {})
		expect(
			(list.res.variables as any[]).find(
				(v) => v.variableId === CHARACTERS
			)
		).toMatchObject({ reason: "pub", inUse: { name: "Prose" } })

		const back = await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: null
		})
		expect(back.res.variable).toMatchObject({
			pubDiffersFromDefault: false,
			inUse: { reason: "default" }
		})
	})

	test("says which presets keep their own after the pub's choice moves", async () => {
		await db.insert(schema.sessionPresets).values({
			genreId: "core:genre/story@1",
			name: "Small models",
			variableLayouts: { [CHARACTERS]: "mypub/prose@1" }
		} as any)
		const set = await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: null
		})
		expect(set.res.warnings?.[0]).toMatch(/Small models/)
		const view = await ask("pipelinesLibraryVariable", {
			variableId: CHARACTERS
		})
		const prose = view.res.variable.rows.find(
			(x: any) => x.id === ids.prose
		)
		expect(prose.chosenByPresets).toEqual([
			{ id: expect.any(Number), name: "Small models" }
		])
		const list = await ask("pipelinesLibraryVariables", {})
		expect(
			(list.res.variables as any[]).find(
				(v) => v.variableId === CHARACTERS
			).presetsDiffering
		).toBe(1)
		await db
			.delete(schema.sessionPresets)
			.where(eq(schema.sessionPresets.name, "Small models"))
	})

	test("refuses another variable's row, an unknown variable and a bad id", async () => {
		const [personasRow] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.variableId, PERSONAS))
			.limit(1)
		const other = await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: personasRow!.id
		})
		expect(refused(other)).toBe(true)
		expect(other.res.error).toMatch(/lays out something else/)

		const unknown = await ask("pipelinesLibrarySetPubLayout", {
			variableId: "acme.nobody:var/ghost@1",
			templateId: null
		})
		expect(unknown.res.error).toMatch(/Nothing on this pub declares/)

		const bad = await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: "7"
		})
		expect(refused(bad)).toBe(true)

		const gone = await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: 999999
		})
		expect(gone.res.error).toMatch(/no longer exists/)

		// None of the refusals changed the pub's layout.
		const view = await ask("pipelinesLibraryVariable", {
			variableId: CHARACTERS
		})
		expect(view.res.variable.pubDiffersFromDefault).toBe(false)
	})
})

describe("pipelines:libraryUseEverywhereCounts (W3)", () => {
	const contextNodeType = async () => {
		const registry = (await db
			.select()
			.from(schema.pipelineDefinitionRegistry)) as any[]
		const row = registry.find((r) =>
			Object.values((r.slots ?? {}) as Record<string, any>).some(
				(d) =>
					d?.kind === "variables" &&
					d.renders?.characters === CHARACTERS
			)
		)
		return row.definitionId as string
	}
	const addTemplate = async (
		nodeDefinitionId: string,
		name: string,
		source: string,
		engine?: string
	) =>
		db
			.insert(schema.pipelineContextTemplates)
			.values({
				nodeDefinitionId,
				name,
				source,
				...(engine ? { engine } : {})
			})
			.returning()

	test("counts pipelines and the templates that read the key bare, not the named ones", async () => {
		const before = await ask("pipelinesLibraryUseEverywhereCounts", {
			variableId: CHARACTERS
		})
		expect(ok(before)).toBe(true)
		expect(before.res.pipelines).toBeGreaterThan(0)
		expect(before.res.contextTemplates).toBeGreaterThan(0)

		const node = await contextNodeType()
		await addTemplate(node, "Bare reader", "Cast: {{{characters}}}")
		const afterBare = await ask("pipelinesLibraryUseEverywhereCounts", {
			variableId: CHARACTERS
		})
		expect(afterBare.res.contextTemplates).toBe(
			before.res.contextTemplates + 1
		)

		// Names its layout everywhere: not a bare read.
		await addTemplate(
			node,
			"Named reader",
			'Cast: {{{layout characters "core/json@1"}}}'
		)
		// Both: one bare read beside one named one still changes.
		await addTemplate(
			node,
			"Mixed reader",
			'{{{characters}}} {{{layout characters "core/json@1"}}}'
		)
		// Liquid, bare.
		await addTemplate(
			node,
			"Liquid reader",
			"{{ characters }}",
			"core:template/liquid@1"
		)
		const after = await ask("pipelinesLibraryUseEverywhereCounts", {
			variableId: CHARACTERS
		})
		expect(after.res.contextTemplates).toBe(before.res.contextTemplates + 3)
		expect(after.res.uncheckedContextTemplates).toBe(0)
	})

	test("a template in a language the check cannot read is counted apart", async () => {
		const node = await contextNodeType()
		await addTemplate(
			node,
			"Plugin language",
			"{{characters}}",
			"acme.lang:template/x@1"
		)
		const r = await ask("pipelinesLibraryUseEverywhereCounts", {
			variableId: CHARACTERS
		})
		expect(r.res.uncheckedContextTemplates).toBe(1)
	})

	test("a leftover pick on a step takes it out of the pipeline count", async () => {
		const before = await ask("pipelinesLibraryUseEverywhereCounts", {
			variableId: CHARACTERS
		})
		// Hold every step that renders characters in one pipeline.
		const held = await stepsRendering(STORY_RESPOND_SPEC_ID, CHARACTERS)
		expect(held.length).toBeGreaterThan(0)
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.variableId, CHARACTERS))
			.limit(1)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
		for (const s of held)
			await db.insert(schema.pipelineNodeOverrides).values({
				specId: spec.id,
				scopeKind: "session",
				scopeId: 0,
				nodeKey: s.nodeKey,
				slot: s.slot,
				path: s.path,
				value: row!.id
			})
		const after = await ask("pipelinesLibraryUseEverywhereCounts", {
			variableId: CHARACTERS
		})
		expect(after.res.pipelines).toBe(before.res.pipelines - 1)
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.specId, spec.id))
	})

	test("refuses an unknown variable and missing params", async () => {
		const unknown = await ask("pipelinesLibraryUseEverywhereCounts", {
			variableId: "acme.nobody:var/ghost@1"
		})
		expect(unknown.res.error).toMatch(/Nothing on this pub declares/)
		const bad = await ask("pipelinesLibraryUseEverywhereCounts", {})
		expect(bad.res.error).toMatch(/Say which variable/)
	})
})

describe("pipelines:libraryVariable names (W2 namedByTemplates)", () => {
	test("counts the context templates that name a row's reference for a key that renders it", async () => {
		const view = await ask("pipelinesLibraryVariable", {
			variableId: CHARACTERS
		})
		const json = view.res.variable.rows.find(
			(x: any) => x.reference === "core/json@1"
		)
		expect(json).toBeTruthy()
		// "Named reader" and "Mixed reader" from the counts test.
		expect(json.namedByTemplates).toBe(2)
		const titled = view.res.variable.rows.find(
			(x: any) => x.name === "Titled JSON block"
		)
		expect(titled.namedByTemplates).toBe(0)
	})
})

describe("pipelines:library Used by (every use of a variable layout)", () => {
	test("lists the pub's layout, then presets, then templates, then leftover pipelines", async () => {
		const [json] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			// A reference is unique within its variable, not across them.
			.where(
				and(
					eq(schema.pipelineVariableTemplates.variableId, CHARACTERS),
					eq(schema.pipelineVariableTemplates.reference, "core/json@1")
				)
			)
		expect(json!.variableId).toBe(CHARACTERS)
		const usedBy = async () => {
			const lib = await ask("pipelinesLibrary", {})
			return (lib.res.variableTemplates as any[]).find(
				(x) => x.id === json!.id
			).usedBy as string[]
		}
		const before = await usedBy()
		expect(before).not.toContain("This pub's layout")
		expect(before).toEqual(["Named by Mixed reader", "Named by Named reader"])

		await db.insert(schema.sessionPresets).values({
			genreId: "core:genre/story@1",
			name: "Quick start",
			variableLayouts: { [CHARACTERS]: "core/json@1" }
		} as any)
		await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: json!.id
		})
		try {
			expect(await usedBy()).toEqual([
				"This pub's layout",
				"Preset Quick start",
				"Named by Mixed reader",
				"Named by Named reader"
			])
		} finally {
			await ask("pipelinesLibrarySetPubLayout", {
				variableId: CHARACTERS,
				templateId: null
			})
			await db
				.delete(schema.sessionPresets)
				.where(eq(schema.sessionPresets.name, "Quick start"))
		}
		expect(await usedBy()).toEqual(before)
	})
})

describe("pipelines:templateVariableLayouts (W5)", () => {
	test("by step type: each laid-out key with its layout and offers", async () => {
		const registry = (await db
			.select()
			.from(schema.pipelineDefinitionRegistry)) as any[]
		const nodeType = registry.find((r) =>
			Object.values((r.slots ?? {}) as Record<string, any>).some(
				(d) =>
					d?.kind === "variables" &&
					d.renders?.characters === CHARACTERS
			)
		).definitionId
		const r = await ask("pipelinesTemplateVariableLayouts", { nodeType })
		expect(ok(r)).toBe(true)
		const characters = r.res.keys.find((k: any) => k.key === "characters")
		expect(characters).toMatchObject({
			variableId: CHARACTERS,
			variableLabel: "Characters",
			inUse: { name: "Titled JSON block", reason: "default" }
		})
		expect(characters.offers).toEqual(
			expect.arrayContaining([
				{ reference: "core/json@1", label: "JSON" }
			])
		)
		// Rows with no reference are not offered.
		const [row] = await db
			.insert(schema.pipelineVariableTemplates)
			.values({
				variableId: CHARACTERS,
				name: "No reference",
				source: "x"
			})
			.returning()
		const again = await ask("pipelinesTemplateVariableLayouts", {
			nodeType
		})
		expect(
			again.res.keys
				.find((k: any) => k.key === "characters")
				.offers.some((o: any) => o.label === "No reference")
		).toBe(false)
		await db
			.delete(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.id, row.id))
	})

	test("per step: the pub's layout wins, with no session in view", async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
		const [step] = await stepsRendering(STORY_RESPOND_SPEC_ID, CHARACTERS)
		const params = {
			specSlug: spec.slug,
			stepKey: stepKeyFor(SECRET, step!.nodeKey)
		}
		const before = await ask("pipelinesTemplateVariableLayouts", params)
		expect(
			before.res.keys.find((k: any) => k.variableId === CHARACTERS).inUse
				.reason
		).toBe("default")
		await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: ids.prose
		})
		const after = await ask("pipelinesTemplateVariableLayouts", params)
		expect(
			after.res.keys.find((k: any) => k.variableId === CHARACTERS).inUse
		).toMatchObject({
			name: "Prose",
			reason: "pub",
			reference: "mypub/prose@1"
		})
		await ask("pipelinesLibrarySetPubLayout", {
			variableId: CHARACTERS,
			templateId: null
		})
	})

	test("refuses an unknown step type, pipeline or step, and missing params", async () => {
		const type = await ask("pipelinesTemplateVariableLayouts", {
			nodeType: "core:task/ghost"
		})
		expect(type.res.error).toMatch(/No step type/)
		const spec = await ask("pipelinesTemplateVariableLayouts", {
			specSlug: "core:spec/ghost",
			stepKey: "a"
		})
		expect(spec.res.error).toMatch(/No pipeline/)
		const node = await ask("pipelinesTemplateVariableLayouts", {
			specSlug: STORY_RESPOND_SPEC_ID,
			stepKey: stepKeyFor(SECRET, "ghost")
		})
		expect(node.res.error).toBe(
			`That step is not part of the pipeline '${STORY_RESPOND_SPEC_ID}'. A newer version may have removed it, or the link was made on a different install.`
		)
		const bad = await ask("pipelinesTemplateVariableLayouts", {})
		expect(bad.res.error).toMatch(/Say which step/)
	})

	test("echoes the asked target on the answer and on every :error", async () => {
		const byType = await ask("pipelinesTemplateVariableLayouts", {
			nodeType: "core:task/ghost"
		})
		expect(byType.res).toMatchObject({ nodeType: "core:task/ghost" })
		expect(byType.events[0]).toMatchObject({
			event: "pipelines:templateVariableLayouts:error",
			data: { nodeType: "core:task/ghost" }
		})
		const bySpec = await ask("pipelinesTemplateVariableLayouts", {
			specSlug: STORY_RESPOND_SPEC_ID,
			stepKey: "0123456789abcdef"
		})
		expect(bySpec.events[0]!.data).toMatchObject({
			specSlug: STORY_RESPOND_SPEC_ID,
			stepKey: "0123456789abcdef"
		})
		expect(bySpec.events[0]!.data.nodeType).toBeUndefined()
		// Bad params: only what was a string is echoed.
		const bad = await ask("pipelinesTemplateVariableLayouts", {
			specSlug: "core:spec/x"
		})
		expect(bad.events[0]!.data).toMatchObject({
			specSlug: "core:spec/x",
			error: expect.stringMatching(/Say which step/)
		})
		expect(bad.events[0]!.data.stepKey).toBeUndefined()
		// Not an admin.
		const member = await ask(
			"pipelinesTemplateVariableLayouts",
			{ nodeType: "core:task/ghost" },
			{ isAdmin: false }
		)
		expect(member.events[0]).toMatchObject({
			event: "pipelines:templateVariableLayouts:error",
			data: { nodeType: "core:task/ghost" }
		})
	})

	test("the answer carries the target beside the keys", async () => {
		const nodeType = (
			await db.select().from(schema.pipelineNodes).limit(1)
		)[0]!.definitionId
		const r = await ask("pipelinesTemplateVariableLayouts", { nodeType })
		expect(r.res).toMatchObject({ nodeType, keys: expect.any(Array) })
		const spec = await ask("pipelinesTemplateVariableLayouts", {
			specSlug: STORY_RESPOND_SPEC_ID,
			stepKey: stepKeyFor(
				SECRET,
				(await db.select().from(schema.pipelineNodes).limit(1))[0]!
					.nodeKey
			)
		})
		// Either it resolves or it refuses; the target is echoed both ways.
		expect(spec.events[0]!.data.specSlug).toBe(STORY_RESPOND_SPEC_ID)
	})
})

describe("pipelines:templateVariableLayouts, by the panel's own step handle", () => {
	test("a handle read from the panel the way the browser does resolves, with the step's heading", async () => {
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { groupOptions } = await import(
			"$lib/server/pipelines/config/panel/groups"
		)
		const view: any = await namespaceView(
			db as any,
			SECRET,
			STORY_RESPOND_SPEC_ID,
			{ userId: 1, isAdmin: true } as any
		)
		const option = groupOptions(view.groups).find(
			(o: any) => o.control === "context-template-ref"
		) as any
		expect(option.step.key).toEqual(expect.any(String))
		const params = {
			specSlug: STORY_RESPOND_SPEC_ID,
			stepKey: option.step.key as string
		}
		const r = await ask("pipelinesTemplateVariableLayouts", params)
		expect(r.res.error).toBeUndefined()
		expect(r.res.keys.map((k: any) => k.key)).toContain("characters")
		expect(r.res).toMatchObject(params)
		expect(option.step.heading).toEqual(expect.any(String))
		expect(r.res.stepHeading).toBeTruthy()
		expect(r.res.stepHeading).toBe(option.step.heading)
		expect(r.events[0]).toMatchObject({
			event: "pipelines:templateVariableLayouts",
			data: params
		})
	})
})

describe("pipelines:libraryVariables key (W1)", () => {
	test("each row's key is the variable's first scope root", async () => {
		const r = await ask("pipelinesLibraryVariables", {})
		const rows = r.res.variables as any[]
		expect(rows.find((v) => v.variableId === CHARACTERS).key).toBe(
			"characters"
		)
		expect(rows.find((v) => v.variableId === PLUGIN_VARIABLE).key).toBe(
			"riddle"
		)
		for (const v of rows)
			expect(v.key === null || v.key.length > 0).toBe(true)
	})
})

describe("pipelines:libraryVariable differs (Where this differs)", () => {
	const layoutRow = async (variableId: string, slug: string, name: string) =>
		createVariableTemplate(db, {
			variableId,
			name,
			source: `${name}: {{{json characters}}}`,
			reference: { ownerSlug: "mypub", slug }
		})
	const specRow = async () =>
		(
			await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
		)[0]!
	const setPub = (variableId: string, templateId: number | null) =>
		ask("pipelinesLibrarySetPubLayout", { variableId, templateId })
	const view = async (variableId: string) =>
		(await ask("pipelinesLibraryVariable", { variableId })).res

	test("lists a template's name, a leftover pick, a preset's choice, each with its layout, addressed by handle", async () => {
		const a = await layoutRow(CHARACTERS, "diff-a", "Diff A")
		const b = await layoutRow(CHARACTERS, "diff-b", "Diff B")
		const c = await layoutRow(CHARACTERS, "diff-c", "Diff C")
		const d = await layoutRow(CHARACTERS, "diff-d", "Diff D")
		const spec = await specRow()
		const [step] = await stepsRendering(STORY_RESPOND_SPEC_ID, CHARACTERS)
		const registry = (await db
			.select()
			.from(schema.pipelineDefinitionRegistry)) as any[]
		const nodeType = registry.find((r) =>
			Object.values((r.slots ?? {}) as Record<string, any>).some(
				(s) => s?.kind === "variables" && s.renders?.characters === CHARACTERS
			)
		)!.definitionId as string
		await db.insert(schema.pipelineContextTemplates).values({
			nodeDefinitionId: nodeType,
			name: "Diff template",
			source: '{{{layout characters "mypub/diff-c@1"}}}'
		})
		await db.insert(schema.sessionPresets).values({
			genreId: "core:genre/story@1",
			name: "Diff preset",
			variableLayouts: { [CHARACTERS]: "mypub/diff-b@1" }
		} as any)
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: spec.id,
			scopeKind: "session",
			scopeId: 0,
			nodeKey: step!.nodeKey,
			slot: step!.slot,
			path: step!.path,
			value: d.id
		})
		await setPub(CHARACTERS, a.id)
		try {
			const res = await view(CHARACTERS)
			const differs = res.variable.differs as any[]
			const at = (kind: string, layout: string) =>
				differs.filter((x) => x.kind === kind && x.layout.name === layout)
			expect(at("template", "Diff C")).toEqual([
				expect.objectContaining({
					name: "Diff template",
					layout: { id: c.id, name: "Diff C" }
				})
			])
			expect(at("preset", "Diff B")).toEqual([
				expect.objectContaining({ name: "Diff preset" })
			])
			const left = at("leftover", "Diff D")
			expect(left).toHaveLength(1)
			expect(left[0].stepKey).toBe(stepKeyFor(SECRET, step!.nodeKey))
			expect(left[0].specSlug).toBe(STORY_RESPOND_SPEC_ID)
			expect(left[0].pipelineLabel).toEqual(expect.any(String))
			// The in-use row itself is never a difference.
			expect(differs.some((x) => x.layout.id === a.id)).toBe(false)
			// Order: template, leftover, preset.
			const kinds = differs.map((x) => x.kind)
			expect(kinds.indexOf("template")).toBeLessThan(kinds.indexOf("leftover"))
			expect(kinds.indexOf("leftover")).toBeLessThan(kinds.indexOf("preset"))
			// A node key never reaches the panel.
			const json = JSON.stringify(res)
			expect(json).not.toContain('"nodeKey"')
			expect(json).not.toContain(`"${step!.nodeKey}"`)
			void b
		} finally {
			await setPub(CHARACTERS, null)
			await db
				.delete(schema.pipelineNodeOverrides)
				.where(eq(schema.pipelineNodeOverrides.specId, spec.id))
			await db
				.delete(schema.sessionPresets)
				.where(eq(schema.sessionPresets.name, "Diff preset"))
			await db
				.delete(schema.pipelineContextTemplates)
				.where(eq(schema.pipelineContextTemplates.name, "Diff template"))
		}
	})

	test("the author's pick shows only while the pub has no layout of its own", async () => {
		const e = await layoutRow(CHARACTERS, "diff-e", "Diff E")
		const f = await layoutRow(CHARACTERS, "diff-f", "Diff F")
		const spec = await specRow()
		const [step] = await stepsRendering(STORY_RESPOND_SPEC_ID, CHARACTERS)
		let presetRow = (
			await db
				.select()
				.from(schema.pipelinePresets)
				.where(
					and(
						eq(schema.pipelinePresets.specVersionId, spec.activeVersionId!),
						eq(schema.pipelinePresets.isDefault, true)
					)
				)
		)[0]
		if (!presetRow)
			[presetRow] = await db
				.insert(schema.pipelinePresets)
				.values({
					specVersionId: spec.activeVersionId!,
					slug: "diff-authored",
					label: "Authored",
					isDefault: true
				})
				.returning()
		const [value] = await db
			.insert(schema.pipelinePresetValues)
			.values({
				presetId: presetRow!.id,
				nodeKey: step!.nodeKey,
				slot: step!.slot,
				path: step!.path,
				value: e.id
			})
			.returning()
		try {
			const authored = async () =>
				((await view(CHARACTERS)).variable.differs as any[]).filter(
					(x) => x.kind === "authored"
				)
			expect(await authored()).toEqual([
				expect.objectContaining({
					specSlug: STORY_RESPOND_SPEC_ID,
					stepKey: stepKeyFor(SECRET, step!.nodeKey),
					layout: { id: e.id, name: "Diff E" }
				})
			])
			expect(JSON.stringify(await authored())).not.toContain('"nodeKey"')
			await setPub(CHARACTERS, f.id)
			expect(await authored()).toEqual([])
		} finally {
			await setPub(CHARACTERS, null)
			await db
				.delete(schema.pipelinePresetValues)
				.where(eq(schema.pipelinePresetValues.id, value!.id))
		}
	})

	test("nothing differing is an empty list, with or without rows", async () => {
		expect((await view(PLUGIN_VARIABLE)).variable.differs).toEqual([])
		expect((await view(PERSONAS)).variable.differs).toEqual([])
	})
})
