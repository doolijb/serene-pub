/**
 * The four writes.
 *
 * `writeOption` sets a value, `clearOption` resets one, `selectNamedConfig`
 * switches the whole set, and the two `*OptionGate` functions answer "may this
 * caller point this slot at this row" for the two reference kinds whose target
 * is user-authored.
 *
 * **Reset deletes.** `clearOption` removes the row rather than writing the
 * inherited value into it. The difference is invisible until the day an admin
 * moves the instance value: a deleted row inherits the new one, a pinned copy
 * does not. That is the whole point of resolving per path rather than per slot
 * (F20).
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	type Published,
	declarations,
	published
} from "$lib/server/pipelines/config/panel/declarations"
import { optionId } from "$lib/server/pipelines/config/panel/ids"
import { layers, namespaceView } from "$lib/server/pipelines/config/panel/read"
import { resolveWriteScope } from "$lib/server/pipelines/config/panel/scopes"
import {
	type Db,
	type Decl,
	OptionNotFoundError,
	OptionNotWritableError,
	type Viewer,
	type WriteScope
} from "$lib/server/pipelines/config/panel/types"

/**
 * Resolve a handle back to its address.
 *
 * Over every declaration, not just the visible ones — see the header. A miss is
 * a handle from another install, or from a version that no longer declares the
 * setting, and both deserve the same sentence.
 */
async function locate(
	db: Db,
	secret: string,
	slug: string,
	id: string
): Promise<{ at: Published; decl: Decl }> {
	const at = await published(db, slug)
	if (!at)
		throw new OptionNotFoundError(
			`There is no published pipeline called '${slug}'.`
		)
	const decls = await declarations(db, at.specVersionId)
	const decl = decls.find(
		(d) => optionId(secret, d.nodeKey, d.slot, d.path) === id
	)
	if (!decl)
		throw new OptionNotFoundError(
			"That setting is not part of this pipeline. A newer version may have " +
				"removed it, or the link was made on a different install."
		)
	return { at, decl }
}

/**
 * The gate every variable-layout mutation passes first.
 *
 * Deliberately **not** the shape `promptInSpec` takes. A prompt mutation is
 * gated on the prompt belonging to the pipeline whose panel is open, and the
 * same check here would undo the feature: a layout is shared across pipelines
 * on purpose, so "does this row belong to this spec" has no true answer.
 *
 * What is checked instead is that the caller is operating a control this
 * pipeline actually offers them — the option handle resolves to one of this
 * spec's declarations, that declaration is a layout reference, and the viewer
 * may write it. The returned `variableId` is then what the caller matches the
 * target row against, which is the real rule: you may edit a layout through the
 * setting that renders it.
 */
export async function variableOptionGate(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string
): Promise<{ variableId: string }> {
	const { decl } = await locate(db, secret, slug, id)
	if (decl.control !== "variable-template-ref" || !decl.variableId)
		throw new OptionNotFoundError(
			"That setting does not choose a layout, so there is nothing here to " +
				"edit."
		)
	// Same refusal the write path uses, rather than a second copy of the rule.
	// `config` for an admin because editing a shared row is a structural act —
	// passing the viewer's default scope would refuse an administrator inside
	// a session on the grounds that layouts are not session-writable, when the row
	// they are editing is the configuration's.
	resolveWriteScope(
		viewer,
		viewer.isAdmin ? "config" : undefined,
		decl.matrixSlot
	)
	return { variableId: decl.variableId }
}

/**
 * The gate every context-template mutation passes first.
 *
 * Same shape as `variableOptionGate`, and not the shape `promptInSpec` takes,
 * for the same reason: a template is shared across pipelines on purpose, so
 * "does this row belong to this spec" has no true answer. What is checked is
 * that the caller is operating a control this pipeline actually offers them —
 * the option handle resolves to one of this spec's declarations, that
 * declaration is a template reference, and the viewer may write it. The
 * returned `nodeTypeId` is then what the caller matches the target row against,
 * which is the real rule: you may edit a template through the setting that
 * renders it.
 */
export async function contextTemplateOptionGate(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string
): Promise<{ nodeTypeId: string; specId: number }> {
	const { at, decl } = await locate(db, secret, slug, id)
	if (decl.control !== "context-template-ref" || !decl.nodeTypeId)
		throw new OptionNotFoundError(
			"That setting does not choose a context template, so there is " +
				"nothing here to edit."
		)
	// Same refusal the write path uses, rather than a second copy of the rule.
	resolveWriteScope(
		viewer,
		viewer.isAdmin ? "config" : undefined,
		decl.matrixSlot
	)
	return { nodeTypeId: decl.nodeTypeId, specId: at.specId }
}

