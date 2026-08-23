/**
 * How a context variable is rendered, as a swappable entity.
 *
 * The same pattern as `prompts.ts` — the config stores a reference, this row
 * holds the content — with one deliberate difference that is worth stating
 * before anyone tidies it away.
 *
 * ## There is no spec check here, and there must not be
 *
 * `prompts.ts` refuses a prompt written for another pipeline, because a chat
 * reply's wording has no business in a summarizer's picker. Copying that check
 * here would compile, pass review, and silently delete the entire reason this
 * table exists.
 *
 * A *rendering* is a statement about a variable, not about a pipeline. "Show me
 * my characters as prose" is true of characters wherever they appear, so a row
 * written while configuring the reply pipeline is selectable from the narrator
 * pipeline, from a plugin's pipeline, from anything that renders the same
 * variable id. Selection is checked against `variableId` and against nothing
 * else.
 *
 * ## The refusals that remain
 *
 * Both are the ones that keep a selection meaningful: a shipped row is never
 * edited or deleted in place (it is the floor other configurations fall back
 * to), and a referenced row is never deleted (a config holding the id of a
 * deleted row is a selection that stores cleanly and does nothing).
 */

import { asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations } from "$lib/server/pipelines/config/panel"

type Db = { select: any; insert: any; update: any; delete: any }

/** The template named nothing here — deleted since the list was loaded. */
export class VariableTemplateNotFoundError extends Error {}

/** The template exists but may not be used this way. Message is for a person. */
export class VariableTemplateNotUsableError extends Error {}

export interface VariableTemplateRecord {
	id: number
	variableId: string
	/** NULL means core's default engine — see `renderers.ts`. */
	engine: string | null
	name: string
	source: string
	isImmutable: boolean
}

const toRecord = (r: any): VariableTemplateRecord => ({
	id: r.id,
	variableId: r.variableId,
	engine: r.engine ?? null,
	name: r.name,
	source: r.source ?? "",
	isImmutable: !!r.isImmutable
})

/**
 * Every rendering available for one variable, shipped ones first.
 *
 * Scoped by variable and by nothing else — which is what makes a template
 * written in one pipeline appear in another's picker.
 */
export async function listVariableTemplates(
	db: Db,
	variableId: string
): Promise<VariableTemplateRecord[]> {
	const rows = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.variableId, variableId))
		.orderBy(asc(schema.pipelineVariableTemplates.id))

	return (rows as any[])
		.map(toRecord)
		.sort((a, b) => Number(b.isImmutable) - Number(a.isImmutable))
}

/**
 * Check that a template may be selected for a declaration, and say why not.
 *
 * The one rule: it has to render the variable the slot declares. A template
 * written for `core:var/personas@1` selected into the characters slot would
 * reference `personas` in its source, find nothing in scope, and render empty —
 * a prompt silently missing its cast, which looks like a model failure.
 */
export async function assertSelectable(
	db: Db,
	variableId: string,
	templateId: number
): Promise<VariableTemplateRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)

	if (!row)
		throw new VariableTemplateNotFoundError(
			"That layout no longer exists. It may have been deleted since the " +
				"list was loaded."
		)

	if (row.variableId !== variableId)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' lays out something else, so it has nothing to show here. ` +
				`A layout is written against one kind of value — pick one offered for ` +
				`this setting, or duplicate it and adapt the copy.`
		)

	return toRecord(row)
}

/**
 * Resolve a reference into the template a run actually renders.
 *
 * The dereference step, identical in shape to `resolvePromptFields` and
 * deliberately so: two swappable entities resolved two different ways are two
 * places for the same bug.
 *
 * Returns null rather than throwing on a dangling id. The caller falls back to
 * the in-code default, which still emits today's bytes — a missing row should
 * cost a customization, never a prompt.
 */
export async function resolveVariableTemplate(
	db: Db,
	templateId: number
): Promise<{ engine: string | null; source: string } | null> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row) return null
	return { engine: row.engine ?? null, source: row.source ?? "" }
}

export interface CreateVariableTemplateInput {
	variableId: string
	name: string
	source: string
	engine?: string | null
	seedKey?: string
	isImmutable?: boolean
}

