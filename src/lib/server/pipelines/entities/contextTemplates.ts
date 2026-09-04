/**
 * Context templates — the story string, as a swappable entity.
 *
 * The config stores this row's id, never a copy of its source, which is what
 * makes editing a template reach every pipeline pointing at it instead of
 * forking silently at the first change. Same entity pattern as
 * `pipeline_prompts` and `pipeline_variable_templates`; the difference is what
 * it is keyed by.
 *
 * ## Keyed by node type AND engine, grouped by origin
 *
 * A template is compatible with a node, not with a pipeline. Session reply and the
 * narrator both run `core:task/assemble`, so one row genuinely serves both —
 * which is how `context_configs` has always behaved. Keying on the spec would
 * mean two copies of the same template, kept in sync by hand, and one more copy
 * for every pipeline anyone ever adds.
 *
 * The **engine is the pool's other half**, and it is not symmetry. A template is
 * a piece of writing in a language: a Jinja story string and a Handlebars one
 * both render the assemble node's context and are not interchangeable for a
 * second. Pooled on the node type alone, either was selectable into either
 * slot — it stored cleanly, and then shipped its own unrendered markup to the
 * model as prose. There is deliberately **no cross-engine fallback** anywhere
 * in this file or in `defaultContextTemplateFor`: a slot whose language has no
 * template gets nothing, and assemble's "has no template" halt is loud where a
 * silent wrong-language render is not.
 *
 * That leaves a real problem this file also solves: at ten rows, "compatible"
 * and "the one I want" stop being the same answer. So a row also remembers
 * which pipeline it was written in, and `listContextTemplates` groups on it.
 * **The grouping never refuses.** A template written while editing session replies
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

import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations } from "$lib/server/pipelines/config/panel"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import {
	contextPoolKeyFor,
	poolKeyFor
} from "$lib/server/pipelines/entities/contextTemplateDefaults"

export { contextPoolKeyFor, poolKeyFor }

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
	/**
	 * The language it is written in, and half the pool key. Never null: the
	 * column is NOT NULL and a caller that passes nothing is normalized to
	 * core's on the way in, so every reader downstream — `renderTemplate` most
	 * of all — is handed a real engine rather than an absence to guess about.
	 */
	engine: string
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
	// The column is NOT NULL, so this coalesce only catches a row handed in by
	// a caller that built it in memory. Core's engine is the honest answer for
	// one of those — it is what a row with nothing said has always rendered as.
	engine: r.engine ?? CORE_TEMPLATE_ENGINE,
	isImmutable: !!r.isImmutable
})

/**
 * Every template a node can use, in the order the picker should show them.
 *
 * `engine` narrows to the language the slot declares, and is required for the
 * reason the file header gives: a list that crossed engines would offer a
 * person a template that stores cleanly and renders its own markup as prose.
 *
 * `forSpecId` is the pipeline being configured. Omitted, everything not shipped
 * lands in `alsoFits` — which is the right answer for a caller that is not
 * looking at one pipeline's panel, rather than a reason to hide anything.
 */
