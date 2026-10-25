/**
 * The four writes.
 *
 * `writeOption` sets a value, `clearOption` resets one, `resetConfig` clears
 * an administrator's instance-wide values at once, and the two `*OptionGate`
 * functions answer "may this caller point this slot at this row" for the two
 * reference kinds whose target is user-authored. (Choosing a named
 * configuration — `selectNamedConfig` — is gone with configurations, R50.)
 *
 * **Reset deletes.** `clearOption` removes the row rather than writing the
 * inherited value into it. The difference is invisible until the day an admin
 * moves the pub value: a deleted row inherits the new one, a pinned copy
 * does not. That is the whole point of resolving per path rather than per slot
 * (F20).
 *
 * **And so does a write that lands back on the default** (ruled 2026-09-10). A
 * layer stores deviations, so `writeOption` deletes the row when the value it
 * is handed equals the declaration's — the same delete `clearOption` performs,
 * reached from the other direction. Without it, dragging a slider away and back
 * would leave a row behind that resolves identically today and pins the config
 * to the number forever after. See `config/deviations.ts`.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { holdsRow } from "$lib/server/pipelines/config/deviations"
import { acceptedEnginesOf } from "$lib/shared/pipelines/templateEngines"
import {
	type Published,
	declarations,
	published
} from "$lib/server/pipelines/config/panel/declarations"
import { optionId } from "$lib/server/pipelines/config/panel/ids"
import {
	layers,
	namespaceView,
	withUnplacedChains
} from "$lib/server/pipelines/config/panel/read"
import { resolveWriteScope } from "$lib/server/pipelines/config/panel/scopes"
import {
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
	const decl =
		decls.find((d) => optionId(secret, d.nodeKey, d.slot, d.path) === id) ??
		// An unplaced chain (D4) is no declaration, but its row is shown so it
		// can be cleared — so its handle resolves too, over the addresses this
		// spec actually stores.
		(
			await withUnplacedChains(
				db,
				at.specVersionId,
				decls,
				await storedAddressKeys(db, at.specId, at.slug)
			)
		).find(
			(d) => d.unplaced && optionId(secret, d.nodeKey, d.slot, d.path) === id
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
 * A layout is shared across pipelines on purpose, so "does this row belong to
 * this spec" has no true answer for one — a gate asking it would quietly remove
 * cross-pipeline reuse while looking like consistency.
 *
 * What is checked instead is that the caller is operating a control this
 * pipeline actually offers them — the option handle resolves to one of this
 * spec's declarations, that declaration is a layout reference, and the viewer
 * may write it. The returned `variableId` is then what the caller matches the
 * target row against, which is the real rule: you may edit a layout through the
 * setting that renders it.
 *
 * All three `*OptionGate`s now take this shape. Prompts were the exception —
 * they were gated on ownership, because they were namespaced to a spec — and
 * pooling them by node made the ownership question as meaningless for a prompt
 * as it always was for a layout.
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
 * Same shape as `variableOptionGate`, for the same reason: a template is shared
 * across pipelines on purpose, so "does this row belong to this spec" has no
 * true answer. What is checked is
 * that the caller is operating a control this pipeline actually offers them —
 * the option handle resolves to one of this spec's declarations, that
 * declaration is a template reference, and the viewer may write it. The
 * returned `nodeDefinitionId` is then what the caller matches the target row against,
 * which is the real rule: you may edit a template through the setting that
 * renders it.
 */
export async function contextTemplateOptionGate(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string
): Promise<{
	nodeDefinitionId: string
	engine: string
	acceptedEngines: string[]
	specId: number
}> {
	const { at, decl } = await locate(db, secret, slug, id)
	if (decl.control !== "context-template-ref" || !decl.nodeDefinitionId)
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
	const engines = acceptedEnginesOf(decl)
	return {
		nodeDefinitionId: decl.nodeDefinitionId,
		// The language a NEW template here is written in — the slot's first
		// accepted engine. Returned rather than left to the caller because the
		// caller would have to guess, and the only guess available is core's,
		// which is exactly how a slot declaring another language ends up
		// holding Handlebars source that renders as raw markup instead of
		// failing.
		engine: engines[0]!,
		// Every language this slot renders, for the two callers that need the
		// whole set: selection, which must accept a row in any of them, and
		// creation, which must refuse one outside them.
		acceptedEngines: engines,
		specId: at.specId
	}
}

