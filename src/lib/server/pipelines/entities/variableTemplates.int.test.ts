/**
 * Variable layouts, end to end.
 *
 * The claim this file exists to hold is the one the feature was asked for:
 * **a layout written while configuring one pipeline is selectable from another.**
 * Everything else here protects that claim from the obvious ways it gets
 * removed — a spec check copied from `prompts.ts`, a picker that stopped
 * narrowing, a delete that ignores the other pipeline still using the row.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	clearOption,
	namespaceView,
	writeOption,
	type ConfigOption,
	type NamespaceView
} from "$lib/server/pipelines/config/panel"
import {
	createVariableTemplate,
	deleteVariableTemplate,
	duplicateVariableTemplate,
	listVariableTemplates,
	resolveVariableTemplate,
	updateVariableTemplate,
	VariableTemplateNotUsableError
} from "$lib/server/pipelines/entities/variableTemplates"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { resolveConfig } from "@serene-pub/sdk"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import { NARRATE_SPEC_ID } from "$lib/server/pipelines/specs/narrate"
import { renderVariable } from "$lib/server/pipelines/entities/variableLayouts"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	shippedByKey
} from "$lib/server/pipelines/entities/variableLayouts"

const SECRET = "variable-template-secret"
const CHARACTERS = "core:var/characters@1"

let db: TestDb
let adminId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "layout-admin", isAdmin: true })
		.returning()
	adminId = admin.id
}, 60_000)

const view = (slug: string): Promise<NamespaceView> =>
	namespaceView(db as any, SECRET, slug, {
		userId: adminId,
		isAdmin: true
	}) as Promise<NamespaceView>

/** Layout options live under Advanced — they are presentation, not a decision. */
const layoutOptions = (v: NamespaceView): ConfigOption[] =>
	v.steps.flatMap((s) =>
		s.advanced.filter((o) => o.control === "variable-template-ref")
	)

const charactersOption = async (slug: string) => {
	const v = await view(slug)
	const o = layoutOptions(v).find((x) => x.label === "Characters")
	expect(o, `${slug} has no characters layout option`).toBeTruthy()
	return o!
}

