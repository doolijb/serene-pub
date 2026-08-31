import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	insertLegacy,
	insertLegacyMany,
	updateLegacyWhere,
	deleteLegacy,
	hasNativeSteps
} from "$lib/server/messages/store"
import { verbRefusal } from "$lib/server/messages/verbs"
import { and, asc, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm"
import {
	syncLorebookBindingsForCharacter,
	syncLorebookBindingsForPersona
} from "$lib/server/utils/characterBindingSync"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { generateResponse } from "../utils/generateResponse"
import { getNextCharacterTurn } from "$lib/server/utils/getNextCharacterTurn"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import { SessionCharacterVisibility } from "$lib/shared/constants/SessionCharacterVisibility"
import { InterpolationEngine } from "../utils/interpolation/InterpolationEngine"
import { dev } from "$app/environment"
import type { Handler } from "$lib/shared/events"
import { getUserConfigurations } from "../utils/getUserConfigurations"
import { resolveTaskConfig } from "../utils/resolveTaskConfig"
import { resolveNarratorPromptConfig } from "../utils/resolveNarratorPromptConfig"
import { llmQueue } from "../utils/llmQueue"
import {
	broadcastToSessionUsers,
	createSessionBroadcaster
} from "./utils/broadcastHelpers"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"
import { withSessionTriggerLock } from "$lib/server/utils/sessionTriggerLock"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite"

type Executor =
	| PgliteDatabase<typeof schema>
	| PgliteTransaction<
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >
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
	const persona = await db.query.personas.findFirst({
		where: (p, { and, eq }) =>
			and(eq(p.id, personaId), eq(p.userId, userId)),
		columns: { id: true }
	})

	return !!persona
}

/**
 * Batch version of checkCharacterOwnership — returns the subset of the given
 * ids actually owned by userId. Used to validate newly-added sessionCharacters
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
	const owned = await db.query.personas.findMany({
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

/**
 * Check if user can edit/swipe/regenerate a session message.
 * - Persona messages: only the owner of that specific persona — NOT even the
 *   session owner, since a persona is another participant's own
 *   self-representation in the session, not something the session owner controls.
 * - Character messages: the session owner (broad control over the shared "AI"
 *   character outputs) OR whoever owns that specific character (so a guest
 *   who brought their own character into the session can edit/swipe its
 *   messages too).
 */
async function checkMessageEditPermission(
	messageId: number,
	userId: number
): Promise<boolean> {
	const message = await db.query.sessionMessages.findFirst({
		where: eq(schema.sessionMessages.id, messageId),
		columns: {
			sessionId: true,
			characterId: true,
			personaId: true,
			isNarratorResponse: true
		}
	})

	if (!message) return false

	const sessionAccess = await checkSessionAccess(message.sessionId, userId)
	if (!sessionAccess.hasAccess) return false

	if (message.personaId) {
		return await checkPersonaOwnership(message.personaId, userId)
	}

	if (message.characterId) {
		if (sessionAccess.isOwner) return true
		return await checkCharacterOwnership(message.characterId, userId)
	}

	// Narrator response messages aren't owned by any persona/character — only
	// the session owner controls them (nobody guest-owns "the narrator").
	if (message.isNarratorResponse) return sessionAccess.isOwner

	return false
}

// Helper function to process tags for session creation/update
async function processSessionTags(
	sessionId: number,
	tagNames: string[],
	userId: number,
	dbOrTx: Executor = db
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

	// Remove tags that are no longer in the list
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
					// `character` columns are limited to id/name/avatar — no
					// shortDescription/visibility column exists on the
					// characters table (visibility lives on sessionCharacters
					// itself, included automatically alongside this relation).
					character: {
						columns: {
							id: true,
							name: true,
							avatarMediaId: true
						}
					}
				},
				orderBy: asc(schema.sessionCharacters.position)
			},
			sessionPersonas: {
				with: {
					// Same trimmed subset as `character` above — no
					// shortDescription/visibility column exists on personas.
					persona: {
						columns: {
							id: true,
							name: true,
							avatarMediaId: true
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
		orderBy: desc(schema.sessions.updatedAt)
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
		(await listSessionGenres(db as any).catch(() => [])).map((m) => [
			m.genreId,
			m.name
		])
	)

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
			// sessionCharacters/sessionPersonas rows can have a null character/
			// persona when the linked row was deleted (the FK is nullable,
			// onDelete: "set null") — filter those out, matching the same
			// fix in generateResponse.ts.
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

		const persona = await db.query.personas.findFirst({
			where: eq(schema.personas.id, params.personaId),
			columns: { id: true, name: true }
		})
		if (!persona) {
			const res: Sockets.Sessions.Typing.Response = { success: false }
			return res
		}

		// Fire-and-forget broadcast — receiving clients own their own 10s
		// expiry, so there's no matching "stopped typing" event to send.
		await broadcastToSessionUsers(
			socket.io,
			params.sessionId,
			"sessions:userTyping",
			{
				sessionId: params.sessionId,
				personaId: persona.id,
				personaName: persona.name
			} satisfies Sockets.Sessions.UserTyping.Response
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

		// Preset resolution (23 §9): when the client starts from a preset, the
		// preset picks the type — the server derives genreId from it (never
		// trusting a client-supplied pair to agree) and refuses presets or
		// types an admin has hidden. An absent settings row means available:
		// types are visible until someone hides them, same as sessionAdmin.
		{
			const presetId = (params.session as any).presetId ?? null
			if (presetId != null) {
				const [preset] = await db
					.select()
					.from(schema.sessionPresets)
					.where(eq(schema.sessionPresets.id, presetId))
					.limit(1)
				if (!preset || !preset.enabled)
					throw new Error("That session preset is not available.")
				const [typeSetting] = await db
					.select()
					.from(schema.sessionGenreSettings)
					.where(
						eq(
							schema.sessionGenreSettings.genreId,
							preset.genreId
						)
					)
					.limit(1)
				if (typeSetting && !typeSetting.enabled)
					throw new Error("That session type is not available.")
				;(params.session as any).genreId = preset.genreId
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
			const mode = await getSessionGenre(db as any, genreId)
			// The F29 spirit: the standard mode is the floor, available even
			// when the type registry never synced (a bootstrap conflict
			// disables pipelines, never sessionting — DECOMPOSITION §19). Only a
			// *non-standard* mode this build does not register refuses.
			if (!mode && genreId !== STANDARD_GENRE_ID)
				throw new Error(
					`'${genreId}' is not a session mode this build registers.`
				)
			if (mode) {
				const violations = shapeViolations(mode.shape, {
					characters: characterIds.length,
					personas: personaIds.length,
					hasLorebook: params.session.lorebookId != null
				})
				if (violations.length)
					throw new Error(
						`This session does not fit '${mode.name}': ${violations.join("; ")}.`
					)
				declaredFieldKeys = Object.keys(
					(mode.shape as any)?.fields ?? {}
				)
			}
		}

		// Remove tags from session data as it will be handled separately
		const sessionDataWithoutTags = { ...params.session }
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
		// Creation as a run (24 §12, T8): the genre's create pipeline answers
		// `session-created` — greeting seeding is its nodes now, receipted
		// like any other run. Dispatch keys on (genre, event); nothing serving
		// is a normal state (a transitional input-type genre has no create
		// pipeline), and the imperative floor below covers it — the F29
		// posture: creation must never fail because pipeline infrastructure
		// did.
		const { getSessionGenre, STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
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
				event: "session-created",
				input: {
					main: createRequest,
					sessionScope: { sessionId: newSession.id, userId },
					sessionId: newSession.id,
					request: createRequest,
					fields: (sessionDataWithoutTags as any).genreFields ?? {}
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
			const greetingShape = (await getSessionGenre(db as any, genreId))
				?.shape?.greeting
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

		// Fetch the complete session with messages
		const resSession = await getSessionFromDB(newSession.id, userId)
		if (!resSession) throw new Error("Failed to fetch created session")

		await sessionsListHandler.handler(socket, {}, emitToUser) // Refresh session list
		const res: Sockets.Sessions.Create.Response = {
			session: resSession as any
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
				with: { persona: true },
				orderBy: (cp, { asc }) => asc(cp.position)
			},
			sessionCharacters: { with: { character: true } },
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
					user: true
				}
			}
		}
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
				where: (cm, { eq }) => eq(cm.isHidden, false),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			// Removed-participant rows are deliberately excluded here (unlike
			// getSessionFromDB, which stays unfiltered for client display) —
			// this function's result feeds the entire prompt-building
			// pipeline (generateResponse.ts's adapter construction,
			// promptBuilder, RagInfillEngine, KeywordInfillEngine all derive
			// their session from this one query), and a removed participant's
			// row flowing into that pipeline unfiltered would mean a
			// character removed from the session could still be presented to
			// the model as present/available.
			sessionCharacters: {
				where: (cc, { isNull }) => isNull(cc.removedAt),
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
						with: { character: true, persona: true }
					},
					worldLoreEntries: true,
					characterLoreEntries: {
						with: {
							lorebookBinding: {
								with: {
									character: true,
									persona: true
								}
							}
						}
					},
					historyEntries: true
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
		// SessionMessageProcessor, RagInfillEngine.ts's formatMessageForQuery)
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

			await db
				.delete(schema.sessions)
				.where(eq(schema.sessions.id, params.id))

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
		const { listSessionGenres } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const res: Sockets.Sessions.Genres.Response = {
			genres: (await listSessionGenres(db as any)) as any
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
			db as any,
			params.sessionId,
			params.genreId
		)
		const res: Sockets.Sessions.UpgradeGenre.Response = error
			? { ...base, error }
			: base
		emitToUser("sessions:upgradeGenre", res)
		if (!error) await sessionsListHandler.handler(socket, {}, emitToUser)
		return res
	}
}

/* --- the rebinding seams (19 §3, §5) ------------------------------------ */

/** The picker's data: who serves a function here, and who currently wins. */
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
			function: params.function,
			candidates: [],
			resolved: null
		}
		if (access.hasAccess) {
			const { resolveFunctionSpec, STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const { functionCandidates } = await import(
				"$lib/server/pipelines/entities/bindings"
			)
			const [session] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			const genreId = session?.genreId ?? STANDARD_GENRE_ID
			res.candidates = await functionCandidates(
				db as any,
				genreId,
				params.function
			)
			res.resolved = await resolveFunctionSpec(
				db as any,
				genreId,
				params.function,
				{ sessionId: params.sessionId }
			)
		}
		emitToUser("sessions:functionCandidates", res)
		return res
	}
}

