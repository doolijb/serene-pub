/**
 * The two rebinding seams (19 §3, §5), as writes and as a load-time step.
 *
 * **Function bindings** — "same key, several contributors → the binding
 * selects": a scope's choice of which spec serves a function. The rows are
 * only ever a choice among the eligible; `resolveFunctionSpec` re-checks
 * eligibility when it reads them, so the setter here validates for the
 * person's benefit (a refusal now beats a silent fall-through later) without
 * being the safety.
 *
 * **Node rebinds** — "the session scope may swap it": a scope's substitution of
 * which type fills a node position, applied to the loaded document just
 * before a run. The guard is shape compatibility — the substitute must
 * publish the same `main` shape as the pinned type, which is the swap-list
 * membership rule enforced where it matters. A rebind that fails the guard
 * degrades to the pinned type; a run never fails because a swap went stale.
 *
 * Reset-is-delete throughout: clearing a binding deletes its row and the
 * scope inherits again. There is no "bound to nothing" state.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	listGenreTriggers,
	listSpeakerStrategies,
	resolveFunctionSpec
} from "$lib/server/pipelines/entities/sessionGenres"

type Db = { select: any; insert: any; update: any; delete: any }

/**
 * The two scopes left (ruled 2026-08-24): the session's own row, else the
 * instance's. The user layer is gone from bindings and rebinds alike.
 */
export type ScopeAddress = { kind: "instance" | "session"; id: number }

/* --- function bindings (19 §3) ----------------------------------------- */

/**
 * Bind a function to a spec at a scope, or clear it (`specSlug: null`).
 *
 * Validates that the spec currently serves the function — the same
 * candidates `resolveFunctionSpec` computes — so a person binding through
 * the UI hears "that spec does not serve narrate for this mode" now rather
 * than watching the default win later.
 */
export async function bindFunction(
	db: Db,
	opts: {
		scope: ScopeAddress
		genreId: string
		functionKey: string
		specSlug: string | null
		userId: number
	}
): Promise<{ error?: string }> {
	const { scope, genreId, functionKey, specSlug, userId } = opts

	const where = and(
		eq(schema.pipelineFunctionBindings.scopeKind, scope.kind),
		eq(schema.pipelineFunctionBindings.scopeId, scope.id),
		eq(schema.pipelineFunctionBindings.genreId, genreId),
		eq(schema.pipelineFunctionBindings.functionKey, functionKey)
	)

	if (specSlug == null) {
		await db.delete(schema.pipelineFunctionBindings).where(where)
		return {}
	}

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
		.limit(1)
	if (!spec) return { error: `No pipeline is named '${specSlug}'.` }

	// Eligibility: bind only among what serves. Resolution re-checks this on
	// every read; the setter checks it so the refusal happens where the
	// person is.
	const serves = await functionCandidates(db, genreId, functionKey)
	if (!serves.includes(specSlug))
		return {
			error: `'${specSlug}' does not serve '${functionKey}' for this mode.`
		}

	const existing = (await db
		.select()
		.from(schema.pipelineFunctionBindings)
		.where(where)
		.limit(1)) as any[]
	if (existing.length) {
		await db
			.update(schema.pipelineFunctionBindings)
			.set({ specId: spec.id, updatedBy: userId, updatedAt: new Date() })
			.where(eq(schema.pipelineFunctionBindings.id, existing[0].id))
	} else {
		await db.insert(schema.pipelineFunctionBindings).values({
			scopeKind: scope.kind,
			scopeId: scope.id,
			genreId,
			functionKey,
			specId: spec.id,
			updatedBy: userId
		})
	}
	return {}
}

/**
 * Every spec currently serving a function for a mode — the picker behind
 * `bindFunction`'s eligibility rule, and the same candidate set
 * `resolveFunctionSpec` selects among.
 *
 * Computed by asking the resolver's own machinery rather than restating it:
 * for `respond` the bucket, otherwise the contributors (the trigger list
 * carries exactly the specs whose active version declares the key).
 */
