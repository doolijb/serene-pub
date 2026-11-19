/**
 * The session's genre, function and pipeline handlers: modes and genre,
 * the ruleset upgrade and conversion, the rebinding seams (candidates, bind,
 * node swaps, pipeline cards), actions and their busy door, functions, and
 * the session preset.
 */

import { randomUUID } from "node:crypto"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { withSessionActionsChain } from "$lib/server/sessions/actionsPush"
import { and, desc, eq } from "drizzle-orm"
import { sessionGenreOf } from "$lib/server/sessions/annexFields"
import { StateRefusal } from "$lib/server/state/write"
import type { Handler } from "$lib/shared/events"
import type { RunProgress } from "$lib/shared/sockets/progress"
import type { SessionFunction } from "$lib/server/pipelines/entities/sessionGenres"
import type { RewindState } from "$lib/shared/sessions/rewind"
import {
	haltExplanationFor,
	receiptHaltFor,
	haltStepShownTo
} from "$lib/server/pipelines/runtime/haltExplanation"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { writeGenreFields, writeRigour } from "$lib/server/sessions/settingsWrite"
import { withSessionGenerationLock } from "$lib/server/utils/sessionGenerationLock"
import {
	relistSessions,
	noteSocketInteraction,
	pushSessionToParticipants
} from "./sessions.shared"

/**
 * 🚧 M2c/M2d: an applet genre's launcher card — what `/apps/<pluginId>` shows (title, poster, logo, blurb) —
 * read through the launcher's own test (`appletMount`), so the Apps row is listed exactly when the launcher
 * mounts. Null for any other genre.
 */
async function appletCardFor(g: {
	genreId: string
	name: string
	shape?: unknown
}): Promise<import("$lib/server/plugins/appletMount").AppletCard | null> {
	const shape = g.shape as { applet?: boolean; view?: string } | undefined
	if (shape?.applet !== true || typeof shape.view !== "string") return null
	const { pluginsEnabled } = await import("$lib/server/plugins/flag")
	if (!pluginsEnabled()) return null
	const { notCoreRow } = await import("$lib/server/plugins/frameHost")
	const { appletMount, appletCardOf } = await import("$lib/server/plugins/appletMount")
	const [row] = await db
		.select({
			enabled: schema.plugins.enabled,
			name: schema.plugins.name,
			version: schema.plugins.version,
			manifest: schema.plugins.manifest,
			adminDenied: schema.plugins.adminDenied
		})
		.from(schema.plugins)
		.where(and(eq(schema.plugins.pluginId, shape.view), notCoreRow()))
		.limit(1)
	const mount = appletMount(shape.view, row, [{ genreId: g.genreId, name: g.name, shape }])
	return mount ? appletCardOf(mount) : null
}

/**
 * One offered genre as the session form reads it (`sessions:genres`,
 * `sessions:genreOf`): the genre row plus its Rules / How strict offer and its
 * declared scene boundary triggers.
 */
async function genreRowFor(
	g: Awaited<
		ReturnType<
			typeof import("$lib/server/pipelines/entities/sessionGenres").listOfferedGenres
		>
	>[number]
): Promise<Sockets.Sessions.Genres.Response["genres"][number]> {
	const { genreBoundaryTriggers } = await import("$lib/server/scenes/liveScenes")
	const { i18nText, getGenre, getRuleset } = await import("@serene-pub/sdk")
	const { pickableRulesets } = await import("$lib/server/rulesets/pubRulesets")
	const { genreRulesOffer } = await import("$lib/server/rulesets/genreOffer")
	const { withRigoursPlayed } = await import("$lib/shared/rulesets/rulesOffer")
	// 🚧 Rules that decide nothing play Words only (2026-10-18): each choice says so.
	const { rulesetDecides } = await import("$lib/server/rulesets/methods")
	const decides = (id: string) => rulesetDecides(getRuleset(id))
	const declared = await genreBoundaryTriggers(db, g.genreId).catch(() => [])
	// 🚧 M2c/M2d: an applet genre carries its launcher's card for the Sessions view's Apps row.
	const appletCard = await appletCardFor(g)
	const offer = genreRulesOffer(getGenre(g.genreId) as any, pickableRulesets())
	const rules = offer ? withRigoursPlayed(offer, decides) : null
	return {
		...g,
		...(rules ? { rules } : {}),
		...(appletCard ? { appletCard } : {}),
		...(declared.length
			? {
					sceneBoundaryTriggers: declared.map((t) => ({
						key: t.key,
						label: i18nText(t.label) ?? t.key
					}))
				}
			: {})
	} as any
}

/**
 * The mode picker's one SELECT (19 §2), shape included so the session form can
 * gate its capability sections. On the F29 floor — a registry that never
 * synced — this returns an empty list and the form treats that as "standard
 * only, hide the picker": the mode system failing must never block sessionting.
 */
export const sessionsModesHandler: Handler<
	Sockets.Sessions.Genres.Params,
	Sockets.Sessions.Genres.Response
> = {
	event: "sessions:genres",
	handler: async (socket, _params, emitToUser) => {
		const { listOfferedGenres } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const genres = await listOfferedGenres(db)
		const res: Sockets.Sessions.Genres.Response = {
			// 🚧 Each genre's declared boundary triggers (live scenes ★9, §15
			// G1) beside its shape: its summarize-scene spec's, which the
			// session settings' Scenes list as switches. Absent when none.
			// 🚧 And its Rules / How strict offer (PLAN-rulesets §4, §21),
			// absent for a genre that offers no choice (Chat).
			genres: await Promise.all(genres.map(genreRowFor))
		}
		emitToUser("sessions:genres", res)
		return res
	}
}

/**
 * 🚧 pr-6 (B §B-2): the one genre row a session runs, built by the same row
 * builder `sessions:genres` uses. Null when the asker has no access or the
 * session's genre is not among the offered genres.
 */
export const sessionsGenreOfHandler: Handler<
	Sockets.Sessions.GenreOf.Params,
	Sockets.Sessions.GenreOf.Response
> = {
	event: "sessions:genreOf",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const access = Number.isInteger(sessionId)
			? await checkSessionAccess(sessionId, userId)
			: { hasAccess: false }
		let genre: Sockets.Sessions.GenreOf.Response["genre"] = null
		if (access.hasAccess) {
			const { listOfferedGenres } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const genreId = await sessionGenreOf(db, sessionId)
			const g = (await listOfferedGenres(db)).find((x) => x.genreId === genreId)
			genre = g ? await genreRowFor(g) : null
		}
		const res: Sockets.Sessions.GenreOf.Response = { sessionId, genre }
		emitToUser("sessions:genreOf", res)
		return res
	}
}

/**
 * Upgrade a session's mode along its own type (19 §6, ruled 2026-08-23).
 * Owner-only; cross-type swaps and downgrades refuse in the entity's
 * sentences, and the target's shape is validated like creation's.
 */
export const sessionsUpgradeModeHandler: Handler<
	Sockets.Sessions.UpgradeGenre.Params,
	Sockets.Sessions.UpgradeGenre.Response