/**
 * Bind a function among its eligible servers (19 §3). Session scope needs the
 * session's owner; instance scope needs an administrator — the same tier line
 * as everything else (§26a).
 */
export const sessionsBindFunctionHandler: Handler<
	Sockets.Sessions.Bindings.BindFunction.Params,
	Sockets.Sessions.Bindings.BindFunction.Response
> = {
	event: "sessions:bindFunction",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const base = { sessionId: params.sessionId, function: params.function }
		const fail = (error: string) => {
			const res = { ...base, error }
			emitToUser("sessions:bindFunction", res)
			return res
		}
		const scopeKind = params.scope ?? "session"
		if (scopeKind === "instance" && !socket.user!.isAdmin)
			return fail("Only administrators bind functions instance-wide.")
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess || !access.isOwner)
			return fail("Session not found.")

		const { STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const { bindFunction } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)
		const { error } = await bindFunction(db as any, {
			scope:
				scopeKind === "instance"
					? { kind: "instance", id: 0 }
					: { kind: "session", id: params.sessionId },
			genreId: session?.genreId ?? STANDARD_GENRE_ID,
			functionKey: params.function,
			specSlug: params.specSlug,
			userId
		})
		if (error) return fail(error)
		emitToUser("sessions:bindFunction", base)
		return base
	}
}

/** The swap list plus the session's current choice (19 §5). */
export const sessionsSpeakerStrategiesHandler: Handler<
	Sockets.Sessions.Bindings.SpeakerStrategies.Params,
	Sockets.Sessions.Bindings.SpeakerStrategies.Response
> = {
	event: "sessions:speakerStrategies",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const res: Sockets.Sessions.Bindings.SpeakerStrategies.Response = {
			sessionId: params.sessionId,
			strategies: [],
			selected: null
		}
		if (access.hasAccess) {
			const { listSpeakerStrategies } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const { getSessionSpeakerStrategy } = await import(
				"$lib/server/pipelines/entities/bindings"
			)
			res.strategies = await listSpeakerStrategies(db as any)
			res.selected = await getSessionSpeakerStrategy(
				db as any,
				params.sessionId
			)
		}
		emitToUser("sessions:speakerStrategies", res)
		return res
	}
}

export const sessionsSetSpeakerStrategyHandler: Handler<
	Sockets.Sessions.Bindings.SetSpeakerStrategy.Params,
	Sockets.Sessions.Bindings.SetSpeakerStrategy.Response
> = {
	event: "sessions:setSpeakerStrategy",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess || !access.isOwner) {
			const res = {
				sessionId: params.sessionId,
				error: "Session not found."
			}
			emitToUser("sessions:setSpeakerStrategy", res)
			return res
		}
		const { setSessionSpeakerStrategy } = await import(
			"$lib/server/pipelines/entities/bindings"
		)
		const { error } = await setSessionSpeakerStrategy(db as any, {
			sessionId: params.sessionId,
			userId,
			typeId: params.typeId
		})
		const res: Sockets.Sessions.Bindings.SetSpeakerStrategy.Response = error
			? { sessionId: params.sessionId, error }
			: { sessionId: params.sessionId }
		emitToUser("sessions:setSpeakerStrategy", res)
		return res
	}
}

/**
 * The generic trigger fire (19 §4): a contributed function resolves to its
 * serving spec (§3) and the spec runs against this session. The two functions
 * with bespoke lifecycles keep their dedicated events — a respond needs the
 * streaming message row, a narrate its instructions modal — and this route
 * says so rather than running them wrong. Owner-only, like the narrator
 * trigger and for the same reason: it is only ever reached from a button.
 */
export const sessionsTriggerFunctionHandler: Handler<
	Sockets.Sessions.TriggerFunction.Params,
	Sockets.Sessions.TriggerFunction.Response
> = {
	event: "sessions:triggerFunction",
	handler: async (socket, params, emitToUser) =>
		withSessionTriggerLock(params.sessionId, async () => {
			const fail = (
				error: string
			): Sockets.Sessions.TriggerFunction.Response => {
				const res = {
					sessionId: params.sessionId,
					function: params.function,
					error
				}
				emitToUser("sessions:triggerFunction", res)
				return res
			}
			try {
				const userId = socket.user!.id
				const access = await checkSessionAccess(
					params.sessionId,
					userId
				)
				if (!access.hasAccess || !access.isOwner)
					return fail("Session not found.")
				if (
					params.function === "respond" ||
					params.function === "narrate"
				)
					return fail(
						`'${params.function}' has its own trigger event — this route serves contributed functions.`
					)

				const {
					resolveFunctionSpec,
					STANDARD_GENRE_ID,
					genreFieldsFor,
					sessionGenreAvailable
				} = await import("$lib/server/pipelines/entities/sessionGenres")
				// Read-only when the mode is missing (19 §6) — a trigger is a
				// new turn like any other.
				const modeCheck = await sessionGenreAvailable(
					db as any,
					params.sessionId
				)
				if (!modeCheck.available) return fail(modeCheck.reason!)
				const [session] = await db
					.select({ genreId: schema.sessions.genreId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, params.sessionId))
					.limit(1)
				const genreId = session?.genreId ?? STANDARD_GENRE_ID

				// Checked here and not only in the view (19 §3). Hiding a
				// button is a presentation choice; refusing the fire is what
				// makes "removed" mean removed — otherwise anything that can
				// emit a socket event still has the function, and the control
				// surface is decoration.
				//
				// ⚠ Only for functions the mode actually offers. Checking
				// enablement first made a function *nobody contributes* report
				// as "turned off", which is a refusal that sends somebody to a
				// checkbox that does not exist. Not-offered falls through to
				// the resolution refusal below, which names the real problem.
				const { listSessionFunctions } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const offered = await listSessionFunctions(
					db as any,
					params.sessionId,
					genreId,
					userId
				)
				const mine = offered.find((f) => f.function === params.function)
				if (mine && !mine.enabled)
					return fail(
						`'${mine.name}' is turned off for this session. Turn it back on in ` +
							`session settings, under Actions.`
					)

				const specId = await resolveFunctionSpec(
					db as any,
					genreId,
					params.function,
					{ sessionId: params.sessionId }
				)
				if (!specId)
					return fail(
						`Nothing serves '${params.function}' for this session's mode.`
					)

				// A menu trigger's subject (19 §4): the message it was pressed
				// on. Verified against the session before it rides the input —
				// hiding a button is presentation, but a forged id reaching a
				// spec as data would make the control surface decoration.
				if (params.messageId != null) {
					const [subject] = await db
						.select({
							sessionId: schema.sessionMessages.sessionId
						})
						.from(schema.sessionMessages)
						.where(
							eq(schema.sessionMessages.id, params.messageId)
						)
						.limit(1)
					if (!subject || subject.sessionId !== params.sessionId)
						return fail(
							"That message is not part of this session."
						)
				}

				const { runSpec } = await import(
					"$lib/server/pipelines/runtime/runTurn"
				)
				const receipt = await runSpec({
					db,
					sessionId: params.sessionId,
					userId,
					specId,
					// The same input shape a turn supplies (the winning spec's
					// input contract is typically the mode's own type): no
					// text, no pick — the function was the whole instruction.
					input: {
						text: "",
						sessionId: params.sessionId,
						characterId: null,
						...(params.messageId != null
							? { messageId: params.messageId }
							: {}),
						...(params.payload && typeof params.payload === "object"
							? { payload: params.payload }
							: {}),
						sessionScope: {
							sessionId: params.sessionId,
							currentCharacterId: null
						},
						fields: await genreFieldsFor(db as any, params.sessionId)
					}
				})
				if (receipt.outcome !== "ok") {
					const { haltExplanation } = await import(
						"$lib/server/pipelines/runtime/runTurn"
					)
					return fail(
						haltExplanation(receipt) ?? "The run produced nothing."
					)
				}

				// Whatever the spec's consumers wrote, the participants see it.
				await sessionsListHandler.handler(socket, {}, emitToUser)
				const res: Sockets.Sessions.TriggerFunction.Response = {
					sessionId: params.sessionId,
					function: params.function,
					success: true
				}
				emitToUser("sessions:triggerFunction", res)
				return res
			} catch (error: any) {
				console.error("Error in sessionsTriggerFunctionHandler:", error)
				return fail("Failed to run the function.")
			}
		})
}

