import { storedSwapsOf, type StoredSwapContribution } from "$lib/shared/swaps"

import { randomUUID } from "node:crypto"
import {
	envoySlugOfRef,
	i18nText,
	sessionEvents,
	resolveWidgetSurface,
	isServableEntry,
	getGenre,
	pluginWidgetId,
	CONVERSATION_WIDGET_ID,
	WIDGET_SCOPED_SECTIONS,
	type WidgetDecl,
	type WidgetSurface
} from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { declaredWidgetReads } from "$lib/shared/widgets/reads"
import {
	insertLegacy,
	updateLegacyWhere,
	hasNativeSteps
} from "$lib/server/messages/store"
import {
	extendVerbRefusal,
	pressedTurnControl,
	resolveMessageVerbs,
	turnControlRefusal,
	unpreparedEntryRefusal,
	verbEnablementRefusal,
	verbRefusal
} from "$lib/server/messages/verbs"
import { resolveWrites } from "$lib/server/messages/writes"
import { canActOnMessage } from "$lib/server/messages/permissions"
import { withSessionActionsChain } from "$lib/server/sessions/actionsPush"
import {
	DEFAULT_CHANNEL,
	canonicalChannel,
	channelRefusal,
	channelWhere,
	channelDeclsOf,
	channelsOf
} from "$lib/server/messages/channels"
import { widgetOfInstance } from "$lib/shared/widgets/instanceId"
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNull,
	lt,
	or
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { resolveOrCreateBindingRow } from "$lib/server/utils/characterBindingSync"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"
import { lastVisibleMessages } from "$lib/server/sessions/rowProjection"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"

/** At most this many swaps are seeded at create — one per node, and nodes are few (M2 review). */
const MAX_SEEDED_SWAPS = 32

/**
 * `characters`, joined a SECOND time as the voiced side.
 *
 * `session_messages.persona_id` and `session_personas.persona_id` both point at
 * `characters`, so a query that reads the cast AND the voice has to name the
 * table twice — one join cannot answer for both, and without the alias the
 * second one silently overwrites the first.
 */
const voicedCharacter = alias(schema.characters, "voiced_character")
// Replacing a message is not deleting one, so the anchor cascade cannot fire —
// see the call sites in the regenerate and swipe-right handlers.
import { retractStateAnchoredTo } from "$lib/server/state/write"
import { runReply } from "../utils/runReply"
import { clearReplyFailed } from "../utils/generationStatus"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import { InterpolationEngine } from "../utils/interpolation/InterpolationEngine"
import { dev } from "$app/environment"
import type { Handler } from "$lib/shared/events"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { RunProgress } from "$lib/shared/sockets/progress"
import { getUserConfigurations } from "../utils/getUserConfigurations"
import { resolveTaskConfig } from "../utils/resolveTaskConfig"
import { resolveNarratorPromptConfig } from "../utils/resolveNarratorPromptConfig"
import { llmQueue } from "../utils/llmQueue"
import {
	broadcastToSessionUsers,
	createSessionBroadcaster,
	emitToUserRedacted
} from "./utils/broadcastHelpers"
import { relistBindings } from "./lorebooks"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	canApplyLayoutPreset,
	deleteUserLayoutPreset,
	layoutPresetUsage,
	listLayoutPresets,
	renameUserLayoutPreset,
	resolveActivePresetLayout,
	saveUserLayoutPreset
} from "$lib/server/db/layoutPresets"
import {
	readWidgetSettings,
	storedWidgetSlugs,
	writeWidgetSettings
} from "$lib/server/db/widgetSettings"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"
import { withSessionGenerationLock } from "$lib/server/utils/sessionGenerationLock"
import type { SideCharacterFact } from "$lib/server/pipelines/entities/sideCharacter"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import {
	MAX_CHAT_MESSAGE_LENGTH,
	MAX_NARRATOR_INSTRUCTIONS_LENGTH
} from "$lib/shared/constants/MessageLimits"

// ===== SECURITY HELPERS =====

/**
 * Check if user owns a character
 */
async function checkCharacterOwnership(
	characterId: number,
	userId: number
): Promise<boolean> {
	const character = await db.query.characters.findFirst({
		where: (c, { and, eq }) =>
			and(eq(c.id, characterId), eq(c.userId, userId)),
		columns: { id: true }
	})

	return !!character
}

/**
 * Check if user owns a persona
 */
async function checkPersonaOwnership(
	personaId: number,
	userId: number
): Promise<boolean> {
	const persona = await db.query.characters.findFirst({
		where: (p, { and, eq }) =>
			and(eq(p.id, personaId), eq(p.userId, userId)),
		columns: { id: true }
	})

	return !!persona
}

/**
 * Batch version of checkCharacterOwnership — returns the subset of the given
 * ids actually owned by userId. Validates newly-added sessionCharacters
 * without an ownership query per id.
 */
async function checkCharactersOwnership(
	characterIds: number[],
	userId: number
): Promise<Set<number>> {
	if (characterIds.length === 0) return new Set()
	const owned = await db.query.characters.findMany({
		where: (c, { and, eq, inArray }) =>
			and(inArray(c.id, characterIds), eq(c.userId, userId)),
		columns: { id: true }
	})
	return new Set(owned.map((c) => c.id))
}

/**
 * Batch version of checkPersonaOwnership.
 */
async function checkPersonasOwnership(
	personaIds: number[],
	userId: number
): Promise<Set<number>> {
	if (personaIds.length === 0) return new Set()
	const owned = await db.query.characters.findMany({
		where: (p, { and, eq, inArray }) =>
			and(inArray(p.id, personaIds), eq(p.userId, userId)),
		columns: { id: true }
	})
	return new Set(owned.map((p) => p.id))
}

/**
 * lorebooks is a strictly per-user table — a session's lorebookId must belong
 * to the requesting user, or a session could pull another user's private
 * lore into its prompts and its binding-sync writes.
 */
async function checkLorebookOwnership(
	lorebookId: number,
	userId: number
): Promise<boolean> {
	const lorebook = await db.query.lorebooks.findFirst({
		where: (l, { and, eq }) =>
			and(eq(l.id, lorebookId), eq(l.userId, userId)),
		columns: { id: true }
	})
	return !!lorebook
}

// `checkMessageEditPermission` stood here — the item rule, evaluated on the
// id the handler saw. It lives in `messages/permissions.ts` since 2026-09-16
// (U5b review C1) so the host's commit can evaluate the same rule on the id
// the write is about to use.

// Helper function to process tags for session creation/update
async function processSessionTags(
	sessionId: number,
	tagNames: string[],
	userId: number,
	dbOrTx: Db = db
) {
	// Get existing tags for this session that belong to the user
	const existingSessionTags = await dbOrTx.query.sessionTags.findMany({
		where: eq(schema.sessionTags.sessionId, sessionId),
		with: {
			tag: true
		}
	})

	// Filter to only tags that belong to this user
	const userSessionTags = existingSessionTags.filter(
		(ct) => ct.tag.userId === userId
	)
	const existingTagNames = userSessionTags.map((ct) => ct.tag.name)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userSessionTags.filter(
		(ct) => !normalizedNewTags.includes(ct.tag.name)
	)

	// Find tags to add (exist in new list but not in DB)
	const tagsToAdd = normalizedNewTags.filter(
		(tagName) => !existingTagNames.includes(tagName)
	)

	// Remove tags that are not in the new list
	if (tagsToRemove.length > 0) {
		const tagIdsToRemove = tagsToRemove.map((ct) => ct.tagId)
		await dbOrTx
			.delete(schema.sessionTags)
			.where(
				and(
					eq(schema.sessionTags.sessionId, sessionId),
					inArray(schema.sessionTags.tagId, tagIdsToRemove)
				)
			)
	}

	// Add new tags — findOrCreateTagId adopts an existing case-insensitive
	// match instead of duplicating it (tags_user_id_name_unique).
	for (const tagName of tagsToAdd) {
		const tagId = await findOrCreateTagId(userId, tagName, dbOrTx)
		if (tagId == null) continue

		// Link tag to session
		await dbOrTx
			.insert(schema.sessionTags)
			.values({
				sessionId,
				tagId
			})
			.onConflictDoNothing()
	}
}

/**
 * The actual sessions:list query, pulled out of the handler below so it can be
 * called for a user who isn't the current socket's own caller — e.g. pushing
 * a fresh list to a user who was just added/removed as a guest by someone
 * else's request. Reusing sessionsListHandler.handler itself for that would
 * mean building a synthetic socket/emitToUser standing in for a real caller,
 * which only works until the handler ever reads something else off socket
 * (auth context, query params) — an invisible break at that point. This way
 * there's nothing to keep honest: both call sites just call a plain function
 * and emit the result themselves.
 */
async function buildSessionsListFor(
	userId: number
): Promise<Sockets.Sessions.List.Response> {
	// sessions:list only returns ROLEPLAY sessions
	const sessionType = SessionTypes.ROLEPLAY
	console.log(
		"Fetching sessions for user:",
		userId,
		"sessionType:",
		sessionType
	)

	// First, find all sessions where the current user is a guest
	const guestSessions = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.userId, userId),
		columns: {
			sessionId: true
		}
	})

	const guestSessionIds = guestSessions.map((gc) => gc.sessionId)
	console.log("User is guest in session IDs:", guestSessionIds)

	const sessionsList = await db.query.sessions.findMany({
		with: {
			sessionCharacters: {
				with: {
					// `character` columns are limited to id/name/avatar — the
					// seat's own columns ride alongside this relation.
					character: {
						columns: {
							id: true,
							name: true,
							avatarMediaId: true
						},
						with: {
							avatarMedia: {
								columns: { uuid: true, rev: true }
							}
						}
					}
				},
				orderBy: asc(schema.sessionCharacters.position)
			},
			sessionPersonas: {
				with: {
					// Same trimmed subset as `character` above.
					persona: {
						columns: {
							id: true,
							name: true,
							avatarMediaId: true
						},
						with: {
							avatarMedia: {
								columns: { uuid: true, rev: true }
							}
						}
					}
				},
				orderBy: asc(schema.sessionPersonas.position)
			},
			sessionTags: {
				with: {
					tag: true
				}
			}
		},
		// Build the where clause: user owns the session OR user is a guest in
		// the session, AND filter by session type. Inlined (rather than a
		// standalone const) so drizzle's contextual typing can infer the
		// callback's parameter types.
		where: (c, { or, eq, inArray, and }) =>
			guestSessionIds.length > 0
				? and(
						or(
							eq(c.userId, userId),
							inArray(c.id, guestSessionIds)
						),
						eq(c.sessionType, sessionType)
					)
				: and(eq(c.userId, userId), eq(c.sessionType, sessionType)),
		orderBy: desc(schema.sessions.updatedAt),
		// Pipeline state and every member's unsent drafts never ride a list (V1a).
		columns: { annex: false, annexAudiences: false, drafts: false }
	})

	// isOwner/isGuest let the client show the right menu affordances:
	// owners get full edit + delete, guests get a scoped edit (characters/
	// personas/guests only — enforced server-side in sessionsUpdateHandler,
	// not just hidden client-side). canEdit kept for back-compat meaning
	// "can open the edit menu at all" (owner or guest), not "owns the session".
	// The mode display name per session — the "type" the card shows (Chat,
	// or a custom mode). One registry read, mapped; best-effort, so a
	// registry that never synced just leaves the label off.
	const { listSessionGenres, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genreNames = new Map(
		(await listSessionGenres(db).catch(() => [])).map((m) => [
			m.genreId,
			m.name
		])
	)

	// The last line and the message count for every listed session.
	//
	// TWO grouped reads for the whole list, never one per session: this
	// function runs on every `sessions:list` and on every cascade behind a
	// write, so a per-row query would be a round trip per card on a list that
	// is already the app's widest read.
	//
	// The last line is unscoped by channel, deliberately: it must be the line
	// the session PAGE shows last, and that read (`getSessionFromDB`) is
	// unscoped too. The channel-scoped read is the prompt path's, which is a
	// different question.
	const sessionIds = sessionsList.map((s) => s.id)
	const messageCounts = new Map<number, number>()
	const lastMessages = new Map<number, Sockets.Sessions.List.LastMessage>()
	if (sessionIds.length > 0) {
		const countRows = await db
			.select({
				sessionId: schema.sessionMessages.sessionId,
				n: count()
			})
			.from(schema.sessionMessages)
			.where(inArray(schema.sessionMessages.sessionId, sessionIds))
			.groupBy(schema.sessionMessages.sessionId)
		for (const row of countRows) messageCounts.set(row.sessionId, row.n)

		// The last visible line per session, from the projection the
		// `sessions:rowChanged` push reads too (`sessions/rowProjection.ts`):
		// one DISTINCT ON for the whole list, and the same three exclusions
		// on both paths.
		for (const [id, last] of await lastVisibleMessages(db, sessionIds))
			lastMessages.set(id, last)
	}

	// What each session's run in flight is doing right now (R-19) — the
	// registry's word, so a list built while a reply is being written says
	// *Jasmine is typing* on that row and `sessions:runStatus` keeps it current
	// from there. Absent on a session with nothing running.
	const { statusesBySession } = await import(
		"$lib/server/pipelines/runtime/runRegistry"
	)
	const runStatuses = statusesBySession()

	const sessionsWithEditPermission = sessionsList.map((session) => {
		const isOwner = session.userId === userId
		const isGuest = !isOwner && guestSessionIds.includes(session.id)
		return {
			...session,
			isOwner,
			isGuest,
			canEdit: isOwner || isGuest,
			genreName:
				genreNames.get(session.genreId ?? STANDARD_GENRE_ID) ?? "Chat",
			messageCount: messageCounts.get(session.id) ?? 0,
			// Omitted rather than null when there is nothing to show, so
			// `lastMessage ?` reads as "has a line" at every call site.
			...(lastMessages.has(session.id)
				? { lastMessage: lastMessages.get(session.id)! }
				: {}),
			...(runStatuses.has(session.id)
				? { runStatus: runStatuses.get(session.id)! }
				: {}),
			// sessionCharacters/sessionPersonas rows can have a null character/
			// persona when the linked row was deleted (the FK is nullable,
			// onDelete: "set null") — filter those out, matching the same
			// fix in dispatch.ts's `loadAdapterSession`.
			sessionCharacters: session.sessionCharacters.filter(
				(
					cc
				): cc is typeof cc & {
					character: NonNullable<typeof cc.character>
				} => cc.character !== null
			),
			sessionPersonas: session.sessionPersonas.filter(
				(
					cp
				): cp is typeof cp & {
					persona: NonNullable<typeof cp.persona>
				} => cp.persona !== null
			)
		}
	})

	return { sessionList: sessionsWithEditPermission }
}

/**
 * A cast character's sprites, as far as a session needs them to draw a face
 * (DESIGN-sprites §7): set name and default flag, and each sprite's label,
 * variant order and file address. Empty sprites (no file) are left out — a
 * slot waiting for an image has nothing to draw.
 */
const SESSION_SPRITE_SETS = {
	columns: { name: true, isDefault: true },
	with: {
		sprites: {
			columns: { label: true, position: true },
			where: (sp: any, { isNotNull }: any) => isNotNull(sp.fileId),
			with: { file: { columns: { uuid: true, rev: true } } }
		}
	}
} as const

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
 * The session list, re-sent to the caller after a mutation that changed it.
 *
 * The LAZY form (socket-interest plan, ruling 4): `sessions:list` is the
 * multi-relation read above — every session with its cast, its personas and its
 * tags — and the cascades below are pushes, not replies. So a create, a rename
 * or a function run made from a surface that shows no session list (the session
 * page itself, a trigger, the layout editor) pays for no re-list at all.
 * Skipping the emit alone would save nothing; the query is the cost.
 *
 * Handed the socket rather than a user id because the recipient is always the
 * caller: `buildSessionsListFor` exists for the other case (a guest somebody
 * else just added), and that one goes through `emitToUserRedacted`.
 */
function relistSessions(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("sessions:list", () =>
		buildSessionsListFor(socket.user!.id)
	)
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
				const persona = await db.query.characters.findFirst({
					where: eq(schema.characters.id, params.personaId),
					columns: { id: true, name: true }
				})
				if (!persona) return null
				return {
					sessionId: params.sessionId,
					personaId: persona.id,
					personaName: persona.name
				} satisfies Sockets.Sessions.UserTyping.Response
			}
		)

		const res: Sockets.Sessions.Typing.Response = { success: true }
		return res
	}
}

export const sessionsCreateHandler: Handler<
	Sockets.Sessions.Create.Params,
	Sockets.Sessions.Create.Response
> = {
	event: "sessions:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const tags = params.tags || []
		const personaIds = params.personaIds || []
		const characterIds = params.characterIds || []
		const characterPositions = params.characterPositions || {}

		// A new session has no existing characters/personas to diff against — every
		// id supplied here must belong to the requesting user.
		if (characterIds.length > 0) {
			const ownedCharacterIds = await checkCharactersOwnership(
				characterIds,
				userId
			)
			if (ownedCharacterIds.size !== characterIds.length) {
				throw new Error(
					"Access denied. You can only add characters you own."
				)
			}
		}
		if (personaIds.length > 0) {
			const ownedPersonaIds = await checkPersonasOwnership(
				personaIds,
				userId
			)
			if (ownedPersonaIds.size !== personaIds.length) {
				throw new Error(
					"Access denied. You can only add personas you own."
				)
			}
		}
		if (params.session.lorebookId != null) {
			const ownsLorebook = await checkLorebookOwnership(
				params.session.lorebookId,
				userId
			)
			if (!ownsLorebook) {
				throw new Error(
					"Access denied. You can only attach a lorebook you own."
				)
			}
		}

		/**
		 * A refusal the person can act on — a preset or genre an
		 * administrator has hidden, the genre's shape not met, a genre this
		 * build does not register. Emitted as this handler's specific error
		 * and returned, never thrown: the catch-all in `sockets/index.ts`
		 * replaces a thrown message with a constant on purpose, and the
		 * sentence is the one thing the start screen has to show. Same form
		 * as the `sessions:fireTurn` refusals below. The ownership
		 * checks above stay throws: those are access denials, not choices.
		 */
		const refuse = (error: string): Sockets.Sessions.Create.Response => {
			emitToUser("sessions:create:error", { error })
			return { error }
		}

		// Preset resolution (23 §9): when the client starts from a preset, the
		// preset picks the type — the server derives genreId from it (never
		// trusting a client-supplied pair to agree) and refuses presets or
		// types an admin has hidden. An absent settings row means available:
		// types are visible until someone hides them, same as sessionAdmin.
		/** The preset's pre-seated envoys (`defaults.envoys`, R-18), by slug. */
		let presetEnvoys: string[] = []
		/** The preset's seeded swaps (`defaults.swaps`, R40). */
		let presetSwaps: StoredSwapContribution[] = []
		{
			const presetId = (params.session as any).presetId ?? null
			if (presetId != null) {
				const [preset] = await db
					.select()
					.from(schema.sessionPresets)
					.where(eq(schema.sessionPresets.id, presetId))
					.limit(1)
				// Withdrawn beside disabled (0119): a preset whose plugin is
				// gone cannot start a new session either. `enabled` does not
				// cover it — that flag is the administrator's decision and
				// survives a withdrawal on purpose — so reading it alone
				// accepts a preset the picker has already dropped. Sessions
				// already on one keep resolving it; only creation refuses.
				if (!preset || !preset.enabled || preset.withdrawnAt != null)
					return refuse("That session preset is not available.")
				// A disabled plugin's preset starts nothing (R67).
				{
					const { disabledPlugins } = await import(
						"$lib/server/plugins/disabledPlugins"
					)
					if ((await disabledPlugins(db)).owns(preset.ownerPluginId))
						return refuse("That session preset is not available.")
				}
				const [typeSetting] = await db
					.select()
					.from(schema.sessionGenreSettings)
					.where(
						eq(schema.sessionGenreSettings.genreId, preset.genreId)
					)
					.limit(1)
				if (typeSetting && !typeSetting.enabled)
					return refuse("That session type is not available.")
				;(params.session as any).genreId = preset.genreId
				const seats = (preset.defaults as { envoys?: unknown } | null)
					?.envoys
				if (Array.isArray(seats))
					presetEnvoys = seats.filter(
						(v): v is string => typeof v === "string"
					)
				presetSwaps = storedSwapsOf(
					(preset.defaults as { swaps?: unknown } | null)?.swaps
				)
			}
		}

		// Creation validates against the mode's declared shape (19 §6). The
		// default mode is the F29 floor, whose shape states today's behaviour
		// exactly — so every current creation passes trivially, and the seam
		// is live for the day a picker offers a mode with real constraints.
		let declaredFieldKeys: string[] = []
		{
			const { getSessionGenre, shapeViolations, STANDARD_GENRE_ID } =
				await import("$lib/server/pipelines/entities/sessionGenres")
			const genreId = (params.session as any).genreId ?? STANDARD_GENRE_ID
			const mode = await getSessionGenre(db, genreId)
			// The F29 spirit: the standard mode is the floor, available even
			// when the type registry never synced (a bootstrap conflict
			// disables pipelines, never sessions — DECOMPOSITION §19). Only a
			// *non-standard* mode this build does not register refuses.
			if (!mode && genreId !== STANDARD_GENRE_ID)
				return refuse(
					`'${genreId}' is not a session mode this build registers.`
				)
			// A disabled plugin's genre starts no new session (R67); the
			// sessions already on it keep running.
			if (mode && genreId !== STANDARD_GENRE_ID) {
				const { listOfferedGenres } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				if (!(await listOfferedGenres(db)).some((g) => g.genreId === genreId))
					return refuse("That session type is not available.")
			}
			if (mode) {
				const violations = shapeViolations(mode.shape, {
					characters: characterIds.length,
					personas: personaIds.length,
					hasLorebook: params.session.lorebookId != null
				})
				if (violations.length)
					return refuse(
						`This session does not fit '${mode.name}': ${violations.join("; ")}.`
					)
				declaredFieldKeys = Object.keys(
					(mode.shape as any)?.fields ?? {}
				)
			}
		}

		// Remove tags from session data as it will be handled separately
		//
		// ⚠ `connectionId` is destructured off and dropped, for EVERYONE (0130).
		// A session names no connection — overrides are by model, and the only
		// connection override is the pipeline configuration's connection slot —
		// so there is nowhere for this field to land, not even for an
		// administrator. An old client may still send it: the insert below is
		// a bare spread of the client's `params.session`.
		//
		// Dropped by name rather than left to drizzle, which ignores a key that
		// is not a column but is not the thing making the promise here. Dropped
		// in silence, too: the field is not a column, so writing it escalates
		// nothing, and a security refusal would name a boundary that has
		// nothing behind it.
		const {
			connectionId: _retiredSessionConnectionId,
			// Retired by R40 (2026-09-23): an old client's one-node strategy
			// field, dropped in silence like the connection above.
			speakerStrategy: _retiredSpeakerStrategy,
			// Not a column: the session's rebinds of swappable nodes (R40),
			// written once the row exists (below).
			swaps: requestedSwaps,
			// Where the session reads its book is the server's to start
			// (ruling 15, story-time P3): the book's most recently used line,
			// no clock of its own (it follows that line's present) — or what
			// the create names, checked (`sessionLinePatch`).
			lorebookBranchId: requestedBranchId,
			storyClockYear: requestedClockYear,
			storyClockMonth: requestedClockMonth,
			storyClockDay: requestedClockDay,
			storyClockHour: requestedClockHour,
			storyClockMinute: requestedClockMinute,
			...sessionDataWithoutTags
		} = params.session as Omit<InsertSession, "userId" | "isGroup"> & {
			connectionId?: number | null
			speakerStrategy?: string
			swaps?: unknown
		}
		// Field values only under names the mode declares (19 §1) — the same
		// filter runTurn applies at supply, applied at write so the row never
		// carries keys nothing declared.
		;(sessionDataWithoutTags as any).genreFields = Object.fromEntries(
			Object.entries(
				((params.session as any).genreFields ?? {}) as Record<
					string,
					unknown
				>
			).filter(([k]) => declaredFieldKeys.includes(k))
		)

		const sessionData: InsertSession = {
			...sessionDataWithoutTags,
			...(await sessionLinePatch({
				before: null,
				lorebookId: sessionDataWithoutTags.lorebookId ?? null,
				lorebookBranchId: requestedBranchId,
				clock:
					requestedClockYear == null
						? undefined
						: clockFromColumns({
								storyClockYear: requestedClockYear,
								storyClockMonth: requestedClockMonth,
								storyClockDay: requestedClockDay,
								storyClockHour: requestedClockHour,
								storyClockMinute: requestedClockMinute
							})
			})),
			userId,
			isGroup: characterIds.length > 1
		}
		const [newSession] = await db
			.insert(schema.sessions)
			.values(sessionData)
			.returning()

		// Process tags after session creation
		if (tags.length > 0) {
			await processSessionTags(newSession.id, tags, userId)
		}

		// Batch insert personas
		if (personaIds.length > 0) {
			await db.insert(schema.sessionPersonas).values(
				personaIds.map((personaId, i) => ({
					sessionId: newSession.id,
					personaId,
					position: i
				}))
			)
			// Attaching a character as a voice IS the user saying they play
			// it — see markCharacterAsPersona, the one writer of that flag.
			for (const personaId of personaIds)
				await markCharacterAsPersona(personaId)
		}

		// Batch insert characters
		if (characterIds.length > 0) {
			await db.insert(schema.sessionCharacters).values(
				characterIds.map((characterId) => ({
					sessionId: newSession.id,
					characterId,
					position: characterPositions[characterId] || 0
				}))
			)
		}
		/**
		 * The genre's envoys (plans/29 R-18; U5g): every `default: true`
		 * envoy is seated with no choice, and a preset's `defaults.envoys`
		 * pre-seats the ones it names — cast rows with `envoy_slug`, beside
		 * the characters, before the create pipeline runs for the same
		 * reason the cast arrives before it. A slug nothing declares is
		 * dropped silently here: a preset written against a newer genre
		 * still starts.
		 */
		{
			const { seatDefaultEnvoys } = await import(
				"$lib/server/pipelines/entities/envoys"
			)
			const { STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			await seatDefaultEnvoys(
				db,
				newSession.id,
				newSession.genreId ?? STANDARD_GENRE_ID,
				presetEnvoys
			)
		}
		/**
		 * The swaps the form asked for, else the preset's `defaults.swaps`
		 * (R40): each written as the session's rebind of that node. An entry
		 * the node does not offer is refused by the setter with a sentence;
		 * the session still starts on the pin, and the refusal is logged
		 * and named in the reply (`refusedSwaps`) rather than failing the
		 * create.
		 */
		const refusedSwaps: NonNullable<Sockets.Sessions.Create.Response["refusedSwaps"]> = []
		{
			// One entry per node, and a bound (M2 review): each entry costs a
			// handful of queries, and a create is not a place to run
			// thousands. The last entry for a node wins, as a later rebind
			// would.
			const byNode = new Map(
				(requestedSwaps !== undefined ? storedSwapsOf(requestedSwaps) : presetSwaps).map(
					(s) => [`${s.spec}#${s.node}`, s] as const
				)
			)
			const seeded = [...byNode.values()].slice(0, MAX_SEEDED_SWAPS)
			if (seeded.length) {
				const { setSessionNodeRebind } = await import(
					"$lib/server/pipelines/entities/bindings"
				)
				for (const swap of seeded) {
					const { error } = await setSessionNodeRebind(db, {
						sessionId: newSession.id,
						userId,
						spec: swap.spec,
						nodeKey: swap.node,
						definitionId: swap.definition
					})
					if (error) {
						console.warn(
							`[sessions:create] swap ${swap.spec}#${swap.node} → ${swap.definition} not applied to session ${newSession.id}: ${error}`
						)
						refusedSwaps.push({
							spec: swap.spec,
							node: swap.node,
							definition: swap.definition,
							reason: error
						})
					}
				}
			}
		}
		// The cast arrives with the session (ruling 2026-09-12). Before the
		// create pipeline runs, not after: its nodes may already write lore
		// against this book, and lore anchored to a cast member that does not
		// exist yet has nothing to anchor to.
		if (newSession.lorebookId) {
			await runLorebookBindingCheck(
				socket,
				newSession.id,
				newSession.lorebookId,
				emitToUser
			).catch(console.error)
		}

		// Creation as a run (24 §12, T8): the genre's create pipeline answers
		// `session-created` — greeting seeding is its nodes now, receipted
		// like any other run. Dispatch keys on (genre, event); nothing serving
		// is a normal state (a transitional input-type genre has no create
		// pipeline), and the imperative floor below covers it — the F29
		// posture: creation must never fail because pipeline infrastructure
		// did.
		const { getSessionGenre, genreFieldsFor, STANDARD_GENRE_ID } =
			await import("$lib/server/pipelines/entities/sessionGenres")
		const genreId = newSession.genreId ?? STANDARD_GENRE_ID
		let seededByPipeline = false
		try {
			const { dispatchSessionEvent } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			const createRequest = {
				genreId,
				presetId: newSession.presetId ?? null,
				characterIds,
				personaIds,
				lorebookId: params.session.lorebookId ?? null
			}
			const dispatched = await dispatchSessionEvent(db, {
				sessionId: newSession.id,
				userId,
				genreId,
				event: sessionEvents.sessionCreated,
				input: {
					main: createRequest,
					sessionScope: { sessionId: newSession.id, userId },
					sessionId: newSession.id,
					request: createRequest,
					// The resolved fields, declared defaults included (B16x) —
					// the same read every later run takes.
					fields: await genreFieldsFor(db, newSession.id)
				}
			})
			seededByPipeline =
				!!dispatched && (dispatched.receipt as any)?.outcome !== "err"
		} catch (err) {
			console.warn(
				"session-created pipeline failed; seeding greetings imperatively:",
				err
			)
		}

		if (!seededByPipeline) {
			// The floor: the same halves the pipeline's nodes call, invoked
			// directly, honoring the genre shape's greeting declaration.
			const greetingShape = (await getSessionGenre(db, genreId))?.shape
				?.greeting
			if (greetingShape?.enabled !== false) {
				const { collectSessionGreetings, writeSessionGreetings } =
					await import("$lib/server/sessions/greetings")
				const { entries } = await collectSessionGreetings(
					db,
					newSession.id
				)
				await writeSessionGreetings(db, {
					sessionId: newSession.id,
					userId,
					entries,
					channel: greetingShape?.channel ?? "main"
				})
			}
		}

		// A seeded greeting is the new session's first quoted line. The
		// caller's own list is re-sent below; this is how a guest's sidebar
		// and the home page's cards hear about it.
		broadcastSessionRow(socket.io, newSession.id)

		// Fetch the complete session with messages
		const resSession = await getSessionFromDB(newSession.id, userId)
		if (!resSession) throw new Error("Failed to fetch created session")

		// Refresh session list — awaited, and ahead of the reply that names the
		// new session, so a client resolving the new row out of the list has it
		// in hand by then. See `relistSessions` for why it is lazy.
		await relistSessions(socket, emitToUser)
		const res: Sockets.Sessions.Create.Response = {
			session: resSession as any,
			...(refusedSwaps.length ? { refusedSwaps } : {})
		}
		emitToUser("sessions:create", res)
		return res
	}
}