> = {
	event: "sessions:upgradeGenre",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const base = { sessionId: params.sessionId, genreId: params.genreId }
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess || !access.isOwner) {
			const res = { ...base, error: "Session not found." }
			emitToUser("sessions:upgradeGenre", res)
			return res
		}
		const { upgradeSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { error } = await upgradeSessionGenre(
			db,
			params.sessionId,
			params.genreId
		)
		const res: Sockets.Sessions.UpgradeGenre.Response = error
			? { ...base, error }
			: base
		emitToUser("sessions:upgradeGenre", res)
		if (!error) await relistSessions(socket, emitToUser)
		return res
	}
}

/**
 * 🚧 Move a session's rules to the published version of their ruleset (M0,
 * lane T4): owner-only, one transaction, the event after the commit.
 * A refusal is `{ id, error }`.
 */
export const sessionsConvertRulesetHandler: Handler<
	Sockets.Sessions.ConvertRuleset.Params,
	Sockets.Sessions.ConvertRuleset.Response
> = {
	event: "sessions:convertRuleset",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const base = { id: params.id }
		const access = await checkSessionAccess(params.id, userId)
		if (!access.hasAccess || !access.isOwner) {
			const res = { ...base, error: "Only the session's owner can change its rules." }
			emitToUser("sessions:convertRuleset", res)
			return res
		}
		try {
			const { convertSessionRuleset } = await import("$lib/server/sessions/convertRuleset")
			const converted = await convertSessionRuleset(db, { sessionId: params.id, to: params.to, userId })
			const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
			await emitSessionEvent(db, {
				sessionId: params.id,
				userId,
				event: "core:event/ruleset-converted@1",
				payload: {
					sessionId: params.id,
					rulesetId: converted.rulesetId,
					from: converted.from,
					to: converted.to,
					slots: converted.slots,
					cause: { kind: "edit", userId }
				},
				io: socket.io
			})
			await pushSessionToParticipants(socket.io, params.id, userId)
			const res: Sockets.Sessions.ConvertRuleset.Response = { ...base, rulesetVersion: converted.to }
			emitToUser("sessions:convertRuleset", res)
			return res
		} catch (e) {
			if (!(e instanceof StateRefusal)) throw e
			const res = { ...base, error: e.message }
			emitToUser("sessions:convertRuleset", res)
			return res
		}
	}
}

/* --- the rebinding seams (19 §3, §5) ------------------------------------ */

/** The picker's data: who serves a subject here, and who currently wins. */
export const sessionsFunctionCandidatesHandler: Handler<
	Sockets.Sessions.Bindings.Candidates.Params,
	Sockets.Sessions.Bindings.Candidates.Response
> = {
	event: "sessions:functionCandidates",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const res: Sockets.Sessions.Bindings.Candidates.Response = {
			sessionId: params.sessionId,
			subject: params.subject,
			candidates: [],
			resolved: null
		}
		if (access.hasAccess) {
			const { resolveSubjectSpec } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const genreId = await sessionGenreOf(db, params.sessionId)
			// A disabled plugin's pipelines are no choice to offer (R67).
			const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
			const off = await disabledPlugins(db)
			// 🚧 The pipelines registered on the subject in this session
			// (PLAN-layering D7) — what its preset offers and what its own
			// rows add. Choosing among them is the preset's (R33).
			const { effectiveRegistrations } = await import(
				"$lib/server/pipelines/registrations/resolve"
			)
			const resolved = await effectiveRegistrations(db, params.sessionId)
			const onSubject = (r: { trigger: { family: string; event?: string; action?: string } }) =>
				(r.trigger.family === "event" && (r.trigger as { event: string }).event === params.subject) ||
				(r.trigger.family === "action" && (r.trigger as { action: string }).action === params.subject)
			res.candidates = [
				...new Set(
					[...(resolved?.offered ?? []), ...(resolved?.effective ?? [])]
						.filter(onSubject as never)
						.map((r) => r.pipeline)
				)
			].filter((c) => !off.ownsId(c))
			// Narrowed to what `sessions:bindFunction` would accept at session
			// scope (U5c review, S8): an action that is not enabled for this
			// session is not a choice the picker should offer and the bind
			// then refuse. An event subject keeps the candidate rule alone.
			const { parseActionIdentity } = await import("$lib/shared/actions/identity")
			const identity = parseActionIdentity(params.subject)
			if (identity) {
				const { listSessionFunctions } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const declared = (
					await listSessionFunctions(db, params.sessionId, genreId, userId)
				).filter((f) => f.specSlug === identity.specSlug && f.key === identity.key)
				const bindable = new Set(declared.filter((f) => f.enabled).map((f) => f.specSlug))
				res.candidates = res.candidates.filter((c) => bindable.has(c))
			}
			// The verdict's slug: a preset binding the instance cannot
			// resolve falls back rather than refusing (ruled 2026-09-10), and the
			// picker must show what actually wins.
			res.resolved = await resolveSubjectSpec(db, genreId, params.subject, {
				sessionId: params.sessionId
			})
		}
		emitToUser("sessions:functionCandidates", res)
		return res
	}
}

/**
 * Bind a subject among its eligible servers (19 §3; plans/31 V2). Session
 * scope needs the session's owner; instance scope needs an administrator —
 * the same tier line as everything else (§26a).
 */
export const sessionsBindFunctionHandler: Handler<
	Sockets.Sessions.Bindings.BindFunction.Params,
	Sockets.Sessions.Bindings.BindFunction.Response
> = {
	event: "sessions:bindFunction",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const base = { sessionId: params.sessionId, subject: params.subject }
		const fail = (error: string) => {
			const res = { ...base, error }
			emitToUser("sessions:bindFunction", res)
			return res
		}
		const scopeKind = params.scope ?? "session"
		// 🚧 Pub-level bindings are retired (R33): an administrator changes
		// the genre's defaults or a preset instead.
		if (scopeKind === "pub")
			return fail(
				"Pub-wide bindings are retired: change the genre's defaults or a preset instead."
			)
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess || !access.isOwner)
			return fail("Session not found.")

		const { parseActionIdentity } = await import("$lib/shared/actions/identity")
		const genreId = await sessionGenreOf(db, params.sessionId)
		const identity = parseActionIdentity(params.subject)

		/**
		 * 🚧 Retired as a binding (PLAN-layering D7, R33, R34): what runs on
		 * an event is the session's registrations — its preset's changes on
		 * the genre's defaults — and a session does not rebind an event. What
		 * stays is the action's **enabled-when override** (U5e), written as
		 * the session's registration row's `when` (R31).
		 */
		if (!identity && params.enabledWhen !== undefined)
			return fail("An enabled-when override is an action's — a turn's event has no button to grey.")
		if (!identity) {
			const { isEventId } = await import("@serene-pub/sdk")
			return fail(
				isEventId(params.subject)
					? "A session no longer rebinds an event: what answers it is the session's preset. " +
							"Pick another preset, or ask an administrator to change this one."
					: `'${params.subject}' is not something a binding is about — name an action by its identity ('<spec slug>#<key>').`
			)
		}
		const { listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const own = (
			await listSessionFunctions(db, params.sessionId, genreId, userId)
		).filter((f) => f.specSlug === identity.specSlug && f.key === identity.key)
		if (!own.length)
			return fail(`'${params.subject}' is not offered to this session's genre.`)
		if (params.specSlug != null && own[0]!.specSlug !== params.specSlug)
			return fail(
				`'${params.specSlug}' does not serve '${params.subject}' — an action is served by its declarer.`
			)
		if (params.specSlug != null && !own[0]!.enabled)
			return fail(
				`'${own[0]!.name}' from '${params.specSlug}' is not enabled for this session — ` +
					`a session chooses among what its preset includes. Ask an administrator ` +
					`to include it, or turn it on under Actions.`
			)

		let enabledWhen: import("@serene-pub/sdk").EnabledWhen[] | null | undefined
		if (params.enabledWhen !== undefined) {
			if (params.enabledWhen !== null && params.specSlug == null)
				return fail(
					"An enabled-when override rides the session's binding — name the spec to bind, or clear the binding to drop the override with it."
				)
			if (params.enabledWhen === null) enabledWhen = null
			else {
				const { enabledWhenFindings, normalizeEnabledWhen } = await import(
					"@serene-pub/sdk"
				)
				const findings = enabledWhenFindings(params.enabledWhen, "enabledWhen")
				if (findings.length) return fail(findings.join("; "))
				enabledWhen = normalizeEnabledWhen(params.enabledWhen)
			}
		} else if (params.specSlug == null) enabledWhen = null

		if (enabledWhen !== undefined) {
			const { setSessionActionWhen } = await import(
				"$lib/server/pipelines/registrations/sessionRows"
			)
			await setSessionActionWhen(db, params.sessionId, params.subject, enabledWhen, socket.user!.isAdmin ? "admin" : "owner")
		}
		emitToUser("sessions:bindFunction", base)
		return base
	}
}