/**
 * The pipelines involved in a session, for the chat's grouped settings: the
 * intrinsic `respond` plus every enabled contributed function (narrate, the
 * summarize family, plugin functions). Each resolves to a spec slug the
 * config panel can render at session scope; the list is what lets the Edit
 * Chat settings group configurables **by pipeline** rather than by setting
 * type. Deduped by slug — one spec serving two functions is one card.
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
				resolveFunctionSpec,
				enabledSessionFunctions,
				STANDARD_GENRE_ID
			} = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
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
			const add = async (
				slug: string | null,
				label: string
			): Promise<void> => {
				if (!slug || seen.has(slug)) return
				seen.add(slug)
				res.pipelines.push({
					slug,
					label: label || (await nameOf(slug)) || slug
				})
			}

			// The reply pipeline is always involved; then every function the
			// session actually has switched on (19 §4) — narrate included.
			await add(
				await resolveFunctionSpec(db, genreId, "respond", {
					sessionId: params.sessionId
				}),
				"Respond"
			)
			const fns = await enabledSessionFunctions(
				db as any,
				params.sessionId,
				genreId,
				userId
			)
			for (const fn of fns)
				await add(
					await resolveFunctionSpec(db, genreId, fn.function, {
						sessionId: params.sessionId
					}),
					fn.name
				)
		}
		emitToUser("sessions:pipelines", res)
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
			modePanels: []
		}
		if (access.hasAccess) {
			const { surfacesOf, frameSrc } = await import(
				"$lib/server/plugins/frameHost"
			)
			const enabled = await db
				.select({
					pluginId: schema.plugins.pluginId,
					name: schema.plugins.name,
					manifest: schema.plugins.manifest
				})
				.from(schema.plugins)
				.where(eq(schema.plugins.enabled, true))

			// Panels: every enabled plugin's declarations, in name order.
			for (const p of enabled) {
				const surfaces = surfacesOf(p.manifest)
				for (const panel of surfaces.panels)
					res.panels.push({
						pluginId: p.pluginId,
						panelId: panel.id,
						src: frameSrc(p.pluginId, panel.entry),
						title: panel.title ?? panel.id
					})
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
				db as any,
				session?.genreId ?? STANDARD_GENRE_ID
			)
			const viewPlugin = (mode?.shape as any)?.view
			if (typeof viewPlugin === "string") {
				const owner = enabled.find((p) => p.pluginId === viewPlugin)
				const decl = owner
					? surfacesOf(owner.manifest).sessionView
					: undefined
				if (owner && decl)
					res.sessionView = {
						pluginId: owner.pluginId,
						src: frameSrc(owner.pluginId, decl.entry),
						title: decl.title ?? owner.name
					}
			}

			// The mode's declared surface-grid panels (21). Passed through
			// verbatim; a frame surface gets its `src` resolved only when the
			// owning plugin is installed (absent → the client placeholders it).
			const declaredPanels = (mode?.shape as any)?.panels
			if (Array.isArray(declaredPanels)) {
				for (const p of declaredPanels) {
					if (!p || typeof p.id !== "string") continue
					const panel: Sockets.Sessions.View.ModePanel = {
						id: p.id,
						title: typeof p.title === "string" ? p.title : p.id,
						icon: typeof p.icon === "string" ? p.icon : undefined,
						role: p.role === "primary" ? "primary" : "secondary",
						surface: p.surface,
						channels: Array.isArray(p.channels)
							? p.channels
							: undefined,
						layout:
							p.layout && typeof p.layout === "object"
								? p.layout
								: undefined,
						defaultActive: !!p.defaultActive
					}
					if (
						p.surface?.kind === "frame" &&
						typeof p.surface.pluginId === "string" &&
						typeof p.surface.entry === "string"
					) {
						const owner = enabled.find(
							(e) => e.pluginId === p.surface.pluginId
						)
						if (owner)
							panel.src = frameSrc(
								p.surface.pluginId,
								p.surface.entry
							)
					}
					res.modePanels.push(panel)
				}
			}
		}
		emitToUser("sessions:view", res)
		return res
	}
}

/**
 * Read the caller's surface-grid layout for a session (21 §10). No row yet →
 * an empty blob; the client then derives its default layout from the mode's
 * declared panels. Access-gated like every other session read.
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
		if (access.hasAccess) {
			const [row] = await db
				.select({ layout: schema.sessionPanelLayouts.layout })
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
		}
		const res: Sockets.Sessions.PanelLayout.Get.Response = {
			sessionId: params.sessionId,
			layout
		}
		emitToUser("sessions:panelLayout:get", res)
		return res
	}
}

/**
 * Persist the caller's surface-grid layout for a session (21 §10). One row per
 * (user, session); upsert. The `layout` blob is stored verbatim — its shape is
 * the client surface manager's business, forward-compatible by design.
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
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (!params.layout || typeof params.layout !== "object") {
			error = "Invalid layout"
		} else {
			await db
				.insert(schema.sessionPanelLayouts)
				.values({
					sessionId: params.sessionId,
					userId,
					layout: params.layout
				})
				.onConflictDoUpdate({
					target: [
						schema.sessionPanelLayouts.userId,
						schema.sessionPanelLayouts.sessionId
					],
					set: {
						layout: params.layout,
						updatedAt: new Date()
					}
				})
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
 * The contributed trigger set for a session (19 §4) — presence from rows, so a
 * retired contributor takes its button with it and no UI code is involved.
 * Access-checked like "sessions:get": triggers describe what a participant can
 * press, and only participants get the list.
 */
export const sessionsTriggersHandler: Handler<
	Sockets.Sessions.Triggers.Params,
	Sockets.Sessions.Triggers.Response
> = {
	event: "sessions:triggers",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const res: Sockets.Sessions.Triggers.Response = {
			sessionId: params.sessionId,
			triggers: []
		}
		if (access.hasAccess) {
			const { enabledSessionFunctions, STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const [session] = await db
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			// The functions in force, not every one contributed: a session that
			// turned the narrator off should not be rendering its button. The
			// same call gates `triggerFunction`, so presence and press agree
			// by construction rather than by both being kept in step.
			res.triggers = (await enabledSessionFunctions(
				db as any,
				params.sessionId,
				session?.genreId ?? STANDARD_GENRE_ID
			)) as any
		}
		emitToUser("sessions:triggers", res)
		return res
	}
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
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const res: Sockets.Sessions.PresetOptions.Response = {
			sessionId: params.sessionId,
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
				.where(eq(schema.sessions.id, params.sessionId))
				.limit(1)
			const r = await listSessionPresets(
				db as any,
				params.sessionId,
				session?.genreId ?? STANDARD_GENRE_ID,
				{ userId, isAdmin: !!socket.user!.isAdmin }
			)
			res.specSlug = r.specSlug
			res.selectedId = r.selectedId
			res.options = r.options
		}
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
			db as any,
			params.sessionId,
			session?.genreId ?? STANDARD_GENRE_ID,
			params.configId,
			{ userId, isAdmin: !!socket.user!.isAdmin }
		)
		if (!r.ok) return reply({ sessionId: params.sessionId, error: r.error })

		// The preset decides which actions a session includes, so both follow in
		// the same breath — otherwise the Actions list describes the preset the
		// session was on a moment ago.
		await sessionsPresetsHandler.handler(socket, params, emitToUser)
		await sessionsFunctionsHandler.handler(socket, params, emitToUser)
		await sessionsTriggersHandler.handler(
			socket,
			{ sessionId: params.sessionId },
			emitToUser
		)
		return reply({ sessionId: params.sessionId, configId: params.configId })
	}
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
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		const { listSessionFunctions, STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const [session] = await db
			.select({ genreId: schema.sessions.genreId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)
		const genreId = session?.genreId ?? STANDARD_GENRE_ID

		const res: Sockets.Sessions.Functions.Response = {
			sessionId: params.sessionId,
			genreId,
			functions: []
		}
		if (access.hasAccess && access.isOwner)
			res.functions = (await listSessionFunctions(
				db as any,
				params.sessionId,
				genreId,
				userId
			)) as any
		res.canAddOutsidePreset = !!socket.user!.isAdmin
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
				function: params.function,
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
			db as any,
			params.sessionId,
			genreId,
			params.function,
			!!params.enabled,
			{ userId, isAdmin: !!socket.user!.isAdmin }
		)
		if (!r.ok)
			return reply({
				sessionId: params.sessionId,
				function: params.function,
				error: r.error
			})

		// The trigger surface follows in the same breath, so the session view's
		// buttons cannot lag the setting that decides them.
		await sessionsFunctionsHandler.handler(socket, params, emitToUser)
		await sessionsTriggersHandler.handler(
			socket,
			{ sessionId: params.sessionId },
			emitToUser
		)
		return reply({
			sessionId: params.sessionId,
			function: params.function,
			enabled: r.enabled
		})
	}
}