// Helper to get session with userId
//
// No `offset` param: drizzle-orm's relational query config only allows
// `offset` at the query root (DBQueryConfig's TIsRoot check), not inside a
// nested `with.sessionMessages` relation like this one — and the only caller
// that ever passed a real offset was the legacy session()/getSession() function,
// which has been removed (see the "getSession emits under an event name
// nothing listens for" comments elsewhere in this file). Every remaining
// caller relies on `beforeId` cursor pagination instead.
async function getSessionFromDB(
	sessionId: number,
	userId: number,
	limit?: number,
	beforeId?: number
) {
	// Check if user has access (owner or guest)
	const sessionAccess = await checkSessionAccess(sessionId, userId)
	if (!sessionAccess.hasAccess) {
		return null
	}

	const res = db.query.sessions.findFirst({
		where: (c, { eq }) => eq(c.id, sessionId),
		with: {
			sessionPersonas: {
				// `avatarMedia` is joined wherever a participant reaches a
				// render site: an avatar URL built from `avatarMediaId` alone
				// is one string for every revision of the file, so a browser
				// keeps its cached pixels when the row changes in place.
				with: {
					persona: {
						with: {
							avatarMedia: {
								columns: { uuid: true, rev: true }
							},
							spriteSets: SESSION_SPRITE_SETS
						}
					}
				},
				orderBy: (cp, { asc }) => asc(cp.position)
			},
			sessionCharacters: {
				// Character seats only: an envoy's seat (`envoy_slug`, U5g)
				// has no character row behind it and reaches the client on
				// `sessions:view` as `envoys`, with its declaration — so a
				// `sessionCharacters` row keeps meaning "a character sits
				// here" for every reader of this payload.
				where: (cc, { isNull }) => isNull(cc.envoySlug),
				with: {
					character: {
						with: {
							avatarMedia: {
								columns: { uuid: true, rev: true }
							},
							spriteSets: SESSION_SPRITE_SETS
						}
					}
				}
			},
			sessionMessages: {
				where:
					beforeId != null ? (cm) => lt(cm.id, beforeId) : undefined,
				orderBy: (cm, { desc }) => desc(cm.id),
				limit: limit
			},
			sessionTags: {
				with: {
					tag: true
				}
			},
			sessionGuests: {
				with: {
					// A guest's name, and nothing else of their account: this
					// payload reaches every member of the session.
					user: {
						columns: { id: true, username: true, displayName: true }
					}
				}
			}
		},
		// Never to a client, whoever asks (R57, V1a): `annex` is pipeline
		// state whose keys carry audiences, merged per reader elsewhere, and
		// `drafts` holds every member's unsent text — the asker's own rides
		// `sessions:get` as `userDraft`.
		columns: { annex: false, annexAudiences: false, drafts: false }
	})

	// Drizzle may not properly handle orderby,
	// Lets sort it manually
	const session = await res
	if (session) {
		// Order the sessionCharacters by position
		session.sessionCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort sessionPersonas by position if it exists
		if (session.sessionPersonas) {
			session.sessionPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}
		// Sort messages by id ascending (oldest first) for correct display order
		// When paginating, we fetched newest first (DESC) but want to display oldest first
		session.sessionMessages.sort((a, b) => a.id - b.id)

		// Transform session tags to include tags as string array
		const sessionWithTags = {
			...session,
			tags: session.sessionTags?.map((ct) => ct.tag.name) || []
		}
		return sessionWithTags
	}
	return session
}

// Returns complete session data for prompt compilation
async function getPromptSessionFromDb(sessionId: number, userId: number) {
	// Check if user has access (owner or guest)
	const sessionAccess = await checkSessionAccess(sessionId, userId)
	if (!sessionAccess.hasAccess) {
		return null
	}

	const session = await db.query.sessions.findFirst({
		where: (c, { eq }) => eq(c.id, sessionId),
		with: {
			sessionMessages: {
				// One channel, not the session (20 §7). This snapshot feeds
				// prompt construction and next-speaker selection, so an
				// unscoped read here would put a side conversation into the
				// prompt and let it decide whose turn it is. The trigger comes
				// from the session's composer, which is `main`; a per-channel
				// composer is later work and is what would pass one in.
				//
				// `channelWhere` rather than an equality on the column: a bare
				// slug is the WHOLE channel (ruling 2026-09-09), so `main` is
				// every lane of main and not `main:1` alone. Nothing moves
				// today — no row is on `main:2` — but an equality here would
				// have quietly meant something different from every other read
				// of `main` the moment one was.
				//
				// ⚠ Deliberately unlike `getSessionFromDB`, which stays
				// unscoped: the client renders every channel and each widget
				// filters to its own (`scopeMessages`).
				where: (cm, { eq, and }) =>
					and(
						eq(cm.isHidden, false),
						channelWhere(
							schema.sessionMessages.channel,
							DEFAULT_CHANNEL
						)
					),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			// Removed-participant rows are deliberately excluded here (unlike
			// getSessionFromDB, which stays unfiltered for client display) —
			// this function's result feeds the entire prompt-building
			// pipeline (the adapter construction in dispatch.ts derives its
			// session from the same shape), and a removed participant's
			// row flowing into that pipeline unfiltered would mean a
			// character removed from the session could still be presented to
			// the model as present/available.
			sessionCharacters: {
				// Character seats only, live ones: an envoy's seat is read
				// through `seatedEnvoys` where a turn needs it (U5g).
				where: (cc, { isNull, and }) =>
					and(isNull(cc.removedAt), isNull(cc.envoySlug)),
				with: {
					character: {
						// with: { lorebook: true }
					}
				},
				orderBy: (cc, { asc }) => asc(cc.position ?? 0)
			},
			sessionPersonas: {
				where: (cp, { isNull }) => isNull(cp.removedAt),
				with: {
					persona: {
						// with: { lorebook: true }
					}
				},
				orderBy: (cp, { asc }) => asc(cp.position ?? 0)
			},
			lorebook: {
				with: {
					lorebookBindings: {
						with: { character: true }
					}
					// No entry lists are loaded here: `BasePromptSession.lorebook`
					// does not declare them — every lore read goes through the
					// host's `lorebook_entries` query, which applies the
					// character-lore privacy rule.
				}
			}
		}
	})

	if (session) {
		// Order the sessionCharacters by position
		session.sessionCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort sessionPersonas by position if it exists
		if (session.sessionPersonas) {
			session.sessionPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}

		// Separate query (not a second `with` on the same relation, which
		// Drizzle's relational query builder doesn't support) so historical
		// message-speaker resolution (ContentProcessors.ts's
		// SessionMessageProcessor, the 0.5 RAG path's formatMessageForQuery)
		// can still find a removed participant's name — see
		// BasePromptSession.removedSessionCharacters/removedSessionPersonas.
		const [removedSessionCharacters, removedSessionPersonas] =
			await Promise.all([
				db.query.sessionCharacters.findMany({
					where: (cc, { eq, and, isNotNull }) =>
						and(
							eq(cc.sessionId, sessionId),
							isNotNull(cc.removedAt)
						),
					with: { character: true }
				}),
				db.query.sessionPersonas.findMany({
					where: (cp, { eq, and, isNotNull }) =>
						and(
							eq(cp.sessionId, sessionId),
							isNotNull(cp.removedAt)
						),
					with: { persona: true }
				})
			])
		;(session as any).removedSessionCharacters = removedSessionCharacters
		;(session as any).removedSessionPersonas = removedSessionPersonas
	}
	return session
}

export const sessionsDeleteHandler: Handler<
	Sockets.Sessions.Delete.Params,
	Sockets.Sessions.Delete.Response
> = {
	event: "sessions:delete",
	async handler(socket, params, emitToUser) {
		try {
			const userId = socket.user!.id

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
			try {
				const { newestHistoryEntryOf, recordToTimeline } = await import(
					"$lib/server/state/durable"
				)
				const moment = await newestHistoryEntryOf(db, params.id)
				await recordToTimeline(db, params.id, {
					reason: "delete",
					historyEntryId: moment.historyEntryId,
					sceneId: moment.sceneId
				})
			} catch (e) {
				console.warn(
					"[sessions:delete] state was not recorded to the timeline:",
					e
				)
			}

			await db
				.delete(schema.sessions)
				.where(eq(schema.sessions.id, params.id))

			// Every member's notifications about the session go with it
			// (notifications carry no FK to what they regard). Never throws.
			await (
				await import("$lib/server/notifications/store")
			).clearNotifications(
				{ regarding: `session:${params.id}/`, prefix: true },
				"superseded"
			)

			// Emit to user with the deleted session ID so frontend can update
			emitToUser("sessions:delete", {
				success: "Session deleted successfully",
				id: params.id
			})

			return { success: "Session deleted successfully", id: params.id }
		} catch (error) {
			throw error
		}
	}
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
		const res: Sockets.Sessions.Genres.Response = {
			genres: (await listOfferedGenres(db)) as any
		}
		emitToUser("sessions:genres", res)
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
			const { resolveSubjectSpec, STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const { subjectCandidates } = await import(
				"$lib/server/pipelines/entities/bindings"
			)
			const [session] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			const genreId = session?.genreId ?? STANDARD_GENRE_ID
			// A disabled plugin's pipelines are no choice to offer (R67).
			const { disabledPlugins } = await import("$lib/server/plugins/disabledPlugins")
			const off = await disabledPlugins(db)
			res.candidates = (await subjectCandidates(db, genreId, params.subject)).filter(
				(c) => !off.ownsId(c)
			)
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
		if (scopeKind === "instance" && !socket.user!.isAdmin)
			return fail("Only administrators bind instance-wide.")
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess || !access.isOwner)
			return fail("Session not found.")

		const { STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { bindSubject } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { parseActionIdentity } = await import("$lib/shared/actions/identity")
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)
		const genreId = session?.genreId ?? STANDARD_GENRE_ID
		const identity = parseActionIdentity(params.subject)

		/**
		 * R-6's narrowing (ruled with U4, built U5c): a session's own choice is
		 * a choice *within* what the administrator made available. At session
		 * scope an action may be bound only if it is **enabled** for this
		 * session — the session row, else the preset's included set, else the
		 * companion rule, exactly as `listSessionFunctions` resolves it. A
		 * published spec the preset leaves out is not the owner's to reach by
		 * binding. Instance scope is the administrator's, and availability is
		 * theirs to widen; an event subject (the primary turn) keeps the
		 * candidate rule alone.
		 */
		if (scopeKind === "session" && params.specSlug != null && identity) {
			const { listSessionFunctions } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const own = (
				await listSessionFunctions(db, params.sessionId, genreId, userId)
			).filter((f) => f.specSlug === identity.specSlug && f.key === identity.key)
			if (!own.length)
				return fail(
					`'${params.subject}' is not offered to this session's genre.`
				)
			if (own[0]!.specSlug !== params.specSlug)
				return fail(
					`'${params.specSlug}' does not serve '${params.subject}' — an action is served by its declarer.`
				)
			if (!own[0]!.enabled)
				return fail(
					`'${own[0]!.name}' from '${params.specSlug}' is not enabled for this session — ` +
						`a session chooses among what its preset includes. Ask an administrator ` +
						`to include it, or turn it on under Actions.`
				)
		}

		/**
		 * The enabled-when override (R-15; U5e): a predicate set that
		 * replaces the action's own and the genre's default while it stands,
		 * riding the session's binding row — so it needs a `specSlug` to ride
		 * on, an action subject to be about, and is session scope's alone.
		 * Judged with the SDK's findings, the same sentences a declaration
		 * gets; `null` clears it; absent leaves it be.
		 */
		let enabledWhen: import("@serene-pub/sdk").EnabledWhen[] | null | undefined
		if (params.enabledWhen !== undefined) {
			if (scopeKind !== "session")
				return fail("An enabled-when override is a session's — bind at session scope to set one.")
			if (!identity)
				return fail("An enabled-when override is an action's — a turn's event has no button to grey.")
			if (params.enabledWhen === null) enabledWhen = null
			else {
				if (params.specSlug == null)
					return fail(
						"An enabled-when override rides the session's binding — name the spec to bind, or clear the binding to drop the override with it."
					)
				const { enabledWhenFindings, normalizeEnabledWhen } = await import(
					"@serene-pub/sdk"
				)
				const findings = enabledWhenFindings(params.enabledWhen, "enabledWhen")
				if (findings.length) return fail(findings.join("; "))
				enabledWhen = normalizeEnabledWhen(params.enabledWhen)
			}
		}

		const { error } = await bindSubject(db, {
			scope:
				scopeKind === "instance"
					? { kind: "instance", id: 0 }
					: { kind: "session", id: params.sessionId },
			genreId,
			subject: params.subject,
			specSlug: params.specSlug,
			userId,
			...(enabledWhen !== undefined ? { enabledWhen } : {})
		})
		if (error) return fail(error)
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
			const [session] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
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
			if (version?.inputGenre && version.inputGenre !== session?.genreId) {
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
 * what the session chose. Any participant may read it; only the owner may
 * change a card (`sessions:setNodeRebind`).
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
		if (access.hasAccess) {
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
	handler: async (socket, params, emitToUser) =>
		withSessionGenerationLock(params.sessionId, async () => {
			/** What the answer names: the identity when the press brought one, else the bare key it sent. */
			const named = params.action ?? params.key ?? ""
			/** The card's title — the action's key, the short word a person pressed. */
			const label = named.includes("#") ? named.slice(named.lastIndexOf("#") + 1) : named
			const fail = (
				error: string
			): Sockets.Sessions.FireAction.Response => {
				const res = {
					sessionId: params.sessionId,
					action: named,
					error
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
					cancelledBy: by
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
				if (outcome === "err" || outcome === "halt") {
					if (receipt) {
						const { haltExplanation } = await import(
							"$lib/server/pipelines/runtime/runTurn"
						)
						explanation =
							haltExplanation(receipt) ?? "The run produced nothing."
					} else explanation = "The run produced nothing."
				}
				emitToUser("pipelines:progress", {
					runId,
					sessionId: params.sessionId,
					// Self-describing, like every other frame on this card: a
					// terminal frame read after the run was forgotten (the
					// reply road's `finally` says the same) titled the receipt
					// "Working" (2026-09-17).
					label,
					done: true,
					outcome,
					...(outcome === "cancelled" ? { cancelled: true } : {}),
					...(explanation !== undefined ? { error: explanation } : {}),
					...(outcome === "halt" && receipt?.haltNodeKey
						? { haltNodeKey: receipt.haltNodeKey }
						: {})
				})
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
					return fail(
						haltExplanation(receipt) ?? "The run produced nothing."
					)
				}

				// Whatever the spec's consumers wrote, the participants see it.
				await relistSessions(socket, emitToUser)
				const res: Sockets.Sessions.FireAction.Response = {
					sessionId: params.sessionId,
					action: named,
					success: true,
					// A run under this one is waiting at a review gate: its
					// own row lands when the owner decides.
					...(outcome.parked?.length ? { parked: true } : {})
				}
				emitToUser("sessions:fireAction", res)
				return res
			}
			// Named by the client when it offered one, so Cancel works during
			// the window before the first progress event — which is exactly
			// when somebody realises the prompt was wrong.
			const runId = params.runId || randomUUID()
			let started = false
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
					actor: { userId },
					runId,
					// So the status relay pushes `sessions:runStatus` and,
					// where the run has a live row, the row's own
					// `sessionMessage` frame — an action run announces
					// exactly like a reply does (R-19).
					io: socket.io,
					onStarted: (run) => {
						started = true
						emitToUser("pipelines:runStarted", {
							runId: run.runId,
							sessionId: params.sessionId,
							specId: run.specId,
							label
						})
						// `session.generating` just rose (U5e, review W-A1):
						// every member's list follows, once per root — the
						// end push queues behind it on the same session.
						void import("$lib/server/sessions/actionsPush").then(
							({ pushSessionActions }) =>
								pushSessionActions(socket.io, params.sessionId)
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
							label
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
							status
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
						parked: true
					}
					emitToUser("sessions:fireAction", res)
					return res
				}
				return await settle(outcome)
			} catch (error: any) {
				// A stopped run never arrives here: `fireAction` reads the
				// handle before it rethrows, and answers `stopped` for one.
				if (started) await finished(runId, "err")
				console.error("Error in sessionsFireActionHandler:", error)
				return fail("Failed to run the function.")
			}
		})
}

/**
 * The pipelines involved in a session, for the session's grouped settings:
 * the primary turn's pipeline plus every enabled contributed action's
 * (narrate, the summarize family, plugin actions). Each resolves to a spec
 * slug the config panel can render at session scope; the list is what lets
 * the settings group configurables **by pipeline** rather than by setting
 * type. Deduped by slug — one spec serving two actions is one card.
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
		if (access.hasAccess) {
			const {
				resolveSubjectVerdict,
				enabledSessionFunctions,
				STANDARD_GENRE_ID
			} = await import("$lib/server/pipelines/entities/sessionGenres")
			const { sessionEvents } = await import("@serene-pub/sdk")
			const { actionIdentity } = await import("$lib/shared/actions/identity")
			const [session] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			const genreId = session?.genreId ?? STANDARD_GENRE_ID

			const nameOf = async (slug: string): Promise<string | null> => {
				const [row] = await db
					.select({ name: schema.pipelineSpecs.name })
					.from(schema.pipelineSpecs)
					.where(eq(schema.pipelineSpecs.slug, slug))
					.limit(1)
				return row?.name ?? null
			}
			const seen = new Set<string>()
			/**
			 * Deduped by event as well as by slug: two functions bound to the
			 * same dead pipeline is one thing wrong, not two.
			 */
			const fallbacks = new Map<
				string,
				Sockets.SessionAdmin.StaleBinding
			>()
			const add = async (
				resolved: { spec: string | null; fallback?: any },
				label: string
			): Promise<void> => {
				if (resolved.fallback)
					fallbacks.set(resolved.fallback.event, {
						event: resolved.fallback.event,
						bound: resolved.fallback.bound,
						reason: resolved.fallback.reason,
						fallbackSpec: resolved.spec
					})
				const slug = resolved.spec
				if (!slug || seen.has(slug)) return
				seen.add(slug)
				res.pipelines.push({
					slug,
					label: label || (await nameOf(slug)) || slug
				})
			}

			// The reply pipeline is always involved; then every function the
			// session actually has switched on (19 §4) — narrate included.
			//
			// The verdict rather than the slug (ruled 2026-09-10): a preset
			// binding that stopped resolving must not fail this read, and the
			// list must not quietly show a pipeline the preset does not name
			// as though the preset had named it.
			await add(
				await resolveSubjectVerdict(db, genreId, sessionEvents.messageRespond, {
					sessionId: params.sessionId
				}),
				"Respond"
			)
			const fns = await enabledSessionFunctions(
				db,
				params.sessionId,
				genreId,
				userId
			)
			for (const fn of fns)
				await add(
					await resolveSubjectVerdict(db, genreId, actionIdentity(fn), {
						sessionId: params.sessionId
					}),
					fn.name
				)
			if (fallbacks.size) res.presetFallbacks = [...fallbacks.values()]
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
			const { sessionPreset, presetBindingVerdict } = await import(
				"$lib/server/pipelines/entities/presetBindings"
			)
			const { STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const preset = await sessionPreset(db, params.sessionId)
			if (preset) {
				res.presetId = preset.id
				res.presetName = preset.name
				const [session] = await db
					.select({ genreId: schema.sessions.genreId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, params.sessionId))
					.limit(1)
				// The SESSION's genre, not the preset's: a session that was
				// upgraded to another genre is still on this preset, and
				// judging its bindings against the genre it left would
				// report every slot as stale.
				const genreId = session?.genreId ?? STANDARD_GENRE_ID
				const bindings = (preset.bindings ?? {}) as Record<
					string,
					{ spec?: string }
				>
				for (const event of Object.keys(bindings)) {
					if (!bindings[event]?.spec) continue
					const verdict = await presetBindingVerdict(
						db,
						preset,
						genreId,
						event
					)
					if (verdict.via !== "fallback") continue
					res.stale.push({
						event,
						bound: verdict.bound,
						reason: verdict.reason,
						fallbackSpec: verdict.spec
					})
				}
			}
		}
		emitToUser("sessions:presetStatus", res)
		return res
	}
}