/**
 * Where an edit is allowed to land when the caller names a configuration.
 *
 * Two surfaces mean two different things by "change this", and conflating them
 * is what made the builder's configuration selector decorative: every edit
 * went to `pipeline_node_overrides` at **instance** scope, and instance
 * outranks `preset` in the scope chain — so the value followed you across
 * every configuration you switched to, and duplicating one to change a single
 * setting changed it everywhere instead.
 *
 *   - the **builder** authors *the configuration itself* (`preset` layer)
 *   - the **sidebar** overrides that configuration for you or this session
 *
 * Refusing an immutable config here rather than in the UI is the same rule the
 * prompt editor keeps: hiding a button is not what protects a shipped row.
 */
async function configTarget(db: Db, at: Published, configId: number) {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, configId))
		.limit(1)
	if (!row)
		throw new OptionNotFoundError("That configuration no longer exists.")
	if ((row as any).specId !== at.specId)
		throw new OptionNotWritableError(
			`That configuration belongs to a different pipeline. ` +
				`Configurations are namespaced to the pipeline they were ` +
				`written for.`
		)
	if ((row as any).isImmutable)
		throw new OptionNotWritableError(
			`'${(row as any).name}' is one of the configurations Serene Pub ` +
				`ships, so it stays as written. Duplicate it and edit the copy.`
		)
	return row as any
}

/**
 * A chain write, checked against the hook's declaration (18 §4a/§5).
 *
 * Three refusals, each the mechanical form of a law: the value is an ordered
 * list of ids and nothing else; every id names a row that exists (an id that
 * doesn't is an attachment that stores cleanly and does nothing); and every
 * row's type is one the hook accepts — chain homogeneity, checkable off the
 * declaration, refusing at attach rather than at run time. Duplicates collapse
 * to first occurrence: one script running twice in one chain is never what a
 * reorder meant.
 */
async function checkChain(
	db: Db,
	decl: Decl,
	value: unknown
): Promise<number[]> {
	if (!Array.isArray(value) || value.some((v) => typeof v !== "number"))
		throw new OptionNotWritableError(
			"A script chain is an ordered list of scripts and nothing else."
		)
	const ids = [...new Set(value as number[])]
	if (!ids.length) return ids

	const accepts = new Set(decl.accepts ?? [])
	const { inArray } = await import("drizzle-orm")
	const rows = await db
		.select()
		.from(schema.pipelineScripts)
		.where(inArray(schema.pipelineScripts.id, ids))
	const byId = new Map<number, any>((rows as any[]).map((r) => [r.id, r]))

	for (const scriptId of ids) {
		const row = byId.get(scriptId)
		if (!row)
			throw new OptionNotWritableError(
				"One of those scripts no longer exists. It may have been " +
					"deleted since the list was loaded."
			)
		if (!accepts.has(row.typeId))
			throw new OptionNotWritableError(
				`'${row.name}' is a different kind of script than this step ` +
					`accepts, so it can never run here. The picker only offers ` +
					`what fits; reload if the lists look stale.`
			)
	}
	return ids
}

/**
 * The named config a global edit lands in: the instance's selection, resolved
 * by the runtime's own resolver, then gated exactly as an explicit `configId`
 * would be — same immutability refusal, same spec check. Shipped defaults
 * refuse with the duplicate suggestion rather than silently absorbing edits.
 */
async function instanceConfigTarget(db: Db, at: Published) {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(db, at.specId, at.slug, {})
	if (!selected)
		throw new OptionNotFoundError(
			"This pipeline has no configuration yet. Publishing seeds one; if " +
				"this persists, re-run the application's boot."
		)
	return await configTarget(db, at, selected.configId)
}