describe("what ships", () => {
	it("seeds an immutable layout for every variable the node renders", async () => {
		const rows = await listVariableTemplates(db as any, CHARACTERS)
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

	it("points the shipped config at one, so the picker opens on a choice", async () => {
		const option = await charactersOption(RESPOND_SPEC_ID)
		expect(typeof option.value).toBe("number")
		expect(option.variableTemplate?.name).toBe("Titled JSON block")
		expect(option.variableTemplate?.readOnly).toBe(true)
	})

	it("offers assembly's own layouts on assembly's step, not the context one", async () => {
		// The three post-budget values are declared on `assemble`, so they group
		// under *its* step. Worth pinning: they are about lore and history,
		// which reads like the context builder's business until you remember
		// that what a layout receives is what actually fit.
		const v = await view(RESPOND_SPEC_ID)
		const stepOf = (label: string) =>
			v.steps.find((s) =>
				s.advanced.some(
					(o) =>
						o.control === "variable-template-ref" &&
						o.label === label
				)
			)?.label

		expect(stepOf("World lore")).toBe("Assemble")
		expect(stepOf("History entries")).toBe("Assemble")
		expect(stepOf("Current date")).toBe("Assemble")
		expect(stepOf("Characters")).toBe("Build template context")
	})

	it("resolves assembly's layouts to sources at run time", async () => {
		const world = await buildWorld(db as any, {
			userId: adminId,
			specId: RESPOND_SPEC_ID
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
		expect(renderVariable(layouts, "worldLore", lore)).toBe(
			"World lore: \n```json\n" + JSON.stringify(lore) + "\n```"
		)
		// Empty stays falsy, which is what keeps `{{#if worldLore}}` skipping
		// the section rather than rendering an empty fenced block.
		expect(renderVariable(layouts, "worldLore", undefined)).toBe("")
	})

	it("back-fills a layout a config predates", async () => {
		/**
		 * The upgrade path, which is the only place this breaks.
		 *
		 * A reference slot has no author default — the value is a row, not a
		 * literal — so the reconciler's back-fill found `undefined` and skipped
		 * it. On a fresh install nothing showed, because `ensureDefaultConfig`
		 * writes the value. On a database seeded by the *previous* build, the
		 * setting arrived pointing at nothing: "— Pipeline Default —" above
		 * output that plainly had a layout. Found by booting the new build
		 * against an existing database, not by any test that existed.
		 */
		const { reconcileConfigs } = await import("$lib/server/pipelines/config/named")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)

		const before = await charactersOption(RESPOND_SPEC_ID)
		expect(typeof before.value).toBe("number")

		// Rewind: drop every layout value, as an older version's config would
		// never have written them.
		const dropped = (
			await db.select().from(schema.pipelineConfigValues)
		).filter((v: any) => v.slot === "variables")
		expect(dropped.length).toBeGreaterThan(0)
		for (const v of dropped as any[])
			await db
				.delete(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.id, v.id))

		await reconcileConfigs(
			db as any,
			spec.id,
			spec.activeVersionId!,
			RESPOND_SPEC_ID
		)

		const after = await charactersOption(RESPOND_SPEC_ID)
		expect(after.value).toBe(before.value)
		expect(after.variableTemplate?.name).toBe("Titled JSON block")
	})

	it("never sends the variable id, which is shaped like a node key", async () => {
		// `core:var/history@1` matches `\bhistory\b`, and `history` is a node key
		// in the respond spec. The payload is scanned for topology (05 §0a), so
		// this field is deliberately server-side only.
		const option = await charactersOption(RESPOND_SPEC_ID)
		expect(JSON.stringify(option)).not.toContain("core:var/")
	})
})

describe("the picker", () => {
	it("offers only layouts for this option's own variable", async () => {
		const foreign = await createVariableTemplate(db as any, {
			variableId: "core:var/personas@1",
			name: "Prose personas",
			source: "{{#each personas}}{{this.name}}\n{{/each}}"
		})

		const option = await charactersOption(RESPOND_SPEC_ID)
		expect(option.choices?.some((c) => c.id === foreign.id)).toBe(false)
		// And it does offer the ones that belong to it.
		const mine = await listVariableTemplates(db as any, CHARACTERS)
		for (const row of mine)
			expect(option.choices?.some((c) => c.id === row.id)).toBe(true)
	})

	it("refuses a layout written for a different variable", async () => {
		const { assertSelectable } = await import("$lib/server/pipelines/entities/variableTemplates")
		const [personas] = await listVariableTemplates(
			db as any,
			"core:var/personas@1"
		)
		await expect(
			assertSelectable(db as any, CHARACTERS, personas!.id)
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)
	})
})

describe("editing", () => {
	it("refuses to edit or delete what Serene Pub ships", async () => {
		const [shipped] = await listVariableTemplates(db as any, CHARACTERS)
		await expect(
			updateVariableTemplate(db as any, shipped!.id, { source: "x" })
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)
		await expect(
			deleteVariableTemplate(db as any, shipped!.id)
		).rejects.toBeInstanceOf(VariableTemplateNotUsableError)
	})

	it("duplicates into the same variable, which is what keeps it selectable", async () => {
		const [shipped] = await listVariableTemplates(db as any, CHARACTERS)
		const copy = await duplicateVariableTemplate(
			db as any,
			shipped!.id,
			"Characters copy"
		)
		expect(copy.variableId).toBe(shipped!.variableId)
		expect(copy.source).toBe(shipped!.source)
		expect(copy.isImmutable).toBe(false)

		await updateVariableTemplate(db as any, copy.id, {
			source: "{{#each characters}}{{this.name}}: {{this.description}}\n{{/each}}"
		})
		const after = await resolveVariableTemplate(db as any, copy.id)
		expect(after?.source).toContain("{{#each characters}}")
	})
})

describe("cross-pipeline reuse", () => {
	/**
	 * The headline feature, and its only test.
	 *
	 * A layout is keyed by the variable it renders, not by the spec it was
	 * authored in — so a prose rendering written while configuring replies is
	 * selectable from narration, and both pipelines resolve to the same row. A
	 * spec check copied from `prompts.ts` would compile, pass review, and remove
	 * exactly this.
	 */
	it("selects one row from two unrelated pipelines", async () => {
		const prose = await createVariableTemplate(db as any, {
			variableId: CHARACTERS,
			name: "Prose",
			source: "{{#each characters}}{{this.name}} — {{this.description}}\n{{/each}}"
		})

		const respondOption = await charactersOption(RESPOND_SPEC_ID)
		const narrateOption = await charactersOption(NARRATE_SPEC_ID)

		// Both pickers offer it, without it having been written "for" either.
		expect(respondOption.choices?.some((c) => c.id === prose.id)).toBe(true)
		expect(narrateOption.choices?.some((c) => c.id === prose.id)).toBe(true)

		for (const [slug, option] of [
			[RESPOND_SPEC_ID, respondOption],
			[NARRATE_SPEC_ID, narrateOption]
		] as const)
			await writeOption(
				db as any,
				SECRET,
				slug,
				{ userId: adminId, isAdmin: true },
				option.id,
				prose.id,
				option.writeAt
			)

		for (const slug of [RESPOND_SPEC_ID, NARRATE_SPEC_ID]) {
			const after = await charactersOption(slug)
			expect(after.value).toBe(prose.id)
			expect(after.variableTemplate?.source).toContain(
				"{{#each characters}}"
			)
		}
	})

	it("refuses to delete a layout the other pipeline is still using", async () => {
		const rows = await listVariableTemplates(db as any, CHARACTERS)
		const prose = rows.find((r) => r.name === "Prose")!

		// Release only the reply pipeline's selection. The narrator's still
		// holds the row, and this is the case a per-spec check would miss.
		const respondOption = await charactersOption(RESPOND_SPEC_ID)
		await clearOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			{ userId: adminId, isAdmin: true },
			respondOption.id,
			respondOption.writeAt
		)

		await expect(
			deleteVariableTemplate(db as any, prose.id)
		).rejects.toThrow(/still in use/)
	})
})

describe("the runtime resolves what the panel shows", () => {
	/**
	 * The panel and the run must agree, and they are two separate walks of the
	 * same chain — so this checks the *runtime* side reaches the same row, and
	 * that what arrives at the node is the template rather than its id.
	 */
	const resolvedLayouts = async (slug: string) => {
		const world = await buildWorld(db as any, {
			userId: adminId,
			specId: slug
		})
		const config = resolveConfig(world, ["context"])
		return config.context?.variables ?? {}
	}

	it("hands the node a template source, not a row id", async () => {
		const layouts = await resolvedLayouts(NARRATE_SPEC_ID)
		expect(layouts.characters).toMatchObject({
			source: expect.stringContaining("{{#each characters}}")
		})
		expect(typeof (layouts.characters as any)?.source).toBe("string")
	})

	it("renders through the selected layout", async () => {
		const layouts = await resolvedLayouts(NARRATE_SPEC_ID)
		const cast = [{ name: "Ash", description: "A rider." }]
		expect(renderVariable(layouts as any, "characters", cast)).toBe(
			"Ash — A rider.\n"
		)
	})

	it("falls back to the shipped bytes when the selection is cleared", async () => {
		// Cleared above for the reply pipeline: with no override, the shipped
		// layout projected at `defaults` wins, and it renders what the old
		// TypeScript rendered.
		const layouts = await resolvedLayouts(RESPOND_SPEC_ID)
		const cast = [{ name: "Ash", description: "A rider." }]
		expect(renderVariable(layouts as any, "characters", cast)).toBe(
			"Assistant Characters (AI-controlled):\n```json\n" +
				JSON.stringify(cast, null, 2) +
				"\n```"
		)
	})

	it("still renders the shipped bytes when nothing resolves at all", async () => {
		// A dangling reference drops to undefined rather than erroring, so the
		// in-code floor is what a deleted row actually costs: a customization,
		// never a prompt.
		const cast = [{ name: "Ash", description: "A rider." }]
		expect(renderVariable(undefined, "characters", cast)).toBe(
			"Assistant Characters (AI-controlled):\n```json\n" +
				JSON.stringify(cast, null, 2) +
				"\n```"
		)
	})
})

describe("the mutation gate", () => {
	/**
	 * What stands in for `promptInSpec`, and why it cannot be `promptInSpec`.
	 *
	 * Layout ids are small integers a client supplies, so something has to
	 * refuse a guessed one. It cannot be spec ownership — sharing across
	 * pipelines is the feature — so the gate is the *option handle*: you may
	 * edit a layout through a setting this pipeline offers you and you are
	 * allowed to write.
	 */
	const gate = async (viewer: any, id: string) => {
		const { variableOptionGate } = await import("$lib/server/pipelines/config/panel")
		return await variableOptionGate(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer,
			id
		)
	}

	it("resolves the option's variable for an admin", async () => {
		const option = await charactersOption(RESPOND_SPEC_ID)
		await expect(
			gate({ userId: adminId, isAdmin: true }, option.id)
		).resolves.toEqual({ variableId: CHARACTERS })
	})

	it("refuses a non-admin, where the panel would not have offered it", async () => {
		const option = await charactersOption(RESPOND_SPEC_ID)
		const [plain] = await db
			.insert(schema.users)
			.values({ username: "layout-guesser", isAdmin: false })
			.returning()
		// The ids are HMAC handles, not secrets a viewer was granted — hiding
		// the control is not what protects it, this is.
		await expect(
			gate({ userId: plain.id, isAdmin: false }, option.id)
		).rejects.toThrow(/administrator/)
	})

	it("refuses an option that does not choose a layout", async () => {
		const v = await view(RESPOND_SPEC_ID)
		const other = v.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.find((o) => o.control === "prompts-ref")!
		await expect(
			gate({ userId: adminId, isAdmin: true }, other.id)
		).rejects.toThrow(/does not choose a layout/)
	})

	it("refuses a handle this install never minted", async () => {
		await expect(
			gate({ userId: adminId, isAdmin: true }, "deadbeef".repeat(4))
		).rejects.toThrow(/not part of this pipeline/)
	})
})

describe("who may change a layout", () => {
	it("is not offered to a non-admin at all", async () => {
		// Ratified for 0.6: a non-admin sees prompts and nothing else. How
		// characters are laid out is the instance's configuration — two users
		// whose prompts render differently are two users whose reports cannot
		// be compared.
		const [plain] = await db
			.insert(schema.users)
			.values({ username: "layout-plain", isAdmin: false })
			.returning()

		const v = (await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: plain.id,
			isAdmin: false
		})) as NamespaceView
		expect(layoutOptions(v)).toEqual([])
	})

	it("writes an admin's choice at instance scope", async () => {
		const option = await charactersOption(RESPOND_SPEC_ID)
		expect(option.writeAt).toBe("instance")

		const rows = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.slot, "variables"),
					eq(schema.pipelineNodeOverrides.scopeKind, "instance")
				)
			)
		// The narrator's selection from the reuse test above.
		expect(rows.length).toBeGreaterThan(0)
	})
})