/**
 * The session's frame surfaces (20 §12): the mode-declared session-view and
 * every enabled plugin's declared panels, each resolved to a frame src on the
 * plugin-ui route. Presence is data — disabling a plugin takes its frames
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
			panels: [],
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
			// plugin counts as enabled here, so no plugin panel (⏳
			// `res.panels`), plugin widget, genre panel a plugin owns or
			// session view is offered.
			const { pluginsEnabled } = await import("$lib/server/plugins/flag")
			const extensionsOn = pluginsEnabled()
			const enabled = extensionsOn
				? await db
						.select({
							pluginId: schema.plugins.pluginId,
							name: schema.plugins.name,
							manifest: schema.plugins.manifest,
							adminDenied: schema.plugins.adminDenied
						})
						.from(schema.plugins)
						.where(and(eq(schema.plugins.enabled, true), notCoreRow()))
				: []

			// Panels: every enabled plugin's own widgets, in name order.
			//
			// Read once, into two lists. `res.modePanels` gets them below,
			// after the genre's, because that is where the client seats a
			// widget; `res.panels` is the ⏳ pre-widget listing and this is its
			// last producer.
			//
			// ⏳ REMOVE `res.panels` next release (0.7.0, with SDK 1.0).
			// Nothing in this repo reads it — the client seats widgets off
			// `modePanels` — and it survives only for a reader outside it. It
			// keeps the **bare** declared id its consumers were written
			// against; the widget id beside it is the namespaced one.
			const pluginWidgets: {
				pluginId: string
				decl: WidgetDecl
				surface: { kind: "frame"; pluginId: string; entry: string }
			}[] = []
			for (const p of enabled) {
				const surfaces = surfacesOf(p.manifest, p.pluginId)
				const prefix = `${p.pluginId}:`
				for (const panel of surfaces.panels) {
					const surface = resolveWidgetSurface(panel, p.pluginId)
					if (surface?.kind !== "frame") continue
					pluginWidgets.push({ pluginId: p.pluginId, decl: panel, surface })
					// Stripped by the prefix this loop just put on, not parsed
					// back out: an installed plugin id is not held to the slug
					// grammar anywhere but the frame URL, so a stored
					// `acme/mapper` would not parse and this row would have
					// silently changed shape.
					const bare = panel.id.startsWith(prefix)
						? panel.id.slice(prefix.length)
						: panel.id
					res.panels.push({
						pluginId: p.pluginId,
						panelId: bare,
						src: frameSrc(p.pluginId, surface.entry),
						title: i18nText(panel.title) ?? bare
					})
				}
			}

			// The mode's declared session-view, when its plugin is enabled
			// and declares the surface.
			const { getSessionGenre, STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const [session] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			const mode = await getSessionGenre(
				db,
				session?.genreId ?? STANDARD_GENRE_ID
			)
			// The session's lanes (20 §7): `main` plus whatever the genre
			// declares. Read from the shape rather than stored on the row —
			// a genre gains a channel by declaring one, and a session of that
			// genre has it from that moment.
			res.channels = channelsOf(mode?.shape)
			// What each is CALLED (S1): the declared label, in the viewer's
			// language — the Lair's `sanctum` is _Sanctum_. Only the channels
			// that declare one; the rest are named by their slug.
			const labels: Record<string, string> = {}
			for (const decl of channelDeclsOf(mode?.shape)) {
				// The mirror reads a stored row as it comes (a locale map
				// that may lack `en`); `i18nText` falls back to it anyway.
				const label = decl.label
					? i18nText(decl.label as Parameters<typeof i18nText>[0], res.language)
					: undefined
				if (label) labels[decl.slug] = label
			}
			if (Object.keys(labels).length) res.channelLabels = labels

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
					? surfacesOf(owner.manifest, owner.pluginId).sessionView
					: undefined
				if (owner && decl)
					res.sessionView = {
						pluginId: owner.pluginId,
						src: frameSrc(owner.pluginId, decl.entry),
						title: decl.title ?? owner.name
					}
			}

			// The mode's declared surface-grid panels (21), then every enabled
			// plugin's own. Both are widgets to the client; they differ only in
			// who declared them and, therefore, in whether their id is
			// qualified.
			const declaredPanels = (mode?.shape as any)?.panels
			const genrePanels = Array.isArray(declaredPanels)
				? declaredPanels
				: []
			if (genrePanels.length || pluginWidgets.length) {
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
				const genreId = session?.genreId ?? STANDARD_GENRE_ID
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
					// A frame is always a plugin's document: with the
					// extension subsystem off it is not offered at all, not
					// even as the absent-plugin placeholder.
					if (surface.kind === "frame" && !extensionsOn) continue
					// A remote runs its owner's component module in the UI
					// worker (§3.5): offered only when that plugin is enabled
					// and declares the component; otherwise not offered rather
					// than offered broken.
					let remoteSrc: string | undefined
					/** The data it asked for that its plugin was granted (`widget:<scope>`). */
					let grants: string[] | undefined
					// Core's own component holds every section scope it
					// declares, as the page's default widgets do
					// (`coreDefaultWidgets`). Never a frame: that is a
					// plugin's document, whatever genre seats it.
					if (surface.kind === "remote" && surface.owner === "core")
						grants = (Array.isArray(p.scopes) ? (p.scopes as unknown[]) : []).filter(
							(s): s is string => typeof s === "string" && Object.hasOwn(WIDGET_SCOPED_SECTIONS, s)
						)
					if (surface.kind === "remote" && surface.owner === "core") {
						// Core's own component: served by `/core-ui`, which
						// serves every component core declares and nothing
						// else — so one core does not declare is not offered,
						// rather than offered as a box that 404s. Never
						// looked up as a plugin row (`notCoreRow` hides any
						// row named `core`).
						if (!coreComponents.has(surface.component)) continue
						// The conversation is the page's primary, mounted once
						// by the layout; a second copy would share its element
						// ids (`#message-<id>`), so a panel may not seat it.
						if (surface.component === CORE_CONVERSATION_COMPONENT) continue
						remoteSrc = `/core-ui/${surface.component}`
					} else if (surface.kind === "remote") {
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
						remoteSrc = frameSrc(owner.pluginId, declared.entry)
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
						defaultActive: !!p.defaultActive
					}
					if (surface.kind === "frame") {
						const owner = enabled.find(
							(e) => e.pluginId === surface.pluginId
						)
						if (owner)
							panel.src = frameSrc(surface.pluginId, surface.entry)
					} else if (remoteSrc) panel.src = remoteSrc
					if (grants?.length) panel.grants = grants as Sockets.Sessions.View.ModePanel["grants"]
					res.modePanels.push(panel)
				}

				/**
				 * A plugin's own widgets, seated in EVERY session (the ruling,
				 * 2026-09-17). A genre declares which widgets its sessions
				 * have; a plugin's panels belong to no genre, so the only
				 * honest answer is "offered everywhere, active nowhere" —
				 * `defaultActive` false unless the declaration says otherwise,
				 * so an install never rearranges a session by itself.
				 *
				 * Their ids are namespaced (`surfacesOf` did it): a package
				 * picked its panel id in private, and a layout row outlives the
				 * install that could have told two `map`s apart.
				 */
				for (const { pluginId, decl, surface } of pluginWidgets) {
					res.modePanels.push({
						id: decl.id,
						title: i18nText(decl.title, language) ?? decl.id,
						...(typeof decl.icon === "string"
							? { icon: decl.icon }
							: {}),
						// Never `primary`: the primary is the session's anchor
						// and an installed package may not take it. A genre
						// chooses its own view; a plugin offers a panel beside
						// it.
						role: "secondary",
						surface,
						// Resolved unconditionally — this list is built from
						// the ENABLED plugins, so the owner is by construction
						// installed and serving.
						src: frameSrc(pluginId, surface.entry),
						...(decl.channels ? { channels: decl.channels } : {}),
						...(decl.layout ? { layout: decl.layout } : {}),
						...(decl.settings
							? {
									settings: decl.settings as Record<
										string,
										unknown
									>
								}
							: {}),
						...(Array.isArray(decl.reads)
							? { reads: declaredWidgetReads(decl.reads) }
							: {}),
						defaultActive: !!decl.defaultActive
					})
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
			const { STANDARD_GENRE_ID } = await import("$lib/server/pipelines/entities/sessionGenres")
			const { panelGrants } = await import("$lib/server/plugins/permissions")
			const { frameSrc, notCoreRow } = await import("$lib/server/plugins/frameHost")
			const [row] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			const genreId = row?.genreId ?? STANDARD_GENRE_ID
			const enabledNow = await db
				.select({
					pluginId: schema.plugins.pluginId,
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
					if (!w || typeof w.id !== "string" || typeof w.component !== "string") continue
					if (Array.isArray(w.genres) && w.genres.length && !w.genres.includes(genreId)) continue
					const built = (m.components ?? []).find((c) => c?.slug === w.component)
					// The built module, never its source — otherwise not offered rather than offered broken.
					if (typeof built?.entry !== "string" || !isServableEntry(built.entry) || !/\.m?js$/.test(built.entry))
						continue
					// Built for a host contract this host does not speak (F1): not offered, the reason in the admin list.
					if (pluginComponentRefusal(e.manifest, w.component)) continue
					const id = pluginWidgetId(e.pluginId, w.id)
					if (seen.has(id)) continue // one declaration per id (a legacy panel of the same id wins)
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
						surface: { kind: "remote", owner: e.pluginId, component: w.component },
						src: frameSrc(e.pluginId, built.entry),
						...(Array.isArray(w.channels) ? { channels: w.channels } : {}),
						...(w.settings ? { settings: w.settings as Record<string, unknown> } : {}),
						...(Array.isArray(w.reads) ? { reads: declaredWidgetReads(w.reads) } : {}),
						...(grants.length ? { grants: grants as Sockets.Sessions.View.ModePanel["grants"] } : {}),
						defaultActive: !!w.defaultActive
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
		// The turn order rides with the view (PLAN-turn-order §4.7): a client
		// that has just joined renders the same state as one that was already
		// here, without asking for a decision — page load is not an event.
		try {
			const { pushTurnOrder } = await import(
				"$lib/server/sessions/turnOrderPush"
			)
			await pushTurnOrder(socket.io, params.sessionId)
		} catch (err) {
			console.warn("[sessions:view] the turn-order push failed:", err)
		}
		return res
	}
}

/** The session's genre id, or the standard floor when the row is gone. */
async function genreOfSession(sessionId: number): Promise<string> {
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.genreId ?? "core:genre/chat"
}

/**
 * Read the caller's surface-grid layout for a session (21 §10, extended by the
 * PLAN 25 preset redesign). No row yet → an empty blob; the client then derives
 * its default layout from the mode's declared panels. Access-gated like every
 * other session read.
 *
 * `layout` is returned EXACTLY as it always was — the preset fields are strictly
 * additive, and the preset's own content never enters it. That is the whole
 * compatibility guarantee: a session that already has an arrangement in `layout`
 * gets back byte-identical bytes, and the client's manager reads its own slots
 * in preference to the preset base, so nothing it renders can change.
 */
export const sessionsPanelLayoutGetHandler: Handler<
	Sockets.Sessions.PanelLayout.Get.Params,
	Sockets.Sessions.PanelLayout.Get.Response
> = {
	event: "sessions:panelLayout:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		let layout: Record<string, unknown> = {}
		let layoutPresetId: number | null = null
		let layoutSettings: Record<string, unknown> = {}
		let widgetSettings: Record<string, Record<string, unknown>> = {}
		let presetLayout: Record<string, unknown> = {}
		let presets: Sockets.Sessions.LayoutPreset[] = []
		if (access.hasAccess) {
			const [row] = await db
				.select({
					layout: schema.sessionPanelLayouts.layout,
					layoutPresetId:
						schema.sessionPanelLayouts.startedFromLayoutPresetId,
					layoutSettings: schema.sessionPanelLayouts.layoutSettings
				})
				.from(schema.sessionPanelLayouts)
				.where(
					and(
						eq(
							schema.sessionPanelLayouts.sessionId,
							params.sessionId
						),
						eq(schema.sessionPanelLayouts.userId, userId)
					)
				)
				.limit(1)
			if (row?.layout && typeof row.layout === "object")
				layout = row.layout as Record<string, unknown>
			layoutPresetId = row?.layoutPresetId ?? null
			if (row?.layoutSettings && typeof row.layoutSettings === "object")
				layoutSettings = row.layoutSettings as Record<string, unknown>

			widgetSettings = await readWidgetSettings(params.sessionId, userId)

			const genreId = await genreOfSession(params.sessionId)
			presetLayout = await resolveActivePresetLayout(
				genreId,
				userId,
				layoutPresetId
			)
			presets = await listLayoutPresets(genreId, userId)
		}
		const res: Sockets.Sessions.PanelLayout.Get.Response = {
			sessionId: params.sessionId,
			layout,
			layoutPresetId,
			layoutSettings,
			widgetSettings,
			presetLayout,
			presets
		}
		emitToUser("sessions:panelLayout:get", res)
		return res
	}
}

/**
 * Is this a `{ widgetId: { field: value } }` payload?
 *
 * Shape only: what a field means is the widget's declaration to say, and the
 * client prunes against it before writing. The boot reconciler prunes whatever
 * a stale or hand-made client stored anyway, so the guard here is the one thing
 * the server can know on its own.
 *
 * ⚠ The KEYS are not this function's question — `seatedWidgetSettings` below
 * holds them to the widgets the session can seat. Read together: this one
 * refuses a malformed payload outright, that one quietly drops a key no widget
 * would ever ask for.
 */
function isWidgetSettingsPayload(
	value: unknown
): value is Record<string, Record<string, unknown>> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return false
	return Object.values(value).every(
		(v) => !!v && typeof v === "object" && !Array.isArray(v)
	)
}

/**
 * The widget settings this session will actually store: every key held to the
 * widget ids that can be SEATED in it (`seatableWidgetIds` — core's, the
 * session genre's declared panels, an enabled plugin's) OR that this user
 * already has a row for here (`storedWidgetSlugs`).
 *
 * The guard above answers shape only, and a key is not a shape: it becomes a
 * `widget_slug` verbatim, so without this anyone who can reach a session could
 * mint rows there under any slug they liked — unreadable by any widget, and
 * unbounded in number.
 *
 * The second half of the set is why this closes that door without shutting a
 * user's own (ruled 2026-09-17): **a disable deletes nothing, so the gate must
 * not either.** The gate governs which rows can be MADE, never which survive —
 * the same rule `announcedWidgetIds` lives by for a style. A layout that still
 * names a disabled plugin's widget therefore writes it back untouched, and the
 * re-enable finds the arrangement where it was left.
 *
 * What it does NOT do is preserve a key the client genuinely dropped: absence
 * from the payload still means "remove the row", which is `writeWidgetSettings`'s
 * own sweep and the only way a person clears a setting. The exemption is about
 * a key that is PRESENT and unseatable, nothing else.
 *
 * A key in neither half is dropped rather than refused: failing the whole save
 * would cost the user the edit they were actually making. The warning names the
 * slug and the session, which is what a person reading a log needs to tell a
 * stale client from a probe.
 */
async function seatedWidgetSettings(
	sessionId: number,
	userId: number,
	next: Record<string, Record<string, unknown>>
): Promise<Record<string, Record<string, unknown>>> {
	const keys = Object.keys(next)
	if (!keys.length) return next
	const { seatableWidgetIds } = await import("$lib/server/plugins/frameHost")
	const seatable = await seatableWidgetIds(db, await genreOfSession(sessionId))
	const stored = await storedWidgetSlugs(sessionId, userId)
	const out: Record<string, Record<string, unknown>> = {}
	for (const key of keys) {
		// A placed copy (`messages#sanctum`, S1) is seatable exactly when its
		// widget is: the instance name is the layout's, never a new widget.
		if (seatable.has(widgetOfInstance(key)) || stored.has(key))
			out[key] = next[key]
		else
			console.warn(
				`widget settings: dropped '${key}' — no such widget in ` +
					`session ${sessionId}.`
			)
	}
	return out
}

/** Guard behind `layoutPresetId`: this session's genre, and seeded or mine. */
async function mayApplyPreset(
	presetId: number,
	sessionId: number,
	userId: number
): Promise<boolean> {
	return canApplyLayoutPreset(
		presetId,
		await genreOfSession(sessionId),
		userId
	)
}

/**
 * Persist the caller's surface-grid layout for a session (21 §10, extended by
 * the PLAN 25 preset redesign). One row per (user, session); upsert. The
 * `layout` blob is stored verbatim — its shape is the client surface manager's
 * business, forward-compatible by design.
 *
 * `layoutPresetId` and `layoutSettings` are written ONLY when the caller sends
 * the key. That is not politeness, it is the correctness condition: the surface
 * manager's debounced save knows nothing about presets and posts `layout`
 * alone, several times a minute. If absence meant "clear", every drag of a
 * gutter would silently reset the user's chosen preset.
 */
export const sessionsPanelLayoutSetHandler: Handler<
	Sockets.Sessions.PanelLayout.Set.Params,
	Sockets.Sessions.PanelLayout.Set.Response
> = {
	event: "sessions:panelLayout:set",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		let ok = false
		let error: string | undefined
		const setsPreset = "layoutPresetId" in params
		const setsSettings = "layoutSettings" in params
		const setsWidgets = "widgetSettings" in params
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (!params.layout || typeof params.layout !== "object") {
			error = "Invalid layout"
		} else if (
			setsSettings &&
			(!params.layoutSettings ||
				typeof params.layoutSettings !== "object")
		) {
			error = "Invalid layout settings"
		} else if (
			setsWidgets &&
			!isWidgetSettingsPayload(params.widgetSettings)
		) {
			error = "Invalid widget settings"
		} else if (
			setsPreset &&
			params.layoutPresetId != null &&
			!(await mayApplyPreset(
				params.layoutPresetId,
				params.sessionId,
				userId
			))
		) {
			// Not this session's genre, or somebody else's preset. Refuse rather
			// than store: a pinned id that resolves for its author would render
			// a stranger's layout to whoever pinned it.
			error = "Unknown layout preset"
		} else {
			// Built conditionally so an absent key leaves its column alone.
			// Typed against the table so a mistyped column name is a compile
			// error rather than a silently ignored write.
			const changes: Partial<
				typeof schema.sessionPanelLayouts.$inferInsert
			> = { layout: params.layout }
			if (setsPreset)
				changes.startedFromLayoutPresetId = params.layoutPresetId
			if (setsSettings) changes.layoutSettings = params.layoutSettings
			await db
				.insert(schema.sessionPanelLayouts)
				.values({
					sessionId: params.sessionId,
					userId,
					...changes
				})
				.onConflictDoUpdate({
					target: [
						schema.sessionPanelLayouts.userId,
						schema.sessionPanelLayouts.sessionId
					],
					set: {
						...changes,
						updatedAt: new Date()
					}
				})
			if (setsWidgets)
				await writeWidgetSettings(
					params.sessionId,
					userId,
					await seatedWidgetSettings(
						params.sessionId,
						userId,
						params.widgetSettings!
					)
				)
			ok = true
		}
		const res: Sockets.Sessions.PanelLayout.Set.Response = {
			sessionId: params.sessionId,
			ok,
			error
		}
		emitToUser("sessions:panelLayout:set", res)
		return res
	}
}

/**
 * Save the caller's current arrangement as a user-authored layout preset for
 * this session's genre (PLAN 25 redesign). Definitions only — this never
 * touches the caller's active selection; applying the new preset is a separate
 * `panelLayout:set`, so "save" and "switch to it" stay independent decisions.
 */
export const sessionsLayoutPresetSaveHandler: Handler<
	Sockets.Sessions.PanelLayout.Save.Params,
	Sockets.Sessions.PanelLayout.Save.Response
> = {
	event: "sessions:layoutPreset:save",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const name = typeof params.name === "string" ? params.name.trim() : ""
		let ok = false
		let error: string | undefined
		let preset: Sockets.Sessions.LayoutPreset | undefined
		let presets: Sockets.Sessions.LayoutPreset[] = []
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (!name) {
			error = "A preset needs a name"
		} else if (!params.layout || typeof params.layout !== "object") {
			error = "Invalid layout"
		} else {
			const genreId = await genreOfSession(params.sessionId)
			preset = await saveUserLayoutPreset({
				genreId,
				userId,
				name,
				layout: params.layout
			})
			presets = await listLayoutPresets(genreId, userId)
			ok = true
		}
		const res: Sockets.Sessions.PanelLayout.Save.Response = {
			sessionId: params.sessionId,
			ok,
			error,
			preset,
			presets
		}
		emitToUser("sessions:layoutPreset:save", res)
		return res
	}
}

/**
 * Rename one of the caller's OWN layout presets (PLAN 25 redesign).
 *
 * Not session-scoped: a preset belongs to a genre and an author, not to the
 * session you happened to be looking at when you saved it. So there is no
 * session access check here — the only question is authorship, and it is asked
 * once, in `db/layoutPresets.ts`, for all three of rename/delete/usage.
 *
 * The refreshed list rides the response exactly as `layoutPreset:save`'s does,
 * so the Presets tab never re-fetches to see its own edit.
 */
export const sessionsLayoutPresetRenameHandler: Handler<
	Sockets.Sessions.PanelLayout.Rename.Params,
	Sockets.Sessions.PanelLayout.Rename.Response
> = {
	event: "sessions:layoutPreset:rename",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const outcome = await renameUserLayoutPreset({
			presetId: params.id,
			userId,
			name: params.name
		})
		const res: Sockets.Sessions.PanelLayout.Rename.Response = outcome.ok
			? {
					id: params.id,
					ok: true,
					genreId: outcome.preset.genreId,
					preset: outcome.preset,
					presets: await listLayoutPresets(
						outcome.preset.genreId,
						userId
					)
				}
			: {
					id: params.id,
					ok: false,
					error: outcome.error,
					// A refusal names no genre and lists nothing: it must not say
					// where an id it declined to touch actually lives.
					presets: []
				}
		emitToUser("sessions:layoutPreset:rename", res)
		return res
	}
}