export async function writeOption(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string,
	value: unknown,
	/** Edit this configuration itself, rather than the resolved target. */
	configId?: number
): Promise<void> {
	const { at, decl } = await locate(db, secret, slug, id)
	const now = new Date()

	if (decl.control === "scripts-chain")
		value = await checkChain(db, decl, value)

	const target = resolveWriteScope(
		viewer,
		configId != null ? "config" : undefined,
		decl.matrixSlot
	)

	if (target.scope === "config") {
		// Authoring a configuration is a structural act — it changes what
		// everyone resolving that configuration gets — and since the
		// simplification (2026-08-24) it is the *only* global write: the
		// former instance override layer folded into the config itself.
		const row =
			configId != null
				? await configTarget(db, at, configId)
				: await instanceConfigTarget(db, at)
		await db
			.insert(schema.pipelineConfigValues)
			.values({
				configId: row.id,
				nodeKey: decl.nodeKey,
				slot: decl.slot,
				path: decl.path,
				value
			})
			.onConflictDoUpdate({
				target: [
					schema.pipelineConfigValues.configId,
					schema.pipelineConfigValues.nodeKey,
					schema.pipelineConfigValues.slot,
					schema.pipelineConfigValues.path
				],
				set: { value }
			})
		return
	}

	await db
		.insert(schema.pipelineNodeOverrides)
		.values({
			specId: at.specId,
			scopeKind: target.scope,
			scopeId: target.scopeId,
			nodeKey: decl.nodeKey,
			slot: decl.slot,
			path: decl.path,
			value,
			updatedBy: viewer.userId,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: [
				schema.pipelineNodeOverrides.specId,
				schema.pipelineNodeOverrides.scopeKind,
				schema.pipelineNodeOverrides.scopeId,
				schema.pipelineNodeOverrides.nodeKey,
				schema.pipelineNodeOverrides.slot,
				schema.pipelineNodeOverrides.path
			],
			set: { value, updatedBy: viewer.userId, updatedAt: now }
		})
}

/**
 * Reset — a delete, never a write of the inherited value.
 *
 * Deleting is what keeps an admin's later change reaching this person. Pinning a
 * copy of what they were inheriting would look identical today and silently
 * strand them on the old value forever.
 */
export async function clearOption(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string,
	/** Reset this configuration's own value, rather than the resolved target. */
	configId?: number
): Promise<void> {
	const { at, decl } = await locate(db, secret, slug, id)

	const target = resolveWriteScope(
		viewer,
		configId != null ? "config" : undefined,
		decl.matrixSlot
	)

	if (target.scope === "config") {
		const row =
			configId != null
				? await configTarget(db, at, configId)
				: await instanceConfigTarget(db, at)
		await db
			.delete(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, row.id),
					eq(schema.pipelineConfigValues.nodeKey, decl.nodeKey),
					eq(schema.pipelineConfigValues.slot, decl.slot),
					eq(schema.pipelineConfigValues.path, decl.path)
				)
			)
		return
	}

	await db
		.delete(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, at.specId),
				eq(schema.pipelineNodeOverrides.scopeKind, target.scope),
				eq(schema.pipelineNodeOverrides.scopeId, target.scopeId),
				eq(schema.pipelineNodeOverrides.nodeKey, decl.nodeKey),
				eq(schema.pipelineNodeOverrides.slot, decl.slot),
				eq(schema.pipelineNodeOverrides.path, decl.path)
			)
		)
}

/**
 * Record a scope's choice of named config, by row id.
 *
 * Ids are safe here where preset slugs needed to be slugs (12 §3b): a config
 * hangs off the *spec*, not the version, so publishing 1.1.0 dangles nothing —
 * and a deleted config's FK nulls the selection, which `resolveSelectedConfig`
 * reads as "fall back to the shipped default" (the rule ratified for 0.6).
 *
 * Delegates to `configs.selectConfig`, which refuses a config belonging to
 * another pipeline — the panel and the runtime share one write path the same
 * way `layers()` makes them share one read path.
 */
export async function selectNamedConfig(
	db: Db,
	slug: string,
	viewer: Viewer,
	configId: number,
	scope?: "session" | "instance"
): Promise<void> {
	const at = await published(db, slug)
	if (!at)
		throw new OptionNotFoundError(
			`There is no published pipeline called '${slug}'.`
		)

	// The two selection scopes left (ruled 2026-08-24): the session's own choice,
	// else the instance default. From inside a session the selection is the
	// session's; everywhere else it is the instance's, which is the admin's.
	const target: "session" | "instance" =
		scope ?? (viewer.sessionId != null ? "session" : "instance")
	if (target === "instance" && !viewer.isAdmin)
		throw new OptionNotWritableError(
			"Only an administrator chooses the configuration for everyone on this instance."
		)

	const scopeId = target === "session" ? viewer.sessionId! : 0

	const { selectConfig } = await import("$lib/server/pipelines/config/named")
	await selectConfig(db, at.specId, target, scopeId, configId, viewer.userId)
}
