
import {
	i18nText,
	sessionEvents,
	resolveWidgetSurface,
	isServableEntry,
	getGenre,
	pluginWidgetId,
	CONVERSATION_WIDGET_ID,
	WIDGET_SCOPED_SECTIONS,
	type WidgetDecl,
	type WidgetSurface,
	WIDGET_ID_ALIASES
} from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { declaredWidgetReads } from "$lib/shared/widgets/reads"
import { liveMessageWhere } from "$lib/server/messages/store"
import { readsPrompt, withEmbeddingStateFor, withoutDebugMeta } from "$lib/server/messages/debugMeta"
import {
	extendVerbRefusal,
	resolveMessageVerbs,
	turnDeleteVerdict,
	verbEnablementRefusal
} from "$lib/server/messages/verbs"
import { resolveWrites } from "$lib/server/messages/writes"
import {
	DEFAULT_CHANNEL,
	channelDeclsOf,
	channelsOf
} from "$lib/server/messages/channels"
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm"
import {
	announceSeatChanges,
	setSeatBench,
	handOverSeat,
	type SeatChange
} from "$lib/server/sessions/seats"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import { sessionGenreOf } from "$lib/server/sessions/annexFields"

import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import {
	broadcastToSessionUsers,
	emitToUserRedacted
} from "./utils/broadcastHelpers"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	buildSessionsListFor,
	relistWithRow,
	getSessionFromDB,
	withSessionExtras,
	broadcastSessionToParticipants
} from "./sessions.shared"
import {
	sessionsMessagesPageHandler,
	sessionsChannelLanesHandler,
	sessionsLaneReadHandler,
	sessionMessagesSendPersonaMessageHandler,
	sessionMessagesUpdateHandler,
	sessionMessagesDeleteHandler,
	sessionMessagesRegenerateHandler,
	sessionMessagesExtendHandler,
	sessionMessagesSwipeLeftHandler,
	sessionMessagesSwipeRightHandler,
	sessionMessagesCancelHandler,
	sessionMessageHandler,
	promptTokenCountHandler
} from "./sessions.messages"
import {
	sessionsModesHandler,
	sessionsGenreOfHandler,
	sessionsUpgradeModeHandler,
	sessionsConvertRulesetHandler,
	sessionsFunctionCandidatesHandler,
	sessionsBindFunctionHandler,
	sessionsNodeSwapOptionsHandler,
	sessionsPipelineCardsHandler,
	sessionsSetNodeRebindHandler,
	sessionsFireActionHandler,
	sessionsPipelinesHandler,
	sessionsSetSessionPresetHandler,
	sessionsPresetStatusHandler,
	sessionsActionsHandler,
	sessionsActionsSeenHandler,
	sessionsFunctionsHandler,
	sessionsSetFunctionHandler
} from "./sessions.pipelines"
import { sessionsCreateHandler } from "./sessions.create"
import {
	sessionsSaveDraftHandler,
	sessionsUpdateHandler
} from "./sessions.update"
import {
	sessionsPanelLayoutStartedFromUpdatedHandler,
	sessionsPanelLayoutGetHandler,
	sessionsPanelLayoutStartFromHandler,
	sessionsPanelLayoutSetHandler,
	sessionsLayoutPresetSaveHandler,
	sessionsLayoutPresetRenameHandler,
	sessionsLayoutPresetDeleteHandler,
	sessionsLayoutPresetUsageHandler,
	sessionsLayoutPresetShareHandler,
	sessionsLayoutPresetCloneHandler,
	sessionsLayoutPresetUpdateHandler,
	sessionsLayoutPresetSetNewSessionLayoutHandler
} from "./sessions.layout"
import {
	sessionsFireTurnHandler,
	sessionsRetakeTurnHandler,
	sessionsRewindTurnHandler,
	sessionsForwardTurnHandler,
	fireNarratorResponseHandler
} from "./sessions.turns"
import {
	sessionsAddPersonaHandler,
	sessionsReassignRemovedParticipantHandler,
	sessionsSetCastSeatEnabledHandler,
	sessionsAccountVisibilityHandler,
	sessionsCastToTakeHandler
} from "./sessions.participants"
import {
	sessionsOverlayItemsHandler,
	sessionsApplyOverlayHandler,
	sessionsAppliedBatchesHandler,
	sessionsTakeBackApplyHandler
} from "./sessions.overlay"
export {
	sessionsOverlayItemsHandler,
	sessionsApplyOverlayHandler,
	sessionsAppliedBatchesHandler,
	sessionsTakeBackApplyHandler,
	tellApplyMoved,
	applyHeldAutomaticallyAndTell
} from "./sessions.overlay"
export {
	sessionsAddPersonaHandler,
	sessionsReassignRemovedParticipantHandler,
	sessionsSetCastSeatEnabledHandler,
	sessionsAccountVisibilityHandler,
	sessionsCastToTakeHandler
} from "./sessions.participants"
export {
	sessionsFireTurnHandler,
	sessionsRetakeTurnHandler,
	sessionsRewindTurnHandler,
	sessionsForwardTurnHandler,
	fireNarratorResponseHandler
} from "./sessions.turns"
export {
	sessionGenres,
	startedFromUpdatedAnswer,
	sessionsPanelLayoutStartedFromUpdatedHandler,
	sessionsPanelLayoutGetHandler,
	sessionsPanelLayoutStartFromHandler,
	sessionsPanelLayoutSetHandler,
	sessionsLayoutPresetSaveHandler,
	sessionsLayoutPresetRenameHandler,
	sessionsLayoutPresetDeleteHandler,
	sessionsLayoutPresetUsageHandler,
	sessionsLayoutPresetShareHandler,
	sessionsLayoutPresetCloneHandler,
	sessionsLayoutPresetUpdateHandler,
	sessionsLayoutPresetSetNewSessionLayoutHandler
} from "./sessions.layout"
export {
	sessionsSaveDraftHandler,
	sessionsUpdateHandler
} from "./sessions.update"
export { sessionsCreateHandler } from "./sessions.create"
export {
	sessionsModesHandler,
	sessionsGenreOfHandler,
	sessionsUpgradeModeHandler,
	sessionsConvertRulesetHandler,
	sessionsFunctionCandidatesHandler,
	sessionsBindFunctionHandler,
	sessionsNodeSwapOptionsHandler,
	sessionsPipelineCardsHandler,
	sessionsSetNodeRebindHandler,
	sessionsFireActionHandler,
	sessionsPipelinesHandler,
	sessionsSetSessionPresetHandler,
	sessionsPresetStatusHandler,
	buildSessionActions,
	sessionsActionsHandler,
	sessionsActionsSeenHandler,
	sessionsFunctionsHandler,
	sessionsSetFunctionHandler
} from "./sessions.pipelines"
export {
	sessionsMessagesPageHandler,
	sessionsChannelLanesHandler,
	sessionsLaneReadHandler,
	sessionMessagesSendPersonaMessageHandler,
	sessionMessagesUpdateHandler,
	sessionMessagesDeleteHandler,
	sessionMessagesRegenerateHandler,
	sessionMessagesExtendHandler,
	sessionMessagesSwipeLeftHandler,
	sessionMessagesSwipeRightHandler,
	sessionMessagesCancelHandler,
	sessionMessageHandler,
	promptTokenCountHandler
} from "./sessions.messages"
export {
	relistSessionMembers,
	getPromptSessionFromDb,
	pushSessionToParticipants,
	runLorebookBindingCheck,
	sessionLinePatch
} from "./sessions.shared"

export const sessionsListHandler: Handler<
	Sockets.Sessions.List.Params,
	Sockets.Sessions.List.Response
> = {
	event: "sessions:list",
	async handler(socket, params, emitToUser) {
		const response = await buildSessionsListFor(socket.user!.id)
		emitToUser("sessions:list", response)
		return response
	}
}

/**
 * A widget's `maxInstances` as `sessions:view` carries it (brief 7b): a
 * positive integer, else nothing — a stored manifest is read as it comes, and
 * a cap that is not one is no cap (the SDK's `widget()` refuses it at build).
 */
function widgetCap(v: unknown): { maxInstances?: number } {
	return typeof v === "number" && Number.isInteger(v) && v > 0 ? { maxInstances: v } : {}
}

export const sessionsTypingHandler: Handler<
	Sockets.Sessions.Typing.Params,
	Sockets.Sessions.Typing.Response
> = {
	event: "sessions:typing",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess) {
			const res: Sockets.Sessions.Typing.Response = { success: false }
			return res
		}

		// Fire-and-forget broadcast — receiving clients own their own 10s
		// expiry, so there's no matching "stopped typing" event to send.
		//
		// LAZY (plan ruling 4): the persona read exists ONLY to name whoever is
		// typing in this payload, so a session no view has open pays for
		// neither it nor the two roster reads behind the broadcast.
		//
		// ⚠ The reply is `success: true` on access alone, because whether the
		// persona exists is knowable only inside the thunk. Nothing reads this
		// ack — the session page emits `sessions:typing` with no callback, and
		// `register` discards what a handler returns — and a persona that is
		// gone broadcasts nothing, which is the half a client can observe.
		await broadcastToSessionUsers(
			socket.io,
			params.sessionId,
			"sessions:userTyping",
			async () => {
				// The card as its current card version has it (never the ⏳ copy).
				const { cardsNow } = await import("$lib/server/cast/seatedCast")
				const persona = (
					await cardsNow(db as unknown as Db, [params.personaId])
				).get(params.personaId)
				if (!persona) return null
				// 🚧 The name is the player seat's: a seat name, else the
				// member it seats as read (★pT-1, 2026-11-05: "Everything in
				// session is cast -> active card"), else the card's own. Live
				// seats before departed, then position, then id.
				const [seat] = await db
					.select({
						castMemberId: schema.sessionPersonas.castMemberId,
						seatName: schema.sessionPersonas.seatName
					})
					.from(schema.sessionPersonas)
					.where(
						and(
							eq(schema.sessionPersonas.sessionId, params.sessionId),
							eq(schema.sessionPersonas.personaId, persona.id)
						)
					)
					.orderBy(
						sql`(${schema.sessionPersonas.removedAt} is not null)`,
						asc(sql`coalesce(${schema.sessionPersonas.position}, 0)`),
						asc(schema.sessionPersonas.id)
					)
					.limit(1)
				let personaName = persona.name
				if (seat) {
					const { seatCardsAsRead } = await import(
						"$lib/server/pipelines/prompt/seatCards"
					)
					const { withSeatName } = await import("$lib/server/sessions/seatName")
					const [read] = await seatCardsAsRead(db as unknown as Db, params.sessionId, [
						{ castMemberId: seat.castMemberId, character: persona }
					])
					personaName =
						withSeatName(read.character as typeof persona, seat.seatName)?.name ??
						persona.name
				}
				return {
					sessionId: params.sessionId,
					personaId: persona.id,
					personaName
				} satisfies Sockets.Sessions.UserTyping.Response
			}
		)

		const res: Sockets.Sessions.Typing.Response = { success: true }
		return res
	}
}

