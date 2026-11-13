/**
 * Variable layouts, end to end.
 *
 * The claim this file exists to hold: **a layout is a statement about a
 * variable, not about a pipeline.** A row written for characters is the pub's
 * layout for characters in every pipeline that renders them. The per-step
 * picker is gone (PLAN variable-layouts 2026-11-10), so what remains is the
 * rows themselves — what ships, what may be edited, what refuses deleting —
 * and that the run resolves the pub's layout, in every pipeline, from one
 * choice. Everything else here protects that claim from the obvious ways it
 * gets removed: a spec check copied from `prompts.ts`, a selection that stopped
 * being checked against its variable, a delete that ignores who still uses
 * the row.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	createVariableTemplate,
	deleteVariableTemplate,
	duplicateVariableTemplate,
	listVariableTemplates,
	resolveVariableTemplate,
	setPubLayout,
	updateVariableTemplate,
	VariableTemplateNotUsableError
} from "$lib/server/pipelines/entities/variableTemplates"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { resolveConfig } from "@serene-pub/sdk"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { STORY_NARRATE_SPEC_ID } from "$lib/server/pipelines/specs/narrate"
import { renderVariable } from "$lib/server/pipelines/entities/variableLayouts"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	shippedByKey
} from "$lib/server/pipelines/entities/variableLayouts"

const CHARACTERS = "core:var/characters@1"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 60_000)

describe("what ships", () => {
	it("seeds an immutable layout for every variable the node renders", async () => {
		const rows = await listVariableTemplates(db, CHARACTERS)
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.every((r: any) => r.isImmutable)).toBe(true)
		// Two rows, and the order is what a picker opens on: the titled block
		// reproduces 0.5 exactly, and the bare one is what an install whose
		// context template writes its own heading gets pinned to.
		expect(rows.map((r: any) => r.name)).toEqual([
			"Titled JSON block",
			"JSON"
		])
		// What the seeded rows contain is asserted against the shipped
		// definitions rather than restated here. Restating it made this test
		// fail the moment the characters layout became explicit — which is a
		// change `variableTemplates.parity.test.ts` is the right place to
		// police, byte for byte, against the code default. What *this* file is
		// for is that seeding put the right two rows in the database, in the
		// right order, immutable.
		const shipped = SHIPPED_VARIABLE_TEMPLATES.filter(
			(t) => t.key === "characters"
		)
		expect(rows.map((r: any) => r.source)).toEqual(
			shipped.map((t) => t.source)
		)
		// The heading and fence still live in the wrapped row and not the bare
		// one, which is the property the pinning migration depends on.
		expect(rows[0]!.source).toContain(
			"Assistant Characters (AI-controlled):\n```json\n"
		)
		expect(rows[1]!.source).not.toContain("Assistant Characters")
	})

	it("resolves assembly's layouts to sources at run time", async () => {
		const world = await buildWorld(db, {
			specId: STORY_RESPOND_SPEC_ID
		})
		const layouts = (resolveConfig(world, ["prompt"]).prompt?.variables ??
			{}) as any

		// That resolution reached the shipped row, not that the row contains a
		// particular string — restating the source here made this fail when the
		// layout was written out explicitly, which is a change
		// `variableTemplates.parity.test.ts` polices byte for byte against the
		// code default. The behavioural assertion below is the one with teeth.
		expect(layouts.worldLore?.source).toBe(
			shippedByKey.get("worldLore")!.source
		)
		// And it renders what 0.5 put in the prompt — the minified JSON the
		// code produced directly, inside the heading and fence the context
		// template used to carry.
		const lore = { "The Ashguard": "Riders who patrol the ash wastes." }
		expect(await renderVariable(layouts, "worldLore", lore)).toBe(
			"World lore: \n```json\n" + JSON.stringify(lore) + "\n```"
		)
		// Empty stays falsy, which is what keeps `{{#if worldLore}}` skipping
		// the section rather than rendering an empty fenced block.
		expect(await renderVariable(layouts, "worldLore", undefined)).toBe("")
	})
})

describe("selection is by variable", () => {
	it("refuses a layout written for a different variable", async () => {
		const { assertSelectable } = await import(
			"$lib/server/pipelines/entities/variableTemplates"
		)
		const [personas] = await listVariableTemplates(
			db,
			"core:var/personas@1"
		)
		await expect(
			assertSelectable(db, CHARACTERS, personas!.id)
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)
	})

	it("refuses another variable's row as the pub's layout", async () => {
		const [personas] = await listVariableTemplates(
			db,
			"core:var/personas@1"
		)
		await expect(
			setPubLayout(db, CHARACTERS, personas!.id)
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)
	})
})

describe("editing", () => {
	it("refuses to edit or delete what Serene Pub ships", async () => {
		const [shipped] = await listVariableTemplates(db, CHARACTERS)
		await expect(
			updateVariableTemplate(db, shipped!.id, { source: "x" })
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)
		await expect(
			deleteVariableTemplate(db, shipped!.id)
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)
	})

	it("duplicates into the same variable, which is what keeps it selectable", async () => {
		const [shipped] = await listVariableTemplates(db, CHARACTERS)
		const copy = await duplicateVariableTemplate(
			db,
			shipped!.id,
			"Characters copy"
		)
		expect(copy.variableId).toBe(shipped!.variableId)
		expect(copy.source).toBe(shipped!.source)
		expect(copy.isImmutable).toBe(false)

		await updateVariableTemplate(db, copy.id, {
			source: "{{#each characters}}{{this.name}}: {{this.description}}\n{{/each}}"
		})
		const after = await resolveVariableTemplate(db, copy.id)
		expect(after?.source).toContain("{{#each characters}}")
	})
})

describe("one choice reaches every pipeline", () => {
	/**
	 * The headline feature, and its only test. A layout is keyed by the variable
	 * it renders, not by the spec it was authored in — so the prose rendering an
	 * admin chose once is what the reply pipeline and the narrator both write
	 * characters out with. A spec check copied from `prompts.ts` would compile,
	 * pass review, and remove exactly this.
	 */
	const resolvedLayouts = async (slug: string) => {
		const world = await buildWorld(db, { specId: slug })
		return (resolveConfig(world, ["context"]).context?.variables ??
			{}) as any
	}
	const cast = [{ name: "Ash", description: "A rider." }]
	const titled =
		"Assistant Characters (AI-controlled):\n```json\n" +
		JSON.stringify(cast, null, 2) +
		"\n```"

	it("opens on the package default, in every pipeline", async () => {
		for (const slug of [STORY_RESPOND_SPEC_ID, STORY_NARRATE_SPEC_ID]) {
			const layouts = await resolvedLayouts(slug)
			expect(layouts.characters).toMatchObject({
				name: "Titled JSON block",
				reason: "default"
			})
			expect(await renderVariable(layouts, "characters", cast)).toBe(
				titled
			)
		}
	})

	it("writes one pub's layout into two unrelated pipelines", async () => {
		const prose = await createVariableTemplate(db, {
			variableId: CHARACTERS,
			name: "Prose",
			source: "{{#each characters}}{{this.name}} — {{this.description}}\n{{/each}}",
			reference: { ownerSlug: "mypub", slug: "prose" }
		})
		await setPubLayout(db, CHARACTERS, prose.id)

		for (const slug of [STORY_RESPOND_SPEC_ID, STORY_NARRATE_SPEC_ID]) {
			const layouts = await resolvedLayouts(slug)
			// What arrives is the template's source, not the row's id.
			expect(typeof layouts.characters?.source).toBe("string")
			expect(layouts.characters).toMatchObject({
				name: "Prose",
				reason: "pub"
			})
			expect(await renderVariable(layouts, "characters", cast)).toBe(
				"Ash — A rider.\n"
			)
		}
	})

	it("falls back to the shipped bytes when the pub's layout is cleared", async () => {
		await setPubLayout(db, CHARACTERS, null)
		const layouts = await resolvedLayouts(STORY_RESPOND_SPEC_ID)
		expect(layouts.characters.reason).toBe("default")
		expect(await renderVariable(layouts, "characters", cast)).toBe(titled)
	})

	it("still renders the shipped bytes when nothing resolves at all", async () => {
		// A dangling reference drops to undefined rather than erroring, so the
		// in-code floor is what a deleted row actually costs: a customization,
		// never a prompt.
		expect(await renderVariable(undefined, "characters", cast)).toBe(titled)
	})
})