export async function listContextTemplates(
	db: Db,
	nodeTypeId: string,
	engine: string,
	forSpecId?: number
): Promise<GroupedContextTemplate[]> {
	const rows = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			and(
				eq(
					schema.pipelineContextTemplates.nodeTypeId,
					poolKeyFor(nodeTypeId)
				),
				eq(schema.pipelineContextTemplates.engine, engine)
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
 * Two hard rules, and they are the two halves of the pool key: the node type
 * must match, and so must the **engine**. Everything else about "does this fit"
 * — whether the variables it names are supplied by this version — is a warning,
 * because a template referencing a variable a pipeline does not supply renders
 * it as empty, which is a legible outcome and sometimes the intended one.
 *
 * The engine refusal names the *language* rather than the engine id, because
 * the id is a pinned string a person did not choose and the language is the
 * thing they can act on. Rendering across it is not a legible outcome: the
 * foreign syntax survives untouched and is sent to the model as prose, which
 * reads as the model ignoring the whole template.
 */
export async function assertSelectable(
	db: Db,
	nodeTypeId: string,
	templateId: number,
	engine: string
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

	const rowEngine = row.engine ?? CORE_TEMPLATE_ENGINE
	if (rowEngine !== engine)
		throw new ContextTemplateNotUsableError(
			`'${row.name}' is written in ${languageOf(rowEngine)} and this step ` +
				`renders ${languageOf(engine)}. Selected anyway it would not be ` +
				`translated — its markup would be sent to the model as ordinary ` +
				`text. Duplicate it and rewrite the copy in ${languageOf(engine)}.`
		)

	return toRecord(row)
}

/**
 * An engine id as the name of a language.
 *
 * `core:template/handlebars@1` is a pinned id nobody chose; "Handlebars" is
 * the word on the page they are looking at. Falls back to the id when the
 * shape is not the familiar one, because a plugin may publish anything and a
 * wrong guess in a refusal message is worse than a raw id.
 */
const languageOf = (engineId: string): string => {
	const name = engineId.split("/")[1]?.split("@")[0]
	if (!name) return engineId
	return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * What the slot resolves to once dereferenced: the template itself.
 *
 * Returns the engine **and** the source, and the caller must carry both. This
 * used to be read for its `source` alone (`world.ts`'s `derefTemplate`), which
 * is how every template on every install rendered as Handlebars whatever it
 * declared: the engine was resolved here, correctly, and then dropped one line
 * later. See `pushTemplate` in `world.ts` for the rule that replaced it.
 */
export async function resolveContextTemplate(
	db: Db,
	templateId: number
): Promise<{ engine: string; source: string } | null> {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
		.limit(1)
	return row
		? {
				engine: row.engine ?? CORE_TEMPLATE_ENGINE,
				source: row.source ?? ""
			}
		: null
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
			// Normalized here rather than left to the column default, because
			// the engine is half the pool key and a row that lands in the wrong
			// pool is invisible: it simply never appears in the picker it was
			// written for. `null` from a caller means "core's", which is what a
			// null column always meant — said once, in the one place that can
			// still say it before the row exists.
			engine: input.engine ?? CORE_TEMPLATE_ENGINE,
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

	// The copy keeps the original's language. A duplicate is "the same template,
	// mine to edit" — changing what it is written in would hand someone a copy
	// that no longer fits the slot they duplicated it from.
	return await createContextTemplate(db, {
		nodeTypeId: row.nodeTypeId,
		name,
		source: row.source ?? "",
		engine: row.engine ?? CORE_TEMPLATE_ENGINE,
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

	// `null` means "core's" here as it does on create — the panel's engine
	// picker sends null for the default rather than pinning today's id.
	const nextEngine =
		patch.engine === undefined
			? (row.engine ?? CORE_TEMPLATE_ENGINE)
			: (patch.engine ?? CORE_TEMPLATE_ENGINE)
	const nextName = patch.name ?? row.name

	/**
	 * The unique key is `(node type, engine, name)`, and both halves a person
	 * can edit are in it. Checked here rather than left to Postgres because the
	 * constraint violation surfaces as `duplicate key value violates unique
	 * constraint "pipeline_context_templates_pool_name_idx"` — a sentence that
	 * tells the person nothing, on a screen where the row it collided with may
	 * be in a *different* pool from the one they are looking at. Changing the
	 * engine is the case that surprises: it moves the row into another pool,
	 * where its name may already be taken by something they cannot see.
	 */
	if (
		nextName !== row.name ||
		nextEngine !== (row.engine ?? CORE_TEMPLATE_ENGINE)
	) {
		const [clash] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				and(
					eq(
						schema.pipelineContextTemplates.nodeTypeId,
						row.nodeTypeId
					),
					eq(schema.pipelineContextTemplates.engine, nextEngine),
					eq(schema.pipelineContextTemplates.name, nextName),
					ne(schema.pipelineContextTemplates.id, templateId)
				)
			)
			.limit(1)
		if (clash)
			throw new ContextTemplateNotUsableError(
				nextEngine === (row.engine ?? CORE_TEMPLATE_ENGINE)
					? `Another template for this step is already called '${nextName}'. ` +
						`Pick a different name.`
					: `Rewriting '${row.name}' in ${languageOf(nextEngine)} would move it ` +
						`in beside a template of the same name, which already exists there. ` +
						`Rename it first — templates for one step are listed per language, ` +
						`so the one it would collide with is not on this list.`
			)
	}

	await db
		.update(schema.pipelineContextTemplates)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.source !== undefined ? { source: patch.source } : {}),
			...(patch.engine !== undefined ? { engine: nextEngine } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelineContextTemplates.id, templateId))
}

/** Which slot names, across every published spec, hold a context-template reference. */
export async function contextTemplateSlotNames(db: Db): Promise<string[]> {
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
		/**
		 * Config-value rows that do not count either — since the layer
		 * simplification (2026-08-24) an admin's selection outside a session is
		 * the instance config's own value row, not an override.
		 */
		ignoreConfigValueIds?: Set<number>
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
		const ignoredValues = opts.ignoreConfigValueIds ?? new Set<number>()
		referenced =
			(values as any[]).some(
				(v) => v.value === templateId && !ignoredValues.has(v.id)
			) ||
			(overrides as any[]).some(
				(o) => o.value === templateId && !ignored.has(o.id)
			)
	}

	if (referenced)
		throw new ContextTemplateNotUsableError(
			`'${row.name}' is still selected somewhere — a pipeline or a session is ` +
				`building its prompt with it. Templates are shared across ` +
				`pipelines, so this may be one you set up elsewhere. Point that ` +
				`setting at a different template first, then delete this one.`
		)

	await db
		.delete(schema.pipelineContextTemplates)
		.where(eq(schema.pipelineContextTemplates.id, templateId))
}

/**
 * The template a node type falls back to, by seed identity.
 *
 * Per language, like everything else here: core ships a Handlebars row for the
 * assemble node and nothing in any other engine, so a jinja2 slot correctly
 * gets `null` rather than core's Handlebars source in a Jinja slot's clothing.
 */
export async function shippedContextTemplate(
	db: Db,
	nodeTypeId: string,
	engine: string = CORE_TEMPLATE_ENGINE
) {
	const [row] = await db
		.select()
		.from(schema.pipelineContextTemplates)
		.where(
			and(
				eq(
					schema.pipelineContextTemplates.nodeTypeId,
					poolKeyFor(nodeTypeId)
				),
				eq(schema.pipelineContextTemplates.engine, engine),
				eq(schema.pipelineContextTemplates.isImmutable, true),
				isNull(schema.pipelineContextTemplates.createdForSpecId)
			)
		)
		.orderBy(asc(schema.pipelineContextTemplates.id))
		.limit(1)
	return row ?? null
}
