/**
 * Authored prompts, as a swappable entity.
 *
 * A prompt is text. It is selected per provider node, per config, exactly the
 * way a connection or a sampling config is — the config stores this row's id,
 * never a copy of its words. That is what makes rewording a prompt reach every
 * node pointing at it instead of forking silently at the first edit.
 *
 * ## Pooled by the node that consumes it, grouped by origin
 *
 * A prompt is compatible with a NODE, not with a pipeline. An action that
 * reuses the reply pipeline's context node inherits its twelve prompts for
 * free, with no seed and no copy, because the node serves the same purpose
 * wherever it is reused. A pipeline built from other nodes has a different pool
 * key and is correctly offered none of them.
 *
 * That leaves the problem spec scoping was reaching for — a reply's wording has
 * no business in a summarizer's picker — and the pool solves it by
 * construction: `build-template-context` and `summarize-batch` are different
 * types, so reply wording can never reach a summarizer no matter how many
 * pipelines share the node.
 *
 * What remains is ordering, and `listPrompts` does it the way
 * `listContextTemplates` does: `created_for_spec_id` floats the rows written
 * here to the top and **never refuses**. The entire reason this is not spec
 * scoped is that a row written elsewhere works here.
 *
 * ## Two refusals, and why both are hard
 *
 * A prompt must be in the slot's pool, and its fields must fit the slot it is
 * being selected into. Both are checked on write and both throw rather than
 * degrade, because the failure they prevent is the same one: a selection that
 * stores cleanly and does nothing. Every screen then shows the prompt the user
 * chose while the run uses something else, and there is nothing to see.
 *
 * A prompt whose fields merely *exceed* the slot's is fine — extra keys are
 * inert, and refusing them would make a prompt written for a richer node
 * unusable on a simpler one for no gain.
 */

import { and, asc, eq, inArray, ne } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations } from "$lib/server/pipelines/config/panel"
import { poolKeyFor } from "$lib/server/pipelines/entities/promptPool"

export { poolKeyFor }

type Db = {
	select: any
	insert: any
	update: any
	delete: any
}

/** The prompt named nothing here, or nothing this pipeline can use. */
export class PromptNotFoundError extends Error {}

/** The prompt exists but may not be selected here. Message is for a person. */
export class PromptNotUsableError extends Error {}

export interface PromptRecord {
	id: number
	/** The pool's first half — a node type id, version stripped. */
	nodeTypeId: string
	/** The pool's second half. See `promptPool.ts` for why both are needed. */
	slot: string
	/** Where it was authored. Grouping only, never a permission. */
	createdForSpecId: number | null
	name: string
	isImmutable: boolean
	fields: Record<string, string>
	/** Text for fields the slot no longer declares — see `reconcilePromptFields`. */
	archivedFields: Record<string, string>
}

/**
 * Which group a row falls into for the pipeline currently being configured.
 *
 * Ordering, never permission — every group is selectable.
 */
export type PromptGroup = "usedHere" | "shipped" | "alsoFits"

export interface GroupedPrompt extends PromptRecord {
	group: PromptGroup
	/** The pipeline it was written in, for the `alsoFits` group's subtitle. */
	originSlug?: string
}

const toRecord = (r: any): PromptRecord => ({
	id: r.id,
	nodeTypeId: r.nodeTypeId,
	slot: r.slot,
	createdForSpecId: r.createdForSpecId ?? null,
	name: r.name,
	isImmutable: !!r.isImmutable,
	fields: (r.fields ?? {}) as Record<string, string>,
	archivedFields: (r.archivedFields ?? {}) as Record<string, string>
})

/**
 * Every prompt a node's slot can use, in the order the picker should show them.
 *
 * `forSpecId` is the pipeline being configured. Omitted, everything not shipped
 * lands in `alsoFits` — which is the right answer for a caller that is not
 * looking at one pipeline's panel, rather than a reason to hide anything.
 *
 * Deliberately the same shape and the same three groups as
 * `listContextTemplates`, because it is the same question about the same kind
 * of pooled row. Two orderings for two entities that behave identically is two
 * places for the picker to disagree with itself.
 */