/**
 * Delete one of the caller's own layout presets, saying how many sessions were
 * on it.
 *
 * The count is the point. `session_panel_layouts.layout_preset_id` is
 * `ON DELETE SET NULL`, so deleting a preset silently drops every session using
 * it back to the genre default — correct, but invisible. Returning the number
 * lets the client ask first (`layoutPreset:usage`) and confirm with it, and
 * makes the after-the-fact report agree with that warning by construction.
 */
export const sessionsLayoutPresetDeleteHandler: Handler<
	Sockets.Sessions.PanelLayout.Delete.Params,
	Sockets.Sessions.PanelLayout.Delete.Response
> = {
	event: "sessions:layoutPreset:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const outcome = await deleteUserLayoutPreset({
			presetId: params.id,
			userId
		})
		const res: Sockets.Sessions.PanelLayout.Delete.Response = outcome.ok
			? {
					id: outcome.id,
					ok: true,
					genreId: outcome.genreId,
					affectedSessions: outcome.affectedSessions,
					presets: await listLayoutPresets(outcome.genreId, userId)
				}
			: {
					id: params.id,
					ok: false,
					error: outcome.error,
					affectedSessions: 0,
					presets: []
				}
		emitToUser("sessions:layoutPreset:delete", res)
		return res
	}
}

/**
 * How many sessions are on one of the caller's own presets — the number the
 * delete confirmation warns with, behind the same authorship gate as the delete
 * it precedes.
 */
export const sessionsLayoutPresetUsageHandler: Handler<
	Sockets.Sessions.PanelLayout.Usage.Params,
	Sockets.Sessions.PanelLayout.Usage.Response
> = {
	event: "sessions:layoutPreset:usage",
	handler: async (socket, params, emitToUser) => {
		const outcome = await layoutPresetUsage({
			presetId: params.id,
			userId: socket.user!.id
		})
		const res: Sockets.Sessions.PanelLayout.Usage.Response = outcome.ok
			? { id: outcome.id, ok: true, sessions: outcome.sessions }
			: { id: params.id, ok: false, error: outcome.error, sessions: 0 }
		emitToUser("sessions:layoutPreset:usage", res)
		return res
	}
}

/**
 * The action list (plans/29 R-15; U5c): every venue's primary set and
 * overflow for one caller on one channel. Built as a thunk for the cascades
 * (`choosePreset`, `setFunction`), eagerly for the handler's own reply, and
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
	} = {}
): Promise<Sockets.Sessions.Actions.Response> {
	const access = opts.member
		? { hasAccess: true }
		: await checkSessionAccess(sessionId, userId)
	const { listSessionActions, formCollectsOf } = await import(
		"$lib/server/pipelines/entities/sessionActions"
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
	res.venues = (await listSessionActions(
		db,
		sessionId,
		{ userId },
		{ channel }
	)) as any
	// What a block press of a form-venue action collects (lair pass R9):
	// those actions are listed in no venue, so the collect modal reads here.
	const forms = await formCollectsOf(db, sessionId, { userId })
	if (Object.keys(forms).length) res.formCollects = forms
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
 * The presets a session may run on, for one caller.
 *
 * Split out so the cascade after `sessions:choosePreset` can re-send this
 * list as a lazy thunk: the picker it feeds is not
 * open on every surface that can change a preset. The caller's `isAdmin` rides
 * along because it decides which presets they may be offered — see the entity
 * layer, where a disabled preset is hidden from a non-admin and refused to one.
 */
async function buildSessionPresets(
	sessionId: number,
	caller: { userId: number; isAdmin: boolean }
): Promise<Sockets.Sessions.PresetOptions.Response> {
	const access = await checkSessionAccess(sessionId, caller.userId)
	const res: Sockets.Sessions.PresetOptions.Response = {
		sessionId,
		specSlug: null,
		selectedId: null,
		options: []
	}
	if (access.hasAccess) {
		const { listSessionPresets, STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		const r = await listSessionPresets(
			db,
			sessionId,
			session?.genreId ?? STANDARD_GENRE_ID,
			caller
		)
		res.specSlug = r.specSlug
		res.selectedId = r.selectedId
		res.options = r.options
	}
	return res
}

/**
 * The presets a session may run on (19 §7).
 *
 * Readable by anyone with access — choosing a preset is the ordinary user's
 * one lever over how their session behaves, so it is not an owner-only screen.
 * The *write* is narrower.
 */
export const sessionsPresetsHandler: Handler<
	Sockets.Sessions.PresetOptions.Params,
	Sockets.Sessions.PresetOptions.Response
> = {
	event: "sessions:presets",
	handler: async (socket, params, emitToUser) => {
		const res = await buildSessionPresets(params.sessionId, {
			userId: socket.user!.id,
			isAdmin: !!socket.user!.isAdmin
		})
		emitToUser("sessions:presets", res)
		return res
	}
}

/**
 * Put this session on a preset.
 *
 * Owner-only, because it changes how the session behaves for everyone in it. The
 * entity layer refuses a preset from another pipeline and — the one that
 * matters — a disabled preset for a non-admin: `enabled` is the
 * administrator's answer to "what may people choose", and a picker that hid
 * one while the write accepted it would make the switch advisory.
 */
export const sessionsChoosePresetHandler: Handler<
	Sockets.Sessions.ChoosePreset.Params,
	Sockets.Sessions.ChoosePreset.Response
> = {
	event: "sessions:choosePreset",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const reply = (
			res: Sockets.Sessions.ChoosePreset.Response
		): Sockets.Sessions.ChoosePreset.Response => {
			emitToUser("sessions:choosePreset", res)
			return res
		}
		if (!access.hasAccess || !access.isOwner)
			return reply({
				sessionId: params.sessionId,
				error: "Session not found."
			})

		const { chooseSessionPreset, STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)

		const r = await chooseSessionPreset(
			db,
			params.sessionId,
			session?.genreId ?? STANDARD_GENRE_ID,
			params.configId,
			{ userId, isAdmin: !!socket.user!.isAdmin }
		)
		if (!r.ok) return reply({ sessionId: params.sessionId, error: r.error })

		// The preset is a session setting (PLAN-turn-order §4.1, A2): its
		// change is a `session-updated` naming `presetId`, under the
		// person's `settings` cause. Best-effort — the choice has landed.
		try {
			const { emitSessionEvent } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			await emitSessionEvent(db, {
				sessionId: params.sessionId,
				userId,
				event: sessionEvents.sessionUpdated,
				payload: {
					sessionId: params.sessionId,
					changed: ["presetId"],
					cause: { kind: "settings", userId }
				},
				io: socket.io
			})
		} catch (err) {
			console.warn("session-updated emit failed:", err)
		}

		// The preset decides which actions a session includes, so all three
		// follow in the same breath — otherwise the Actions list describes the
		// preset the session was on a moment ago.
		//
		// LAZY (plan ruling 4), and the three builders are the very payloads
		// their own handlers reply with: each is a genre read plus a projection,
		// and the panels that render them are three separate surfaces. A caller
		// with none of them open pays for none of them.
		const caller = { userId, isAdmin: !!socket.user!.isAdmin }
		await emitToUser("sessions:presets", () =>
			buildSessionPresets(params.sessionId, caller)
		)
		await emitToUser("sessions:functions", () =>
			buildSessionFunctions(params.sessionId, caller)
		)
		await emitToUser("sessions:actions", () =>
			withSessionActionsChain(params.sessionId, () =>
				buildSessionActions(params.sessionId, userId, undefined)
			)
		)
		return reply({ sessionId: params.sessionId, configId: params.configId })
	}
}

/**
 * The genre's functions and their state on one session, for one caller.
 *
 * Split out like its two siblings above: `sessions:choosePreset` and
 * `sessions:setFunction` both re-send it, and neither knows whether the section
 * that renders it is open.
 */
async function buildSessionFunctions(
	sessionId: number,
	caller: { userId: number; isAdmin: boolean }
): Promise<Sockets.Sessions.Functions.Response> {
	const access = await checkSessionAccess(sessionId, caller.userId)
	const { listSessionFunctions, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const genreId = session?.genreId ?? STANDARD_GENRE_ID

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

		const { setSessionFunction, STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)
		const genreId = session?.genreId ?? STANDARD_GENRE_ID

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
		// buttons cannot lag the setting that decides them. Both lazy — see
		// `sessions:choosePreset` above, which re-sends the same two.
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

/**
 * The `sessions:get` payload: one session, its page of messages, and the
 * caller's draft.
 *
 * Pulled out of the handler below so the three cascades that re-send a session
 * after a mutation (`sessionMessages:delete` and the two session-character
 * verbs) can hand it to `emitToUser` as a thunk — one source of truth for the
 * payload, and the whole re-read is skipped when no view has that session open.
 *
 * ⚠ Not the payload the `sessions:get` BROADCASTS build. Those carry every
 * message rather than a page of them (`getSessionFromDB` with no limit) and no
 * pagination metadata at all, so they stay where they are, next to the
 * broadcast that sends them.
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

	const sessionData = await getSessionFromDB(
		sessionId,
		userId,
		limit,
		beforeId
	)

	if (!sessionData) return { session: null, messages: null, sessionId }

	// Count total messages for pagination metadata
	const [{ total }] = await db
		.select({ total: count() })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))

	const loadedCount = (sessionData as any).sessionMessages.length
	const hasMore =
		beforeId != null
			? loadedCount === limit // cursor mode: full page implies more exist
			: total > limit // initial load: more exist than we fetched

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
	}

	// The session's sprite-set overrides (DESIGN-sprites §2.3), so a portrait
	// shows the outfit the session changed to before the next line records it.
	try {
		const { spriteSetOverridesFor } = await import(
			"$lib/server/sprites/choices"
		)
		;(sessionData as any).spriteSetOverrides = await spriteSetOverridesFor(
			db,
			sessionId,
			((sessionData as any).sessionCharacters ?? [])
				.map((sc: any) => sc.characterId)
				.filter((id: unknown): id is number => typeof id === "number")
		)
	} catch {
		;(sessionData as any).spriteSetOverrides = {}
	}

	return {
		session: sessionData as any,
		messages: (sessionData as any).sessionMessages || null,
		pagination: { total, hasMore },
		beforeId,
		userDraft
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
 * The session data panel (owner-approved 2026-09-26): the whole annex laid
 * out against its owners' declarations, plus legacy keys. The session's
 * owner and administrators only — anyone else is refused by sentence, the
 * same one whether the session is theirs to see or absent. Never pushed:
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
		const out = await inspectAnnex(db, sessionId, {
			id: socket.user!.id,
			isAdmin: !!socket.user!.isAdmin
		})
		if (!out.ok) {
			emitToUser("sessions:annexInspect:error", { sessionId, error: out.error })
			return
		}
		emitToUser("sessions:annexInspect", out.result)
		return out.result
	}
}

export const sessionsGetHandler: Handler<
	Sockets.Sessions.Get.Params,
	Sockets.Sessions.Get.Response
> = {
	event: "sessions:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const res = await buildSessionGetResponse(
				params.id,
				socket.user!.id,
				{ limit: params.limit, beforeId: params.beforeId }
			)
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

/**
 * The session, re-sent to the caller after a mutation it cannot describe.
 *
 * The lazy counterpart of the handler above, for the three verbs whose own
 * reply says only what they changed: a delete or a visibility change made from
 * a surface with no session view open re-reads nothing.
 *
 * ⚠ A re-read that THROWS is logged by `emitToUser` and emits nothing — no
 * `sessions:get:error`, and nothing raised into the caller's own catch, which
 * is right for a push the caller's reply does not depend on. The page is the
 * builder's default 25 messages, the same one a bare `{ id }` request asks
 * for.
 */
function resendSession(
	socket: any,
	sessionId: number,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("sessions:get", () =>
		buildSessionGetResponse(sessionId, socket.user!.id)
	)
}

/**
 * The whole session, broadcast to everyone in it after its membership changed.
 *
 * The three verbs that add or remove a participant all send this, and they send
 * it to the session's owner and guests rather than to the caller alone — a
 * guest's view has to learn about the persona somebody else just added.
 *
 * ⚠ Not `buildSessionGetResponse`, and the two must not be merged: this
 * payload carries EVERY message rather than the first page of them and no
 * pagination metadata, so one builder for both would change what a
 * participant's view receives.
 *
 * LAZY (plan ruling 4): the re-read — the session with its cast, its personas,
 * its guests and its messages — is handed over as a thunk, so a session no view
 * has open anywhere costs neither it nor the two roster reads behind the
 * broadcast. Nullish back means the session is gone: there is nothing to send.
 */
function broadcastSessionToParticipants(
	socket: any,
	sessionId: number,
	userId: number
) {
	return broadcastToSessionUsers(
		socket.io,
		sessionId,
		"sessions:get",
		async () => {
			const updatedSession = await getSessionFromDB(sessionId, userId)
			if (!updatedSession) return null
			return {
				session: updatedSession as any,
				messages: (updatedSession as any).sessionMessages || null
			}
		}
	)
}

export const sessionsSaveDraftHandler: Handler<
	Sockets.Sessions.SaveDraft.Params,
	Sockets.Sessions.SaveDraft.Response
> = {
	event: "sessions:saveDraft",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess) {
			return { success: false }
		}

		const existing = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, params.sessionId),
			columns: { drafts: true }
		})
		const drafts: Record<string, string> = { ...(existing?.drafts ?? {}) }
		if (params.content) {
			drafts[String(userId)] = params.content
		} else {
			delete drafts[String(userId)]
		}
		await db
			.update(schema.sessions)
			.set({ drafts })
			.where(eq(schema.sessions.id, params.sessionId))

		return { success: true }
	}
}

// ─── Binding check utility (Flow 1) ─────────────────────────────────────────
// Flow 2 (node-linking, bindingCheck:nodeResult / NodeLinkerModal) is gone —
// see the lorebookBindings/narrativeNodes merge plan. A binding IS the
// graph row now, so there's no separate "node" to reconcile it with.

/**
 * The cast a session reads into its book, kept whole:
 * - Quietly create bindings for chars/personas that don't have one yet.
 * - Emit bindingCheck:result for any orphaned bindings (bindings without a char/persona).
 *
 * Ruling 2026-09-12: cast members arrive from the session on their own.
 * There is no "pull the cast" button to press, so every path that puts a
 * lorebook and a session together — or adds a member to a session that
 * already reads one — calls this. Removing a member does NOT remove the
 * binding: lore, relationships and scene appearances may be anchored to it.
 *
 * Creation goes through resolveOrCreateBindingRow rather than a bare insert.
 * This read every binding once and inserted against that snapshot, which is
 * only safe while one path can reach it; now that several can, two of them
 * running at once (an attach and a member add) would both pass the same
 * check. The advisory lock inside that helper covers check-and-insert as one
 * step, and the partial unique indexes (0125) refuse the second row outright.
 */
export async function runLorebookBindingCheck(
	socket: any,
	sessionId: number,
	lorebookId: number,
	emitToUser: (event: string, data: any) => void
): Promise<void> {
	const [sessionChars, sessionPersonas, existingBindings] = await Promise.all(
		[
			db.query.sessionCharacters.findMany({
				where: and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt)
				),
				columns: { characterId: true }
			}),
			db.query.sessionPersonas.findMany({
				where: and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					isNull(schema.sessionPersonas.removedAt)
				),
				columns: { personaId: true }
			}),
			db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, lorebookId)
			})
		]
	)

	const bindingsByChar = new Set(
		existingBindings.filter((b) => b.characterId).map((b) => b.characterId!)
	)
	// The SAME set as `bindingsByChar` — a voiced character's binding IS a
	// character binding, so a cast member who is also somebody's persona must
	// not be given a second row.
	const bindingsByPersona = bindingsByChar

	// Flow 1a: Create missing bindings for chars/personas. Each binding's
	// token is derived from the lorebook's own per-lorebook counter (never
	// reused after a delete) — never a recomputed max/count, which is what
	// let deleted binding numbers get silently reused before.
	let minted = false
	for (const { characterId } of sessionChars) {
		if (!characterId || bindingsByChar.has(characterId)) continue
		const { created } = await resolveOrCreateBindingRow(
			{ lorebookId, characterId },
			db
		)
		minted ||= created
		bindingsByChar.add(characterId)
	}

	for (const { personaId } of sessionPersonas) {
		if (!personaId || bindingsByPersona.has(personaId)) continue
		const { created } = await resolveOrCreateBindingRow(
			{ lorebookId, characterId: personaId },
			db
		)
		minted ||= created
		bindingsByPersona.add(personaId)
	}

	// The cast changed, so anyone looking at it should see the new rows
	// without reloading — the same refresh lorebooks:createBinding sends.
	// Only the book's owner may read that list, and the builder refuses
	// everyone else, so a guest whose member add triggered this is asked for
	// nothing on their behalf. Lazy (socket-interest plan, ruling 4): the
	// three-way join behind the cast is paid only when a socket is showing
	// it.
	if (minted) {
		const ownedBook = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, lorebookId),
				eq(schema.lorebooks.userId, socket.user!.id)
			),
			columns: { id: true }
		})
		if (ownedBook) await relistBindings(socket, lorebookId, emitToUser)
	}

	// Flow 1b: Collect orphaned bindings (no character). Read off the
	// pre-loop snapshot: a row minted above is bound by construction and can
	// never be one.
	const orphaned = existingBindings.filter((b) => !b.characterId)
	if (orphaned.length > 0) {
		// The lazy form, with the projection INSIDE it: the orphan list is
		// built for this payload and nothing else, so a session whose cast
		// panel nobody has open builds none of it.
		//
		// There is no list of session members left without a member: flow 1a
		// above mints one for every session character (or throws), so that
		// list was always empty and is gone from the reply (finding #140).
		//
		// ⚠ The three reads at the top of this function stay OUT of the
		// thunk, deliberately: flow 1a mints bindings from them, and that
		// has to happen whether or not anybody is watching. What the gate
		// may skip is the answer, never the work the check exists to do.
		await emitToUser("bindingCheck:result", () => {
			const bindingCheckRes: Sockets.BindingCheck.Result.Response = {
				lorebookId,
				sessionId,
				orphanedBindings: orphaned.map((b) => ({
					id: b.id,
					binding: b.binding
				}))
			}
			return bindingCheckRes
		})
	}
}

/**
 * 🚧 Where a session reads its book (rulings 15/16, story-time P3), as the
 * columns a create or an update writes:
 *
 * - The book changed (attached, switched or detached): the new book's most
 *   recently used line, with NO clock of its own — the session follows that
 *   line's present, which is what a session always read (owner 2026-09-28:
 *   a clock is stored only when set here or advanced by a pipeline, and the
 *   first set or step starts FROM the line's present). A clock set for the
 *   old book is cleared: it was a date on another calendar. Unless this same
 *   save names a line or a clock, which then apply to the new book.
 * - A named branch must be a branch of the book the session will read.
 * - A named clock must land in that book's calendar; null clears it (the
 *   session follows its line's present).
 *
 * ⚠ Writes the SESSION's clock only. The book's present never moves here.
 */
export async function sessionLinePatch(args: {
	before: {
		lorebookId: number | null
		lorebookBranchId: number | null
	} | null
	lorebookId?: number | null
	lorebookBranchId?: number | null
	clock?: {
		year: number
		month?: number | null
		day?: number | null
		hour?: number | null
		minute?: number | null
	} | null
}): Promise<Partial<typeof schema.sessions.$inferInsert>> {
	const { mostRecentBranchOf, branchOfBook, BranchRefusal } = await import(
		"$lib/server/state/reading"
	)
	const { bookCalendarOf, clockColumns, clockProblem } = await import(
		"$lib/server/state/storyTime"
	)
	const beforeBook = args.before?.lorebookId ?? null
	const book = args.lorebookId !== undefined ? (args.lorebookId ?? null) : beforeBook
	const patch: Partial<typeof schema.sessions.$inferInsert> = {}
	const bookChanged = book !== beforeBook || !args.before
	if (bookChanged) patch.lorebookBranchId = book ? await mostRecentBranchOf(db, book) : null
	if (args.lorebookBranchId !== undefined) {
		const branchId = args.lorebookBranchId ?? null
		if (branchId !== null) {
			if (!book) throw new Error("A session with no lorebook reads no branch.")
			try {
				await branchOfBook(db, book, branchId)
			} catch (e) {
				if (e instanceof BranchRefusal)
					throw new Error(`That branch is not a branch of this session's lorebook.`)
				throw e
			}
		}
		patch.lorebookBranchId = branchId
	}
	if (args.clock !== undefined) {
		if (args.clock === null) Object.assign(patch, clockColumns(null))
		else {
			if (!book) throw new Error("A session with no lorebook has no story clock to set.")
			const clock = args.clock
			const problem = clockProblem(clock, await bookCalendarOf(db, book))
			if (problem) throw new Error(`That clock does not fit this lorebook: ${problem}`)
			Object.assign(patch, clockColumns(clock))
		}
	} else if (bookChanged) Object.assign(patch, clockColumns(null))
	return patch
}

/** The story clock a create or an update names: undefined = untouched, null = cleared. */
function clockFromColumns(cols: {
	storyClockYear?: number | null
	storyClockMonth?: number | null
	storyClockDay?: number | null
	storyClockHour?: number | null
	storyClockMinute?: number | null
}) {
	if (cols.storyClockYear === undefined) return undefined
	if (cols.storyClockYear === null) return null
	return {
		year: cols.storyClockYear,
		month: cols.storyClockMonth ?? null,
		day: cols.storyClockDay ?? null,
		hour: cols.storyClockHour ?? null,
		minute: cols.storyClockMinute ?? null
	}
}

export const sessionsUpdateHandler: Handler<
	Sockets.Sessions.Update.Params,
	Sockets.Sessions.Update.Response