export const sessionsDeleteHandler: Handler<
	Sockets.Sessions.Delete.Params,
	Sockets.Sessions.Delete.Response
> = {
	event: "sessions:delete",
	async handler(socket, params, emitToUser) {
		try {
			const userId = socket.user!.id

			// 🚧 (M2c) Confirmed from an extension's launcher: its grant and its
			// genre are judged first, in words. Absent: exactly today.
			if (params.fromApplet) {
				const { appletDeleteRefusal } = await import("./appletSessions")
				const refusal = await appletDeleteRefusal(db as unknown as Db, userId, params)
				if (refusal) {
					emitToUser("sessions:delete:error", { error: refusal })
					return { error: refusal }
				}
			}

			console.log("[sessions:delete] Received params:", params)
			console.log("[sessions:delete] Params type:", typeof params)
			console.log(
				"[sessions:delete] Params keys:",
				Object.keys(params || {})
			)

			// Check if user has access to delete this session (only owners can delete)
			const sessionAccess = await checkSessionAccess(params.id, userId)

			console.log("[sessions:delete] Session access check:", {
				sessionId: params.id,
				userId,
				isOwner: sessionAccess.isOwner,
				isGuest: sessionAccess.isGuest,
				hasAccess: sessionAccess.hasAccess
			})

			if (!sessionAccess.hasAccess || !sessionAccess.isOwner) {
				throw new Error(
					"Access denied. Only session owners can delete sessions."
				)
			}

			// The delete safeguard (R8): one last row on the world's timeline
			// before the cascade takes the session layer with the session.
			// Everything `session_id` points at is about to go, and a
			// `cast_member`/`lorebook` row anchored to a history entry is what
			// survives it — so where a character ended up is a fact about the
			// story rather than something that vanished with a chat log.
			// Best-effort and BEFORE the delete: a session the owner asked to
			// delete must still be deleted if the recording fails, and there is
			// nothing to record from afterwards.
			let notRecorded: string[] = []
			try {
				const { newestHistoryEntryOf, recordToTimeline } = await import(
					"$lib/server/state/durable"
				)
				// Dated where the session stands — the latest history entry
				// on its line at or before its story clock — rather than at
				// its newest capture, which the clock may have moved past
				// (plan A22). The newest capture is its provenance.
				const moment = await newestHistoryEntryOf(db, params.id)
				const report = await recordToTimeline(db, params.id, {
					reason: "delete",
					sceneId: moment.sceneId
				})
				// What the book would not take is said to whoever deleted
				// the session (A18): nothing is left to record it from.
				notRecorded = report.refused
			} catch (e) {
				console.warn(
					"[sessions:delete] state was not recorded to the timeline:",
					e
				)
			}

			// The scenes captured from this session outlive it (their
			// `session_id` is set to NULL) and keep their spans: the ids are
			// their place in play (`inPlayOrder`), and `deriveSceneMentions`
			// counts only the messages that exist.
			// 🚧 Its ancestors, read before the row goes (plan §33.2): what they
			// retired for this branch alone is swept once it is gone.
			const [gone] = await db
				.select({ branchAncestry: schema.sessions.branchAncestry })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.id))
				.limit(1)

			await db
				.delete(schema.sessions)
				.where(eq(schema.sessions.id, params.id))

			// 🚧 The session's own book goes with it (PLAN-rulesets §26) — unless
			// a branch still reads it: then it stays after the row until the last
			// branch goes (plan §33.3, below). Best-effort: the row is gone
			// either way, and the boot sweep removes a book left behind.
			try {
				const { purgeOwnBookOf } = await import(
					"$lib/server/lorebooks/ownBook"
				)
				await purgeOwnBookOf(db, params.id)
			} catch (e) {
				console.warn(
					"[sessions:delete] the session's notes were not purged; the boot sweep removes them:",
					e
				)
			}

			// 🚧 Retired cast versions nobody reads any more are swept when the
			// last descendant goes (§33.2). Best-effort: the session is gone
			// either way, and a row left retired reads for nobody.
			const ancestors = (gone?.branchAncestry ?? []).map((a) => a.sessionId)
			if (ancestors.length)
				try {
					const { sweepRetiredVersions } = await import(
						"$lib/server/characters/versions"
					)
					await db.transaction((tx) =>
						sweepRetiredVersions(tx as unknown as Db, ancestors)
					)
				} catch (e) {
					console.warn(
						"[sessions:delete] retired cast versions were not swept:",
						e
					)
				}

			// 🚧 Its ancestors' notes kept for it go with it (plan §33.3): each
			// ancestor that is gone and that no branch reads any more. Best
			// effort, like the sweep.
			if (ancestors.length)
				try {
					const { purgeKeptOwnBooks } = await import(
						"$lib/server/lorebooks/ownBook"
					)
					await purgeKeptOwnBooks(db, ancestors)
				} catch (e) {
					console.warn(
						"[sessions:delete] kept session notes were not purged:",
						e
					)
				}

			{
				const { relistSessionNotes } = await import("./lorebooks")
				relistSessionNotes(socket, emitToUser)
			}

			// Every member's notifications about the session go with it
			// (notifications carry no FK to what they regard). Never throws.
			await (
				await import("$lib/server/notifications/store")
			).clearNotifications(
				{ regarding: `session:${params.id}/`, prefix: true },
				"superseded"
			)

			// Emit to user with the deleted session ID so frontend can update
			const res: Sockets.Sessions.Delete.Response = {
				success: "Session deleted successfully",
				id: params.id,
				...(notRecorded.length ? { notRecorded } : {})
			}
			emitToUser("sessions:delete", res)

			return res
		} catch (error) {
			throw error
		}
	}
}

/**
 * The session's frame surfaces (20 §12): the mode-declared session-view and
 * every enabled plugin's widgets (component and frame), each resolved to a src
 * on the plugin-ui route. Presence is data — disabling a plugin takes its frames
 * with it, and a mode whose view-plugin is missing falls back to core's log
 * (the frame is simply absent, never an error).
 */
export const sessionsViewHandler: Handler<
	Sockets.Sessions.View.Params,
	Sockets.Sessions.View.Response