export async function listPrompts(
	db: Db,
	nodeTypeId: string,
	slot: string,
	forSpecId?: number
): Promise<GroupedPrompt[]> {
	const rows = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(
			and(
				eq(schema.pipelinePrompts.nodeTypeId, poolKeyFor(nodeTypeId)),
				eq(schema.pipelinePrompts.slot, slot)
			)
		)
		.orderBy(asc(schema.pipelinePrompts.id))

	const specs = await db.select().from(schema.pipelineSpecs)
	const slugById = new Map<number, string>(
		(specs as any[]).map((s) => [s.id, s.slug])
	)

	const groupOf = (r: any): PromptGroup => {
		if (forSpecId != null && r.createdForSpecId === forSpecId)
			return "usedHere"
		if (r.isImmutable) return "shipped"
		return "alsoFits"
	}

	const ORDER: Record<PromptGroup, number> = {
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
 * The text fields a node's prompts slot declares.
 *
 * Read from the declarations rather than from a list here, so a plugin's node
 * is described by its own descriptor and core knows nothing about it in advance
 * — which is the property that makes namespace 8 reachable at all.
 */
export async function declaredFields(
	db: Db,
	specVersionId: number,
	nodeKey: string,
	slot: string
): Promise<string[]> {
	const decls = await declarations(db, specVersionId)
	const decl = decls.find((d) => d.nodeKey === nodeKey && d.slot === slot)
	return decl?.promptFields ?? []
}

/**
 * Check that a prompt may be selected for this node, and say why if not.
 *
 * Returns the prompt so a caller does not read it twice.
 *
 * The pool refusal names the **step**, not the pipeline, and that is the whole
 * change in this file's rules. "Written for a different pipeline" is no longer
 * true of anything — a prompt travels with its node — while "written for a
 * different kind of step" is exactly what a mismatch means and is the sentence
 * that tells a person what to do about it.
 */
export async function assertSelectable(
	db: Db,
	specVersionId: number,
	nodeKey: string,
	slot: string,
	promptId: number
): Promise<PromptRecord> {
	const decls = await declarations(db, specVersionId)
	const decl = decls.find((d) => d.nodeKey === nodeKey && d.slot === slot)
	if (!decl || decl.control !== "prompts-ref")
		throw new PromptNotFoundError(
			"That step does not choose a prompt, so there is nothing to select " +
				"here."
		)

	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
		.limit(1)

	if (!row)
		throw new PromptNotFoundError(
			"That prompt no longer exists. It may have been deleted since the " +
				"list was loaded."
		)

	if (row.nodeTypeId !== decl.nodeTypeId || row.slot !== decl.slot)
		throw new PromptNotUsableError(
			`'${row.name}' was written for a different kind of step, so the ` +
				`fields '${decl.typeLabel}' reads would not be there. Prompts ` +
				`follow the step they were written for, into every pipeline that ` +
				`reuses it — duplicate this one and adapt the copy if that is ` +
				`what you meant.`
		)

	// Read off the declaration in hand rather than through `declaredFields`,
	// which would walk the same declarations a second time for the same answer.
	const declared = decl.promptFields ?? []
	const fields = (row.fields ?? {}) as Record<string, string>
	const missing = declared.filter((f) => !(f in fields))

	// Exceeding the declared set is fine — the extra keys are inert. Falling
	// short is not: the node would render a blank where it expects text, which
	// looks like the model ignoring an instruction rather than a missing field.
	if (missing.length)
		throw new PromptNotUsableError(
			`'${row.name}' has nothing written for ${missing
				.map((m) => `'${m}'`)
				.join(", ")}, which this step needs. Add ${
				missing.length > 1 ? "those fields" : "that field"
			} to the prompt, or pick another.`
		)

	return toRecord(row)
}

/**
 * Resolve a prompt reference into the text a run actually uses.
 *
 * The dereference step, and the reason a config may store an id: the executor
 * needs words, and the config stores a pointer. Identical in shape to what
 * happens for a connection or a sampling config, and deliberately so — three
 * swappable entities resolved three different ways would be three places for
 * the same bug.
 *
 * `archived_fields` is deliberately **not** merged in. Those are keys the slot
 * stopped declaring; feeding them back to a run would resurrect an instruction
 * the pipeline no longer has any way to show, which is the invisible half of
 * exactly the failure this file refuses everywhere else.
 */
export async function resolvePromptFields(
	db: Db,
	promptId: number
): Promise<Record<string, string>> {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
		.limit(1)
	return row ? ((row.fields ?? {}) as Record<string, string>) : {}
}

export interface CreatePromptInput {
	/** The pool's first half. Normalized through `poolKeyFor` on the way in. */
	nodeTypeId: string
	/** The pool's second half — the slot name the node declared. */
	slot: string
	name: string
	fields: Record<string, string>
	/** Where it was written. Grouping only; it stays selectable everywhere. */
	createdForSpecId?: number | null
	/** Spec slugs whose shipped config starts on this row. See the schema. */
	defaultForSpecs?: string[]
	seedKey?: string
	isImmutable?: boolean
	/** Only the boot sweep and `duplicatePrompt` ever set this. */
	archivedFields?: Record<string, string>
}

export async function createPrompt(
	db: Db,
	input: CreatePromptInput
): Promise<PromptRecord> {
	const [row] = await db
		.insert(schema.pipelinePrompts)
		.values({
			nodeTypeId: poolKeyFor(input.nodeTypeId),
			slot: input.slot,
			name: input.name,
			fields: input.fields,
			createdForSpecId: input.createdForSpecId ?? null,
			defaultForSpecs: input.defaultForSpecs ?? [],
			seedKey: input.seedKey ?? null,
			isImmutable: input.isImmutable ?? false,
			archivedFields: input.archivedFields ?? {}
		})
		.returning()
	return toRecord(row)
}

/**
 * Copy a prompt so it can be edited.
 *
 * The shipped ones are immutable, so "customize" is "duplicate then edit" —
 * the same move a config makes, and for the same reason: the thing a copy was
 * derived from has to keep meaning what it meant.
 *
 * **The archive comes with it**, and that is the recovery path the ruling asks
 * for. A field the slot stopped declaring is text somebody wrote; carrying it
 * on the copy is what makes "reference or copy it into a different
 * pipeline/node later" a thing a person can actually do, with Duplicate, rather
 * than something only a database client can reach.
 *
 * The copy records the pipeline it was made in, which is what puts it at the
 * top of that pipeline's picker next time. The original keeps whatever origin
 * it had — duplicating somebody's prompt does not move theirs.
 */
export async function duplicatePrompt(
	db: Db,
	promptId: number,
	name: string,
	createdForSpecId?: number | null
): Promise<PromptRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
		.limit(1)
	if (!row) throw new PromptNotFoundError("That prompt no longer exists.")

	return await createPrompt(db, {
		nodeTypeId: row.nodeTypeId,
		slot: row.slot,
		name,
		fields: (row.fields ?? {}) as Record<string, string>,
		archivedFields: (row.archivedFields ?? {}) as Record<string, string>,
		createdForSpecId: createdForSpecId ?? null
		// `defaultForSpecs` deliberately does not travel. It says "this is where
		// a shipped config starts", which is a claim about core's own row and
		// never true of a copy somebody made.
	})
}

export async function updatePrompt(
	db: Db,
	promptId: number,
	patch: { name?: string; fields?: Record<string, string> }
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
		.limit(1)
	if (!row) throw new PromptNotFoundError("That prompt no longer exists.")
	if (row.isImmutable)
		throw new PromptNotUsableError(
			`'${row.name}' is one of the prompts Serene Pub ships, so it stays as ` +
				`it is. Duplicate it and edit the copy — everything already pointing ` +
				`at the original keeps working.`
		)

	/**
	 * The name, checked against the pool before the UPDATE runs.
	 *
	 * The unique key is `(node type, slot, name)` and a pool is shared by every
	 * pipeline that uses the node — so the row a rename collides with may belong
	 * to a DIFFERENT pipeline and be invisible on the screen doing the renaming.
	 * Left to Postgres, that surfaces as `duplicate key value violates unique
	 * constraint "pipeline_prompts_pool_name_idx"`, which tells the person
	 * neither which row nor why. `updateContextTemplate` already makes exactly
	 * this argument for exactly this reason.
	 */
	if (patch.name !== undefined && patch.name !== row.name) {
		const [clash] = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(
				and(
					eq(schema.pipelinePrompts.nodeTypeId, row.nodeTypeId),
					eq(schema.pipelinePrompts.slot, row.slot),
					eq(schema.pipelinePrompts.name, patch.name),
					ne(schema.pipelinePrompts.id, promptId)
				)
			)
			.limit(1)
		if (clash)
			throw new PromptNotUsableError(
				`Another prompt for this step is already called '${patch.name}'. ` +
					`Prompts are shared by every pipeline that uses this step, so the ` +
					`name has to be unique across all of them — including ones not on ` +
					`this screen.`
			)
	}

	// Named explicitly rather than spread, and that is load bearing: a patch is
	// shaped by a socket payload, and `...patch` would let a client write
	// `archivedFields` — the one column whose whole purpose is to hold text the
	// panel does NOT render. A caller that could overwrite it could silently
	// destroy the only copy of a field the slot no longer declares, on the
	// screen that exists to preserve it. The sweep in `reconcilePromptFields`
	// is the only writer.
	await db
		.update(schema.pipelinePrompts)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.fields !== undefined ? { fields: patch.fields } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelinePrompts.id, promptId))
}

