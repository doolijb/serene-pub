/**
 * The two rebinding seams (19 §3, §5), as writes and as a load-time step.
 *
 * **Bindings** — "several serve → the binding selects": a scope's choice of
 * which spec serves a **subject** — an action identity or a core event id
 * (plans/31 V2). The rows are only ever a choice among the eligible;
 * `resolveSubjectVerdict` re-checks eligibility when it reads them, so the
 * setter here validates for the person's benefit (a refusal now beats a
 * silent fall-through later) without being the safety.
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

import { and, asc, eq, inArray } from "drizzle-orm"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import { i18nText, isEventId, sessionEvents, type EnabledWhen, type NodeSwap } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { answersEvent } from "$lib/server/pipelines/entities/presetBindings"
import { parseActionIdentity } from "$lib/shared/actions/identity"
import {
	listGenreActions,
	resolveSubjectSpec
} from "$lib/server/pipelines/entities/sessionGenres"

/**
 * The two scopes left (ruled 2026-08-24): the session's own row, else the
 * pub's. The user layer is gone from bindings and rebinds alike.
 */
export type ScopeAddress = { kind: "pub" | "session"; id: number }

/* --- bindings (19 §3; plans/31 V2) -------------------------------------- */

/**
 * Bind a subject — an action identity `<spec slug>#<key>` or a core event
 * id `core:event/…@1` — to a spec at a scope, or clear it (`specSlug: null`).
 *
 * Validates that the spec currently serves the subject — the same
 * candidates `resolveSubjectVerdict` computes — so a person binding through
 * the UI hears "that spec does not serve it for this genre" now rather than
 * watching the default win later. Nothing bare is accepted: a subject that is
 * neither grammar is refused by name.
 */
export async function bindSubject(
	db: Db,
	opts: {
		scope: ScopeAddress
		genreId: string
		subject: string
		specSlug: string | null
		userId: number
		/**
		 * The session's enabled-when override for the action (R-15; U5e),
		 * riding the same row: a predicate list to set, `null` to clear,
		 * absent to leave as it is. Session scope only — a pub-scope
		 * row never carries one. Validated by the caller with the SDK's
		 * `enabledWhenFindings`; stored in list form.
		 */
		enabledWhen?: EnabledWhen[] | null
	}
): Promise<{ error?: string }> {
	const { scope, genreId, subject, specSlug, userId } = opts
	if (!isEventId(subject) && !parseActionIdentity(subject))
		return {
			error:
				`'${subject}' is not something a binding is about — an action's identity ` +
				`('<spec slug>#<key>') or a core event id ('core:event/message-respond@1').`
		}
	const enabledWhen =
		scope.kind === "session" && opts.enabledWhen !== undefined
			? { enabledWhen: opts.enabledWhen }
			: {}

	const where = and(
		eq(schema.pipelineBindings.scopeKind, scope.kind),
		eq(schema.pipelineBindings.scopeId, scope.id),
		eq(schema.pipelineBindings.genreId, genreId),
		eq(schema.pipelineBindings.subject, subject)
	)

	if (specSlug == null) {
		await db.delete(schema.pipelineBindings).where(where)
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
	const serves = await subjectCandidates(db, genreId, subject)
	if (!serves.includes(specSlug))
		return {
			error: `'${specSlug}' does not serve '${subject}' for this genre.`
		}

	const existing = await db
		.select()
		.from(schema.pipelineBindings)
		.where(where)
		.limit(1)
	if (existing.length) {
		await db
			.update(schema.pipelineBindings)
			.set({ specId: spec.id, updatedBy: userId, updatedAt: new Date(), ...enabledWhen })
			.where(eq(schema.pipelineBindings.id, existing[0].id))
	} else {
		await db.insert(schema.pipelineBindings).values({
			scopeKind: scope.kind,
			scopeId: scope.id,
			genreId,
			subject,
			specId: spec.id,
			updatedBy: userId,
			...enabledWhen
		})
	}
	return {}
}

/**
 * Every spec currently serving a subject for a genre — the picker behind
 * `bindSubject`'s eligibility rule, and the same candidate set
 * `resolveSubjectVerdict` selects among.
 *
 * Computed by asking the resolver's own machinery rather than restating it:
 * for an event the bucket (the input lock, plus the primary write for the
 * primary turn), for an action identity its declarer — the action list
 * carries exactly the specs whose active version declares the key.
 */
export async function subjectCandidates(
	db: Db,
	genreId: string,
	subject: string
): Promise<string[]> {
	if (isEventId(subject)) {
		const primary = subject === sessionEvents.messageRespond
		const [bareType, versionStr] = genreId.split("@")
		const isGenreId = versionStr === undefined
		const specs = await db.select().from(schema.pipelineSpecs)
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.status, "published"))
		const out: string[] = []
		for (const s of specs) {
			if (s.activeVersionId == null) continue
			const v = versions.find((x) => x.id === s.activeVersionId)
			if (!v) continue
			const nodes = await db
				.select()
				.from(schema.pipelineNodes)
				.where(eq(schema.pipelineNodes.specVersionId, v.id))
			if (isGenreId) {
				if (
					(v as any).inputGenre !== genreId ||
					!answersEvent(v as any, subject)
				)
					continue
			} else {
				if (!primary) continue
				const entry = nodes
					.filter((n) => n.kind === "inlet")
					.sort((a, b) => a.position - b.position)[0]
				if (
					!entry ||
					entry.definitionId !== bareType ||
					String(entry.definitionVersion) !== versionStr
				)
					continue
			}
			if (
				primary &&
				!nodes.some(
					(n) => n.kind === "outlet" && n.definitionId === "core:outlet/create-message"
				)
			)
				continue
			out.push(s.slug)
		}
		return out
	}
	const identity = parseActionIdentity(subject)
	if (!identity) return []
	const actions = await listGenreActions(db, genreId)
	return [
		...new Set(
			actions
				.filter((t) => t.specSlug === identity.specSlug && t.key === identity.key)
				.map((t) => t.specSlug)
		)
	]
}