export const sessionsGetHandler: Handler<
	Sockets.Sessions.Get.Params,
	Sockets.Sessions.Get.Response
> = {
	event: "sessions:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const limit = params.limit ?? 25
			const beforeId = params.beforeId

			// Check if user has access to this session (both owners and guests can get)
			const sessionAccess = await checkSessionAccess(params.id, userId)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.Sessions.Get.Response = {
					session: null,
					messages: null
				}
				emitToUser("sessions:get", res)
				return res
			}

			const sessionData = await getSessionFromDB(
				params.id,
				userId,
				limit,
				beforeId
			)

			if (!sessionData) {
				const res: Sockets.Sessions.Get.Response = {
					session: null,
					messages: null
				}
				emitToUser("sessions:get", res)
				return res
			}

			// Count total messages for pagination metadata
			const [{ total }] = await db
				.select({ total: count() })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, params.id))

			const loadedCount = (sessionData as any).sessionMessages.length
			const hasMore =
				beforeId != null
					? loadedCount === limit // cursor mode: full page implies more exist
					: total > limit // initial load: more exist than we fetched

			const drafts = (sessionData as any).drafts as
				| Record<string, string>
				| null
				| undefined
			const userDraft = drafts?.[String(userId)] || null

			// The parts-native half rides along (20 §13 phase 2): the client
			// renders from parts when present and falls back to the legacy
			// fields when not — the two are parity-identical by construction.
			if ((sessionData as any).sessionMessages?.length) {
				const { attachParts } = await import(
					"$lib/server/messages/store"
				)
				;(sessionData as any).sessionMessages = await attachParts(
					db,
					(sessionData as any).sessionMessages
				)
			}

			const res: Sockets.Sessions.Get.Response = {
				session: sessionData as any,
				messages: (sessionData as any).sessionMessages || null,
				pagination: { total, hasMore },
				beforeId,
				userDraft
			}
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
 * After a session is saved with a lorebook:
 * - Quietly create bindings for chars/personas that don't have one yet.
 * - Emit bindingCheck:result for any orphaned bindings (bindings without a char/persona).
 */
