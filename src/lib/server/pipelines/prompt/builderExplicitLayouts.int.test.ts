/**
 * Explicit layout references for a key laid out upstream
 * (PLAN variable-layouts 2026-11-10, vl-D-w7): `layout characters "core/json@1"`
 * in the respond step's context template. `characters` is written out by the
 * context builder, not by Assemble, so its reference is resolved by the world
 * at the builder's `variables` slot, written out by `buildTemplateContext`,
 * and placed by Assemble — with the check agreeing it is laid out upstream.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { resolveConfig } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

const SLUG = STORY_RESPOND_SPEC_ID
const CHARACTERS = "core:var/characters@1"
const CAST = [{ name: "Ash", description: "Keeps the <watch>." }]
const BARE_JSON = JSON.stringify(CAST, null, 2)

let db: TestDb
let dataDir: string
let specVersionId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "builder-explicit-layouts-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-builder-explicit-layouts-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await (
		await import("$lib/server/pipelines/boot/bootstrap")
	).bootstrapPipelines(db as any)
	const { published } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	specVersionId = (await published(db as any, SLUG))!.specVersionId
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A pub copy of the respond template, selected for the spec. */
async function select(source: string, engine?: string) {
	const { createContextTemplate } = await import(
		"$lib/server/pipelines/entities/contextTemplates"
	)
	const { setPipelineGenreValue } = await import(
		"$lib/server/pipelines/registrations/genreValues"
	)
	const copy = await createContextTemplate(db as any, {
		nodeDefinitionId: "core:task/assemble",
		name: `Builder refs ${Math.random().toString(36).slice(2, 8)}`,
		source,
		...(engine ? { engine } : {})
	})
	await setPipelineGenreValue(
		db as any,
		SLUG,
		{ nodeKey: "prompt", slot: "template", path: "" },
		copy.id
	)
	return copy
}

/** The builder, then Assemble, as the respond pipeline runs them. */
async function run() {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const { buildTemplateContext } = await import(
		"$lib/server/pipelines/prompt/templateContext"
	)
	const { allocate, render } = await import(
		"$lib/server/pipelines/prompt/assemble"
	)
	const world = await buildWorld(db as any, { specId: SLUG })
	const slots = resolveConfig(world as any, ["context", "prompt"]) as any
	const built = await buildTemplateContext({
		characters: CAST,
		personas: [],
		characterNames: ["Ash"],
		personaNames: [],
		charName: "Ash",
		personaName: "Rell",
		variables: slots.context.variables
	})
	// The builder's output crosses a port and is recorded: plain JSON.
	const templateContext = JSON.parse(JSON.stringify(built))
	const out = await render({
		allocation: allocate([], { budgetTotal: 100 }),
		engine: slots.prompt.template.engine,
		template: slots.prompt.template.source,
		variables: slots.prompt.variables,
		templateContext,
		messages: []
	} as any)
	return { out, built, slots }
}

async function misfit(source: string, engine?: string) {
	const { contextTemplateMisfit } = await import(
		"$lib/server/pipelines/entities/contextTemplateFit"
	)
	return contextTemplateMisfit(
		db as any,
		{ specVersionId, nodeKey: "prompt", slot: "template" },
		{ name: "Draft", engine: engine ?? null, source }
	)
}

describe("a reference to a key the context builder lays out", () => {
	test("Handlebars: the bare JSON, not the pub's titled block; receipt says template; the template fits", async () => {
		const source = 'T[{{{layout characters "core/json@1"}}}]\nB[{{{characters}}}]'
		expect(await misfit(source)).toBeNull()
		await select(source)
		const { out, built } = await run()
		const [named, bare] = out.rendered!.split("\nB[")
		expect(named).toBe(`T[${BARE_JSON}]`)
		// The pub's layout (a titled block) still writes the bare read.
		expect(bare).not.toBe(`${BARE_JSON}]`)
		expect(bare).toContain(BARE_JSON.split("\n")[1]!)
		expect(built).toHaveProperty("namedLayouts.characters.references")
		const line = out.layouts?.find((l) => l.key === "characters")
		expect(line).toMatchObject({ reason: "template", origin: "shipped" })
		expect(line?.missingReference).toBeUndefined()
	}, 60_000)

	test("Liquid: the same", async () => {
		const { CORE_LIQUID_ENGINE } = await import(
			"$lib/server/pipelines/prompt/renderers"
		)
		const source = 'T[{{ characters | layout: "core/json@1" }}]'
		expect(await misfit(source, CORE_LIQUID_ENGINE)).toBeNull()
		await select(source, CORE_LIQUID_ENGINE)
		const { out } = await run()
		expect(out.rendered).toBe(`T[${BARE_JSON}]`)
		expect(
			out.layouts?.filter((l) => l.key === "characters" && l.reason === "template")
		).toHaveLength(1)
	}, 60_000)

	test("{{layout …}} and {{{layout …}}} print the same", async () => {
		await select('{{layout characters "core/json@1"}}')
		const two = (await run()).out.rendered
		await select('{{{layout characters "core/json@1"}}}')
		const three = (await run()).out.rendered
		expect(two).toBe(three)
		expect(two).toBe(BARE_JSON)
	}, 60_000)

	test("an unknown reference renders the in-use text and the receipt says so", async () => {
		const source = 'A[{{{layout characters "core/nope@1"}}}]\nB[{{{characters}}}]'
		// Refused at select; a stored template still runs.
		expect(await misfit(source)).toMatch(/core\/nope@1/)
		await select(source)
		const { out } = await run()
		const [a, b] = out.rendered!.split("\nB[")
		expect(a!.slice(2, -1)).toBe(b!.slice(0, -1))
		expect(a).not.toBe(`A[${BARE_JSON}]`)
		expect(
			out.layouts?.find((l) => l.key === "characters" && l.missingReference)
		).toMatchObject({ missingReference: "core/nope@1", reason: "default" })
	}, 60_000)

	test("a key nothing lays out stays refused", async () => {
		expect(await misfit('{{{layout char "core/json@1"}}}')).toMatch(/char/)
	}, 60_000)

	test("no call: the builder adds nothing and the bytes are the ones they were", async () => {
		await select("S[{{{characters}}}]")
		const { out, built } = await run()
		expect(built).not.toHaveProperty("namedLayouts")
		expect(out.rendered).toContain("S[")
	}, 60_000)

	test("preview renders a draft naming a valid builder-key reference through it", async () => {
		const { draftReferenceLayouts } = await import(
			"$lib/server/pipelines/entities/variableLayouts"
		)
		const { previewContextTemplate } = await import(
			"$lib/server/pipelines/prompt/preview"
		)
		const { CORE_TEMPLATE_ENGINE } = await import(
			"$lib/server/pipelines/prompt/renderers"
		)
		const source =
			'{{#systemBlock}}C:{{{layout characters "core/json@1"}}}{{/systemBlock}}'
		const layouts = await draftReferenceLayouts(
			db as any,
			CORE_TEMPLATE_ENGINE,
			source
		)
		expect(layouts.characters?.variableId).toBe(CHARACTERS)
		const res = await previewContextTemplate({
			source,
			engine: CORE_TEMPLATE_ENGINE,
			layouts
		})
		expect(res.error).toBeUndefined()
		const bare = await previewContextTemplate({
			source: "{{#systemBlock}}C:{{{characters}}}{{/systemBlock}}",
			engine: CORE_TEMPLATE_ENGINE,
			layouts
		})
		expect(JSON.stringify(res.messages)).not.toBe(JSON.stringify(bare.messages))
		expect(JSON.stringify(res.messages)).toContain("Ash")
	}, 60_000)
})