> = {
	event: "sessions:view",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const res: Sockets.Sessions.View.Response = {
			sessionId: params.sessionId,
			modePanels: [],
			// The floor, replaced below once the genre is read. A caller with
			// no access still learns that a session has one lane, which is
			// true of every session.
			channels: [DEFAULT_CHANNEL]
		}
		if (access.hasAccess) {
			// The viewer's language, as the envoys in this same response are
			// resolved (`viewEnvoys`): it titles the declared widgets below,
			// and every widget reads it as the envelope's `locale` (C3b).
			const { resolveUserLanguage } = await import("$lib/server/i18n")
			res.language = (await resolveUserLanguage(userId)).code
			const { surfacesOf, frameSrc, notCoreRow } = await import(
				"$lib/server/plugins/frameHost"
			)
			// A row stored as `core` offers nothing: its frames would be
			// answered as core's own (`notCoreRow`). Behind the extension
			// flag like the R71 path below: with SP_PLUGINS_ENABLED off no
			// plugin counts as enabled here, so no plugin widget, genre panel
			// a plugin owns or session view is offered.
			const { pluginsEnabled } = await import("$lib/server/plugins/flag")
			const extensionsOn = pluginsEnabled()
			const enabled = extensionsOn
				? await db
						.select({
							pluginId: schema.plugins.pluginId,
							version: schema.plugins.version,
							name: schema.plugins.name,
							manifest: schema.plugins.manifest,
							adminDenied: schema.plugins.adminDenied
						})
						.from(schema.plugins)
						.where(and(eq(schema.plugins.enabled, true), notCoreRow()))
				: []

			// The mode's declared session-view, when its plugin is enabled
			// and declares the surface.
			const { getSessionGenre } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const genreId = await sessionGenreOf(db, params.sessionId)
			const mode = await getSessionGenre(db, genreId)
			// The session's lanes (20 §7): `main` plus whatever the genre
			// declares. Read from the shape rather than stored on the row —
			// a genre gains a channel by declaring one, and a session of that
			// genre has it from that moment.
			// 🚧 A channel for the owner alone (`audience: 'owner'`, Lair
			// rewrite D6) is no part of a guest's session: not listed, not
			// labelled, never offered to their composer's switch.
			// 🚧 So is a channel for the people named (`audience: { participants }`,
			// M0 L6) to anyone not among them: one predicate decides.
			const { audienceHiddenSlugsFor } = await import("$lib/server/channels/lanes")
			const hiddenChannels = await audienceHiddenSlugsFor(
				db,
				params.sessionId,
				mode?.shape,
				userId,
				access.isOwner
			)
			res.channels = channelsOf(mode?.shape).filter((c) => !hiddenChannels.has(c))
			// What each is CALLED (S1): the declared label, in the viewer's
			// language — the Lair's `sanctum` is _Sanctum_. Only the channels
			// that declare one; the rest are named by their slug.
			const labels: Record<string, string> = {}
			// And what each IS (PLAN-core-widgets §3.7): only the channels
			// that declare a role, so a Messages copy claiming a `folio`
			// channel can draw it as Folio when its Presentation is unset.
			const roles: Record<string, "conversation" | "folio"> = {}
			for (const decl of channelDeclsOf(mode?.shape)) {
				if (hiddenChannels.has(decl.slug)) continue
				// The mirror reads a stored row as it comes (a locale map
				// that may lack `en`); `i18nText` falls back to it anyway.
				const label = decl.label
					? i18nText(decl.label as Parameters<typeof i18nText>[0], res.language)
					: undefined
				if (label) labels[decl.slug] = label
				if (decl.role === "folio" || decl.role === "conversation")
					roles[decl.slug] = decl.role
			}
			if (Object.keys(labels).length) res.channelLabels = labels
			if (Object.keys(roles).length) res.channelRoles = roles

			// Whether Extend is offered at all, and why not when it is not.
			//
			// Computed HERE because this handler is already the one that reads
			// the genre — `messageVerbs` is half the answer — and because it
			// fires once when the session opens rather than once per message.
			// The other half is the connection the session's replies resolve
			// to: most cannot resume a partial reply as a true prefill, and the
			// button that fires anyway produces a second beginning glued onto
			// the first. Exactly the same function the verb refuses with, so
			// the greyed-out button's tooltip and the refusal a fired verb
			// returns are one sentence rather than two that must agree.
			const refusal = await extendVerbRefusal(
				db,
				params.sessionId,
				userId
			)
			if (refusal) res.extendRefusal = refusal
			// The whole availability map (R-15): a forbidden opt-in built-in
			// is absent client-side; the floors are not in the map because
			// they cannot be forbidden. Resolved here, once, from the same
			// shape the verbs refuse with.
			res.messageVerbs = resolveMessageVerbs(mode?.shape)
			/**
			 * And what this session may write beyond messages (R-B): the
			 * Summarize-to-Lorebook and scene affordances hang off it. Resolved
			 * from the same shape the write sites refuse with, so the hidden
			 * button and the refusal a raw emit gets are one answer.
			 */
			res.writes = resolveWrites(mode?.shape)

			/**
			 * The envoys (plans/29 R-18; U5g): everything the genre and the
			 * installed actions declare, with display text in the viewer's
			 * language and whether a live seat exists. One list for two
			 * readers — the message renders an envoy's name and image off
			 * it, the Edit Session form offers the genre's for seating.
			 */
			res.envoys = await viewEnvoys(params.sessionId, userId)
			/**
			 * The genre's `playerLabel` (lair re-plan R4): what a person's
			 * persona-less line is called. The session's override is on its
			 * row, which the page already re-reads after every save, so it is
			 * resolved there (`resolvePlayerLabel`) rather than frozen here.
			 */
			if (mode?.playerLabel) res.genrePlayerLabel = mode.playerLabel

			const viewPlugin = (mode?.shape as any)?.view
			if (typeof viewPlugin === "string") {
				const owner = enabled.find((p) => p.pluginId === viewPlugin)
				const decl = owner
					? surfacesOf(owner.manifest).sessionView
					: undefined
				if (owner && decl) {
					res.sessionView = {
						pluginId: owner.pluginId,
						src: frameSrc(owner.pluginId, decl.entry, owner.version),
						title: decl.title ?? owner.name
					}
					// 🚧 m3-core: an applet genre's frame holds the launcher's grants too (plan §9).
					if ((mode?.shape as any)?.applet === true) {
						const { appletMount } = await import("$lib/server/plugins/appletMount")
						const mount = appletMount(owner.pluginId, { ...owner, enabled: true }, [
							{ genreId, name: "", shape: mode!.shape as any }
						])
						if (mount) res.sessionView.appletGrants = mount.grants
					}
				}
			}

			// The mode's declared surface-grid panels (21). An enabled
			// plugin's own widgets follow in the R71 pass below.
			const declaredPanels = (mode?.shape as any)?.panels
			const genrePanels = Array.isArray(declaredPanels)
				? declaredPanels
				: []
			if (genrePanels.length) {
				// The viewer's language (read above, `res.language`): a panel's
				// title is display text (R-20) — a string or a locale map — and
				// the client reads text.
				const language = res.language ?? "en"
				// The genre's FIRST. The client merges by id and the later
				// entry wins, so this order is what keeps a genre's widget the
				// one that is seated. After namespacing the two id spaces
				// cannot collide — which is the point — but the precedence is
				// the rule, not the collision.
				// Whose widgets these are decides whose `component` it is (R25):
				// core's own remote, or the plugin's. Whose the GENRE is comes
				// from the row that provides it, never from its id alone: a
				// package may spell a genre id `core:…`, and core's owner would
				// hand its panels core's box and every scope they declare. A
				// plugin's genre whose row is gone owns nothing ("").
				let genreOwner = genreId.startsWith("core:") ? "core" : genreId.slice(0, genreId.indexOf(":"))
				if (typeof mode?.sourcePluginId === "number") {
					const [provider] = await db
						.select({ pluginId: schema.plugins.pluginId })
						.from(schema.plugins)
						.where(and(eq(schema.plugins.id, mode.sourcePluginId), notCoreRow()))
						.limit(1)
					genreOwner = provider?.pluginId ?? ""
				}
				const { CORE_WIDGETS } = await import("@serene-pub/core-catalog")
				const coreComponents = new Set(CORE_WIDGETS.map((w) => w.component).filter(Boolean))
				const CORE_CONVERSATION_COMPONENT = CORE_WIDGETS.find((w) => w.role === "primary")?.component
				for (const p of genrePanels) {
					if (!p || typeof p.id !== "string") continue
					const surface: WidgetSurface | null = resolveWidgetSurface(p, genreOwner)
					if (!surface) continue
					// A remote runs its owner's component module in the UI
					// worker (§3.5): offered only when that plugin is enabled
					// and declares the component; otherwise not offered rather
					// than offered broken.
					let remoteSrc: string | undefined
					/** The data it asked for that its plugin was granted (`widget:<scope>`). */
					let grants: string[] | undefined
					// Core's own component holds every section scope it
					// declares, as the page's default widgets do
					// (`coreDefaultWidgets`).
					if (surface.owner === "core")
						grants = (Array.isArray(p.scopes) ? (p.scopes as unknown[]) : []).filter(
							(s): s is string => typeof s === "string" && Object.hasOwn(WIDGET_SCOPED_SECTIONS, s)
						)
					if (surface.owner === "core") {
						// Core's own component: served by `/core-ui`, which
						// serves every component core declares and nothing
						// else — so one core does not declare is not offered,
						// rather than offered as a box that 404s. Never
						// looked up as a plugin row (`notCoreRow` hides any
						// row named `core`).
						// ⏳ An aliased id (`world-state` → `stats`, `WIDGET_ID_ALIASES`): its
						// module is the target's (AUDIT B, 2026-10-17); a genre shape that
						// still names it is served Stats.
						const aliased = WIDGET_ID_ALIASES[surface.component]?.id
						if (aliased) surface.component = aliased
						if (!coreComponents.has(surface.component)) continue
						// The conversation is not a panel: the layout draws
						// every copy of it itself (`messages`, `messages#<name>`)
						// and decides there which copies keep the page's
						// element ids (`#message-<id>`) and which take their
						// box's prefix. A panel seating it would sit outside
						// that, so a panel may not.
						if (surface.component === CORE_CONVERSATION_COMPONENT) continue
						remoteSrc = `/core-ui/${surface.component}`
					} else {
						const owner = enabled.find((e) => e.pluginId === surface.owner)
						const declared = (
							(owner?.manifest as { components?: unknown } | undefined)?.components as
								| Array<{ slug?: unknown; entry?: unknown }>
								| undefined
						)?.find((c) => c?.slug === surface.component)
						if (
							!owner ||
							typeof declared?.entry !== "string" ||
							!isServableEntry(declared.entry) ||
							!/\.m?js$/.test(declared.entry) // the built module, never its source
						)
							continue
						// Built for a host contract this host does not speak (F1): not offered, the reason in the admin list.
						const { pluginComponentRefusal } = await import("$lib/server/components/compat")
						if (pluginComponentRefusal(owner.manifest, surface.component)) continue
						// Versioned like the session view's document, so a document the
						// component nests (`sp-frame`) is too, and gets its `assetsBase` (M2a).
						remoteSrc = frameSrc(owner.pluginId, declared.entry, owner.version)
						if (Array.isArray(p.scopes) && p.scopes.length) {
							const { panelGrants } = await import("$lib/server/plugins/permissions")
							grants = panelGrants(p.scopes, owner.manifest as never, owner.adminDenied)
						}
					}
					const panel: Sockets.Sessions.View.ModePanel = {
						id: p.id,
						title: i18nText(p.title, language) ?? p.id,
						icon: typeof p.icon === "string" ? p.icon : undefined,
						role: p.role === "primary" ? "primary" : "secondary",
						surface,
						channels: Array.isArray(p.channels)
							? p.channels
							: undefined,
						layout:
							p.layout && typeof p.layout === "object"
								? p.layout
								: undefined,
						// The declared settings schema. `ModePanel.settings`
						// has always been on the wire and this loop never
						// filled it, so a genre's widget offered a settings
						// card with no controls on it — the client resolves an
						// instance's values against the declaration it is
						// handed, and it was handed none.
						settings:
							p.settings &&
							typeof p.settings === "object" &&
							!Array.isArray(p.settings)
								? p.settings
								: undefined,
						// The base sections it reads (R75): only those are sent.
						...(Array.isArray(p.reads) ? { reads: declaredWidgetReads(p.reads) } : {}),
						...widgetCap(p.maxInstances)
					}
					if (remoteSrc) panel.src = remoteSrc
					if (grants?.length) panel.grants = grants as Sockets.Sessions.View.ModePanel["grants"]
					res.modePanels.push(panel)
				}

			}
		}
		// R71: a session offers every enabled package's widgets scoped to its
		// genre or to all, minus what the genre omits (core's included). A
		// package widget takes the middle only where the genre withheld the
		// conversation — an installed package may not take the anchor otherwise.
		// Only a member learns what a session offers — its genre's omissions and
		// every package widget with its module URL are the session's to know.
		if (access.hasAccess && res.modePanels) {
			const { panelGrants } = await import("$lib/server/plugins/permissions")
			const { frameSrc, notCoreRow } = await import("$lib/server/plugins/frameHost")
			const genreId = await sessionGenreOf(db, params.sessionId)
			const enabledNow = await db
				.select({
					pluginId: schema.plugins.pluginId,
					version: schema.plugins.version,
					manifest: schema.plugins.manifest,
					adminDenied: schema.plugins.adminDenied
				})
				.from(schema.plugins)
				.where(and(eq(schema.plugins.enabled, true), notCoreRow()))
			const genreDecl =
				getGenre(genreId) ??
				(enabledNow
					.flatMap((e) => ((e.manifest as { genres?: unknown[] })?.genres ?? []) as Array<{ id?: string }>)
					.find((g) => g?.id === genreId) as { omitWidgets?: unknown } | undefined)
			const omit = new Set<string>(
				Array.isArray(genreDecl?.omitWidgets)
					? (genreDecl.omitWidgets as unknown[]).filter((w): w is string => typeof w === "string")
					: []
			)
			const language = res.language ?? "en"
			// Whose genre this is — a package widget stands in the middle only in its own.
			const genreOwner = genreId.startsWith("core:") ? "core" : genreId.slice(0, genreId.indexOf(":"))
			const seen = new Set(res.modePanels.map((p) => p.id))
			// Behind the extension flag like the authored path (`components/offer`):
			// with SP_PLUGINS_ENABLED off, no package widget is offered.
			const { pluginsEnabled } = await import("$lib/server/plugins/flag")
			const { pluginComponentRefusal } = await import("$lib/server/components/compat")
			for (const e of pluginsEnabled() ? enabledNow : []) {
				const m = e.manifest as {
					widgets?: unknown
					components?: Array<{ slug?: unknown; entry?: unknown }>
				}
				if (!Array.isArray(m?.widgets)) continue
				for (const w of m.widgets as WidgetDecl[]) {
					if (!w || typeof w.id !== "string") continue
					if (Array.isArray(w.genres) && w.genres.length && !w.genres.includes(genreId)) continue
					// What it renders: its own component, run in the UI worker.
					// Anything else (nothing at all) is not offered.
					const surface = resolveWidgetSurface(w, e.pluginId)
					if (!surface) continue
					const built = (m.components ?? []).find((c) => c?.slug === surface.component)
					// The built module, never its source — otherwise not offered rather than offered broken.
					if (typeof built?.entry !== "string" || !isServableEntry(built.entry) || !/\.m?js$/.test(built.entry))
						continue
					// Built for a host contract this host does not speak (F1): not offered, the reason in the admin list.
					if (pluginComponentRefusal(e.manifest, surface.component)) continue
					const src = frameSrc(e.pluginId, built.entry, e.version)
					const id = pluginWidgetId(e.pluginId, w.id)
					if (seen.has(id)) continue // one declaration per id
					seen.add(id)
					const grants = panelGrants(w.scopes, e.manifest as never, e.adminDenied)
					res.modePanels.push({
						id,
						title: i18nText(w.title, language) ?? w.id,
						...(typeof w.icon === "string" ? { icon: w.icon } : {}),
						role:
							w.role === "primary" && omit.has(CONVERSATION_WIDGET_ID) && genreOwner === e.pluginId
								? "primary"
								: "secondary",
						surface,
						src,
						...(Array.isArray(w.channels) ? { channels: w.channels } : {}),
						...(w.layout && typeof w.layout === "object" ? { layout: w.layout } : {}),
						...(w.settings ? { settings: w.settings as Record<string, unknown> } : {}),
						...(Array.isArray(w.reads) ? { reads: declaredWidgetReads(w.reads) } : {}),
						...(grants.length ? { grants: grants as Sockets.Sessions.View.ModePanel["grants"] } : {}),
						...widgetCap(w.maxInstances)
					})
				}
			}
			// Authored components (C6): each its own owner (`authored.<id>`),
			// offered in every session, never the anchor — and only while on,
			// compiled and clean, behind the extension flag (`components/offer`).
			const { offeredAuthoredWidgets } = await import("$lib/server/components/offer")
			for (const panel of await offeredAuthoredWidgets(db, language)) {
				if (seen.has(panel.id)) continue
				seen.add(panel.id)
				res.modePanels.push(panel)
			}
			// The middle is never empty: a genre that withholds the conversation
			// but whose own middle did not survive (its module unbuilt, its
			// plugin's component gone) keeps the conversation instead.
			if (omit.has(CONVERSATION_WIDGET_ID) && !res.modePanels.some((p) => p.role === "primary" && !omit.has(p.id)))
				omit.delete(CONVERSATION_WIDGET_ID)
			if (omit.size) {
				res.modePanels = res.modePanels.filter((p) => !omit.has(p.id))
				res.omitWidgets = [...omit]
			}
		}
		emitToUser("sessions:view", res)
		// The turn order rides with the view (PLAN-turn-order §4.7) to the
		// viewer alone (pr-6 A9): a client that has just joined renders the
		// same state as one that was already here, and nobody else is told
		// of an open. Page load is not an event.
		try {
			const { turnOrderFrameOf } = await import(
				"$lib/server/sessions/turnOrderPush"
			)
			const frame = await turnOrderFrameOf(params.sessionId)
			if (frame && access.hasAccess) {
				const { laneScopedRecipients } = await import(
					"$lib/server/channels/lanePush"
				)
				const [mine] = await laneScopedRecipients(
					db,
					params.sessionId,
					"sessions:turnOrder",
					frame,
					[socket.user!.id]
				)
				if (mine) emitToUser("sessions:turnOrder", mine.data)
			}
		} catch (err) {
			console.warn("[sessions:view] the turn-order push failed:", err)
		}
		return res
	}
}

