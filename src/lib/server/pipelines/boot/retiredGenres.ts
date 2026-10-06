/**
 * Core genres that left core, and the boot step that culls what core shipped
 * for them.
 *
 * Core seeds what its catalog declares and never culls what it stopped
 * declaring, and a genre is listed from its published create spec — so an
 * install that booted a build which shipped a genre keeps that genre in the
 * picker, and its prompts, preset and layout rows in every list, until
 * something deletes them. A migration can, but only on an install whose chain
 * still holds it; this runs on every boot, and finds nothing on every boot
 * but the first after a retirement.
 *
 * Only rows core shipped go: owner-less, immutable or `origin = 'core'`, and
 * in core's namespace. Sessions of a retired genre, their messages and
 * anything a person wrote are left exactly as they are.
 */

import { and, eq, inArray, isNull, like, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * A genre core does not ship, and the slug stems its shipped rows used.
 * Whodunit and the Writing Room are showcase plugins (owner ruling
 * 2026-09-30), under their own namespaces.
 */
export interface RetiredCoreGenre {
	genreId: string
	/** The stem every one of its spec slugs starts with: `core:spec/<stem>-…`. */
	specStem: string
	/** Specs of its that do not share the stem (`core:spec/answer-form-<stem>`). */
	otherSpecs: readonly string[]
	/** The stem its shipped prompt rows' template ids start with. */
	promptStem: string
}

export const RETIRED_CORE_GENRES: readonly RetiredCoreGenre[] = [
	{
		genreId: "core:genre/whodunit",
		specStem: "whodunit",
		otherSpecs: ["core:spec/answer-form-whodunit"],
		promptStem: "whodunit"
	},
	{
		genreId: "core:genre/writing-room",
		specStem: "writing-room",
		otherSpecs: ["core:spec/answer-form-writing-room"],
		promptStem: "writing-room"
	}
]

export interface RetiredGenreCullReport {
	specs: number
	prompts: number
	sessionPresets: number
	layoutPresets: number
	genreSettings: number
}

/**
 * Delete the rows core shipped for each retired genre. A spec's delete
 * cascades to its versions, nodes, edges, clauses, author presets and shipped
 * configs; a prompt row's `created_for_spec_id` is set NULL.
 */
export async function cullRetiredCoreGenres(
	db: any,
	retired: readonly RetiredCoreGenre[] = RETIRED_CORE_GENRES
): Promise<RetiredGenreCullReport> {
	const report: RetiredGenreCullReport = {
		specs: 0,
		prompts: 0,
		sessionPresets: 0,
		layoutPresets: 0,
		genreSettings: 0
	}
	if (!retired.length) return report
	const genreIds = retired.map((r) => r.genreId)

	const specs = await db
		.delete(schema.pipelineSpecs)
		.where(
			and(
				isNull(schema.pipelineSpecs.sourcePluginId),
				or(
					...retired.map((r) => like(schema.pipelineSpecs.slug, `core:spec/${r.specStem}-%`)),
					inArray(
						schema.pipelineSpecs.slug,
						retired.flatMap((r) => [...r.otherSpecs])
					)
				)
			)
		)
		.returning({ id: schema.pipelineSpecs.id })
	report.specs = specs.length

	const prompts = await db
		.delete(schema.pipelinePrompts)
		.where(
			and(
				isNull(schema.pipelinePrompts.ownerPluginId),
				or(
					...retired.map((r) =>
						like(schema.pipelinePrompts.seedKey, `pipeline-prompt:core:%:${r.promptStem}-%`)
					)
				)
			)
		)
		.returning({ id: schema.pipelinePrompts.id })
	report.prompts = prompts.length

	const sessionPresets = await db
		.delete(schema.sessionPresets)
		.where(
			and(
				isNull(schema.sessionPresets.ownerPluginId),
				eq(schema.sessionPresets.isImmutable, true),
				inArray(schema.sessionPresets.genreId, genreIds)
			)
		)
		.returning({ id: schema.sessionPresets.id })
	report.sessionPresets = sessionPresets.length

	const layoutPresets = await db
		.delete(schema.sessionLayoutPresets)
		.where(
			and(
				eq(schema.sessionLayoutPresets.origin, "core"),
				isNull(schema.sessionLayoutPresets.authorUserId),
				inArray(schema.sessionLayoutPresets.genreId, genreIds)
			)
		)
		.returning({ id: schema.sessionLayoutPresets.id })
	report.layoutPresets = layoutPresets.length

	const genreSettings = await db
		.delete(schema.sessionGenreSettings)
		.where(inArray(schema.sessionGenreSettings.genreId, genreIds))
		.returning({ genreId: schema.sessionGenreSettings.genreId })
	report.genreSettings = genreSettings.length

	return report
}

/**
 * Core specs that left core without their genre leaving: deleted on boot by
 * slug, core-owned rows only (`source_plugin_id` NULL). The delete cascades to
 * the spec's versions, nodes, author presets and shipped configs — and with
 * them its contributed actions, which are listed from the published document.
 * Receipts keep their `spec_slug` text, so history still names it.
 *
 * - `core:spec/echo` — the review-gate demo action (`/echo`), removed
 *   2026-10-02 (owner note 35). No back-compat.
 * - `core:spec/tool-loop` — the reference agentic turn, not seeded (ruled
 *   2026-10-05, PLAN-catalogue-and-pipeline-names C3). It stays in
 *   core-catalog as an example and a test fixture; nothing ran it.
 */
export const RETIRED_CORE_SPECS: readonly string[] = [
	"core:spec/echo",
	"core:spec/tool-loop"
]

/**
 * The shipped prompts that left with them, by seed key — a prompt is pooled
 * by node, not spec, so the spec's delete does not reach it.
 *
 * - tool-loop's `Tool loop` (`TOOL_LOOP_PROMPT` in core-catalog).
 */
export const RETIRED_CORE_PROMPTS: readonly string[] = [
	"pipeline-prompt:core:task/assemble:prompts:tool-loop-default"
]

export async function cullRetiredCoreSpecs(
	db: any,
	slugs: readonly string[] = RETIRED_CORE_SPECS,
	promptSeedKeys: readonly string[] = RETIRED_CORE_PROMPTS
): Promise<number> {
	if (!slugs.length) return 0
	const gone = await db
		.delete(schema.pipelineSpecs)
		.where(
			and(
				isNull(schema.pipelineSpecs.sourcePluginId),
				inArray(schema.pipelineSpecs.slug, [...slugs])
			)
		)
		.returning({ id: schema.pipelineSpecs.id })
	if (promptSeedKeys.length) await cullRetiredCorePrompts(db, promptSeedKeys)
	return gone.length
}

/**
 * Core's rows only — owner-less, shipped immutable, by seed key. After the
 * spec's delete, so its own configs hold none of them. A row some other
 * config or override still selects is not deleted out from under it (the
 * rule `deletePrompt` keeps): it is handed over instead, as a prompt like any
 * a person wrote — no seed key, editable — so the selection still means what
 * it meant.
 */
async function cullRetiredCorePrompts(
	db: any,
	seedKeys: readonly string[]
): Promise<void> {
	const rows = await db
		.select({ id: schema.pipelinePrompts.id })
		.from(schema.pipelinePrompts)
		.where(
			and(
				isNull(schema.pipelinePrompts.ownerPluginId),
				eq(schema.pipelinePrompts.isImmutable, true),
				inArray(schema.pipelinePrompts.seedKey, [...seedKeys])
			)
		)
	if (!rows.length) return
	const { promptSlotNames } = await import(
		"$lib/server/pipelines/entities/prompts"
	)
	const slots = await promptSlotNames(db)
	const held = new Set<unknown>()
	if (slots.length) {
		for (const v of await db
			.select({ value: schema.pipelineConfigValues.value })
			.from(schema.pipelineConfigValues)
			.where(inArray(schema.pipelineConfigValues.slot, slots)))
			held.add(v.value)
		for (const o of await db
			.select({ value: schema.pipelineNodeOverrides.value })
			.from(schema.pipelineNodeOverrides)
			.where(inArray(schema.pipelineNodeOverrides.slot, slots)))
			held.add(o.value)
	}
	for (const { id } of rows as Array<{ id: number }>)
		if (held.has(id))
			await db
				.update(schema.pipelinePrompts)
				.set({ seedKey: null, templateId: null, isImmutable: false })
				.where(eq(schema.pipelinePrompts.id, id))
		else
			await db
				.delete(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.id, id))
}
