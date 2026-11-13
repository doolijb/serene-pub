/**
 * **Move into the template** keeps the step's rendered context byte-identical
 * (PLAN variable-layouts 2026-11-10, W4 + Render item 6): before the move the
 * ⏳ leftover picks write each key out; after it the template names the same
 * rows by reference (`layout <key> "<reference>"`) and the picks are gone —
 * and the prompt Assemble renders is the same bytes. Written beside
 * `pipelines.leftoverPicks.int.test.ts`, which asserts the rewrite itself.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { resolveConfig } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { stepKeyFor } from "$lib/server/pipelines/config/panel/ids"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

const WORLD_LORE = "core:var/world-lore@1"
const CHARACTER_LORE = "core:var/character-lore@1"
const SLUG = STORY_RESPOND_SPEC_ID
const STEP = { nodeKey: "prompt", slot: "variables" }

let db: TestDb
let dataDir: string
let admin: { id: number }

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "leftover-bytes-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-leftover-bytes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await (
		await import("$lib/server/pipelines/boot/bootstrap")
	).bootstrapPipelines(db as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	admin = await createTestUser(db, "leftover-bytes-admin")
	await db
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** What Assemble renders for the step as it is configured right now. */
async function renderStep() {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const { allocate, render } = await import(
		"$lib/server/pipelines/prompt/assemble"
	)
	const world = await buildWorld(db as any, { specId: SLUG })
	const slots = (resolveConfig(world as any, [STEP.nodeKey]) as any)[
		STEP.nodeKey
	]
	const decision = (id: number, source: string, name: string, content: string) => ({
		candidate: {
			id,
			source,
			tokens: 10,
			signals: {},
			payload: { name, content }
		},
		score: 0.6,
		reason: "filled_scored" as const,
		included: true,
		why: "scored"
	})
	const out = await render({
		allocation: allocate(
			[
				decision(1, "worldLore", "The Ashguard", 'Riders "of" <ash>.'),
				decision(2, "characterLore", "Ash", "Keeps the watch.")
			] as any,
			{ budgetTotal: 100 }
		),
		engine: slots.template.engine,
		template: slots.template.source,
		variables: slots.variables,
		messages: []
	} as any)
	return { out, slots }
}