async function runLorebookBindingCheck(
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

	const bindingsByChar = new Map(
		existingBindings
			.filter((b) => b.characterId)
			.map((b) => [b.characterId!, b])
	)
	const bindingsByPersona = new Map(
		existingBindings
			.filter((b) => b.personaId)
			.map((b) => [b.personaId!, b])
	)

	// Flow 1a: Create missing bindings for chars/personas. Each binding's
	// token is derived from the lorebook's own per-lorebook counter (never
	// reused after a delete) — never a recomputed max/count, which is what
	// let deleted binding numbers get silently reused before.
	for (const { characterId } of sessionChars) {
		if (!characterId || bindingsByChar.has(characterId)) continue
		const created = await db.transaction(async (tx) => {
			const token = await deriveNextBindingToken(lorebookId, tx)
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({ lorebookId, characterId, binding: token })
				.returning()
			return inserted
		})
		await syncLorebookBindingsForCharacter(characterId)
		bindingsByChar.set(characterId, created)
		existingBindings.push(created)
	}

	for (const { personaId } of sessionPersonas) {
		if (!personaId || bindingsByPersona.has(personaId)) continue
		const created = await db.transaction(async (tx) => {
			const token = await deriveNextBindingToken(lorebookId, tx)
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({ lorebookId, personaId, binding: token })
				.returning()
			return inserted
		})
		await syncLorebookBindingsForPersona(personaId)
		bindingsByPersona.set(personaId, created)
		existingBindings.push(created)
	}

	// Flow 1b: Collect orphaned bindings (no char or persona)
	const orphaned = existingBindings.filter(
		(b) => !b.characterId && !b.personaId
	)
	if (orphaned.length > 0) {
		const unboundChars = sessionChars
			.filter((c) => c.characterId && !bindingsByChar.get(c.characterId))
			.map((c) => ({
				type: "character" as const,
				id: c.characterId!,
				name: ""
			}))
		const unboundPersonas = sessionPersonas
			.filter((p) => p.personaId && !bindingsByPersona.get(p.personaId))
			.map((p) => ({
				type: "persona" as const,
				id: p.personaId!,
				name: ""
			}))

		const bindingCheckRes: Sockets.BindingCheck.Result.Response = {
			lorebookId,
			sessionId,
			unboundEntities: [...unboundChars, ...unboundPersonas],
			orphanedBindings: orphaned.map((b) => ({
				id: b.id,
				binding: b.binding
			}))
		}
		emitToUser("bindingCheck:result", bindingCheckRes)
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
			if (sessionAccess.isOwner) {
				const tags = params.tags || []

				// lorebookId needs an ownership check (lorebooks is strictly
				// per-user) before it's accepted — everything else here is
				// either owner-only data or a reference to an admin-managed
				// global table (connections/samplingConfigs/promptConfigs/
				// narratorPromptConfigs), which needs no such check.
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
					groupReplyStrategy,
					drafts,
					lorebookId,
					connectionId,
					samplingConfigId,
					promptConfigId,
					narratorPromptConfigId,
					genreFields
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
						db as any,
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

				await db
					.update(schema.sessions)
					.set({
						...(name !== undefined ? { name } : {}),
						...(sessionType !== undefined ? { sessionType } : {}),
						...(scenario !== undefined ? { scenario } : {}),
						...(metadata !== undefined ? { metadata } : {}),
						...(groupReplyStrategy !== undefined
							? { groupReplyStrategy }
							: {}),
						...(drafts !== undefined ? { drafts } : {}),
						...(lorebookId !== undefined ? { lorebookId } : {}),
						...(connectionId !== undefined ? { connectionId } : {}),
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

				// Process tags after session update
				await processSessionTags(params.session.id!, tags, userId)
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
				return {
					characters: new Set(
						ccs
							.filter((c) => !c.removedAt && c.characterId != null)
							.map((c) => c.characterId as number)
					),
					personas: new Set(
						cps
							.filter((c) => !c.removedAt && c.personaId != null)
							.map((c) => c.personaId as number)
					)
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
					}
				}
			}

			// The member events (24 §5), best-effort: a failed dispatch must
			// never fail the update that caused it.
			if (membersBefore) {
				try {
					const after = await memberSnapshot()
					const deltas: Array<{
						event: "member-added" | "member-removed"
						kind: "character" | "persona"
						id: number
					}> = []
					for (const id of after.characters)
						if (!membersBefore.characters.has(id))
							deltas.push({
								event: "member-added",
								kind: "character",
								id
							})
					for (const id of membersBefore.characters)
						if (!after.characters.has(id))
							deltas.push({
								event: "member-removed",
								kind: "character",
								id
							})
					for (const id of after.personas)
						if (!membersBefore.personas.has(id))
							deltas.push({
								event: "member-added",
								kind: "persona",
								id
							})
					for (const id of membersBefore.personas)
						if (!after.personas.has(id))
							deltas.push({
								event: "member-removed",
								kind: "persona",
								id
							})
					if (deltas.length) {
						const [row] = await db
							.select({ genreId: schema.sessions.genreId })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, params.session.id!))
							.limit(1)
						const { dispatchSessionEvent } = await import(
							"$lib/server/pipelines/runtime/sessionEvents"
						)
						for (const delta of deltas) {
							const member = { kind: delta.kind, id: delta.id }
							await dispatchSessionEvent(db, {
								sessionId: params.session.id!,
								userId,
								genreId: row?.genreId ?? "core:genre/chat",
								event: delta.event,
								input: {
									main: member,
									member,
									sessionScope: {
										sessionId: params.session.id!,
										userId
									},
									sessionId: params.session.id!
								}
							})
						}
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
			await sessionsListHandler.handler(socket, {}, emitToUser) // Refresh session list

			// Flow 1+2: binding and node checks (fire-and-forget, errors are non-fatal)
			const lorebookId = (updatedSession as any).lorebookId
			if (lorebookId) {
				runLorebookBindingCheck(
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

			// Broadcast updated session to all participants
			const updatedSession = await getSessionFromDB(sessionId, userId)
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
			const guestSessionsList = await buildSessionsListFor(guestUserId)
			socket.io
				.to(`user_${guestUserId}`)
				.emit("sessions:list", guestSessionsList)

			// Broadcast updated session to all participants
			const updatedSession = await getSessionFromDB(sessionId, userId)
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

			// Push a fresh session list to the removed guest so the session
			// disappears from their sidebar without a manual refresh.
			const guestSessionsList = await buildSessionsListFor(guestUserId)
			socket.io
				.to(`user_${guestUserId}`)
				.emit("sessions:list", guestSessionsList)

			// Broadcast updated session to all remaining participants
			const updatedSession = await getSessionFromDB(sessionId, userId)
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

			// Also notify the removed guest that they've been removed
			socket.io
				.to(`user_${guestUserId}`)
				.emit("sessions:removedAsGuest", {
					sessionId
				})

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

			// Get the original session with all relations
			const originalSession = await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, sessionId),
				with: {
					sessionCharacters: {
						orderBy: asc(schema.sessionCharacters.position)
					},
					sessionPersonas: {
						orderBy: asc(schema.sessionPersonas.position)
					},
					sessionGuests: true,
					sessionTags: true
				}
			})

			if (!originalSession) {
				const res: Sockets.Sessions.Branch.Response = {
					error: "Original session not found"
				}
				emitToUser("sessions:branch", res)
				return res
			}

			// Verify the message exists and get its position
			const branchMessage = await db.query.sessionMessages.findFirst({
				where: and(
					eq(schema.sessionMessages.id, messageId),
					eq(schema.sessionMessages.sessionId, sessionId)
				)
			})

			if (!branchMessage) {
				const res: Sockets.Sessions.Branch.Response = {
					error: "Branch message not found"
				}
				emitToUser("sessions:branch", res)
				return res
			}

			// Get all messages up to and including the branch message
			const allMessages = await db.query.sessionMessages.findMany({
				where: eq(schema.sessionMessages.sessionId, sessionId),
				orderBy: asc(schema.sessionMessages.id)
			})
			const messagesToCopy = allMessages.filter(
				(msg) => msg.id <= messageId
			)

			// Everything below writes a brand-new session and its full copied
			// history — wrapped in one transaction so a crash or thrown error
			// partway through (e.g. server restart mid-copy) can't leave an
			// orphaned, half-copied branch session visible in the session list.
			const newSession = await db.transaction(async (tx) => {
				// Create the new session with only the properties that exist in the schema
				const newSessionData: InsertSession = {
					name: title,
					scenario: originalSession.scenario,
					userId: originalSession.userId,
					isGroup: originalSession.isGroup,
					groupReplyStrategy: originalSession.groupReplyStrategy,
					metadata: originalSession.metadata,
					lorebookId: originalSession.lorebookId
				}

				const [newSession] = await tx
					.insert(schema.sessions)
					.values(newSessionData)
					.returning()

				// Removed participants aren't copied into the branch at all —
				// a soft-removed row resurrecting as active in the new session
				// would undo the whole point of removing them.
				const sessionCharacters = (
					originalSession as any
				).sessionCharacters.filter((cc: any) => !cc.removedAt)
				if (sessionCharacters.length > 0) {
					await tx.insert(schema.sessionCharacters).values(
						sessionCharacters.map((sessionCharacter: any) => ({
							sessionId: newSession.id,
							characterId: sessionCharacter.characterId,
							position: sessionCharacter.position,
							isActive: sessionCharacter.isActive,
							visibility: sessionCharacter.visibility
						}))
					)
				}

				const sessionPersonas = (
					originalSession as any
				).sessionPersonas.filter((cp: any) => !cp.removedAt)
				if (sessionPersonas.length > 0) {
					await tx.insert(schema.sessionPersonas).values(
						sessionPersonas.map((sessionPersona: any) => ({
							sessionId: newSession.id,
							personaId: sessionPersona.personaId,
							position: sessionPersona.position
						}))
					)
				}

				const sessionGuests = (originalSession as any).sessionGuests
				if (sessionGuests.length > 0) {
					await tx.insert(schema.sessionGuests).values(
						sessionGuests.map((sessionGuest: any) => ({
							sessionId: newSession.id,
							userId: sessionGuest.userId
						}))
					)
				}

				const sessionTags = (originalSession as any).sessionTags
				if (sessionTags.length > 0) {
					await tx.insert(schema.sessionTags).values(
						sessionTags.map((sessionTag: any) => ({
							sessionId: newSession.id,
							tagId: sessionTag.tagId
						}))
					)
				}

				if (messagesToCopy.length > 0) {
					await insertLegacyMany(
						tx,
						messagesToCopy.map(
							(message) =>
								({
									sessionId: newSession.id,
									userId: message.userId,
									personaId: message.personaId,
									characterId: message.characterId,
									role: message.role,
									content: message.content,
									isHidden: message.isHidden,
									isGenerating: false, // Always set to false for copied messages
									metadata: message.metadata
								}) satisfies InsertSessionMessage
						)
					)
				}

				return newSession
			})

			// Fetch the complete new session with messages
			const branchedSession = await getSessionFromDB(
				newSession.id,
				userId
			)
			if (!branchedSession) {
				throw new Error("Failed to fetch branched session")
			}

			// Refresh session list
			await sessionsListHandler.handler(socket, {}, emitToUser)

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
				const modeCheck = await sessionGenreAvailable(
					db as any,
					sessionId
				)
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

			// Create the new message
			const newMessage: InsertSessionMessage = {
				userId,
				sessionId,
				personaId: personaId || null,
				role: "user",
				content
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

			// Round-robin no longer waits for every persona to speak before letting
			// a character go — a persona can freely speak between two characters'
			// turns. getNextCharacterTurn decides per-character, from message
			// recency, whether anyone is actually due right now (see
			// getNextCharacterTurn.ts), so this is safe to call after every
			// persona message: it's a no-op if nobody's due yet.
			await triggerGenerateMessageHandler.handler(
				socket,
				{ sessionId },
				emitToUser
			)

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
			// checkMessageEditPermission for the full rationale.
			const canEdit = await checkMessageEditPermission(id, userId)
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

			// The mode's declared verb policy (20 §4) — content edits only.
			// isHidden is a floor: hiding is always the owner's, and no
			// declaration is consulted for it.
			if (content !== undefined) {
				const editRefusal = await verbRefusal(
					db,
					existingMessage.sessionId,
					"edit"
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

			// Build the update object dynamically
			const updates: Partial<typeof schema.sessionMessages.$inferInsert> =
				{}
			if (content !== undefined) {
				updates.content = content
				// Content changed — clear the embedding so the vectorization queue re-embeds it
				updates.embedding = null
				updates.embeddingModel = null

				// Also update the swipe history if it exists
				const metadata = existingMessage.metadata as any
				if (
					metadata?.swipes?.history &&
					Array.isArray(metadata.swipes.history)
				) {
					const currentIdx = metadata.swipes.currentIdx ?? 0
					// Update the content in the swipes history at the current index
					const updatedHistory = [...metadata.swipes.history]
					if (currentIdx >= 0 && currentIdx < updatedHistory.length) {
						updatedHistory[currentIdx] = content
					}

					updates.metadata = {
						...metadata,
						swipes: {
							...metadata.swipes,
							history: updatedHistory
						}
					}
				}
			}
			if (isHidden !== undefined) updates.isHidden = isHidden

			// Update the message
			const [updated] = await updateLegacyWhere(
				db,
				eq(schema.sessionMessages.id, id),
				updates
			)

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

			// Broadcast sessionMessage to all session participants
			await broadcastToSessionUsers(
				socket.io,
				updated.sessionId,
				"sessionMessage",
				{ sessionMessage: updated }
			)

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
			const canEdit = await checkMessageEditPermission(params.id, userId)
			if (!canEdit) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: "Access denied. You can only delete messages from your own characters/personas or if you own the session."
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// Delete the message (both worlds — the store owns the mirror)
			await deleteLegacy(db, params.id)

			const res: Sockets.SessionMessages.Delete.Response = {
				id: params.id,
				success: "Message deleted successfully"
			}
			emitToUser("sessionMessages:delete", res)

			// Emit sessions:get to refresh the entire session after deletion
			await sessionsGetHandler.handler(
				socket,
				{ id: message.sessionId },
				emitToUser
			)

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

			return await withSessionTriggerLock(
				messageToRegenerate.sessionId,
				async () => {
					// Session owner or the character's owner (character messages), or the
					// persona's owner (persona messages) — see checkMessageEditPermission.
					const canEdit = await checkMessageEditPermission(
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
						"retry"
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
					// triggerGenerateMessageHandler's own in-lock check.
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

					// Clear the content and set as generating
					const [updated] = await updateLegacyWhere(
						db,
						eq(schema.sessionMessages.id, params.id),
						{
							content: "",
							isGenerating: true,
							generationStage: "queued",
							error: null,
							metadata: currentMetadata
						}
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

					// Start generating the response
					await generateResponse({
						socket,
						emitToUser,
						sessionId: messageToRegenerate.sessionId,
						userId,
						generatingMessage: updated as any
					})

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

export const sessionMessagesContinueHandler: Handler<
	Sockets.SessionMessages.Continue.Params,
	Sockets.SessionMessages.Continue.Response
> = {
	event: "sessionMessages:continue",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message to continue first — needed to learn sessionId,
			// which is the lock key, before we can acquire it.
			const messageToContinue = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!messageToContinue) {
				const res: Sockets.SessionMessages.Continue.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:continue", res)
				return res
			}

			return await withSessionTriggerLock(
				messageToContinue.sessionId,
				async () => {
					// Session owner or the character's owner — see checkMessageEditPermission.
					const canEdit = await checkMessageEditPermission(
						params.id,
						userId
					)
					if (!canEdit) {
						const res: Sockets.SessionMessages.Continue.Response = {
							sessionMessage: undefined,
							error: "Access denied. You don't have permission to continue this message."
						}
						emitToUser("sessionMessages:continue", res)
						return res
					}

					// The mode's declared verb policy (20 §4).
					const continueRefusal = await verbRefusal(
						db,
						messageToContinue.sessionId,
						"continue"
					)
					if (continueRefusal) {
						const res: Sockets.SessionMessages.Continue.Response = {
							sessionMessage: undefined,
							error: continueRefusal
						}
						emitToUser("sessionMessages:continue", res)
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
										messageToContinue.sessionId
									),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.SessionMessages.Continue.Response = {
							sessionMessage: undefined,
							error: "A response is already generating in this session."
						}
						emitToUser("sessionMessages:continue:error", res)
						return res
					}

					// Get current metadata and preserve it
					const currentMetadata =
						(messageToContinue.metadata as any) || {}

					// Set as generating but KEEP existing content
					// The content will be used as a prefix in generateResponse
					const [updated] = await updateLegacyWhere(
						db,
						eq(schema.sessionMessages.id, params.id),
						{
							isGenerating: true,
							generationStage: "queued",
							error: null,
							metadata: currentMetadata
						}
					)

					const res: Sockets.SessionMessages.Continue.Response = {
						sessionMessage: updated as any
					}
					emitToUser("sessionMessages:continue", res)

					// Broadcast sessionMessage to all session participants
					await broadcastToSessionUsers(
						socket.io,
						updated.sessionId,
						"sessionMessage",
						{ sessionMessage: updated }
					)

					// Start generating the response continuation
					await generateResponse({
						socket,
						emitToUser,
						sessionId: messageToContinue.sessionId,
						userId,
						generatingMessage: updated as any
					})

					return res
				}
			)
		} catch (error: any) {
			console.error("Error continuing session message:", error)
			const res: Sockets.SessionMessages.Continue.Response = {
				sessionMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to continue message"
			}
			emitToUser("sessionMessages:continue:error", res)
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

			// Regenerate/Continue/SwipeRight all wrap their mutation in the
			// per-session generation lock; without it here, a SwipeRight/
			// Regenerate/Continue racing against a concurrent SwipeLeft on
			// the same message could have its isGenerating/queueItemId
			// state clobbered back to the stale pre-read values below.
			return await withSessionTriggerLock(message.sessionId, async () => {
				// Session owner or the character's owner — see checkMessageEditPermission.
				const canEdit = await checkMessageEditPermission(
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

				let isOnFirstSwipe = false

				// Check if metadata.swipes, if not, initialize it
				const data: SelectSessionMessage = {
					...message,
					metadata: {
						...message.metadata,
						swipes: {
							currentIdx: null,
							history: [],
							...(message.metadata?.swipes || {})
						}
					}
				}

				// Check if we are on the first swipe (idx=0|null) (or if there are no swipes)
				if (
					!data.metadata!.swipes!.history.length ||
					data.metadata!.swipes!.currentIdx === null ||
					data.metadata!.swipes!.currentIdx === 0
				) {
					isOnFirstSwipe = true
				}

				// If we are on the first swipe, return an error
				if (isOnFirstSwipe) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Already on the first swipe, cannot swipe left."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				// If not on the first swipe, update the current index and content
				data.metadata!.swipes!.currentIdx =
					(data.metadata!.swipes!.currentIdx || 0) - 1
				data.content =
					data.metadata!.swipes!.history[
						data.metadata!.swipes!.currentIdx
					] || ""
				// Sync active thinking to the new swipe slot
				data.metadata!.thinking =
					data.metadata!.swipes!.thinkingHistory?.[
						data.metadata!.swipes!.currentIdx
					] ?? null

				// Update the session message in the database (drop `id` — it's the
				// primary key, not an updatable column, and isn't optional on
				// SelectSessionMessage so `delete` can't be used here)
				const { id: _id, ...dataWithoutId } = data
				const [updated] = await updateLegacyWhere(
					db,
					eq(schema.sessionMessages.id, message.id),
					{ ...dataWithoutId }
				)

				if (!updated) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Failed to update session message."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: updated as any
				}
				emitToUser("sessionMessages:swipeLeft", res)

				// Broadcast sessionMessage to all session participants
				await broadcastToSessionUsers(
					socket.io,
					updated.sessionId,
					"sessionMessage",
					{ sessionMessage: updated }
				)

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

			return await withSessionTriggerLock(message.sessionId, async () => {
				// Session owner or the character's owner — see checkMessageEditPermission.
				const canEdit = await checkMessageEditPermission(
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

				let isOnLastSwipe = false

				// Check if metadata.swipes, if not, initialize it
				const data: SelectSessionMessage = {
					...message,
					metadata: {
						...message.metadata,
						swipes: {
							currentIdx: null,
							history: [],
							...(message.metadata?.swipes || {})
						}
					}
				}

				// Check if we are on the last swipe (or if there are no swipes)
				if (
					!data.metadata!.swipes!.history.length ||
					data.metadata!.swipes!.currentIdx === null
				) {
					isOnLastSwipe = true
				} else {
					isOnLastSwipe =
						data.metadata!.swipes!.currentIdx ===
						data.metadata!.swipes!.history.length - 1
				}

				if (!isOnLastSwipe) {
					// If not on the last swipe, just update the current index and content
					data.metadata!.swipes!.currentIdx =
						(data.metadata!.swipes!.currentIdx || 0) + 1
					data.content =
						data.metadata!.swipes!.history[
							data.metadata!.swipes!.currentIdx
						] || ""
					// Sync active thinking to the new swipe slot
					data.metadata!.thinking =
						data.metadata!.swipes!.thinkingHistory?.[
							data.metadata!.swipes!.currentIdx
						] ?? null
				} else {
					// About to start a brand-new generation — freshness guard,
					// re-checked now that the lock is held, matching
					// regenerate/continue. Pure swipe navigation (the branch
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
						const res: Sockets.SessionMessages.SwipeRight.Response =
							{
								sessionMessage: undefined,
								error: "A response is already generating in this session."
							}
						emitToUser("sessionMessages:swipeRight:error", res)
						return res
					}

					if (data.metadata!.swipes!.currentIdx === null) {
						data.metadata!.swipes!.currentIdx = 0
						data.metadata!.swipes!.history.push(data.content)
						// Keep thinkingHistory in sync when initialising swipes for the first time
						const th: (string | null)[] =
							data.metadata!.swipes!.thinkingHistory || []
						while (
							th.length < data.metadata!.swipes!.history.length
						)
							th.push(null)
						data.metadata!.swipes!.thinkingHistory = th
					}
					// Now increment the current index and push a new empty generation slot
					data.metadata!.swipes!.currentIdx += 1
					data.content = "" // Clear the message content
					data.isGenerating = true // Set generating state to true
					data.generationStage = "queued"
					data.error = null
					data.queueItemId = null
					// Push the new empty content to history
					data.metadata!.swipes!.history.push("") // Add an empty string to history
					// Push a matching null into thinkingHistory to keep lengths equal
					const th: (string | null)[] =
						data.metadata!.swipes!.thinkingHistory || []
					while (
						th.length <
						data.metadata!.swipes!.history.length - 1
					)
						th.push(null)
					th.push(null)
					data.metadata!.swipes!.thinkingHistory = th
					// Clear active thinking — new slot has no thinking yet
					data.metadata!.thinking = null
				}

				// Drop `id` — it's the primary key, not an updatable column, and
				// isn't optional on SelectSessionMessage so `delete` can't be used.
				const { id: _id, ...dataWithoutId } = data

				// Update the session message in the database
				const [updated] = await updateLegacyWhere(
					db,
					eq(schema.sessionMessages.id, message.id),
					{ ...dataWithoutId }
				)

				if (!updated) {
					const res: Sockets.SessionMessages.SwipeRight.Response = {
						sessionMessage: undefined,
						error: "Failed to update session message."
					}
					emitToUser("sessionMessages:swipeRight", res)
					return res
				}

				const res: Sockets.SessionMessages.SwipeRight.Response = {
					sessionMessage: updated as any
				}
				emitToUser("sessionMessages:swipeRight", res)

				if (!updated.isGenerating) {
					// If the message is not generating, broadcast the updated sessionMessage
					await broadcastToSessionUsers(
						socket.io,
						updated.sessionId,
						"sessionMessage",
						{ sessionMessage: updated }
					)
					return res
				}

				// If the message is generating, we need to start generating a response
				await broadcastToSessionUsers(
					socket.io,
					updated.sessionId,
					"sessionMessage",
					{ sessionMessage: updated }
				)

				await generateResponse({
					socket,
					emitToUser,
					sessionId: message.sessionId,
					userId,
					generatingMessage: updated as any
				})

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

export const sessionsGetResponseOrderHandler: Handler<
	Sockets.Sessions.GetResponseOrder.Params,
	Sockets.Sessions.GetResponseOrder.Response
> = {
	event: "sessions:getResponseOrder",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const session = await getPromptSessionFromDb(
				params.sessionId,
				userId
			)

			if (!session) {
				const res: Sockets.Sessions.GetResponseOrder.Response = {
					sessionId: params.sessionId,
					nextCharacterId: null,
					characterIds: []
				}
				emitToUser("sessions:getResponseOrder", res)
				return res
			}

			// Get next character turn using existing logic
			const nextCharacterId = getNextCharacterTurn(
				{
					sessionMessages: session.sessionMessages,
					sessionCharacters: session.sessionCharacters
						.filter((cc) => cc.character !== null && cc.isActive)
						.sort(
							(a, b) => (a.position ?? 0) - (b.position ?? 0)
						) as any,
					sessionPersonas: session.sessionPersonas.filter(
						(cp) => cp.persona !== null
					) as any
				},
				session.groupReplyStrategy
			)

			const res: Sockets.Sessions.GetResponseOrder.Response = {
				sessionId: params.sessionId,
				nextCharacterId: nextCharacterId,
				characterIds: [] // Empty array for now, can be populated later if needed
			}
			emitToUser("sessions:getResponseOrder", res)
			return res
		} catch (error: any) {
			console.error("Error getting session response order:", error)
			const res: Sockets.Sessions.GetResponseOrder.Response = {
				sessionId: params.sessionId,
				nextCharacterId: null,
				characterIds: []
			}
			emitToUser("sessions:getResponseOrder", res)
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

			// THE VERY FIRST THING this handler does: unconditionally flip the
			// clicked message off "generating" and broadcast it — scoped only by
			// message id + sessionId, never by isGenerating/userId matching. This
			// must never be contingent on the upstream LLM actually stopping, on
			// queue state, or on a row's stamped userId matching whoever clicked
			// Stop (previously required cm.userId === socket.user.id, which
			// silently no-op'd the whole handler whenever that didn't match,
			// leaving the message stuck "generating" forever — e.g. while still
			// in the "loading model" preflight stage). Everything below this is
			// best-effort cleanup of the actual upstream generation.
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

			for (const id of targetIds) {
				const [updated] = await updateLegacyWhere(
					db,
					and(
						eq(schema.sessionMessages.id, id),
						eq(
							schema.sessionMessages.sessionId,
							params.sessionId
						)
					),
					{
						isGenerating: false,
						generationStage: null,
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
				}
			}

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

			// Get context/prompt config from user settings; resolve connection+sampling via
			// resolveTaskConfig (session override → prompt config override → system default)
			const { contextConfig, promptConfig } =
				await getUserConfigurations(userId)
			const { connection, sampling } = await resolveTaskConfig({
				taskType: "session",
				promptConfigId: promptConfig?.id,
				sessionId: session.id
			})

			if (!connection) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "No AI connection configured. Please set up a connection first."
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
			// generateResponse.ts/sessionsListHandler.
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

			const currentCharacterId = getNextCharacterTurn(
				{
					sessionMessages: messagesWithDraft,
					sessionCharacters: activeSessionCharacters.sort(
						(a, b) => (a.position ?? 0) - (b.position ?? 0)
					),
					sessionPersonas: sessionPersonasWithPersona
				},
				session.groupReplyStrategy
			)

			if (!currentCharacterId) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "No character available for prompt."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			/**
			 * Compiled by the **pipeline**, stopped before it sends.
			 *
			 * This used to construct an adapter and call `compilePrompt`, which
			 * ran the legacy infill engines — so the number on screen came from
			 * a code path that no longer generates any replies. It was the last
			 * live consumer of that path, and the reason it could not be
			 * deleted.
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

			// Return the compiled prompt in the correct format
			emitToUser("sessions:promptTokenCount", promptResult)
			return promptResult
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
 * Type-safe handler for triggering message generation
 */
export const triggerGenerateMessageHandler: Handler<
	Sockets.Sessions.TriggerGenerateMessage.Params,
	Sockets.Sessions.TriggerGenerateMessage.Response
> = {
	event: "sessions:triggerGenerateMessage",
	handler: async (socket, params, emitToUser) =>
		withSessionTriggerLock(params.sessionId, async () => {
			try {
				const userId = socket.user!.id
				const msgLimit = 10
				let currentMsg = 1
				let ok = true

				// An explicit characterId means a client pressed "Trigger
				// Character" — an out-of-turn generation aimed at a specific
				// character. That is owner-only. getPromptSessionFromDb below
				// admits guests too (checkSessionAccess is owner-OR-guest), and
				// unlike regenerate/continue/swipe this path had no permission
				// check of its own, so a guest in a shared session could emit
				// this event directly and drive generations in someone else's
				// session. It was gated only by the client hiding the tab.
				//
				// Scoped to the explicit-characterId case on purpose: the
				// automatic round-robin call after a persona message (see
				// sessionMessagesSendPersonaMessageHandler) invokes this handler
				// with no characterId, and guests are supposed to be able to
				// speak and get replies in a session shared with them.
				if (params.characterId) {
					const access = await checkSessionAccess(
						params.sessionId,
						userId
					)
					if (!access.hasAccess) {
						// Matches the "Session not found" the lookup below would
						// have produced — a missing session and an inaccessible
						// one stay indistinguishable.
						return {
							error: "Error Triggering Session Message: Session not found."
						}
					}
					if (!access.isOwner) {
						return {
							error: "Access denied. Only the session owner can trigger a specific character."
						}
					}
				}

				console.log(
					`[triggerGenerateMessage] Starting generation for session ${params.sessionId}, once: ${params.once}, characterId: ${params.characterId}`
				)

				while (currentMsg <= msgLimit && ok) {
					let session = await getPromptSessionFromDb(
						params.sessionId,
						userId
					)
					if (!session) {
						return {
							error: "Error Triggering Session Message: Session not found."
						}
					}

					// Check if there are any ongoing generations before starting a new one
					const hasGeneratingMessages = session.sessionMessages.some(
						(msg) => msg.isGenerating
					)
					if (hasGeneratingMessages) {
						console.log(
							"Generation already in progress, stopping trigger loop"
						)
						break
					}

					// Get active characters
					const activeCharacters = session.sessionCharacters.filter(
						(cc) => cc.character !== null && cc.isActive
					)

					// Find the next character who should reply — an explicit
					// characterId always wins (manual out-of-turn trigger, and the
					// only way a "Manual" session ever advances at all). Otherwise ask
					// getNextCharacterTurn who's actually due right now, but only for
					// non-"Manual" sessions — a "Manual" session's whole point is that nobody
					// auto-advances, so calls with no explicit characterId (e.g. the
					// automatic re-check after every persona message) are a no-op.
					const nextCharacterId =
						params.characterId ||
						(session.groupReplyStrategy !==
						GroupReplyStrategies.MANUAL
							? getNextCharacterTurn(
									{
										sessionMessages:
											session.sessionMessages,
										sessionCharacters:
											activeCharacters.sort(
												(a, b) =>
													(a.position ?? 0) -
													(b.position ?? 0)
											) as any,
										sessionPersonas:
											session.sessionPersonas.filter(
												(cp) => cp.persona !== null
											) as any
									},
									session.groupReplyStrategy
								)
							: null)

					if (!nextCharacterId) {
						break
					}

					if (
						session &&
						session.sessionCharacters.length > 0 &&
						nextCharacterId
					) {
						const nextCharacter = session.sessionCharacters.find(
							(cc) =>
								cc.character &&
								cc.character.id === nextCharacterId
						)
						if (!nextCharacter || !nextCharacter.character) break

						const assistantMessage: InsertSessionMessage = {
							userId,
							sessionId: params.sessionId,
							personaId: null,
							characterId: nextCharacter.character.id,
							content: "",
							role: "assistant",
							isGenerating: true,
							generationStage: "queued"
						}

						const generatingMessage = await insertLegacy(
							db,
							assistantMessage
						)

						// emitToUser is always provided by the handler dispatcher (see
						// Handler in $lib/shared/events.ts — non-optional), so this
						// unconditionally broadcasts.
						await broadcastToSessionUsers(
							socket.io,
							generatingMessage.sessionId,
							"sessionMessage",
							{ sessionMessage: generatingMessage }
						)
						// sessionMessage was already broadcasted above, no need for duplicate emission

						ok = await generateResponse({
							socket,
							emitToUser,
							sessionId: params.sessionId,
							userId,
							generatingMessage: generatingMessage as any
						})

						// If generation was aborted, stop the loop
						if (!ok) {
							console.log(
								"Generation was aborted, stopping trigger loop"
							)
							break
						}

						console.log(
							`[triggerGenerateMessage] Message ${currentMsg}/${msgLimit} generated successfully=${ok}, once: ${params.once}`
						)
					}

					// If once is true, exit after the first message
					if (params.once) break

					currentMsg++
				}

				return { success: true }
			} catch (error) {
				console.error("Error in triggerGenerateMessageHandler:", error)
				return {
					error: "Failed to trigger message generation."
				}
			}
		})
}

// "Narrator" — a manually-triggered, non-character narration/environment
// response. Deliberately does NOT touch session.sessionCharacters or
// getNextCharacterTurn at all: since a narrator message is never a
// sessionCharacters row, it's automatically excluded from round-robin with no
// extra exclusion logic needed.
export const triggerNarratorResponseHandler: Handler<
	Sockets.Sessions.TriggerNarratorResponse.Params,
	Sockets.Sessions.TriggerNarratorResponse.Response
> = {
	event: "sessions:triggerNarratorResponse",
	handler: async (socket, params, emitToUser) =>
		withSessionTriggerLock(params.sessionId, async () => {
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
						error: "Error triggering Narrator response: Session not found."
					}
				}
				if (!access.isOwner) {
					return {
						error: "Access denied. Only the session owner can trigger a Narrator response."
					}
				}

				const session = await getPromptSessionFromDb(
					params.sessionId,
					userId
				)
				if (!session) {
					return {
						error: "Error triggering Narrator response: Session not found."
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

				// Resolve the effective narrator config (session override → user active →
				// system default) up front so the message's display name is
				// snapshotted at generation time — later renaming a config, or
				// changing the session's override, doesn't retroactively relabel
				// already-generated messages.
				const effectiveNarratorConfig =
					await resolveNarratorPromptConfig(session, userId)
				const narratorName =
					effectiveNarratorConfig?.narratorName || "Narrator"

				const narratorMessage: InsertSessionMessage = {
					userId,
					sessionId: params.sessionId,
					personaId: null,
					characterId: null,
					content: "",
					role: "assistant",
					isNarratorResponse: true,
					isGenerating: true,
					generationStage: "queued",
					metadata: {
						narratorName,
						...(params.instructions
							? { narratorInstructions: params.instructions }
							: {})
					}
				}

				const generatingMessage = await insertLegacy(
					db,
					narratorMessage
				)

				await broadcastToSessionUsers(
					socket.io,
					generatingMessage.sessionId,
					"sessionMessage",
					{ sessionMessage: generatingMessage }
				)

				const ok = await generateResponse({
					socket,
					emitToUser,
					sessionId: params.sessionId,
					userId,
					generatingMessage: generatingMessage as any
				})

				return { success: ok }
			} catch (error) {
				console.error("Error in triggerNarratorResponseHandler:", error)
				return {
					error: "Failed to trigger Narrator response."
				}
			}
		})
}

// Lets the client label the Narrator trigger button/modal correctly BEFORE any
// message exists (e.g. a session-specific narrator name like "Fate" instead of
// the default "Narrator"). Deliberately not admin-gated — any session
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
			// handler's own declared event, then refresh via the real sessions:get
			// handler that EditSessionForm/the session page actually listen for.
			emitToUser("sessions:toggleSessionCharacterActive", res)
			await sessionsGetHandler.handler(
				socket,
				{ id: session.id },
				emitToUser
			)

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

/**
 * Type-safe handler for updating session character visibility
 */
export const updateSessionCharacterVisibilityHandler: Handler<
	Sockets.Sessions.UpdateSessionCharacterVisibility.Params,
	Sockets.Sessions.UpdateSessionCharacterVisibility.Response
> = {
	event: "sessions:updateSessionCharacterVisibility",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// See toggleSessionCharacterActiveHandler — same "owner OR this
			// character's own owner" escalation, not an owner-only ad-hoc
			// check.
			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) {
				return {
					sessionId: params.sessionId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "Error updating character visibility: Session not found."
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
					visibility: params.visibility,
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
					visibility: params.visibility,
					error: "Access denied. Only the session owner or this character's owner can change this."
				}
			}

			// Update visibility in database
			await db
				.update(schema.sessionCharacters)
				.set({ visibility: params.visibility })
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
				visibility: params.visibility
			}
			// See toggleSessionCharacterActiveHandler — getSession emits under an event
			// name nothing listens for, dropping both the ack and the refresh.
			emitToUser("sessions:updateSessionCharacterVisibility", res)
			await sessionsGetHandler.handler(
				socket,
				{ id: session.id },
				emitToUser
			)

			return res
		} catch (error) {
			console.error(
				"Error in updateSessionCharacterVisibilityHandler:",
				error
			)
			return {
				sessionId: params.sessionId,
				characterId: params.characterId,
				visibility: params.visibility,
				error: "Failed to update character visibility."
			}
		}
	}
}

// Registration function for all session handlers
/**
 * The account-visibility view (design §4). From the caller's own seat, what of
 * *their* data this session exposes to everyone else in it.
 *
 * This is the exact inverse of `canViewCharacter`/`canViewPersona`: a character
 * or persona a person owns becomes viewable by every other participant — and
 * readable by the pipelines that assemble this session's prompts — the instant
 * it is bound in. A guest asking here sees only their own contributions and who
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

		res.exposed.personas = await db
			.select({ id: schema.personas.id, name: schema.personas.name })
			.from(schema.sessionPersonas)
			.innerJoin(
				schema.personas,
				eq(schema.sessionPersonas.personaId, schema.personas.id)
			)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, params.sessionId),
					eq(schema.personas.userId, userId)
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
				.select({ id: schema.lorebooks.id, name: schema.lorebooks.name })
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
	register(socket, sessionsModesHandler, emitToUser)
	register(socket, sessionsTriggersHandler, emitToUser)
	register(socket, sessionsViewHandler, emitToUser)
	register(socket, sessionsPanelLayoutGetHandler, emitToUser)
	register(socket, sessionsPanelLayoutSetHandler, emitToUser)
	register(socket, sessionsPipelinesHandler, emitToUser)
	register(socket, sessionsTriggerFunctionHandler, emitToUser)
	register(socket, sessionsPresetsHandler, emitToUser)
	register(socket, sessionsChoosePresetHandler, emitToUser)
	register(socket, sessionsFunctionsHandler, emitToUser)
	register(socket, sessionsSetFunctionHandler, emitToUser)
	register(socket, sessionsUpgradeModeHandler, emitToUser)
	register(socket, sessionsFunctionCandidatesHandler, emitToUser)
	register(socket, sessionsBindFunctionHandler, emitToUser)
	register(socket, sessionsSpeakerStrategiesHandler, emitToUser)
	register(socket, sessionsSetSpeakerStrategyHandler, emitToUser)
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
	register(socket, sessionMessagesContinueHandler, emitToUser)
	register(socket, sessionMessagesSwipeLeftHandler, emitToUser)
	register(socket, sessionMessagesSwipeRightHandler, emitToUser)
	register(socket, sessionsGetResponseOrderHandler, emitToUser)
	register(socket, sessionMessagesCancelHandler, emitToUser)
	register(socket, sessionMessageHandler, emitToUser)
	register(socket, promptTokenCountHandler, emitToUser)
	register(socket, triggerGenerateMessageHandler, emitToUser)
	register(socket, triggerNarratorResponseHandler, emitToUser)
	register(socket, sessionsGetNarratorNameHandler, emitToUser)
	register(socket, toggleSessionCharacterActiveHandler, emitToUser)
	register(socket, updateSessionCharacterVisibilityHandler, emitToUser)
	register(socket, sessionsAccountVisibilityHandler, emitToUser)
}