describe("what refuses a delete", () => {
	const proseId = async () =>
		(await listVariableTemplates(db, CHARACTERS)).find(
			(r) => r.name === "Prose"
		)!.id

	it("refuses while the row is the pub's layout, and says what to do", async () => {
		const id = await proseId()
		await setPubLayout(db, CHARACTERS, id)
		await expect(deleteVariableTemplate(db, id)).rejects.toThrow(
			/pub's layout/
		)
		await setPubLayout(db, CHARACTERS, null)
	})

	it("refuses while a preset chose it for its sessions", async () => {
		const id = await proseId()
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({
				genreId: "core:genre/story@1",
				name: "Small models",
				variableLayouts: { [CHARACTERS]: "mypub/prose@1" }
			} as any)
			.returning()
		await expect(deleteVariableTemplate(db, id)).rejects.toThrow(
			/Small models/
		)
		await db
			.delete(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, preset.id))
	})

	it("refuses while a step still has it picked (a leftover pick)", async () => {
		const id = await proseId()
		const { declarationsAndVariableKeys } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
		const { variableKeys } = await declarationsAndVariableKeys(
			db,
			spec.activeVersionId!
		)
		const key = variableKeys.find((k) => k.variableId === CHARACTERS)!
		const [held] = await db
			.insert(schema.pipelineNodeOverrides)
			.values({
				specId: spec.id,
				scopeKind: "session",
				scopeId: 0,
				nodeKey: key.nodeKey,
				slot: key.slot,
				path: key.path,
				value: id
			})
			.returning()
		await expect(deleteVariableTemplate(db, id)).rejects.toThrow(
			/still in use/
		)
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.id, held.id))
	})

	it("deletes once nothing holds it", async () => {
		const id = await proseId()
		await expect(deleteVariableTemplate(db, id)).resolves.toBeUndefined()
		expect(
			(await listVariableTemplates(db, CHARACTERS)).some(
				(r) => r.id === id
			)
		).toBe(false)
	})
})
