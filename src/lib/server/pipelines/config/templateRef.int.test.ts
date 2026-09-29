/**
 * An author preset points a template slot at a ROW, by **template id** (R19).
 *
 * ## The gap this closes
 *
 * A config value at a `prompts`, `template` or `variables` address is an
 * integer row id — assigned by an identity sequence, different on every
 * install, so no shipped document can write one. Sampling had already been
 * given a door for exactly this (`{ seedKey: 'sampling-background' }`); these
 * three had none. What a spec got instead was `defaultPromptFor`'s pool
 * heuristics, whose first and only precise step reads `default_for_specs` — a
 * list on CORE'S OWN catalog rows. So a third-party spec added to a genre could
 * not say which of that genre's prompts it starts on: the only way to claim a
 * row was to edit core's catalog.
 *
 * The door is `{ templateId: 'core:template/…@1' }`, and it resolves in the
 * same place and the same pass as sampling's.
 *
 * ## What each test is for
 *
 * The **precedence** case is the load-bearing one. `templateId` and `seedKey`
 * are not two spellings of one thing: a template id is the public,
 * owner-namespaced identity; a seed key is core's storage identity and is only
 * ever correct for core's own rows. A value carrying both is a document
 * mid-migration between them, so the newer spelling has to win — and the test
 * points the two halves at DIFFERENT rows, because a test that pointed them at
 * the same row would pass whichever way the resolution ran.
 *
 * The **unknown id** case is the failure mode a plugin document reaches first.
 * It differs from sampling's on purpose: an unresolved sampling reference
 * leaves the slot unset, because unset is the state every step was in before a
 * document could name one. Unset is not that state here — assemble halts with
 * "has no template" and a prompts slot renders blanks the model reads as
 * instructions — so the pool default runs and the log names what it could not
 * find.
 *
 * The **not-stored** case pins the guard `ensureDefaultConfig` already applies
 * to sampling: a reference is the author's spelling of a row id, so what lands
 * in the config is the RESOLUTION and never the reference, at an address every
 * reader treats as an integer.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { declarations } from "$lib/server/pipelines/config/panel"
import { ensureDefaultConfig } from "$lib/server/pipelines/config/named"
import * as schema from "$lib/server/db/schema"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const RESPOND = "core:spec/respond"

let db: TestDb
let spec: { id: number; activeVersionId: number | null; slug: string }
let presetId: number

/** The prompts-ref declaration this spec's context step carries. */
async function promptsDecl() {
	const decls = await declarations(db, spec.activeVersionId!)
	const d = decls.find((x) => x.control === "prompts-ref")
	expect(d, "core:spec/respond declares a prompts slot").toBeTruthy()
	return d!
}

/** Two rows in one prompts pool, so a precedence test has somewhere to point. */
async function twoPromptsIn(pool: string, slot: string) {
	const rows = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(
			and(
				eq(schema.pipelinePrompts.nodeDefinitionId, pool),
				eq(schema.pipelinePrompts.slot, slot)
			)
		)
	const named = rows.filter((r) => r.templateId && r.seedKey)
	expect(
		named.length,
		"the pool needs two seeded rows for a precedence test"
	).toBeGreaterThan(1)
	return [named[0]!, named[1]!] as const
}

/** Put one value on the spec's default author preset, at an address. */
async function authorNames(
	d: { nodeKey: string; slot: string; path: string },
	value: unknown
) {
	await db
		.delete(schema.pipelinePresetValues)
		.where(
			and(
				eq(schema.pipelinePresetValues.presetId, presetId),
				eq(schema.pipelinePresetValues.nodeKey, d.nodeKey),
				eq(schema.pipelinePresetValues.slot, d.slot)
			)
		)
	await db.insert(schema.pipelinePresetValues).values({
		presetId,
		nodeKey: d.nodeKey,
		slot: d.slot,
		path: d.path,
		value
	})
}

/**
 * Re-project the shipped config from scratch.
 *
 * `ensureDefaultConfig` is idempotent by seed key — it returns the existing row
 * untouched — so the row and its values are dropped first. That is the fresh
 * install, which is the only state a shipped config is ever written in.
 */
async function reproject() {
	const seedKey = `pipeline-default:${RESPOND}`
	const [existing] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, seedKey))
	if (existing)
		await db
			.delete(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, existing.id))
	await ensureDefaultConfig(db, spec.id, spec.activeVersionId!, RESPOND)
	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, seedKey))
	return config
}