export async function createVariableTemplate(
	db: Db,
	input: CreateVariableTemplateInput
): Promise<VariableTemplateRecord> {
	const [row] = await db
		.insert(schema.pipelineVariableTemplates)
		.values({
			variableId: input.variableId,
			name: input.name,
			source: input.source,
			engine: input.engine ?? null,
			seedKey: input.seedKey ?? null,
			isImmutable: input.isImmutable ?? false
		})
		.returning()
	return toRecord(row)
}

/**
 * Copy a template so it can be edited.
 *
 * The shipped ones are immutable, so "customize" is "duplicate then edit" — and
 * the copy keeps the original's `variableId`, which is what puts it in the same
 * picker everywhere that variable is rendered.
 */
export async function duplicateVariableTemplate(
	db: Db,
	templateId: number,
	name: string
): Promise<VariableTemplateRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new VariableTemplateNotFoundError("That layout no longer exists.")

	return await createVariableTemplate(db, {
		variableId: row.variableId,
		name,
		source: row.source ?? "",
		engine: row.engine ?? null
	})
}

export async function updateVariableTemplate(
	db: Db,
	templateId: number,
	patch: { name?: string; source?: string; engine?: string | null }
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new VariableTemplateNotFoundError("That layout no longer exists.")
	if (row.isImmutable)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is one of the layouts Serene Pub ships, so it stays as it ` +
				`is. Duplicate it and edit the copy — everything already pointing at ` +
				`the original keeps working.`
		)

	await db
		.update(schema.pipelineVariableTemplates)
		.set({
			...(patch.name !== undefined ? { name: patch.name } : {}),
			...(patch.source !== undefined ? { source: patch.source } : {}),
			...(patch.engine !== undefined ? { engine: patch.engine } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
}

/**
 * Which slot names carry a variable reference, across every published pipeline.
 *
 * Read from the declarations rather than assumed to be `'variables'`: the row
 * stores the slot's *authored* name, and a plugin may call its slot anything.
 * Hard-coding the core name would let a plugin's reference go unseen, and an
 * unseen reference is a delete that succeeds and leaves a dangling pointer.
 */
async function variableSlotNames(db: Db): Promise<string[]> {
	const specs = await db.select().from(schema.pipelineSpecs)
	const names = new Set<string>()
	for (const spec of specs as any[]) {
		if (!spec.activeVersionId) continue
		for (const d of await declarations(db as any, spec.activeVersionId))
			if (d.control === "variable-template-ref") names.add(d.slot)
	}
	return [...names]
}

/**
 * Delete a template — with the two refusals that keep a selection meaningful.
 *
 * The reference check spans every pipeline, which is the cross-pipeline feature
 * seen from its other side: a row the reply pipeline stopped using may still be
 * the narrator's, and this is the only place that would notice.
 */
export async function deleteVariableTemplate(
	db: Db,
	templateId: number,
	opts: {
		/**
		 * Override rows that do **not** count as references.
		 *
		 * The caller's own selection of the row it is deleting: the Delete
		 * button sits beside the *selected* layout, and selecting is itself a
		 * reference, so without this the button is unreachable.
		 *
		 * Passed in rather than released before the call, which is how this
		 * started and which was wrong in a way only live use showed. Releasing
		 * first meant a *refused* delete — the common case here, since another
		 * pipeline holding the row is exactly what refuses — still cleared the
		 * caller's selection on the way to failing. The row survived, the
		 * choice did not, and the error message said nothing about it.
		 */
		ignoreOverrideIds?: Set<number>
	} = {}
): Promise<void> {
	const [row] = await db
		.select()
		.from(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
		.limit(1)
	if (!row)
		throw new VariableTemplateNotFoundError("That layout no longer exists.")
	if (row.isImmutable)
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is one of the layouts Serene Pub ships, so it stays. It ` +
				`is the fallback other configurations rely on.`
		)

	const slots = await variableSlotNames(db)
	let referenced = false
	if (slots.length) {
		// Values are arbitrary json, which Postgres will not compare with `=`, so
		// this filters in code. The rows are few and the comparison is exact.
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
		throw new VariableTemplateNotUsableError(
			`'${row.name}' is still in use — a pipeline is laying something out with ` +
				`it. Layouts are shared across pipelines, so this may be one you set ` +
				`up elsewhere. Point that setting at a different layout first, then ` +
				`delete this one.`
		)

	await db
		.delete(schema.pipelineVariableTemplates)
		.where(eq(schema.pipelineVariableTemplates.id, templateId))
}