/** The swap list plus the session's current choice (19 §5). */
/**
 * What a session may swap one exposed node to (PLAN-turn-order §4.7) —
 * the generic replacement for `sessions:speakerStrategies`.
 *
 * Generic because there was never anything turn-order-shaped about the
 * question. A spec marks a node `expose: { session: true }` (§4.11) and
 * this answers what that node may become; the Turn order control is the
 * first caller and will not be the last.
 */
export const sessionsNodeSwapOptionsHandler: Handler<
	Sockets.Sessions.Bindings.NodeSwapOptions.Params,
	Sockets.Sessions.Bindings.NodeSwapOptions.Response
> = {
	event: "sessions:nodeSwapOptions",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const empty: Sockets.Sessions.Bindings.NodeSwapOptions.Response = {
			sessionId: params.sessionId,
			spec: params.spec,
			nodeKey: params.nodeKey,
			options: [],
			selected: null,
			default: null
		}
		try {
			const access = await checkSessionAccess(params.sessionId, userId)
			if (!access.hasAccess) {
				emitToUser("sessions:nodeSwapOptions", empty)
				return empty
			}
			const sessionGenreId = await sessionGenreOf(db, params.sessionId)
			const [spec] = await db
				.select({
					id: schema.pipelineSpecs.id,
					activeVersionId: schema.pipelineSpecs.activeVersionId
				})
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, params.spec))
				.limit(1)
			if (!spec?.activeVersionId) {
				emitToUser("sessions:nodeSwapOptions", empty)
				return empty
			}
			// The same genre rule the setter enforces (M2 review): a spec that
			// serves another genre offers this session nothing, rather than a
			// list whose every pick would be refused.
			const [version] = await db
				.select({ inputGenre: schema.pipelineSpecVersions.inputGenre })
				.from(schema.pipelineSpecVersions)
				.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
				.limit(1)
			if (version?.inputGenre && version.inputGenre !== sessionGenreId) {
				emitToUser("sessions:nodeSwapOptions", empty)
				return empty
			}
			const { listSessionNodeSwaps } = await import(
				"$lib/server/pipelines/entities/bindings"
			)
			const options = await listSessionNodeSwaps(db, {
				spec: params.spec,
				nodeKey: params.nodeKey,
				specVersionId: spec.activeVersionId
			})
			// What is in force, and what it falls back to: the session's
			// rebind, and the node's own pin. Both, because a control that
			// showed only the effective value could not say "inherited".
			const [rebind] = await db
				.select({ definitionId: schema.pipelineNodeRebinds.definitionId })
				.from(schema.pipelineNodeRebinds)
				.where(
					and(
						eq(schema.pipelineNodeRebinds.specId, spec.id),
						eq(schema.pipelineNodeRebinds.scopeKind, "session"),
						eq(schema.pipelineNodeRebinds.scopeId, params.sessionId),
						eq(schema.pipelineNodeRebinds.nodeKey, params.nodeKey)
					)
				)
				.limit(1)
			const [pin] = await db
				.select({
					definitionId: schema.pipelineNodes.definitionId,
					definitionVersion: schema.pipelineNodes.definitionVersion
				})
				.from(schema.pipelineNodes)
				.where(
					and(
						eq(
							schema.pipelineNodes.specVersionId,
							spec.activeVersionId
						),
						eq(schema.pipelineNodes.nodeKey, params.nodeKey)
					)
				)
				.limit(1)
			const res: Sockets.Sessions.Bindings.NodeSwapOptions.Response = {
				sessionId: params.sessionId,
				spec: params.spec,
				nodeKey: params.nodeKey,
				options,
				selected: rebind?.definitionId ?? null,
				default: pin
					? `${pin.definitionId}@${pin.definitionVersion}`
					: null
			}
			emitToUser("sessions:nodeSwapOptions", res)
			return res
		} catch (error) {
			console.error("Error in sessionsNodeSwapOptionsHandler:", error)
			emitToUser("sessions:nodeSwapOptions", empty)
			return empty
		}
	}
}

/**
 * The session form's pipeline cards (PLAN-turn-order §4.11): every node the
 * pipelines this session runs expose to it, with what each may become and
 * what the session chose. The owner's; a guest, administrators included, gets
 * none (G1, 2026-11-16). Only the owner may change a card
 * (`sessions:setNodeRebind`).
 */
export const sessionsPipelineCardsHandler: Handler<
	Sockets.Sessions.Bindings.PipelineCards.Params,
	Sockets.Sessions.Bindings.PipelineCards.Response
> = {
	event: "sessions:pipelineCards",
	handler: async (socket, params, emitToUser) => {
		const res: Sockets.Sessions.Bindings.PipelineCards.Response = {
			sessionId: params.sessionId,
			cards: []
		}
		const access = await checkSessionAccess(params.sessionId, socket.user!.id)
		if (access.hasAccess && access.isOwner) {
			const { listSessionPipelineCards } = await import(
				"$lib/server/pipelines/entities/bindings"
			)
			res.cards = await listSessionPipelineCards(db, params.sessionId)
		}
		emitToUser("sessions:pipelineCards", res)
		return res
	}
}

/**
 * Rebind one exposed node at session scope (§4.7) — the generic
 * replacement for `sessions:setSpeakerStrategy`. Owner only: a session's
 * pipeline shape is the owner's, as every other session setting is.
 */
export const sessionsSetNodeRebindHandler: Handler<
	Sockets.Sessions.Bindings.SetNodeRebind.Params,
	Sockets.Sessions.Bindings.SetNodeRebind.Response