> = {
	event: "sessions:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Check if user has access to update this session
			const sessionAccess = await checkSessionAccess(
				params.session.id!,
				userId
			)
			if (!sessionAccess.hasAccess) {
				emitToUser("sessions:update:error", {
					error: "Access denied. Only session owners can update sessions."
				})
				throw new Error(
					"Access denied. Only session owners can update sessions."
				)
			}

			// Guests may manage characters/personas on a session (further
			// ownership-checked below) but never session-level settings — name,
			// scenario, lorebook, connection/sampling/prompt overrides, tags,
			// response mode, etc. Enforced here server-side rather than only
			// hiding those fields client-side, since this event is reachable
			// directly regardless of what the UI shows.
			/** The genre's fields changed — a value a predicate may read (U5e, review W-A5). */
			let fieldsMoved = false
			if (sessionAccess.isOwner) {
				const tags = params.tags || []

				// lorebookId needs an ownership check (lorebooks is strictly
				// per-user) before it's accepted — everything else here is
				// either owner-only data or a reference to an admin-managed
				// global table (samplingConfigs/promptConfigs/
				// narratorPromptConfigs), which needs no such check.
				//
				// ⚠ `connectionId` was on that list, then was refused for
				// non-admins, and is now simply gone (0130): a session names no
				// connection at all. The allowlist below IS the strip — a key
				// nobody destructures is a key nothing writes — so an old
				// client still posting the field changes nothing and is told
				// nothing, because there is no boundary left for it to have
				// crossed.
				if (params.session.lorebookId != null) {
					const ownsLorebook = await checkLorebookOwnership(
						params.session.lorebookId,
						userId
					)
					if (!ownsLorebook) {
						throw new Error(
							"Access denied. You can only attach a lorebook you own."
						)
					}
				}

				// Explicit allowlist, not a spread of the full client payload
				// (Params.session is UpdateSession = Partial<SelectSession>, so a bare
				// spread would also accept id/userId/isGroup/createdAt —
				// isGroup is recomputed separately below when characterIds is
				// provided, never client-settable directly here). Tags are
				// handled separately via Params.tags, not this table.
				const {
					name,
					sessionType,
					scenario,
					metadata,
					drafts,
					lorebookId,
					samplingConfigId,
					promptConfigId,
					narratorPromptConfigId,
					genreFields,
					lorebookBranchId,
					storyClockYear,
					storyClockMonth,
					storyClockDay,
					storyClockHour,
					storyClockMinute
				} = params.session

				// Mode field values, filtered to the keys the session's mode
				// declares (19 §1) — same write rule as creation. `genreId`
				// itself is deliberately absent from this allowlist: switching
				// a session's mode is a policy question 19 §10 leaves open, not an
				// update field.
				let genreFieldsPatch: Record<string, unknown> | undefined
				if (genreFields !== undefined) {
					const { getSessionGenre, STANDARD_GENRE_ID } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const [row] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, params.session.id!))
						.limit(1)
					const mode = await getSessionGenre(
						db,
						row?.genreId ?? STANDARD_GENRE_ID
					)
					const declared = Object.keys(
						(mode?.shape as any)?.fields ?? {}
					)
					genreFieldsPatch = Object.fromEntries(
						Object.entries(
							(genreFields ?? {}) as Record<string, unknown>
						).filter(([k]) => declared.includes(k))
					)
				}

				/**
				 * What `session-updated` names as `changed` (PLAN-turn-order
				 * §4.1, A2): the columns whose stored value differs after
				 * the write, by name, in the allowlist's order — read once
				 * before the write and compared after it, so a form that
				 * posts every field unchanged emits nothing. Tags are diffed
				 * as a set of ids.
				 */
				const [before] = await db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.id, params.session.id!))
					.limit(1)
				const tagsBefore = (
					await db
						.select({ tagId: schema.sessionTags.tagId })
						.from(schema.sessionTags)
						.where(eq(schema.sessionTags.sessionId, params.session.id!))
				)
					.map((t) => t.tagId)
					.sort()

				// 🚧 Where the session reads its book (ruling 15, story-time
				// P3): its line and its story clock. Attaching or switching a
				// book starts it at that book's most recently used line with no
				// clock of its own (it follows that line's present); a named
				// branch must be one of the book's own, and a clock must land
				// in its calendar.
				// Refused with a sentence, never quietly read as main.
				const linePatch = await sessionLinePatch({
					before: before ?? null,
					lorebookId,
					lorebookBranchId,
					clock: clockFromColumns({
						storyClockYear,
						storyClockMonth,
						storyClockDay,
						storyClockHour,
						storyClockMinute
					})
				})

				await db
					.update(schema.sessions)
					.set({
						...linePatch,
						...(name !== undefined ? { name } : {}),
						...(sessionType !== undefined ? { sessionType } : {}),
						...(scenario !== undefined ? { scenario } : {}),
						...(metadata !== undefined ? { metadata } : {}),
						...(drafts !== undefined ? { drafts } : {}),
						...(lorebookId !== undefined ? { lorebookId } : {}),
						// The session's ONE remaining compute override, and it
						// is not a connection: a sampling profile says how to
						// sample, never where to send. Anyone who owns the
						// session may set it — there is no instance resource
						// behind it to protect.
						...(samplingConfigId !== undefined
							? { samplingConfigId }
							: {}),
						...(promptConfigId !== undefined
							? { promptConfigId }
							: {}),
						...(narratorPromptConfigId !== undefined
							? { narratorPromptConfigId }
							: {}),
						...(genreFieldsPatch !== undefined
							? { genreFields: genreFieldsPatch }
							: {}),
						updatedAt: new Date().toISOString()
					})
					.where(eq(schema.sessions.id, params.session.id!))

				// The `playerLabel` override (lair re-plan R4): on the row's
				// metadata, written as its own key so nothing else there moves.
				// Only for a genre that declares a label — a rename of nothing
				// is not stored. Before the `after` read below, so a rename is
				// named as `metadata` in `session-updated`.
				if (params.playerLabel !== undefined) {
					const { getSessionGenre, STANDARD_GENRE_ID } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const genre = await getSessionGenre(
						db,
						before?.genreId ?? STANDARD_GENRE_ID
					)
					if (genre?.playerLabel) {
						const { writePlayerLabel } = await import(
							"$lib/server/sessions/playerLabel"
						)
						await writePlayerLabel(
							db,
							params.session.id!,
							params.playerLabel
						)
					}
				}

				// Process tags after session update
				await processSessionTags(params.session.id!, tags, userId)
				fieldsMoved = genreFieldsPatch !== undefined

				// `session-updated` (§4.1): emitted once, only when a
				// column moved, under the person's `settings` cause — which
				// never fires a turn (§4.6). Best-effort, like the member
				// events below: an emitter failing must not fail the save.
				try {
					const [after] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, params.session.id!))
						.limit(1)
					const tagsAfter = (
						await db
							.select({ tagId: schema.sessionTags.tagId })
							.from(schema.sessionTags)
							.where(
								eq(schema.sessionTags.sessionId, params.session.id!)
							)
					)
						.map((t) => t.tagId)
						.sort()
					const same = (a: unknown, b: unknown) =>
						JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
					const changed: string[] = []
					if (before && after) {
						for (const column of [
							"name",
							"sessionType",
							"scenario",
							"metadata",
							"drafts",
							"lorebookId",
							"samplingConfigId",
							"promptConfigId",
							"narratorPromptConfigId",
							"genreFields",
							"lorebookBranchId"
						] as const)
							if (!same(before[column], after[column]))
								changed.push(column)
						const clockOf = (r: typeof before) => [
							r.storyClockYear,
							r.storyClockMonth,
							r.storyClockDay,
							r.storyClockHour,
							r.storyClockMinute
						]
						if (!same(clockOf(before), clockOf(after))) changed.push("storyClock")
					}
					// The line or the clock moved: what the session inherits
					// did, so every tab reads its state afresh.
					if (
						changed.some((c) =>
							c === "lorebookId" || c === "lorebookBranchId" || c === "storyClock"
						)
					)
						await broadcastToSessionUsers(socket.io, params.session.id!, "state:changed", {
							sessionId: params.session.id!
						} satisfies Sockets.State.Changed.Response)
					if (!same(tagsBefore, tagsAfter)) changed.push("tags")
					if (changed.length) {
						const { emitSessionEvent } = await import(
							"$lib/server/pipelines/runtime/sessionEvents"
						)
						await emitSessionEvent(db, {
							sessionId: params.session.id!,
							userId,
							event: sessionEvents.sessionUpdated,
							payload: {
								sessionId: params.session.id!,
								changed,
								cause: { kind: "settings", userId }
							},
							io: socket.io
						})
					}
				} catch (err) {
					console.warn("session-updated emit failed:", err)
				}
			}

			// Membership deltas dispatch as member events (24 §5) after the
			// sync — snapshots rather than per-branch bookkeeping, so revives,
			// permission-blocked removals and upserts all count what actually
			// changed. A genre's pipelines bind by declaring (genre,
			// member-added/removed); nothing serves today, and the dispatch
			// resolving to nothing costs one SELECT.
			const memberSnapshot = async () => {
				const ccs = await db.query.sessionCharacters.findMany({
					where: (cc, { eq }) => eq(cc.sessionId, params.session.id!)
				})
				const cps = await db.query.sessionPersonas.findMany({
					where: (cp, { eq }) => eq(cp.sessionId, params.session.id!)
				})
				const liveCcs = ccs.filter(
					(c) => !c.removedAt && c.characterId != null
				)
				const liveCps = cps.filter(
					(c) => !c.removedAt && c.personaId != null
				)
				return {
					characters: new Set(liveCcs.map((c) => c.characterId as number)),
					personas: new Set(liveCps.map((c) => c.personaId as number)),
					// Seat positions by participant reference, for the
					// `cast-changed` diff (PLAN-turn-order §4.1): a reorder
					// is a cast change, not a membership one. A persona is a
					// character row (0132), so its reference is `character:`.
					positions: new Map<string, number>([
						...liveCcs.map(
							(c) => [`character:${c.characterId}`, c.position ?? 0] as const
						),
						...liveCps.map(
							(c) => [`character:${c.personaId}`, c.position ?? 0] as const
						)
					])
				}
			}
			const membersBefore =
				params.characterIds !== undefined ||
				params.personaIds !== undefined
					? await memberSnapshot()
					: null

			// Sync sessionCharacters if provided
			if (params.characterIds !== undefined) {
				const existingCCs = await db.query.sessionCharacters.findMany({
					where: (cc, { eq }) => eq(cc.sessionId, params.session.id!),
					with: { character: true }
				})
				// Diffing/ownership decisions below are all against currently
				// *active* participants — a removed row must not block a
				// re-add, and must not be silently "removed" again.
				const activeCCs = existingCCs.filter((cc) => !cc.removedAt)
				const existingCharacterIds = new Set(
					activeCCs
						.map((cc) => cc.characterId)
						.filter((id): id is number => id !== null)
				)
				const newCharacterIds = new Set(params.characterIds)

				// Only characters the requesting user owns can be newly added —
				// already-linked characters (eg. added by another participant)
				// are left alone regardless of who owns them.
				const characterIdsToAdd = params.characterIds.filter(
					(id) => !existingCharacterIds.has(id)
				)
				if (characterIdsToAdd.length > 0) {
					const ownedCharacterIds = await checkCharactersOwnership(
						characterIdsToAdd,
						userId
					)
					if (ownedCharacterIds.size !== characterIdsToAdd.length) {
						emitToUser("sessions:update:error", {
							error: "Access denied. You can only add characters you own."
						})
						throw new Error(
							"Access denied. Attempted to add a character not owned by the user."
						)
					}
				}

				// Removal is a soft delete, not a hard delete, so past
				// messages can still resolve who spoke them. Guests may only
				// remove characters they themselves own; the session owner may
				// remove anyone's. A row the caller isn't permitted to touch
				// is simply left alone (not removed, no error), matching
				// this handler's existing per-row tolerance.
				for (const cc of activeCCs) {
					if (cc.characterId === null) continue
					if (!newCharacterIds.has(cc.characterId)) {
						const canRemove =
							sessionAccess.isOwner ||
							cc.character?.userId === userId
						if (!canRemove) continue
						await db
							.update(schema.sessionCharacters)
							.set({
								removedAt: new Date(),
								removedName: resolveCharacterName(
									cc.character,
									"Unknown"
								),
								isActive: false
							})
							.where(
								and(
									eq(
										schema.sessionCharacters.sessionId,
										params.session.id!
									),
									eq(
										schema.sessionCharacters.characterId,
										cc.characterId
									)
								)
							)
					}
				}
				for (let i = 0; i < params.characterIds.length; i++) {
					const characterId = params.characterIds[i]
					const position =
						(params.characterPositions ?? {})[characterId] ?? i
					if (existingCharacterIds.has(characterId)) {
						await db
							.update(schema.sessionCharacters)
							.set({ position })
							.where(
								and(
									eq(
										schema.sessionCharacters.sessionId,
										params.session.id!
									),
									eq(
										schema.sessionCharacters.characterId,
										characterId
									)
								)
							)
					} else {
						// Upsert, not insert: the target character may already
						// have a soft-removed row for this session (sessionId +
						// characterId is uniquely indexed), in which case this
						// re-add must revive it rather than violate that index.
						await db
							.insert(schema.sessionCharacters)
							.values({
								sessionId: params.session.id!,
								characterId,
								position
							})
							.onConflictDoUpdate({
								target: [
									schema.sessionCharacters.sessionId,
									schema.sessionCharacters.characterId
								],
								set: {
									position,
									removedAt: null,
									removedName: null,
									isActive: true
								}
							})
					}
				}
				await db
					.update(schema.sessions)
					.set({ isGroup: params.characterIds.length > 1 })
					.where(eq(schema.sessions.id, params.session.id!))
			}

			// Sync sessionPersonas if provided
			if (params.personaIds !== undefined) {
				const existingCPs = await db.query.sessionPersonas.findMany({
					where: (cp, { eq }) => eq(cp.sessionId, params.session.id!),
					with: { persona: true }
				})
				const activeCPs = existingCPs.filter((cp) => !cp.removedAt)
				const existingPersonaIds = new Set(
					activeCPs
						.map((cp) => cp.personaId)
						.filter((id): id is number => id !== null)
				)
				const newPersonaIds = new Set(params.personaIds)

				// Only personas the requesting user owns can be newly added —
				// already-linked personas (eg. added by another participant)
				// are left alone regardless of who owns them.
				const personaIdsToAdd = params.personaIds.filter(
					(id) => !existingPersonaIds.has(id)
				)
				if (personaIdsToAdd.length > 0) {
					const ownedPersonaIds = await checkPersonasOwnership(
						personaIdsToAdd,
						userId
					)
					if (ownedPersonaIds.size !== personaIdsToAdd.length) {
						emitToUser("sessions:update:error", {
							error: "Access denied. You can only add personas you own."
						})
						throw new Error(
							"Access denied. Attempted to add a persona not owned by the user."
						)
					}
				}

				// Soft delete, same rule as characters above: guests may only
				// remove personas they own; the session owner may remove anyone's.
				for (const cp of activeCPs) {
					if (cp.personaId === null) continue
					if (!newPersonaIds.has(cp.personaId)) {
						const canRemove =
							sessionAccess.isOwner ||
							cp.persona?.userId === userId
						if (!canRemove) continue
						await db
							.update(schema.sessionPersonas)
							.set({
								removedAt: new Date(),
								removedName: resolvePersonaName(
									cp.persona,
									"Unknown"
								)
							})
							.where(
								and(
									eq(
										schema.sessionPersonas.sessionId,
										params.session.id!
									),
									eq(
										schema.sessionPersonas.personaId,
										cp.personaId
									)
								)
							)
					}
				}
				for (let i = 0; i < params.personaIds.length; i++) {
					const personaId = params.personaIds[i]
					if (existingPersonaIds.has(personaId)) {
						await db
							.update(schema.sessionPersonas)
							.set({ position: i })
							.where(
								and(
									eq(
										schema.sessionPersonas.sessionId,
										params.session.id!
									),
									eq(
										schema.sessionPersonas.personaId,
										personaId
									)
								)
							)
					} else {
						// Upsert: revive a soft-removed row if one exists for
						// this sessionId + personaId rather than violating the
						// unique index on that pair.
						await db
							.insert(schema.sessionPersonas)
							.values({
								sessionId: params.session.id!,
								personaId,
								position: i
							})
							.onConflictDoUpdate({
								target: [
									schema.sessionPersonas.sessionId,
									schema.sessionPersonas.personaId
								],
								set: {
									position: i,
									removedAt: null,
									removedName: null
								}
							})
						await markCharacterAsPersona(personaId)
					}
				}
			}

			// The member events (24 §5), best-effort: a failed dispatch must
			// never fail the update that caused it.
			if (membersBefore) {
				try {
					const after = await memberSnapshot()
					const deltas: Array<{
						event:
							| typeof sessionEvents.memberAdded
							| typeof sessionEvents.memberRemoved
						kind: "character" | "persona"
						id: number
					}> = []
					for (const id of after.characters)
						if (!membersBefore.characters.has(id))
							deltas.push({
								event: sessionEvents.memberAdded,
								kind: "character",
								id
							})
					for (const id of membersBefore.characters)
						if (!after.characters.has(id))
							deltas.push({
								event: sessionEvents.memberRemoved,
								kind: "character",
								id
							})
					for (const id of after.personas)
						if (!membersBefore.personas.has(id))
							deltas.push({
								event: sessionEvents.memberAdded,
								kind: "persona",
								id
							})
					for (const id of membersBefore.personas)
						if (!after.personas.has(id))
							deltas.push({
								event: sessionEvents.memberRemoved,
								kind: "persona",
								id
							})
					// A seat added or removed (R31): through the one emitter,
					// so it lands in the ledger and reaches plugin listeners
					// like every other session event, with the cast-change
					// payload — `ref` the member, `change` added/removed.
					// A persona is a character row (0132), so its reference
					// is `character:<id>` too.
					for (const delta of deltas)
						await emitMemberEvent(socket, {
							sessionId: params.session.id!,
							userId,
							event: delta.event,
							ref: `character:${delta.id}`
						})
					// A seat that MOVED (PLAN-turn-order §4.1): one
					// `cast-changed { change: 'position' }` per member still
					// seated whose position differs — a reorder, not a
					// membership change, so never a member event.
					const moved = [...after.positions].filter(
						([ref, position]) =>
							membersBefore.positions.has(ref) &&
							membersBefore.positions.get(ref) !== position
					)
					if (moved.length) {
						const { emitSessionEvent } = await import(
							"$lib/server/pipelines/runtime/sessionEvents"
						)
						for (const [ref, position] of moved)
							await emitSessionEvent(db, {
								sessionId: params.session.id!,
								userId,
								event: sessionEvents.castChanged,
								payload: {
									sessionId: params.session.id!,
									ref,
									change: "position",
									value: position,
									cause: { kind: "settings", userId }
								},
								io: socket.io
							})
					}
				} catch (err) {
					console.warn("member-event dispatch failed:", err)
				}
			}

			// Fetch updated session
			const updatedSession = await getSessionFromDB(
				params.session.id!,
				userId
			)
			if (!updatedSession) {
				throw new Error("Failed to fetch updated session")
			}

			const res: Sockets.Sessions.Update.Response = {
				session: updatedSession as any
			}
			emitToUser("sessions:update", res)
			// Refresh session list, behind the reply that carries the session.
			await relistSessions(socket, emitToUser)
			// The published values moved (U5e, review W-A5) — a genre field a
			// predicate reads, or the cast whose state `state.cast.<key>`
			// predicates read — so every member's action list follows.
			if (fieldsMoved || membersBefore) {
				const { pushSessionActions } = await import(
					"$lib/server/sessions/actionsPush"
				)
				await pushSessionActions(socket.io, params.session.id!)
			}

			// Flow 1: the cast this session reads into its book. Awaited, not
			// fired and forgotten: several paths reach this now, and a promise
			// left running past its own request can interleave with the next
			// one. Errors stay non-fatal — a book that cannot be written must
			// not fail the session update that named it.
			const lorebookId = (updatedSession as any).lorebookId
			if (lorebookId) {
				await runLorebookBindingCheck(
					socket,
					params.session.id!,
					lorebookId,
					emitToUser
				).catch(console.error)
			}

			return res
		} catch (error: any) {
			console.error("Error updating session:", error)
			emitToUser("sessions:update:error", {
				error: "Failed to update session"
			})
			throw error
		}
	}
}

export const sessionsAddPersonaHandler: Handler<
	Sockets.Sessions.AddPersona.Params,
	Sockets.Sessions.AddPersona.Response
> = {
	event: "sessions:addPersona",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { sessionId, personaId } = params

			// Check if user has access to this session
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: "Access denied. Session not found or no permission to access."
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// Check if user owns the persona they're trying to add
			const ownsPersona = await checkPersonaOwnership(personaId, userId)
			if (!ownsPersona) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: "Access denied. You can only add personas you own."
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// Check if persona is already in the session
			const existingSessionPersona =
				await db.query.sessionPersonas.findFirst({
					where: and(
						eq(schema.sessionPersonas.sessionId, sessionId),
						eq(schema.sessionPersonas.personaId, personaId)
					)
				})

			if (existingSessionPersona) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: "This persona is already in the session."
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// Get the next position
			const maxPosition = await db
				.select({ maxPos: schema.sessionPersonas.position })
				.from(schema.sessionPersonas)
				.where(eq(schema.sessionPersonas.sessionId, sessionId))
				.orderBy(desc(schema.sessionPersonas.position))
				.limit(1)

			const nextPosition = maxPosition[0]?.maxPos
				? maxPosition[0].maxPos + 1
				: 0

			// Add persona to session
			await db.insert(schema.sessionPersonas).values({
				sessionId,
				personaId,
				position: nextPosition
			})
			await markCharacterAsPersona(personaId)

			// A member added to a session that reads a book joins that book's
			// cast (ruling 2026-09-12).
			const bookForPersona = await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, sessionId),
				columns: { lorebookId: true }
			})
			if (bookForPersona?.lorebookId) {
				await runLorebookBindingCheck(
					socket,
					sessionId,
					bookForPersona.lorebookId,
					emitToUser
				).catch(console.error)
			}

			// Broadcast updated session to all participants
			await broadcastSessionToParticipants(socket, sessionId, userId)
			// A member joined (U5e, review W-A5): the audience and the cast
			// a predicate may read both moved, so every member's list follows.
			await (
				await import("$lib/server/sessions/actionsPush")
			).pushSessionActions(socket.io, sessionId)

			const res: Sockets.Sessions.AddPersona.Response = {
				success: true
			}
			emitToUser("sessions:addPersona", res)
			return res
		} catch (error: any) {
			console.error("Error adding persona to session:", error)
			const res: Sockets.Sessions.AddPersona.Response = {
				success: false,
				error: "Failed to add persona to session"
			}
			emitToUser("sessions:addPersona:error", res)
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
			const guestUser = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, guestUserId),
				columns: { id: true, isDeleted: true }
			})
			if (!guestUser || guestUser.isDeleted) {
				const res: Sockets.Sessions.AddGuest.Response = {
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
			// A member joined (U5e, review W-A5): the new guest gets their own
			// list, and everyone else's audience verdicts may have moved.
			await (
				await import("$lib/server/sessions/actionsPush")
			).pushSessionActions(socket.io, sessionId)

			const res: Sockets.Sessions.AddGuest.Response = {
				success: true
			}
			emitToUser("sessions:addGuest", res)
			return res
		} catch (error: any) {
			console.error("Error adding guest to session:", error)
			const res: Sockets.Sessions.AddGuest.Response = {
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
					success: false,
					error: "Access denied. Only session owners can remove guests."
				}
				emitToUser("sessions:removeGuest", res)
				return res
			}

			// Remove guest from session
			await db
				.delete(schema.sessionGuests)
				.where(
					and(
						eq(schema.sessionGuests.sessionId, sessionId),
						eq(schema.sessionGuests.userId, guestUserId)
					)
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
				success: true
			}
			emitToUser("sessions:removeGuest", res)
			return res
		} catch (error: any) {
			console.error("Error removing guest from session:", error)
			const res: Sockets.Sessions.RemoveGuest.Response = {
				success: false,
				error: "Failed to remove guest from session"
			}
			emitToUser("sessions:removeGuest:error", res)
			throw error
		}
	}
}

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

			// Refresh session list
			await relistSessions(socket, emitToUser)

			// The copy's history came with it, so the new row has a line to
			// quote from its first moment.
			broadcastSessionRow(socket.io, newSessionId)

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
 * Re-points a removed (soft-deleted) session participant's message history to a
 * new character/persona, and makes the new one an active participant — the
 * "adopt this removed participant's history" flow paired with the soft
 * delete in sessionsUpdateHandler. Permission mirrors the removal path: the
 * session owner can reassign anyone's removed slot; a non-owner can only
 * reassign a removed slot they themselves originally owned (once the
 * underlying entity is globally deleted there's no more "original owner" to
 * check against, so only the session owner can act at that point).
 */
export const sessionsReassignRemovedParticipantHandler: Handler<
	Sockets.Sessions.ReassignRemovedParticipant.Params,
	Sockets.Sessions.ReassignRemovedParticipant.Response