/**
 * Last, because it deletes the row the tests above are built on.
 *
 * Two halves of one rule, and the second is what live use found. Deleting from
 * a pipeline that has the row selected must not be blocked *by that selection*
 * — the button sits beside it. But a refusal has to leave the caller's
 * selection exactly where it was: the first version released the caller's rows
 * before attempting the delete, so a *refused* delete reset the setting on its
 * way to failing. For layouts that is the common path, not the exotic one,
 * since another pipeline holding the row is precisely what refuses.
 */
describe("deleting what you have selected", () => {
	it("ignores the caller's own rows without releasing them first", async () => {
		const prose = (await listVariableTemplates(db as any, CHARACTERS)).find(
			(r) => r.name === "Prose"
		)!

		const own = (
			await db.select().from(schema.pipelineNodeOverrides)
		).filter((o: any) => o.value === prose.id)
		expect(own.length).toBeGreaterThan(0)

		// Refused while those rows count — and the rows are still there after,
		// which is the part that regressed.
		await expect(
			deleteVariableTemplate(db as any, prose.id)
		).rejects.toThrow(/still in use/)
		const after = (
			await db.select().from(schema.pipelineNodeOverrides)
		).filter((o: any) => o.value === prose.id)
		expect(after.length).toBe(own.length)

		// Allowed once they are discounted, which is what the socket handler
		// passes — and only then does it clear them.
		await expect(
			deleteVariableTemplate(db as any, prose.id, {
				ignoreOverrideIds: new Set(own.map((o: any) => o.id))
			})
		).resolves.toBeUndefined()
	})
})