> = {
	event: "sessions:setNodeRebind",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const reply = (
			res: Sockets.Sessions.Bindings.SetNodeRebind.Response
		): Sockets.Sessions.Bindings.SetNodeRebind.Response => {
			emitToUser("sessions:setNodeRebind", res)
			return res
		}
		try {
			const access = await checkSessionAccess(params.sessionId, userId)
			if (!access.hasAccess || !access.isOwner)
				return reply({
					sessionId: params.sessionId,
					spec: params.spec,
					nodeKey: params.nodeKey,
					error: "Access denied. Only the session owner can change this."
				})
			const { setSessionNodeRebind } = await import(
				"$lib/server/pipelines/entities/bindings"
			)
			const out = await setSessionNodeRebind(db, {
				sessionId: params.sessionId,
				userId,
				spec: params.spec,
				nodeKey: params.nodeKey,
				definitionId: params.definitionId ?? null
			})
			if (out.error)
				return reply({
					sessionId: params.sessionId,
					spec: params.spec,
					nodeKey: params.nodeKey,
					error: out.error
				})
			const res = reply({
				sessionId: params.sessionId,
				spec: params.spec,
				nodeKey: params.nodeKey,
				definitionId: params.definitionId ?? null
			})
			// The options list carries `selected`, so the control re-renders
			// from the server's answer rather than from its own optimism.
			await sessionsPipelineCardsHandler.handler(
				socket,
				{ sessionId: params.sessionId },
				emitToUser
			)
			await sessionsNodeSwapOptionsHandler.handler(
				socket,
				{
					sessionId: params.sessionId,
					spec: params.spec,
					nodeKey: params.nodeKey
				},
				emitToUser
			)
			return res
		} catch (error) {
			console.error("Error in sessionsSetNodeRebindHandler:", error)
			return reply({
				sessionId: params.sessionId,
				spec: params.spec,
				nodeKey: params.nodeKey,
				error: "Failed to change this setting."
			})
		}
	}
}

export const sessionsFireActionHandler: Handler<
	Sockets.Sessions.FireAction.Params,
	Sockets.Sessions.FireAction.Response