> = {
	event: "sessions:reassignRemovedParticipant",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { sessionId, type, oldId, newId } = params

			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
					{
						error: "Access denied. Session not found or no permission to access."
					}
				emitToUser("sessions:reassignRemovedParticipant", res)
				return res
			}

			if (oldId === newId) {
				const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
					{
						error: "Cannot reassign a removed participant to themselves — re-add them normally instead."
					}
				emitToUser("sessions:reassignRemovedParticipant", res)
				return res
			}

			if (type === "character") {
				const removedCC = await db.query.sessionCharacters.findFirst({
					where: (cc, { and, eq, isNotNull }) =>
						and(
							eq(cc.sessionId, sessionId),
							eq(cc.characterId, oldId),
							isNotNull(cc.removedAt)
						),
					with: { character: true }
				})
				if (!removedCC) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Removed character not found in this session."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const canReassign =
					sessionAccess.isOwner ||
					removedCC.character?.userId === userId
				if (!canReassign) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. Only the session owner or this character's original owner can reassign it."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const ownsNewTarget = await checkCharacterOwnership(
					newId,
					userId
				)
				if (!ownsNewTarget) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. You can only reassign to a character you own."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				// Atomic: bulk-reassign history, upsert the new active
				// participant, and remove the old slot all-or-nothing. A
				// crash between these steps would otherwise either leave
				// messages repointed with the old removed row still
				// lingering, or — the dangerous ordering — delete the old
				// row while messages still reference it, which nulls out
				// via onDelete: "set null" and reverts to "Unknown": the
				// exact data loss this handler exists to prevent.
				await db.transaction(async (tx) => {
					await updateLegacyWhere(
						tx,
						and(
							eq(schema.sessionMessages.sessionId, sessionId),
							eq(schema.sessionMessages.characterId, oldId)
						),
						{ characterId: newId }
					)
					await tx
						.insert(schema.sessionCharacters)
						.values({
							sessionId,
							characterId: newId,
							position: removedCC.position ?? 0
						})
						.onConflictDoUpdate({
							target: [
								schema.sessionCharacters.sessionId,
								schema.sessionCharacters.characterId
							],
							set: {
								removedAt: null,
								removedName: null,
								isActive: true
							}
						})
					await tx
						.delete(schema.sessionCharacters)
						.where(
							and(
								eq(
									schema.sessionCharacters.sessionId,
									sessionId
								),
								eq(schema.sessionCharacters.characterId, oldId)
							)
						)
				})
			} else {
				const removedCP = await db.query.sessionPersonas.findFirst({
					where: (cp, { and, eq, isNotNull }) =>
						and(
							eq(cp.sessionId, sessionId),
							eq(cp.personaId, oldId),
							isNotNull(cp.removedAt)
						),
					with: { persona: true }
				})
				if (!removedCP) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{ error: "Removed persona not found in this session." }
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const canReassign =
					sessionAccess.isOwner ||
					removedCP.persona?.userId === userId
				if (!canReassign) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. Only the session owner or this persona's original owner can reassign it."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const ownsNewTarget = await checkPersonaOwnership(newId, userId)
				if (!ownsNewTarget) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. You can only reassign to a persona you own."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				await db.transaction(async (tx) => {
					await updateLegacyWhere(
						tx,
						and(
							eq(schema.sessionMessages.sessionId, sessionId),
							eq(schema.sessionMessages.personaId, oldId)
						),
						{ personaId: newId }
					)
					await tx
						.insert(schema.sessionPersonas)
						.values({
							sessionId,
							personaId: newId,
							position: removedCP.position ?? 0
						})
						.onConflictDoUpdate({
							target: [
								schema.sessionPersonas.sessionId,
								schema.sessionPersonas.personaId
							],
							set: { removedAt: null, removedName: null }
						})
					await markCharacterAsPersona(newId, tx)
					await tx
						.delete(schema.sessionPersonas)
						.where(
							and(
								eq(schema.sessionPersonas.sessionId, sessionId),
								eq(schema.sessionPersonas.personaId, oldId)
							)
						)
				})
			}

			// The replacement is a new member of this session, so it joins the
			// book's cast like any other (ruling 2026-09-12). The participant
			// it replaced keeps its binding: lore may be anchored to it.
			const bookForReassign = await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, sessionId),
				columns: { lorebookId: true }
			})
			if (bookForReassign?.lorebookId) {
				await runLorebookBindingCheck(
					socket,
					sessionId,
					bookForReassign.lorebookId,
					emitToUser
				).catch(console.error)
			}

			const updatedSession = await getSessionFromDB(sessionId, userId)
			const res: Sockets.Sessions.ReassignRemovedParticipant.Response = {
				success: true,
				session: updatedSession as any
			}
			emitToUser("sessions:reassignRemovedParticipant", res)
			if (updatedSession) {
				await broadcastToSessionUsers(
					socket.io,
					sessionId,
					"sessions:get",
					{
						session: updatedSession as any,
						messages:
							(updatedSession as any).sessionMessages || null
					}
				)
			}
			return res
		} catch (error: any) {
			console.error(
				"Error reassigning removed session participant:",
				error
			)
			const res: Sockets.Sessions.ReassignRemovedParticipant.Response = {
				error: "Failed to reassign removed participant."
			}
			emitToUser("sessions:reassignRemovedParticipant:error", res)
			throw error
		}
	}
}

export const sessionMessagesSendPersonaMessageHandler: Handler<
	Sockets.SessionMessages.SendPersonaMessage.Params,
	Sockets.SessionMessages.SendPersonaMessage.Response
> = {
	event: "sessionMessages:sendPersonaMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			const { sessionId, personaId, content } = params
			const userId = socket.user!.id
			/**
			 * Which channel the author is writing on (R-C, 2026-09-17) — the
			 * composer's pick, canonicalised at the write like every other
			 * channel value. Absent is `main`, which is every session whose
			 * genre declares no channel of its own.
			 *
			 * ⚠ It travels TWICE from here, and both legs matter. The row is
			 * stored on it, so the message is where the person put it; and the
			 * reply it triggers is asked for on it, so a genre that answers the
			 * manuscript differently from the conversation can branch. The
			 * second leg is the one that was missing: `ReplyRequest.channel`
			 * has existed since R-C and no socket handler had ever passed one.
			 */
			const channel = canonicalChannel(params.channel)

			// Check if user has access to this session (both owners and guests can send messages)
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.SessionMessages.SendPersonaMessage.Response =
					{
						sessionMessage: undefined,
						error: "Access denied. Session not found or no permission to access."
					}
				emitToUser("sessionMessages:sendPersonaMessage", res)
				return res
			}

			// A session whose mode disappeared is read-only (19 §6): the history
			// stays, no new turn starts. The standard mode is the F29 floor,
			// so this can never block ordinary sessionting.
			{
				const { sessionGenreAvailable } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const modeCheck = await sessionGenreAvailable(db, sessionId)
				if (!modeCheck.available) {
					const res: Sockets.SessionMessages.SendPersonaMessage.Response =
						{ sessionMessage: undefined, error: modeCheck.reason }
					emitToUser("sessionMessages:sendPersonaMessage", res)
					return res
				}
			}

			// Check if user owns the persona they're trying to use
			if (personaId) {
				const canUsePersona = await checkPersonaOwnership(
					personaId,
					userId
				)
				if (!canUsePersona) {
					const res: Sockets.SessionMessages.SendPersonaMessage.Response =
						{
							sessionMessage: undefined,
							error: "Access denied. You can only send messages with personas you own."
						}
					emitToUser("sessionMessages:sendPersonaMessage", res)
					return res
				}
			}

			// Check if session exists
			const session = await getPromptSessionFromDb(sessionId, userId)
			if (!session) {
				const res: Sockets.SessionMessages.SendPersonaMessage.Response =
					{
						sessionMessage: undefined,
						error: "Session not found"
					}
				emitToUser("sessionMessages:sendPersonaMessage", res)
				return res
			}

			if (content && content.length > MAX_CHAT_MESSAGE_LENGTH) {
				const res: Sockets.SessionMessages.SendPersonaMessage.Response =
					{
						sessionMessage: undefined,
						error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
					}
				emitToUser("sessionMessages:sendPersonaMessage", res)
				return res
			}

			/**
			 * A channel this session does not have is REFUSED, never coerced
			 * to `main`: a message written to a lane nothing will ever render
			 * is the shape of data loss even though the row is still there.
			 * The sentence is the store's own (`channelRefusal`).
			 */
			{
				const refusal = await channelRefusal(db, sessionId, channel)
				if (refusal) {
					const res: Sockets.SessionMessages.SendPersonaMessage.Response =
						{
							sessionMessage: undefined,
							error: `Cannot send here: ${refusal}`
						}
					emitToUser("sessionMessages:sendPersonaMessage", res)
					return res
				}
			}

			// Create the new message
			const newMessage: InsertSessionMessage = {
				userId,
				sessionId,
				personaId: personaId || null,
				role: "user",
				content,
				channel
			}

			const inserted = await insertLegacy(db, newMessage)

			const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
				sessionMessage: inserted as any
			}
			emitToUser("sessionMessages:sendPersonaMessage", res)

			// Broadcast sessionMessage to all session participants
			await broadcastToSessionUsers(
				socket.io,
				inserted.sessionId,
				"sessionMessage",
				{ sessionMessage: inserted }
			)

			// The line this session's cards quote has just changed.
			broadcastSessionRow(socket.io, inserted.sessionId)

			// The row LANDED (PLAN-turn-order §4.1, A2): a user send is a
			// `message-completed` under the person's cause — the event the
			// turn-order spec answers, and the one cause that may fire the
			// head turn (§4.6). Emitted at the write, before the trigger
			// below, which A7 retires in its favour.
			{
				const { emitSessionEvent } = await import(
					"$lib/server/pipelines/runtime/sessionEvents"
				)
				await emitSessionEvent(db, {
					sessionId: inserted.sessionId,
					userId,
					event: sessionEvents.messageCompleted,
					payload: {
						sessionId: inserted.sessionId,
						messageId: inserted.id,
						cause: { kind: "user", userId }
					},
					io: socket.io
				})
			}

			/**
			 * **The send starts nothing** (PLAN-turn-order §3, §4.6; A7).
			 *
			 * A reply follows one road, and none of it is
			 * here: the `message-completed` emitted above recomputes the
			 * session's turn order, the write emits `turn-order-changed`,
			 * and the auto-advance listener fires the head turn if — and
			 * only if — the session says to. With `off` the send produces no
			 * reply until Continue, which is the feature.
			 */

			return res
		} catch (error: any) {
			console.error("Error sending persona message:", error)
			const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
				sessionMessage: undefined,
				error: "Failed to send message"
			}
			emitToUser("sessionMessages:sendPersonaMessage:error", res)
			throw error
		}
	}
}

export const sessionMessagesUpdateHandler: Handler<
	Sockets.SessionMessages.Update.Params,
	Sockets.SessionMessages.Update.Response
> = {
	event: "sessionMessages:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const { id, content, isHidden } = params
			const userId = socket.user!.id

			// Persona messages: only that persona's owner. Character messages:
			// the session owner or that character's owner. See
			// messages/permissions.ts for the full rationale.
			const canEdit = await canActOnMessage(db, id, userId)
			if (!canEdit) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: "You don't have permission to edit this message"
				}
				emitToUser("sessionMessages:update:error", res)
				return res
			}

			// Get the existing message to check metadata
			const [existingMessage] = await db
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, id))

			if (!existingMessage) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:update", res)
				return res
			}

			// The genre's declared availability (20 §4, R-15). Edit is a
			// floor — no declaration can forbid it, and `verbRefusal` has no
			// key for it — so only the hide half is asked about availability:
			// a ghost is an opt-in built-in a genre may switch off. Both halves
			// ask their enabled-when (U5e, review W2): edit not on a hidden
			// row and not while generating, hide not while generating.
			if (isHidden !== undefined) {
				const hideRefusal = await verbRefusal(
					db,
					existingMessage.sessionId,
					"hide",
					{ messageId: existingMessage.id, userId }
				)
				if (hideRefusal) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: hideRefusal
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}
			if (content !== undefined) {
				const editRefusal = await verbEnablementRefusal(
					db,
					existingMessage.sessionId,
					"edit",
					{ messageId: existingMessage.id, userId }
				)
				if (editRefusal) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: editRefusal
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}

			if (
				content !== undefined &&
				content.length > MAX_CHAT_MESSAGE_LENGTH
			) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
				}
				emitToUser("sessionMessages:update:error", res)
				return res
			}

			/**
			 * The writes are built-ins (R-15): each runs as its own
			 * receipted, gate-eligible one-node spec, emits what changed —
			 * the previous text on an edit, the direction on a hide — and
			 * the host announces the row from the commit, so nothing is
			 * broadcast from here. The permission checks above are the
			 * venue's; the write is core's.
			 */
			const { runBuiltIn } = await import(
				"$lib/server/pipelines/runtime/builtins"
			)
			if (content !== undefined) {
				const edited = await runBuiltIn(db, {
					kind: "edit",
					sessionId: existingMessage.sessionId,
					actor: userId,
					payload: { target: id, text: content },
					io: socket.io
				})
				if (!edited.ok) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: edited.error ?? "Failed to update message"
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}
			if (isHidden !== undefined) {
				const hidden = await runBuiltIn(db, {
					kind: "hide",
					sessionId: existingMessage.sessionId,
					actor: userId,
					payload: { target: id, hidden: isHidden },
					io: socket.io
				})
				if (!hidden.ok) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: hidden.error ?? "Failed to update message"
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}

			const updated = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, id)
			})
			if (!updated) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:update", res)
				return res
			}

			const res: Sockets.SessionMessages.Update.Response = {
				sessionMessage: updated as any
			}
			emitToUser("sessionMessages:update", res)
			return res
		} catch (error: any) {
			console.error("Error updating session message:", error)
			const res: Sockets.SessionMessages.Update.Response = {
				sessionMessage: undefined,
				error: "Failed to update message"
			}
			emitToUser("sessionMessages:update:error", res)
			throw error
		}
	}
}

export const sessionMessagesDeleteHandler: Handler<
	Sockets.SessionMessages.Delete.Params,
	Sockets.SessionMessages.Delete.Response
> = {
	event: "sessionMessages:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// First get the message to check permissions
			const message = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: "Message not found"
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// Check if user can edit this message (based on message edit permissions)
			const canEdit = await canActOnMessage(db, params.id, userId)
			if (!canEdit) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: "Access denied. You can only delete messages from your own characters/personas or if you own the session."
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// An opt-in built-in (R-15): a genre may switch delete off, and
			// the refusal is the law — the absent control is presentation.
			const deleteRefusal = await verbRefusal(
				db,
				message.sessionId,
				"delete",
				{ messageId: message.id, userId }
			)
			if (deleteRefusal) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: deleteRefusal
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// The write is core's built-in: a receipted, gate-eligible run of
			// `core:spec/builtin-delete` that emits `message-deleted` with
			// what the row held, for the next reply's inlet.
			const { runBuiltIn } = await import(
				"$lib/server/pipelines/runtime/builtins"
			)
			const deleted = await runBuiltIn(db, {
				kind: "delete",
				sessionId: message.sessionId,
				actor: userId,
				payload: { target: params.id },
				io: socket.io
			})
			if (!deleted.ok) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: deleted.error ?? "Failed to delete message"
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// A reply that failed on this row has nothing left to open.
			await clearReplyFailed(message.sessionId, message.id)

			const res: Sockets.SessionMessages.Delete.Response = {
				id: params.id,
				success: "Message deleted successfully"
			}
			emitToUser("sessionMessages:delete", res)

			// Emit sessions:get to refresh the entire session after deletion
			await resendSession(socket, message.sessionId, emitToUser)

			// A delete can take the quoted line away entirely — the push says
			// so with a null `lastMessage`.
			broadcastSessionRow(socket.io, message.sessionId)

			return res
		} catch (error: any) {
			console.error("Error deleting session message:", error)
			const res: Sockets.SessionMessages.Delete.Response = {
				id: params.id,
				error: "Failed to delete message"
			}
			emitToUser("sessionMessages:delete:error", res)
			throw error
		}
	}
}

export const sessionMessagesRegenerateHandler: Handler<
	Sockets.SessionMessages.Regenerate.Params,
	Sockets.SessionMessages.Regenerate.Response
> = {
	event: "sessionMessages:regenerate",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message to regenerate first — needed to learn sessionId,
			// which is the lock key, before we can acquire it.
			const messageToRegenerate =
				await db.query.sessionMessages.findFirst({
					where: (cm, { eq }) => eq(cm.id, params.id)
				})

			if (!messageToRegenerate) {
				const res: Sockets.SessionMessages.Regenerate.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:regenerate", res)
				return res
			}

			return await withSessionGenerationLock(
				messageToRegenerate.sessionId,
				async () => {
					// see canActOnMessage — four branches.
					const canEdit = await canActOnMessage(
						db,
						params.id,
						userId
					)
					if (!canEdit) {
						const res: Sockets.SessionMessages.Regenerate.Response =
							{
								sessionMessage: undefined,
								error: "Access denied. You don't have permission to regenerate this message."
							}
						emitToUser("sessionMessages:regenerate", res)
						return res
					}

					// The mode's declared verb policy (20 §4): presence is
					// presentation, refusal is the law.
					const retryRefusal = await verbRefusal(
						db,
						messageToRegenerate.sessionId,
						"retry",
						{ messageId: messageToRegenerate.id, userId }
					)
					if (retryRefusal) {
						const res: Sockets.SessionMessages.Regenerate.Response =
							{
								sessionMessage: undefined,
								error: retryRefusal
							}
						emitToUser("sessionMessages:regenerate", res)
						return res
					}

					// Freshness guard, re-checked now that the lock is held — a
					// queued call must see whatever the call ahead of it in line
					// already committed, not a stale pre-lock snapshot. Mirrors
					// sessionsFireTurnHandler's own in-lock check.
					const alreadyGenerating =
						await db.query.sessionMessages.findFirst({
							where: (cm, { and, eq }) =>
								and(
									eq(
										cm.sessionId,
										messageToRegenerate.sessionId
									),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.SessionMessages.Regenerate.Response =
							{
								sessionMessage: undefined,
								error: "A response is already generating in this session."
							}
						emitToUser("sessionMessages:regenerate:error", res)
						return res
					}

					const currentMetadata =
						(messageToRegenerate.metadata as any) || {}

					// Take back what this reply changed about the world.
					//
					// ⚠ A regenerate REPLACES the text and keeps the row, so
					// nothing is deleted and the `messages.id` cascade that
					// retracts anchored state on a real delete never fires. The
					// values this message wrote would otherwise
					// outlive the sentence that justified them; the new reply
					// proposes its own.
					await retractStateAnchoredTo(db, params.id)

					// Clear the content and set as generating. A stop's
					// outcome from an earlier run does not survive the reopen.
					const [updated] = await updateLegacyWhere(
						db,
						eq(schema.sessionMessages.id, params.id),
						{
							content: "",
							isGenerating: true,
							// No status yet: the run this row waits on says
							// what it is doing once it starts (R-19).
							generationStatus: null,
							generationOutcome: null,
							error: null,
							metadata: currentMetadata
						}
					)

					// The earlier failure on this row is superseded — cleared
					// BEFORE the run, so a failure of this one raises afresh.
					await clearReplyFailed(
						messageToRegenerate.sessionId,
						params.id
					)

					const res: Sockets.SessionMessages.Regenerate.Response = {
						sessionMessage: updated as any
					}
					emitToUser("sessionMessages:regenerate", res)

					// Broadcast sessionMessage to all session participants
					await broadcastToSessionUsers(
						socket.io,
						updated.sessionId,
						"sessionMessage",
						{ sessionMessage: updated }
					)

					// Start generating the response — the run's placeholder
					// outlet claims this row instead of inserting (R-17). The
					// text this handler just cleared rides along as `previous`,
					// so the finishing write can say what the regenerate
					// replaced (U5b review W3).
					await runReply({
						socket,
						emitToUser,
						sessionId: messageToRegenerate.sessionId,
						userId,
						turn: {
							kind: "regenerate",
							messageId: params.id,
							previous: { content: messageToRegenerate.content }
						}
					})

					// The row the cards quote is whatever the run left
					// behind. The chunks along the way pushed their own
					// (`runtime/liveRow.ts`); this is the settled line.
					broadcastSessionRow(
						socket.io,
						messageToRegenerate.sessionId
					)

					return res
				}
			)
		} catch (error: any) {
			console.error("Error regenerating session message:", error)
			const res: Sockets.SessionMessages.Regenerate.Response = {
				sessionMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to regenerate message"
			}
			emitToUser("sessionMessages:regenerate:error", res)
			throw error
		}
	}
}

export const sessionMessagesExtendHandler: Handler<
	Sockets.SessionMessages.Extend.Params,
	Sockets.SessionMessages.Extend.Response
> = {
	event: "sessionMessages:extend",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message to extend first — needed to learn sessionId,
			// which is the lock key, before we can acquire it.
			const messageToExtend = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!messageToExtend) {
				const res: Sockets.SessionMessages.Extend.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:extend", res)
				return res
			}

			return await withSessionGenerationLock(
				messageToExtend.sessionId,
				async () => {
					// see canActOnMessage — four branches.
					const canEdit = await canActOnMessage(
						db,
						params.id,
						userId
					)
					if (!canEdit) {
						const res: Sockets.SessionMessages.Extend.Response = {
							sessionMessage: undefined,
							error: "Access denied. You don't have permission to extend this message."
						}
						emitToUser("sessionMessages:extend", res)
						return res
					}

					// The mode's declared verb policy (20 §4), AND whether the
					// connection this session's replies run on can actually
					// resume a partial one.
					//
					// The second half is not a nicety. A continuation is only a
					// continuation when the model is handed the text so far
					// inside an open assistant turn; every other shape produces
					// a fresh reply that `joinContinuation` glues onto the
					// partial, and the seam reads as the model repeating itself
					// rather than as a fault. `extendVerbRefusal` composes the
					// two and hands back one sentence — the same one the button
					// wears as its title, from the same resolution.
					const extendRefusal = await extendVerbRefusal(
						db,
						messageToExtend.sessionId,
						userId,
						messageToExtend.id
					)
					if (extendRefusal) {
						const res: Sockets.SessionMessages.Extend.Response = {
							sessionMessage: undefined,
							error: extendRefusal
						}
						emitToUser("sessionMessages:extend", res)
						return res
					}

					// Freshness guard, re-checked now that the lock is held — see
					// the identical comment in sessionMessagesRegenerateHandler.
					const alreadyGenerating =
						await db.query.sessionMessages.findFirst({
							where: (cm, { and, eq }) =>
								and(
									eq(
										cm.sessionId,
										messageToExtend.sessionId
									),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.SessionMessages.Extend.Response = {
							sessionMessage: undefined,
							error: "A response is already generating in this session."
						}
						emitToUser("sessionMessages:extend:error", res)
						return res
					}

					// Get current metadata and preserve it
					const currentMetadata =
						(messageToExtend.metadata as any) || {}

					// Set as generating but KEEP existing content
					// The content is the prefill the continuation starts from
					const [updated] = await updateLegacyWhere(
						db,
						eq(schema.sessionMessages.id, params.id),
						{
							isGenerating: true,
							// No status yet: the run this row waits on says
							// what it is doing once it starts (R-19).
							generationStatus: null,
							generationOutcome: null,
							error: null,
							metadata: currentMetadata
						}
					)

					const res: Sockets.SessionMessages.Extend.Response = {
						sessionMessage: updated as any
					}
					emitToUser("sessionMessages:extend", res)

					// Broadcast sessionMessage to all session participants
					await broadcastToSessionUsers(
						socket.io,
						updated.sessionId,
						"sessionMessage",
						{ sessionMessage: updated }
					)

					// Start generating the continuation — the run's placeholder
					// outlet claims this row, text and all, and the partial
					// rides to the seed line on `continuationPrefill`.
					await runReply({
						socket,
						emitToUser,
						sessionId: messageToExtend.sessionId,
						userId,
						turn: { kind: "extend", messageId: params.id }
					})

					// The continuation is part of the same line, and the
					// cards quote it as it now reads.
					broadcastSessionRow(socket.io, messageToExtend.sessionId)

					return res
				}
			)
		} catch (error: any) {
			console.error("Error continuing session message:", error)
			const res: Sockets.SessionMessages.Extend.Response = {
				sessionMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to extend message"
			}
			emitToUser("sessionMessages:extend:error", res)
			throw error
		}
	}
}

export const sessionMessagesSwipeLeftHandler: Handler<
	Sockets.SessionMessages.SwipeLeft.Params,
	Sockets.SessionMessages.SwipeLeft.Response
> = {
	event: "sessionMessages:swipeLeft",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message first to check session access
			const message = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			if (message.isGenerating) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Message is still generating, please wait."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			if (message.isHidden) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Message is hidden, cannot swipe left."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			if (message.role !== "assistant") {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Only assistant messages can be swiped."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			// The freeze rule (20 §1): once a stepped activity has advanced,
			// step 0's selection is frozen at what produced the later steps —
			// legacy swiping only ever addresses step 0, so it refuses here.
			if (await hasNativeSteps(db, message.id)) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "This activity has moved past its first step — earlier steps are frozen. Step back first."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			// Regenerate/Extend/SwipeRight all wrap their mutation in the
			// per-session generation lock; without it here, a SwipeRight/
			// Regenerate/Extend racing against a concurrent SwipeLeft on
			// the same message could have its isGenerating/queueItemId
			// state clobbered back to the stale pre-read values below.
			return await withSessionGenerationLock(message.sessionId, async () => {
				// see canActOnMessage — four branches.
				const canEdit = await canActOnMessage(
					db,
					params.id,
					userId
				)
				if (!canEdit) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Access denied. You don't have permission to swipe this message."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				// An opt-in built-in (R-15): a genre may switch swipe off.
				const swipeRefusal = await verbRefusal(
					db,
					message.sessionId,
					"swipe"
				)
				if (swipeRefusal) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: swipeRefusal
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				const swipes = message.metadata?.swipes
				const currentIdx = swipes?.currentIdx ?? null
				// On the first alternative (idx 0 or null), or no alternatives
				// at all: nothing to the left.
				if (
					!swipes?.history?.length ||
					currentIdx === null ||
					currentIdx === 0
				) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Already on the first swipe, cannot swipe left."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				// The write is core's built-in (R-15): `swipe-message` selects
				// the alternative to the left, emits `message-swiped` with the
				// one that was showing, and announces the row from the commit.
				const { runBuiltIn } = await import(
					"$lib/server/pipelines/runtime/builtins"
				)
				const swiped = await runBuiltIn(db, {
					kind: "swipe",
					sessionId: message.sessionId,
					actor: userId,
					payload: { target: message.id, index: currentIdx - 1 },
					io: socket.io
				})
				if (!swiped.ok) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: swiped.error ?? "Failed to update session message."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}
				const updated = await db.query.sessionMessages.findFirst({
					where: (cm, { eq }) => eq(cm.id, message.id)
				})
				if (!updated) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Failed to update session message."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				await clearReplyFailed(message.sessionId, message.id)

				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: updated as any
				}
				emitToUser("sessionMessages:swipeLeft", res)

				// A swipe rewrites the row in place, so the quoted line moves
				// without any row being added or removed.
				broadcastSessionRow(socket.io, message.sessionId)
				return res
			})
		} catch (error: any) {
			console.error("Error swiping left session message:", error)
			const res: Sockets.SessionMessages.SwipeLeft.Response = {
				sessionMessage: undefined,
				error: "Failed to swipe left"
			}
			emitToUser("sessionMessages:swipeLeft:error", res)
			throw error
		}
	}
}

