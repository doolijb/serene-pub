/**
 * Authored prompts, as a swappable entity.
 *
 * A prompt is text. It is selected per provider node, per config, exactly the
 * way a connection or a sampling config is — the config stores this row's id,
 * never a copy of its words. That is what makes rewording a prompt reach every
 * node pointing at it instead of forking silently at the first edit.
 *
 * ## Two refusals, and why both are hard
 *
 * A prompt is namespaced to a pipeline, and its fields must fit the slot it is
 * being selected into. Both are checked on write and both throw rather than
 * degrade, because the failure they prevent is the same one: a selection that
 * stores cleanly and does nothing. Every screen then shows the prompt the user
 * chose while the run uses something else, and there is nothing to see.
 *
 * A prompt whose fields merely *exceed* the slot's is fine — extra keys are
 * inert, and refusing them would make a prompt written for a richer node
 * unusable on a simpler one for no gain.
 */

import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { declarations } from "$lib/server/pipelines/config/panel"

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
	specId: number
	name: string
	isImmutable: boolean
	fields: Record<string, string>
}

/** Every prompt available in one namespace, shipped ones first. */
export async function listPrompts(
	db: Db,
	specId: number
): Promise<PromptRecord[]> {
	const rows = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.specId, specId))
		.orderBy(asc(schema.pipelinePrompts.id))

	return (rows as any[])
		.map((r) => ({
			id: r.id,
			specId: r.specId,
			name: r.name,
			isImmutable: !!r.isImmutable,
			fields: (r.fields ?? {}) as Record<string, string>
		}))
		.sort((a, b) => Number(b.isImmutable) - Number(a.isImmutable))
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
 */
export async function assertSelectable(
	db: Db,
	specId: number,
	specVersionId: number,
	nodeKey: string,
	slot: string,
	promptId: number
): Promise<PromptRecord> {
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

	if (row.specId !== specId)
		throw new PromptNotUsableError(
			`'${row.name}' was written for a different pipeline. Prompts are kept ` +
				`per pipeline so that a chat reply's wording is never offered where ` +
				`a summary is being written.`
		)

	const declared = await declaredFields(db, specVersionId, nodeKey, slot)
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

	return {
		id: row.id,
		specId: row.specId,
		name: row.name,
		isImmutable: !!row.isImmutable,
		fields
	}
}

/**
 * Resolve a prompt reference into the text a run actually uses.
 *
 * The dereference step, and the reason a config may store an id: the executor
 * needs words, and the config stores a pointer. Identical in shape to what
 * happens for a connection or a sampling config, and deliberately so — three
 * swappable entities resolved three different ways would be three places for
 * the same bug.
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
	specId: number
	name: string
	fields: Record<string, string>
	seedKey?: string
	isImmutable?: boolean
}

export async function createPrompt(
	db: Db,
	input: CreatePromptInput
): Promise<PromptRecord> {
	const [row] = await db
		.insert(schema.pipelinePrompts)
		.values({
			specId: input.specId,
			name: input.name,
			fields: input.fields,
			seedKey: input.seedKey ?? null,
			isImmutable: input.isImmutable ?? false
		})
		.returning()
	return {
		id: row.id,
		specId: row.specId,
		name: row.name,
		isImmutable: !!row.isImmutable,
		fields: (row.fields ?? {}) as Record<string, string>
	}
}

/**
 * Copy a prompt so it can be edited.
 *
 * The shipped ones are immutable, so "customize" is "duplicate then edit" —
 * the same move a config makes, and for the same reason: the thing a copy was
 * derived from has to keep meaning what it meant.
 */
export async function duplicatePrompt(
	db: Db,
	promptId: number,
	name: string
): Promise<PromptRecord> {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
		.limit(1)
	if (!row) throw new PromptNotFoundError("That prompt no longer exists.")

	return await createPrompt(db, {
		specId: row.specId,
		name,
		fields: (row.fields ?? {}) as Record<string, string>
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
 * Delete a prompt — with the two refusals that keep a selection meaningful.
 *
 * A shipped prompt never goes: it is the floor every config's default points
 * at, and the seed would just recreate it next boot with a different id,
 * leaving stored references dangling in between. A referenced prompt never
 * goes either — a config or an override holding the id of a deleted row is a
 * selection that stores cleanly and does nothing, which is the exact failure
 * this file's header promises to refuse. Deleting means: first point those
 * elsewhere, then delete.
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
	// overrides, both storing the row id at slot 'prompts'. Values are
	// arbitrary json, so this filters in code rather than in SQL — the
	// tables are small and the comparison is exact.
	const values = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(eq(schema.pipelineConfigValues.slot, "prompts"))
	const overrides = await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.slot, "prompts"))
	const ignored = opts.ignoreOverrideIds ?? new Set<number>()
	const referenced =
		(values as any[]).some((v) => v.value === promptId) ||
		(overrides as any[]).some(
			(o) => o.value === promptId && !ignored.has(o.id)
		)

	if (referenced)
		throw new PromptNotUsableError(
			`'${row.name}' is still selected somewhere — a configuration or a ` +
				`chat is pointing at it. Choose a different prompt there first, ` +
				`then delete this one.`
		)

	await db
		.delete(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.id, promptId))
}

/** The prompt a namespace falls back to, by seed identity. */
export async function shippedPrompt(db: Db, specSlug: string) {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(
			eq(schema.pipelinePrompts.seedKey, `pipeline-prompt:${specSlug}`)
		)
		.limit(1)
	return row ?? null
}