/**
 * Which slot names, across every published spec, hold a prompt reference.
 *
 * The same question `contextTemplateSlotNames` answers, and it became the same
 * question on the day prompts started being pooled: the reference check below
 * used to filter on the literal `'prompts'`, which is core's name for the slot
 * and no rule at all — a plugin declaring a prompts slot called `instructions`
 * had its rows deletable while a config still pointed at them.
 */
export async function promptSlotNames(db: Db): Promise<string[]> {
	const specs = await db.select().from(schema.pipelineSpecs)
	const names = new Set<string>()
	for (const spec of specs as any[]) {
		if (spec.activeVersionId == null) continue
		for (const d of await declarations(db, spec.activeVersionId))
			if (d.control === "prompts-ref") names.add(d.slot)
	}
	return [...names]
}

/**
 * Delete a prompt — with the two refusals that keep a selection meaningful.
 *
 * A shipped prompt never goes: it is the floor every config's default points
 * at, and the seed would just recreate it next boot with a different id,
 * leaving stored references dangling in between. A referenced prompt never
 * goes either — a config or an override holding the id of a deleted row is a
 * selection that stores cleanly and does nothing, which is the exact failure
 * this file's header promises to refuse. Deleting means: first point those
 * elsewhere, then delete.
 *
 * Refusal is the *common* path now rather than the rare one, exactly as it is
 * for templates: a pooled prompt is shared across every pipeline reusing its
 * node, so the thing holding it is often somewhere the person deleting is not
 * looking. The message says so.
 */