export const sessionMessagesSwipeRightHandler: Handler<
	Sockets.SessionMessages.SwipeRight.Params,
	Sockets.SessionMessages.SwipeRight.Response
> = {
	event: "sessionMessages:swipeRight",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message first — needed to learn sessionId, which is the
			// lock key, before we can acquire it.
			const message = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.SessionMessages.SwipeRight.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:swipeRight", res)
				return res
			}

			// The freeze rule (20 §1) — see swipeLeft.
			if (await hasNativeSteps(db, message.id)) {
				const res: Sockets.SessionMessages.SwipeRight.Response = {
					sessionMessage: undefined,
					error: "This activity has moved past its first step — earlier steps are frozen. Step back first."
				}
				emitToUser("sessionMessages:swipeRight", res)
				return res
			}

			return await withSessionGenerationLock(message.sessionId, async () => {
				// see canActOnMessage — four branches.
				const canEdit = await canActOnMessage(
					db,
					params.id,
					userId
				)
				if (!canEdit) {
					const res: Sockets.SessionMessages.SwipeRight.Response = {
						sessionMessage: undefined,
						error: "Access denied. You don't have permission to swipe this message."
					}
					emitToUser("sessionMessages:swipeRight", res)
					return res
				}

				// An opt-in built-in (R-15): a genre may switch swipe off.
				// …and its enabled-when (U5e): the newest row, a swipe to take,
				// nothing generating — the ⋮ menu's own greying, refused here.
				// swipeLeft above asks availability alone: stepping back through
				// alternatives already taken is not taking one.
				const swipeRefusal = await verbRefusal(
					db,
					message.sessionId,
					"swipe",
					{ messageId: message.id, userId }
				)
				if (swipeRefusal) {
					const res: Sockets.SessionMessages.SwipeRight.Response = {
						sessionMessage: undefined,
						error: swipeRefusal
					}
					emitToUser("sessionMessages:swipeRight", res)
					return res
				}

				const swipes = message.metadata?.swipes
				const currentIdx = swipes?.currentIdx ?? null
				const isOnLastSwipe =
					!swipes?.history?.length ||
					currentIdx === null ||
					currentIdx === swipes.history.length - 1

				const { runBuiltIn } = await import(
					"$lib/server/pipelines/runtime/builtins"
				)
				const respond = (
					updated: SelectSessionMessage | undefined,
					error?: string
				) => {
					const res: Sockets.SessionMessages.SwipeRight.Response =
						updated
							? { sessionMessage: updated as any }
							: {
									sessionMessage: undefined,
									error:
										error ??
										"Failed to update session message."
								}
					emitToUser("sessionMessages:swipeRight", res)
					return res
				}

				if (!isOnLastSwipe) {
					// Navigation: the built-in selects the alternative to the
					// right, emits `message-swiped` and announces the row.
					const swiped = await runBuiltIn(db, {
						kind: "swipe",
						sessionId: message.sessionId,
						actor: userId,
						payload: { target: message.id, index: currentIdx! + 1 },
						io: socket.io
					})
					if (!swiped.ok) return respond(undefined, swiped.error)
					await clearReplyFailed(message.sessionId, message.id)
					return respond(
						await db.query.sessionMessages.findFirst({
							where: (cm, { eq }) => eq(cm.id, message.id)
						})
					)
				}

				// About to start a brand-new generation — freshness guard,
				// re-checked now that the lock is held, matching
				// regenerate/extend. Pure swipe navigation (the branch
				// above) never reaches here, so it's never blocked by an
				// unrelated in-flight generation elsewhere in the session.
				const alreadyGenerating =
					await db.query.sessionMessages.findFirst({
						where: (cm, { and, eq }) =>
							and(
								eq(cm.sessionId, message.sessionId),
								eq(cm.isGenerating, true)
							)
					})
				if (alreadyGenerating) {
					const res: Sockets.SessionMessages.SwipeRight.Response = {
						sessionMessage: undefined,
						error: "A response is already generating in this session."
					}
					emitToUser("sessionMessages:swipeRight:error", res)
					return res
				}

				/**
				 * A fresh alternative: built-in write + declared content
				 * (R-15). The built-in records an empty alternative and
				 * selects it — `message-swiped` carries the one that was
				 * showing — then this handler opens the row for the reply
				 * road exactly as regenerate does (generating, queued), and
				 * the genre's pipeline claims it and fills it, its finishing
				 * write recording `message-updated` with `verb: swipe`.
				 */
				const recorded = await runBuiltIn(db, {
					kind: "swipe",
					sessionId: message.sessionId,
					actor: userId,
					payload: { target: message.id, text: "" },
					io: socket.io
				})
				if (!recorded.ok) return respond(undefined, recorded.error)

				// Take back what the swipe being left behind changed about
				// the world — this replaces the reply without deleting the
				// row, so the anchor cascade cannot see it.
				await retractStateAnchoredTo(db, message.id)

				const [updated] = await updateLegacyWhere(
					db,
					eq(schema.sessionMessages.id, message.id),
					{
						isGenerating: true,
						// No status yet — see the regenerate handler.
						generationStatus: null,
						generationOutcome: null,
						error: null,
						queueItemId: null
					}
				)
				if (!updated) return respond(undefined)
				// Superseded before the run, so this swipe's own failure
				// raises afresh.
				await clearReplyFailed(message.sessionId, message.id)
				const res = respond(updated)

				// Announced as generating: the row the person watches fill.
				await broadcastToSessionUsers(
					socket.io,
					updated.sessionId,
					"sessionMessage",
					{ sessionMessage: updated }
				)

				await runReply({
					socket,
					emitToUser,
					sessionId: message.sessionId,
					userId,
					turn: { kind: "swipe", messageId: message.id }
				})

				// The new swipe is the line the cards now quote.
				broadcastSessionRow(socket.io, message.sessionId)

				return res
			})
		} catch (error: any) {
			console.error("Error swiping right session message:", error)
			const res: Sockets.SessionMessages.SwipeRight.Response = {
				sessionMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to swipe right"
			}
			emitToUser("sessionMessages:swipeRight:error", res)
			throw error
		}
	}
}

export const sessionMessagesCancelHandler: Handler<
	Sockets.SessionMessages.Cancel.Params,
	Sockets.SessionMessages.Cancel.Response
> = {
	event: "sessionMessages:cancel",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) {
				throw new Error("Session not found")
			}

			// The client's guarantee: flip the clicked message off "generating"
			// and broadcast it — scoped by message id + sessionId + the row
			// still generating, never by userId matching. This must never be
			// contingent on the upstream LLM actually stopping, on queue
			// state, or on a row's stamped userId matching whoever clicked Stop
			// (a userId gate would no-op the handler on a mismatch and leave the
			// message stuck "generating" forever — e.g. while still in the
			// "loading model" preflight stage). A row not generating has
			// nothing to flip (2026-09-16: the fence is what lets the stop be
			// recorded exactly once, see below). The one thing that happens
			// before the releases is the synchronous, in-memory stop of the
			// runs filling these rows — see below for why it has to come first;
			// it awaits nothing and can fail nothing. Everything after the
			// releases is best-effort cleanup of the actual upstream generation.
			const targetIds = new Set<number>()
			if (params.id) targetIds.add(params.id)

			// Also sweep every other message this session currently has marked as
			// generating, so a group session with multiple in-flight generations
			// (or a client that didn't pass an id) is fully covered too.
			const generatingMessages = await db.query.sessionMessages.findMany({
				where: (cm, { and, eq }) =>
					and(
						eq(cm.sessionId, params.sessionId),
						eq(cm.isGenerating, true)
					)
			})
			for (const message of generatingMessages) targetIds.add(message.id)

			// The RUN first, and synchronously (09-B B4). The pipeline owns its
			// row and the run is what fills it: the queue item below only
			// exists once the oracle is called, so a Stop during retrieval or
			// between nodes has to reach the executor, which polls the
			// registry between nodes and ends as `cancelled` — otherwise it
			// would walk on to the write. Before the releases below rather
			// than after them, because the releases await broadcasts, and a
			// run still unstopped through those awaits could reach its save
			// node after its row had been released — landing the full reply
			// over the partial a person had just stopped. Scoped to the rows
			// being released: an image render or a summary somebody else
			// started in this session is not what this Stop was about.
			{
				const runRegistry = await import(
					"$lib/server/pipelines/runtime/runRegistry"
				)
				runRegistry.cancelSession(
					params.sessionId,
					`user:${userId}`,
					targetIds
				)
			}

			/**
			 * Released with the explicit outcome (R-15, 2026-09-16): the row
			 * says it was `stopped`, and the stop is recorded as a session
			 * change for the next reply's inlet. Fenced on the row still
			 * generating — a row already released has nothing to stop, and
			 * when the run's own finalisation (`liveRow.finish`) won the
			 * race it wrote the outcome and the change itself; this write is
			 * then the no-op the fence makes it, so a stop is recorded once.
			 * The fence is on the STATE, not on who clicked: the userId match
			 * this handler once required is what left rows stuck.
			 */
			const { emitSessionEvent } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			for (const id of targetIds) {
				const [updated] = await updateLegacyWhere(
					db,
					and(
						eq(schema.sessionMessages.id, id),
						eq(schema.sessionMessages.sessionId, params.sessionId),
						eq(schema.sessionMessages.isGenerating, true)
					),
					{
						isGenerating: false,
						generationStatus: null,
						generationOutcome: "stopped",
						queueItemId: null,
						error: null
					}
				)
				if (updated) {
					await broadcastToSessionUsers(
						socket.io,
						params.sessionId,
						"sessionMessage",
						{
							sessionMessage: updated
						}
					)
					// Two events (PLAN-turn-order §4.1, A2): the stop, and
					// the row LANDING — a stopped reply is not generating, so
					// the turn-order spec answers it like a finished one.
					// Under the person's `edit` cause: they pressed Stop on
					// this row, and an edit never fires a turn (§4.6).
					// An edit cause, never `auto` (R34): a Stop ends the round whichever
					// release wins the fence.
					const cause = { kind: "edit" as const, userId }
					await emitSessionEvent(db, {
						sessionId: params.sessionId,
						userId,
						event: "core:event/message-stopped@1",
						payload: {
							sessionId: params.sessionId,
							messageId: updated.id,
							textLength: updated.content.length,
							cause
						},
						io: socket.io
					})
					await emitSessionEvent(db, {
						sessionId: params.sessionId,
						userId,
						event: sessionEvents.messageCompleted,
						payload: {
							sessionId: params.sessionId,
							messageId: updated.id,
							cause
						},
						io: socket.io
					})
				}
			}

			// Whatever the stop left on the rows is what the cards quote.
			broadcastSessionRow(socket.io, params.sessionId)

			// Best-effort: ask the queue to cancel the actual upstream runs we
			// knew about. Fires the adapter's abort() internally and, if the run
			// doesn't respond in time, force-detaches it so the queue can proceed
			// regardless. Never throws. Purely cleanup — the UI is already fixed.
			for (const message of generatingMessages) {
				if (message.queueItemId) {
					llmQueue.cancel(message.queueItemId)
				}
			}

			const res: Sockets.SessionMessages.Cancel.Response = {
				success: `Cancelled ${targetIds.size} generating message(s)`
			}
			emitToUser("sessionMessages:cancel", res)

			return res
		} catch (error: any) {
			console.error("Error cancelling session messages:", error)
			const res: Sockets.SessionMessages.Cancel.Response = {
				error: "Failed to cancel messages"
			}
			emitToUser("sessionMessages:cancel:error", res)
			throw error
		}
	}
}

export const sessionMessageHandler: Handler<
	Sockets.SessionMessage.Call,
	Sockets.SessionMessage.Response
> = {
	event: "sessionMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			if (params.sessionMessage) {
				// If sessionMessage object is provided, emit it directly
				const res: Sockets.SessionMessage.Response = {
					sessionMessage: params.sessionMessage
				}
				emitToUser("sessionMessage", res)
				return res
			} else if (params.id) {
				// If id is provided, fetch from database
				const sessionMessage = await db.query.sessionMessages.findFirst(
					{
						where: (m, { eq }) => eq(m.id, params.id!)
					}
				)
				if (!sessionMessage) {
					const res: Sockets.SessionMessage.Response = {
						error: "Session message not found."
					}
					emitToUser("sessionMessage:error", res)
					throw new Error("Session message not found")
				}
				// Fetched by message id alone — without this check, any
				// authenticated user could read any message on the instance
				// (including debugMeta's full compiled prompt) just by
				// guessing/incrementing ids.
				const sessionAccess = await checkSessionAccess(
					sessionMessage.sessionId,
					socket.user!.id
				)
				if (!sessionAccess.hasAccess) {
					const res: Sockets.SessionMessage.Response = {
						error: "Access denied. Session not found or no permission to access."
					}
					emitToUser("sessionMessage:error", res)
					throw new Error("Access denied.")
				}
				const res: Sockets.SessionMessage.Response = { sessionMessage }
				emitToUser("sessionMessage", res)
				return res
			} else {
				const res: Sockets.SessionMessage.Response = {
					error: "Must provide either id or sessionMessage."
				}
				emitToUser("sessionMessage:error", res)
				throw new Error("Must provide either id or sessionMessage")
			}
		} catch (error: any) {
			console.error("Error in sessionMessage handler:", error)
			const res: Sockets.SessionMessage.Response = {
				error: "Failed to get session message"
			}
			emitToUser("sessionMessage:error", res)
			throw error
		}
	}
}

// Greeting construction moved to $lib/server/sessions/greetings (24 T8) —
// one implementation behind the create pipeline's nodes and the floor alike.

// =============================================
// TYPE-SAFE CHAT HANDLERS
// =============================================

/**
 * Type-safe handler for calculating prompt token count
 */
export const promptTokenCountHandler: Handler<
	Sockets.Sessions.PromptTokenCount.Params,
	Sockets.Sessions.PromptTokenCount.Response
> = {
	event: "sessions:promptTokenCount",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// // Only admin users can get prompt token count
			// if (!socket.user!.isAdmin) {
			// 	return {
			// 		error: "Access denied. Only admin users can get prompt token count."
			// 	}
			// }

			// This is the live "draft preview" handler (fired while typing) —
			// fail fast on oversized content before any DB work, same as the
			// persisted send/update paths.
			if (
				params.content &&
				params.content.length > MAX_CHAT_MESSAGE_LENGTH
			) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			// Check if user has access to this session
			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "Access denied. Session not found or no permission to access."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			const session = await getPromptSessionFromDb(
				params.sessionId,
				userId
			)
			if (!session) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "Error Generating Prompt Token Count: Session not found."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			const user = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, userId)
			})

			// Get context/prompt config from user settings; resolve
			// connection+sampling via resolveTaskConfig — the connection from
			// `prompt config override → the instance's text->text default`, the
			// sampling from the session's own choice above those two
			const { contextConfig, promptConfig } =
				await getUserConfigurations(userId)
			const { connection, sampling, problem } = await resolveTaskConfig({
				taskType: "session",
				promptConfigId: promptConfig?.id,
				sessionId: session.id
			})

			if (!connection) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					// The resolver's sentence names which tier failed and where
					// to fix it; the literal below is only for a caller that
					// somehow returned no connection and no reason.
					error:
						problem?.message ??
						"No AI connection configured. Please set up a connection first."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}
			if (!sampling) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "No sampling config configured. Please set up a sampling config first."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			if (!session || !user) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "Incomplete configuration, failed to calculate token count."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			// sessionCharacters/sessionPersonas rows can have a null character/persona
			// when the linked row was deleted (the FK is nullable, onDelete:
			// "set null") — filter those out, matching the same fix in
			// dispatch.ts/sessionsListHandler.
			const activeSessionCharacters = session.sessionCharacters.filter(
				(
					cc
				): cc is typeof cc & {
					character: NonNullable<typeof cc.character>
				} => cc.character !== null && cc.isActive
			)
			const sessionCharactersWithCharacter =
				session.sessionCharacters.filter(
					(
						cc
					): cc is typeof cc & {
						character: NonNullable<typeof cc.character>
					} => cc.character !== null
				)
			const sessionPersonasWithPersona = session.sessionPersonas.filter(
				(
					cp
				): cp is typeof cp & {
					persona: NonNullable<typeof cp.persona>
				} => cp.persona !== null
			)

			// The caller (the session page's live "draft compiled prompt" preview)
			// sends the not-yet-sent draft text via params.content/personaId/role
			// specifically so this preview can reflect what would actually be
			// sent if the user hit Send right now — including whose turn becomes
			// due as a result. Without splicing it in here, this preview only
			// ever sees already-persisted history, so as soon as the last real
			// message is a character reply (i.e. it's the user's turn to type)
			// it permanently reports "No character available" regardless of what
			// the user drafts, since nothing is actually due until their draft
			// is accounted for.
			const messagesWithDraft = params.content?.trim()
				? [
						...session.sessionMessages,
						{
							id: -1,
							sessionId: params.sessionId,
							userId,
							characterId: null,
							personaId: params.personaId ?? null,
							role: params.role || "user",
							isNarratorResponse: false,
							content: params.content,
							createdAt: new Date().toISOString(),
							updatedAt: new Date(),
							isEdited: false,
							metadata: {},
							isGenerating: false,
							generationStage: null,
							generationStatus: null,
							error: null,
							queueItemId: null,
							isHidden: false,
							debugMeta: null,
							embedding: null,
							embeddingModel: null,
							vectorizedAt: null
						} as SelectSessionMessage
					]
				: session.sessionMessages

			/**
			 * Whose turn the estimate compiles for: the **stored** order's
			 * head (PLAN-turn-order §4.7, A7). An estimate needs *somebody*
			 * to compile for, so where nothing is prepared — a fresh
			 * session, a manual strategy, a round everybody has taken — the
			 * first active character stands in, else a seated in-turn envoy.
			 *
			 * Read rather than previewed: the order is written down, so this
			 * is right for a random or scripted strategy too, where the
			 * preview it replaced could only answer "unknown".
			 */
			const { headTurnEntry } = await import(
				"$lib/server/sessions/fireTurn"
			)
			const head = await headTurnEntry(db, params.sessionId)
			const headRef = typeof head?.ref === "string" ? head.ref : null
			let currentCharacterId: number | null =
				headRef && headRef.startsWith("character:")
					? Number(headRef.slice("character:".length))
					: null
			if (currentCharacterId !== null && !Number.isInteger(currentCharacterId))
				currentCharacterId = null
			let envoySpeaker: `envoy:${string}` | null =
				headRef?.startsWith("envoy:")
					? (headRef as `envoy:${string}`)
					: null
			if (!currentCharacterId && !envoySpeaker) {
				const sorted = [...activeSessionCharacters].sort(
					(a, b) => (a.position ?? 0) - (b.position ?? 0)
				)
				currentCharacterId = sorted[0]?.character.id ?? null
			}
			if (!currentCharacterId && !envoySpeaker) {
				const { seatedEnvoys } = await import(
					"$lib/server/pipelines/entities/envoys"
				)
				const seat = (await seatedEnvoys(db, params.sessionId)).find(
					(e) => !e.removedAt && e.speaks === "in-turn"
				)
				if (seat) envoySpeaker = `envoy:${seat.slug}`
			}

			if (!currentCharacterId && !envoySpeaker) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "No character available for prompt."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			/**
			 * Compiled by the **pipeline**, stopped before it sends.
			 *
			 * It never constructs an adapter or calls `compilePrompt`: the
			 * number on screen must come from the path that generates replies.
			 *
			 * `preview: true` halts at the pre-call substrate with the real
			 * payload, so this is the same compilation the next turn will
			 * actually use rather than an approximation of it. `skipReceipt`
			 * because this fires on a debounce while somebody types; recording
			 * a run per keystroke would bury the run history.
			 */
			const { runTurn } = await import(
				"$lib/server/pipelines/runtime/runTurn"
			)
			const { toCompiledPrompt } = await import(
				"$lib/server/pipelines/runtime/dispatch"
			)

			const receipt: any = await runTurn({
				db,
				sessionId: params.sessionId,
				userId,
				currentCharacterId,
				...(envoySpeaker ? { speaker: envoySpeaker } : {}),
				text: params.content ?? "",
				// The point of the preview: the text being typed is not a row
				// yet, so the run has to be told about it or the count reflects
				// the conversation *without* the message it is counting.
				...(params.content?.trim()
					? {
							draftMessage: {
								content: params.content,
								personaId: params.personaId ?? null
							}
						}
					: {}),
				preview: true,
				skipReceipt: true
			})

			const rendered = receipt.preview?.context?.rendered as
				| { rendered?: unknown }
				| undefined
			if (!(rendered?.rendered ?? rendered)) {
				// A preview halts by design, so a non-ok outcome only means
				// failure when it arrived with no payload. Say which node gave
				// up rather than reporting a bare token-count failure.
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error:
						`The prompt could not be compiled: ${receipt.outcome}` +
						(receipt.haltNodeKey
							? ` at '${receipt.haltNodeKey}'`
							: "") +
						(receipt.haltReason ? ` — ${receipt.haltReason}` : "")
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			const promptResult = toCompiledPrompt(rendered, connection, {
				currentCharacterId,
				messageCount: messagesWithDraft.length
			})

			// The compiled prompt quotes the owner's cards and lorebook: a guest
			// gets the counts and the meta, never the text.
			const shown =
				sessionAccess.isOwner || socket.user?.isAdmin
					? promptResult
					: { ...promptResult, prompt: undefined, messages: undefined }
			emitToUser("sessions:promptTokenCount", shown)
			return shown
		} catch (error) {
			console.error("Error in promptTokenCountHandler:", error)
			const res: Sockets.Sessions.PromptTokenCount.Response = {
				error: "Failed to calculate prompt token count."
			}
			emitToUser("sessions:promptTokenCount", res)
			return res
		}
	}
}

/**
 * Whether an explicit fire is the `core#narrate` press (lair pass R8): the
 * turn control `pressedTurnControl` names for the entry, read off the
 * session's genre. An unreadable genre presses nothing.
 */
async function narratePressed(
	db: Db,
	sessionId: number,
	entry: { ref: string | null; channel?: string }
): Promise<boolean> {
	try {
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session?.genreId) return false
		const { getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const mode = await getSessionGenre(db, session.genreId)
		return !!mode && pressedTurnControl(mode.shape, entry) === "narrate"
	} catch {
		return false
	}
}

/**
 * Type-safe handler for triggering message generation
 */
/**
 * Fire a prepared turn (PLAN-turn-order §4.7, §4.6) — **the** way a reply
 * starts, and the only one.
 *
 * `entry` absent means the stored head: that is Continue. An entry given is
 * a pick — the "Someone else" picker hands one back with `via: 'pick'`.
 * Either way this handler decides nothing about whose turn it is; it reads
 * the order, checks the person may fire that entry, and dispatches.
 *
 * ## Who may fire what
 *
 * - The **owner** may fire any entry in the order.
 * - A **guest** may fire the head, or an entry naming a character they own
 *   — the existing out-of-turn rule, unchanged in substance and now stated
 *   in one place instead of being spread through the trigger's checks.
 *
 * An entry that is not in the stored order is refused outright: firing is
 * over prepared turns, and a client that invents one is asking core to
 * seat somebody no strategy pooled.
 */
export const sessionsFireTurnHandler: Handler<
	Sockets.Sessions.FireTurn.Params,
	Sockets.Sessions.FireTurn.Response