/**
 * The gate every prompt mutation passes first.
 *
 * It replaces `promptInSpec`, which asked whether the prompt belonged to the
 * pipeline whose panel was open. That question had a true answer while prompts
 * were namespaced to a spec and has none now: a prompt is pooled by the node
 * that consumes it precisely so an action reusing that node inherits it, and a
 * gate demanding ownership would refuse every one of those — removing the
 * feature while looking like a security check.
 *
 * It is still a real one. `promptId` arrives from the client as a small integer
 * somebody can guess, so without a gate a guess edits or deletes another
 * pipeline's wording through this one's panel. What is checked is the same
 * thing the other two gates check: the option handle resolves to a prompt
 * setting *this* pipeline declares, and the viewer may write it. The returned
 * pool is then what the caller matches the target row against — you may edit a
 * prompt through a setting that uses it.
 *
 * Both halves of the pool are returned because both are the key: a type may
 * declare two prompts slots with different field sets, and matching on the node
 * type alone would let one slot's rows be edited through the other's control.
 */
export async function promptOptionGate(
	db: Db,
	secret: string,
	slug: string,
	viewer: Viewer,
	id: string
): Promise<{
	nodeDefinitionId: string
	slot: string
	/** The declaration's own node, so a caller can re-check with `assertSelectable`. */
	nodeKey: string
	specId: number
	specVersionId: number
}> {
	const { at, decl } = await locate(db, secret, slug, id)
	if (decl.control !== "prompts-ref" || !decl.nodeDefinitionId)
		throw new OptionNotFoundError(
			"That setting does not choose a prompt, so there is nothing here to " +
				"edit."
		)
	// Writing a prompt is an administrator's (owner ruling 2026-10-09: "Non
	// admins shouldn't have a pipelines sidebar"; they pick, never write). A
	// prompt row is pooled by the node that consumes it and has no owner, so an
	// edit reaches every pipeline, session and person using it. Picking one for
	// your own session is `writeOption`, not this gate.
	if (!viewer.isAdmin)
		throw new OptionNotWritableError(
			"Only an administrator writes or edits prompts, because everyone " +
				"using a prompt gets the change. Nothing was saved. You can " +
				"choose among the prompts there are in your session's settings."
		)
	resolveWriteScope(viewer, "config", decl.matrixSlot)
	return {
		nodeDefinitionId: decl.nodeDefinitionId,
		slot: decl.slot,
		nodeKey: decl.nodeKey,
		specId: at.specId,
		specVersionId: at.specVersionId
	}
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
 * Every address this spec stores a value at — its instance values, the
 * genre's defaults' changes and its scoped overrides — as
 * `nodeKey\u0000slot\u0000path` keys. What an
 * unplaced chain's handle is resolved over.
 */
async function storedAddressKeys(db: Db, specId: number, slug: string): Promise<string[]> {
	const { genreStoredValues } = await import("$lib/server/pipelines/registrations/genreValues")
	const genre = await genreStoredValues(db, slug)
	// 🚧 R50: the pipeline's instance values, where configurations were.
	const { instanceStoredValues } = await import("$lib/server/pipelines/registrations/instanceValues")
	const values = await instanceStoredValues(db, slug)
	const overrides = await db
		.select({
			nodeKey: schema.pipelineNodeOverrides.nodeKey,
			slot: schema.pipelineNodeOverrides.slot,
			path: schema.pipelineNodeOverrides.path
		})
		.from(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.specId, specId))
	return [...(values as any[]), ...(overrides as any[]), ...genre].map(
		(r) => `${r.nodeKey}\u0000${r.slot}\u0000${r.path ?? ""}`
	)
}

/**
 * An unplaced chain (D4) may only shrink. Its seam is gone, so nothing can be
 * added — there is no `accepts` to check a script against and no place it
 * would run — but removing entries, down to clearing it, is how an admin
 * acts on the unplaced row. Every id must already be stored at this
 * address somewhere in this spec.
 */