/* --- node rebinds (19 §5) ----------------------------------------------- */

/**
 * Set or clear (`definitionId: null`) a node-type rebind at a scope.
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
		definitionId: string | null
		userId: number
	}
): Promise<{ error?: string }> {
	const { scope, specSlug, nodeKey, definitionId, userId } = opts

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

	if (definitionId == null) {
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
	const node = nodes.find((n) => n.nodeKey === nodeKey)
	if (!node) return { error: `'${specSlug}' has no node named '${nodeKey}'.` }

	const pinnedId = `${node.definitionId}@${node.definitionVersion}`
	const compatible = await shapeCompatible(db, pinnedId, definitionId)
	if (!compatible)
		return {
			error: `'${definitionId}' does not publish the same shape as '${pinnedId}' — the swap would mis-wire everything downstream.`
		}

	const existing = await db
		.select()
		.from(schema.pipelineNodeRebinds)
		.where(where)
		.limit(1)
	if (existing.length) {
		await db
			.update(schema.pipelineNodeRebinds)
			.set({ definitionId, updatedBy: userId, updatedAt: new Date() })
			.where(eq(schema.pipelineNodeRebinds.id, existing[0].id))
	} else {
		await db.insert(schema.pipelineNodeRebinds).values({
			specId: spec.id,
			scopeKind: scope.kind,
			scopeId: scope.id,
			nodeKey,
			definitionId,
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
			.from(schema.pipelineDefinitionRegistry)
			.where(eq(schema.pipelineDefinitionRegistry.definitionId, bare!))
		return rows.find(
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
 * May `candidateId` stand in for a node pinned to `pinnedId` in the spec
 * `specSlug`? The one rule every door asks — the session picker's listing,
 * the run's rebind (session or pub scope) — so none can offer or apply
 * what another refuses:
 *
 *  - **R53**: a node that uses a connection takes only core's stand-ins —
 *    a plugin's code never touches connection data or calls a model;
 *  - **R62**: a plugin's private node runs only in its own package's
 *    pipelines, so it stands in only there.
 *
 * Core's definitions are public to all. Reads the registry rows, never a
 * manifest, so what decides is what this pub installed.
 */