export async function functionCandidates(
	db: Db,
	genreId: string,
	functionKey: string
): Promise<string[]> {
	if (functionKey === "respond") {
		// The bucket, via the resolver run once per spec is wasteful — the
		// trigger list cannot answer this one, so ask the bucket directly.
		const [bareType, versionStr] = genreId.split("@")
		const specs = await db.select().from(schema.pipelineSpecs)
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.status, "published"))
		const out: string[] = []
		for (const s of specs as any[]) {
			if (s.activeVersionId == null) continue
			const v = (versions as any[]).find(
				(x) => x.id === s.activeVersionId
			)
			if (!v) continue
			const nodes = await db
				.select()
				.from(schema.pipelineNodes)
				.where(eq(schema.pipelineNodes.specVersionId, v.id))
			const entry = (nodes as any[]).sort(
				(a, b) => a.position - b.position
			)[0]
			if (
				entry &&
				entry.typeId === bareType &&
				String(entry.typeVersion) === versionStr
			)
				out.push(s.slug)
		}
		return out
	}
	const triggers = await listGenreTriggers(db, genreId)
	return [
		...new Set(
			triggers
				.filter((t) => t.function === functionKey)
				.map((t) => t.specSlug)
		)
	]
}

/* --- node rebinds (19 §5) ----------------------------------------------- */

/**
 * Set or clear (`typeId: null`) a node-type rebind at a scope.
 *
 * The write-side guard mirrors the load-side one: the substitute must be a
 * live registry row publishing the same `main` shape as the node's pinned
 * type. Checked here so the person hears the refusal; checked again at load
 * so a row that went stale afterwards degrades instead of mis-wiring.
 */
export async function setNodeRebind(
	db: Db,
	opts: {
		scope: ScopeAddress
		specSlug: string
		nodeKey: string
		typeId: string | null
		userId: number
	}
): Promise<{ error?: string }> {
	const { scope, specSlug, nodeKey, typeId, userId } = opts

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
		.limit(1)
	if (!spec) return { error: `No pipeline is named '${specSlug}'.` }

	const where = and(
		eq(schema.pipelineNodeRebinds.specId, spec.id),
		eq(schema.pipelineNodeRebinds.scopeKind, scope.kind),
		eq(schema.pipelineNodeRebinds.scopeId, scope.id),
		eq(schema.pipelineNodeRebinds.nodeKey, nodeKey)
	)

	if (typeId == null) {
		await db.delete(schema.pipelineNodeRebinds).where(where)
		return {}
	}

	// The pinned type at this position, from the active published version.
	if (spec.activeVersionId == null)
		return { error: `'${specSlug}' has no published version to rebind.` }
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId))
	const node = (nodes as any[]).find((n) => n.nodeKey === nodeKey)
	if (!node) return { error: `'${specSlug}' has no node named '${nodeKey}'.` }

	const pinnedId = `${node.typeId}@${node.typeVersion}`
	const compatible = await shapeCompatible(db, pinnedId, typeId)
	if (!compatible)
		return {
			error: `'${typeId}' does not publish the same shape as '${pinnedId}' — the swap would mis-wire everything downstream.`
		}

	const existing = (await db
		.select()
		.from(schema.pipelineNodeRebinds)
		.where(where)
		.limit(1)) as any[]
	if (existing.length) {
		await db
			.update(schema.pipelineNodeRebinds)
			.set({ typeId, updatedBy: userId, updatedAt: new Date() })
			.where(eq(schema.pipelineNodeRebinds.id, existing[0].id))
	} else {
		await db.insert(schema.pipelineNodeRebinds).values({
			specId: spec.id,
			scopeKind: scope.kind,
			scopeId: scope.id,
			nodeKey,
			typeId,
			updatedBy: userId
		})
	}
	return {}
}

/** Both live, and their `main` out shapes equal — the swap-list rule. */
async function shapeCompatible(
	db: Db,
	pinnedId: string,
	substituteId: string
): Promise<boolean> {
	const row = async (pin: string) => {
		const [bare, version] = pin.split("@")
		const rows = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.typeId, bare!))
		return (rows as any[]).find(
			(r) => String(r.version) === version && r.status === "live"
		)
	}
	const [pinned, substitute] = await Promise.all([
		row(pinnedId),
		row(substituteId)
	])
	if (!pinned || !substitute) return false
	const main = (r: any) => r.ports?.out?.main
	return main(pinned) != null && main(pinned) === main(substitute)
}

/**
 * Apply a scope's node rebinds to a loaded document — the load-time step.
 *
 * Consulted session > instance per node key; the winning row's type pin
 * replaces the document's, config carried as-is (the shape guard means the
 * ports agree; a strategy has no slots to disagree about). Returns the same
 * document object — `loadPublished` builds it fresh from rows per run, so
 * mutating the copy is safe by construction.
 */