async function checkUnplacedChain(
	db: Db,
	specId: number,
	decl: Decl,
	value: unknown,
	slug: string
): Promise<number[]> {
	if (!Array.isArray(value) || value.some((v) => typeof v !== "number"))
		throw new OptionNotWritableError(
			"A script chain is an ordered list of scripts and nothing else."
		)
	const ids = [...new Set(value as number[])]
	if (!ids.length) return ids
	const stored = new Set<number>()
	// 🚧 R50: the pipeline's instance values, where configurations were.
	const { instanceStoredValues } = await import("$lib/server/pipelines/registrations/instanceValues")
	const values = (await instanceStoredValues(db, slug)).filter(
		(r) => r.nodeKey === decl.nodeKey && r.slot === decl.slot && r.path === decl.path
	)
	const overrides = await db
		.select({ value: schema.pipelineNodeOverrides.value })
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, specId),
				eq(schema.pipelineNodeOverrides.nodeKey, decl.nodeKey),
				eq(schema.pipelineNodeOverrides.slot, decl.slot),
				eq(schema.pipelineNodeOverrides.path, decl.path)
			)
		)
	// An administrator's genre-scope change (R38) holds them too.
	const { genreStoredValues } = await import("$lib/server/pipelines/registrations/genreValues")
	const genre = (await genreStoredValues(db, slug)).filter(
		(r) => r.nodeKey === decl.nodeKey && r.slot === decl.slot && r.path === decl.path
	)
	for (const r of [...(values as any[]), ...(overrides as any[]), ...genre])
		if (Array.isArray(r.value))
			for (const v of r.value) if (typeof v === "number") stored.add(v)
	if (ids.some((v) => !stored.has(v)))
		throw new OptionNotWritableError(
			"This chain's place in the step no longer exists, so nothing can be " +
				"added to it. Remove its scripts, or attach them where the step " +
				"still takes scripts."
		)
	return ids
}

/**
 * 🚧 Where an administrator's instance-wide edit of this pipeline lands
 * (R38, R50, A15): the genre's defaults' registrations of it — or, for a
 * pipeline no genre registers (a card action: portrait, likeness), its
 * **instance values** (`instanceValues.ts`). Configurations are retired: an
 * edit naming one is refused.
 */
async function globalTarget(
	db: Db,
	at: Published,
	configId: number | undefined
): Promise<
	| { kind: "genre"; targets: import("$lib/server/pipelines/registrations/genreValues").GenreValueTarget[] }
	| { kind: "instance" }
> {
	if (configId != null)
		throw new OptionNotWritableError(
			"Pipeline configurations are retired: a pipeline's values come from where it is " +
				"registered — the genre's defaults, a preset — or, for one nothing registers, " +
				"this pipeline's own values here. Change them without naming a configuration. " +
				"Nothing was saved."
		)
	const { genreValueTargets } = await import("$lib/server/pipelines/registrations/genreValues")
	const targets = await genreValueTargets(db, at.slug)
	return targets.length ? { kind: "genre", targets } : { kind: "instance" }
}