export async function deletePrompt(
	db: Db,
	promptId: number,
	opts: {
		/**
		 * Override rows that do **not** count as references.
		 *
		 * The caller's own selection of the prompt it is deleting: Delete sits
		 * beside the *selected* prompt, and selecting is itself a reference, so
		 * without this the button is unreachable from the panel.
		 *
		 * Passed in rather than released before the call. The socket handler
		 * used to delete those rows first and then attempt the delete, which
		 * meant a **refused** delete cleared the caller's selection on its way
		 * to failing: the prompt survived, the choice did not, and the error
		 * message said nothing about it. Same defect, same fix, as
		 * `deleteVariableTemplate`.
		 */
		ignoreOverrideIds?: Set<number>
		/**
		 * Config-value rows that do not count either — the same "your own
		 * selection" release, for the global panel: since the layer
		 * simplification (2026-08-24) an admin's selection outside a session is
		 * the instance config's own value row, not an override.
		 */
		ignoreConfigValueIds?: Set<number>
	} = {}
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
		.limit(1)
	if (!row) throw new PromptNotFoundError("That prompt no longer exists.")
	if (row.isImmutable)
		throw new PromptNotUsableError(
			`'${row.name}' is one of the prompts Serene Pub ships, so it stays. ` +
				`It is the fallback other configurations rely on.`
		)

	// References live in two tables: named-config values and per-scope
	// overrides, both storing the row id at a prompts slot. Values are
	// arbitrary json, so this filters in code rather than in SQL — the
	// tables are small and the comparison is exact.
	const slots = await promptSlotNames(db)
	let referenced = false
	if (slots.length) {
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
				(v) => v.value === promptId && !ignoredValues.has(v.id)
			) ||
			(overrides as any[]).some(
				(o) => o.value === promptId && !ignored.has(o.id)
			)
	}

	if (referenced)
		throw new PromptNotUsableError(
			`'${row.name}' is still selected somewhere — a configuration or a ` +
				`session is pointing at it. Prompts are shared by every pipeline ` +
				`that reuses this step, so this may be a selection you made ` +
				`elsewhere. Choose a different prompt there first, then delete ` +
				`this one.`
		)

	await db
		.delete(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
}