> = {
	event: "sessions:fireAction",
	handler: async (socket, params, emitToUser) => {
		/**
		 * 🚧 M2a a6: the run id the press named (`params.runId`), echoed on
		 * EVERY answer — a refusal before any run and a Stop included — so the
		 * asker matches its own press exactly (`Response.askedRunId`).
		 */
		const asked = typeof params.runId === "string" && params.runId ? { askedRunId: params.runId } : {}
		/**
		 * 🚧 **The busy door** (2026-10-30): a session-level press (no form
		 * block, no message) made while a person's line is being ANSWERED is
		 * refused out loud, never queued behind it: waiting in the generation
		 * lock it made no run row and said nothing. The answer window is the
		 * whole of it (ruled 2026-10-30): from the line's acceptance — its
		 * `message-completed` on the session's event chain, where the
		 * turn-order recompute and the auto-advance fire run — until the reply
		 * run ends. Read from what already exists: a registered reply run; or,
		 * while the session's event chain is still deciding
		 * (`sessionEventsPending`) after a person's line (the newest live
		 * row), the door waits for that decision — bounded, as
		 * `settleBackgroundRuns` waits for a Regenerate — and refuses once a
		 * reply run starts, lets the press through once the chain empties
		 * with none (auto-advance off, nobody due). A press's own settling
		 * children and a run parked at review keep the session pressable (no
		 * person's line is waiting). The press
		 * still walks every door of `fireAction` (its own `enabledWhen` reason
		 * wins), then is refused with core's busy sentence; nothing is
		 * retried. A form's answer and a press on a message keep their place
		 * in the queue, as before.
		 */
		const answering = async (sessionId: number, ms = 8000): Promise<boolean> => {
			const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
			const { sessionEventsPending } = await import("$lib/server/pipelines/runtime/sessionEvents")
			const { liveMessageWhere } = await import("$lib/server/messages/store")
			const replying = () => runRegistry.active().some((h) => h.sessionId === sessionId && h.kind === "reply")
			if (replying()) return true
			if (!sessionEventsPending(sessionId)) return false
			const [newest] = await db
				.select({ role: schema.sessionMessages.role })
				.from(schema.sessionMessages)
				.where(and(eq(schema.sessionMessages.sessionId, sessionId), liveMessageWhere()))
				.orderBy(desc(schema.sessionMessages.id))
				.limit(1)
			if (newest?.role !== "user") return false
			// A person's line, its turn order still being decided: wait for the decision.
			const end = Date.now() + ms
			for (;;) {
				if (replying()) return true
				if (!sessionEventsPending(sessionId)) return false
				if (Date.now() > end) return true
				await new Promise((r) => setTimeout(r, 150))
			}
		}
		if (!params.blockId && params.messageId == null) {
			if (await answering(params.sessionId)) {
				const userId = socket.user!.id
				const access = await checkSessionAccess(params.sessionId, userId)
				if (access.hasAccess) {
					const { REWIND_STRIP_REASONS } = await import("@serene-pub/core-catalog/conversation")
					const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
					const outcome = await fireAction(db, {
						sessionId: params.sessionId,
						action: params.action ?? undefined,
						key: params.key ?? undefined,
						payload: params.payload && typeof params.payload === "object" ? params.payload : undefined,
						...(typeof params.text === "string" ? { text: params.text } : {}),
						...(Array.isArray(params.recipients) ? { recipients: params.recipients } : {}),
						...(params.clockStep !== undefined ? { clockStep: params.clockStep } : {}),
						actor: { userId },
						fromPressDoor: true,
						busy: REWIND_STRIP_REASONS.generating
					})
					const res: Sockets.Sessions.FireAction.Response = {
						sessionId: params.sessionId,
						action: params.action ?? params.key ?? "",
						error: outcome.kind === "refused" ? outcome.error : REWIND_STRIP_REASONS.generating,
						...asked
					}
					emitToUser("sessions:fireAction", res)
					return res
				}
			}
		}
		return withSessionGenerationLock(params.sessionId, async () => {
			// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
			const access = await checkSessionAccess(params.sessionId, socket.user!.id)
			await noteSocketInteraction(access, params.sessionId, params.blockId ? "form" : "action")
			/** What the answer names: the identity when the press brought one, else the bare key it sent. */
			const named = params.action ?? params.key ?? ""
			/** The card's title — the action's key, the short word a person pressed. */
			const label = named.includes("#") ? named.slice(named.lastIndexOf("#") + 1) : named
			/**
			 * 🚧 The run is line-bound (speaking a line, `RunHandle.lineBound`):
			 * every progress frame says so and the card leaves it out — the
			 * line's own Speaking… and Stop show it. Learned at `onStarted`.
			 */
			let lineBound = false
			const fail = (
				error: string,
				/** The run whose terminal frame already said `error` (see `Response.runId`). */
				runId?: string,
				/** 🚧 M2a a6: the run halted on purpose (not an error): the answer says so, with the sentence as `reason`. */
				halted?: boolean
			): Sockets.Sessions.FireAction.Response => {
				const res = {
					sessionId: params.sessionId,
					action: named,
					error,
					...(runId ? { runId } : {}),
					...(halted ? { halted: true as const, reason: error } : {}),
					...asked
				}
				emitToUser("sessions:fireAction", res)
				return res
			}
			/**
			 * Stopped on request — a third answer, not a gentler `fail`.
			 *
			 * Deliberately carries no `error`. The sentence would be about
			 * whatever the abort broke on its way out, and a consumer that
			 * reads `error` first — the session view did, which is how a
			 * deliberate Cancel came back as a red toast — would render the
			 * cancel as a failure all over again. The actor rides instead,
			 * because a supersede, a person's cancel and an administrator's
			 * kill are three different events and only the actor tells them
			 * apart.
			 */
			const stoppedOnRequest = (
				by: string
			): Sockets.Sessions.FireAction.Response => {
				const res = {
					sessionId: params.sessionId,
					action: named,
					cancelled: true,
					cancelledBy: by,
					...asked
				}
				emitToUser("sessions:fireAction", res)
				return res
			}
			/**
			 * The run's terminal frame — never a bare `done: true` a card
			 * would read as success (R-19-adjacent: "Progress card says
			 * 'finished ✓' on an errored run"). Sent from wherever the run
			 * ended, so the client's card always clears.
			 */
			const finished = async (
				runId: string,
				outcome: NonNullable<RunProgress["outcome"]>,
				receipt?: import("@serene-pub/sdk").Receipt
			) => {
				let explanation: string | undefined
				/** The halted step goes to an administrator only, and never beside a people sentence (`haltStepShownTo`); everyone else reads the sentence alone. */
				if (outcome === "err" || outcome === "halt") {
					if (receipt) {
						const { haltExplanation } = await import(
							"$lib/server/pipelines/runtime/runTurn"
						)
						const said =
							haltExplanation(receipt) ?? "The run produced nothing."
						explanation = receiptHaltFor(socket.user, "action", receipt, said)
					} else explanation = "The run produced nothing."
				}
				// The step it halted at, by its heading (2026-10-16).
				const stepShown = !!receipt && haltStepShownTo(socket.user, receipt)
				const haltStep =
					outcome === "halt" && receipt?.haltNodeKey && stepShown
						? await (
								await import("$lib/server/pipelines/runtime/haltStep")
							).haltStepOf(db, receipt.specId, receipt.haltNodeKey)
						: null
				emitToUser("pipelines:progress", {
					runId,
					sessionId: params.sessionId,
					// Self-describing, like every other frame on this card: a
					// terminal frame read after the run was forgotten (the
					// reply road's `finally` says the same) titled the receipt
					// "Working" (2026-09-17).
					label,
					...(lineBound ? { lineBound: true as const } : {}),
					done: true,
					outcome,
					...(outcome === "cancelled" ? { cancelled: true } : {}),
					...(explanation !== undefined ? { error: explanation } : {}),
					...(outcome === "halt" && receipt?.haltNodeKey && stepShown
						? { haltNodeKey: receipt.haltNodeKey }
						: {}),
					...(haltStep ? { haltStep } : {})
				})
				/**
				 * 🚧 M2a a6: the run a press started has ended — told to every
				 * member's page, so the session's widget bus can say
				 * `run:ended` to the frames (the client half, widgetWire). The
				 * outcome in the receipt's words. The frame goes to every
				 * member, so its `reason` is the plain words, never the halt's
				 * own reason; the presser's own answer and card are unchanged.
				 */
				{
					const { broadcastToSessionUsers } = await import("$lib/server/sockets/utils/broadcastHelpers")
					await broadcastToSessionUsers(socket.io, params.sessionId, "sessions:runEnded", {
						sessionId: params.sessionId,
						runId,
						outcome,
						...(explanation !== undefined
							? { reason: haltExplanationFor(null, "action", explanation) }
							: {})
					} satisfies Sockets.Sessions.RunEnded.Frame).catch(() => {})
				}
				// The run moved the session's published values — at the
				// least, `session.generating` is false again — so every
				// member's action list is re-sent from here (U5e, review
				// C1): once per finished root, whichever way it ended, the
				// server deciding rather than a client guessing off frames.
				const { pushSessionActions } = await import(
					"$lib/server/sessions/actionsPush"
				)
				await pushSessionActions(socket.io, params.sessionId)
			}
			/**
			 * What a finished run gets — the terminal frame, the relist, the
			 * state announcement, the answer — whether it finished under this
			 * ack or, having parked, long after it (R-b). Returns the answer
			 * so the ack can carry it; the deferred caller only pushes it.
			 */
			const settle = async (
				outcome: Extract<
					import("$lib/server/pipelines/runtime/fireAction").FireActionOutcome,
					{ kind: "ran" | "stopped" }
				>
			): Promise<Sockets.Sessions.FireAction.Response> => {
				/**
				 * Cancellation is decided by the ABORT, not by the receipt
				 * (see `fireAction`): a stopped-and-also-errored run answers
				 * as cancelled, and says only that it was stopped — the
				 * client re-reads the session rather than assuming nothing
				 * happened.
				 */
				/**
				 * Whatever the run changed in the world is announced whichever
				 * way it ended (pass 3, parity with the reply road): a
				 * `set-state` that landed before a later node halted, or
				 * before a stop, is a write the story has, and a `set-state`
				 * node has no socket of its own — without this, an action
				 * whose whole output is a ledger line ("Rest", "Time passes")
				 * reads as a button that does nothing. After `finished`, so
				 * the list has gone out before a client relists on it.
				 */
				const announce = async (receipt: import("@serene-pub/sdk").Receipt | undefined) => {
					if (!receipt) return
					const { announceStateChanges } = await import(
						"$lib/server/state/announce"
					)
					await announceStateChanges(socket.io, params.sessionId, receipt)
				}
				if (outcome.kind === "stopped") {
					await finished(outcome.runId, "cancelled", outcome.receipt)
					await announce(outcome.receipt)
					return stoppedOnRequest(outcome.by)
				}
				const { receipt } = outcome
				await finished(outcome.runId, receipt.outcome, receipt)
				await announce(receipt)
				if (receipt.outcome !== "ok") {
					const { haltExplanation } = await import(
						"$lib/server/pipelines/runtime/runTurn"
					)
					// The same sentence `finished` just put on the run's
					// terminal frame, so the answer names that run: the
					// session's progress card has already said it, and the page
					// does not say it a second time (PLAN-less-confusing D4).
					return fail(
						receiptHaltFor(
							socket.user,
							"action",
							receipt,
							haltExplanation(receipt) ?? "The run produced nothing."
						),
						outcome.runId,
						receipt.outcome === "halt"
					)
				}

				// Whatever the spec's consumers wrote, the participants see it.
				await relistSessions(socket, emitToUser)
				const res: Sockets.Sessions.FireAction.Response = {
					sessionId: params.sessionId,
					action: named,
					success: true,
					// 🚧 M2a a6: the run the press started, matched by its `sessions:runEnded`.
					runId: outcome.runId,
					// A run under this one is waiting at a review gate: its
					// own row lands when the owner decides.
					...(outcome.parked?.length ? { parked: true } : {}),
					...asked
				}
				emitToUser("sessions:fireAction", res)
				return res
			}
			// Named by the client when it offered one, so Cancel works during
			// the window before the first progress event — which is exactly
			// when somebody realises the prompt was wrong.
			const runId = params.runId || randomUUID()
			let started = false
			// A manual Read aloud / Say it as… marks its line pending (as the
			// automatic path does) so it reads Speaking… with a Stop; cleared
			// when the run ends, whatever the outcome.
			let speechMark: Promise<boolean> | null = null
			const endSpeech = async () => {
				if (!speechMark || params.messageId == null) return
				const { endManualSpeech } = await import("$lib/server/speech/onMessageSettled")
				await speechMark.catch(() => false)
				await endManualSpeech(db, socket.io as never, params.sessionId, params.messageId, runId)
			}
			try {
				const userId = socket.user!.id
				const { fireAction } = await import(
					"$lib/server/pipelines/runtime/fireAction"
				)
				let lastProgress = 0
				const outcome = await fireAction(db, {
					sessionId: params.sessionId,
					action: params.action ?? undefined,
					key: params.key ?? undefined,
					messageId: params.messageId ?? undefined,
					blockId: params.blockId ?? undefined,
					payload:
						params.payload && typeof params.payload === "object"
							? params.payload
							: undefined,
					// What the press collected (lair pass R3): `fireAction`
					// hands each on only to an action declaring it collects it.
					...(typeof params.text === "string" ? { text: params.text } : {}),
					...(Array.isArray(params.recipients) ? { recipients: params.recipients } : {}),
					...(params.clockStep !== undefined ? { clockStep: params.clockStep } : {}),
					actor: { userId },
					fromPressDoor: true,
					runId,
					// So the status relay pushes `sessions:runStatus` and,
					// where the run has a live row, the row's own
					// `sessionMessage` frame — an action run announces
					// exactly like a reply does (R-19).
					io: socket.io,
					onStarted: (run) => {
						started = true
						if (run.lineBound) lineBound = true
						if (params.messageId != null)
							speechMark = import("$lib/server/speech/onMessageSettled").then((m) =>
								m.isSpeakRun(run.specId)
									? m.markManualSpeech(db, socket.io as never, params.sessionId, params.messageId!, run.runId)
									: false
							)
						emitToUser("pipelines:runStarted", {
							runId: run.runId,
							sessionId: params.sessionId,
							specId: run.specId,
							label,
							...(run.channel ? { channel: run.channel } : {}),
							...(lineBound ? { lineBound: true as const } : {})
						})
						// `session.generating` just rose (U5e, review W-A1):
						// every member's list follows, once per root — the
						// end push queues behind it on the same session.
						// Never awaited: a list build must not hold a run
						// (2026-10-19: awaiting it wedged the interview when
						// a press landed while the previous list was building).
						void import("$lib/server/sessions/actionsPush").then(
							({ pushSessionActions }) =>
								pushSessionActions(socket.io, params.sessionId, { starting: true })
						)
					},
					onProgress: (event) => {
						// Throttled where it carries a preview: a preview
						// frame is a whole image, so one per step would send
						// more to the browser than the finished render does.
						// A frame that only names a stage — a child run
						// starting (U5d review, S4) — is one line and always
						// sent, or the card would miss the tree being made.
						if (event.preview) {
							const now = Date.now()
							if (now - lastProgress < 250) return
							lastProgress = now
						}
						emitToUser("pipelines:progress", {
							...event,
							sessionId: params.sessionId,
							label,
							...(lineBound ? { lineBound: true as const } : {})
						})
					},
					// The run's status (R-19), onto the progress card's frame
					// — never throttled: a status is one line, and the one
					// that says *loading the model* is the one worth seeing.
					onStatus: (nodeKey, status, run) =>
						emitToUser("pipelines:progress", {
							runId: run.runId,
							sessionId: params.sessionId,
							specId: run.specId,
							label,
							nodeKey,
							status,
							...(lineBound ? { lineBound: true as const } : {})
						}),
					// The run parked and was released to us (R-b); this is
					// how it ends, delivered as pushes — the ack is long gone.
					// Outside the trigger lock, which the ack released.
					onSettled: (settled) => {
						void (async () => {
							try {
								if (settled.kind === "failed") {
									await finished(settled.runId, "err")
									console.error(
										"Error in sessionsFireActionHandler (after park):",
										settled.error
									)
									fail("Failed to run the function.")
								} else await settle(settled)
							} catch (error) {
								console.error(
									"Error settling a parked run in sessionsFireActionHandler:",
									error
								)
							}
						})()
					}
				})

				if (outcome.kind !== "parked") await endSpeech()
				if (outcome.kind === "refused") return fail(outcome.error)
				/**
				 * Parked at a review gate (R-b): the owner has the card, the
				 * run keeps its handle, and the answer is that it is waiting
				 * — no terminal frame yet, since it has not ended. The lock
				 * is released with this ack.
				 */
				if (outcome.kind === "parked") {
					const res: Sockets.Sessions.FireAction.Response = {
						sessionId: params.sessionId,
						action: named,
						parked: true,
						...asked
					}
					emitToUser("sessions:fireAction", res)
					return res
				}
				return await settle(outcome)
			} catch (error: any) {
				// A stopped run never arrives here: `fireAction` reads the
				// handle before it rethrows, and answers `stopped` for one.
				await endSpeech()
				if (started) await finished(runId, "err")
				console.error("Error in sessionsFireActionHandler:", error)
				return fail("Failed to run the function.")
			}
		})
	}
}