export async function mayStandIn(
	db: Db,
	specSlug: string,
	pinnedId: string,
	candidateId: string
): Promise<boolean> {
	if (candidateId === pinnedId) return true
	const [pinDef, pinVer] = pinnedId.split("@")
	const [candDef, candVer] = candidateId.split("@")
	const rows = await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			slots: schema.pipelineDefinitionRegistry.slots,
			isPublic: schema.pipelineDefinitionRegistry.isPublic,
			ownerPluginId: schema.pipelineDefinitionRegistry.ownerPluginId
		})
		.from(schema.pipelineDefinitionRegistry)
		.where(inArray(schema.pipelineDefinitionRegistry.definitionId, [pinDef!, candDef!]))
	const pin = rows.find((r) => r.definitionId === pinDef && r.version === Number(pinVer))
	const cand = rows.find((r) => r.definitionId === candDef && r.version === Number(candVer))
	if (!cand) return false
	const usesConnection = Object.values((pin?.slots ?? {}) as Record<string, { kind?: unknown }>).some(
		(slot) => slot?.kind === "connection"
	)
	// Core's by namespace, not by a missing owner: an unowned plugin row is a
	// node nothing can run, never core's.
	const isCore = cand.definitionId.startsWith("core:")
	if (usesConnection && !isCore) return false
	if (isCore || cand.isPublic) return true
	if (cand.ownerPluginId == null) return false
	const [spec] = await db
		.select({ sourcePluginId: schema.pipelineSpecs.sourcePluginId })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
		.limit(1)
	return spec?.sourcePluginId === cand.ownerPluginId
}

/**
 * Apply a scope's node rebinds to a loaded document — the load-time step.
 *
 * Consulted session > pub per node key; the winning row's type pin
 * replaces the document's, config carried as-is (the shape guard means the
 * ports agree; a strategy has no slots to disagree about). Returns the same
 * document object — `loadPublished` builds it fresh from rows per run, so
 * mutating the copy is safe by construction.
 *
 * `swaps`, when given, is filled with every node a rebind actually replaced
 * — the pin it displaced and the scope that chose it — for the executor to
 * record on that node's receipt row (`RunOptions.swaps`, F2). A rebind that
 * degraded to the pin, or that names the pin, is not a swap and is not
 * reported.
 */
export async function applyNodeRebinds(
	db: Db,
	doc: any,
	opts: {
		specSlug: string
		sessionId?: number | null
		swaps?: Record<string, NodeSwap>
	}
): Promise<any> {
	try {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, opts.specSlug))
			.limit(1)
		if (!spec) return doc
		const rows = await db
			.select()
			.from(schema.pipelineNodeRebinds)
			.where(eq(schema.pipelineNodeRebinds.specId, spec.id))
		if (!rows.length) return doc

		const addresses: ScopeAddress[] = [
			...(opts.sessionId != null
				? [{ kind: "session", id: opts.sessionId } as ScopeAddress]
				: []),
			{ kind: "pub", id: 0 }
		]

		for (const node of doc.nodes ?? []) {
			let winner: any = null
			for (const addr of addresses) {
				const candidate = rows.find(
					(r) =>
						r.nodeKey === node.key &&
						r.scopeKind === addr.kind &&
						r.scopeId === addr.id
				)
				if (!candidate) continue
				// A session's choice holds only while it is still offered
				// (R28, R29; M2 review): an admin disabling a contribution, a
				// plugin switched off, or an author dropping a swap withdraws
				// it from every session that picked it, not just from new
				// picks. The session's row stays (the person's choice, visible
				// and clearable); it simply stops winning.
				if (addr.kind === "session" && spec.activeVersionId != null) {
					const offered = await listSessionNodeSwaps(db, {
						spec: opts.specSlug,
						nodeKey: node.key,
						specVersionId: spec.activeVersionId
					})
					if (!offered.some((o) => o.definitionId === candidate.definitionId)) continue
				}
				winner = candidate
				break
			}
			if (!winner) continue

			const pinnedId = `${node.definitionId}@${node.definitionVersion}`
			if (winner.definitionId === pinnedId) continue
			// The load-side guard: a rebind that went stale (type retired,
			// re-projected away, never this shape) degrades to the pin.
			if (!(await shapeCompatible(db, pinnedId, winner.definitionId))) continue
			// …and so does one R53 or R62 forbids, at any scope — a pub
			// row included, which the listing never sees.
			if (!(await mayStandIn(db, opts.specSlug, pinnedId, winner.definitionId))) continue

			const [bare, version] = String(winner.definitionId).split("@")
			node.definitionId = bare
			node.definitionVersion = Number(version)
			if (opts.swaps)
				opts.swaps[node.key] = {
					pin: pinnedId,
					by: winner.scopeKind === "session" ? "session" : "pub"
				}
		}
		return doc
	} catch {
		return doc
	}
}

/* --- session-scope swaps (PLAN-turn-order R28, R29) ---------------------- */