describe("moveLeftoversIntoTemplate keeps the rendered context byte-identical", () => {
	test("the same bytes before and after, with the receipt's reason moving from leftover to template", async () => {
		const { createVariableTemplate } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		const { createContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		const { setPipelineGenreValue } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		const world = await createVariableTemplate(db as any, {
			variableId: WORLD_LORE,
			name: "World pick",
			source: "WORLD<<{{{json worldLore 0}}}>>",
			reference: { ownerSlug: "acme", slug: "world-pick" }
		} as any)
		const lore = await createVariableTemplate(db as any, {
			variableId: CHARACTER_LORE,
			name: "Lore pick",
			source: "LORE<<{{{json characterLore 0}}}>>",
			reference: { ownerSlug: "acme", slug: "lore-pick" }
		} as any)
		const copy = await createContextTemplate(db as any, {
			nodeDefinitionId: "core:task/assemble",
			name: "Bytes story string",
			source:
				"A {{{worldLore}}}\nB {{ worldLore }}\nC {{{characterLore}}}\nD {{#if worldLore}}yes{{/if}}"
		})
		await setPipelineGenreValue(
			db as any,
			SLUG,
			{ nodeKey: "prompt", slot: "template", path: "" },
			copy.id
		)
		for (const [key, id] of [
			["worldLore", world.id],
			["characterLore", lore.id]
		] as const)
			await setPipelineGenreValue(
				db as any,
				SLUG,
				{ ...STEP, path: key },
				id
			)

		const before = await renderStep()
		expect(before.out.rendered).toContain('WORLD<<{"The Ashguard":"Riders \\"of\\" <ash>."}>>')
		expect(before.out.rendered).toContain('LORE<<')
		expect(before.out.layouts?.map((l) => l.reason)).toEqual(
			expect.arrayContaining(["leftover"])
		)

		const handlers = await import("./pipelines")
		const res: any = await (handlers as any).pipelinesMoveLeftoversIntoTemplate.handler(
			{
				user: { id: admin.id, isAdmin: true },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{
				slug: SLUG,
				stepKey: stepKeyFor("leftover-bytes-test-secret", STEP.nodeKey),
				slot: STEP.slot,
				ownerSlug: "acme"
			},
			() => {}
		)
		expect(res.error).toBeUndefined()
		expect(res.moved).toHaveLength(2)

		const after = await renderStep()
		expect(after.slots.template.source).toContain('layout worldLore "acme/world-pick@1"')
		expect(after.out.rendered).toBe(before.out.rendered)
		// The picks are gone; the template says which layout each read used.
		const reasons = after.out.layouts?.map((l) => l.reason) ?? []
		expect(reasons).not.toContain("leftover")
		expect(reasons).toContain("template")
		expect(after.out.layouts?.find((l) => l.reason === "template")).toMatchObject({
			layout: expect.stringMatching(/World pick|Lore pick/),
			origin: "own"
		})
		expect(
			after.out.layouts?.every((l) => l.missingReference === undefined)
		).toBe(true)
	}, 120_000)

	test("a key the context builder lays out: the same bytes, and the template fits", async () => {
		const CHARACTERS = "core:var/characters@1"
		const cast = [{ name: "Ash", description: 'Keeps the "watch".' }]
		const { createVariableTemplate } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		const { createContextTemplate } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		const { setPipelineGenreValue } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		const pick = await createVariableTemplate(db as any, {
			variableId: CHARACTERS,
			name: "Cast pick",
			source: "CAST<<{{{json characters 0}}}>>",
			reference: { ownerSlug: "acme", slug: "cast-pick" }
		} as any)
		const copy = await createContextTemplate(db as any, {
			nodeDefinitionId: "core:task/assemble",
			name: "Bytes cast string",
			source: "A {{{characters}}}\nB {{ characters }}\nC {{#if characters}}yes{{/if}}"
		})
		await setPipelineGenreValue(
			db as any,
			SLUG,
			{ nodeKey: "prompt", slot: "template", path: "" },
			copy.id
		)
		const BUILDER = { nodeKey: "context", slot: "variables" }
		await setPipelineGenreValue(
			db as any,
			SLUG,
			{ ...BUILDER, path: "characters" },
			pick.id
		)

		const renderBoth = async () => {
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
				characters: cast,
				personas: [],
				characterNames: ["Ash"],
				personaNames: [],
				charName: "Ash",
				personaName: "Rell",
				variables: slots.context.variables
			})
			const out = await render({
				allocation: allocate([], { budgetTotal: 100 }),
				engine: slots.prompt.template.engine,
				template: slots.prompt.template.source,
				variables: slots.prompt.variables,
				templateContext: JSON.parse(JSON.stringify(built)),
				messages: []
			} as any)
			return { out, source: slots.prompt.template.source as string }
		}

		const before = await renderBoth()
		expect(before.out.rendered).toContain('CAST<<[{"name":"Ash"')

		const handlers = await import("./pipelines")
		const res: any = await (handlers as any).pipelinesMoveLeftoversIntoTemplate.handler(
			{
				user: { id: admin.id, isAdmin: true },
				io: { to: () => ({ emit: () => {} }) }
			} as any,
			{
				slug: SLUG,
				stepKey: stepKeyFor(
					"leftover-bytes-test-secret",
					BUILDER.nodeKey
				),
				slot: BUILDER.slot,
				ownerSlug: "acme"
			},
			() => {}
		)
		expect(res.error).toBeUndefined()
		expect(res.moved).toHaveLength(1)

		const after = await renderBoth()
		expect(after.source).toContain('layout characters "acme/cast-pick@1"')
		expect(after.out.rendered).toBe(before.out.rendered)
		expect(
			after.out.layouts?.filter((l) => l.key === "characters" && l.reason === "template")
		).toHaveLength(1)
		expect(after.out.layouts?.every((l) => l.missingReference === undefined)).toBe(true)

		// The moved template fits the step it renders at.
		const { contextTemplateMisfit } = await import(
			"$lib/server/pipelines/entities/contextTemplateFit"
		)
		const { published } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const at = (await published(db as any, SLUG))!
		expect(
			await contextTemplateMisfit(
				db as any,
				{ specVersionId: at.specVersionId, nodeKey: "prompt", slot: "template" },
				{ name: "Moved", engine: null, source: after.source }
			)
		).toBeNull()
	}, 120_000)
})