/**
 * The pipelines involved in a session, for the session's settings — one card
 * per pipeline (`sessionPipelines`), each rendered by the config panel at
 * session scope.
 */
export const sessionsPipelinesHandler: Handler<
	Sockets.Sessions.Pipelines.Params,
	Sockets.Sessions.Pipelines.Response
> = {
	event: "sessions:pipelines",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const res: Sockets.Sessions.Pipelines.Response = {
			sessionId: params.sessionId,
			pipelines: []
		}
		// D58 + G6 (2026-11-16): the owner's; a guest, administrators included, gets none.
		if (access.hasAccess && access.isOwner) {
			const { sessionPipelines } = await import(
				"$lib/server/pipelines/entities/sessionPipelines"
			)
			const { pipelines, fallbacks } = await sessionPipelines(
				db,
				params.sessionId,
				userId
			)
			res.pipelines = pipelines
			if (fallbacks.length) res.presetFallbacks = fallbacks
		}
		emitToUser("sessions:pipelines", res)
		return res
	}
}

/**
 * Is this session running what its preset says (ruled 2026-09-10)?
 *
 * The banner's one read. A binding that stopped resolving never refuses the
 * turn — the genre's default runs — so the only thing that stops the
 * substitution being invisible is somebody saying it where the session is, and
 * this is what they say it from.
 *
 * Every bound event is evaluated, not only the ones this session has fired: a
 * preset whose `session-created` slot is dead is still a preset running
 * something other than what it promises, and a person who has not branched a
 * session yet is exactly the person who has not found out.
 *
 * Not admin-gated, and deliberately: the *fact* belongs to whoever is in the
 * session. What differs by tier is the sentence the client writes from it —
 * an administrator gets the slug and a link to the preset, everybody else
 * gets "this session is running the default pipeline for <event>", because
 * only one of them can do anything about it.
 */
/**
 * 🚧 Switch a session to another of its genre's **session presets**, or back
 * to its own (PLAN-genre-restructure §3-5/§5-3, ruled 2026-10-19). The
 * person's own choices that a preset pins (`tasks`, `tools`) are cleared, so
 * the new preset's pins apply — "Custom" ends here. A pinned `rigour` is a
 * column and is written (only one the session's ruleset plays); the ruleset
 * stays the one the session started with. Owner only; the preset must be the
 * session's genre, enabled and not withdrawn.
 */
export const sessionsSetSessionPresetHandler: Handler<
	Sockets.Sessions.SetSessionPreset.Params,
	Sockets.Sessions.SetSessionPreset.Response