/**
 * The session-settings mark of one node on a published version (§4.11,
 * R28), read off `pipeline_nodes.expose` — the same row for a plugin's spec
 * as for core's, so there is no core-only path (R26). `null` = the node is
 * not in session settings.
 */
async function exposeOf(
	db: Db,
	specVersionId: number,
	nodeKey: string
): Promise<{ definitionId: string; expose: { session?: boolean; swaps?: string[] } | null } | null> {
	const [node] = await db
		.select({
			definitionId: schema.pipelineNodes.definitionId,
			definitionVersion: schema.pipelineNodes.definitionVersion,
			expose: schema.pipelineNodes.expose
		})
		.from(schema.pipelineNodes)
		.where(
			and(
				eq(schema.pipelineNodes.specVersionId, specVersionId),
				eq(schema.pipelineNodes.nodeKey, nodeKey)
			)
		)
		.limit(1)
	if (!node) return null
	return {
		definitionId: `${node.definitionId}@${node.definitionVersion}`,
		expose: node.expose ?? null
	}
}

/**
 * Rebind a node at **session scope** (PLAN-turn-order §4.7) — the one verb
 * for every swappable node; the Turn order control is one use of it.
 *
 * What it checks, in order: the spec is published and serves this session's
 * genre (a rebind on another genre's spec would never run — refused rather
 * than stored, R26); the node exists and is in session settings (`expose.session`; R28, M4 —
 * declaration is the only way in); and the definition is in the offered
 * list (`listSessionNodeSwaps`). `null` clears the rebind and the session
 * falls back to the pin.
 */
export async function setSessionNodeRebind(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		/** The spec slug the node belongs to. */
		spec: string
		nodeKey: string
		/** A definition id from the offered list, or null to inherit. */
		definitionId: string | null
	}
): Promise<{ error?: string }> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, opts.sessionId))
		.limit(1)
	if (!session) return { error: "That session no longer exists." }
	// The creation pipeline's swaps, like its settings, only mean something
	// while the session is being created (`CREATION_READ_ONLY_NOTE`).
	{
		const { sessionPipelines, CREATION_READ_ONLY_NOTE } = await import(
			"$lib/server/pipelines/entities/sessionPipelines"
		)
		const { pipelines } = await sessionPipelines(db, opts.sessionId, opts.userId)
		if (pipelines.find((p) => p.slug === opts.spec)?.creation === "created")
			return { error: `${CREATION_READ_ONLY_NOTE} Nothing was saved.` }
	}

	const [spec] = await db
		.select({
			id: schema.pipelineSpecs.id,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, opts.spec))
		.limit(1)
	if (!spec?.activeVersionId)
		return { error: `'${opts.spec}' is not a pipeline this pub publishes.` }
	const [version] = await db
		.select({
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents
		})
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
		.limit(1)
	if (version?.inputGenre && version.inputGenre !== session.genreId)
		return {
			error: `'${opts.spec}' serves '${version.inputGenre}', not this session's genre ('${session.genreId}').`
		}
	// …and is a pipeline this session actually runs: for some event its lock
	// answers, the session's own resolution picks this spec — the reply
	// through the reply path's resolver (pub binding and companion rule
	// included), any other event through the event dispatcher's. A swap on a
	// pipeline nothing runs here would be a choice with no effect, stored as
	// if it had one. An action's spec is the session's whenever its action is
	// offered, which its own listing decides — so a lock that names the action
	// passes whatever its other events resolve to (the spec runs through the
	// action either way). A spec with no lock at all is run by nothing and
	// refused.
	if (opts.definitionId != null) {
		const events = [
			...new Set(
				[
					version?.inputEvent,
					...(Array.isArray(version?.inputEvents) ? (version!.inputEvents as string[]) : [])
				].filter((e): e is string => typeof e === "string" && !!e)
			)
		]
		const { sessionEvents } = await import("@serene-pub/sdk")
		const actionLocked = events.includes(sessionEvents.sessionAction)
		const judged = events.filter((e) => e !== sessionEvents.sessionAction)
		if (!events.length)
			return {
				error: `'${opts.spec}' is not a pipeline this session runs — it answers no event.`
			}
		if (!actionLocked) {
			const { resolveSessionEventSpec } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			const { resolveSubjectSpec } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			let runs = false
			for (const event of judged) {
				const chosen =
					event === sessionEvents.messageRespond
						? await resolveSubjectSpec(db, session.genreId, event, {
								sessionId: opts.sessionId
							})
						: await resolveSessionEventSpec(db, session.genreId, event, {
								sessionId: opts.sessionId
							})
				if (chosen === opts.spec) {
					runs = true
					break
				}
			}
			if (!runs)
				return {
					error: `'${opts.spec}' is not a pipeline this session runs — its preset, its genre and its own choices bind another for ${judged.join(", ")}.`
				}
		}
	}

	const node = await exposeOf(db, spec.activeVersionId, opts.nodeKey)
	if (!node) return { error: `'${opts.spec}' has no node '${opts.nodeKey}' to swap.` }
	// Clearing is always allowed (reset-is-delete): a rebind left from before
	// a node stopped offering swaps must stay removable (M2 review). A node
	// in session settings is swappable to what it offers (M4): its declared
	// swaps and any enabled contribution.
	if (opts.definitionId != null && !node.expose?.session)
		return {
			error: `'${opts.nodeKey}' is not a node a session may swap — the pipeline does not offer it.`
		}

	if (opts.definitionId != null) {
		const offered = await listSessionNodeSwaps(db, {
			spec: opts.spec,
			nodeKey: opts.nodeKey,
			specVersionId: spec.activeVersionId
		})
		if (!offered.some((o) => o.definitionId === opts.definitionId))
			return {
				error: `'${opts.definitionId}' is not offered for '${opts.nodeKey}' on '${opts.spec}'.`
			}
	}

	return await setNodeRebind(db, {
		scope: { kind: "session", id: opts.sessionId },
		specSlug: opts.spec,
		nodeKey: opts.nodeKey,
		definitionId: opts.definitionId,
		userId: opts.userId
	})
}

