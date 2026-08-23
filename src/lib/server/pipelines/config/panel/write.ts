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
import {
	optionId
} from "$lib/server/pipelines/config/panel/ids"
import {
	layers,
	namespaceView
} from "$lib/server/pipelines/config/panel/read"
import {
	resolveWriteScope,
	writeScopeFor
} from "$lib/server/pipelines/config/panel/scopes"
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
	// `instance` for an admin because that is where their layout edits land
	// (see `effScope` in `namespaceView`) — passing the viewer's default scope
	// would refuse an administrator on the grounds that layouts are set at
	// instance level, which is where this very call is trying to set one.
	resolveWriteScope(
		viewer,
		viewer.isAdmin ? "instance" : undefined,
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
		viewer.isAdmin ? "instance" : undefined,
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
 *   - the **sidebar** overrides that configuration for you or this chat
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

export async function writeOption(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string,
	value: unknown,
	scope?: WriteScope,
	/** Edit this configuration itself, rather than override it at a scope. */
	configId?: number
): Promise<void> {
	const { at, decl } = await locate(db, secret, slug, id)
	const now = new Date()

	if (configId != null) {
		// Authoring a configuration is a structural act — it changes what
		// everyone resolving that configuration gets — so it takes the same
		// admin check every other non-prompt write takes, via `instance`.
		resolveWriteScope(viewer, "instance", decl.matrixSlot)
		await configTarget(db, at, configId)
		await db
			.insert(schema.pipelineConfigValues)
			.values({
				configId,
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

	const target = resolveWriteScope(viewer, scope, decl.matrixSlot)

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
	scope?: WriteScope,
	/** Reset this configuration's own value, rather than an override of it. */
	configId?: number
): Promise<void> {
	const { at, decl } = await locate(db, secret, slug, id)

	if (configId != null) {
		resolveWriteScope(viewer, "instance", decl.matrixSlot)
		await configTarget(db, at, configId)
		await db
			.delete(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, configId),
					eq(schema.pipelineConfigValues.nodeKey, decl.nodeKey),
					eq(schema.pipelineConfigValues.slot, decl.slot),
					eq(schema.pipelineConfigValues.path, decl.path)
				)
			)
		return
	}

	const target = resolveWriteScope(viewer, scope, decl.matrixSlot)

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
	scope?: WriteScope
): Promise<void> {
	const at = await published(db, slug)
	if (!at)
		throw new OptionNotFoundError(
			`There is no published pipeline called '${slug}'.`
		)

	const target: WriteScope = scope ?? writeScopeFor(viewer)
	if (target === "instance" && !viewer.isAdmin)
		throw new OptionNotWritableError(
			"Only an administrator chooses the configuration for everyone on this instance."
		)

	const scopeId =
		target === "instance"
			? 0
			: target === "chat"
				? viewer.chatId!
				: viewer.userId

	const { selectConfig } = await import("$lib/server/pipelines/config/named")
	await selectConfig(db, at.specId, target, scopeId, configId, viewer.userId)
}