/** What one address resolves to in one config, or undefined. */
async function valueAt(
	configId: number,
	d: { nodeKey: string; slot: string; path: string }
) {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, configId),
				eq(schema.pipelineConfigValues.nodeKey, d.nodeKey),
				eq(schema.pipelineConfigValues.slot, d.slot),
				eq(schema.pipelineConfigValues.path, d.path)
			)
		)
	return row?.value
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [row] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND))
	spec = row as typeof spec

	// The default author preset the document ships, or one to hang values on
	// where it ships none — `presetValuesFor` reads exactly this row.
	const [preset] = await db
		.select()
		.from(schema.pipelinePresets)
		.where(
			and(
				eq(schema.pipelinePresets.specVersionId, spec.activeVersionId!),
				eq(schema.pipelinePresets.isDefault, true)
			)
		)
	presetId =
		preset?.id ??
		(
			await db
				.insert(schema.pipelinePresets)
				.values({
					specVersionId: spec.activeVersionId!,
					slug: "test-default",
					label: "Default",
					isDefault: true
				})
				.returning()
		)[0]!.id
})

describe("a preset names a prompt by template id", () => {
	it("ships the config on the row the document named", async () => {
		const d = await promptsDecl()
		const [, second] = await twoPromptsIn(d.nodeDefinitionId!, d.slot)
		await authorNames(d, { templateId: second.templateId })

		const config = await reproject()
		expect(await valueAt(config.id, d)).toBe(second.id)
	})

	it("prefers templateId over seedKey, because they name different things", async () => {
		const d = await promptsDecl()
		const [first, second] = await twoPromptsIn(d.nodeDefinitionId!, d.slot)
		// Pointed at DIFFERENT rows on purpose: pointed at one row, the test
		// would pass whichever half the resolution read.
		await authorNames(d, {
			templateId: second.templateId,
			seedKey: first.seedKey
		})

		const config = await reproject()
		expect(await valueAt(config.id, d)).toBe(second.id)
	})

	it("still accepts seedKey alone — sampling's spelling, one table over", async () => {
		const d = await promptsDecl()
		const [, second] = await twoPromptsIn(d.nodeDefinitionId!, d.slot)
		await authorNames(d, { seedKey: second.seedKey })

		const config = await reproject()
		expect(await valueAt(config.id, d)).toBe(second.id)
	})

	it("stores the resolution, never the reference", async () => {
		const d = await promptsDecl()
		const [, second] = await twoPromptsIn(d.nodeDefinitionId!, d.slot)
		await authorNames(d, { templateId: second.templateId })

		const config = await reproject()
		// The address every reader treats as an integer keeps being one.
		expect(typeof (await valueAt(config.id, d))).toBe("number")
	})
})

describe("a template id nothing seeded", () => {
	it("falls back to the pool default and says which name found nothing", async () => {
		const missing = "acme.other:template/nothing-here@1"
		const d = await promptsDecl()
		const { defaultPromptFor } = await import(
			"$lib/server/pipelines/boot/seedPrompts"
		)
		const pooled = await defaultPromptFor(db, d.nodeDefinitionId!, d.slot, {
			id: spec.id,
			slug: RESPOND
		})
		await authorNames(d, { templateId: missing })

		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const config = await reproject()
			// Unset is not the safe state here: assemble halts on a template
			// slot with no row, and a prompts slot with no row renders blanks.
			expect(await valueAt(config.id, d)).toBe(pooled)
			expect(
				warn.mock.calls.some((c) =>
					c.some(
						(arg) => typeof arg === "string" && arg.includes(missing)
					)
				),
				"an unresolved reference has to name the id it could not find"
			).toBe(true)
		} finally {
			warn.mockRestore()
		}
	})

	it("leaves a document that names nothing exactly as it was", async () => {
		const d = await promptsDecl()
		await db
			.delete(schema.pipelinePresetValues)
			.where(
				and(
					eq(schema.pipelinePresetValues.presetId, presetId),
					eq(schema.pipelinePresetValues.nodeKey, d.nodeKey),
					eq(schema.pipelinePresetValues.slot, d.slot)
				)
			)
		const { defaultPromptFor } = await import(
			"$lib/server/pipelines/boot/seedPrompts"
		)
		const pooled = await defaultPromptFor(db, d.nodeDefinitionId!, d.slot, {
			id: spec.id,
			slug: RESPOND
		})

		const config = await reproject()
		expect(await valueAt(config.id, d)).toBe(pooled)
	})
})