export async function applyNodeRebinds(
	db: Db,
	doc: any,
	opts: { specSlug: string; sessionId?: number | null }
): Promise<any> {
	try {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, opts.specSlug))
			.limit(1)
		if (!spec) return doc
		const rows = (await db
			.select()
			.from(schema.pipelineNodeRebinds)
			.where(eq(schema.pipelineNodeRebinds.specId, spec.id))) as any[]
		if (!rows.length) return doc

		const addresses: ScopeAddress[] = [
			...(opts.sessionId != null
				? [{ kind: "session", id: opts.sessionId } as ScopeAddress]
				: []),
			{ kind: "instance", id: 0 }
		]

		for (const node of doc.nodes ?? []) {
			let winner: any = null
			for (const addr of addresses) {
				winner = rows.find(
					(r) =>
						r.nodeKey === node.key &&
						r.scopeKind === addr.kind &&
						r.scopeId === addr.id
				)
				if (winner) break
			}
			if (!winner) continue

			const pinnedId = `${node.typeId}@${node.typeVersion}`
			if (winner.typeId === pinnedId) continue
			// The load-side guard: a rebind that went stale (type retired,
			// re-projected away, never this shape) degrades to the pin.
			if (!(await shapeCompatible(db, pinnedId, winner.typeId))) continue

			const [bare, version] = String(winner.typeId).split("@")
			node.typeId = bare
			node.typeVersion = Number(version)
		}
		return doc
	} catch {
		return doc
	}
}

/* --- the speaker swap, named (19 §5) ------------------------------------ */

/**
 * The strategy swap as a person meets it: which strategy runs this session's
 * next-speaker node. A thin, named wrapper over the generic rebind — the
 * speaker node is found by its published shape, not by a hardcoded key, so
 * a respond spec that renames the node keeps the control working.
 */
export async function setSessionSpeakerStrategy(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		/** A strategy type pin from `listSpeakerStrategies`, or null to inherit. */
		typeId: string | null
	}
): Promise<{ error?: string }> {
	// Which spec serves respond for this session — the strategy lives in it.
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, opts.sessionId))
		.limit(1)
	if (!session) return { error: "That session no longer exists." }
	const specSlug = await resolveFunctionSpec(
		db as any,
		session.genreId ?? "core:genre/chat",
		"respond",
		{ sessionId: opts.sessionId }
	)
	if (!specSlug)
		return { error: "No pipeline serves this session's replies to rebind." }

	const nodeKey = await speakerNodeKey(db, specSlug)
	if (!nodeKey)
		return {
			error: `'${specSlug}' has no next-speaker node — nothing to swap.`
		}

	if (opts.typeId != null) {
		const strategies = await listSpeakerStrategies(db as any)
		if (!strategies.some((s) => s.typeId === opts.typeId))
			return {
				error: `'${opts.typeId}' is not a next-speaker strategy this build registers.`
			}
	}

	return await setNodeRebind(db, {
		scope: { kind: "session", id: opts.sessionId },
		specSlug,
		nodeKey,
		typeId: opts.typeId,
		userId: opts.userId
	})
}

/** The session's rebound strategy pin, or null when it inherits the spec's. */
export async function getSessionSpeakerStrategy(
	db: Db,
	sessionId: number
): Promise<string | null> {
	try {
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session) return null
		const specSlug = await resolveFunctionSpec(
			db as any,
			session.genreId ?? "core:genre/chat",
			"respond",
			{ sessionId }
		)
		if (!specSlug) return null
		const nodeKey = await speakerNodeKey(db, specSlug)
		if (!nodeKey) return null
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specSlug))
			.limit(1)
		const [row] = await db
			.select()
			.from(schema.pipelineNodeRebinds)
			.where(
				and(
					eq(schema.pipelineNodeRebinds.specId, spec.id),
					eq(schema.pipelineNodeRebinds.scopeKind, "session"),
					eq(schema.pipelineNodeRebinds.scopeId, sessionId),
					eq(schema.pipelineNodeRebinds.nodeKey, nodeKey)
				)
			)
			.limit(1)
		return row?.typeId ?? null
	} catch {
		return null
	}
}

/** The node whose pinned type publishes `speaker-selection@1` on `main`. */
async function speakerNodeKey(
	db: Db,
	specSlug: string
): Promise<string | null> {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
		.limit(1)
	if (!spec || spec.activeVersionId == null) return null
	const nodes = await db
		.select()
		.from(schema.pipelineNodes)
		.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId))
	for (const n of nodes as any[]) {
		const rows = await db
			.select()
			.from(schema.pipelineTypeRegistry)
			.where(eq(schema.pipelineTypeRegistry.typeId, n.typeId))
		const row = (rows as any[]).find(
			(r) => String(r.version) === String(n.typeVersion)
		)
		if (row?.ports?.out?.main === "core:shape/speaker-selection@1")
			return n.nodeKey
	}
	return null
}