> = {
	event: "sessions:setSessionPreset",
	handler: async (socket, params, emitToUser) => {
		const reply = (res: Sockets.Sessions.SetSessionPreset.Response) => {
			emitToUser("sessions:setSessionPreset", res)
			return res
		}
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess || !access.isOwner)
			return reply({ sessionId: params.sessionId, error: "Only the session's owner can change its preset." })
		const [session] = await db
			.select({
				genreId: schema.sessions.genreId,
				primaryRuleset: schema.sessions.primaryRuleset
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)
		const [preset] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.id, params.presetId))
			.limit(1)
		if (!session || !preset || preset.genreId !== session.genreId)
			return reply({ sessionId: params.sessionId, error: "That preset is not one of this session's genre." })
		if (!preset.enabled || preset.withdrawnAt != null)
			return reply({ sessionId: params.sessionId, error: "That preset is not available." })
		const pins = (preset.settings ?? {}) as Record<string, unknown>
		/**
		 * A pinned How strict is a column and is written (PLAN-rulesets §21:
		 * changing it mid-session is allowed — the main session's ruling of
		 * 2026-10-20 keeps it over R32's gloss). Only one the session's rules
		 * can play: Rule Based over Freeform keeps Words only (a value the
		 * rules cannot play reads blank). The pin is read through
		 * `SettingValue` — Rule Based stores `{ value: 'scripts', lock: true }`.
		 * The ruleset itself stays the one the session started with; its own
		 * registration rows stay too: values of a pipeline the new preset does
		 * not run lie dormant and come back with it (A9).
		 */
		const { getGenre, getRuleset, settingValueOf } = await import("@serene-pub/sdk")
		const { rigoursPlayed } = await import("$lib/shared/rulesets/rulesOffer")
		const { rulesetDecides } = await import("$lib/server/rulesets/methods")
		const rigourOptions: readonly string[] = (getGenre(session.genreId) as any)?.rigour?.options ?? ["prose"]
		const played =
			rigoursPlayed(rulesetDecides(getRuleset(String(session.primaryRuleset ?? ""))), rigourOptions) ?? rigourOptions
		const pinned = pins.rigour !== undefined ? settingValueOf(pins.rigour as never).value : undefined
		const rigour =
			typeof pinned === "string" && rigourOptions.includes(pinned) && played.includes(pinned) ? pinned : undefined
		await db.transaction(async (tx) => {
			await tx.update(schema.sessions).set({ presetId: preset.id }).where(eq(schema.sessions.id, params.sessionId))
			await writeGenreFields(tx, params.sessionId, (cur) => {
				for (const k of ["tasks", "tools"]) delete cur[k]
				return cur
			})
			if (rigour) await writeRigour(tx, params.sessionId, rigour)
		})
		;(await import("$lib/server/pipelines/registrations/resolve")).invalidateRegistrations()
		// A session that gains the *Summarize finished scenes* routine has its stored
		// Summaries value converted at once.
		try {
			const { convertSummariesSetting } = await import("$lib/server/sessions/summariesToRoutine")
			await convertSummariesSetting(db, params.sessionId)
		} catch (err) {
			console.warn("[sessions:setSessionPreset] the Summaries setting was not converted:", err)
		}
		// 🚧 An owner's setting change is an interaction (R11, R21; lane 6).
		{
			const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
			await noteInteraction(db, params.sessionId, "setting")
		}
		const res = reply({ sessionId: params.sessionId, presetId: preset.id, presetName: preset.name })
		await pushSessionToParticipants(socket.io, params.sessionId, userId)
		// The page reads the scene cues once and relies on pushes: a preset that adds
		// or drops the routine changes which Summarize buttons it offers.
		{
			const { pushSceneCues } = await import("$lib/server/scenes/boundaryWatcher")
			await pushSceneCues(socket.io, params.sessionId)
		}
		return res
	}
}

export const sessionsPresetStatusHandler: Handler<
	Sockets.Sessions.PresetStatus.Params,
	Sockets.Sessions.PresetStatus.Response
> = {
	event: "sessions:presetStatus",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const res: Sockets.Sessions.PresetStatus.Response = {
			sessionId: params.sessionId,
			presetId: null,
			presetName: null,
			stale: []
		}
		if (access.hasAccess) {
			// 🚧 The registrations resolver's account (PLAN-layering D7): every
			// preset registration on an event this instance cannot resolve,
			// and what answers the event instead.
			const { effectiveRegistrations, onEvent } = await import(
				"$lib/server/pipelines/registrations/resolve"
			)
			const resolved = await effectiveRegistrations(db, params.sessionId)
			if (resolved?.presetId != null) {
				res.presetId = resolved.presetId
				res.presetName = resolved.presetName
				for (const f of resolved.fallbacks)
					res.stale.push({
						event: f.event,
						bound: f.bound,
						reason: f.reason,
						fallbackSpec: onEvent(resolved.effective, f.event)[0]?.pipeline ?? null
					})
			}
		}
		emitToUser("sessions:presetStatus", res)
		return res
	}
}

/** What one push reads once for every member: the genre's offer and the Back/Forward strip's state. */
type ActionsPerPush = {
	offered?: Promise<SessionFunction[] | undefined>
	rewind?: Promise<RewindState>
}

/**
 * The shared read `key` of one push: the first build to ask starts it and
 * stores its promise, a build that asks meanwhile waits on the same read. A
 * read that failed is dropped (if still the one held) so the next member
 * reads again; the failing member still gets the failure.
 */
function sharedRead<K extends keyof ActionsPerPush>(
	holder: ActionsPerPush,
	key: K,
	read: () => NonNullable<ActionsPerPush[K]>
): NonNullable<ActionsPerPush[K]> {
	const reading = (holder[key] ??= read()) as NonNullable<ActionsPerPush[K]>
	reading.catch(() => {
		if (holder[key] === reading) delete holder[key]
	})
	return reading
}

/**
 * The action list (plans/29 R-15; U5c): every venue's primary set and
 * overflow for one caller on one channel. Built as a thunk for the cascades
 * (`setFunction`), eagerly for the handler's own reply, and
 * by `pushSessionActions` (U5e) for every member when a run starts or ends
 * — one builder, so a push and a reply can never differ in shape.
 *
 * A non-member gets every venue empty rather than an error — the shape
 * describes what a person in the session can press, and a stranger can
 * press nothing.
 */