/**
 * The `sessions:get` payload: one session, its page of messages, and the
 * caller's draft.
 *
 * Pulled out of the handler below so the three cascades that re-send a session
 * after a mutation (`sessionMessages:delete` and the two session-character
 * verbs) can hand it to `emitToUser` as a thunk — one source of truth for the
 * payload, and the whole re-read is skipped when no view has that session open.
 *
 * Shape 1 of two (pr-6 B §B-1): the reply to an ask. Every push to members
 * is shape 2, `buildSessionRefresh` below.
 */
async function buildSessionGetResponse(
	sessionId: number,
	userId: number,
	page: { limit?: number; beforeId?: number } = {}
): Promise<Sockets.Sessions.Get.Response> {
	const limit = page.limit ?? 25
	const beforeId = page.beforeId

	// Check if user has access to this session (both owners and guests can get)
	//
	// ⚠ Both not-found replies carry `sessionId`. There is no session for
	// `scopeOfPayload` to read an id off, so without it the reply has no
	// **interest scope** and only a BARE `sessions:get` key could receive it —
	// which is a key that matches every OTHER session's reply too, so the gate
	// would pass for every id while any view was open. With the id beside the
	// null, a view holding `sessions:get#<its own id>` gets its own not-found
	// answer and nobody else's.
	const sessionAccess = await checkSessionAccess(sessionId, userId)
	if (!sessionAccess.hasAccess)
		return { session: null, messages: null, sessionId }

	// The first page leaves the rows relation out: the per-channel query below
	// reads them once.
	const sessionData = await getSessionFromDB(
		sessionId,
		userId,
		beforeId != null ? { limit, beforeId } : "none"
	)

	if (!sessionData) return { session: null, messages: null, sessionId }

	// Count total messages for pagination metadata — the asker's rows only
	// (personal channel lanes, 2026-10-17), or `hasMore` would promise rows
	// the next page never brings.
	const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
	const laneView = await laneViewFor(db, sessionId, userId)
	const [{ total }] = await db
		.select({ total: count() })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				laneViewWhere(schema.sessionMessages.channel, laneView),
				liveMessageWhere()
			)
		)

	/**
	 * 🚧 The first page is **per channel** (PLAN-dc-after-walk2 Q1-1, owner
	 * ruling ★7): each channel's newest `limit` lines the asker reads, so a
	 * genre of many channels — a Story beside its Planner lanes, dice and
	 * journal — never spends the page on the others (the walk's Story showed
	 * six lines after a reload, and nothing older could be reached). `olderIn`
	 * names the channels that hold more; a widget asks for those, a channel at
	 * a time (`sessions:messagesPage`).
	 */
	let olderIn: string[] | undefined
	if (beforeId == null) {
		const m = schema.sessionMessages
		const where = and(
			eq(m.sessionId, sessionId),
			laneViewWhere(m.channel, laneView),
			// 🚧 The live history (RF fix 5).
			liveMessageWhere(m.rewindOrdinal)
		)
		const ranked = db
			.select({
				id: m.id,
				rank: sql<number>`row_number() over (partition by ${m.channel} order by ${m.id} desc)`.as("rank")
			})
			.from(m)
			.where(where)
			.as("ranked")
		const ids = (await db.select({ id: ranked.id }).from(ranked).where(sql`${ranked.rank} <= ${limit}`)).map((r) => r.id)
		;(sessionData as any).sessionMessages = ids.length
			? await db.select().from(m).where(inArray(m.id, ids)).orderBy(asc(m.id))
			: []
		olderIn = (
			await db
				.select({ channel: m.channel })
				.from(m)
				.where(where)
				.groupBy(m.channel)
				.having(sql`count(*) > ${limit}`)
		).map((r) => r.channel ?? "main")
	}

	const loadedCount = (sessionData as any).sessionMessages.length
	const hasMore =
		beforeId != null
			? loadedCount === limit // cursor mode: full page implies more exist
			: (olderIn?.length ?? 0) > 0 // initial load: a channel holds more than its page

	// Read here, for the asker alone: the session payload never carries the
	// drafts map, which holds every member's unsent text.
	const [draftRow] = await db
		.select({ drafts: schema.sessions.drafts })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const userDraft = draftRow?.drafts?.[String(userId)] || null

	// The parts-native half rides along (20 §13 phase 2): the client
	// renders from parts when present and falls back to the legacy
	// fields when not — the two are parity-identical by construction.
	if ((sessionData as any).sessionMessages?.length) {
		const { attachParts } = await import("$lib/server/messages/store")
		;(sessionData as any).sessionMessages = await attachParts(
			db,
			(sessionData as any).sessionMessages
		)
		// G5/G6/D64: the compiled prompt goes to `readsPrompt` viewers only.
		if (!(await readsPrompt(sessionId, userId)))
			(sessionData as any).sessionMessages = withoutDebugMeta(
				(sessionData as any).sessionMessages
			)
	}

	// 🚧 The session's channels as this viewer has them (`SessionV1.channels`,
	// INTEGRATING §1h): their own lane on each personal channel, and the
	// attention each asks of them.
	if (laneView) {
		try {
			const { sessionChannelsFor } = await import("$lib/server/channels/attention")
			;(sessionData as any).channels = await sessionChannelsFor(db, laneView)
		} catch (error) {
			console.warn("[sessions:get] channels view failed:", error)
		}
	}

	await withSessionExtras(sessionData, sessionId)

	// 🚧 Every run in progress, from the run registry (first page only).
	let runsInProgress: Sockets.Sessions.RunStatus.Response[] = []
	if (beforeId == null) {
		const { runsInProgressFor } = await import("$lib/server/pipelines/runtime/runsInProgress")
		runsInProgress = await runsInProgressFor(db, sessionId, userId)
	}

	return {
		session: sessionData as any,
		messages: (sessionData as any).sessionMessages || null,
		pagination: { total, hasMore, ...(olderIn ? { olderIn } : {}) },
		beforeId,
		userDraft,
		...(runsInProgress.length ? { runsInProgress } : {})
	}
}