/**
 * What a session may swap one node to (§4.7's `sessions:nodeSwapOptions`,
 * R28, R29), in the order a picker lists them: the **pin** first (it is the
 * default), then the node's declared `expose.swaps`, then the swaps enabled
 * plugins contribute to this spec and node, in install order, minus the ones
 * an admin switched off (`plugins.disabled_swaps`). Only live definitions
 * are offered. A node that declares no swaps offers nothing — never a shape
 * match, which is the admin panel's pub-scope list, not a session's.
 */
export async function listSessionNodeSwaps(
	db: Db,
	opts: {
		spec: string
		nodeKey: string
		specVersionId: number
	}
): Promise<Array<{ definitionId: string; name: string }>> {
	const node = await exposeOf(db, opts.specVersionId, opts.nodeKey)
	// A node in session settings accepts contributions even when it lists
	// no swaps of its own (M4: the model path's `advise` oracle has no core
	// alternative, and a plugin's must still reach it). A picker is only
	// worth drawing when this list has more than the pin.
	if (!node?.expose?.session) return []

	const contributed: string[] = []
	const plugins = await db
		.select({
			pluginId: schema.plugins.pluginId,
			manifest: schema.plugins.manifest,
			disabledSwaps: schema.plugins.disabledSwaps
		})
		.from(schema.plugins)
		.where(and(eq(schema.plugins.enabled, true), notCoreRow()))
		.orderBy(asc(schema.plugins.id))
	for (const p of plugins) {
		const swaps = ((p.manifest as { swaps?: unknown })?.swaps ?? []) as Array<{
			spec?: string
			node?: string
			definition?: string
		}>
		for (const c of Array.isArray(swaps) ? swaps : []) {
			if (c?.spec !== opts.spec || c.node !== opts.nodeKey || !c.definition) continue
			if ((p.disabledSwaps ?? []).includes(swapKey(c.spec, c.node, c.definition))) continue
			contributed.push(c.definition)
		}
	}

	const rows = await db
		.select({
			definitionId: schema.pipelineDefinitionRegistry.definitionId,
			version: schema.pipelineDefinitionRegistry.version,
			status: schema.pipelineDefinitionRegistry.status,
			i18n: schema.pipelineDefinitionRegistry.i18n
		})
		.from(schema.pipelineDefinitionRegistry)
	// Every candidate — the node's own `expose.swaps` and every contribution —
	// passes the one rule the run applies (`mayStandIn`: R53, R62), so the
	// picker never offers what a turn would refuse.
	const candidates = [...new Set([...(node.expose.swaps ?? []), ...contributed])]
	const allowed: string[] = []
	for (const id of candidates)
		if (await mayStandIn(db, opts.spec, node.definitionId, id)) allowed.push(id)
	const ids = [...new Set([node.definitionId, ...allowed])]
	const live = new Map(
		(rows as any[])
			.filter((r) => r.status === "live")
			.map((r) => [`${r.definitionId}@${r.version}`, i18nText(r.i18n?.name) || r.definitionId])
	)
	return ids
		.filter((id) => live.has(id))
		.map((id) => ({ definitionId: id, name: live.get(id)! }))
}

