/**
 * Core's shipped variable layouts, as rows.
 *
 * Insert-only, by seed key — like `seedPipelinePrompts`, and for the same
 * reason: a row a user edited is theirs. These are immutable so they should
 * never have diverged, but "should never have" is not a mechanism, and
 * re-writing a row on every boot would make this file able to overwrite
 * something it did not create.
 *
 * What the rows *say* lives in `variableLayouts.ts`, which imports no schema —
 * the node that renders them is a Task, and a Task is handed no services (F11).
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CORE_TEMPLATE_ENGINE } from "./renderers"
import { SHIPPED_VARIABLE_TEMPLATES, seedKeyFor } from "./variableLayouts"

type Db = { select: any; insert: any; update: any; delete: any }

export interface VariableTemplateSeedResult {
	created: string[]
	present: string[]
}

/**
 * Write the shipped layouts, once.
 *
 * Must run **before** `seedCoreSpecs`: `ensureDefaultConfig` points each
 * variables declaration at a row, and a shipped config pointing at nothing
 * would leave the layout unset on a fresh install — falling through to the code
 * default, which is correct output above an empty picker.
 */
export async function seedVariableTemplates(
	db: Db
): Promise<VariableTemplateSeedResult> {
	const result: VariableTemplateSeedResult = { created: [], present: [] }

	for (const t of SHIPPED_VARIABLE_TEMPLATES) {
		const seedKey = seedKeyFor(t)
		const [existing] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(eq(schema.pipelineVariableTemplates.seedKey, seedKey))
			.limit(1)

		if (existing) {
			result.present.push(seedKey)
			continue
		}

		await db.insert(schema.pipelineVariableTemplates).values({
			variableId: t.variableId,
			seedKey,
			name: t.name,
			source: t.source,
			// Explicit rather than NULL: a template's engine travels on the
			// value (12 §2a), so a stored row keeps what it was authored in even
			// if core's default moves later.
			engine: CORE_TEMPLATE_ENGINE,
			isImmutable: true
		})
		result.created.push(seedKey)
	}

	return result
}

/**
 * The layout a variables declaration should point at by default.
 *
 * Resolved by **seed key**, not by lowest id. Those were the same answer while
 * each variable shipped one row; they stopped being the same answer the moment
 * a second row was added for a variable that already existed. Seeding is
 * insert-only, so on an upgraded install the older bare-content row holds the
 * lower id and "first row" would hand it a different default than a fresh
 * install gets — the two installs would then render different prompts from
 * identical settings, which is the hardest kind of divergence to see.
 *
 * Falls back to the lowest id for a variable core ships nothing for, which is
 * any plugin's. Never nothing where a row exists: a declaration pointing at no
 * row still renders (the code default is the floor), but the picker would open
 * with nothing selected, which reads as a broken setting rather than as the
 * shipped choice it is.
 */
export async function defaultVariableTemplateFor(
	db: Db,
	variableId: string
): Promise<number | null> {
	const shipped = SHIPPED_VARIABLE_TEMPLATES.find(
		(t) => t.variableId === variableId && t.isDefault
	)

	if (shipped) {
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(
				eq(
					schema.pipelineVariableTemplates.seedKey,
					seedKeyFor(shipped)
				)
			)
			.limit(1)
		if (row) return row.id
	}

	const [first] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.variableId, variableId))
		.orderBy(asc(schema.pipelineVariableTemplates.id))
		.limit(1)
	return first?.id ?? null
}

/**
 * The bare-content row for a variable — the one that writes no heading.
 *
 * What `migrateContextWrappers` pins an install to when its context template
 * writes headings of its own.
 */
export async function bareVariableTemplateFor(
	db: Db,
	variableId: string
): Promise<number | null> {
	const bare = SHIPPED_VARIABLE_TEMPLATES.find(
		(t) => t.variableId === variableId && !t.isDefault
	)
	// A variable core never wrapped has one row, and it is already bare.
	if (!bare) return defaultVariableTemplateFor(db, variableId)

	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.seedKey, seedKeyFor(bare)))
		.limit(1)
	return row?.id ?? null
}