/**
 * The asker's view of the session annex (R57, V1c): the values whose audience
 * holds for them, one object per owner — the catch-up for a page that opens or
 * reconnects. Every change is pushed under the same event, to each member
 * their own (`pushAnnexViews`). The annex itself never reaches a client.
 */
export const sessionsAnnexHandler: Handler<
	Sockets.Sessions.Annex.Params,
	Sockets.Sessions.Annex.Response
> = {
	event: "sessions:annex",
	handler: async (socket, params, emitToUser) => {
		const { annexViewFor } = await import("$lib/server/sessions/annexViews")
		const annex = await annexViewFor(db, params.sessionId, socket.user!.id)
		const res: Sockets.Sessions.Annex.Response =
			annex === null
				? { sessionId: params.sessionId, annex: {}, error: "No such session." }
				: { sessionId: params.sessionId, annex }
		emitToUser("sessions:annex", res)
		return res
	}
}

/**
 * 🚧 The asker's view of the lorebook annex their session reads (M0):
 * the lorebook twin of `sessionsAnnexHandler` — the catch-up for a page that
 * opens or reconnects; every change is pushed under the same event, to each
 * member their own (`pushLorebookAnnexViews`).
 */
export const sessionsLorebookAnnexHandler: Handler<
	Sockets.Sessions.LorebookAnnex.Params,
	Sockets.Sessions.LorebookAnnex.Response
> = {
	event: "sessions:lorebookAnnex",
	handler: async (socket, params, emitToUser) => {
		const { lorebookAnnexViewFor } = await import("$lib/server/lorebooks/annex")
		const annex = await lorebookAnnexViewFor(db, params.sessionId, socket.user!.id)
		const res: Sockets.Sessions.LorebookAnnex.Response =
			annex === null
				? { sessionId: params.sessionId, annex: {}, error: "No such session." }
				: { sessionId: params.sessionId, annex }
		emitToUser("sessions:lorebookAnnex", res)
		return res
	}
}

/**
 * The session data panel (owner-approved 2026-09-26): the whole annex laid
 * out against its owners' declarations, plus legacy keys. The session's
 * owner only (G6: an administrator in another's session is a guest) — anyone
 * else is refused by sentence, the same one whether the session is theirs to
 * see or absent. Never pushed:
 * the panel asks on open and on its refresh button.
 */
export const sessionsAnnexInspectHandler: Handler<
	Sockets.Sessions.AnnexInspect.Params,
	Sockets.Sessions.AnnexInspect.Response | undefined
> = {
	event: "sessions:annexInspect",
	handler: async (socket, params, emitToUser) => {
		const { inspectAnnex } = await import("$lib/server/sessions/annexInspect")
		const sessionId = Number(params?.sessionId)
		const out = await inspectAnnex(db, sessionId, { id: socket.user!.id })
		if (!out.ok) {
			emitToUser("sessions:annexInspect:error", { sessionId, error: out.error })
			return
		}
		emitToUser("sessions:annexInspect", out.result)
		return out.result
	}
}

/**
 * 🚧 `autoConvert` at open (M0, lane T4, the server half): the asker owns
 * the session, its genre says `rulesets.autoConvert: true`, and its pinned
 * version is not the published one → convert, then tell the session. A refusal
 * is logged, never shown: the session opens as it is. The notice is the client's.
 */
async function autoConvertRulesetAtOpen(socket: any, sessionId: number): Promise<{ from: string; to: string } | null> {
	try {
		const userId = socket.user!.id
		const [row] = await db
			.select({
				userId: schema.sessions.userId,
				genreId: schema.sessions.genreId,
				rulesetId: schema.sessions.primaryRuleset,
				pinned: schema.sessions.rulesetVersion
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!row || row.userId !== userId || !row.pinned) return null
		const genre = getGenre(row.genreId)
		if ((genre?.rulesets as { autoConvert?: boolean } | undefined)?.autoConvert !== true) return null
		const [published] = await db
			.select({ version: schema.rulesets.publishedVersion })
			.from(schema.rulesets)
			.where(eq(schema.rulesets.rulesetId, row.rulesetId))
			.limit(1)
		if (!published?.version || published.version === row.pinned) return null
		const { convertSessionRuleset } = await import("$lib/server/sessions/convertRuleset")
		const converted = await convertSessionRuleset(db, { sessionId, to: published.version, userId })
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await emitSessionEvent(db, {
			sessionId,
			userId,
			event: "core:event/ruleset-converted@1",
			payload: {
				sessionId,
				rulesetId: converted.rulesetId,
				from: converted.from,
				to: converted.to,
				slots: converted.slots,
				cause: { kind: "edit", userId }
			},
			io: socket.io
		})
		return { from: converted.from, to: converted.to }
	} catch (e) {
		console.warn("[sessions:get] autoConvert did not convert:", e instanceof Error ? e.message : e)
		return null
	}
}

export const sessionsGetHandler: Handler<
	Sockets.Sessions.Get.Params,
	Sockets.Sessions.Get.Response
> = {
	event: "sessions:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const converted = await autoConvertRulesetAtOpen(socket, params.id)
			const built = await buildSessionGetResponse(
				params.id,
				socket.user!.id,
				{ limit: params.limit, beforeId: params.beforeId }
			)
			const shown = await withEmbeddingStateFor(built, socket.user)
			const res = converted ? { ...shown, rulesetConverted: converted } : shown
			emitToUser("sessions:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching session:", error)
			emitToUser("sessions:get:error", {
				error: "Failed to fetch session"
			})
			throw error
		}
	}
}

export const sessionsAddGuestHandler: Handler<
	Sockets.Sessions.AddGuest.Params,
	Sockets.Sessions.AddGuest.Response
