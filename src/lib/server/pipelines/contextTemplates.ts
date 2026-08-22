/**
 * Context templates — the story string, as a swappable entity.
 *
 * The config stores this row's id, never a copy of its source, which is what
 * makes editing a template reach every pipeline pointing at it instead of
 * forking silently at the first change. Same entity pattern as
 * `pipeline_prompts` and `pipeline_variable_templates`; the difference is what
 * it is keyed by.
 *
 * ## Keyed by node type, grouped by origin
 *
 * A template is compatible with a node, not with a pipeline. Chat reply and the
 * narrator both run `core:task/assemble`, so one row genuinely serves both —
 * which is how `context_configs` has always behaved. Keying on the spec would
 * mean two copies of the same template, kept in sync by hand, and one more copy
 * for every pipeline anyone ever adds.
 *
 * That leaves a real problem this file also solves: at ten rows, "compatible"
 * and "the one I want" stop being the same answer. So a row also remembers
 * which pipeline it was written in, and `listContextTemplates` groups on it.
 * **The grouping never refuses.** A template written while editing chat replies
 * is still offered in the narrator, one group down, because the entire reason
 * this is not spec-scoped is that it works there.
 *
 * ## What a template is no longer responsible for
 *
 * Structure only — message blocks, placement, `{{#if}}`, `{{#each}}`. Headings,
 * fences and the shape of the JSON inside a variable belong to
 * `pipeline_variable_templates`, one row per variable. A template that writes
 * its own headings is still valid, and is exactly the case
 * `migrateContextWrappers` pins to the bare layouts so the wrapper is written
 * once rather than twice.
 */

import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations } from "./config"
import { poolKeyFor } from "./contextTemplateDefaults"

export { poolKeyFor }

type Db = { select: any; insert: any; update: any; delete: any }

/** The template named nothing here, or nothing this node can use. */
export class ContextTemplateNotFoundError extends Error {}

/** The template exists but may not be used this way. Message is for a person. */
export class ContextTemplateNotUsableError extends Error {}

export interface ContextTemplateRecord {
	id: number
	nodeTypeId: string
	createdForSpecId: number | null
	name: string
	source: string
	engine: string | null
	isImmutable: boolean
}

/**
 * Which group a row falls into for the pipeline currently being configured.
 *
 * Ordering, never permission — every group is selectable.
 */
export type ContextTemplateGroup = "usedHere" | "shipped" | "alsoFits"

export interface GroupedContextTemplate extends ContextTemplateRecord {
	group: ContextTemplateGroup
	/** The pipeline it was written in, for the `alsoFits` group's subtitle. */
	originSlug?: string
}

const toRecord = (r: any): ContextTemplateRecord => ({
	id: r.id,
	nodeTypeId: r.nodeTypeId,
	createdForSpecId: r.createdForSpecId ?? null,
	name: r.name,
	source: r.source ?? "",
	engine: r.engine ?? null,
	isImmutable: !!r.isImmutable
})

/**
 * Every template a node can use, in the order the picker should show them.
 *
 * `forSpecId` is the pipeline being configured. Omitted, everything not shipped
 * lands in `alsoFits` — which is the right answer for a caller that is not
 * looking at one pipeline's panel, rather than a reason to hide anything.
 */
export async function listContextTemplates(
	db: Db,
	nodeTypeId: string,
	forSpecId?: number
): Promise<GroupedContextTemplate[]> {
	const rows = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			eq(
				schema.pipelineContextTemplates.nodeTypeId,
				poolKeyFor(nodeTypeId)
			)
		)
		.orderBy(asc(schema.pipelineContextTemplates.id))

	const specs = await db.select().from(schema.pipelineSpecs)
	const slugById = new Map<number, string>(
		(specs as any[]).map((s) => [s.id, s.slug])
	)

	const groupOf = (r: any): ContextTemplateGroup => {
		if (forSpecId != null && r.createdForSpecId === forSpecId)
			return "usedHere"
		if (r.isImmutable) return "shipped"
		return "alsoFits"
	}

	const ORDER: Record<ContextTemplateGroup, number> = {
		usedHere: 0,
		shipped: 1,
		alsoFits: 2
	}

	return (rows as any[])
		.map((r) => {
			const group = groupOf(r)
			return {
				...toRecord(r),
				group,
				...(group === "alsoFits" && r.createdForSpecId != null
					? { originSlug: slugById.get(r.createdForSpecId) }
					: {})
			}
		})
		.sort(
			(a, b) =>
				ORDER[a.group] - ORDER[b.group] || a.name.localeCompare(b.name)
		)
}

/**
 * Check that a template may be selected for this node, and say why if not.
 *
 * The one hard rule: the pool key must match. Everything else about "does this
 * fit" — whether the variables it names are supplied by this version — is a
 * warning, because a template referencing a variable a pipeline does not supply
 * renders it as empty, which is a legible outcome and sometimes the intended
 * one.
 */
export async function assertSelectable(
	db: Db,
	nodeTypeId: string,
	templateId: number
): Promise<ContextTemplateRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
		.limit(1)

	if (!row)
		throw new ContextTemplateNotFoundError(
			"That context template no longer exists. It may have been deleted " +
				"since the list was loaded."
		)

	if (row.nodeTypeId !== poolKeyFor(nodeTypeId))
		throw new ContextTemplateNotUsableError(
			`'${row.name}' was written for a different kind of step, so the ` +
				`values it renders would not be there. Duplicate it and adapt ` +
				`the copy if that is what you meant.`
		)

	return toRecord(row)
}