> = {
	event: "sessions:fireTurn",
	handler: async (socket, params, emitToUser) =>
		withSessionGenerationLock(params.sessionId, async () => {
			const userId = socket.user!.id
			const reply = (
				res: Sockets.Sessions.FireTurn.Response
			): Sockets.Sessions.FireTurn.Response => {
				if (res.error)
					emitToUser("sessions:fireTurn:error", res)
				else emitToUser("sessions:fireTurn", res)
				return res
			}
			try {
				const access = await checkSessionAccess(params.sessionId, userId)
				if (!access.hasAccess)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: "Session not found."
					})

				const [row] = await db
					.select({ metadata: schema.sessions.metadata })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, params.sessionId))
					.limit(1)
				if (!row)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: "Session not found."
					})
				// No entry is Continue — the `advance` turn control (B7),
				// which the genre may switch off; a pick is not this.
				if (!params.entry) {
					const refusal = await turnControlRefusal(
						db,
						params.sessionId,
						"advance",
						{ userId },
						// The pressing composer's channel (R6).
						params.channel
					)
					if (refusal)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: refusal
						})
				}
				const { readTurnOrder, isSameChannel } = await import(
					"@serene-pub/sdk"
				)
				const order = readTurnOrder(row.metadata).order
				const head = order[0]
				/**
				 * An entry is its reference AND its channel (lair re-plan
				 * R5): the own voice (`ref: null`) may be prepared on more
				 * than one channel at once, and a Narrate press — the null
				 * reference, no channel — is `main`'s, never a prepared
				 * Sanctum entry that happens to share the reference. An
				 * absent channel is `main`.
				 */
				const sameEntry = (
					a: { ref: unknown; channel?: string },
					b: { ref: unknown; channel?: string }
				) => String(a.ref) === String(b.ref) && isSameChannel(a.channel, b.channel)
				/**
				 * Where Continue was pressed: the pressing composer's channel
				 * (R5), `main` when the client names none. The first entry
				 * prepared there is what Continue fires, and it is that
				 * channel's head — for a guest's rule below as much as for
				 * the press.
				 */
				const pressedOn = params.channel ?? "main"
				const firstOn = (channel: string | undefined) =>
					order.find((e) => isSameChannel(e.channel, channel))
				// An entry the order does not hold may be a person naming who
				// speaks (B8): a character is **Pick who speaks**, a narrator
				// genre's null ref the **narrator's turn** — turn controls the
				// genre declares, present only where it says they apply. An
				// entry the order holds is a prepared turn, and fires as one.
				if (
					params.entry &&
					!order.some((e) => sameEntry(e, params.entry!))
				) {
					const refusal = await unpreparedEntryRefusal(
						db,
						params.sessionId,
						params.entry,
						{ userId },
						// Judged where it was pressed (R6): Pick who speaks
						// is the story's, not the Sanctum's.
						params.channel
					)
					if (refusal)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: refusal
						})
				}

				/**
				 * Continue (no entry named) fires the first entry on the
				 * channel it was pressed on (R5) — so with the Sanctum's
				 * entry at the head, Continue on `main` still moves the
				 * story. On `main` with nothing prepared there, the OWNER of
				 * a narrator genre carries on (lair pass B9, owner ruling
				 * D3; `carryOnEntry` is `main`'s alone). On any other
				 * channel with nothing of its own, the head fires, as it
				 * always did. Only a press reaches here — auto-advance never
				 * does — so an always-empty order cannot loop.
				 */
				const { carryOnEntry } = await import(
					"$lib/server/sessions/fireTurn"
				)
				const pressedOnMain = isSameChannel(pressedOn, "main")
				const wanted =
					params.entry ??
					firstOn(pressedOn) ??
					(pressedOnMain ? undefined : head) ??
					(access.isOwner
						? await carryOnEntry(db, params.sessionId)
						: null)
				if (!wanted)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: "Nothing is prepared to take a turn."
					})

				/**
				 * The prepared entry this names, when the order holds one:
				 * its `channel` and `subject` are the strategy's and must
				 * not be re-typed by a client. An entry the order does not
				 * hold is the caller's own — which §4.7 allows the OWNER,
				 * and which is how a session with no order yet (one that has
				 * had no event: §4.1 backfills nothing) is still playable.
				 */
				const seated = order.find((e) => sameEntry(e, wanted)) ?? wanted

				if (!access.isOwner) {
					// The head of its own channel (R5): the order's head, or
					// the first entry on another channel — the one a guest's
					// Continue on that channel's composer fires.
					const channelHead = firstOn(seated.channel)
					const isHead = !!channelHead && sameEntry(channelHead, seated)
					let ownsIt = false
					if (
						typeof seated.ref === "string" &&
						seated.ref.startsWith("character:")
					) {
						const id = Number(seated.ref.slice("character:".length))
						const [character] = await db
							.select({ userId: schema.characters.userId })
							.from(schema.characters)
							.where(eq(schema.characters.id, id))
							.limit(1)
						ownsIt = character?.userId === userId
					}
					if (!isHead && !ownsIt)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: "Only the session owner can take somebody else's turn out of order."
						})
					// And a guest may only fire what is prepared: the head, or
					// their own character's entry. The owner's latitude above
					// does not extend to them.
					if (!order.some((e) => sameEntry(e, wanted)))
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: "That turn is not in this session's order."
						})
				}

				// A picked ref is the client's words: it must be a participant
				// reference (or null, the pipeline's own voice) before it is
				// fired as one.
				const { isParticipantRef } = await import("@serene-pub/sdk")
				if (seated.ref !== null && !isParticipantRef(seated.ref))
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: `'${String(seated.ref)}' is not a participant.`
					})
				const { fireTurnEntry } = await import(
					"$lib/server/sessions/fireTurn"
				)
				/**
				 * **Narrate** (lair pass R8): an explicit entry naming the
				 * pipeline's own voice in a narrator genre IS the `core#narrate`
				 * press (`pressedTurnControl`) — the Narrate chip, `/narrator`,
				 * the pickers' own-voice row. It is stamped `via: 'narrate'`
				 * whether or not the order held that entry, so the genre can
				 * route it (the Lair's Castellan narrates on `main`), and it
				 * keeps the channel it was pressed on — which the run reads
				 * (R13), while the narration still lands on `main`. Continue's
				 * carry-on names no entry, so it stays a full turn.
				 */
				const narrated =
					!!params.entry &&
					(await narratePressed(db, params.sessionId, params.entry))
				const result = await fireTurnEntry(db, {
					sessionId: params.sessionId,
					userId,
					// The pick the person made, recorded as one (§4.6).
					// A prepared head keeps the strategy's own `via`.
					entry: {
						...seated,
						ref: seated.ref as import("@serene-pub/sdk").ParticipantRef | null,
						via: narrated
							? "narrate"
							: params.entry || !order.some((e) => sameEntry(e, seated))
								? "pick"
								: (seated.via ?? "strategy"),
						...(narrated && !isSameChannel(pressedOn, "main")
							? { channel: pressedOn }
							: {})
					},
					// A press is always a person's cause, which is the one
					// cause that may fire whatever the auto-advance setting.
					cause: { kind: "user", userId },
					io: socket.io,
					socket,
					emitToUser
				})
				if (!result.fired)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						// A person's entry is not an error: it is their turn.
						...(result.reason === "person"
							? {}
							: { error: result.reason ?? "The turn produced no reply." }),
						...(result.reason ? { reason: result.reason } : {})
					})
				return reply({
					sessionId: params.sessionId,
					ok: true,
					...(result.runId ? { runId: result.runId } : {})
				})
			} catch (error) {
				console.error("Error in sessionsFireTurnHandler:", error)
				return reply({
					sessionId: params.sessionId,
					ok: false,
					error: "Failed to take the turn."
				})
			}
		})
}

/**
 * **Regenerate the last turn**, as a whole — the `retake` turn control
 * (lair pass R2, owner 2026-09-28; `sessions/retakeTurn.ts`).
 *
 * The door, in the order a person needs its answers:
 *
 * 1. the session, and that this person is in it;
 * 2. the turn control — offered by the genre, present, and enabled now
 *    (`turnControlRefusal`: not while a reply is being written);
 * 3. the **owner**: a retake deletes rows everybody at the table saw.
 *
 * `preview` answers with the rows the confirm dialog names and writes
 * nothing. Otherwise the yield is deleted, the session re-sent to everyone
 * in it, and the same turn fired again — under the generation lock, like
 * every fire.
 */
export const sessionsRetakeTurnHandler: Handler<
	Sockets.Sessions.RetakeTurn.Params,
	Sockets.Sessions.RetakeTurn.Response
> = {
	event: "sessions:retakeTurn",
	handler: async (socket, params, emitToUser) =>
		withSessionGenerationLock(params.sessionId, async () => {
			const userId = socket.user!.id
			const reply = (
				res: Sockets.Sessions.RetakeTurn.Response
			): Sockets.Sessions.RetakeTurn.Response => {
				if (res.error) emitToUser("sessions:retakeTurn:error", res)
				else emitToUser("sessions:retakeTurn", res)
				return res
			}
			const refuse = (error: string) =>
				reply({ sessionId: params.sessionId, ok: false, error })
			try {
				const access = await checkSessionAccess(params.sessionId, userId)
				if (!access.hasAccess) return refuse("Session not found.")
				const refusal = await turnControlRefusal(
					db,
					params.sessionId,
					"retake",
					{ userId },
					// Per channel (R6): the Lair's Sanctum offers no retake.
					params.channel
				)
				if (refusal) return refuse(refusal)
				if (!access.isOwner)
					return refuse("Only the session owner can regenerate a turn.")

				const { retakeTurn } = await import(
					"$lib/server/sessions/retakeTurn"
				)
				const out = await retakeTurn(db, {
					sessionId: params.sessionId,
					userId,
					...(params.channel ? { channel: params.channel } : {}),
					...(params.preview ? { preview: true } : {}),
					io: socket.io,
					socket,
					emitToUser,
					// The rows are gone before the new turn starts: every view
					// of the session drops them now, not when the reply lands.
					onDeleted: async () => {
						await broadcastSessionToParticipants(
							socket,
							params.sessionId,
							userId
						)
						broadcastSessionRow(socket.io, params.sessionId)
					}
				})
				const rows = out.rows?.map((r) => ({
					messageId: r.messageId,
					channel: r.channel,
					characterId: r.characterId,
					name: r.name
				}))
				return reply({
					sessionId: params.sessionId,
					ok: out.ok,
					...(out.preview ? { preview: true } : {}),
					...(rows ? { rows } : {}),
					...(out.runId ? { runId: out.runId } : {}),
					...(out.error ? { error: out.error } : {})
				})
			} catch (error) {
				console.error("Error in sessionsRetakeTurnHandler:", error)
				return refuse("Failed to regenerate the last turn.")
			}
		})
}

// "Narrator" — a manually-triggered, non-character narration/environment
// response. Deliberately outside the turn rotation: a narrator message is
// never a sessionCharacters row, and the rotation reads narration rows out
// (`rotationTurns`), so nothing here needs excluding.
export const fireNarratorResponseHandler: Handler<
	Sockets.Sessions.FireNarratorResponse.Params,
	Sockets.Sessions.FireNarratorResponse.Response
> = {
	event: "sessions:fireNarratorResponse",
	handler: async (socket, params, emitToUser) =>
		withSessionGenerationLock(params.sessionId, async () => {
			try {
				const userId = socket.user!.id

				if (
					params.instructions &&
					params.instructions.length >
						MAX_NARRATOR_INSTRUCTIONS_LENGTH
				) {
					return {
						error: `Narrator instructions too long (max ${MAX_NARRATOR_INSTRUCTIONS_LENGTH} characters).`
					}
				}

				// Owner-only, same reasoning as the character trigger above:
				// getPromptSessionFromDb admits guests, and this handler is only
				// ever reached from a client pressing the Narrator button (no
				// internal callers), so requiring ownership breaks no
				// auto-trigger path. The length cap above deliberately stays
				// first — it's a pure payload check that shouldn't cost a
				// query. A session that doesn't exist keeps reporting "not found"
				// rather than "access denied".
				const access = await checkSessionAccess(
					params.sessionId,
					userId
				)
				if (!access.hasAccess) {
					return {
						error: "Could not fire the Narrator response: session not found."
					}
				}
				if (!access.isOwner) {
					return {
						error: "Access denied. Only the session owner can fire a Narrator response."
					}
				}

				const session = await getPromptSessionFromDb(
					params.sessionId,
					userId
				)
				if (!session) {
					return {
						error: "Could not fire the Narrator response: session not found."
					}
				}

				const hasGeneratingMessages = session.sessionMessages.some(
					(msg) => msg.isGenerating
				)
				if (hasGeneratingMessages) {
					return {
						error: "A response is already generating in this session."
					}
				}

				/**
				 * The trigger's first step (ruling 2026-09-07): who speaks.
				 *
				 * Absent, this is world narration and everything below is what
				 * it always was. Present, it is a **side character** — a
				 * participant for this turn with no cast row, no position and
				 * no place in the rotation. Resolved here rather than inside
				 * the run because the answer is also the message's display
				 * name, and the row is written before the pipeline starts.
				 */
				let sideCharacter: SideCharacterFact | null = null
				if (params.speaker) {
					const { resolveSideCharacter } = await import(
						"$lib/server/pipelines/entities/sideCharacter"
					)
					const resolution = await resolveSideCharacter(
						db,
						params.sessionId,
						userId,
						params.speaker
					)
					if (!resolution.ok) return { error: resolution.error }
					sideCharacter = resolution.speaker
				}

				/**
				 * No insert here (R-17). The narrate specs create their own row
				 * at their placeholder outlet — narration, with the narrator's
				 * name snapshotted at the write and the speaker fact beside it
				 * where the run and the receipt read it — and announce it from
				 * the commit. The instructions travel as the turn's triggering
				 * text and are stored beside the row by the same outlet.
				 */
				const outcome = await runReply({
					socket,
					emitToUser,
					sessionId: params.sessionId,
					userId,
					turn: sideCharacter
						? {
								kind: "narrate-character",
								speaker: sideCharacter,
								instructions: params.instructions
							}
						: { kind: "narrate", instructions: params.instructions }
				})
				if (outcome.error && !outcome.stopped) {
					if (!outcome.shown)
						emitToUser("sessions:fireNarratorResponse:error", {
							error: outcome.error
						})
					return { error: outcome.error }
				}

				return { success: outcome.ok }
			} catch (error) {
				console.error("Error in fireNarratorResponseHandler:", error)
				return {
					error: "Failed to fire the Narrator response."
				}
			}
		})
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
// participant (owner or guest) needs to see this, unlike the
// narratorPromptConfigs CRUD handlers which manage the underlying configs.
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

		const session = await db.query.sessions.findFirst({
			where: (c, { eq }) => eq(c.id, params.sessionId),
			columns: { narratorPromptConfigId: true }
		})

		const config = await resolveNarratorPromptConfig(session, userId)
		const res: Sockets.Sessions.GetNarratorName.Response = {
			sessionId: params.sessionId,
			narratorName: config?.narratorName || "Narrator"
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
 * Best-effort, as `emitCastChanged` is: the seat has landed.
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

/**
 * One seated participant's row moved (PLAN-turn-order §4.1, A2):
 * `cast-changed` under the person's `settings` cause. Best-effort — the
 * toggle has landed and been re-sent; an emitter failing is logged.
 */
async function emitCastChanged(
	socket: { io: SessionIo },
	change: {
		sessionId: number
		userId: number
		ref: string
		change: "enabled" | "position" | "portrayal"
		value: unknown
	}
): Promise<void> {
	try {
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		await emitSessionEvent(db, {
			sessionId: change.sessionId,
			userId: change.userId,
			event: sessionEvents.castChanged,
			payload: {
				sessionId: change.sessionId,
				ref: change.ref,
				change: change.change,
				value: change.value,
				cause: { kind: "settings", userId: change.userId }
			},
			io: socket.io
		})
	} catch (err) {
		console.warn("cast-changed emit failed:", err)
	}
}

export const toggleSessionCharacterActiveHandler: Handler<
	Sockets.Sessions.ToggleSessionCharacterActive.Params,
	Sockets.Sessions.ToggleSessionCharacterActive.Response
> = {
	event: "sessions:toggleSessionCharacterActive",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// checkSessionAccess (owner OR guest), not an owner-only ad-hoc check —
			// a guest who brought their own character into a shared session must
			// be able to toggle that character's own active status; only the
			// per-row escalation below decides whether *this* character is
			// theirs to manage.
			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) {
				return {
					sessionId: params.sessionId,
					characterId: params.characterId,
					isActive: false,
					error: "Error toggling character active: Session not found."
				}
			}

			const session = await db.query.sessions.findFirst({
				where: (c, { eq }) => eq(c.id, params.sessionId),
				with: {
					sessionCharacters: {
						where: (cc, { eq, and, isNull }) =>
							and(
								eq(cc.characterId, params.characterId),
								isNull(cc.removedAt)
							),
						with: { character: { columns: { userId: true } } }
					}
				}
			})

			if (
				!session?.sessionCharacters ||
				session.sessionCharacters.length === 0
			) {
				return {
					sessionId: params.sessionId,
					characterId: params.characterId,
					isActive: false,
					error: "Session character not found."
				}
			}

			const sessionCharacter = session.sessionCharacters[0]
			const canManage =
				sessionAccess.isOwner ||
				sessionCharacter.character?.userId === userId
			if (!canManage) {
				return {
					sessionId: params.sessionId,
					characterId: params.characterId,
					isActive: false,
					error: "Access denied. Only the session owner or this character's owner can change this."
				}
			}

			const newActiveStatus = !sessionCharacter.isActive

			await db
				.update(schema.sessionCharacters)
				.set({ isActive: newActiveStatus })
				.where(
					and(
						eq(
							schema.sessionCharacters.characterId,
							params.characterId
						),
						eq(schema.sessionCharacters.sessionId, params.sessionId)
					)
				)

			const res = {
				sessionId: params.sessionId,
				characterId: params.characterId,
				isActive: newActiveStatus
			}
			// getSession (aliased from the legacy session() function) emits under the
			// event name "session", which nothing on the client listens for — this
			// silently dropped both the ack below and the session refresh. Emit the
			// handler's own declared event, then refresh with the real sessions:get
			// payload that EditSessionForm/the session page actually listen for.
			emitToUser("sessions:toggleSessionCharacterActive", res)
			await resendSession(socket, session.id, emitToUser)
			// A seat's row moved (PLAN-turn-order §4.1, A2): `cast-changed`
			// under the person's `settings` cause, which never fires a turn.
			await emitCastChanged(socket, {
				sessionId: params.sessionId,
				userId,
				ref: `character:${params.characterId}`,
				change: "enabled",
				value: newActiveStatus
			})

			return res
		} catch (error) {
			console.error(
				"Error in toggleSessionCharacterActiveHandler:",
				error
			)
			return {
				sessionId: params.sessionId,
				characterId: params.characterId,
				isActive: false,
				error: "Failed to toggle character active status."
			}
		}
	}
}

// Registration function for all session handlers
/**
 * The account-visibility view (design §4). From the caller's own seat, what of
 * *their* data this session exposes to everyone else in it.
 *
 * This is the exact inverse of `canViewCharacter`: a character a person owns —
 * cast or persona — becomes viewable by every other participant, and readable
 * by the pipelines that assemble this session's prompts, the instant it is
 * bound in. A guest asking here sees only their own contributions and who
 * else can see them, so they understand the consequence before contributing.
 * Owner and guests may both ask; access is gated the same way as every other
 * session-scoped read.
 */
export const sessionsAccountVisibilityHandler: Handler<
	Sockets.Sessions.AccountVisibility.Params,
	Sockets.Sessions.AccountVisibility.Response
> = {
	event: "sessions:accountVisibility",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const res: Sockets.Sessions.AccountVisibility.Response = {
			sessionId: params.sessionId,
			isOwner: false,
			isGuest: false,
			viewers: [],
			exposed: { characters: [], personas: [], lorebooks: [] }
		}

		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess) {
			res.error = "no access to this session"
			emitToUser("sessions:accountVisibility", res)
			return res
		}
		res.isOwner = access.isOwner
		res.isGuest = access.isGuest

		// The caller's own characters/personas bound into this session — what a
		// bound entity discloses to the rest of the participants.
		res.exposed.characters = await db
			.select({
				id: schema.characters.id,
				name: schema.characters.name
			})
			.from(schema.sessionCharacters)
			.innerJoin(
				schema.characters,
				eq(schema.sessionCharacters.characterId, schema.characters.id)
			)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, params.sessionId),
					eq(schema.characters.userId, userId)
				)
			)

		// Aliased: `session_characters` above already joined `characters` in
		// this handler, and both member tables point at it.
		res.exposed.personas = await db
			.select({ id: voicedCharacter.id, name: voicedCharacter.name })
			.from(schema.sessionPersonas)
			.innerJoin(
				voicedCharacter,
				eq(schema.sessionPersonas.personaId, voicedCharacter.id)
			)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, params.sessionId),
					eq(voicedCharacter.userId, userId)
				)
			)

		// The session's lorebook is a single binding on the session row (the
		// `sessionLorebooks` junction is unused legacy). Exposed only when the
		// caller owns it.
		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, params.sessionId),
			columns: { userId: true, lorebookId: true }
		})
		if (session?.lorebookId) {
			res.exposed.lorebooks = await db
				.select({
					id: schema.lorebooks.id,
					name: schema.lorebooks.name
				})
				.from(schema.lorebooks)
				.where(
					and(
						eq(schema.lorebooks.id, session.lorebookId),
						eq(schema.lorebooks.userId, userId)
					)
				)
		}

		// Who else can see the above: the session owner plus every guest, minus
		// the caller themselves.
		const guests = await db
			.select({ userId: schema.sessionGuests.userId })
			.from(schema.sessionGuests)
			.where(eq(schema.sessionGuests.sessionId, params.sessionId))
		const ownerId = session?.userId ?? null
		const otherIds = new Set<number>()
		if (ownerId != null && ownerId !== userId) otherIds.add(ownerId)
		for (const g of guests)
			if (g.userId != null && g.userId !== userId) otherIds.add(g.userId)

		if (otherIds.size) {
			const rows = await db
				.select({
					id: schema.users.id,
					username: schema.users.username,
					displayName: schema.users.displayName
				})
				.from(schema.users)
				.where(inArray(schema.users.id, [...otherIds]))
			res.viewers = rows.map((u) => ({
				userId: u.id,
				username: u.displayName || u.username,
				role: u.id === ownerId ? ("owner" as const) : ("guest" as const)
			}))
		}

		emitToUser("sessions:accountVisibility", res)
		return res
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
	register(socket, sessionsAnnexInspectHandler, emitToUser)
	register(socket, sessionsModesHandler, emitToUser)
	register(socket, sessionsActionsHandler, emitToUser)
	register(socket, sessionsActionsSeenHandler, emitToUser)
	register(socket, sessionsViewHandler, emitToUser)
	register(socket, sessionsPanelLayoutGetHandler, emitToUser)
	register(socket, sessionsPanelLayoutSetHandler, emitToUser)
	register(socket, sessionsLayoutPresetSaveHandler, emitToUser)
	register(socket, sessionsLayoutPresetRenameHandler, emitToUser)
	register(socket, sessionsLayoutPresetDeleteHandler, emitToUser)
	register(socket, sessionsLayoutPresetUsageHandler, emitToUser)
	register(socket, sessionsPipelinesHandler, emitToUser)
	register(socket, sessionsPresetStatusHandler, emitToUser)
	register(socket, sessionsFireActionHandler, emitToUser)
	register(socket, sessionsPresetsHandler, emitToUser)
	register(socket, sessionsChoosePresetHandler, emitToUser)
	register(socket, sessionsFunctionsHandler, emitToUser)
	register(socket, sessionsSetFunctionHandler, emitToUser)
	register(socket, sessionsUpgradeModeHandler, emitToUser)
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
	register(socket, sessionMessagesCancelHandler, emitToUser)
	register(socket, sessionMessageHandler, emitToUser)
	register(socket, promptTokenCountHandler, emitToUser)
	register(socket, fireNarratorResponseHandler, emitToUser)
	register(socket, sessionsGetNarratorNameHandler, emitToUser)
	register(socket, sessionsSetFavoriteHandler, emitToUser)
	register(socket, sessionsSideCharacterOptionsHandler, emitToUser)
	register(socket, toggleSessionCharacterActiveHandler, emitToUser)
	register(socket, sessionsSetEnvoySeatHandler, emitToUser)
	register(socket, sessionsAccountVisibilityHandler, emitToUser)
}