> = {
	event: "sessions:addGuest",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { sessionId, guestUserId } = params

			// Only session owner can add guests
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.isOwner) {
				const res: Sockets.Sessions.AddGuest.Response = {
					sessionId: params.sessionId,
					guestUserId: params.guestUserId,
					success: false,
					error: "Access denied. Only session owners can add guests."
				}
				emitToUser("sessions:addGuest", res)
				return res
			}

			// A soft-deleted user still has a real row (the FK alone wouldn't
			// catch this), so check explicitly rather than silently adding a
			// guest who can never actually authenticate as themselves again.
			//
			// This check and the "already a guest" one below deliberately
			// share one generic error message rather than their own specific
			// ones. Distinguishing "doesn't exist" from "already a guest"
			// from success lets any session owner (this is ownership-gated, not
			// admin-gated) binary-search valid user IDs on a multi-account
			// instance they otherwise have no visibility into — the picker
			// UI's own `users:list` call is admin-gated, but this handler
			// itself has never been, so a non-admin owner could still reach
			// this via a direct socket emission. A generic message closes
			// that oracle without changing the ownership check above, which
			// doesn't leak anything about other users.
			// A solo genre (`GenreDecl.members`, ruled 2026-10-19) seats nobody
			// else: the Guide's tools reach the app, so a guest there is a hole.
			{
				const { sessionMembersPolicy } = await import("$lib/server/sessions/members")
				if ((await sessionMembersPolicy(db, sessionId)) === "solo") {
					const res: Sockets.Sessions.AddGuest.Response = {
						sessionId: params.sessionId,
						guestUserId: params.guestUserId,
						success: false,
						error: "This kind of session is yours alone: nobody else can be added to it."
					}
					emitToUser("sessions:addGuest", res)
					return res
				}
			}

			const guestUser = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, guestUserId),
				columns: { id: true, isDeleted: true }
			})
			if (!guestUser || guestUser.isDeleted) {
				const res: Sockets.Sessions.AddGuest.Response = {
					sessionId: params.sessionId,
					guestUserId: params.guestUserId,
					success: false,
					error: "Unable to add this guest."
				}
				emitToUser("sessions:addGuest", res)
				return res
			}

			// Check if guest is already in the session
			const existingGuest = await db.query.sessionGuests.findFirst({
				where: and(
					eq(schema.sessionGuests.sessionId, sessionId),
					eq(schema.sessionGuests.userId, guestUserId)
				)
			})

			if (existingGuest) {
				const res: Sockets.Sessions.AddGuest.Response = {
					sessionId: params.sessionId,
					guestUserId: params.guestUserId,
					success: false,
					error: "Unable to add this guest."
				}
				emitToUser("sessions:addGuest", res)
				return res
			}

			// Add guest to session
			await db.insert(schema.sessionGuests).values({
				sessionId,
				userId: guestUserId,
				isPlayer: true
			})

			// Push a fresh session list to the newly-added guest — they aren't in
			// the session's own broadcast room yet (they haven't opened it), so
			// without this their sidebar wouldn't show the new session until a
			// manual refresh/reconnect.
			//
			// Lazy for the same reason as `relistSessions`, asked of the GUEST's
			// sockets rather than the caller's: a guest added while they have no
			// tab open has no sidebar to update, and learns about the session
			// from their next `sessions:list` request.
			await emitToUserRedacted(
				socket.io,
				guestUserId,
				"sessions:list",
				() => buildSessionsListFor(guestUserId)
			)

			// Broadcast updated session to all participants
			await broadcastSessionToParticipants(socket, sessionId, userId)
			// 🚧 A person joined: `member-added` as a seated persona's is, so a
			// genre bound to it (the Dungeon Crawler's welcome) runs. A guest
			// has no seat yet, so the reference is the person's, `user:<id>`.
			await emitMemberEvent(socket, {
				sessionId,
				userId,
				event: sessionEvents.memberAdded,
				ref: `user:${guestUserId}`
			})
			// A member joined (U5e, review W-A5): the new guest gets their own
			// list, and everyone else's audience verdicts may have moved.
			await (
				await import("$lib/server/sessions/actionsPush")
			).pushSessionActions(socket.io, sessionId)

			const res: Sockets.Sessions.AddGuest.Response = {
				sessionId: params.sessionId,
				guestUserId: params.guestUserId,
				success: true
			}
			emitToUser("sessions:addGuest", res)
			return res
		} catch (error: any) {
			console.error("Error adding guest to session:", error)
			const res: Sockets.Sessions.AddGuest.Response = {
				sessionId: params.sessionId,
				guestUserId: params.guestUserId,
				success: false,
				error: "Failed to add guest to session"
			}
			emitToUser("sessions:addGuest:error", res)
			throw error
		}
	}
}

export const sessionsRemoveGuestHandler: Handler<
	Sockets.Sessions.RemoveGuest.Params,
	Sockets.Sessions.RemoveGuest.Response
> = {
	event: "sessions:removeGuest",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { sessionId, guestUserId } = params

			// Only session owner can remove guests
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.isOwner) {
				const res: Sockets.Sessions.RemoveGuest.Response = {
					sessionId: params.sessionId,
					guestUserId: params.guestUserId,
					success: false,
					error: "Access denied. Only session owners can remove guests."
				}
				emitToUser("sessions:removeGuest", res)
				return res
			}

			// Remove guest from session — and bench their player seats in the
			// same transaction (owner 2026-11-10, ★3: removing a guest benches
			// the player seats they sat in; the lines keep their speaker).
			const seatChanges: SeatChange[] = []
			const removed = await db.transaction(async (tx) => {
				const deleted = await tx
					.delete(schema.sessionGuests)
					.where(
						and(
							eq(schema.sessionGuests.sessionId, sessionId),
							eq(schema.sessionGuests.userId, guestUserId)
						)
					)
					.returning({ userId: schema.sessionGuests.userId })
				if (!deleted.length) return deleted
				const seats = await tx
					.select({
						id: schema.sessionPersonas.id,
						cardOwner: schema.characters.userId
					})
					.from(schema.sessionPersonas)
					.leftJoin(
						schema.characters,
						eq(
							schema.characters.id,
							schema.sessionPersonas.personaId
						)
					)
					.where(
						and(
							eq(schema.sessionPersonas.sessionId, sessionId),
							isNull(schema.sessionPersonas.removedAt),
							or(
								eq(schema.sessionPersonas.userId, guestUserId),
								and(
									isNull(schema.sessionPersonas.userId),
									eq(schema.characters.userId, guestUserId)
								)
							)
						)
					)
					.orderBy(schema.sessionPersonas.id)
				for (const seat of seats) {
					const benched = await setSeatBench(tx as unknown as Db, {
						sessionId,
						kind: "player",
						seatId: seat.id,
						benched: true
					})
					if (!benched.ok) throw new Error(benched.refusal)
					seatChanges.push(...benched.changes)
					// A seat on the session owner's card goes back to the owner;
					// the guest's own card stays as it is.
					if (seat.cardOwner === userId)
						await handOverSeat(tx as unknown as Db, {
							sessionId,
							kind: "player",
							seatId: seat.id,
							fromUserId: guestUserId,
							toUserId: userId
						})
				}
				// A character seat the guest seated that holds the owner's card or
				// a card-less member goes back to the owner; the guest's own card
				// stays as it is.
				const held = await tx
					.select({
						id: schema.sessionCharacters.id,
						cardOwner: schema.characters.userId
					})
					.from(schema.sessionCharacters)
					.leftJoin(
						schema.characters,
						eq(
							schema.characters.id,
							schema.sessionCharacters.characterId
						)
					)
					.where(
						and(
							eq(schema.sessionCharacters.sessionId, sessionId),
							isNull(schema.sessionCharacters.removedAt),
							eq(schema.sessionCharacters.seatedByUserId, guestUserId)
						)
					)
				for (const seat of held) {
					if (seat.cardOwner === guestUserId) continue
					await handOverSeat(tx as unknown as Db, {
						sessionId,
						kind: "character",
						seatId: seat.id,
						fromUserId: guestUserId,
						toUserId: userId
					})
				}
				return deleted
			})
			if (seatChanges.length)
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId, userId },
					seatChanges
				)

			// A removed guest has nothing left to act on here. Never throws.
			await (
				await import("$lib/server/notifications/store")
			).clearNotifications(
				{
					regarding: `session:${sessionId}/`,
					prefix: true,
					userId: guestUserId
				},
				"superseded"
			)

			// Push a fresh session list to the removed guest so the session
			// disappears from their sidebar without a manual refresh. Lazy: a
			// removed guest with nothing open has no sidebar to correct, and
			// `sessions:removedAsGuest` below is what tells an open view.
			await emitToUserRedacted(
				socket.io,
				guestUserId,
				"sessions:list",
				() => buildSessionsListFor(guestUserId)
			)

			// Broadcast updated session to all remaining participants
			await broadcastSessionToParticipants(socket, sessionId, userId)
			// 🚧 A person left: `member-removed`, the add's mirror (`user:<id>`).
			if (removed.length)
				await emitMemberEvent(socket, {
					sessionId,
					userId,
					event: sessionEvents.memberRemoved,
					ref: `user:${guestUserId}`
				})

			// Also notify the removed guest that they've been removed
			socket.io
				.to(`user_${guestUserId}`)
				.emit("sessions:removedAsGuest", {
					sessionId
				})
			// A member left (U5e, review W-A5): the ones who remain relist.
			await (
				await import("$lib/server/sessions/actionsPush")
			).pushSessionActions(socket.io, sessionId)

			const res: Sockets.Sessions.RemoveGuest.Response = {
				sessionId: params.sessionId,
				guestUserId: params.guestUserId,
				success: true
			}
			emitToUser("sessions:removeGuest", res)
			return res
		} catch (error: any) {
			console.error("Error removing guest from session:", error)
			const res: Sockets.Sessions.RemoveGuest.Response = {
				sessionId: params.sessionId,
				guestUserId: params.guestUserId,
				success: false,
				error: "Failed to remove guest from session"
			}
			emitToUser("sessions:removeGuest:error", res)
			throw error
		}
	}
}

/**
 * 🚧 **Share as a lorebook** (pr-6, B §B-4). Pass 11: "Create lorebook from
 * session becomes Share as a lorebook (clears `session_id`, as today)." R-f:
 * "own books listed in their own section "Session notes", never in pickers;
 * Share as a lorebook moves one to the main list." The session's own book
 * becomes an ordinary lorebook — named, in the Lorebooks list from now on —
 * the session reads it, and a fresh own book takes its place. Owner-only;
 * refused for a session that already reads a lorebook (the other Share verbs
 * carry its notes).
 */