/** What the slot resolves to once dereferenced: the template itself. */
export async function resolveContextTemplate(
	db: Db,
	templateId: number
): Promise<{ engine: string | null; source: string } | null> {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
		.limit(1)
	return row ? { engine: row.engine ?? null, source: row.source ?? "" } : null
}

export interface CreateContextTemplateInput {
	nodeTypeId: string
	name: string
	source: string
	engine?: string | null
	createdForSpecId?: number | null
	seedKey?: string
	isImmutable?: boolean
	migratedFromContextConfigId?: number | null
}

export async function createContextTemplate(
	db: Db,
	input: CreateContextTemplateInput
): Promise<ContextTemplateRecord> {
	const [row] = await db
		.insert(schema.pipelineContextTemplates)
		.values({
			nodeTypeId: poolKeyFor(input.nodeTypeId),
			name: input.name,
			source: input.source,
			engine: input.engine ?? null,
			createdForSpecId: input.createdForSpecId ?? null,
			seedKey: input.seedKey ?? null,
			isImmutable: input.isImmutable ?? false,
			migratedFromContextConfigId:
				input.migratedFromContextConfigId ?? null
		})
		.returning()
	return toRecord(row)
}

/**
 * Copy a template so it can be edited.
 *
 * The copy records the pipeline it was made in, which is what puts it at the
 * top of that pipeline's picker next time. The original keeps whatever origin
 * it had — duplicating somebody's template does not move theirs.
 */
export async function duplicateContextTemplate(
	db: Db,
	templateId: number,
	name: string,
	createdForSpecId?: number | null
): Promise<ContextTemplateRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new ContextTemplateNotFoundError(
			"That context template no longer exists."
		)

	return await createContextTemplate(db, {
		nodeTypeId: row.nodeTypeId,
		name,
		source: row.source ?? "",
		engine: row.engine ?? null,
		createdForSpecId: createdForSpecId ?? null
	})
}

export async function updateContextTemplate(
	db: Db,
	templateId: number,
	patch: { name?: string; source?: string; engine?: string | null }
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new ContextTemplateNotFoundError(
			"That context template no longer exists."
		)
	if (row.isImmutable)
		throw new ContextTemplateNotUsableError(
			`'${row.name}' is one of the templates Serene Pub ships, so it stays ` +
				`as it is. Duplicate it and edit the copy — everything already ` +
				`pointing at the original keeps working.`
		)

	await db
		.update(schema.pipelineContextTemplates)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.source !== undefined ? { source: patch.source } : {}),
			...(patch.engine !== undefined ? { engine: patch.engine } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelineContextTemplates.id, templateId))
}

/** Which slot names, across every published spec, hold a context-template reference. */
async function contextTemplateSlotNames(db: Db): Promise<string[]> {
	const specs = await db.select().from(schema.pipelineSpecs)
	const names = new Set<string>()
	for (const spec of specs as any[]) {
		if (spec.activeVersionId == null) continue
		for (const d of await declarations(db, spec.activeVersionId))
			if (d.control === "context-template-ref") names.add(d.slot)
	}
	return [...names]
}

/**
 * Delete a template — with the refusals that keep a selection meaningful.
 *
 * A shipped template never goes: the seed would recreate it next boot with a
 * different id, leaving stored references dangling in between. A referenced one
 * never goes either, and here that refusal is the *common* path rather than the
 * rare one — templates are shared across pipelines, so the thing holding it is
 * often somewhere the person deleting is not looking.
 */
export async function deleteContextTemplate(
	db: Db,
	templateId: number,
	opts: {
		/**
		 * The caller's own selection of the row it is deleting.
		 *
		 * Passed in rather than released first — releasing first means a
		 * *refused* delete still clears the caller's selection on the way to
		 * failing, so the row survives and the choice does not. Learned on the
		 * layouts picker, where refusal is likewise the common case.
		 */
		ignoreOverrideIds?: Set<number>
	} = {}
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new ContextTemplateNotFoundError(
			"That context template no longer exists."
		)
	if (row.isImmutable)
		throw new ContextTemplateNotUsableError(
			`'${row.name}' is one of the templates Serene Pub ships, so it stays. ` +
				`It is the fallback other configurations rely on.`
		)

	const slots = await contextTemplateSlotNames(db)
	let referenced = false
	if (slots.length) {
		// Values are arbitrary json, which Postgres will not compare with `=`,
		// so this filters in code. The rows are few and the comparison is exact.
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(inArray(schema.pipelineConfigValues.slot, slots))
		const overrides = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(inArray(schema.pipelineNodeOverrides.slot, slots))
		const ignored = opts.ignoreOverrideIds ?? new Set<number>()
		referenced =
			(values as any[]).some((v) => v.value === templateId) ||
			(overrides as any[]).some(
				(o) => o.value === templateId && !ignored.has(o.id)
			)
	}

	if (referenced)
		throw new ContextTemplateNotUsableError(
			`'${row.name}' is still selected somewhere — a pipeline or a chat is ` +
				`building its prompt with it. Templates are shared across ` +
				`pipelines, so this may be one you set up elsewhere. Point that ` +
				`setting at a different template first, then delete this one.`
		)

	await db
		.delete(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
}

/** The template a node type falls back to, by seed identity. */
export async function shippedContextTemplate(db: Db, nodeTypeId: string) {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			and(
				eq(
					schema.pipelineContextTemplates.nodeTypeId,
					poolKeyFor(nodeTypeId)
				),
				eq(schema.pipelineContextTemplates.isImmutable, true),
				isNull(schema.pipelineContextTemplates.createdForSpecId)
			)
		)
		.orderBy(asc(schema.pipelineContextTemplates.id))
		.limit(1)
	return row ?? null
}