export async function buildSessionActions(
	sessionId: number,
	userId: number,
	channel: string | undefined,
	opts: {
		/**
		 * The caller already knows this user is a member — `pushSessionActions`
		 * reads the roster itself — so the access read is skipped. A socket
		 * request never says so.
		 */
		member?: boolean
		/** The push a run's start sends (W-A1): the list reads as generating, whatever the registry says a beat later. */
		starting?: boolean
		/** A push (never the page's own request) carries the Back/Forward strip's state too (★H1, 2026-11-04), so the title's words follow a reply that ended. */
		withRewind?: boolean
		/**
		 * One push's reads that do not depend on the member (`pushSessionActions`
		 * makes it per push): the first build to need one starts the read and
		 * stores its promise, the rest wait on the same read. Absent, the build
		 * reads for itself.
		 */
		perPush?: ActionsPerPush
	} = {}
): Promise<Sockets.Sessions.Actions.Response> {
	const access = opts.member
		? { hasAccess: true }
		: await checkSessionAccess(sessionId, userId)
	const { listSessionActions, formCollectsOf } = await import(
		"$lib/server/pipelines/entities/sessionActions"
	)
	const { STANDARD_GENRE_ID, listSessionFunctions } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const { LISTED_VENUE_KINDS } = await import("@serene-pub/sdk")
	const res: Sockets.Sessions.Actions.Response = {
		sessionId,
		channel: channel ?? "main",
		venues: Object.fromEntries(
			LISTED_VENUE_KINDS.map((k) => [k, { primary: [], overflow: [] }])
		)
	}
	if (!access.hasAccess) return res
	if (opts.withRewind) {
		const { rewindStateOf } = await import("$lib/server/sessions/rewind")
		const shared = opts.perPush
		if (shared) res.rewind = await sharedRead(shared, "rewind", () => rewindStateOf(db, sessionId))
		else res.rewind = await rewindStateOf(db, sessionId)
	}
	// The session's functions, read once for both reads below (and, in a
	// push, once for every member: they do not depend on the viewer).
	const readOffered = async () => {
		const [row] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row) return undefined
		return listSessionFunctions(
			db,
			sessionId,
			row.genreId ?? STANDARD_GENRE_ID,
			null
		)
	}
	const offered = opts.perPush
		? await sharedRead(opts.perPush, "offered", readOffered)
		: await readOffered()
	res.venues = (await listSessionActions(
		db,
		sessionId,
		{ userId },
		{
			channel,
			...(opts.starting ? { starting: true } : {}),
			...(offered ? { offered } : {})
		}
	)) as any
	// What a block press of a form-venue action collects (lair pass R9):
	// those actions are listed in no venue, so the collect modal reads here.
	const forms = await formCollectsOf(
		db,
		sessionId,
		{ userId },
		offered ? { offered } : {}
	)
	if (Object.keys(forms).length) res.formCollects = forms
	// 🚧 Where this viewer's Delete is refused (owner ruling ★9): the page
	// takes it off a kept turn's rows instead of offering it to refuse.
	const { turnDeleteRefusedThrough } = await import("$lib/server/messages/verbs")
	const kept = await turnDeleteRefusedThrough(db, sessionId, userId)
	if (kept) res.deleteRefusedThrough = kept
	return res
}

export const sessionsActionsHandler: Handler<
	Sockets.Sessions.Actions.Params,
	Sockets.Sessions.Actions.Response
> = {
	event: "sessions:actions",
	handler: async (socket, params, emitToUser) => {
		// Behind the session's push chain (U5e, pass 3): a request made
		// while a run is ending is answered after the end push, so a mount
		// mid-run cannot land a "generating" list on top of the fresh one.
		const res = await withSessionActionsChain(params.sessionId, () =>
			buildSessionActions(params.sessionId, socket.user!.id, params.channel)
		)
		emitToUser("sessions:actions", res)
		return res
	}
}

/**
 * The caller has met these actions: the *new* mark clears (U5c). Per user,
 * not per session — the mark is about the person, and `sessionId` only
 * rides so the reply lands where the list that showed the mark lives.
 */
export const sessionsActionsSeenHandler: Handler<
	Sockets.Sessions.ActionsSeen.Params,
	Sockets.Sessions.ActionsSeen.Response
> = {
	event: "sessions:actionsSeen",
	handler: async (socket, params, emitToUser) => {
		const { markActionsSeen } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		// Only what an identity looks like (S3): `<spec slug>#<key>`, ≤ 200
		// characters, at most 200 of them. Anything else is dropped rather
		// than stored — the set is "what this person has seen", not a sink
		// for whatever a client chooses to post.
		const { parseActionIdentity } = await import(
			"$lib/shared/actions/identity"
		)
		const keys = Array.isArray(params.keys)
			? params.keys
					.filter((k): k is string => parseActionIdentity(k) !== null)
					.slice(0, 200)
			: []
		const seen = await markActionsSeen(db, socket.user!.id, keys)
		const res = { sessionId: params.sessionId, seen }
		emitToUser("sessions:actionsSeen", res)
		return res
	}
}

/**
 * The genre's functions and their state on one session, for one caller.
 *
 * Split out like its siblings above: `sessions:setFunction` re-sends it, and
 * does not know whether the section that renders it is open.
 */
async function buildSessionFunctions(
	sessionId: number,
	caller: { userId: number; isAdmin: boolean }
): Promise<Sockets.Sessions.Functions.Response> {
	const access = await checkSessionAccess(sessionId, caller.userId)
	const { listSessionFunctions } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genreId = await sessionGenreOf(db, sessionId)

	const res: Sockets.Sessions.Functions.Response = {
		sessionId,
		genreId,
		functions: []
	}
	if (access.hasAccess && access.isOwner) {
		// A disabled plugin's actions are not listed (R67).
		const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
		const off = await disabledPlugins(db)
		res.functions = (
			await listSessionFunctions(db, sessionId, genreId, caller.userId)
		).filter((f) => !off.ownsId(f.specSlug)) as any
	}
	res.canAddOutsidePreset = caller.isAdmin
	return res
}

/**
 * The mode's functions and their state on this session (19 §3).
 *
 * Owner-only, matching `sessions:setFunction`: which functions a session has is part
 * of how it behaves, and a guest reading the list would be reading a control
 * they cannot use. A guest gets the empty list rather than an error — the
 * section simply is not theirs.
 */
export const sessionsFunctionsHandler: Handler<
	Sockets.Sessions.Functions.Params,
	Sockets.Sessions.Functions.Response
> = {
	event: "sessions:functions",
	handler: async (socket, params, emitToUser) => {
		const res = await buildSessionFunctions(params.sessionId, {
			userId: socket.user!.id,
			isAdmin: !!socket.user!.isAdmin
		})
		emitToUser("sessions:functions", res)
		return res
	}
}

/**
 * Turn one of the mode's functions on or off (19 §3).
 *
 * Owner-only: this changes what the session can do. The entity layer holds the
 * refusals — an unoffered function, a mode mismatch — so the answer is the
 * same whether it arrives here or through any later surface.
 */
export const sessionsSetFunctionHandler: Handler<
	Sockets.Sessions.SetFunction.Params,
	Sockets.Sessions.SetFunction.Response
> = {
	event: "sessions:setFunction",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const reply = (
			res: Sockets.Sessions.SetFunction.Response
		): Sockets.Sessions.SetFunction.Response => {
			emitToUser("sessions:setFunction", res)
			return res
		}
		if (!access.hasAccess || !access.isOwner)
			return reply({
				sessionId: params.sessionId,
				action: params.action,
				error: "Session not found."
			})

		const { setSessionFunction } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const genreId = await sessionGenreOf(db, params.sessionId)

		const r = await setSessionFunction(
			db,
			params.sessionId,
			genreId,
			// The identity (U5c review, W1), or a bare key the entity layer
			// resolves to the one action carrying it or refuses.
			params.action,
			!!params.enabled,
			{ userId, isAdmin: !!socket.user!.isAdmin }
		)
		if (!r.ok)
			return reply({
				sessionId: params.sessionId,
				action: params.action,
				error: r.error
			})

		// The function and action lists follow in the same breath, so the session view's
		// buttons cannot lag the setting that decides them. Both lazy.
		await emitToUser("sessions:functions", () =>
			buildSessionFunctions(params.sessionId, {
				userId,
				isAdmin: !!socket.user!.isAdmin
			})
		)
		await emitToUser("sessions:actions", () =>
			withSessionActionsChain(params.sessionId, () =>
				buildSessionActions(params.sessionId, userId, undefined)
			)
		)
		return reply({
			sessionId: params.sessionId,
			action: params.action,
			enabled: r.enabled
		})
	}
}