export const sessionsShareAsLorebookHandler: Handler<
	Sockets.Sessions.ShareAsLorebook.Params,
	Sockets.Sessions.ShareAsLorebook.Response
> = refusable(
	"sessions:shareAsLorebook",
	async (socket, params: Sockets.Sessions.ShareAsLorebook.Params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = params.sessionId
		const { shareAsLorebook } = await import("$lib/server/lorebooks/ownBook")
		const { SHARE_REFUSALS } = await import("$lib/shared/lorebooks/sessionNotes")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.isOwner) throw new Error(SHARE_REFUSALS.notOwner)
		const made = await shareAsLorebook(db, {
			sessionId,
			userId,
			name: typeof params.name === "string" ? params.name : null
		})
		const res: Sockets.Sessions.ShareAsLorebook.Response = {
			sessionId,
			lorebookId: made.lorebookId,
			name: made.name
		}
		emitToUser("sessions:shareAsLorebook", res)
		// The one toast, through the central `success` path (Layout).
		emitToUser("success", { title: `Shared as a lorebook: ${made.name}` } satisfies Sockets.Success.Response)
		// The book is in the main list now, out of Session notes, and the
		// session reads it.
		const { relistLorebooks, relistSessionNotes } = await import("./lorebooks")
		relistLorebooks(socket, emitToUser)
		relistSessionNotes(socket, emitToUser)
		await broadcastSessionToParticipants(socket, sessionId, userId)
		broadcastSessionRow(socket.io, sessionId)
		return res
	},
	"The session's notes could not be shared as a lorebook.",
	undefined,
	(p) => ({ sessionId: (p as any)?.sessionId })
)

/**
 * 🚧 What deleting this message does to the timeline (PLAN-rulesets §28),
 * asked before the delete confirmation opens: the session's On revision as
 * the confirmation's sentence ("This will overwrite the last turn." / "This
 * will branch here…"), or null when the delete is no revision (an ordinary
 * message, or a delete the server would refuse).
 */
export const sessionsRevisionNoticeHandler: Handler<
	Sockets.Sessions.RevisionNotice.Params,
	Sockets.Sessions.RevisionNotice.Response
> = refusable(
	"sessions:revisionNotice",
	async (socket, params: Sockets.Sessions.RevisionNotice.Params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess) throw new Error("This session is not one you are in.")
		const verdict = await turnDeleteVerdict(db, params.sessionId, params.messageId, userId)
		const res: Sockets.Sessions.RevisionNotice.Response = {
			sessionId: params.sessionId,
			messageId: params.messageId,
			revision: verdict && "revision" in verdict ? verdict.revision : null
		}
		emitToUser("sessions:revisionNotice", res)
		return res
	},
	"What this delete does could not be read."
)

export const sessionsBranchHandler: Handler<
	Sockets.Sessions.Branch.Params,
	Sockets.Sessions.Branch.Response
> = {
	event: "sessions:branch",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { sessionId, messageId, title } = params

			// Branching deep-copies the full message history into a brand
			// new session, unbounded by any rate limit — owner-only, same as
			// delete/guest-management, so a guest can't repeatedly grow the
			// owner's storage with sessions they never asked for. A guest
			// wanting their "own" copy can start a new session with the same
			// cast instead.
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.isOwner) {
				const res: Sockets.Sessions.Branch.Response = {
					error: "Access denied. Only session owners can branch sessions."
				}
				emitToUser("sessions:branch", res)
				return res
			}

			// The floor's enabled-when (U5e, review W2): not while a reply
			// is generating — the ⋮ menu's own greying, refused here.
			const branchRefusal = await verbEnablementRefusal(
				db,
				sessionId,
				"branch",
				{ messageId, userId }
			)
			if (branchRefusal) {
				const res: Sockets.Sessions.Branch.Response = {
					error: branchRefusal
				}
				emitToUser("sessions:branch", res)
				return res
			}

			/**
			 * The write is core's built-in (R-15): `branch-session` copies
			 * the cast, guests, tags and the history up to the fork message
			 * into a new session, emits `session-branched` and records it as
			 * the new session's first change. A floor — every genre has it.
			 */
			const { runBuiltIn, writtenId } = await import(
				"$lib/server/pipelines/runtime/builtins"
			)
			const branched = await runBuiltIn(db, {
				kind: "branch",
				sessionId,
				actor: userId,
				payload: { fromMessage: messageId, title: title ?? null },
				io: socket.io
			})
			const newSessionId = writtenId(branched.write)
			if (!branched.ok || newSessionId === null) {
				const res: Sockets.Sessions.Branch.Response = {
					error: branched.error ?? "Failed to branch session"
				}
				emitToUser("sessions:branch", res)
				return res
			}

			// Fetch the complete new session with messages
			const branchedSession = await getSessionFromDB(
				newSessionId,
				userId
			)
			if (!branchedSession) {
				throw new Error("Failed to fetch branched session")
			}

			// Refresh session list. The copy's history came with it, so the new
			// row has a line to quote from its first moment.
			await relistWithRow(socket, emitToUser, newSessionId)

			const res: Sockets.Sessions.Branch.Response = {
				session: branchedSession as any
			}
			emitToUser("sessions:branch", res)
			return res
		} catch (error: any) {
			console.error("Error branching session:", error)
			const res: Sockets.Sessions.Branch.Response = {
				error: "Failed to branch session"
			}
			emitToUser("sessions:branch:error", res)
			throw error
		}
	}
}

/**
 * Who a side-character turn may be spoken by (ruling 2026-09-07).
 *
 * The dropdown half of the trigger's first step; the free-form half needs no
 * list, which is exactly why both are offered. Owner-only, like the trigger it
 * feeds — this enumerates the person's own characters, and a guest listing the
 * owner's roster is a different question from a guest reading the session.
 *
 * ⚠ Reading this list changes nothing. It is not a membership offer: choosing
 * somebody here names a voice for one turn and never writes a cast row.
 */
export const sessionsSideCharacterOptionsHandler: Handler<
	Sockets.Sessions.SideCharacterOptions.Params,
	Sockets.Sessions.SideCharacterOptions.Response
> = {
	event: "sessions:sideCharacterOptions",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess || !access.isOwner) {
			const denied = {
				sessionId: params.sessionId,
				characters: [],
				error: "Session not found."
			}
			emitToUser("sessions:sideCharacterOptions", denied)
			return denied
		}
		const { listSideCharacterOptions } = await import(
			"$lib/server/pipelines/entities/sideCharacter"
		)
		const res: Sockets.Sessions.SideCharacterOptions.Response = {
			sessionId: params.sessionId,
			characters: await listSideCharacterOptions(
				db,
				params.sessionId,
				userId
			)
		}
		emitToUser("sessions:sideCharacterOptions", res)
		return res
	}
}

/**
 * Star or unstar a session. Owner only: a favourite is the owner's own mark,
 * like a character's, and a guest has no row of theirs to put it on.
 */
export const sessionsSetFavoriteHandler: Handler<
	Sockets.Sessions.SetFavorite.Params,
	Sockets.Sessions.SetFavorite.Response
> = {
	event: "sessions:setFavorite",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.isOwner) {
			const error = "Only the session's owner can star it."
			emitToUser("sessions:setFavorite:error", { error })
			throw new Error(error)
		}
		await db
			.update(schema.sessions)
			.set({ isFavorite: !!params.isFavorite })
			.where(eq(schema.sessions.id, params.sessionId))
		const res: Sockets.Sessions.SetFavorite.Response = {
			sessionId: params.sessionId,
			isFavorite: !!params.isFavorite
		}
		emitToUser("sessions:setFavorite", res)
		return res
	}
}

// Lets the client label the Narrator trigger button/modal correctly BEFORE any
// message exists (e.g. a session-specific narrator name like "Fate" instead of
// the default "Narrator"). Intentionally not admin-gated — any session
// participant (owner or guest) needs to see this, unlike the pipeline panel
// that configures the name.
export const sessionsGetNarratorNameHandler: Handler<
	Sockets.Sessions.GetNarratorName.Params,
	Sockets.Sessions.GetNarratorName.Response
> = {
	event: "sessions:getNarratorName",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess) {
			return { sessionId: params.sessionId, narratorName: "Narrator" }
		}

		const { narratorNameFor } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const narratorName = await narratorNameFor(
			db,
			params.sessionId,
			userId
		).catch(() => null)
		const res: Sockets.Sessions.GetNarratorName.Response = {
			sessionId: params.sessionId,
			narratorName: narratorName || "Narrator"
		}
		emitToUser("sessions:getNarratorName", res)
		return res
	}
}

/**
 * Type-safe handler for toggling session character active status
 */
/**
 * The session's envoys as the client sees them (R-18; U5g): declared by the
 * genre or an installed action, display text in the viewer's language,
 * `seated` from the live cast rows. Shared by `sessions:view` and the seat
 * toggle's ack so the two cannot disagree.
 */
async function viewEnvoys(
	sessionId: number,
	userId: number
): Promise<Sockets.Sessions.View.Envoy[]> {
	const { sessionDeclaredEnvoys } = await import(
		"$lib/server/pipelines/entities/envoys"
	)
	const { resolveUserLanguage } = await import("$lib/server/i18n")
	const { i18nTextIn } = await import("$lib/shared/i18n/i18nText")
	const [declared, seats, language] = await Promise.all([
		sessionDeclaredEnvoys(db, sessionId),
		db
			.select({ envoySlug: schema.sessionCharacters.envoySlug })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt)
				)
			),
		resolveUserLanguage(userId)
	])
	const seated = new Set(seats.map((r) => r.envoySlug).filter(Boolean))
	return declared.map((d) => ({
		slug: d.slug,
		origin: d.origin,
		name: i18nTextIn(d.name, language.code) ?? d.slug,
		...((t) => (t ? { description: t } : {}))(
			i18nTextIn(d.description, language.code)
		),
		...(d.image ? { image: d.image } : {}),
		speaks: d.speaks,
		default: d.default,
		...(d.fallback ? { fallback: true } : {}),
		seated: seated.has(d.slug)
	}))
}