/** The key an admin's `plugins.disabled_swaps` entry is: `<spec>#<node>#<definition>`. */
export const swapKey = (spec: string, node: string, definition: string) =>
	`${spec}#${node}#${definition}`


/**
 * The session form's **pipeline cards** (PLAN-turn-order §4.11): for every
 * pipeline this session actually runs — each event its genre lists,
 * resolved the way a turn resolves it — the nodes the pipeline marks
 * `expose: { session: true }` that offer more than their pin. Each card is a
 * swap picker over `listSessionNodeSwaps`, with the session's choice.
 *
 * ⏳ A node that offers only its pin would get param controls instead
 * (§4.11); none is exposed that way yet, so none is listed.
 */
export async function listSessionPipelineCards(
	db: Db,
	sessionId: number
): Promise<
	Array<{
		spec: string
		specName: string
		nodeKey: string
		options: Array<{ definitionId: string; name: string }>
		selected: string | null
		default: string | null
	}>
> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session?.genreId) return []
	const { getSessionGenre, resolveSubjectSpec } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const { resolveSessionEventSpec } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	const { sessionEvents } = await import("@serene-pub/sdk")
	const genre = await getSessionGenre(db, session.genreId)
	const specs = new Set<string>()
	for (const event of Object.keys(genre?.events ?? {})) {
		if (event === sessionEvents.sessionAction) continue
		const slug =
			event === sessionEvents.messageRespond
				? await resolveSubjectSpec(db, session.genreId, event, { sessionId })
				: await resolveSessionEventSpec(db, session.genreId, event, { sessionId })
		if (slug) specs.add(slug)
	}

	const out: Awaited<ReturnType<typeof listSessionPipelineCards>> = []
	if (!specs.size) return out
	// Three reads for every pipeline at once — the specs, their exposed
	// nodes, the session's choices — rather than three per pipeline.
	const specRows = await db
		.select({
			id: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			name: schema.pipelineSpecs.name,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)
		.where(inArray(schema.pipelineSpecs.slug, [...specs]))
	const live = specRows.filter((r) => r.activeVersionId != null)
	if (!live.length) return out
	const nodeRows = await db
		.select({
			specVersionId: schema.pipelineNodes.specVersionId,
			nodeKey: schema.pipelineNodes.nodeKey,
			definitionId: schema.pipelineNodes.definitionId,
			definitionVersion: schema.pipelineNodes.definitionVersion,
			expose: schema.pipelineNodes.expose
		})
		.from(schema.pipelineNodes)
		.where(inArray(schema.pipelineNodes.specVersionId, live.map((r) => r.activeVersionId!)))
	const rebinds = await db
		.select({
			specId: schema.pipelineNodeRebinds.specId,
			nodeKey: schema.pipelineNodeRebinds.nodeKey,
			definitionId: schema.pipelineNodeRebinds.definitionId
		})
		.from(schema.pipelineNodeRebinds)
		.where(
			and(
				inArray(schema.pipelineNodeRebinds.specId, live.map((r) => r.id)),
				eq(schema.pipelineNodeRebinds.scopeKind, "session"),
				eq(schema.pipelineNodeRebinds.scopeId, sessionId)
			)
		)
	const chosen = new Map(rebinds.map((r) => [`${r.specId}#${r.nodeKey}`, r.definitionId]))

	for (const spec of live.sort((x, y) => x.slug.localeCompare(y.slug))) {
		for (const n of nodeRows) {
			if (n.specVersionId !== spec.activeVersionId) continue
			if (!(n.expose as { session?: boolean } | null)?.session) continue
			const options = await listSessionNodeSwaps(db, {
				spec: spec.slug,
				nodeKey: n.nodeKey,
				specVersionId: spec.activeVersionId!
			})
			if (options.length < 2) continue
			out.push({
				spec: spec.slug,
				specName: spec.name ?? spec.slug,
				nodeKey: n.nodeKey,
				options,
				selected: chosen.get(`${spec.id}#${n.nodeKey}`) ?? null,
				default: `${n.definitionId}@${n.definitionVersion}`
			})
		}
	}
	return out
}