/** The pipeline's declared default at one address — what an instance-wide value otherwise inherits. */
async function declaredDefaultAt(db: Db, at: Published, decl: { nodeKey: string; slot: string; path: string }) {
	const { shippedConfigValuesOf } = await import("$lib/server/pipelines/config/named")
	const decls = await declarations(db, at.specVersionId)
	return (await shippedConfigValuesOf(db, at.specId, at.slug, at.specVersionId, decls)).get(
		`${decl.nodeKey}\u0000${decl.slot}\u0000${decl.path}`
	)
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
		value = decl.unplaced
			? await checkUnplacedChain(db, at.specId, decl, value, at.slug)
			: await checkChain(db, decl, value)
	// Emptying an unplaced chain removes it: an empty list at an address no
	// seam declares is a row with nothing left to say.
	if (decl.unplaced && Array.isArray(value) && !value.length)
		return await clearOption(db, secret, slug, viewer, id, configId)

	// A prompt reference is checked against the slot's pool before it is
	// stored, the same way a chain is checked against its hook's accepted
	// types. The picker only offers what fits, so this catches a stale client
	// and a guessed id — and both produce the failure this layer refuses
	// everywhere: a selection that stores cleanly and does nothing, with the
	// panel showing the chosen prompt while the run renders blanks.
	//
	// Guarded on `number` rather than applied to everything: a value of another
	// type is not a reference at all, and refusing it here would report a pool
	// mismatch for what is really a malformed payload.
	if (decl.control === "prompts-ref" && typeof value === "number") {
		const { assertSelectable } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const chosen = await assertSelectable(
			db,
			at.specVersionId,
			decl.nodeKey,
			decl.slot,
			value
		)
		// 🚧 R54: a member chooses among the prompts an administrator has not
		// hidden. The picker never offers one; a guessed id is refused here.
		if (!viewer.isAdmin && chosen.hidden)
			throw new OptionNotWritableError(
				`'${chosen.name}' is not one of the prompts offered here — an administrator hid it. Nothing was saved.`
			)
	}

	// A context template is checked the same way, and one step further: against
	// the typed scope of THIS step (typed templates P5, owner Q6). A template
	// naming something nothing here supplies is refused with the name, the
	// nearest one that exists and what does — rather than stored, shown as
	// selected, and rendered as blanks. Warnings, and a step whose upstream
	// declares no types, never refuse.
	if (
		decl.control === "context-template-ref" &&
		typeof value === "number" &&
		decl.nodeDefinitionId
	) {
		const { assertSelectable } = await import(
			"$lib/server/pipelines/entities/contextTemplates"
		)
		await assertSelectable(
			db,
			decl.nodeDefinitionId,
			value,
			acceptedEnginesOf(decl),
			{
				specVersionId: at.specVersionId,
				nodeKey: decl.nodeKey,
				slot: decl.slot
			}
		)
	}

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
		// 🚧 Since R38: the genre's defaults, where a genre registers it.
		const global = await globalTarget(db, at, configId)
		// ── setting it back to the default is a reset (ruled 2026-09-10) ──
		// A layer stores deviations: a value equal to what it would otherwise
		// inherit (the declared defaults) is no value, so "I put it back"
		// clears the address rather than pinning today's default forever.
		const inherited = await declaredDefaultAt(db, at, decl)
		const stored = holdsRow(decl, value, inherited) ? value : undefined
		const address = { nodeKey: decl.nodeKey, slot: decl.slot, path: decl.path }
		if (global.kind === "genre") {
			const { setGenreValue } = await import("$lib/server/pipelines/registrations/genreValues")
			await setGenreValue(db, global.targets, address, stored)
			return
		}
		// 🚧 R50: a pipeline no genre registers — its instance values.
		const { setInstanceValue } = await import("$lib/server/pipelines/registrations/instanceValues")
		await setInstanceValue(db, at.slug, address, stored)
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
		const global = await globalTarget(db, at, configId)
		if (global.kind === "genre") {
			const { setGenreValue } = await import("$lib/server/pipelines/registrations/genreValues")
			await setGenreValue(
				db,
				global.targets,
				{ nodeKey: decl.nodeKey, slot: decl.slot, path: decl.path },
				undefined
			)
			return
		}
		// 🚧 R50: a pipeline no genre registers — its instance values.
		const { setInstanceValue } = await import("$lib/server/pipelines/registrations/instanceValues")
		await setInstanceValue(db, at.slug, { nodeKey: decl.nodeKey, slot: decl.slot, path: decl.path }, undefined)
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
 * Reset a whole configuration — every deviation at once.
 *
 * The Changes view's "reset all", and it is a DELETE of the configuration's
 * rows rather than a loop of `clearOption` over the ones the panel happened to
 * be showing: a client-side loop would leave behind exactly the rows the viewer
 * could not see, which is the half a person means least to keep.
 *
 * ⚠ **It takes the references with it, and that is what "back to shipped"
 * means.** A `prompts` or `template` row has no declared default to fall back
 * to, so deleting it leaves the slot resolving through `world.ts`'s own floor —
 * the shipped prompt for the pool, the shipped layout for the variable — which
 * is the row `ensureDefaultConfig` would have selected on a fresh install.
 * That floor is why this is a reset and not an erasure, and it is also why this
 * is the one write in this file that cannot be expressed as "set it to the
 * declared value": there is no declared value to set.
 *
 * Refuses an immutable config on the same terms every other write does. The
 * shipped default has nothing to reset — it *is* the reset — and offering the
 * verb there would read as a way to empty it.
 *
 * Returns how many rows went, so the caller can tell "reset" from "there was
 * nothing to reset".
 */
export async function resetConfig(
	db: Db,
	slug: string,
	viewer: Viewer,
	configId?: number
): Promise<number> {
	const at = await published(db, slug)
	if (!at)
		throw new OptionNotFoundError(
			`There is no published pipeline called '${slug}'.`
		)

	// The same decision `writeOption` makes, asked with no declaration in hand:
	// authoring a configuration is the admin's, always — this is not something a
	// person does to their own session, because a configuration is not theirs
	// (R8). `resolveWriteScope` answers per SLOT and there is no slot here, so
	// the check is the one thing every slot's config branch has in common.
	if (!viewer.isAdmin)
		throw new OptionNotWritableError(
			"Only an administrator edits a configuration. Your own changes are " +
				"made inside a session."
		)

	const global = await globalTarget(db, at, configId)
	if (global.kind === "genre") {
		const { resetGenreValues } = await import("$lib/server/pipelines/registrations/genreValues")
		return await resetGenreValues(db, global.targets)
	}
	// 🚧 R50: a pipeline no genre registers — its instance values.
	const { resetInstanceValues } = await import("$lib/server/pipelines/registrations/instanceValues")
	return await resetInstanceValues(db, at.slug)
}