/**
 * Seat or unseat one of the genre's envoys (R-18; U5g) — the Edit Session
 * form's toggle. Owner only, like adding a character. An action's envoy is
 * seated by its action's post and is refused here; a genre's `default`
 * envoy may still be unseated — the default is what a new session starts
 * with, not a floor.
 */
export const sessionsSetEnvoySeatHandler: Handler<
	Sockets.Sessions.SetEnvoySeat.Params,
	Sockets.Sessions.SetEnvoySeat.Response
> = {
	event: "sessions:setEnvoySeat",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const refuse = (error: string) => {
			const res = {
				sessionId: params.sessionId,
				slug: params.slug,
				seated: false,
				error
			}
			emitToUser("sessions:setEnvoySeat", res)
			return res
		}
		try {
			const access = await checkSessionAccess(params.sessionId, userId)
			if (!access.hasAccess) return refuse("Session not found.")
			if (!access.isOwner)
				return refuse(
					"Access denied. Only the session owner can seat an envoy."
				)
			const { sessionDeclaredEnvoys, seatEnvoy, unseatEnvoy } =
				await import("$lib/server/pipelines/entities/envoys")
			const decl = (await sessionDeclaredEnvoys(db, params.sessionId)).find(
				(d) => d.slug === params.slug
			)
			if (!decl)
				return refuse(
					"That envoy is not one this session's genre declares."
				)
			if (decl.origin === "action")
				return refuse(
					"An action's envoy is seated by the action itself when it posts; there is nothing to toggle."
				)
			const changed = params.seated
				? await seatEnvoy(db, params.sessionId, params.slug)
				: await unseatEnvoy(
						db,
						params.sessionId,
						params.slug,
						i18nText(decl.name) ?? null
					)
			// A seat is a member change (R31): the envoy joins or leaves
			// under the person's settings cause, as a character would — and
			// only when the seat actually moved (a repeated press is none).
			if (changed) await emitMemberEvent(socket, {
				sessionId: params.sessionId,
				userId,
				event: params.seated ? sessionEvents.memberAdded : sessionEvents.memberRemoved,
				ref: `envoy:${params.slug}`
			})
			const res = {
				sessionId: params.sessionId,
				slug: params.slug,
				seated: params.seated
			}
			emitToUser("sessions:setEnvoySeat", res)
			// The list every reader renders from, refreshed with the seat —
			// the view handler emits `sessions:view` itself.
			await sessionsViewHandler.handler(
				socket,
				{ sessionId: params.sessionId },
				emitToUser
			)
			return res
		} catch (error) {
			console.error("Error in sessionsSetEnvoySeatHandler:", error)
			return refuse(
				error instanceof Error ? error.message : "Failed to seat envoy."
			)
		}
	}
}

/**
 * A member joined or left (PLAN-turn-order R31): `member-added` /
 * `member-removed` through the one emitter, with the cast-change payload
 * (`change: 'added' | 'removed'`) under the person's `settings` cause.
 * Best-effort: the seat has landed. For envoys and
 * guests only — a character or player seat goes through `announceSeatChanges`
 * (`sessions/seats.ts`), which the seat writer's changes feed.
 */
async function emitMemberEvent(
	socket: { io: SessionIo },
	member: { sessionId: number; userId: number; event: string; ref: string }
): Promise<void> {
	try {
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		await emitSessionEvent(db, {
			sessionId: member.sessionId,
			userId: member.userId,
			event: member.event,
			payload: {
				sessionId: member.sessionId,
				ref: member.ref,
				change: member.event === sessionEvents.memberAdded ? "added" : "removed",
				cause: { kind: "settings", userId: member.userId }
			},
			io: socket.io
		})
	} catch (err) {
		console.warn(`${member.event} emit failed:`, err)
	}
}

export function registerSessionHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsListHandler, emitToUser)
	register(socket, sessionsTypingHandler, emitToUser)
	register(socket, sessionsCreateHandler, emitToUser)
	register(socket, sessionsDeleteHandler, emitToUser)
	register(socket, sessionsGetHandler, emitToUser)
	register(socket, sessionsAnnexHandler, emitToUser)
	register(socket, sessionsLorebookAnnexHandler, emitToUser)
	register(socket, sessionsAnnexInspectHandler, emitToUser)
	register(socket, sessionsModesHandler, emitToUser)
	register(socket, sessionsGenreOfHandler, emitToUser)
	register(socket, sessionsActionsHandler, emitToUser)
	register(socket, sessionsActionsSeenHandler, emitToUser)
	register(socket, sessionsViewHandler, emitToUser)
	register(socket, sessionsPanelLayoutGetHandler, emitToUser)
	register(socket, sessionsMessagesPageHandler, emitToUser)
	register(socket, sessionsChannelLanesHandler, emitToUser)
	register(socket, sessionsLaneReadHandler, emitToUser)
	register(socket, sessionsPanelLayoutSetHandler, emitToUser)
	register(socket, sessionsPanelLayoutStartFromHandler, emitToUser)
	register(socket, sessionsPanelLayoutStartedFromUpdatedHandler, emitToUser)
	register(socket, sessionsLayoutPresetSaveHandler, emitToUser)
	register(socket, sessionsLayoutPresetRenameHandler, emitToUser)
	register(socket, sessionsLayoutPresetDeleteHandler, emitToUser)
	register(socket, sessionsLayoutPresetUsageHandler, emitToUser)
	register(socket, sessionsLayoutPresetShareHandler, emitToUser)
	register(socket, sessionsLayoutPresetCloneHandler, emitToUser)
	register(socket, sessionsLayoutPresetUpdateHandler, emitToUser)
	register(socket, sessionsLayoutPresetSetNewSessionLayoutHandler, emitToUser)
	register(socket, sessionsPipelinesHandler, emitToUser)
	register(socket, sessionsPresetStatusHandler, emitToUser)
	register(socket, sessionsSetSessionPresetHandler, emitToUser)
	register(socket, sessionsFireActionHandler, emitToUser)
	register(socket, sessionsFunctionsHandler, emitToUser)
	register(socket, sessionsSetFunctionHandler, emitToUser)
	register(socket, sessionsUpgradeModeHandler, emitToUser)
	register(socket, sessionsConvertRulesetHandler, emitToUser)
	register(socket, sessionsFunctionCandidatesHandler, emitToUser)
	register(socket, sessionsBindFunctionHandler, emitToUser)
	// The generic session-scope rebind (PLAN-turn-order §4.7): what a node
	// may become, and setting it. The Turn order control is one caller.
	register(socket, sessionsNodeSwapOptionsHandler, emitToUser)
	register(socket, sessionsSetNodeRebindHandler, emitToUser)
	register(socket, sessionsPipelineCardsHandler, emitToUser)
	register(socket, sessionsSaveDraftHandler, emitToUser)
	register(socket, sessionsUpdateHandler, emitToUser)
	register(socket, sessionsAddPersonaHandler, emitToUser)
	register(socket, sessionsAddGuestHandler, emitToUser)
	register(socket, sessionsRemoveGuestHandler, emitToUser)
	register(socket, sessionsBranchHandler, emitToUser)
	register(socket, sessionsShareAsLorebookHandler, emitToUser)
	register(socket, sessionsOverlayItemsHandler, emitToUser)
	register(socket, sessionsApplyOverlayHandler, emitToUser)
	register(socket, sessionsAppliedBatchesHandler, emitToUser)
	register(socket, sessionsTakeBackApplyHandler, emitToUser)
	register(socket, sessionsRevisionNoticeHandler, emitToUser)
	register(socket, sessionsReassignRemovedParticipantHandler, emitToUser)
	register(socket, sessionMessagesSendPersonaMessageHandler, emitToUser)
	register(socket, sessionMessagesUpdateHandler, emitToUser)
	register(socket, sessionMessagesDeleteHandler, emitToUser)
	register(socket, sessionMessagesRegenerateHandler, emitToUser)
	register(socket, sessionMessagesExtendHandler, emitToUser)
	register(socket, sessionMessagesSwipeLeftHandler, emitToUser)
	register(socket, sessionMessagesSwipeRightHandler, emitToUser)
	// Firing a prepared turn (§4.7) — Continue, and the picker.
	register(socket, sessionsFireTurnHandler, emitToUser)
	// Regenerate the last turn, as a whole (lair pass R2).
	register(socket, sessionsRetakeTurnHandler, emitToUser)
	// 🚧 Back · Forward (RF fix 5).
	register(socket, sessionsRewindTurnHandler, emitToUser)
	register(socket, sessionsForwardTurnHandler, emitToUser)
	register(socket, sessionMessagesCancelHandler, emitToUser)
	register(socket, sessionMessageHandler, emitToUser)
	register(socket, promptTokenCountHandler, emitToUser)
	register(socket, fireNarratorResponseHandler, emitToUser)
	register(socket, sessionsGetNarratorNameHandler, emitToUser)
	register(socket, sessionsSetFavoriteHandler, emitToUser)
	register(socket, sessionsSideCharacterOptionsHandler, emitToUser)
	register(socket, sessionsSetCastSeatEnabledHandler, emitToUser)
	register(socket, sessionsSetEnvoySeatHandler, emitToUser)
	register(socket, sessionsAccountVisibilityHandler, emitToUser)
	register(socket, sessionsCastToTakeHandler, emitToUser)
}
