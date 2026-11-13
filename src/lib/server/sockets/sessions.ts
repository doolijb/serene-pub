import { storedSwapsOf, type StoredSwapContribution } from "$lib/shared/swaps"
import { inPlay } from "$lib/shared/sessions/inPlay"

import { isNewAttachOfDisabledBook, markedBook, providedBooksReadableBy } from "$lib/server/plugins/providedMarks"
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
	type WidgetSurface,
	WIDGET_ID_ALIASES,
	readComposerStates
} from "@serene-pub/sdk"
import { sessionArchivedRefusal, withSessionArchiveClosure } from "$lib/server/sessions/archive"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { declaredWidgetReads } from "$lib/shared/widgets/reads"
import {
	insertLegacy,
	updateLegacyWhere,
	hasNativeSteps,
	attachParts,
	liveMessageWhere
} from "$lib/server/messages/store"
import {
	extendVerbRefusal,
	pressedTurnControl,
	resolveMessageVerbs,
	turnControlRefusal,
	turnDeleteVerdict,
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
import { drawnWidgetIds, formatChannel, isWidgetInstanceId, parseChannel, validateSessionLayout, widgetOfInstance, type ChannelLaneV1, type SessionLayoutV1 } from "@serene-pub/sdk"
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	max,
	or,
	sql
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { memberFormOn } from "$lib/server/state/memberForm"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"
import {
	SEAT_REFUSALS,
	announceSeatChanges,
	sameMemberRefusal,
	seatCast,
	seatOf,
	seatPlayer,
	settleSeats,
	syncMintedSeatMembers,
	unseat,
	setSeatBench,
	type MintedSeatMember,
	type SeatChange
} from "$lib/server/sessions/seats"
import {
	lastVisibleMessages,
	liveMessageCounts,
	seatCastShownForSessions
} from "$lib/server/sessions/rowProjection"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import { sessionGenreOf } from "$lib/server/sessions/annexFields"
import { SESSION_UPDATE_REFUSALS } from "$lib/server/sessions/updateRefusals"
import { appletCallerOf } from "./appletCause"

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
import { retractStateAnchoredTo, StateRefusal } from "$lib/server/state/write"
import { SettledRefusal } from "$lib/server/sessions/settle"
import { runReply } from "../utils/runReply"
import { clearReplyFailed } from "../utils/generationStatus"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import { InterpolationEngine } from "../utils/interpolation/InterpolationEngine"
import { dev } from "$app/environment"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import type { AutomaticApplyCause } from "$lib/server/lorebooks/ownBook"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { RunProgress } from "$lib/shared/sockets/progress"
import { resolveTaskConfig } from "../utils/resolveTaskConfig"
import { llmQueue } from "../utils/llmQueue"
import {
	broadcastToSessionUsers,
	createSessionBroadcaster,
	emitToUserRedacted,
	getSessionUserIds
} from "./utils/broadcastHelpers"
import { relistBindings } from "./lorebooks"
import {
	checkSessionAccess,
	type SessionAccess
} from "$lib/server/utils/sessionAccess"
import {
	cloneLayoutPreset,
	arrangementOf,
	copyLayoutIntoSession,
	deleteUserLayoutPreset,
	genreDefaultLayoutRow,
	LAYOUT_PRESET_NEEDS_NAME,
	LAYOUT_PRESET_CANT_SAVE,
	LAYOUT_PRESET_UNKNOWN,
	layoutPresetUsage,
	listLayoutPresets,
	renameUserLayoutPreset,
	resolveNewSessionLayout,
	saveAsNewLayout,
	saveChangesToLayout,
	shareLayoutPreset,
	startedFromUpdated
} from "$lib/server/db/layoutPresets"
import { setUserLayoutDefault } from "$lib/server/db/userLayoutDefaults"
import {
	readWidgetSettings,
	storedWidgetInstanceIds,
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
import { findOwnedBook } from "$lib/server/utils/ownedBook"

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
 * 🚧 (m3-core, ★M3-1 "Pub wide") Or be a live provided book, which every
 * person may read into their own session. ⚠ Open (★M3-core-1): the
 * binding sync (`runLorebookBindingCheck`) still mints a member's cast rows
 * into such a book directly, outside its write mode.
 */
async function checkLorebookOwnership(
	lorebookId: number,
	userId: number,
	/** The session whose book this is, when it already has one: re-sending the book it reads is not a new attach. */
	sessionId?: number
): Promise<boolean> {
	if (
		!(await findOwnedBook(db, userId, lorebookId)) &&
		!(await providedBooksReadableBy(db as unknown as Db, userId, [lorebookId])).has(lorebookId)
	)
		return false
	if (await isNewAttachOfDisabledBook(db as unknown as Db, lorebookId, sessionId)) return false
	// 🚧 A session's own notes are never read into another session
	// (PLAN-rulesets §26): they are found only through their session.
	const [book] = await db
		.select({ sessionId: schema.lorebooks.sessionId, kind: schema.lorebooks.kind })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	// 🚧 Nor is a starter lorebook (PLAN-lorebook-kinds §B): a session starts
	// from one (`starterKit`), it never reads one. The callers say so first,
	// in words (`kitReadRefusal`).
	return book?.sessionId == null && book?.kind === "book"
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
		// Pipeline state and every member's unsent drafts never ride a list (V1a);
		// nor core's runtime columns: read marks are every member's, and a
		// deck's state lets a player work out the next card.
		columns: {
			annex: false,
			annexAudiences: false,
			drafts: false,
			turnOrder: false,
			turnTally: false,
			laneReads: false,
			rulesetDecks: false
		}
	})
	// 🚧 Each seat's card as its current card version has it: the relational
	// read's name and face are the stale ⏳ copies. The trimmed shape stays.
	await putCardsNow(
		[
			...sessionsList.map((s) => ({
				rows: s.sessionCharacters,
				key: "character"
			})),
			...sessionsList.map((s) => ({
				rows: s.sessionPersonas,
				key: "persona"
			}))
		],
		{ only: ["id", "name", "avatarMediaId"], avatar: true }
	)

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
	// The last line is the `main` channel's alone (`lastVisibleMessages`): a
	// card every member sees never quotes a private lane.
	const sessionIds = sessionsList.map((s) => s.id)
	const messageCounts = await liveMessageCounts(db, sessionIds)
	// The sessions whose seats may read a member over their card, asked ONCE
	// and handed to both readers below (s27 S2).
	const { sessionsWithMemberWords } = await import(
		"$lib/server/sessions/rowProjection"
	)
	const withMemberWords = await sessionsWithMemberWords(db, sessionIds)
	const lastMessages = new Map<number, Sockets.Sessions.List.LastMessage>()
	if (sessionIds.length > 0) {
		// The last visible line per session, from the projection the
		// `sessions:rowChanged` push reads too (`sessions/rowProjection.ts`):
		// one DISTINCT ON for the whole list, and the same three exclusions
		// on both paths.
		for (const [id, last] of await lastVisibleMessages(db, sessionIds, {
			withMemberWords
		}))
			lastMessages.set(id, last)
	}

	// What each seat's cast member shows over its card (s27 S2): names and
	// faces by seated card id, as `sessions:get` sends them. Read only for
	// the sessions whose seats can differ from their cards.
	const castShown = await seatCastShownForSessions(
		db,
		sessionsList.map((s) => ({
			id: s.id,
			// Character seats, then player seats (★pT-1, 2026-11-05: a
			// player seat reads its member too); a card held by both is
			// the character seat's.
			rows: [
				...s.sessionCharacters.filter((cc) => cc.character !== null),
				...s.sessionPersonas
					.filter((cp) => cp.persona !== null)
					.map((cp) => ({ ...cp, character: cp.persona }))
			]
		})),
		{ withMemberWords }
	)

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
			castNames: castShown.get(session.id)?.castNames ?? {},
			castFaces: castShown.get(session.id)?.castFaces ?? {},
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

/** A seat's card after `putCardsNow` on a read trimmed to ids: its name as the card now has it. */
type SeatCardNames = { id: number; name?: string; nickname?: string | null }

/** `lorebook_bindings` ⏳ frozen content columns — left out of a relational read of bindings. */
const BINDING_FROZEN_OFF = {
	description: false,
	personality: false,
	scenario: false,
	firstMessage: false,
	alternateGreetings: false,
	exampleDialogues: false,
	faceMediaId: false,
	retold: false,
	ownName: false,
	ownNickname: false,
	timbre: false,
	spriteSet: false,
	nodeState: false,
	nodeVisibility: false
} as const

/**
 * 🚧 Put each seat's card as its **current card version** has it (`cardsNow`)
 * over the relational read's card, in place (owner ruling 2026-11-05:
 * "Everything in session is cast -> active card"). The relational read keeps
 * ids, library facts and relations (`spriteSets`); the content columns — which
 * nothing writes any more — come from the version, never from the row. `only`
 * limits what is taken (a trimmed wire shape stays trimmed); `avatar` resolves
 * the `avatarMedia { uuid, rev }` from the version's face, one `files` query
 * for the set. A card the version read does not know is left as it was. Two
 * `cardsNow` queries for any number of seats.
 */
async function putCardsNow(
	groups: { rows: readonly any[]; key: string }[],
	opts: { only?: readonly string[]; avatar?: boolean } = {}
): Promise<void> {
	const ids = groups.flatMap((g) =>
		g.rows.flatMap((row) => {
			const id = row?.[g.key]?.id
			return typeof id === "number" ? [id] : []
		})
	)
	if (!ids.length) return
	const { cardsNow } = await import("$lib/server/cast/seatedCast")
	const now = await cardsNow(db as unknown as Db, ids)
	const faces = new Map<number, { uuid: string; rev: number }>()
	if (opts.avatar) {
		const faceIds = [
			...new Set(
				[...now.values()]
					.map((c) => c.avatarMediaId)
					.filter((id): id is number => id != null)
			)
		]
		if (faceIds.length)
			for (const f of await db
				.select({
					id: schema.files.id,
					uuid: schema.files.uuid,
					rev: schema.files.rev
				})
				.from(schema.files)
				.where(inArray(schema.files.id, faceIds)))
				faces.set(f.id, { uuid: f.uuid, rev: f.rev })
	}
	for (const g of groups)
		for (const row of g.rows) {
			const card = row?.[g.key]
			const fresh = card ? now.get(card.id) : undefined
			if (!fresh) continue
			const taken: Record<string, unknown> = opts.only
				? Object.fromEntries(
						opts.only.map((k) => [k, (fresh as any)[k]])
					)
				: { ...fresh }
			row[g.key] = {
				...card,
				...taken,
				...(opts.avatar
					? {
							avatarMedia:
								faces.get(fresh.avatarMediaId ?? -1) ?? null
						}
					: {})
			}
		}
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
 * A widget's `maxInstances` as `sessions:view` carries it (brief 7b): a
 * positive integer, else nothing — a stored manifest is read as it comes, and
 * a cap that is not one is no cap (the SDK's `widget()` refuses it at build).
 */
function widgetCap(v: unknown): { maxInstances?: number } {
	return typeof v === "number" && Number.isInteger(v) && v > 0 ? { maxInstances: v } : {}
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

/** 🚧 The caller's list re-sent and the session's list row pushed — the pair a new session (create, branch) needs (D6). */
async function relistWithRow(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	sessionId: number
): Promise<void> {
	await relistSessions(socket, emitToUser)
	broadcastSessionRow(socket.io, sessionId)
}

/**
 * 🚧 pr-6 (R-k): the owner and every guest are sent their own `sessions:list`
 * (Archive / Unarchive moves a session between sections for all of them).
 */
export async function relistSessionMembers(io: any, sessionId: number): Promise<void> {
	for (const uid of await getSessionUserIds(sessionId))
		await emitToUserRedacted(io, uid, "sessions:list", () => buildSessionsListFor(uid))
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

/**
 * 🚧 A person interacted with a session (PLAN-layering D7, R11, R21; lane 6): their press of an action or a turn control, a
 * form's answer, a message verb — stamped only when the handler's own access verdict says they may read the session (D9: one
 * access check per handler). Resets its runs-in-a-row count and resumes its crons after a restart. Never throws.
 */
async function noteSocketInteraction(
	access: SessionAccess,
	sessionId: unknown,
	kind: import("$lib/server/pipelines/routines/interaction").InteractionKind
): Promise<void> {
	if (typeof sessionId !== "number" || !Number.isInteger(sessionId)) return
	if (!access.hasAccess) return
	try {
		const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
		await noteInteraction(db, sessionId, kind)
	} catch (err) {
		console.warn(`[sessions] the interaction with session ${sessionId} was not noted:`, err)
	}
}

export const sessionsCreateHandler: Handler<
	Sockets.Sessions.Create.Params,
	Sockets.Sessions.Create.Response
> = {
	event: "sessions:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		// 🚧 (M2c) Opened by an extension's launcher: its grant, its genre and its
		// prefilled fields are judged first, in words. Absent: exactly today.
		if (params.fromApplet) {
			const { appletCreateRefusal } = await import("./appletSessions")
			const refusal = await appletCreateRefusal(db as unknown as Db, userId, params)
			if (refusal) {
				emitToUser("sessions:create:error", { error: refusal })
				return { error: refusal }
			}
		}
		// 🚧 Creation mode (M0, F5): how it starts; absent is `new`. The
		// genre may propose one in the form; the server never refuses a mode
		// because another was proposed.
		const creationMode = params.mode ?? "new"
		const creationModes = await import("$lib/server/sessions/creationModes")
		{
			const refusal = await creationModes.creationModeRefusal(db as unknown as Db, {
				mode: creationMode,
				from: params.from,
				userId
			})
			if (refusal) {
				emitToUser("sessions:create:error", { error: refusal })
				return { error: refusal }
			}
		}
		if (creationMode === "branch") {
			// Forked at the newest live message through what `sessions:branch`
			// runs; the draft's other fields are ignored.
			const forked = await creationModes.branchForCreate(db as unknown as Db, {
				from: params.from!,
				userId,
				io: socket.io
			})
			if ("error" in forked) {
				emitToUser("sessions:create:error", { error: forked.error })
				return { error: forked.error }
			}
			const branchedSession = await getSessionFromDB(forked.sessionId, userId)
			if (!branchedSession) throw new Error("Failed to fetch branched session")
			await relistWithRow(socket, emitToUser, forked.sessionId)
			const branchRes: Sockets.Sessions.Create.Response = { session: branchedSession as any }
			emitToUser("sessions:create", branchRes)
			return branchRes
		}
		if (creationMode === "next-chapter") {
			// The successor reads the same book and line as the session it follows.
			const [followed] = await db
				.select({
					lorebookId: schema.sessions.lorebookId,
					lorebookBranchId: schema.sessions.lorebookBranchId,
					archivedAt: schema.sessions.archivedAt
				})
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.from!))
				.limit(1)
			// 🚧 A session with no book attached keeps its world in its own
			// book (RF fix 2: every session has a world). Its next chapter
			// follows that world: the notes are shared as a lorebook first —
			// what "Share as a lorebook" does by hand — so the old session
			// reads it and the new one attaches it like any other.
			let lorebookId = followed?.lorebookId ?? null
			if (followed && lorebookId == null) {
				const { shareAsLorebook } = await import("$lib/server/lorebooks/ownBook")
				lorebookId = (
					await shareAsLorebook(db as unknown as Db, { sessionId: params.from!, userId })
				).lorebookId
			}
			// The chapter starts where the followed session's story stands
			// (★C2). A session that follows its line is followed by one that
			// follows it too, so only a clock of its own is carried.
			const { sessionStoryNowOf } = await import("$lib/server/state/storyTime")
			const now = followed ? await sessionStoryNowOf(db, params.from!) : null
			const carriedClock =
				now?.from === "session"
					? {
							storyClockYear: now.year,
							storyClockMonth: now.month ?? null,
							storyClockDay: now.day ?? null,
							storyClockHour: now.hour ?? null,
							storyClockMinute: now.minute ?? null
						}
					: {}
			params = {
				...params,
				session: {
					...params.session,
					lorebookId,
					lorebookBranchId: followed?.lorebookBranchId ?? null,
					...carriedClock
				}
			}
		}
		const tags = params.tags || []
		const personaIds = params.personaIds || []
		const characterIds = params.characterIds || []
		// 🚧 Card-less members to seat (plan §34.2), checked against the book below.
		const castMemberIds = [...new Set(params.castMemberIds || [])]
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
		// 🚧 A starter lorebook offered as the lorebook is answered in words below
		// (`kitReadRefusal`), before this access check could say less.
		const { kitReadRefusal, kitRefOf, resolveKit, STARTER_KIT_SENTENCES } =
			await import("$lib/server/lorebooks/starterKits")
		const kitAsBook =
			params.session.lorebookId != null
				? await kitReadRefusal(db as unknown as Db, params.session.lorebookId)
				: null
		if (params.session.lorebookId != null && !kitAsBook && creationMode === "new-world") {
			// A world to copy need only be readable: owner or share recipient.
			const { assertReadableBook, LOREBOOK_NOT_FOUND } = await import("$lib/server/utils/ownedBook")
			await assertReadableBook(db as unknown as Db, userId, params.session.lorebookId, {
				isAdmin: false
			})
			if (await isNewAttachOfDisabledBook(db as unknown as Db, params.session.lorebookId)) throw new Error(LOREBOOK_NOT_FOUND)
		} else if (params.session.lorebookId != null && !kitAsBook) {
			const ownsLorebook = await checkLorebookOwnership(
				params.session.lorebookId,
				userId
			)
			if (!ownsLorebook) {
				throw new Error(
					"Access denied. You can only read a lorebook you own into a session."
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

		// 🚧 Starting from a starter lorebook (PLAN-lorebook-kinds ruling 8): the
		// kit is found now, and copied into the session's notes once the
		// session row exists. A kit is started from, never read as the book.
		if (kitAsBook) return refuse(kitAsBook)
		// 🚧 A surfaced book is read directly by its owner (owner 2026-11-09, "Own:
		// start on; shared: copy"), its session's branches and next chapters;
		// any other start copies it (★B-3).
		if (params.session.lorebookId != null) {
			const { surfacedBookRefusal } = await import("$lib/server/lorebooks/ownBook")
			const surfaced = await surfacedBookRefusal(db as unknown as Db, {
				lorebookId: params.session.lorebookId,
				creationMode,
				userId
			})
			if (surfaced) return refuse(surfaced)
		}
		if (params.starterKit != null && params.session.lorebookId != null)
			return refuse(STARTER_KIT_SENTENCES.kitAndBook)
		if (creationMode === "new-world" && params.starterKit == null && params.session.lorebookId == null)
			return refuse("Choose the world to copy.")
		let startKit: import("$lib/server/lorebooks/starterKits").ResolvedKit | null = null
		if (params.starterKit != null) {
			try {
				startKit = await resolveKit(db as unknown as Db, kitRefOf(params.starterKit))
			} catch (e) {
				return refuse((e as Error).message)
			}
		}

		// Preset resolution (23 §9): when the client starts from a preset, the
		// preset picks the type — the server derives genreId from it (never
		// trusting a client-supplied pair to agree) and refuses presets or
		// types an admin has hidden. An absent settings row means available:
		// types are visible until someone hides them, same as sessionAdmin.
		/** The preset's pre-seated envoys (`defaults.envoys`, R-18), by slug. */
		/** 🚧 A preset may lower the shape's cast floor (`PresetDecl.cast`, 2026-10-19). */
		let presetCastFloor: { characters?: number; personas?: number } | null = null
		/** 🚧 The preset's pinned settings; `rigour` among them is a column, written here. */
		let presetPins: Record<string, unknown> | null = null
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
				presetCastFloor = (preset.castFloor as { characters?: number; personas?: number } | null) ?? null
				// 🚧 A pin's value, read through `SettingValue` (A10).
				presetPins = preset.settings
					? (await import("$lib/server/pipelines/entities/sessionGenres")).presetPinValues(preset.settings)
					: null
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
		/** The genre's name, for a refusal below. */
		let genreName: string | null = null
		/**
		 * 🚧 (M3b, owner 2026-11-05 ★M3-4) The genre's `castFromLorebook`
		 * declaration, its floored shape and its declared fields: what the
		 * book-seats-its-cast step below reads. Null when the genre declares none.
		 */
		let castFromLorebook: { field?: string } | null = null
		let flooredShape: Parameters<
			(typeof import("$lib/server/pipelines/entities/sessionGenres"))["shapeViolations"]
		>[0] | null = null
		let declaredShapeFields: Record<string, { default?: unknown }> = {}
		/**
		 * 🚧 What the session is born with through the exposure cascade (R32,
		 * A10): the genre fields the person may set (a locked one is taken
		 * from its layer, whatever was sent) and the rules it plays — its
		 * ruleset and rigour, fixed at start: the person's answer where open
		 * to them, else the cascade's (Rule Based locks rigour at `scripts`).
		 */
		let atStart: Awaited<ReturnType<typeof import("$lib/server/sessions/exposure").resolveAtStart>> | null = null
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
				const floored = presetCastFloor
					? {
						...mode.shape,
						...(mode.shape.characters && presetCastFloor.characters !== undefined
							? { characters: { ...mode.shape.characters, min: Math.min(mode.shape.characters.min, presetCastFloor.characters) } }
						: {}),
						...(mode.shape.personas && presetCastFloor.personas !== undefined
							? { personas: { ...mode.shape.personas, min: Math.min(mode.shape.personas.min, presetCastFloor.personas) } }
						: {})
					}
					: mode.shape
				const violations = shapeViolations(floored, {
					characters: characterIds.length + castMemberIds.length,
					personas: personaIds.length,
					// A starter lorebook gives the session a world of its own (its notes).
					hasLorebook: params.session.lorebookId != null || startKit != null
				})
				if (violations.length)
					return refuse(
						`This session does not fit '${mode.name}': ${violations.join("; ")}.`
					)
				declaredFieldKeys = Object.keys(
					(mode.shape as any)?.fields ?? {}
				)
				genreName = mode.name
				castFromLorebook =
					(mode.shape as { castFromLorebook?: { field?: string } }).castFromLorebook ?? null
				flooredShape = floored
				declaredShapeFields = ((mode.shape as any)?.fields ?? {}) as Record<
					string,
					{ default?: unknown }
				>
			}
			try {
				const { resolveAtStart } = await import("$lib/server/sessions/exposure")
				const sent = params.session as any
				atStart = await resolveAtStart(db, {
					genreId,
					declared: ((mode?.shape as any)?.fields ?? {}) as Record<string, any>,
					pins: mode?.settings,
					presetId: sent.presetId ?? null,
					asked: {
						...((sent.genreFields ?? {}) as Record<string, unknown>),
						...(typeof sent.primaryRuleset === "string" && sent.primaryRuleset.trim()
							? { ruleset: sent.primaryRuleset.trim() }
							: {}),
						...(typeof sent.rigour === "string" && sent.rigour ? { rigour: sent.rigour } : {})
					},
					isAdmin: !!socket.user!.isAdmin
				})
			} catch (err) {
				console.warn("[sessions:create] the start cascade could not be read; taking what was sent:", err)
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
			// Not a column: a session's sampling pick is its pipeline panel
			// row (Pipelines card › Sampling), so an old client's field is
			// dropped in silence like the two above.
			samplingConfigId: _retiredSessionSampling,
			// Not a column: the session's rebinds of swappable nodes (R40),
			// written once the row exists (below).
			swaps: requestedSwaps,
			// Where the session reads its book is the server's to start
			// (ruling 15, story-time P3): the book's most recently used line,
			// no clock of its own (it follows that line's present) — or what
			// the create names, checked (`sessionLinePatch`).
			lorebookBranchId: requestedBranchId,
			// Branching off at the start: checked below, written only for an own book.
			lineOnFirstWrite: requestedLineOnFirstWrite,
			storyClockYear: requestedClockYear,
			storyClockMonth: requestedClockMonth,
			storyClockDay: requestedClockDay,
			storyClockHour: requestedClockHour,
			storyClockMinute: requestedClockMinute,
			...sessionDataWithoutTags
		} = params.session as Omit<InsertSession, "userId" | "isGroup"> & {
			connectionId?: number | null
			speakerStrategy?: string
			samplingConfigId?: number | null
			swaps?: unknown
		}
		// 🚧 `lineOnFirstWrite` (branch off at a point): only a start on a book of
		// the asker's own, read directly. The owner is read here, before the transaction.
		let startLineOnFirstWrite = false
		if (requestedLineOnFirstWrite === true) {
			let ownDirectBook = false
			if (
				creationMode === "new" &&
				startKit == null &&
				sessionDataWithoutTags.lorebookId != null
			) {
				const [book] = await db
					.select({ userId: schema.lorebooks.userId })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, sessionDataWithoutTags.lorebookId))
					.limit(1)
				ownDirectBook = book?.userId === userId
			}
			if (!ownDirectBook)
				return refuse(
					"Only a lorebook of your own can be branched off at the start. Choose one of yours, or start on its latest line."
				)
			startLineOnFirstWrite = true
		}
		// Field values only under names the mode declares (19 §1) — the same
		// filter runTurn applies at supply, applied at write so the row never
		// carries keys nothing declared.
		;(sessionDataWithoutTags as any).genreFields = Object.fromEntries(
			Object.entries(
				(atStart?.fields ?? (params.session as any).genreFields ?? {}) as Record<
					string,
					unknown
				>
			).filter(([k]) => declaredFieldKeys.includes(k))
		)
		// 🚧 (M3b, owner 2026-11-05 ★M3-4) The book seats its cast, genre-declared:
		// only a genre that declares `castFromLorebook` (its switch field true, or
		// no field) with a book attached. Read here, outside the create transaction.
		let seatedCast: { castMemberId: number; cardId: number | null }[] = []
		if (castFromLorebook && flooredShape && sessionDataWithoutTags.lorebookId != null) {
			const field = castFromLorebook.field
			const stored = field
				? ((sessionDataWithoutTags as any).genreFields as Record<string, unknown>)[field]
				: true
			const on = field ? (stored !== undefined ? stored : declaredShapeFields[field]?.default) === true : true
			if (on) {
				const { bookCastToSeat } = await import("$lib/server/sessions/seatBookCast")
				seatedCast = await bookCastToSeat(db as unknown as Db, {
					lorebookId: sessionDataWithoutTags.lorebookId,
					userId,
					isAdmin: !!socket.user!.isAdmin,
					exclude: new Set([...characterIds, ...personaIds]),
					excludeMembers: new Set(castMemberIds)
				})
			}
			if (seatedCast.length) {
				const { shapeViolations } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const violations = shapeViolations(flooredShape, {
					characters:
						characterIds.length + castMemberIds.length + seatedCast.length,
					personas: personaIds.length,
					hasLorebook: true
				})
				if (violations.length)
					return refuse(
						`This session does not fit '${genreName}': ${violations.join("; ")}.`
					)
			}
		}
		// 🚧 One cast member is one character seat (owner 2026-11-05): two of the
		// picked cards that are one member of the book the session will read are
		// refused in words, before anything is made.
		{
			const twice = await sameMemberRefusal(db as unknown as Db, {
				lorebookId: sessionDataWithoutTags.lorebookId ?? null,
				cardIds: characterIds,
				castMemberIds
			})
			if (twice) return refuse(twice)
		}
		// 🚧 The listed members (plan §34.2) must be members of the book the session
		// will read — not overlay rows. `new-world` reads a copy of the chosen book,
		// whose members have ids of their own, so none listed here is in it.
		if (castMemberIds.length) {
			const book =
				creationMode === "new-world"
					? null
					: (sessionDataWithoutTags.lorebookId ?? null)
			const rows = await db
				.select({
					id: schema.lorebookBindings.id,
					lorebookId: schema.lorebookBindings.lorebookId,
					overlayOf: schema.lorebookBindings.overlayOf,
					name: schema.lorebookBindings.name
				})
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.id, castMemberIds))
			const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
			const nameOf = async (id: number, fallback: string) =>
				(await membersAsRead(db as unknown as Db, [id], {})).get(id)?.shownName?.trim() ||
				fallback.trim() ||
				"That person"
			for (const id of castMemberIds) {
				const row = rows.find((r) => r.id === id)
				if (!row) return refuse(SEAT_REFUSALS.memberGone())
				if (row.overlayOf != null)
					return refuse(SEAT_REFUSALS.overlayRow(await nameOf(row.overlayOf, row.name)))
				if (book == null || row.lorebookId !== book)
					return refuse(SEAT_REFUSALS.outsideBooks(await nameOf(row.id, row.name)))
			}
		}
		// 🚧 Speech: the narrator voice is checked at every write, not only
		// through the settings form (lane V finding V-3, 2026-10-28).
		{
			const { SPEECH_FIELD_KEYS } = await import("$lib/shared/sessions/speechSettings")
			const voice = ((sessionDataWithoutTags as any).genreFields as Record<string, unknown>)[
				SPEECH_FIELD_KEYS.narratorVoice
			]
			if (voice !== undefined) {
				const { narratorVoiceRefusal } = await import("$lib/server/speech/narratorVoiceCheck")
				const refusal = await narratorVoiceRefusal(db, voice)
				if (refusal) throw new Error(refusal)
			}
		}

		// 🚧 Rulesets (PLAN-rulesets §4, §13, §21, §28): a session attached to
		// a lorebook at creation ADOPTS its ruleset and version, whatever the client sent — refused, with the reason, when the
		// genre plays only rulesets (`rulesets.only`) the lorebook's is not
		// among. With no lorebook: the client's pick when it is a registered
		// ruleset the genre allows, else the genre's default (only's first,
		// recommended's `default`), else Story. How strict: the client's pick
		// among the genre's rigour options, else the genre's default (absent,
		// `prose`). On revision: a valid value, else the owner's default, else
		// the instance's.
		{
			const data = sessionDataWithoutTags as any
			const { getGenre, getRuleset } = await import("@serene-pub/sdk")
			const { STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const rulesGenreId: string = (params.session as any).genreId ?? STANDARD_GENRE_ID
			const genre = getGenre(rulesGenreId)
			const declared = genre?.rulesets
			const strict = declared && "only" in declared ? declared.only : null
			const genreDefault = declared
				? "only" in declared
					? declared.only[0]
					: declared.default
				: undefined
			// 🚧 A book's (or a kit's) own rules are adopted; one on Freeform,
			// every book's default, brings none, and the session's own Rules
			// stand below (fix7, 2026-10-23; `adoptedBookRules`).
			const { adoptedBookRules } = await import("$lib/shared/rulesets/rulesOffer")
			const { strictRulesRefusal, rulesetIncompatibleRefusal } = await import(
				"$lib/server/rulesets/bookRules"
			)
			let adopted = false
			if (startKit) {
				// The kit's Rules, held to the genre's as a book's are.
				const { kitRules } = await import("$lib/server/lorebooks/starterKits")
				const rules = kitRules(startKit)
				if (adoptedBookRules(rules.primaryRuleset)) {
					// 🚧 `only`, then Incompatible rules (owner 2026-11-05); a next chapter is never re-judged.
					const kitRefusal = strictRulesRefusal(
						rulesGenreId,
						{ name: startKit.name, primaryRuleset: rules.primaryRuleset },
						{ starter: true, nextChapter: creationMode === "next-chapter" }
					)
					if (kitRefusal) return refuse(kitRefusal)
					data.primaryRuleset = rules.primaryRuleset
					data.rulesetVersion = rules.rulesetVersion
					adopted = true
				}
			} else if (data.lorebookId != null) {
				const [book] = await db
					.select({
						name: schema.lorebooks.name,
						primaryRuleset: schema.lorebooks.primaryRuleset,
						rulesetVersion: schema.lorebooks.rulesetVersion
					})
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, data.lorebookId))
					.limit(1)
				if (book && adoptedBookRules(book.primaryRuleset)) {
					const bookRefusal = strictRulesRefusal(rulesGenreId, book, {
						nextChapter: creationMode === "next-chapter"
					})
					if (bookRefusal) return refuse(bookRefusal)
					data.primaryRuleset = book.primaryRuleset
					data.rulesetVersion = book.rulesetVersion
					adopted = true
				}
			}
			if (!adopted) {
				// 🚧 A preset's ruleset is a default, never a lock (owner 2026-11-05, R32
				// amended for rulesets): the person's pick wins; Incompatible rules are
				// refused (never swapped), except for a next chapter.
				const validRuleset = (id: string) =>
					!!getRuleset(id) && (!strict || strict.includes(id))
				const picked =
					typeof data.primaryRuleset === "string" && validRuleset(data.primaryRuleset.trim())
						? data.primaryRuleset.trim()
						: null
				if (picked && creationMode !== "next-chapter") {
					const incompatible = rulesetIncompatibleRefusal(rulesGenreId, picked)
					if (incompatible) return refuse(incompatible)
				}
				// Nothing valid sent: the cascade's value (the preset's, even one stored with
				// `lock`) unless the genre can't play it, which falls through silently.
				const cascaded =
					typeof atStart?.rules.ruleset === "string" &&
					validRuleset(atStart.rules.ruleset) &&
					!rulesetIncompatibleRefusal(rulesGenreId, atStart.rules.ruleset)
						? atStart.rules.ruleset
						: null
				data.primaryRuleset = picked ?? cascaded ?? genreDefault ?? "core:ruleset/freeform@1"
			}
			// 🚧 Pinned to the version it starts on when nothing adopted pins one (a genre's or preset's pick, or a book
			// that carries none): a pub or package ruleset's published version, so "Update rules" and a conversion work
			// (M0 E-fix). A ruleset declared in code has no version and stays unpinned.
			if (data.rulesetVersion == null && typeof data.primaryRuleset === "string") {
				const { publishedRulesetVersion } = await import("$lib/server/rulesets/pubRulesets")
				data.rulesetVersion = await publishedRulesetVersion(db, data.primaryRuleset)
			}
			const rigourOptions: readonly string[] = genre?.rigour?.options ?? ["prose"]
			// 🚧 R32: rigour is fixed at start, through the cascade — the
			// person's pick where it is open to them, a layer's where one
			// locked it (Rule Based locks `scripts`), else the preset's or the
			// genre's value.
			if (atStart && typeof atStart.rules.rigour === "string") data.rigour = atStart.rules.rigour
			else if (typeof presetPins?.rigour === "string" && (data.rigour == null || data.rigour === "") && rigourOptions.includes(presetPins.rigour))
				data.rigour = presetPins.rigour
			if (!rigourOptions.includes(data.rigour))
				data.rigour = genre?.rigour?.default ?? "prose"
			// 🚧 Rules that decide nothing (Story) play Words only (2026-10-18,
			// the 100-turn walk #26): the form offers nothing else, and a
			// request that names another How strict is answered with it.
			{
				const { rigoursPlayed } = await import("$lib/shared/rulesets/rulesOffer")
				const { rulesetDecides } = await import("$lib/server/rulesets/methods")
				const played = rigoursPlayed(rulesetDecides(getRuleset(String(data.primaryRuleset ?? ""))), rigourOptions)
				if (played && !played.includes(data.rigour)) data.rigour = played[0]!
			}
			const { isOnRevision, onRevisionDefaultFor } = await import(
				"$lib/server/sessions/revision"
			)
			if (!isOnRevision(data.onRevision))
				data.onRevision = await onRevisionDefaultFor(db, userId)
		}

		// The clock is checked and the row written in one transaction, under
		// the book's calendar lock (`sessionLinePatch`).
		let kitCopy: import("$lib/server/lorebooks/starterKits").KitCopy | null = null
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		// 🚧 `next-chapter`: the session it follows is closed out first, unless
		// archived. Nothing to close out is not a refusal; any other is.
		if (creationMode === "next-chapter") {
			const [followed] = await db
				.select({ archivedAt: schema.sessions.archivedAt })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.from!))
				.limit(1)
			if (!followed?.archivedAt) {
				const { closeOutSession } = await import("./sessionArchive")
				const { CLOSE_OUT_REFUSALS } = await import("$lib/shared/sessions/archive")
				const closed = await closeOutSession({ sessionId: params.from!, userId, emitToUser })
				if ("refused" in closed && closed.refused !== CLOSE_OUT_REFUSALS.nothing)
					return refuse(closed.refused)
			}
		}
		const newSession = await db.transaction(async (tx) => {
			// 🚧 `new-world`: the session starts on a COPY of the world it chose
			// (named "<source name> (copy)"), never on the source itself. The
			// copy has lines of its own, so the draft's line is not carried.
			let worldId = sessionDataWithoutTags.lorebookId ?? null
			let worldBranchId = requestedBranchId
			if (creationMode === "new-world" && worldId != null) {
				const { duplicateLorebookRows } = await import("$lib/server/utils/lorebookDuplicate")
				const [source] = await tx
					.select({ name: schema.lorebooks.name })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, worldId))
					.limit(1)
				const copy = await duplicateLorebookRows(tx, worldId, userId, `${source?.name ?? "World"} (copy)`)
				worldId = copy.id
				worldBranchId = undefined
			}
			const sessionData: InsertSession = {
				...sessionDataWithoutTags,
				...(startLineOnFirstWrite ? { lineOnFirstWrite: true } : {}),
				...(worldId !== (sessionDataWithoutTags.lorebookId ?? null) ? { lorebookId: worldId } : {}),
				...(await sessionLinePatch(tx, {
					before: null,
					lorebookId: worldId,
					lorebookBranchId: worldBranchId,
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
				isGroup: characterIds.length + castMemberIds.length + seatedCast.length > 1
			}
			const [row] = await tx
				.insert(schema.sessions)
				.values(sessionData)
				.returning()
			// 🚧 Every session owns a book from its birth (pr-6, pass 11): the
			// kit copy below when there is a kit, else a fresh one, Gregorian with
			// its clock unset (`insertOwnBook`).
			if (!startKit)
				await insertOwnBook(tx as unknown as Db, {
					sessionId: row.id,
					userId,
					name: row.name,
					overlayOf: row.lorebookId ?? null,
					primaryRuleset: row.primaryRuleset,
					rulesetVersion: row.rulesetVersion ?? null
				})
			// 🚧 The kit, copied into the session's own book (the one
			// `ownBookFor` would make: the session's name, owner and
			// Rules, overlaying nothing) — with the session, or not at all.
			if (startKit) {
				const { bookFromKit } = await import("$lib/server/lorebooks/starterKits")
				kitCopy = await bookFromKit(tx, startKit, {
					userId,
					name: row.name?.trim() || "Untitled session",
					kind: "book",
					sessionId: row.id
				})
				await tx
					.update(schema.lorebooks)
					.set({ primaryRuleset: row.primaryRuleset, rulesetVersion: row.rulesetVersion })
					.where(eq(schema.lorebooks.id, kitCopy.lorebookId))
			}
			return row
		})
		// Assigned inside the transaction's callback, which narrowing cannot see.
		const madeFromKit = kitCopy as import("$lib/server/lorebooks/starterKits").KitCopy | null
		if (madeFromKit) {
			const { afterKitCopy } = await import("$lib/server/lorebooks/starterKits")
			await afterKitCopy(
				madeFromKit,
				userId,
				socket.user?.displayName || socket.user?.username || ""
			)
		}
		// Creating until its create run is over (`sessions/creating.ts`): the
		// window in which the create pipeline's settings still apply to it.
		const { markCreating, markCreated } = await import(
			"$lib/server/sessions/creating"
		)
		markCreating(newSession.id)

		// 🚧 `next-chapter`: the chapter's first message, ahead of whatever the
		// genre's create pipeline writes, is the anchor the carried state is
		// filed against. An ordinary system line: the viewer may Hide it.
		let chapterAnchorId: number | null = null
		if (creationMode === "next-chapter") {
			const { insertLegacy } = await import("$lib/server/messages/store")
			chapterAnchorId = (
				await insertLegacy(db as unknown as Db, {
					userId,
					sessionId: newSession.id,
					personaId: null,
					characterId: null,
					role: "system",
					channel: "main",
					content: "Chapter begins.",
					isGenerating: false
				})
			).id
		}

		// Process tags after session creation
		if (tags.length > 0) {
			await processSessionTags(newSession.id, tags, userId)
		}

		// The seats, through the one seat writer (`sessions/seats.ts`): personas,
		// the picked characters, then the book's seated cast — in one transaction.
		// `settleSeats` (fill-only: it never departs a seat) fills what the
		// pre-check (which saw only the attached book) could not.
		let seatsMinted = false
		const mintedMembers: MintedSeatMember[] = []
		// A seat the writer refuses (a listed member the pre-check above could not
		// see is outside the session's books) aborts the seats in its own words.
		const refusedSeat: { sentence?: string } = {}
		try {
			await db.transaction(async (tx) => {
				const tdb = tx as unknown as Db
				for (const [i, personaId] of personaIds.entries()) {
					const seat = await seatPlayer(tdb, {
						sessionId: newSession.id,
						personaId,
						position: i
					})
					if (seat.minted) seatsMinted = true
					mintedMembers.push(...seat.mintedMembers)
				}
				for (const characterId of characterIds) {
					const seat = await seatCast(tdb, {
						sessionId: newSession.id,
						cardId: characterId,
						position: characterPositions[characterId] || 0,
						secondCard: "allow",
						seatedBy: userId
					})
					if (seat.ok && seat.minted) seatsMinted = true
					if (seat.ok) mintedMembers.push(...seat.mintedMembers)
				}
				// 🚧 The listed card-less members (plan §34.2), after the picked cards.
				const afterCards = characterIds.length
					? Math.max(...characterIds.map((id) => characterPositions[id] || 0)) + 1
					: 0
				for (const [i, castMemberId] of castMemberIds.entries()) {
					const seat = await seatCast(tdb, {
						sessionId: newSession.id,
						castMemberId,
						position: afterCards + i,
						secondCard: "allow",
						seatedBy: userId
					})
					if (!seat.ok) {
						refusedSeat.sentence = seat.refusal
						throw new Error(seat.refusal)
					}
					if (seat.minted) seatsMinted = true
					mintedMembers.push(...seat.mintedMembers)
				}
				// 🚧 (M3b) The book's seated cast (computed above from the book, never taken
				// from the request, so no ownership check): after the picked ones, in book
				// order, by member. `new-world` reads a copy of the book whose members have
				// new ids: a carded member is seated by its card there (the copy has the
				// card's member), a card-less one has no id to seat by and is not seated.
				const afterMembers = afterCards + castMemberIds.length
				for (const [i, { castMemberId, cardId }] of seatedCast.entries()) {
					if (creationMode === "new-world" && cardId == null) continue
					const seat = await seatCast(
						tdb,
						creationMode === "new-world"
							? {
									sessionId: newSession.id,
									cardId,
									position: afterMembers + i,
									secondCard: "allow",
									seatedBy: userId
								}
							: {
									sessionId: newSession.id,
									castMemberId,
									position: afterMembers + i,
									secondCard: "allow",
									seatedBy: userId
								}
					)
					if (!seat.ok) {
						refusedSeat.sentence = seat.refusal
						throw new Error(seat.refusal)
					}
					if (seat.minted) seatsMinted = true
					mintedMembers.push(...seat.mintedMembers)
				}
				const settled = await settleSeats(tdb, newSession.id)
				if (settled.minted > 0) seatsMinted = true
				mintedMembers.push(...settled.mintedMembers)
			})
		} catch (err) {
			if (refusedSeat.sentence === undefined) throw err
			// The session row is already written: take it back with the refusal.
			await db.delete(schema.sessions).where(eq(schema.sessions.id, newSession.id))
			markCreated(newSession.id)
			// The create had committed more than the row: its own book (or kit
			// copy) and, for a new world, the world's copy. Take them back too,
			// each best-effort on its own; the boot sweep is the own book's
			// backstop (the world copy has none).
			try {
				const { purgeOwnBookOf } = await import(
					"$lib/server/lorebooks/ownBook"
				)
				await purgeOwnBookOf(db, newSession.id)
			} catch (e) {
				console.warn(
					"[sessions:create] the refused session's own book was not taken back:",
					e
				)
			}
			const worldCopyId = newSession.lorebookId
			if (creationMode === "new-world" && worldCopyId != null)
				try {
					const { purgeLorebook } = await import(
						"$lib/server/lorebooks/tableRegistry"
					)
					await db.transaction(async (tx) => {
						await purgeLorebook(tx as unknown as Db, worldCopyId)
						await tx
							.delete(schema.lorebooks)
							.where(eq(schema.lorebooks.id, worldCopyId))
					})
				} catch (e) {
					console.warn(
						"[sessions:create] the refused session's world copy was not taken back:",
						e
					)
				}
			return refuse(refusedSeat.sentence)
		}
		// Committed: the names of the members just made come from their cards.
		await syncMintedSeatMembers(db, mintedMembers)
		// Attaching a character as a voice IS the user saying they play
		// it — see markCharacterAsPersona, the one writer of that flag.
		for (const personaId of personaIds) await markCharacterAsPersona(personaId)
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
				emitToUser,
				{ minted: seatsMinted }
			).catch(console.error)
		}

		// 🚧 `next-chapter`: what the old session declared `nextChapter: true`
		// follows the player, in one write anchored to the chapter's first message — before the create
		// pipeline, while that row is still the newest and so still open to a write.
		if (creationMode === "next-chapter")
			await creationModes.seedNextChapter(db as unknown as Db, {
				fromSessionId: params.from!,
				sessionId: newSession.id,
				userId,
				anchorMessageId: chapterAnchorId!
			})

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
				lorebookId: newSession.lorebookId ?? null
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
		} finally {
			markCreated(newSession.id)
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

		// Fetch the complete session with messages
		const resSession = await getSessionFromDB(newSession.id, userId)
		if (!resSession) throw new Error("Failed to fetch created session")

		// Refresh session list — awaited, and ahead of the reply that names the
		// new session, so a client resolving the new row out of the list has it
		// in hand by then. See `relistSessions` for why it is lazy. A seeded
		// greeting is the new session's first quoted line; the row push is how
		// a guest's sidebar and the home page's cards hear about it.
		await relistWithRow(socket, emitToUser, newSession.id)
		{
			const { relistSessionNotes } = await import("./lorebooks")
			relistSessionNotes(socket, emitToUser)
		}
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
	/**
	 * The rows relation: `{ limit?, beforeId? }` reads it as today (`{}` = every
	 * live row); `"none"` leaves it out and returns `sessionMessages: []`.
	 */
	rows: { limit?: number; beforeId?: number } | "none" = {},
	/**
	 * 🚧 `false` reads every lane whoever asks — for the whole-session push,
	 * which `broadcastToSessionUsers` narrows per member
	 * (`channels/lanePush.ts`). Otherwise the asker's view: a personal lane
	 * that is not theirs is left out, inside the query, before the limit.
	 */
	laneFilter = true
) {
	// Check if user has access (owner or guest)
	const sessionAccess = await checkSessionAccess(sessionId, userId)
	if (!sessionAccess.hasAccess) {
		return null
	}
	const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
	const laneView = laneFilter ? await laneViewFor(db, sessionId, userId) : null
	const limit = rows === "none" ? undefined : rows.limit
	const beforeId = rows === "none" ? undefined : rows.beforeId

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
			...(rows === "none"
				? {}
				: {
						sessionMessages: {
							where: (cm: any) =>
								and(
									beforeId != null ? lt(cm.id, beforeId) : undefined,
									laneViewWhere(cm.channel, laneView),
									// 🚧 The live history (RF fix 5): a row Back took out
									// never reaches a page.
									liveMessageWhere(cm.rewindOrdinal)
								)!,
							orderBy: (cm: any, { desc }: any) => desc(cm.id),
							limit: limit
						}
					}),
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
		// `sessions:get` as `userDraft`. Nor core's runtime columns: read
		// marks are every member's, and a deck's state lets a player work out
		// the next card.
		columns: {
			annex: false,
			annexAudiences: false,
			drafts: false,
			turnOrder: false,
			turnTally: false,
			laneReads: false,
			rulesetDecks: false
		}
	})

	// Drizzle may not properly handle orderby,
	// Lets sort it manually
	const session = await res
	if (session) {
		// 🚧 Each seat's card as its current card version has it (the row's
		// content columns are stale); the same shape goes to the client.
		await putCardsNow(
			[
				{ rows: session.sessionCharacters, key: "character" },
				{ rows: session.sessionPersonas, key: "persona" }
			],
			{ avatar: true }
		)
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
		const sessionMessages: (typeof schema.sessionMessages.$inferSelect)[] = (
			(session as any).sessionMessages ?? []
		).sort((a: any, b: any) => a.id - b.id)

		// Transform session tags to include tags as string array
		const sessionWithTags = {
			...session,
			sessionMessages,
			// 🚧 pr-6 R-k: an archived session's composers are all closed — overlaid here, never stored.
			composerStates: withSessionArchiveClosure(
				readComposerStates((session as any).composerStates),
				(session as any).archivedAt
			),
			tags: session.sessionTags?.map((ct) => ct.tag.name) || [],
			// 🚧 The Back · Forward strip's state (RF fix 5,
			// `SessionDossierV1.rewind`): the same for every viewer.
			rewind: await (await import("$lib/server/sessions/rewind")).rewindStateOf(db, sessionId),
			// 🚧 Speech polish: whether a speaking pair exists (a boolean + one
			// sentence; `SessionDossierV1.speech`) — the speak icons' reason.
			speech: await (await import("$lib/server/speech/voicebank")).speechAvailability(db),
			// 🚧 pr-6 (D R-B5): the settle line.
			settledLine: await (await import("$lib/server/sessions/settle")).settledLineOf(db, sessionId),
			// 🚧 pr-6 (B §B-3): the session's own book, or null.
			ownBookId:
				(
					await db
						.select({ id: schema.lorebooks.id })
						.from(schema.lorebooks)
						.where(eq(schema.lorebooks.sessionId, sessionId))
						.limit(1)
				)[0]?.id ?? null
		}
		return sessionWithTags
	}
	return session
}

// Returns complete session data for prompt compilation
/** Exported for tests. */
export async function getPromptSessionFromDb(
	sessionId: number,
	userId: number
) {
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
			// 🚧 Live player seats, benched ones too (owner 2026-11-10): a
			// benched seat is out of play for the prompt, which `promptFields`
			// and the lore gate decide with `inPlay` — but a benched persona's
			// past lines still need its name (`SessionMessageProcessor`,
			// `ragQuery` read these rows), so the read keeps them, as it does
			// the character seats above.
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
					// The binding's frozen content columns (⏳, nothing writes
					// them) are never loaded: what a reader needs of a member's
					// words comes from its card now (`putCardsNow` below).
					lorebookBindings: {
						columns: BINDING_FROZEN_OFF,
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
					// Not an envoy's departed row (an envoy's seat is never a
					// character seat here); a card-less seat's row has no card.
					where: (cc, { eq, and, isNotNull, isNull }) =>
						and(
							eq(cc.sessionId, sessionId),
							isNotNull(cc.removedAt),
							isNull(cc.envoySlug)
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
		// 🚧 Every card as its current card version has it, before a member
		// is read over it (the rows' content columns are stale): live seats,
		// departed seats and the book's roster, one read.
		await putCardsNow([
			{ rows: session.sessionCharacters, key: "character" },
			{ rows: session.sessionPersonas, key: "persona" },
			{ rows: removedSessionCharacters, key: "character" },
			{ rows: removedSessionPersonas, key: "persona" },
			{ rows: session.lorebook?.lorebookBindings ?? [], key: "character" }
		])

		// 🚧 (seat-cast S2) A seated character is read as the cast member
		// their seat seats — the member's own name and retold text over the
		// member's active card (owner 2026-11-05) — so every prompt reader of these rows (and the
		// adapter session derived from them) names and quotes the member, not
		// the card. Live and departed seats alike: a departed seat's name
		// still labels the transcript. A player seat's card is read the same
		// way (★pT-1, 2026-11-05: "Everything in session is cast -> active
		// card"); its `seatName` stays on the row, beside the card.
		const { seatCardsAsRead } = await import(
			"$lib/server/pipelines/prompt/seatCards"
		)
		const personasAsRead = async <
			P extends { persona: object | null; castMemberId: number | null }
		>(
			rows: P[]
		): Promise<P[]> =>
			(
				await seatCardsAsRead(
					db,
					sessionId,
					rows.map((cp) => ({ ...cp, character: cp.persona }))
				)
			).map(({ character, ...cp }) => ({ ...cp, persona: character }) as unknown as P)
		// `{ cardless: true }`: a card-less character seat reads its member's own
		// fields as a card-shaped row with no `id` (`cardlessSeatCard`); the
		// player seats above never take it.
		session.sessionCharacters = await seatCardsAsRead(
			db,
			sessionId,
			session.sessionCharacters,
			{ cardless: true }
		)
		;(session as any).removedSessionCharacters = await seatCardsAsRead(
			db,
			sessionId,
			removedSessionCharacters,
			{ cardless: true }
		)
		session.sessionPersonas = await personasAsRead(session.sessionPersonas)
		;(session as any).removedSessionPersonas =
			await personasAsRead(removedSessionPersonas)
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
				if (outcome === "err" || outcome === "halt") {
					if (receipt) {
						const { haltExplanation } = await import(
							"$lib/server/pipelines/runtime/runTurn"
						)
						explanation =
							haltExplanation(receipt) ?? "The run produced nothing."
					} else explanation = "The run produced nothing."
				}
				// The step it halted at, by its heading (2026-10-16).
				const haltStep =
					outcome === "halt" && receipt?.haltNodeKey
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
					...(outcome === "halt" && receipt?.haltNodeKey
						? { haltNodeKey: receipt.haltNodeKey }
						: {}),
					...(haltStep ? { haltStep } : {})
				})
				/**
				 * 🚧 M2a a6: the run a press started has ended — told to every
				 * member's page, so the session's widget bus can say
				 * `run:ended` to the frames (the client half, widgetWire). The
				 * outcome in the receipt's words; `reason` the sentence the
				 * terminal frame just carried (a halt's or an error's).
				 */
				{
					const { broadcastToSessionUsers } = await import("$lib/server/sockets/utils/broadcastHelpers")
					await broadcastToSessionUsers(socket.io, params.sessionId, "sessions:runEnded", {
						sessionId: params.sessionId,
						runId,
						outcome,
						...(explanation !== undefined ? { reason: explanation } : {})
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
						haltExplanation(receipt) ?? "The run produced nothing.",
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
		if (access.hasAccess) {
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
				genreFields: schema.sessions.genreFields,
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
		const fields = { ...((session.genreFields ?? {}) as Record<string, unknown>) }
		for (const k of ["tasks", "tools"]) delete fields[k]
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
		await db
			.update(schema.sessions)
			.set({ presetId: preset.id, genreFields: fields, ...(rigour ? { rigour: rigour as any } : {}) })
			.where(eq(schema.sessions.id, params.sessionId))
		;(await import("$lib/server/pipelines/registrations/resolve")).invalidateRegistrations()
		// 🚧 An owner's setting change is an interaction (R11, R21; lane 6).
		{
			const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
			await noteInteraction(db, params.sessionId, "setting")
		}
		const res = reply({ sessionId: params.sessionId, presetId: preset.id, presetName: preset.name })
		await pushSessionToParticipants(socket.io, params.sessionId, userId)
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
 * `sessionGenreOf` for many sessions in one read: id → genre, by the same
 * rule (no genre is Chat). A missing session is absent from the map. For the
 * layout-list push (`sessions/startedFromPush.ts`), which has the sessions
 * people have open and needs those of one genre.
 */
export async function sessionGenres(
	sessionIds: readonly number[]
): Promise<Map<number, string>> {
	const out = new Map<number, string>()
	if (!sessionIds.length) return out
	const rows = await db
		.select({ id: schema.sessions.id, genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(inArray(schema.sessions.id, [...sessionIds]))
	for (const row of rows) out.set(row.id, row.genreId ?? "core:genre/story")
	return out
}

/**
 * The first open (the copy model, brief 3 of `PLAN-layout-one-format-2026-09-28`):
 * a person with no layout row for this session gets a COPY of their
 * new-session layout for the genre, else of the genre default layout, else an
 * empty one (`resolveNewSessionLayout`, `copyLayoutIntoSession`). One
 * transaction, and the insert does nothing on a conflict, so two tabs opening
 * the session at once make one row. A session's layout is its own from here
 * on: nothing is layered over it at read time.
 */
async function copyLayoutOnFirstOpen(
	sessionId: number,
	userId: number,
	genreId: string,
	/** 🚧 A guest of the session gets the genre's guests' layout, when it ships one (D6). */
	guest = false
): Promise<void> {
	const mine = and(
		eq(schema.sessionPanelLayouts.sessionId, sessionId),
		eq(schema.sessionPanelLayouts.userId, userId)
	)
	// Every open but the first finds its row here, without taking a
	// transaction (PGlite has one connection; a transaction holds it).
	const [seen] = await db
		.select({ id: schema.sessionPanelLayouts.id })
		.from(schema.sessionPanelLayouts)
		.where(mine)
		.limit(1)
	if (seen) return
	await db.transaction(async (tx) => {
		const [had] = await tx
			.select({ id: schema.sessionPanelLayouts.id })
			.from(schema.sessionPanelLayouts)
			.where(mine)
			.limit(1)
		if (had) return
		await copyLayoutIntoSession(tx, {
			sessionId,
			userId,
			genreId,
			layoutPresetId: await resolveNewSessionLayout(tx, userId, genreId, { guest }),
			onlyIfAbsent: true
		})
	})
}

/**
 * The caller's whole session layout for a session, as `:get` and `:startFrom`
 * both answer it: the row's layout, its provenance and whether that source
 * was **Updated** since, the style pins, the widget settings, and the list the
 * editor offers. A stranger to the session gets the empty answer.
 */
async function panelLayoutAnswer(
	sessionId: number,
	userId: number,
	hasAccess: boolean
): Promise<Sockets.Sessions.PanelLayout.Get.Response> {
	const answer: Sockets.Sessions.PanelLayout.Get.Response = {
		sessionId,
		layout: {},
		startedFromLayoutPresetId: null,
		layoutCopiedAt: null,
		startedFromUpdated: false,
		layoutSettings: {},
		widgetSettings: {},
		presets: []
	}
	if (!hasAccess) return answer
	const [row] = await db
		.select({
			layout: schema.sessionPanelLayouts.layout,
			startedFromLayoutPresetId:
				schema.sessionPanelLayouts.startedFromLayoutPresetId,
			layoutCopiedAt: schema.sessionPanelLayouts.layoutCopiedAt,
			layoutSettings: schema.sessionPanelLayouts.layoutSettings
		})
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, sessionId),
				eq(schema.sessionPanelLayouts.userId, userId)
			)
		)
		.limit(1)
	if (row?.layout && typeof row.layout === "object")
		answer.layout = row.layout as Record<string, unknown>
	if (row?.layoutSettings && typeof row.layoutSettings === "object")
		answer.layoutSettings = row.layoutSettings as Record<string, unknown>
	answer.startedFromLayoutPresetId = row?.startedFromLayoutPresetId ?? null
	answer.layoutCopiedAt = row?.layoutCopiedAt
		? row.layoutCopiedAt.toISOString()
		: null
	answer.widgetSettings = await readWidgetSettings(sessionId, userId)
	answer.presets = await listLayoutPresets(await sessionGenreOf(db, sessionId), userId)
	answer.startedFromUpdated = startedFromUpdated(
		answer.presets.find((p) => p.id === answer.startedFromLayoutPresetId),
		row?.layoutCopiedAt ?? null
	)
	return answer
}

/**
 * What `sessions:panelLayout:startedFromUpdated` carries (brief 6b): the
 * **started from** half of `:get`'s answer — the provenance, the **Updated**
 * flag and the refreshed list the editor's pane draws from — for one person
 * on one session. Pushed when a layout it started from moved (built only for
 * a socket that holds the session's scope, `sessions/startedFromPush.ts`),
 * and answered when a page asks. Null for a person who is not in the
 * session: there is nothing of theirs to label.
 */
export async function startedFromUpdatedAnswer(
	sessionId: number,
	userId: number
): Promise<Sockets.Sessions.PanelLayout.StartedFromUpdated.Response | null> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess) return null
	const [row] = await db
		.select({
			startedFromLayoutPresetId:
				schema.sessionPanelLayouts.startedFromLayoutPresetId,
			layoutCopiedAt: schema.sessionPanelLayouts.layoutCopiedAt
		})
		.from(schema.sessionPanelLayouts)
		.where(
			and(
				eq(schema.sessionPanelLayouts.sessionId, sessionId),
				eq(schema.sessionPanelLayouts.userId, userId)
			)
		)
		.limit(1)
	const presets = await listLayoutPresets(await sessionGenreOf(db, sessionId), userId)
	const startedFromLayoutPresetId = row?.startedFromLayoutPresetId ?? null
	return {
		sessionId,
		startedFromLayoutPresetId,
		layoutCopiedAt: row?.layoutCopiedAt ? row.layoutCopiedAt.toISOString() : null,
		startedFromUpdated: startedFromUpdated(
			presets.find((p) => p.id === startedFromLayoutPresetId),
			row?.layoutCopiedAt ?? null
		),
		presets
	}
}

/**
 * Ask for the **started from** facts again (brief 6b): what the push
 * carries, for the caller. The page asks after a refused _Save changes to_
 * — the news that the layout changed may not have reached this tab — so the
 * next ask warns. A stranger to the session gets the empty answer.
 */
export const sessionsPanelLayoutStartedFromUpdatedHandler: Handler<
	Sockets.Sessions.PanelLayout.StartedFromUpdated.Params,
	Sockets.Sessions.PanelLayout.StartedFromUpdated.Response
> = {
	event: "sessions:panelLayout:startedFromUpdated",
	handler: async (socket, params, emitToUser) => {
		const sessionId = Number(params?.sessionId)
		const res = (Number.isInteger(sessionId)
			? await startedFromUpdatedAnswer(sessionId, socket.user!.id)
			: null) ?? {
			sessionId,
			startedFromLayoutPresetId: null,
			layoutCopiedAt: null,
			startedFromUpdated: false,
			presets: []
		}
		emitToUser("sessions:panelLayout:startedFromUpdated", res)
		return res
	}
}

/**
 * Read the caller's session layout for a session (21 §10; the copy model).
 * A first open copies one in (`copyLayoutOnFirstOpen`), so the answer is
 * always the person's own whole layout — never a delta over a base.
 * Access-gated like every other session read.
 */
export const sessionsPanelLayoutGetHandler: Handler<
	Sockets.Sessions.PanelLayout.Get.Params,
	Sockets.Sessions.PanelLayout.Get.Response
> = {
	event: "sessions:panelLayout:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (access.hasAccess)
			await copyLayoutOnFirstOpen(
				params.sessionId,
				userId,
				await sessionGenreOf(db, params.sessionId),
				!access.isOwner
			)
		const res = await panelLayoutAnswer(
			params.sessionId,
			userId,
			access.hasAccess
		)
		emitToUser("sessions:panelLayout:get", res)
		return res
	}
}

/** The page size a widget's `messages` ask is clamped into. */
const MESSAGES_PAGE_LIMIT = { min: 1, max: 100, default: 25 } as const

/**
 * 🚧 One page of the session's lines for ONE widget (the `messages` widget
 * request; D7 ruling A, 2026-10-11). Newest-first before `beforeId`, in one
 * channel when asked (a bare slug is the whole channel, every lane; `slug:n`
 * one lane), clamped to {@link MESSAGES_PAGE_LIMIT}. Each widget pages its
 * own window; the conversation's window is never touched. One more row than
 * asked is read to know whether an older page exists. Access as `sessions:get`.
 */
export const sessionsMessagesPageHandler: Handler<
	Sockets.Sessions.MessagesPage.Params,
	Sockets.Sessions.MessagesPage.Response
> = {
	event: "sessions:messagesPage",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const requestId = typeof params?.requestId === "string" ? params.requestId : undefined
		const refuse = (error: string): Sockets.Sessions.MessagesPage.Response => {
			const res = { sessionId, requestId, rows: [], error }
			emitToUser("sessions:messagesPage", res)
			return res
		}
		if (!Number.isInteger(sessionId)) return refuse("sessionId must be a session's id.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("This session is not yours to read.")
		const beforeId = params.beforeId == null ? undefined : Number(params.beforeId)
		if (beforeId !== undefined && !Number.isInteger(beforeId))
			return refuse("beforeId must be a message id (the last page's nextCursor).")
		const asked = params.limit == null ? MESSAGES_PAGE_LIMIT.default : Number(params.limit)
		const limit = Number.isFinite(asked)
			? Math.min(MESSAGES_PAGE_LIMIT.max, Math.max(MESSAGES_PAGE_LIMIT.min, Math.trunc(asked)))
			: MESSAGES_PAGE_LIMIT.default
		let laneFilter
		if (typeof params.channel === "string" && params.channel.trim()) {
			laneFilter = channelWhere(schema.sessionMessages.channel, params.channel)
		}
		// 🚧 A personal lane that is not the asker's is not theirs to page
		// through (2026-10-17) — filtered in the query, before the limit.
		const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
		const laneView = await laneViewFor(db, sessionId, userId)
		const page = await db
			.select()
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					beforeId !== undefined ? lt(schema.sessionMessages.id, beforeId) : undefined,
					laneFilter,
					laneViewWhere(schema.sessionMessages.channel, laneView),
					// 🚧 The live history (RF fix 5).
					liveMessageWhere()
				)
			)
			.orderBy(desc(schema.sessionMessages.id))
			.limit(limit + 1)
		const more = page.length > limit
		const rows = page.slice(0, limit).reverse()
		const res: Sockets.Sessions.MessagesPage.Response = {
			sessionId,
			requestId,
			rows,
			...(more && rows.length ? { nextCursor: String(rows[0]!.id) } : {})
		}
		emitToUser("sessions:messagesPage", res)
		return res
	}
}

/**
 * 🚧 The **channel lanes** under one channel (`channel-lanes` widget request;
 * ruled 2026-10-12): one entry per lane that holds a line — the canonical
 * channel string, its slug and number, its line count and its newest line.
 * A bare slug lists every lane of the channel; a lane string (`phone:2`)
 * answers that lane alone. Read from the log, never declared: a lane exists
 * because a pipeline wrote to it. Who is in a lane is the genre's to keep.
 * Access as `sessions:get`.
 */
export const sessionsChannelLanesHandler: Handler<
	Sockets.Sessions.ChannelLanes.Params,
	Sockets.Sessions.ChannelLanes.Response
> = {
	event: "sessions:channelLanes",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const requestId = typeof params?.requestId === "string" ? params.requestId : undefined
		const refuse = (error: string): Sockets.Sessions.ChannelLanes.Response => {
			const res = { sessionId, requestId, lanes: [], error }
			emitToUser("sessions:channelLanes", res)
			return res
		}
		if (!Number.isInteger(sessionId)) return refuse("sessionId must be a session's id.")
		if (typeof params?.channel !== "string" || !params.channel.trim()) return refuse("channel must be a channel slug.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("This session is not yours to read.")
		const m = schema.sessionMessages
		// 🚧 Only the lanes the asker may read (personal lanes, 2026-10-17).
		const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
		const laneView = await laneViewFor(db, sessionId, userId)
		const where = and(
			eq(m.sessionId, sessionId),
			channelWhere(m.channel, params.channel),
			laneViewWhere(m.channel, laneView),
			// 🚧 The live history (RF fix 5).
			liveMessageWhere(m.rewindOrdinal)
		)
		const grouped = await db
			.select({ channel: m.channel, count: count(m.id), latestId: max(m.id) })
			.from(m)
			.where(where)
			.groupBy(m.channel)
		const latestIds = grouped.map((g) => Number(g.latestId)).filter((n) => Number.isInteger(n))
		const latestRows = latestIds.length
			? await db
					.select({ id: m.id, createdAt: m.createdAt, role: m.role, characterId: m.characterId, personaId: m.personaId, castMemberId: m.castMemberId })
					.from(m)
					.where(inArray(m.id, latestIds))
			: []
		const latestById = new Map(latestRows.map((r) => [r.id, r]))
		const lanes: ChannelLaneV1[] = []
		for (const g of grouped) {
			const latest = latestById.get(Number(g.latestId))
			if (!latest) continue
			const laneRef = parseChannel(g.channel)
			// A row written as `slug:1` and one written bare are one lane: fold them.
			const canonical = formatChannel(laneRef)
			const seen = lanes.find((l) => l.channel === canonical)
			const entry: ChannelLaneV1 = {
				channel: canonical,
				slug: laneRef.slug,
				lane: laneRef.lane,
				count: Number(g.count),
				latest: {
					messageId: latest.id,
					at: new Date(latest.createdAt as unknown as string | number | Date).toISOString(),
					role: latest.role,
					characterId: latest.characterId,
					personaId: latest.personaId,
					// 🚧 Host-filled (seat-cast S3): the message's own `cast_member_id`.
					castMemberId: latest.castMemberId ?? null
				}
			}
			if (!seen) lanes.push(entry)
			else {
				seen.count += entry.count
				if (entry.latest.messageId > seen.latest.messageId) seen.latest = entry.latest
			}
		}
		lanes.sort((a, b) => a.lane - b.lane)
		const res: Sockets.Sessions.ChannelLanes.Response = { sessionId, requestId, lanes }
		emitToUser("sessions:channelLanes", res)
		return res
	}
}

/**
 * 🚧 **Read to here** on one channel lane (2026-10-17, PLAN-sheet-widget
 * §11): moves the asker's last-read mark (annex owner `core`'s `laneReads`)
 * forward to `messageId`, or to the lane's newest line, and answers their
 * fresh channels view (`SessionV1.channels`). A lane the asker may not read
 * is refused; access as `sessions:get`.
 */
export const sessionsLaneReadHandler: Handler<
	Sockets.Sessions.LaneRead.Params,
	Sockets.Sessions.LaneRead.Response
> = {
	event: "sessions:laneRead",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const refuse = (error: string): Sockets.Sessions.LaneRead.Response => {
			const res = { sessionId, error }
			emitToUser("sessions:laneRead", res)
			return res
		}
		if (!Number.isInteger(sessionId)) return refuse("sessionId must be a session's id.")
		if (typeof params?.channel !== "string" || !params.channel.trim()) return refuse("channel must be a channel lane.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("This session is not yours to read.")
		const { laneViewFor, laneViewAllows } = await import("$lib/server/channels/lanes")
		const { markLaneRead, newestOnLane, sessionChannelsFor } = await import("$lib/server/channels/attention")
		const view = await laneViewFor(db, sessionId, userId)
		if (!view) return refuse("This session is not yours to read.")
		if (!laneViewAllows(view, params.channel)) return refuse("That lane is another person's.")
		const asked = params.messageId == null ? await newestOnLane(db, sessionId, params.channel) : Number(params.messageId)
		if (asked !== null && Number.isInteger(asked) && asked > 0)
			await markLaneRead(db, sessionId, userId, params.channel, asked)
		const res: Sockets.Sessions.LaneRead.Response = { sessionId, channels: await sessionChannelsFor(db, view) }
		emitToUser("sessions:laneRead", res)
		return res
	}
}

/**
 * Owner 2026-11-04, item 15: _Reset to genre default layout_ clears the
 * person's settings and style pins for the widgets the layout places, so they
 * look as the genre ships them. Only this person's rows, only these ids; every
 * other key of `layout_settings` rides through. Runs inside the copy's
 * transaction, before the copy, so what the layout itself brings still wins.
 */
async function clearPlacedWidgetValues(
	tx: Db,
	args: { sessionId: number; userId: number; ids: string[] }
): Promise<void> {
	if (!args.ids.length) return
	await tx
		.delete(schema.widgetSettings)
		.where(
			and(
				eq(schema.widgetSettings.sessionId, args.sessionId),
				eq(schema.widgetSettings.userId, args.userId),
				inArray(schema.widgetSettings.widgetInstanceId, args.ids)
			)
		)
	const mine = and(
		eq(schema.sessionPanelLayouts.sessionId, args.sessionId),
		eq(schema.sessionPanelLayouts.userId, args.userId)
	)
	const [row] = await tx
		.select({ layoutSettings: schema.sessionPanelLayouts.layoutSettings })
		.from(schema.sessionPanelLayouts)
		.where(mine)
		.limit(1)
	const settings = row?.layoutSettings as Record<string, unknown> | null
	const pins = settings?.widgetStyles
	if (!pins || typeof pins !== "object" || Array.isArray(pins)) return
	const kept = Object.fromEntries(
		Object.entries(pins).filter(([id]) => !args.ids.includes(id))
	)
	await tx
		.update(schema.sessionPanelLayouts)
		.set({ layoutSettings: { ...settings, widgetStyles: kept } })
		.where(mine)
}

/**
 * Replace the caller's session layout by COPYING one in: a session layout
 * preset (_Start from_ a card, _Start again from "X"_, _Reset to genre default
 * layout_) or `null` (_Start from scratch_). The incoming layout's widget
 * settings and style pins win for each widget instance it names; the session
 * keeps its others (owner LB). A preset the caller may not copy — another
 * genre's, a withdrawn one, a stranger's private one, a missing id — is
 * refused with one sentence and nothing is written.
 *
 * `clearPlacedWidgets` (sent by _Reset to genre default layout_ only, and
 * honoured only for the genre default itself) first clears the caller's
 * settings and style pins for the widgets that layout places.
 *
 * Answered like `:get`, so the page re-seeds from one message.
 */
export const sessionsPanelLayoutStartFromHandler: Handler<
	Sockets.Sessions.PanelLayout.StartFrom.Params,
	Sockets.Sessions.PanelLayout.StartFrom.Response
> = {
	event: "sessions:panelLayout:startFrom",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		let ok = false
		let error: string | undefined
		const presetId = params.layoutPresetId ?? null
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (presetId !== null && !Number.isInteger(presetId)) {
			error = LAYOUT_PRESET_UNKNOWN
		} else {
			const genreId = await sessionGenreOf(db, params.sessionId)
			const clearPlaced = params.clearPlacedWidgets === true
			const outcome = await db.transaction(async (tx) => {
				if (clearPlaced && presetId !== null) {
					const row = await genreDefaultLayoutRow(genreId, tx)
					if (row && row.id === presetId)
						await clearPlacedWidgetValues(tx, {
							sessionId: params.sessionId,
							userId,
							ids: drawnWidgetIds(arrangementOf(row.layout) as SessionLayoutV1)
						})
				}
				return copyLayoutIntoSession(tx, {
					sessionId: params.sessionId,
					userId,
					genreId,
					layoutPresetId: presetId
				})
			})
			if (outcome.ok) ok = true
			else error = outcome.error
		}
		const res: Sockets.Sessions.PanelLayout.StartFrom.Response = {
			...(await panelLayoutAnswer(params.sessionId, userId, access.hasAccess)),
			ok,
			error
		}
		emitToUser("sessions:panelLayout:startFrom", res)
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
 * already has a row for here (`storedWidgetInstanceIds`).
 *
 * The guard above answers shape only, and a key is not a shape: it becomes a
 * `widget_instance_id` verbatim, so without this anyone who can reach a
 * session could mint rows there under any id they liked — unreadable by any
 * widget, and unbounded in number.
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
 * instance id and the session, which is what a person reading a log needs to
 * tell a stale client from a probe.
 */
async function seatedWidgetSettings(
	sessionId: number,
	userId: number,
	next: Record<string, Record<string, unknown>>
): Promise<Record<string, Record<string, unknown>>> {
	const keys = Object.keys(next)
	if (!keys.length) return next
	const { seatableWidgetIds } = await import("$lib/server/plugins/frameHost")
	const seatable = await seatableWidgetIds(db, await sessionGenreOf(db, sessionId))
	const stored = await storedWidgetInstanceIds(sessionId, userId)
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

/**
 * Is a session layout sent off the wire one the app can draw — no
 * `validateSessionLayout` ERROR? The errors go to the log; the person reads
 * one plain sentence. Warnings (a key readers ignore, an unknown widget)
 * never refuse.
 */
function drawableLayout(layout: unknown, verb: "set" | "save"): boolean {
	const verdict = validateSessionLayout(layout)
	if (!verdict.ok)
		console.warn(
			`session layout: refused to ${verb} a layout the app cannot draw — ${verdict.errors.join("; ")}`
		)
	return verdict.ok
}

/**
 * Persist the caller's session layout for a session (21 §10; the copy model).
 * One row per (user, session); upsert. The `layout` blob is stored verbatim —
 * its shape is the client surface manager's business.
 *
 * Provenance (`started from`, `layout_copied_at`) is never written here: only
 * a copy (`:startFrom`, the first open) and _Save as new layout_ write it, so a
 * client cannot name a preset it never copied. A `layoutPresetId` key from an
 * older client is ignored. The one exception is a set that INSERTS — no open
 * came first — which stamps `layout_copied_at` with no source, so the row is
 * never mistaken for a pre-copy-model one.
 *
 * `layoutSettings` and `widgetSettings` are written ONLY when the caller sends
 * the key: the surface manager's debounced save posts `layout` alone, several
 * times a minute, and absence meaning "clear" would wipe pins and settings on
 * every drag of a gutter.
 *
 * The `layout` is checked with the SDK's `validateSessionLayout` — its
 * `panels`, and the shape of any ⏳ old slot — and a layout with an error is
 * refused (`LAYOUT_PRESET_CANT_SAVE`, the errors to the log) with nothing
 * written, not even the keys that came with it. Warnings never refuse: the
 * row's own `active` and `tierSizeOverrides` are keys readers of the layout
 * ignore.
 */
export const sessionsPanelLayoutSetHandler: Handler<
	Sockets.Sessions.PanelLayout.Set.Params,
	Sockets.Sessions.PanelLayout.Set.Response
> = {
	event: "sessions:panelLayout:set",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		// ⏳ A page still holding a version 1 layout (or only the old slots) is
		// saved as panels version 2, its moved Messages settings and style pins
		// with it, BEFORE it is checked (PLAN-session-layout-simplify D14).
		if (access.hasAccess && params.layout && typeof params.layout === "object") {
			const { panelLayoutWriteAsV2 } = await import("$lib/server/db/sessionLayoutPanels")
			params = await panelLayoutWriteAsV2(params.sessionId, userId, params)
		}
		let ok = false
		let error: string | undefined
		const setsSettings = "layoutSettings" in params
		const setsWidgets = "widgetSettings" in params
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (!params.layout || typeof params.layout !== "object") {
			error = "Invalid layout"
		} else if (!drawableLayout(params.layout, "set")) {
			error = LAYOUT_PRESET_CANT_SAVE
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
		} else {
			// Built conditionally so an absent key leaves its column alone.
			// Typed against the table so a mistyped column name is a compile
			// error rather than a silently ignored write.
			const changes: Partial<
				typeof schema.sessionPanelLayouts.$inferInsert
			> = { layout: params.layout }
			if (setsSettings) changes.layoutSettings = params.layoutSettings
			await db
				.insert(schema.sessionPanelLayouts)
				.values({
					sessionId: params.sessionId,
					userId,
					layoutCopiedAt: new Date(),
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
 * **Save as new layout** (owner L3): a new private session layout preset for
 * this session's genre, written from this session's layout — the sent
 * arrangement, with the settings and style pins of every widget instance the
 * page draws (`drawnWidgetIds`, the floor's included) packed in server-side
 * (`saveAsNewLayout`) — and made what this session **started from**, in one
 * transaction. It is offered to every session of the genre, and choosing it
 * there copies it in. An id that is not a widget instance id is dropped; a
 * layout the app cannot draw is refused and nothing is written.
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
		let startedFromLayoutPresetId: number | undefined
		let layoutCopiedAt: string | undefined
		if (!access.hasAccess) {
			error = "No access to this session"
		} else if (!name) {
			error = LAYOUT_PRESET_NEEDS_NAME
		} else if (!params.layout || typeof params.layout !== "object") {
			error = "Invalid layout"
		} else if (!drawableLayout(params.layout, "save")) {
			error = LAYOUT_PRESET_CANT_SAVE
		} else {
			const genreId = await sessionGenreOf(db, params.sessionId)
			const saved = await saveAsNewLayout({
				sessionId: params.sessionId,
				genreId,
				userId,
				name,
				description:
					typeof params.description === "string"
						? params.description
						: undefined,
				layout: params.layout,
				drawnWidgetIds: Array.isArray(params.drawnWidgetIds)
					? params.drawnWidgetIds.filter(isWidgetInstanceId)
					: []
			})
			if (!saved.ok) {
				error = saved.error
			} else {
				preset = saved.preset
				startedFromLayoutPresetId = saved.startedFromLayoutPresetId
				layoutCopiedAt = saved.layoutCopiedAt.toISOString()
				presets = await listLayoutPresets(genreId, userId)
				ok = true
			}
		}
		const res: Sockets.Sessions.PanelLayout.Save.Response = {
			sessionId: params.sessionId,
			ok,
			error,
			preset,
			presets,
			startedFromLayoutPresetId,
			layoutCopiedAt
		}
		emitToUser("sessions:layoutPreset:save", res)
		return res
	}
}

/**
 * Rename one of the caller's OWN layout presets (PLAN 25 redesign) — or, for
 * an admin, a shared one (`db/layoutPermissions.ts`'s matrix: a shared row is
 * its author's and an admin's; a private one is its author's alone).
 *
 * Not session-scoped: a preset belongs to a genre and an author, not to the
 * session you happened to be looking at when you saved it. So there is no
 * session access check here — the only question is who manages the row, and
 * it is asked once, in `db/layoutPresets.ts`, for all of rename/delete/usage.
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
			isAdmin: !!socket.user?.isAdmin,
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
		// A shared layout's new name reaches everyone else offered it.
		if (outcome.ok && outcome.preset.visibility === "shared")
			await pushListToOthers(outcome.preset.genreId, userId, socket)
		return res
	}
}

/**
 * Delete one of the caller's own layout presets, saying how many sessions had
 * started from it. No session's layout changes: each holds its own copy, and
 * `session_panel_layouts.layout_preset_id` is `ON DELETE SET NULL`, so they
 * lose only their "started from" label. The client asks first
 * (`layoutPreset:usage`) and confirms with the counts.
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
			userId,
			isAdmin: !!socket.user?.isAdmin
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
		// A shared layout's card leaves everyone else's list, and the
		// sessions that started from it lose the name (the FK nulled it).
		if (outcome.ok && outcome.visibility === "shared")
			await pushListToOthers(outcome.genreId, userId, socket)
		return res
	}
}

/**
 * What the delete confirmation says about one of the caller's own presets —
 * sessions that started from it, and people using it for new sessions —
 * behind the same authorship gate as the delete it precedes.
 */
export const sessionsLayoutPresetUsageHandler: Handler<
	Sockets.Sessions.PanelLayout.Usage.Params,
	Sockets.Sessions.PanelLayout.Usage.Response
> = {
	event: "sessions:layoutPreset:usage",
	handler: async (socket, params, emitToUser) => {
		const outcome = await layoutPresetUsage({
			presetId: params.id,
			userId: socket.user!.id,
			isAdmin: !!socket.user?.isAdmin
		})
		const res: Sockets.Sessions.PanelLayout.Usage.Response = outcome.ok
			? {
					id: outcome.id,
					ok: true,
					sessions: outcome.sessions,
					newSessionLayoutUsers: outcome.newSessionLayoutUsers
				}
			: {
					id: params.id,
					ok: false,
					error: outcome.error,
					sessions: 0,
					newSessionLayoutUsers: 0
				}
		emitToUser("sessions:layoutPreset:usage", res)
		return res
	}
}

/* ── the L4 verbs (brief 6a of PLAN-layout-one-format-2026-09-28) ─────────
 * Share, make a copy, save changes to, and the new-session layout — on the
 * live `sessions:layoutPreset:*` family, over the db module's functions and
 * `db/layoutPermissions.ts`'s matrix. Every answer carries the refreshed list
 * for the row's genre, so the editor's pane re-renders from one message; a
 * refusal names no genre and lists nothing, as rename's does.
 */

/**
 * After a verb that changes what OTHER people are offered — sharing, stopping
 * sharing, renaming or deleting a shared layout — every other person with a
 * session of its genre open gets their refreshed list, live
 * (`pushLayoutListChanged`). After the caller's own answer; gated, so nobody
 * watching reads nothing.
 */
async function pushListToOthers(
	genreId: string,
	actorId: number,
	// `Handler`'s socket is untyped; its `io` is the server.
	socket: { io?: Parameters<typeof import("$lib/server/sessions/startedFromPush").pushLayoutListChanged>[1] }
): Promise<void> {
	const { pushLayoutListChanged } = await import("$lib/server/sessions/startedFromPush")
	await pushLayoutListChanged({ genreId, actorId }, socket.io)
}

/** The answer a managing verb gives: the row and its genre's list, or a refusal. */
async function managedAnswer(
	id: number,
	userId: number,
	outcome:
		| { ok: true; preset: Sockets.Sessions.LayoutPreset }
		| { ok: false; error: string }
): Promise<Sockets.Sessions.PanelLayout.ManagedAnswer> {
	if (!outcome.ok) return { id, ok: false, error: outcome.error, presets: [] }
	return {
		id,
		ok: true,
		genreId: outcome.preset.genreId,
		preset: outcome.preset,
		presets: await listLayoutPresets(outcome.preset.genreId, userId)
	}
}

/**
 * _Share with everyone on this server_ / _Stop sharing_ (`shareLayoutPreset`,
 * behind `canShare`: the author, or an admin for a shared row; never a
 * shipped row).
 *
 * ## Who is a guest (⚠ advisory)
 *
 * There is no account-level guest role (`users` carries one bit, `isAdmin`);
 * a guest is a guest ON A SESSION (`session_guests`). So the verb names the
 * session the editor is open in — the caller must be in it, and it must be of
 * the layout's genre (its list is where the layout was offered) — and a guest
 * THERE is refused publishing: the ruled matrix's "a guest may keep and change
 * their own layouts, never publish one". A share that names no session, or
 * one the caller is not in, is refused outright rather than read as "not a
 * guest".
 *
 * This does NOT stop a person who is a guest somewhere from publishing: anyone
 * may make a session, and in their own they are its owner, so the same share
 * named through it is allowed (pinned by a test). "A guest never publishes"
 * holds per session, not per account, until accounts carry a guest role —
 * an owner question (plan: brief 6a review). Taking a layout private is never
 * publishing, so it needs only the manage gate.
 */
export const sessionsLayoutPresetShareHandler: Handler<
	Sockets.Sessions.PanelLayout.Share.Params,
	Sockets.Sessions.PanelLayout.Share.Response
> = {
	event: "sessions:layoutPreset:share",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = Number.isInteger(params?.sessionId)
			? await checkSessionAccess(params.sessionId, userId)
			: null
		const res = await managedAnswer(
			params?.id,
			userId,
			!access?.hasAccess
				? { ok: false, error: "No access to this session" }
				: await shareLayoutPreset({
						presetId: params.id,
						userId,
						isAdmin: !!socket.user?.isAdmin,
						isGuest: access.isGuest && !access.isOwner,
						genreId: await sessionGenreOf(db, params.sessionId),
						visibility: params.visibility
					})
		)
		emitToUser("sessions:layoutPreset:share", res)
		// Shared or taken private: everyone else's list gains or loses it.
		if (res.ok && res.genreId) await pushListToOthers(res.genreId, userId, socket)
		return res
	}
}

/**
 * _Make a copy_ (`cloneLayoutPreset`): any layout the caller can see becomes
 * a new private layout of theirs. Seeing is the whole permission, so a guest
 * may, and no session is named; a stranger's private row, a withdrawn one and
 * a missing id all get the one unknown-layout sentence.
 */
export const sessionsLayoutPresetCloneHandler: Handler<
	Sockets.Sessions.PanelLayout.Clone.Params,
	Sockets.Sessions.PanelLayout.Clone.Response
> = {
	event: "sessions:layoutPreset:clone",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const res = await managedAnswer(
			params?.id,
			userId,
			await cloneLayoutPreset({
				presetId: params?.id,
				userId,
				name: typeof params?.name === "string" ? params.name : undefined
			})
		)
		emitToUser("sessions:layoutPreset:clone", res)
		return res
	}
}

/**
 * _Save changes to "*Name*"_ (`saveChangesToLayout`): re-capture this
 * session's layout into one of the caller's layouts — packed as Save as new
 * packs it, from the session's own widget settings and style pins — and make
 * it what this session **started from**. Behind session access and the manage
 * gate (the author, or an admin for a shared row); a layout of another genre
 * than the session's is unknown. Other sessions that started from it only
 * read **Updated**, and only when the layout moved — and they are TOLD, live,
 * after the caller's own answer (`pushStartedFromUpdated`, brief 6b).
 *
 * A session that itself reads the layout as **Updated** would overwrite what
 * was saved into it since the copy, so that save is refused unless the page
 * asked the person and sends `overwriteUpdated` (brief 6b).
 */
export const sessionsLayoutPresetUpdateHandler: Handler<
	Sockets.Sessions.PanelLayout.Update.Params,
	Sockets.Sessions.PanelLayout.Update.Response
> = {
	event: "sessions:layoutPreset:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const access = Number.isInteger(params?.sessionId)
			? await checkSessionAccess(params.sessionId, userId)
			: null
		let startedFromLayoutPresetId: number | undefined
		let layoutCopiedAt: string | undefined
		let moved = false
		let outcome:
			| { ok: true; preset: Sockets.Sessions.LayoutPreset }
			| { ok: false; error: string }
		if (!access?.hasAccess) {
			outcome = { ok: false, error: "No access to this session" }
		} else if (!params.layout || typeof params.layout !== "object") {
			outcome = { ok: false, error: "Invalid layout" }
		} else {
			const saved = await saveChangesToLayout({
				presetId: params.id,
				sessionId: params.sessionId,
				genreId: await sessionGenreOf(db, params.sessionId),
				userId,
				isAdmin: !!socket.user?.isAdmin,
				layout: params.layout,
				drawnWidgetIds: Array.isArray(params.drawnWidgetIds)
					? params.drawnWidgetIds.filter(isWidgetInstanceId)
					: [],
				overwriteUpdated: params.overwriteUpdated === true
			})
			outcome = saved
			if (saved.ok) {
				startedFromLayoutPresetId = saved.startedFromLayoutPresetId
				layoutCopiedAt = saved.layoutCopiedAt.toISOString()
				moved = saved.moved
			}
		}
		const res: Sockets.Sessions.PanelLayout.Update.Response = {
			...(await managedAnswer(params?.id, userId, outcome)),
			sessionId: params?.sessionId,
			startedFromLayoutPresetId,
			layoutCopiedAt
		}
		emitToUser("sessions:layoutPreset:update", res)
		// After the caller's answer: the sessions that started from it and now
		// read Updated hear it live (scoped, gated; nothing built for nobody).
		if (moved) {
			const { pushStartedFromUpdated } = await import(
				"$lib/server/sessions/startedFromPush"
			)
			await pushStartedFromUpdated({ layoutPresetIds: [params.id] }, socket.io)
		}
		return res
	}
}

/**
 * _Use for new *Genre* sessions_ / _Stop using for new sessions_
 * (`setUserLayoutDefault`): the caller's **new-session layout** for a genre,
 * copied in by their next first open of a session of it. It must be a layout
 * of that genre they can see; `null` clears it (the genre default layout
 * applies). Genre-scoped, not session-scoped: a guest chooses their own.
 */
export const sessionsLayoutPresetSetNewSessionLayoutHandler: Handler<
	Sockets.Sessions.PanelLayout.SetNewSessionLayout.Params,
	Sockets.Sessions.PanelLayout.SetNewSessionLayout.Response
> = {
	event: "sessions:layoutPreset:setNewSessionLayout",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const genreId = typeof params?.genreId === "string" ? params.genreId : ""
		const outcome = await setUserLayoutDefault({
			userId,
			genreId,
			presetId: params?.layoutPresetId ?? null
		})
		const res: Sockets.Sessions.PanelLayout.SetNewSessionLayout.Response =
			outcome.ok
				? {
						genreId,
						ok: true,
						layoutPresetId: outcome.presetId,
						presets: await listLayoutPresets(genreId, userId)
					}
				: { genreId, ok: false, error: outcome.error, presets: [] }
		emitToUser("sessions:layoutPreset:setNewSessionLayout", res)
		return res
	}
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
	if (opts.withRewind) {
		const { rewindStateOf } = await import("$lib/server/sessions/rewind")
		res.rewind = await rewindStateOf(db, sessionId)
	}
	res.venues = (await listSessionActions(
		db,
		sessionId,
		{ userId },
		{ channel, ...(opts.starting ? { starting: true } : {}) }
	)) as any
	// What a block press of a form-venue action collects (lair pass R9):
	// those actions are listed in no venue, so the collect modal reads here.
	const forms = await formCollectsOf(db, sessionId, { userId })
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

/**
 * The fields both session payloads add to the session row: sprite-set
 * overrides, cast faces, the book lock. Mutates and returns `sessionData`.
 */
async function withSessionExtras(sessionData: any, sessionId: number): Promise<any> {
	// 🚧 The name of the book the session reads, for every reader (★bk-lock-2).
	const { SESSION_NOTES_LABEL } = await import(
		"$lib/shared/lorebooks/sessionNotes"
	)
	try {
		let name: string | null = null
		if (sessionData.lorebookId != null) {
			const [book] = await db
				.select({ name: schema.lorebooks.name })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, sessionData.lorebookId))
			name = book?.name ?? null
		}
		;sessionData.lorebookName = name ?? SESSION_NOTES_LABEL
	} catch {
		;sessionData.lorebookName = SESSION_NOTES_LABEL
	}
	// The session's sprite-set overrides (DESIGN-sprites §2.3), so a portrait
	// shows the outfit the session changed to before the next line records it.
	try {
		const { spriteSetOverridesFor } = await import(
			"$lib/server/sprites/choices"
		)
		;sessionData.spriteSetOverrides = await spriteSetOverridesFor(
			db,
			sessionId,
			(sessionData.sessionCharacters ?? [])
				.map((sc: any) => sc.characterId)
				.filter((id: unknown): id is number => typeof id === "number")
		)
	} catch {
		;sessionData.spriteSetOverrides = {}
	}

	// What each seat's cast member shows over its card (s27 S2: the member
	// as read, wherever it lives, over the member's active card): names and
	// faces by seated card id, and the member's own sprite sets when one has
	// an image. `{}` when every seat reads its card — the cards stand.
	// The member read of each seat row (keyed by the row), kept for the
	// host-filled identity below so members are read once.
	const seatReads = new Map<
		any,
		{ activeCardId: number | null; nodeState?: string } | null
	>()
	try {
		const { seatMembersAsRead } = await import(
			"$lib/server/pipelines/prompt/seatCards"
		)
		const { seatCastShownFrom, memberSpriteSetsBySeat } = await import(
			"$lib/server/sessions/rowProjection"
		)
		// Character seats, then player seats (★pT-1, 2026-11-05: "Everything
		// in session is cast -> active card"); a card held by both is the
		// character seat's. A card-less player seat has no card id to key by.
		const seated: any[] = [
			...(sessionData.sessionCharacters ?? []).filter((sc: any) => sc.character),
			...(sessionData.sessionPersonas ?? []).filter((sp: any) => sp.persona)
		]
		const rows = seated.map((seat: any) =>
			seat.persona ? { ...seat, character: seat.persona } : seat
		)
		const asReads = await seatMembersAsRead(db, sessionId, rows)
		seated.forEach((seat: any, i: number) => seatReads.set(seat, asReads[i]))
		const { castNames, castFaces } = seatCastShownFrom(rows, asReads)
		;sessionData.castFaces = castFaces
		;sessionData.castNames = castNames
		;sessionData.castSpriteSets = await memberSpriteSetsBySeat(
			db,
			rows,
			asReads
		)
	} catch {
		;sessionData.castFaces = {}
		;sessionData.castNames = {}
		;sessionData.castSpriteSets = {}
	}

	// 🚧 Host-filled identity (seat-cast S3: match on it, never build it):
	// each seat row's `ref` (`hostSeatRefOf`: the member form once the flip is
	// on — ⏳ `character:<id>` for a member-less character seat — else the card
	// form, `player-seat:<id>` for a card-less player seat), its stored `castMemberId`, and `cardId` — the
	// member's active card on the timeline, else the held card (null for a
	// card-less player seat). A failed member read leaves the held card.
	{
		const { hostSeatRefOf } = await import(
			"$lib/server/pipelines/prompt/seatCards"
		)
		// Seats holding no card but a cast member, of either table: a card-less
		// player seat, a card-less character seat (never an envoy's).
		const cardless: any[] = [
			...(sessionData.sessionCharacters ?? []).filter(
				(sc: any) =>
					!sc.character &&
					sc.characterId == null &&
					!sc.envoySlug &&
					sc.castMemberId != null
			),
			...(sessionData.sessionPersonas ?? []).filter(
				(sp: any) => !sp.persona && sp.castMemberId != null
			)
		]
		const cardlessReads = new Map<
			number,
			{
				activeCardId: number | null
				nodeState?: string
				name: string
				nickname: string | null
				faceMediaId: number | null
			}
		>()
		if (cardless.length) {
			try {
				const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
				const reads = await membersAsRead(
					db as unknown as Db,
					cardless.map((sp: any) => sp.castMemberId as number),
					{ sessionId }
				)
				for (const [id, read] of reads) cardlessReads.set(id, read)
			} catch {
				// the held card (none) stands
			}
		}
		// 🚧 The card-less seats shown as their cast member, by member id.
		{
			const shown: Record<
				number,
				{ name: string; nickname: string | null; faceMediaId: number | null }
			> = {}
			for (const seat of cardless) {
				const read = cardlessReads.get(seat.castMemberId)
				if (read)
					shown[seat.castMemberId] = {
						name: read.name,
						nickname: read.nickname ?? null,
						faceMediaId: read.faceMediaId ?? null
					}
			}
			;sessionData.cardlessSeatShown = shown
		}
		for (const sc of sessionData.sessionCharacters ?? []) {
			const held: number | null = sc.character?.id ?? sc.characterId ?? null
			// A card-less character seat: `seated-member:<id>`, no card.
			if (held == null && (sc.envoySlug || sc.castMemberId == null)) continue
			const read = seatReads.get(sc)
			const ref = hostSeatRefOf({
				kind: "character",
				seatId: sc.id,
				castMemberId: sc.castMemberId ?? null,
				cardId: held
			})
			if (held != null) sc.ref = ref ?? `character:${held}`
			else if (ref) sc.ref = ref
			if (sc.castMemberId === undefined) sc.castMemberId = null
			;sc.cardId = held == null ? null : read ? read.activeCardId : held
		}
		for (const sp of sessionData.sessionPersonas ?? []) {
			const held: number | null = sp.persona?.id ?? null
			const read =
				seatReads.get(sp) ??
				(held == null && sp.castMemberId != null
					? (cardlessReads.get(sp.castMemberId) ?? null)
					: null)
			;sp.ref =
				hostSeatRefOf({
					kind: "player",
					seatId: sp.id,
					castMemberId: sp.castMemberId ?? null,
					cardId: held
				}) ?? `player-seat:${sp.id}`
			if (sp.castMemberId === undefined) sp.castMemberId = null
			;sp.cardId = read ? read.activeCardId : held
		}

	// 🚧 bench-L4b (★L4-1): on a benched seat only, `hasLines` (any line of
	// the seat in the session; the client offers Remove only when false) and
	// `fellInStory` (an open bench record to=true, a deceased member, or a
	// player seat replaced by a newer card-less one of the same user). A seat in
	// play or a removed row gets neither; a failure leaves them absent, which
	// the client reads as "has lines" and "not fallen".
	try {
		const isBenched = (r: any) => !r.removedAt && r.isActive === false
		const benchedChars = (sessionData.sessionCharacters ?? []).filter(isBenched)
		const benchedPlayers = (sessionData.sessionPersonas ?? []).filter(isBenched)
		if (benchedChars.length || benchedPlayers.length) {
			const { seatHasLines } = await import("$lib/server/sessions/seats")
			const { standingSeatBenches, seatBenchKey } = await import(
				"$lib/server/sessions/sessionImprints"
			)
			const benches = await standingSeatBenches(db as unknown as Db, sessionId)
			const fellOpen = (kind: "character" | "player", seatId: number) =>
				benches.get(seatBenchKey(kind, seatId)) === true
			const deceased = (row: any) =>
				(seatReads.get(row) ??
					(row.castMemberId != null
						? cardlessReads.get(row.castMemberId)
						: null))?.nodeState === "deceased"
			for (const sc of benchedChars) {
				sc.hasLines = await seatHasLines(db as unknown as Db, {
					sessionId,
					kind: "character",
					seatId: sc.id,
					castMemberId: sc.castMemberId ?? null,
					cardId: sc.characterId ?? null
				})
				sc.fellInStory = fellOpen("character", sc.id) || deceased(sc)
			}
			for (const sp of benchedPlayers) {
				sp.hasLines = await seatHasLines(db as unknown as Db, {
					sessionId,
					kind: "player",
					seatId: sp.id,
					castMemberId: sp.castMemberId ?? null,
					cardId: sp.personaId ?? null
				})
				const player = sp.userId ?? sp.persona?.userId
				sp.fellInStory =
					fellOpen("player", sp.id) ||
					deceased(sp) ||
					(player != null &&
						(sessionData.sessionPersonas ?? []).some(
							(o: any) =>
								o.id > sp.id &&
								!o.removedAt &&
								o.personaId == null &&
								o.userId === player
						))
			}
		}
	} catch {
		// absent: the safe side
	}
	}

	// 🚧 The book lock (PLAN-lorebook-kinds §A): once play has written, the
	// forms say the session keeps its book rather than offering to move it.
	{
		const { playHasWritten } = await import("$lib/server/sessions/bookLock")
		;sessionData.lorebookFixed = await playHasWritten(
			db as unknown as Db,
			sessionId
		)
	}
	// 🚧 pr-6 (R-d, pass 9 S4): Close out is offered when the genre registers one; the catch-up
	// offer while this session has not played and an older one on the same book has a tail.
	{
		const { closeOutRegistrationOf, catchUpOfferFor } = await import("$lib/server/sessions/closeOut")
		try {
			;sessionData.closeOutRegistered =
				(await closeOutRegistrationOf(db as unknown as Db, sessionId)) != null
		} catch {
			;sessionData.closeOutRegistered = false
		}
		try {
			;sessionData.catchUp = sessionData.lorebookFixed
				? null
				: await catchUpOfferFor(db as unknown as Db, sessionId)
		} catch {
			;sessionData.catchUp = null
		}
	}
	return sessionData
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

	return {
		session: sessionData as any,
		messages: (sessionData as any).sessionMessages || null,
		pagination: { total, hasMore, ...(olderIn ? { olderIn } : {}) },
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
			const res = converted ? { ...built, rulesetConverted: converted } : built
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
 * 🚧 pr-6 (B §B-1): how many of the session's newest live rows a
 * `sessions:refresh` carries.
 */
const REFRESH_ROWS = 100

/**
 * The `sessions:refresh` payload (shape 2 of two): the session as the page
 * holds it, with every live row (id >= `coversFromId`) of the newest
 * REFRESH_ROWS. `laneFilter: false` reads every lane — the members' push,
 * which `laneScopedRecipients` narrows per member and gives each their
 * `channels`; `true` reads the caller's lanes (the caller-only resend).
 * Null when the session is gone or the user has no access.
 */
async function buildSessionRefresh(
	sessionId: number,
	userId: number,
	laneFilter: boolean
): Promise<Sockets.Sessions.Refresh.Response | null> {
	const sessionData = await getSessionFromDB(sessionId, userId, "none", laneFilter)
	if (!sessionData) return null
	const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
	const laneView = laneFilter ? await laneViewFor(db, sessionId, userId) : null
	const m = schema.sessionMessages
	const newest = await db
		.select()
		.from(m)
		.where(
			and(
				eq(m.sessionId, sessionId),
				liveMessageWhere(m.rewindOrdinal),
				laneFilter ? laneViewWhere(m.channel, laneView) : undefined
			)
		)
		.orderBy(desc(m.id))
		.limit(REFRESH_ROWS)
	newest.reverse()
	// The parts-native half too, as `buildSessionGetResponse` sends it (the
	// 100-turn walk, B11): without it a page that took this push drew every
	// row from its legacy fields.
	const { attachParts } = await import("$lib/server/messages/store")
	const rows: any[] = newest.length ? await attachParts(db, newest) : []
	const coversFromId = rows.length ? rows[0].id : null
	await withSessionExtras(sessionData, sessionId)
	return {
		session: { ...(sessionData as any), sessionMessages: rows },
		messages: rows,
		coversFromId
	}
}

/**
 * The session, re-sent to the caller after a mutation it cannot describe.
 *
 * The lazy counterpart of the handler above, for the verbs whose own reply
 * says only what they changed: a delete or a visibility change made from a
 * surface with no session view open re-reads nothing. It is a push the caller
 * did not ask for, so it is `sessions:refresh` (the caller's lanes, the
 * newest REFRESH_ROWS rows), not the `sessions:get` reply.
 *
 * ⚠ A re-read that THROWS is logged by `emitToUser` and emits nothing — no
 * `sessions:get:error`, and nothing raised into the caller's own catch, which
 * is right for a push the caller's reply does not depend on.
 */
function resendSession(
	socket: any,
	sessionId: number,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("sessions:refresh", () =>
		buildSessionRefresh(sessionId, socket.user!.id, true)
	)
}

/**
 * The whole session, broadcast to everyone in it after its membership changed.
 *
 * The three verbs that add or remove a participant all send this, and they send
 * it to the session's owner and guests rather than to the caller alone — a
 * guest's view has to learn about the persona somebody else just added.
 * The payload is `buildSessionRefresh`'s.
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
	return pushSessionToParticipants(socket.io, sessionId, userId)
}

/**
 * `broadcastSessionToParticipants` by `io` — the one push of the session to
 * every member, for a caller with no socket (a pipeline's
 * `core:outlet/set-seat-name`). A seat named or renamed reaches every
 * member's page through this, as an added persona does (Dungeon Crawler
 * walk round 2, 2026-10-15: a rename and a new seat showed only after a
 * reload).
 */
export function pushSessionToParticipants(
	io: any,
	sessionId: number,
	userId: number
) {
	// 🚧 pr-6 (ledger A1): its own event, `sessions:refresh` — a push on
	// `sessions:get` took every open page's reply branch and dropped its
	// pagination. It carries the session without its rows relation plus the
	// newest REFRESH_ROWS live rows and `coversFromId`; no pagination, no
	// draft. `laneScopedRecipients` narrows rows and adds `channels` per member.
	return broadcastToSessionUsers(io, sessionId, "sessions:refresh", () =>
		buildSessionRefresh(sessionId, userId, false)
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

		// 🚧 pr-6 (ledger A5): ONE statement, no read — the UPDATE's own row
		// lock is the lock, so two people saving at once keep both drafts.
		const key = String(userId)
		if (params.content) {
			await db.execute(sql`
				update sessions
				set drafts = jsonb_set(
					coalesce(drafts, '{}')::jsonb,
					${`{${key}}`}::text[],
					to_jsonb(${params.content}::text),
					true
				)::json
				where id = ${params.sessionId}
			`)
		} else {
			await db.execute(sql`
				update sessions
				set drafts = (coalesce(drafts, '{}')::jsonb - ${key}::text)::json
				where id = ${params.sessionId}
			`)
		}

		return { success: true }
	}
}

// ─── Binding check utility (Flow 1) ─────────────────────────────────────────
// Flow 2 (node-linking, bindingCheck:nodeResult / NodeLinkerModal) is gone —
// see the lorebookBindings/narrativeNodes merge plan. A binding IS the
// graph row now, so there's no separate "node" to reconcile it with.

/**
 * The cast a session reads into its book, kept whole:
 * - Settle the session's seats (`settleSeats`, `sessions/seats.ts`, the one
 *   seat writer): fills each live seat's member — the cast member its card is
 *   in the session's books, or one made for a card nobody has yet, made only
 *   in an attached book the session's owner owns and that is not provided; S1
 *   makes nothing in the own book (★S1-3) — and **never departs a seat**
 *   (fill-only; the boot pass alone merges). It runs first, before the gates
 *   below: a book the session's owner does not own, or a provided book, still
 *   has its seats' members found (members are minted into it never). The
 *   names of the members it made are filled from their cards once the
 *   settling has committed (`syncMintedSeatMembers`).
 * - Emit bindingCheck:result for any orphaned bindings (bindings without a char/persona),
 *   which the home page puts to the person as a question — unless
 *   `askAboutOrphans` is false: a caller that seats many sessions at once
 *   (an import, an overwrite) seats them without asking anything per session.
 * - `minted`: the caller has already made members for this session's seats
 *   (a create seated them through the writer), so the book's cast list is
 *   sent again even when settling found nothing more to make.
 *
 * Ruling 2026-09-12: cast members arrive from the session on their own.
 * There is no "pull the cast" button to press, so every path that puts a
 * lorebook and a session together — or adds a member to a session that
 * already reads one — calls this. Removing a member does NOT remove the
 * binding: lore, relationships and scene appearances may be anchored to it.
 *
 * Creation goes through the seat writer's mint (`findOrInsertBinding`)
 * rather than a bare insert, under the book's advisory lock: two paths
 * running at once (an attach and a member add) would otherwise both pass the
 * same check, and the partial unique indexes (0125) refuse the second row
 * outright.
 */
export async function runLorebookBindingCheck(
	socket: any,
	sessionId: number,
	lorebookId: number,
	emitToUser: (event: string, data: any) => void,
	{
		askAboutOrphans = true,
		minted = false
	}: { askAboutOrphans?: boolean; minted?: boolean } = {}
): Promise<void> {
	// The orphan question reads this snapshot, taken before the seats settle:
	// a member minted by the settle is bound by construction and never one.
	const existingBindings = await db.query.lorebookBindings.findMany({
		where: eq(schema.lorebookBindings.lorebookId, lorebookId)
	})
	// The seats' members, found or made where `seats.ts` says it may.
	const settled = await db.transaction(async (tx) =>
		settleSeats(tx as unknown as Db, sessionId)
	)
	await syncMintedSeatMembers(db, settled.mintedMembers)
	// 🚧 m3 (★M3-core-1): a provided book is readable pub-wide, so a member's
	// session may read it — but its cast rows are the OWNER's book's and a
	// member's writes land under the book's write mode, never straight in. A
	// session whose owner does not own the book gets no relist or question
	// here (the same gate the relist below already uses); the member's own
	// characters are found in the session's own book until the overlay book
	// exists.
	const [sessionRow] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!sessionRow || !(await findOwnedBook(db, sessionRow.userId, lorebookId))) return
	// 🚧 m3b (PLAN-sdk-creation-seams §23, challenger finding): no member rows into
	// a provided book for anyone, the enabling admin included. Its cast is the
	// plugin's and changes only through its write mode; a minted row would put the
	// admin's new persona into a pub-wide book and seat it in everyone's later games.
	const [bookRow] = await db
		.select({ uuid: schema.lorebooks.uuid, extraJson: schema.lorebooks.extraJson })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (bookRow && markedBook(bookRow.extraJson, bookRow.uuid)) return

	// The cast changed, so anyone looking at it should see the new rows
	// without reloading — the same refresh lorebooks:createBinding sends.
	// Only the book's owner may read that list, and the builder refuses
	// everyone else, so a guest whose member add triggered this is asked for
	// nothing on their behalf. Lazy (socket-interest plan, ruling 4): the
	// three-way join behind the cast is paid only when a socket is showing
	// it.
	if (minted || settled.minted > 0) {
		if (await findOwnedBook(db, socket.user!.id, lorebookId)) await relistBindings(socket, lorebookId, emitToUser)
	}

	// Flow 1b: Collect orphaned bindings (no character). Read off the
	// pre-settle snapshot: a row minted by the settle is bound by construction
	// and can never be one.
	const orphaned = existingBindings.filter((b) => !b.characterId)
	if (askAboutOrphans && orphaned.length > 0) {
		// The lazy form, with the projection INSIDE it: the orphan list is
		// built for this payload and nothing else, so a session whose cast
		// panel nobody has open builds none of it.
		//
		// There is no list of session members left without a member: the settle
		// above gives every session character one (or throws), so that list was
		// always empty and is gone from the reply (finding #140).
		//
		// ⚠ The reads and the settle at the top of this function stay OUT of
		// the thunk, deliberately: the settle makes members, and that has to
		// happen whether or not anybody is watching. What the gate may skip
		// is the answer, never the work the check exists to do.
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
 * - A named line is a line of the attached book, or of the session's own book
 *   when none is attached (the line is never a book change).
 * - A named clock must land in that book's calendar; null clears it (the
 *   session follows its line's present).
 * - A session moving to another book brings its own story-time stats: the
 *   new book's calendar must place every one (A18(a)), or the move is
 *   refused with the stats named.
 *
 * Call it with the transaction that writes the session row: before it checks
 * a date it takes the book's calendar lock (`lockBookCalendar`, A18(d)), so a
 * calendar is never declared between the check and the row.
 *
 * ⚠ Writes the SESSION's clock only. The book's present never moves here.
 */
export async function sessionLinePatch(tx: Db, args: {
	before: {
		lorebookId: number | null
		lorebookBranchId: number | null
	} | null
	/** The session moving, when it exists: its stats move with it. */
	session?: { id: number; name: string | null }
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
	const {
		bookCalendarOf,
		clockColumns,
		clockProblem,
		lockBookCalendar,
		sessionStatsThatDoNotLand
	} = await import("$lib/server/state/storyTime")
	const beforeBook = args.before?.lorebookId ?? null
	const book = args.lorebookId !== undefined ? (args.lorebookId ?? null) : beforeBook
	const patch: Partial<typeof schema.sessions.$inferInsert> = {}
	const bookChanged = book !== beforeBook || !args.before
	if (bookChanged) patch.lorebookBranchId = book ? await mostRecentBranchOf(tx, book) : null
	if (args.lorebookBranchId !== undefined) {
		const branchId = args.lorebookBranchId ?? null
		if (branchId !== null) {
			// No attached book: the line is checked against the session's own
			// book's (★bk-fold-1) — never a line of any other book.
			const lineBook =
				book ||
				(args.session
					? ((await (await import("$lib/server/lorebooks/ownBook")).ownBookOf(tx, args.session.id))?.id ?? null)
					: null)
			if (!lineBook) throw new Error("Only a shared lorebook has branches to read.")
			try {
				await branchOfBook(tx, lineBook, branchId)
			} catch (e) {
				if (e instanceof BranchRefusal)
					throw new Error(`That branch is not a branch of this session's lorebook.`)
				throw e
			}
		}
		patch.lorebookBranchId = branchId
	}
	const settingClock = args.clock != null
	const bringingStats = bookChanged && args.session != null
	if (book && (settingClock || bringingStats)) {
		await lockBookCalendar(tx, book)
		const calendar = await bookCalendarOf(tx, book)
		if (bringingStats) {
			const strays = await sessionStatsThatDoNotLand(tx, args.session!, calendar)
			if (strays.length)
				throw new Error(
					`That lorebook's calendar can't place ${strays.length === 1 ? "a date" : `${strays.length} dates`} this session holds: ` +
						strays
							.slice(0, 5)
							.map((s) => `${s.label} (${s.problem})`)
							.join("; ") +
						(strays.length > 5 ? "; …" : "") +
						`. Change ${strays.length === 1 ? "it" : "them"} first, or pick another lorebook.`
				)
		}
		if (settingClock) {
			const problem = clockProblem(args.clock!, calendar)
			if (problem) throw new Error(`That clock does not fit this lorebook. ${problem}`)
		}
	} else if (settingClock) {
		// 🚧 pr-6 (§B-3a): no shared book — the clock is the session's own
		// book's, checked against its calendar (a create's own book is born
		// after the row, with `OWN_BOOK_CALENDAR`).
		const { ownBookOf, OWN_BOOK_CALENDAR } = await import("$lib/server/lorebooks/ownBook")
		const clockBook = args.session ? ((await ownBookOf(tx, args.session.id))?.id ?? null) : null
		if (clockBook != null) await lockBookCalendar(tx, clockBook)
		const calendar = clockBook != null ? await bookCalendarOf(tx, clockBook) : OWN_BOOK_CALENDAR
		const problem = clockProblem(args.clock!, calendar)
		if (problem) throw new Error(`That clock does not fit this lorebook. ${problem}`)
	}
	if (args.clock !== undefined) {
		if (args.clock === null) Object.assign(patch, clockColumns(null))
		else {
			Object.assign(patch, clockColumns(args.clock))
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
> = refusable(
	"sessions:update",
	async (socket, params: Sockets.Sessions.Update.Params, emitToUser) => {
		try {
			// 🚧 pr-6 (ledger A5): the row's two documents are not this form's.
			for (const key of ["metadata", "drafts"] as const)
				if (Object.prototype.hasOwnProperty.call(params.session ?? {}, key))
					throw new Error(SESSION_UPDATE_REFUSALS.rowDocuments)
			const userId = socket.user!.id

			// Check if user has access to update this session
			const sessionAccess = await checkSessionAccess(
				params.session.id!,
				userId
			)
			if (!sessionAccess.hasAccess) {
				throw new Error(
					"Access denied. Only session owners can update sessions."
				)
			}

			// 🚧 One cast member is one character seat (owner 2026-11-05): a list
			// that seats two cards of one member is refused in words, before
			// anything is written. Answered as every refusal of this handler is
			// (a thrown sentence, sent as `sessions:update:error`).
			if (
				params.characterIds !== undefined ||
				params.castMemberIds !== undefined
			) {
				const twice = await sameMemberRefusal(db as unknown as Db, {
					sessionId: params.session.id!,
					cardIds: params.characterIds ?? [],
					castMemberIds: params.castMemberIds
				})
				if (twice) throw new Error(twice)
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

				// The lorebook is never written from here (the book lock below);
				// everything else here is either owner-only data or a reference
				// to an admin-managed global table (samplingConfigs), which
				// needs no ownership check.
				//
				// ⚠ `connectionId` was on that list, then was refused for
				// non-admins, and is now simply gone (0130): a session names no
				// connection at all. The allowlist below IS the strip — a key
				// nobody destructures is a key nothing writes — so an old
				// client still posting the field changes nothing and is told
				// nothing, because there is no boundary left for it to have
				// crossed.
				// The book lock (★B-5, 2026-11-08): a session keeps the lorebook it
				// started with. Said before the owner-only checks and the write. The
				// same value is accepted (old clients post every field) and the
				// book is never written from here, so a book needing the
				// kit/ownership check can only ever be the one already read.
				if (params.session.lorebookId !== undefined) {
					const [now] = await db
						.select({ lorebookId: schema.sessions.lorebookId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, params.session.id!))
					const { bookChangeRefusal } = await import("$lib/server/sessions/bookLock")
					const locked = bookChangeRefusal(
						{ lorebookId: now?.lorebookId ?? null },
						params.session.lorebookId ?? null
					)
					if (locked) throw new Error(locked)
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
					lorebookId,
					genreFields,
					lorebookBranchId,
					storyClockYear,
					storyClockMonth,
					storyClockDay,
					storyClockHour,
					storyClockMinute,
					onRevision,
					rigour
				} = params.session
				// 🚧 On revision (PLAN-rulesets §28): one of the two modes, or
				// refused in a sentence — never quietly read as overwrite.
				if (onRevision !== undefined) {
					const { isOnRevision } = await import("$lib/server/sessions/revision")
					if (!isOnRevision(onRevision))
						throw new Error("On revision must be Overwrite or Branch.")
				}

				// Mode field values, filtered to the keys the session's mode
				// declares (19 §1) — same write rule as creation. `genreId`
				// itself is deliberately absent from this allowlist: switching
				// a session's mode is a policy question 19 §10 leaves open, not an
				// update field.
				let genreFieldsPatch: Record<string, unknown> | undefined
				if (genreFields !== undefined) {
					const { getSessionGenre } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const mode = await getSessionGenre(
						db,
						await sessionGenreOf(db, params.session.id!)
					)
					const declared = Object.keys(
						(mode?.shape as any)?.fields ?? {}
					)
					genreFieldsPatch = Object.fromEntries(
						Object.entries(
							(genreFields ?? {}) as Record<string, unknown>
						).filter(([k]) => declared.includes(k))
					)
					// 🚧 Speech: narrator voice checked here too (lane V V-3).
					const { SPEECH_FIELD_KEYS } = await import("$lib/shared/sessions/speechSettings")
					if (SPEECH_FIELD_KEYS.narratorVoice in genreFieldsPatch) {
						const { narratorVoiceRefusal } = await import("$lib/server/speech/narratorVoiceCheck")
						const refusal = await narratorVoiceRefusal(db, genreFieldsPatch[SPEECH_FIELD_KEYS.narratorVoice])
						if (refusal) throw new Error(refusal)
					}
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

				// How strict may change mid-session (PLAN-rulesets §21, kept by
				// the main session's ruling of 2026-10-20 over R32's gloss) —
				// unless a layer above the session locks it (A10: Rule Based
				// locks `scripts`). Sending the value it already has is no change.
				if (rigour !== undefined && before && rigour !== before.rigour) {
					const { genreSettingsOf } = await import("$lib/server/sessions/exposure")
					const { settings } = await genreSettingsOf(db, params.session.id!, !!socket.user!.isAdmin)
					const locked = settings.find((x) => x.key === "rigour")?.lockedAt
					if (locked)
						throw new Error(
							`How strict is set by the session's ${locked === "preset" ? "preset" : "genre"} and cannot be changed here.`
						)
				}
				// 🚧 A10, R1: a genre field locked by the genre's defaults or the
				// preset, or one that reaches administrators only, is not the
				// owner's to change — refused when the form would change it.
				if (genreFieldsPatch && Object.keys(genreFieldsPatch).length) {
					const { genreSettingsOf } = await import("$lib/server/sessions/exposure")
					const { settings, editable } = await genreSettingsOf(db, params.session.id!, !!socket.user!.isAdmin)
					for (const [k, v] of Object.entries(genreFieldsPatch)) {
						if (editable.has(k)) continue
						const s = settings.find((x) => x.key === k)
						if (!s || JSON.stringify(s.value ?? null) === JSON.stringify(v ?? null)) {
							delete genreFieldsPatch[k]
							continue
						}
						const label = (s.decl as { label?: unknown }).label
						const named = typeof label === "string" ? label : ((label as { en?: string } | undefined)?.en ?? k)
						throw new Error(
							s.lockedAt
								? `${named} is set by the session's ${s.lockedAt === "preset" ? "preset" : "genre"} and cannot be changed here.`
								: `${named} is changed by an administrator.`
						)
					}
				}
				// 🚧 How strict (PLAN-rulesets §21): one of the genre's options,
				// or refused in a sentence that names them in the interface's
				// words (§28).
				if (rigour !== undefined) {
					const { getGenre } = await import("@serene-pub/sdk")
					const { STANDARD_GENRE_ID } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const genre = getGenre(before?.genreId ?? STANDARD_GENRE_ID)
					const options: readonly string[] = genre?.rigour?.options ?? ["prose"]
					if (typeof rigour !== "string" || !options.includes(rigour)) {
						const { rigourLabel } = await import("$lib/shared/rulesets/rigourLabels")
						const named = options.map(rigourLabel)
						throw new Error(
							named.length > 1
								? `How strict must be ${named.slice(0, -1).join(", ")} or ${named[named.length - 1]}.`
								: `This genre plays ${named[0] ?? "Words only"} only.`
						)
					}
				}

				// 🚧 Where the session reads its book (ruling 15, story-time
				// P3): its line and its story clock. Attaching or switching a
				// book starts it at that book's most recently used line with no
				// clock of its own (it follows that line's present); a named
				// branch must be one of the book's own, and a clock must land
				// in its calendar.
				// Refused with a sentence, never quietly read as main. The
				// dates it checks (the clock, the stats a new book takes in)
				// are checked and the row written in one transaction, under
				// the book's calendar lock.
				await db.transaction(async (tx) => {
					const linePatch = await sessionLinePatch(tx, {
						before: before ?? null,
						session: before ? { id: before.id, name: before.name } : undefined,
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

					// Genre fields MERGE over what is stored (2026-10-03): the
					// form sends only the fields the person changed, so a field
					// it never touched — the author's note saved from its widget
					// while the form was open — keeps what was saved. Read
					// inside this transaction, so no write lands between.
					let mergedGenreFields: Record<string, unknown> | undefined
					if (genreFieldsPatch !== undefined) {
						const [stored] = await tx
							.select({ genreFields: schema.sessions.genreFields })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, params.session.id!))
							.limit(1)
						mergedGenreFields = {
							...((stored?.genreFields ?? {}) as Record<string, unknown>),
							...genreFieldsPatch
						}
					}

					await tx
						.update(schema.sessions)
						.set({
							...linePatch,
							...(name !== undefined ? { name } : {}),
							...(sessionType !== undefined ? { sessionType } : {}),
							...(scenario !== undefined ? { scenario } : {}),
							...(onRevision !== undefined ? { onRevision } : {}),
							...(rigour !== undefined ? { rigour } : {}),
							...(mergedGenreFields !== undefined
								? { genreFields: mergedGenreFields }
								: {}),
							updatedAt: new Date()
						})
						.where(eq(schema.sessions.id, params.session.id!))
				})
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

				// 🚧 The scene settings override (live scenes §4–§5): on the
				// row's metadata, as its own key, like the label above. A
				// declaration that does not read is refused with its
				// sentences; null clears it. The session's open pages hear
				// the new settings (and the cues they now offer).
				if (params.sceneSettings !== undefined) {
					const { writeSceneSettings } = await import(
						"$lib/server/sessions/sceneSettings"
					)
					await writeSceneSettings(
						db,
						params.session.id!,
						params.sceneSettings ?? null
					)
					const { pushSceneCues } = await import(
						"$lib/server/scenes/boundaryWatcher"
					)
					await pushSceneCues(socket.io, params.session.id!)
				}

				// Process tags after session update — only when the caller sent a
				// tag list: a partial update (the Author's note Scenario, taking a
				// seat) omits `tags`, and reading that as "no tags" deleted every
				// tag the owner had on the session (lay-C scope review, 2026-11-06).
				if (params.tags !== undefined)
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
							"lorebookId",
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
					// did, so every tab reads its state afresh. 🚧 So did a genre
					// field (PLAN-dc-after-walk2 Q1-7): Honour mode decides who
					// may change a sheet by hand, and a guest's piece popover
					// gained its Edit, Give to… and Remove only on a reload.
					if (
						changed.some((c) =>
							c === "lorebookId" || c === "lorebookBranchId" || c === "storyClock" || c === "genreFields"
						)
					)
						await broadcastToSessionUsers(socket.io, params.session.id!, "state:changed", {
							sessionId: params.session.id!
						} satisfies Sockets.State.Changed.Response)
					if (!same(tagsBefore, tagsAfter)) changed.push("tags")
					// The owner's other open forms refresh what they hold of
					// these fields (2026-10-03) — the owner alone edits them.
					if (changed.includes("genreFields") && after)
						emitToUser("sessions:genreFieldsChanged", {
							sessionId: params.session.id!,
							genreFields: (after.genreFields ?? {}) as Record<string, unknown>
						} satisfies Sockets.Sessions.GenreFieldsChanged.Response)
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
								cause: { kind: "settings", userId, ...appletCallerOf(params) }
							},
							io: socket.io
						})
						// 🚧 An owner's setting change is an interaction (R11,
						// R21), and a clock they moved is a session moment
						// (PLAN-layering D7, lane 6) — once, from where it stood.
						const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
						await noteInteraction(db, params.session.id!, "setting")
						if (changed.includes("storyClock") && before && after) {
							const { clockOf } = await import("$lib/server/state/storyTime")
							const from = clockOf(before as never)
							const to = clockOf(after as never)
							if (from && to) {
								const { noteStoryClockMoved } = await import("$lib/server/pipelines/routines/moments")
								await noteStoryClockMoved(db, {
									sessionId: params.session.id!,
									userId,
									cause: { kind: "settings", userId, ...appletCallerOf(params) },
									from,
									to,
									io: socket.io
								})
							}
						}
					}
				} catch (err) {
					console.warn("session-updated emit failed:", err)
				}
			}

			// Membership changes are the seat writer's to say: each write below
			// (`seatCast`, `seatPlayer`, `settleSeats`, `unseat`, the seat-name
			// writers) hands back what it changed, and `announceSeatChanges`
			// dispatches them as member events (24 §5) once the writes are
			// done. The snapshot is kept only for a reorder (`cast-changed`
			// `position`), which no writer reports.
			const seatChanges: SeatChange[] = []
			const memberSnapshot = async () => {
				const ccs = await db.query.sessionCharacters.findMany({
					where: (cc, { eq }) => eq(cc.sessionId, params.session.id!)
				})
				const cps = await db.query.sessionPersonas.findMany({
					where: (cp, { eq }) => eq(cp.sessionId, params.session.id!)
				})
				// Card-less seats announce like any seat: live is S4's seat
				// rule (not an envoy, a member or a card).
				const liveCcs = ccs.filter(
					(c) =>
						!c.removedAt &&
						c.envoySlug == null &&
						(c.characterId != null || c.castMemberId != null)
				)
				const liveCps = cps.filter(
					(c) => !c.removedAt && c.personaId != null
				)
				const { hostSeatRefOf } = await import(
					"$lib/server/pipelines/prompt/seatCards"
				)
				// A seat's ref: the member form once the flip is on, else
				// the card form (a persona is a character row, 0132).
				const ccRef = (c: (typeof liveCcs)[number]) =>
					hostSeatRefOf({
						kind: "character",
						seatId: c.id,
						castMemberId: c.castMemberId,
						cardId: c.characterId
					})
				const cpRef = (c: (typeof liveCps)[number]) =>
					hostSeatRefOf({
						kind: "player",
						seatId: c.id,
						castMemberId: c.castMemberId,
						cardId: c.personaId
					}) ?? `character:${c.personaId}`
				// A seat with no ref at all is skipped rather than given a bad one.
				const refCcs = liveCcs.filter((c) => ccRef(c) != null)
				return {
					// Seat positions by participant reference, for the
					// `cast-changed` diff (PLAN-turn-order §4.1): a reorder
					// is a cast change, not a membership one. The seat's
					// ref is `hostSeatRefOf`'s: the member form once the
					// flip is on, else the card form (a persona is a
					// character row, 0132).
					positions: new Map<string, number>([
						...refCcs.map(
							(c) => [ccRef(c) as string, c.position ?? 0] as const
						),
						...liveCps.map((c) => [cpRef(c), c.position ?? 0] as const)
					])
				}
			}
			// A request carrying only `castMemberIds` seats card-less members, so
			// it takes the snapshot too.
			const membersBefore =
				params.characterIds !== undefined ||
				params.personaIds !== undefined ||
				params.castMemberIds !== undefined
					? await memberSnapshot()
					: null

			// Sync sessionCharacters if provided
			if (params.characterIds !== undefined) {
				const existingCCs = await db.query.sessionCharacters.findMany({
					where: (cc, { eq }) => eq(cc.sessionId, params.session.id!),
					// Ids and the owner only; the name a departed seat falls
					// back to is the card now (below), never the row's copy.
					with: { character: { columns: { id: true, userId: true } } }
				})
				await putCardsNow([{ rows: existingCCs, key: "character" }])
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
						throw new Error(
							"Access denied. You can only add characters you own."
						)
					}
				}

				// Removal is a soft delete, not a hard delete, so past
				// messages can still resolve who spoke them. Guests may only
				// remove characters they themselves own; the session owner may
				// remove anyone's. A row the caller isn't permitted to touch
				// is simply left alone (not removed, no error), matching
				// this handler's existing per-row tolerance.
				// 🚧 (seat-cast S2) The name a departed seat keeps is its
				// member as read, not the card it holds.
				const seatsLeaving = activeCCs.filter(
					(cc) =>
						cc.characterId !== null &&
						!newCharacterIds.has(cc.characterId) &&
						(sessionAccess.isOwner ||
							cc.character?.userId === userId)
				)
				const { seatCardsAsRead } = await import(
					"$lib/server/pipelines/prompt/seatCards"
				)
				const seatsLeavingAsRead = new Map(
					(
						await seatCardsAsRead(
							db as unknown as Db,
							params.session.id!,
							seatsLeaving
						)
					).map((read) => [read.id, read.character])
				)
				for (const cc of activeCCs) {
					if (cc.characterId === null) continue
					if (!newCharacterIds.has(cc.characterId)) {
						const canRemove =
							sessionAccess.isOwner ||
							cc.character?.userId === userId
						if (!canRemove) continue
						seatChanges.push(
							...(await unseat(db, {
								sessionId: params.session.id!,
								kind: "character",
								seatId: cc.id,
								removedName: resolveCharacterName(
									(seatsLeavingAsRead.get(cc.id) ??
										cc.character) as SeatCardNames | null,
									"Unknown"
								)
							}))
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
						// The seat writer does both and gives the seat its member.
						const seat = await db.transaction(async (tx) =>
							seatCast(tx as unknown as Db, {
								sessionId: params.session.id!,
								cardId: characterId,
								position,
								seatedBy: userId
							})
						)
						if (!seat.ok) throw new Error(seat.refusal)
						seatChanges.push(...seat.changes)
						// Committed: a member just made is named from its card.
						await syncMintedSeatMembers(db, seat.mintedMembers)
					}
				}
				// A group counts its card-less seats too (plan §34.2).
				const [cardless] = await db
					.select({ n: sql<number>`count(*)::int` })
					.from(schema.sessionCharacters)
					.where(
						and(
							eq(schema.sessionCharacters.sessionId, params.session.id!),
							isNull(schema.sessionCharacters.removedAt),
							isNull(schema.sessionCharacters.envoySlug),
							isNull(schema.sessionCharacters.characterId),
							isNotNull(schema.sessionCharacters.castMemberId)
						)
					)
				await db
					.update(schema.sessions)
					.set({ isGroup: params.characterIds.length + (cardless?.n ?? 0) > 1 })
					.where(eq(schema.sessions.id, params.session.id!))
			}

			// 🚧 Sync the card-less character seats (plan §34.2) if provided: members
			// of the session's books seated without a card. Only these rows are
			// diffed here — a carded row is the `characterIds` diff's.
			if (params.castMemberIds !== undefined) {
				const cs = schema.sessionCharacters
				const wanted = [...new Set(params.castMemberIds)]
				const seats = await db
					.select({
						id: cs.id,
						castMemberId: cs.castMemberId,
						seatedBy: cs.seatedByUserId,
						position: cs.position,
						characterId: cs.characterId
					})
					.from(cs)
					.where(
						and(
							eq(cs.sessionId, params.session.id!),
							isNull(cs.removedAt),
							isNull(cs.envoySlug),
							or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
						)
					)
				const cardless = seats.filter(
					(seat) => seat.characterId === null && seat.castMemberId !== null
				)
				const heldMembers = new Set(cardless.map((seat) => seat.castMemberId))
				let nextPosition =
					Math.max(-1, ...seats.map((seat) => seat.position ?? 0)) + 1
				for (const castMemberId of wanted) {
					if (heldMembers.has(castMemberId)) continue
					const seat = await db.transaction(async (tx) =>
						seatCast(tx as unknown as Db, {
							sessionId: params.session.id!,
							castMemberId,
							position: nextPosition++,
							seatedBy: userId
						})
					)
					if (!seat.ok) throw new Error(seat.refusal)
					seatChanges.push(...seat.changes)
				}
				// A seat leaves when the caller is the session's owner or seated it.
				const leaving = cardless.filter(
					(seat) =>
						!wanted.includes(seat.castMemberId!) &&
						(sessionAccess.isOwner || seat.seatedBy === userId)
				)
				if (leaving.length) {
					const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
					const asRead = await membersAsRead(
						db as unknown as Db,
						leaving.map((seat) => seat.castMemberId!),
						{ sessionId: params.session.id! }
					)
					for (const seat of leaving)
						seatChanges.push(
							...(await unseat(db, {
								sessionId: params.session.id!,
								kind: "character",
								seatId: seat.id,
								removedName: resolveCharacterName(
									asRead.get(seat.castMemberId!),
									"Unknown"
								)
							}))
						)
				}
				const [live] = await db
					.select({ n: sql<number>`count(*)::int` })
					.from(cs)
					.where(
						and(
							eq(cs.sessionId, params.session.id!),
							isNull(cs.removedAt),
							isNull(cs.envoySlug),
							or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
						)
					)
				await db
					.update(schema.sessions)
					.set({ isGroup: (live?.n ?? 0) > 1 })
					.where(eq(schema.sessions.id, params.session.id!))
			}

			// Sync sessionPersonas if provided
			if (params.personaIds !== undefined) {
				const existingCPs = await db.query.sessionPersonas.findMany({
					where: (cp, { eq }) => eq(cp.sessionId, params.session.id!),
					with: { persona: { columns: { id: true, userId: true } } }
				})
				await putCardsNow([{ rows: existingCPs, key: "persona" }])
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
						throw new Error(
							"Access denied. You can only add personas you own."
						)
					}
				}

				// Soft delete, same rule as characters above: guests may only
				// remove personas they own; the session owner may remove anyone's.
				// 🚧 The name a departed player seat keeps is its member as read
				// (★pT-1, 2026-11-05: "Everything in session is cast -> active
				// card"), a seat name still winning (`withSeatName`).
				const personaSeatsLeaving = activeCPs.filter(
					(cp) =>
						cp.personaId !== null &&
						!newPersonaIds.has(cp.personaId) &&
						(sessionAccess.isOwner ||
							cp.persona?.userId === userId)
				)
				const { seatCardsAsRead: personaSeatsAsRead } = await import(
					"$lib/server/pipelines/prompt/seatCards"
				)
				const { withSeatName: nameOverSeat } = await import(
					"$lib/server/sessions/seatName"
				)
				const personaSeatsLeavingAsRead = new Map(
					(
						await personaSeatsAsRead(
							db as unknown as Db,
							params.session.id!,
							personaSeatsLeaving.map((cp) => ({
								...cp,
								character: cp.persona as SeatCardNames | null
							}))
						)
					).map((read) => [
						read.id,
						nameOverSeat(read.character, read.seatName)
					])
				)
				for (const cp of activeCPs) {
					if (cp.personaId === null) continue
					if (!newPersonaIds.has(cp.personaId)) {
						const canRemove =
							sessionAccess.isOwner ||
							cp.persona?.userId === userId
						if (!canRemove) continue
						seatChanges.push(
							...(await unseat(db, {
								sessionId: params.session.id!,
								kind: "player",
								seatId: cp.id,
								removedName: resolvePersonaName(
									personaSeatsLeavingAsRead.get(cp.id) ??
										(cp.persona as SeatCardNames | null),
									"Unknown"
								)
							}))
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
					} else if (
						// 🚧 The card's player's card-less player seat takes it,
						// keeping its name and stats (`givePlayerSeatACard`).
						await (
							await import("$lib/server/sessions/seatName")
						).givePlayerSeatACard(db, params.session.id!, personaId)
					) {
						// The seat now has a card: it gets its cast member.
						const settled = await db.transaction(async (tx) =>
							settleSeats(tx as unknown as Db, params.session.id!)
						)
						seatChanges.push(...settled.changes)
						await syncMintedSeatMembers(db, settled.mintedMembers)
						await db
							.update(schema.sessionPersonas)
							.set({ position: i })
							.where(
								and(
									eq(schema.sessionPersonas.sessionId, params.session.id!),
									eq(schema.sessionPersonas.personaId, personaId)
								)
							)
						await markCharacterAsPersona(personaId)
					} else {
						// Upsert: revive a soft-removed row if one exists for
						// this sessionId + personaId rather than violating the
						// unique index on that pair (the seat writer's default).
						const seat = await db.transaction(async (tx) =>
							seatPlayer(tx as unknown as Db, {
								sessionId: params.session.id!,
								personaId,
								position: i
							})
						)
						seatChanges.push(...seat.changes)
						await syncMintedSeatMembers(db, seat.mintedMembers)
						await markCharacterAsPersona(personaId)
					}
				}
			}

			// 🚧 A seat name (2026-10-14): the caller's character name in this
			// session, or — the owner only — any seat's by `playerSeatId`. Absent
			// leaves it alone; blank or null clears it. Naming a seat the
			// caller does not have opens a card-less one for them.
			if (params.seatName !== undefined) {
				const { writeSeatName } = await import(
					"$lib/server/sessions/seatName"
				)
				await writeSeatName(db, {
					sessionId: params.session.id!,
					userId,
					isOwner: sessionAccess.isOwner,
					playerSeatId: params.playerSeatId ?? null,
					name: params.seatName,
					changes: seatChanges
				})
			}

			// 🚧 Card-less player seats renamed or removed in Edit Session
			// (`editCardlessPlayerSeats`). A first remove benches the seat; only
			// an unused benched seat is removed. It reports `unseat`'s change.
			if (params.playerSeatChanges?.length) {
				const { editCardlessPlayerSeats } = await import(
					"$lib/server/sessions/seatName"
				)
				await editCardlessPlayerSeats(db, {
					sessionId: params.session.id!,
					userId,
					isOwner: sessionAccess.isOwner,
					changes: params.playerSeatChanges,
					seatChanges
				})
			}

			// The member events (24 §5), best-effort and after every seat
			// write: a failed dispatch must never fail the update that caused it.
			await announceSeatChanges(
				db,
				socket.io,
				{ sessionId: params.session.id!, userId },
				seatChanges
			)

			// A reorder is not a membership change, so never a member event.
			if (membersBefore) {
				try {
					const after = await memberSnapshot()
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
			// A seat named, renamed or removed is every member's news, not
			// the caller's alone: the persona list with its `seatName` goes
			// to each member's page, as an added persona's does.
			if (params.seatName !== undefined || params.playerSeatChanges?.length)
				await broadcastSessionToParticipants(socket, params.session.id!, userId)
			// Refresh session list, behind the reply that carries the session.
			await relistSessions(socket, emitToUser)
			// 🚧 A lorebook attached or dropped: each book's "Read by" moved.
			if (params.session.lorebookId !== undefined) {
				const { relistLorebooks } = await import("./lorebooks")
				relistLorebooks(socket, emitToUser)
			}
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
			throw error
		}
	},
	"The session could not be saved."
)

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

			// A benched seat comes back rather than being refused (benched seats).
			if (
				existingSessionPersona &&
				existingSessionPersona.removedAt == null &&
				existingSessionPersona.isActive === false
			) {
				const back = await db.transaction(async (tx) =>
					setSeatBench(tx as unknown as Db, {
						sessionId,
						kind: "player",
						seatId: existingSessionPersona.id,
						benched: false
					})
				)
				if (!back.ok) {
					const res: Sockets.Sessions.AddPersona.Response = {
						success: false,
						error: back.refusal
					}
					emitToUser("sessions:addPersona", res)
					return res
				}
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId, userId },
					back.changes
				)
				await broadcastSessionToParticipants(socket, sessionId, userId)
				await (
					await import("$lib/server/sessions/actionsPush")
				).pushSessionActions(socket.io, sessionId)
				const res: Sockets.Sessions.AddPersona.Response = {
					success: true
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

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

			// Add persona to session — 🚧 into its player's card-less player seat
			// when they have one (`givePlayerSeatACard`), else on a row of its own.
			const { givePlayerSeatACard } = await import("$lib/server/sessions/seatName")
			const seatChanges: SeatChange[] = []
			if (await givePlayerSeatACard(db, sessionId, personaId)) {
				// The seat now has a card: it gets its cast member.
				const settled = await db.transaction(async (tx) =>
					settleSeats(tx as unknown as Db, sessionId)
				)
				seatChanges.push(...settled.changes)
				await syncMintedSeatMembers(db, settled.mintedMembers)
			} else {
				const seat = await db.transaction(async (tx) =>
					seatPlayer(tx as unknown as Db, {
						sessionId,
						personaId,
						position: nextPosition,
						onExisting: "insert"
					})
				)
				seatChanges.push(...seat.changes)
				await syncMintedSeatMembers(db, seat.mintedMembers)
			}
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

			// The seat has landed: `member-added` (a card-less seat taking this
			// card changes no seat's ref, so says nothing).
			await announceSeatChanges(db, socket.io, { sessionId, userId }, seatChanges)

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
					.select({ id: schema.sessionPersonas.id })
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
 * 🚧 The overlay's items (PLAN-rulesets §15, §26): what the session wrote to
 * its own notes while it read a lorebook it could not write — the review
 * queue lists them beside the value proposals. Anyone in the session reads
 * them; only the lorebook's owner may apply them.
 */
export const sessionsOverlayItemsHandler: Handler<
	Sockets.Sessions.OverlayItems.Params,
	Sockets.Sessions.OverlayItems.Response
> = refusable(
	"sessions:overlayItems",
	async (socket, params: Sockets.Sessions.OverlayItems.Params, emitToUser) => {
		const access = await checkSessionAccess(params.sessionId, socket.user!.id)
		if (!access.hasAccess) throw new Error("This session is not one you are in.")
		const { overlayItemsOf, overlayAccessOf } = await import("$lib/server/lorebooks/ownBook")
		const res: Sockets.Sessions.OverlayItems.Response = {
			sessionId: params.sessionId,
			items: await overlayItemsOf(db, params.sessionId),
			...(await overlayAccessOf(db, params.sessionId, socket.user!.id))
		}
		emitToUser("sessions:overlayItems", res)
		return res
	},
	"The session's changes could not be read."
)

/**
 * 🚧 **Apply to the lorebook** (PLAN-rulesets §26): overlay items move into
 * the attached lorebook with their provenance and leave the notes; 🚧 a held
 * change to a lorebook entry is folded in (`amendmentIds`). One item
 * (`entryIds: [id]`) or all (both absent). The lorebook's owner only.
 */
export const sessionsApplyOverlayHandler: Handler<
	Sockets.Sessions.ApplyOverlay.Params,
	Sockets.Sessions.ApplyOverlay.Response
> = refusable(
	"sessions:applyOverlay",
	async (socket, params: Sockets.Sessions.ApplyOverlay.Params, emitToUser) => {
		const { applyOverlayItems } = await import("$lib/server/lorebooks/ownBook")
		const entryIds = Array.isArray(params.entryIds)
			? params.entryIds.filter((id): id is number => Number.isSafeInteger(id))
			: null
		const amendmentIds = Array.isArray(params.amendmentIds)
			? params.amendmentIds.filter((id): id is number => Number.isSafeInteger(id))
			: null
		const linkIds = Array.isArray(params.linkIds)
			? params.linkIds.filter((id): id is number => Number.isSafeInteger(id))
			: null
		const done = await applyOverlayItems(db, {
			sessionId: params.sessionId,
			userId: socket.user!.id,
			entryIds,
			amendmentIds,
			linkIds
		})
		const res: Sockets.Sessions.ApplyOverlay.Response = {
			sessionId: params.sessionId,
			lorebookId: done.lorebookId,
			applied: done.applied,
			appliedChanges: done.appliedChanges,
			stillHeld: done.stillHeld,
			appliedLinks: done.appliedLinks,
			mergedDays: done.mergedDays,
			droppedLinks: done.droppedLinks,
			heldDays: done.heldDays,
			batch: done.batch
		}
		emitToUser("sessions:applyOverlay", res)
		// The transaction has committed: say where the settle line went, then move every member's card.
		if (done.settled) {
			const { announceHistorySettled } = await import("$lib/server/sessions/settle")
			await announceHistorySettled(db, {
				sessionId: params.sessionId,
				userId: socket.user!.id,
				...done.settled,
				io: socket.io
			})
		}
		await tellApplyMoved(socket.io, params.sessionId)
		return res
	},
	"The changes could not be applied to the lorebook."
)

/**
 * 🚧 What was applied from this session, one batch per Apply, newest first.
 * Anyone in the session reads it; only the lorebook's owner takes one back.
 */
export const sessionsAppliedBatchesHandler: Handler<
	Sockets.Sessions.AppliedBatches.Params,
	Sockets.Sessions.AppliedBatches.Response
> = refusable(
	"sessions:appliedBatches",
	async (socket, params: Sockets.Sessions.AppliedBatches.Params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess) throw new Error("This session is not one you are in.")
		const { appliedBatchesOf, overlayAccessOf } = await import("$lib/server/lorebooks/ownBook")
		const res: Sockets.Sessions.AppliedBatches.Response = {
			sessionId: params.sessionId,
			batches: await appliedBatchesOf(db, params.sessionId),
			mayApply: (await overlayAccessOf(db, params.sessionId, userId)).mayApply
		}
		emitToUser("sessions:appliedBatches", res)
		return res
	},
	"The session's applied changes could not be read."
)

/**
 * 🚧 **Take back** one Apply, all or nothing. The lorebook's owner only. A
 * refusal is said in place (`refused`), never as an error toast.
 */
export const sessionsTakeBackApplyHandler: Handler<
	Sockets.Sessions.TakeBackApply.Params,
	Sockets.Sessions.TakeBackApply.Response
> = refusable(
	"sessions:takeBackApply",
	async (socket, params: Sockets.Sessions.TakeBackApply.Params, emitToUser) => {
		if (!Number.isSafeInteger(params?.sessionId) || typeof params?.batch !== "string" || !params.batch)
			throw new Error("Take back needs a session and an apply.")
		const { takeBackApply, OwnBookRefusal } = await import("$lib/server/lorebooks/ownBook")
		let res: Sockets.Sessions.TakeBackApply.Response
		try {
			await takeBackApply(db, { batch: params.batch, userId: socket.user!.id, sessionId: params.sessionId })
			res = { sessionId: params.sessionId, batch: params.batch, refused: null }
		} catch (e) {
			if (!(e instanceof OwnBookRefusal)) throw e
			res = { sessionId: params.sessionId, batch: params.batch, refused: e.message }
		}
		emitToUser("sessions:takeBackApply", res)
		if (res.refused == null) await tellApplyMoved(socket.io, params.sessionId)
		return res
	},
	"The apply could not be taken back.",
	undefined,
	(p) => ({ sessionId: (p as any)?.sessionId })
)

/**
 * 🚧 Every member of the session is sent their own two lists again — after an
 * Apply, a take-back, or a change that applied by itself — so the card shows
 * it (P1). The server is the `io` given, else the one the socket layer keeps
 * on `globalThis` (a caller with no socket: a scene closing, the boundary
 * watcher). Never throws.
 */
export async function tellApplyMoved(io: unknown, sessionId: number): Promise<void> {
	try {
		const server = (io ??
			(globalThis as { __SERENE_PUB_SOCKET_STATE__?: { io?: unknown } }).__SERENE_PUB_SOCKET_STATE__?.io) as any
		if (!server) return
		const { overlayItemsOf, overlayAccessOf, appliedBatchesOf } = await import("$lib/server/lorebooks/ownBook")
		const items = await overlayItemsOf(db, sessionId)
		const batches = await appliedBatchesOf(db, sessionId)
		for (const uid of await getSessionUserIds(sessionId)) {
			const { mayApply, appliesItself } = await overlayAccessOf(db, sessionId, uid)
			await emitToUserRedacted(server, uid, "sessions:overlayItems", {
				sessionId,
				items,
				mayApply,
				appliesItself
			} satisfies Sockets.Sessions.OverlayItems.Response)
			await emitToUserRedacted(server, uid, "sessions:appliedBatches", {
				sessionId,
				batches,
				mayApply
			} satisfies Sockets.Sessions.AppliedBatches.Response)
		}
	} catch (e) {
		console.warn(`[apply] the lists could not be re-sent for session ${sessionId}:`, e)
	}
}

/**
 * 🚧 The moments held changes apply by themselves (scene close, summary saved,
 * Close out): run `applyHeldAutomatically`, then — after its transaction —
 * announce the settle line and move every member's card. Never throws, so it
 * never fails what triggered it. Never call it with a transaction handle.
 */
export async function applyHeldAutomaticallyAndTell(
	handle: Db,
	input: { sessionId: number; automatic: AutomaticApplyCause; sceneId?: number; before?: number; io?: unknown }
): Promise<void> {
	try {
		const { applyHeldAutomatically } = await import("$lib/server/lorebooks/ownBook")
		const result = await applyHeldAutomatically(handle, {
			sessionId: input.sessionId,
			automatic: input.automatic,
			...(input.sceneId != null ? { sceneId: input.sceneId } : {}),
			...(input.before != null ? { before: input.before } : {})
		})
		if (!result || (!result.applied.length && !result.appliedChanges.length && !result.dropped.length)) return
		const server = (input.io ??
			(globalThis as { __SERENE_PUB_SOCKET_STATE__?: { io?: unknown } }).__SERENE_PUB_SOCKET_STATE__?.io) as any
		if (result.settled) {
			const { announceHistorySettled } = await import("$lib/server/sessions/settle")
			await announceHistorySettled(handle, {
				sessionId: input.sessionId,
				userId: result.userId,
				...result.settled,
				io: server ?? undefined,
				cause: { kind: "system" }
			})
		}
		await tellApplyMoved(server, input.sessionId)
	} catch (e) {
		console.warn(`[apply] the automatic apply for session ${input.sessionId} could not be announced:`, e)
	}
}

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
 * Re-points a removed (soft-deleted) or benched session participant's message
 * history to a new character/persona, and makes the new one an active participant — the
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
					where: (cc, { and, eq, isNotNull, or }) =>
						and(
							eq(cc.sessionId, sessionId),
							eq(cc.characterId, oldId),
							or(isNotNull(cc.removedAt), eq(cc.isActive, false))
						),
					with: { character: { columns: { id: true, userId: true } } }
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
				// A refused seat (a second card of a member already seated —
				// `seatCast`) rolls the whole transaction back and is answered
				// in its own words.
				const refused: { sentence?: string } = {}
				let reassignedMinted: MintedSeatMember[] = []
				let reassignedChanges: SeatChange[] = []
				try {
					await db.transaction(async (tx) => {
						const seat = await seatCast(tx as unknown as Db, {
							sessionId,
							cardId: newId,
							position: removedCC.position ?? 0,
							seatedBy: userId
						})
						if (!seat.ok) {
							refused.sentence = seat.refusal
							throw new Error(seat.refusal)
						}
						reassignedMinted = seat.mintedMembers
						reassignedChanges = seat.changes
						// The lines are now spoken by the new seat: stamp
						// its member (the seat is written first, so it is
						// there to be read).
						await updateLegacyWhere(
							tx,
							and(
								eq(schema.sessionMessages.sessionId, sessionId),
								eq(schema.sessionMessages.characterId, oldId)
							),
							{
								characterId: newId,
								castMemberId:
									(
										await seatOf(
											tx as unknown as Db,
											sessionId,
											`character:${newId}`
										)
									)?.castMemberId ?? null
							}
						)
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
				} catch (e) {
					if (refused.sentence === undefined) throw e
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{ error: refused.sentence }
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}
				// A benched seat was live: deleting it takes its member off the
				// roster, so say so (a removed row left the roster already).
				if (removedCC.removedAt === null)
					reassignedChanges.push({
						kind: "character",
						change: "removed",
						seatId: removedCC.id,
						castMemberId: removedCC.castMemberId ?? null,
						cardId: oldId
					})
				await syncMintedSeatMembers(db, reassignedMinted)
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId, userId },
					reassignedChanges
				)
			} else {
				const removedCP = await db.query.sessionPersonas.findFirst({
					where: (cp, { and, eq, isNotNull, or }) =>
						and(
							eq(cp.sessionId, sessionId),
							eq(cp.personaId, oldId),
							or(isNotNull(cp.removedAt), eq(cp.isActive, false))
						),
					with: { persona: { columns: { id: true, userId: true } } }
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

				let reassignedMinted: MintedSeatMember[] = []
				let reassignedChanges: SeatChange[] = []
				await db.transaction(async (tx) => {
					const playerSeat = await seatPlayer(tx as unknown as Db, {
						sessionId,
						personaId: newId,
						position: removedCP.position ?? 0
					})
					reassignedMinted = playerSeat.mintedMembers
					reassignedChanges = playerSeat.changes
					// The lines are now spoken by the new player seat:
					// stamp the member that seat just took.
					await updateLegacyWhere(
						tx,
						and(
							eq(schema.sessionMessages.sessionId, sessionId),
							eq(schema.sessionMessages.personaId, oldId)
						),
						{
							personaId: newId,
							castMemberId: playerSeat.castMemberId
						}
					)
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
				// A benched seat was live: deleting it takes its member off the
				// roster, so say so (a removed row left the roster already).
				if (removedCP.removedAt === null)
					reassignedChanges.push({
						kind: "player",
						change: "removed",
						seatId: removedCP.id,
						castMemberId: removedCP.castMemberId ?? null,
						cardId: oldId
					})
				await syncMintedSeatMembers(db, reassignedMinted)
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId, userId },
					reassignedChanges
				)
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
				await pushSessionToParticipants(socket.io, sessionId, userId)
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
			let channel = canonicalChannel(params.channel)
			/**
			 * 🚧 Every answer but a saved message is a **refusal**: a sentence
			 * the person reads, nothing saved, and their text given back by
			 * the composer (owner ruling 2026-10-15 — never lose text).
			 */
			const refuse = (sentence: string, runId?: string) => {
				const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
					sessionId,
					refused: sentence,
					...(runId ? { runId } : {})
				}
				emitToUser("sessionMessages:sendPersonaMessage", res)
				return res
			}

			// Check if user has access to this session (both owners and guests can send messages)
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.hasAccess) {
				return refuse("Access denied. Session not found or no permission to access.")
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
					return refuse(modeCheck.reason ?? "This session is read-only.")
				}
			}

			// Check if user owns the persona they're trying to use
			if (personaId) {
				const canUsePersona = await checkPersonaOwnership(
					personaId,
					userId
				)
				if (!canUsePersona) {
					return refuse("Access denied. You can only send messages with personas you own.")
				}
			}

			// Check if session exists
			const session = await getPromptSessionFromDb(sessionId, userId)
			if (!session) {
				return refuse("Session not found")
			}

			if (content && content.length > MAX_CHAT_MESSAGE_LENGTH) {
				return refuse(`Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`)
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
					return refuse(`Cannot send here: ${refusal}`)
				}
			}

			/**
			 * 🚧 A **personal** channel (owner ruling 2026-10-17): the send
			 * lands on the sender's own lane — a bare slug resolves to it,
			 * opening it on first use — and a lane that is not theirs is
			 * refused, the session's owner included: reading every lane is
			 * not writing in somebody else's.
			 */
			{
				const { isPersonalChannel, laneFor, sessionLaneFacts, LaneRefusal } = await import(
					"$lib/server/channels/lanes"
				)
				const facts = await sessionLaneFacts(db, sessionId)
				const asked = parseChannel(typeof params.channel === "string" ? params.channel : channel)
				if (facts && isPersonalChannel(facts.shape, asked.slug)) {
					try {
						const own = await laneFor(db, sessionId, asked.slug, userId)
						if (asked.explicit && formatChannel(asked) !== own.channel)
							return refuse("Cannot send here: that lane is another person's.")
						channel = own.channel
					} catch (error) {
						if (error instanceof LaneRefusal) return refuse(`Cannot send here: ${error.message}`)
						throw error
					}
				}
			}

			// 🚧 A line with no persona from a card-less player seat speaks from
			// that seat (`player-seat:<id>`), as an envoy's line names its envoy —
			// the fact the turn order reads to call it that seat's turn.
			const { cardlessPlayerSeatOf, playerSeatSpeaker } = await import(
				"$lib/server/sessions/seatName"
			)
			/**
			 * 🚧 A card whose seats here are all out of play, benched or removed
			 * (a new character after a death, PLAN-dc-after-walk2 Q0-2, owner
			 * ruling ★2; the bench, 2026-11-10): the card stays with the fallen
			 * seat, and a line sent with it while the person has an in-play
			 * card-less seat speaks from that seat — the new character,
			 * under its own name, whose line the round counts. A composer from
			 * before the seat moved still sends the card.
			 */
			let speakingCard = personaId ?? null
			if (speakingCard) {
				const held = await db
					.select({
						removedAt: schema.sessionPersonas.removedAt,
						isActive: schema.sessionPersonas.isActive
					})
					.from(schema.sessionPersonas)
					.where(
						and(
							eq(schema.sessionPersonas.sessionId, sessionId),
							eq(schema.sessionPersonas.personaId, speakingCard)
						)
					)
				if (held.length && held.every((h) => !inPlay(h))) {
					if ((await cardlessPlayerSeatOf(db, sessionId, userId)) !== null) speakingCard = null
				}
			}
			const seatId = speakingCard ? null : await cardlessPlayerSeatOf(db, sessionId, userId)

			/**
			 * Attachments (PLAN-composer-attachments §3.1): the sender's ready
			 * tray items become `core:image` / `core:file` parts of the saved
			 * row, in one transaction with it — or the save is refused whole
			 * and the tray stays. The ids are checked for shape here, at the
			 * door; the rest (theirs, ready, a kind the reply reads) at the
			 * write. Guests send the same way (D8).
			 */
			const { normaliseTrayItemIds } = await import("$lib/server/attachments/send")
			const { TrayRefusal } = await import("$lib/server/attachments/tray")
			let trayItemIds: string[]
			try {
				trayItemIds = normaliseTrayItemIds(params.trayItemIds)
			} catch (error) {
				if (!(error instanceof TrayRefusal)) throw error
				return refuse(error.message)
			}

			/**
			 * 🚧 **Saved through the pipeline** (owner ruling 2026-10-15): the
			 * door is checked — a composer the genre closed on this lane is
			 * refused inside the offer (`composerRefusal`), with its reason —
			 * so the message is offered to the session's save
			 * pipeline (`message-offered`) — core's `core:spec/save-message`
			 * unless the genre binds its own — which writes the row, announces
			 * it and fires its `message-completed` under the person's cause.
			 * The host writes no person's row. A refusal comes back as a
			 * sentence, and the composer restores the text.
			 */
			const { offerMessage } = await import("$lib/server/sessions/offerMessage")
			const outcome = await offerMessage(db, {
				sessionId,
				userId,
				speaker: speakingCard
					? await playerSeatRefOfPersona(db, sessionId, speakingCard)
					: seatId !== null
						? playerSeatSpeaker(seatId)
						: null,
				channel,
				text: content ?? "",
				trayItemIds,
				replyTo: params.replyTo ?? null,
				io: socket.io
			})
			if ("refused" in outcome)
				return refuse(outcome.refused, outcome.runId)

			// The saved row, with parts on it when it carries any — the same
			// enrichment a load gets — so the sender's composer clears on the
			// answer itself rather than racing the push.
			const saved =
				outcome.messageId !== null
					? await db.query.sessionMessages.findFirst({
							where: (m, { eq }) => eq(m.id, outcome.messageId!)
						})
					: undefined
			const outbound = saved
				? ((await attachParts(db, [saved as any]))[0] as typeof saved)
				: undefined
			const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
				sessionId,
				accepted: true,
				runId: outcome.runId,
				...(outbound ? { sessionMessage: outbound as any } : {})
			}
			emitToUser("sessionMessages:sendPersonaMessage", res)

			// The sent tray items are gone: every tab of the sender's drops
			// their tiles from the same list reply a reload reads.
			if (trayItemIds.length) {
				const { listTray } = await import("$lib/server/attachments/tray")
				emitToUser("attachments:list", {
					sessionId,
					tray: await listTray(db, userId, sessionId)
				})
			}

			// The line this session's cards quote has just changed.
			broadcastSessionRow(socket.io, sessionId)

			/**
			 * **The send starts nothing** (PLAN-turn-order §3, §4.6; A7).
			 *
			 * A reply follows one road, and none of it is
			 * here: the saved row's `message-completed` recomputes the
			 * session's turn order, the write emits `turn-order-changed`,
			 * and the auto-advance listener fires the head turn if — and
			 * only if — the session says to. With `off` the send produces no
			 * reply until Continue, which is the feature.
			 */

			return res
		} catch (error: any) {
			console.error("Error sending persona message:", error)
			const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
				sessionId: params?.sessionId,
				error: "Failed to send message",
				refused: "Your message could not be sent. Your text was kept."
			}
			// The composer restores the text on the answer (silently — `error`
			// says the catch-all below toasts the `:error`).
			emitToUser("sessionMessages:sendPersonaMessage", res)
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

			// 🚧 pr-6 R-k: an archived session is read-only — no edit, no hide.
			{
				const archived = await sessionArchivedRefusal(db, existingMessage.sessionId)
				if (archived) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: archived
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
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

			if (!message || message.rewindOrdinal != null) {
				// 🚧 A row Back took out is in no history to delete from (RF fix 5).
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

			/**
			 * 🚧 **Deletion needs a pipeline** (RF fix 5, owner ruling
			 * 2026-10-23): offered, and performed, only where the session's
			 * registrations hold one on `message-deletion-asked` — core
			 * registers none, so deleting is off by default. The press
			 * raises the event; the registered pipeline does the work
			 * (`messages/deletion.ts`).
			 */
			const { askDeletion, deletionOffered, DELETION_OFF } = await import(
				"$lib/server/messages/deletion"
			)
			if (!(await deletionOffered(db, message.sessionId))) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: DELETION_OFF
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}
			// ⏳ A genre's `messageVerbs.delete: false` still takes Delete away
			// where a pipeline would offer it (R-15): presence is presentation,
			// the refusal is the law.
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

			// 🚧 A genre that keeps its turns (Honour mode, owner rulings
			// 2026-10-15): an older turn is never deleted, the latest only by
			// the owner with Honour mode on — and a row its run wrote takes
			// the whole turn with it, as a retake would, firing nothing. ⚠
			// Reached only behind the door above (RF fix 5): a genre that
			// keeps its turns and registers a deletion pipeline; the turn is
			// deleted whole by the host's turn rule, never one row of it.
			const turnVerdict = await turnDeleteVerdict(
				db,
				message.sessionId,
				message.id,
				userId
			)
			if (turnVerdict && "refusal" in turnVerdict) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: turnVerdict.refusal
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}
			if (turnVerdict && "turn" in turnVerdict) {
				// 🚧 On revision `branch` (PLAN-rulesets §28): the turn is not
				// deleted — the session forks before it and play goes on in
				// the branch; the old tail stays here.
				if (turnVerdict.revision.mode === "branch") {
					const { branchForRevision } = await import(
						"$lib/server/sessions/revision"
					)
					const first = Math.min(
						...turnVerdict.turn.rows.map((r) => r.messageId)
					)
					const branched = await branchForRevision(db, {
						sessionId: message.sessionId,
						userId,
						firstRevisedId: first,
						// 🚧 The deleted turn's writes stay out of the branch (B8).
						runs: turnVerdict.turn.runs,
						io: socket.io
					})
					const res: Sockets.SessionMessages.Delete.Response = branched.ok
						? {
								id: params.id,
								success: "Branched here",
								branchedTo: branched.sessionId,
								revision: turnVerdict.revision
							}
						: { id: params.id, error: branched.error }
					emitToUser("sessionMessages:delete", res)
					if (branched.ok) {
						await relistWithRow(socket, emitToUser, branched.sessionId)
					}
					return res
				}
				const { deleteTurnYield } = await import(
					"$lib/server/sessions/retakeTurn"
				)
				const gone = await deleteTurnYield(db, {
					sessionId: message.sessionId,
					userId,
					turn: turnVerdict.turn,
					io: socket.io
				})
				const res: Sockets.SessionMessages.Delete.Response = gone.ok
					? { id: params.id, success: "Turn deleted" }
					: { id: params.id, error: gone.error }
				emitToUser("sessionMessages:delete", res)
				if (gone.ok) {
					await resendSession(socket, message.sessionId, emitToUser)
					broadcastSessionRow(socket.io, message.sessionId)
				}
				return res
			}

			const deleted = await askDeletion(db, {
				sessionId: message.sessionId,
				messageId: params.id,
				userId,
				io: socket.io
			})
			if (!deleted.deleted) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: deleted.refused
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

			// 🚧 What was anchored to the row went with it (Q1-3): every sheet
			// re-reads now, never on its next reload.
			await broadcastToSessionUsers(socket.io, message.sessionId, "state:changed", {
				sessionId: message.sessionId
			} satisfies Sockets.State.Changed.Response).catch((e: unknown) =>
				console.warn("[sessionMessages:delete] state:changed failed:", e)
			)

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
					// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
					const access = await checkSessionAccess(messageToRegenerate.sessionId, socket.user!.id)
					await noteSocketInteraction(access, messageToRegenerate.sessionId, "action")
					// see canActOnMessage — four branches.
					const canEdit = await canActOnMessage(
						db,
						params.id,
						userId,
						"rerun"
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
					//
					// 🚧 The clock moves this reply carried go back with it
					// (live scenes §15 G5) — refused in words, before anything
					// is written, when the calendar cannot take one back.
					// "replaced": the message stays and is told again — it keeps
					// the round's tick (★ST2-1) and any `keepOnRetell` fields.
					let retracted: Awaited<ReturnType<typeof retractStateAnchoredTo>>
					try {
						retracted = await retractStateAnchoredTo(db, params.id, "replaced")
					} catch (e) {
						const { StoryClockRefusal } = await import("$lib/server/state/storyTime")
						if (!(e instanceof StoryClockRefusal || e instanceof SettledRefusal)) throw e
						const res: Sockets.SessionMessages.Regenerate.Response = {
							sessionMessage: undefined,
							error: e.message
						}
						emitToUser("sessionMessages:regenerate", res)
						return res
					}
					if (retracted.clockMoved)
						broadcastSessionRow(socket.io, messageToRegenerate.sessionId)
					// The seats the old reply benched or brought back, told to open pages.
					await announceSeatChanges(
						db,
						socket.io,
						{ sessionId: messageToRegenerate.sessionId, userId: socket.user!.id },
						retracted.seatChanges
					)
					// 🚧 Announced once the retraction has committed (live
					// scenes §15 G14), as an outlet's write announces: every
					// tab re-reads its state and the ledger loses the old
					// reply's lines now, not on the new reply's turn.
					if (retracted.changed)
						await broadcastToSessionUsers(
							socket.io,
							messageToRegenerate.sessionId,
							"state:changed",
							{
								sessionId: messageToRegenerate.sessionId
							} satisfies Sockets.State.Changed.Response
						)

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
					// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
					const access = await checkSessionAccess(messageToExtend.sessionId, socket.user!.id)
					await noteSocketInteraction(access, messageToExtend.sessionId, "action")
					// see canActOnMessage — four branches.
					const canEdit = await canActOnMessage(
						db,
						params.id,
						userId,
						"rerun"
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
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				const access = await checkSessionAccess(message.sessionId, socket.user!.id)
				await noteSocketInteraction(access, message.sessionId, "action")
				// see canActOnMessage — four branches.
				const canEdit = await canActOnMessage(
					db,
					params.id,
					userId,
					"rerun"
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
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				const access = await checkSessionAccess(message.sessionId, socket.user!.id)
				await noteSocketInteraction(access, message.sessionId, "action")
				// see canActOnMessage — four branches.
				const canEdit = await canActOnMessage(
					db,
					params.id,
					userId,
					"rerun"
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
				 *
				 * 🚧 Asked first: whether the clock moves the reply being
				 * left behind carried can be taken back (live scenes §15
				 * G5). The alternative is recorded before the retraction, so
				 * a refusal there would leave an empty swipe showing.
				 */
				{
					const { clockRetractProblem } = await import("$lib/server/state/clockMoves")
					const problem = await clockRetractProblem(db, [message.id], { keepTicks: true })
					if (problem) return respond(undefined, problem)
					// 🚧 pr-6 B4: and whether the reply is below the settle line —
					// asked here for the same reason.
					const { assertRetractable } = await import("$lib/server/sessions/settle")
					try {
						await assertRetractable(db, message.id)
					} catch (e) {
						if (e instanceof SettledRefusal) return respond(undefined, e.message)
						throw e
					}
				}
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
				// row, so the anchor cascade cannot see it. Its clock moves
				// too (asked above), all but the round's tick (★ST2-1).
				// "replaced": the line is told again, `keepOnRetell` fields stay.
				let retracted: Awaited<ReturnType<typeof retractStateAnchoredTo>>
				try {
					retracted = await retractStateAnchoredTo(db, message.id, "replaced")
				} catch (e) {
					if (e instanceof SettledRefusal) return respond(undefined, e.message)
					throw e
				}
				if (retracted.clockMoved) broadcastSessionRow(socket.io, message.sessionId)
				// The seats the left-behind swipe benched or brought back, told to open pages.
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId: message.sessionId, userId: socket.user!.id },
					retracted.seatChanges
				)
				// 🚧 Committed: announced as the regenerate's is (§15 G14).
				if (retracted.changed)
					await broadcastToSessionUsers(socket.io, message.sessionId, "state:changed", {
						sessionId: message.sessionId
					} satisfies Sockets.State.Changed.Response)

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

				const outcome = await runReply({
					socket,
					emitToUser,
					sessionId: message.sessionId,
					userId,
					turn: { kind: "swipe", messageId: message.id }
				})
				/**
				 * 🚧 A swipe whose run failed (halted empty, errored) replaced
				 * nothing (2026-10-16 walk): the world it took back goes back
				 * as it was — the row stays failed, with its Retry. A stop is
				 * the person's: what arrived stands, and so does the retraction.
				 */
				if (!outcome.ok && !outcome.stopped) {
					try {
						const { restoreRetractedState } = await import("$lib/server/state/write")
						const seatChanges: SeatChange[] = []
						const restored = await restoreRetractedState(db, retracted.taken, { seatChanges })
						await announceSeatChanges(
							db,
							socket.io,
							{ sessionId: message.sessionId, userId: socket.user!.id },
							seatChanges
						)
						if (restored) {
							if (retracted.clockMoved) broadcastSessionRow(socket.io, message.sessionId)
							await broadcastToSessionUsers(socket.io, message.sessionId, "state:changed", {
								sessionId: message.sessionId
							} satisfies Sockets.State.Changed.Response)
						}
					} catch (e) {
						console.warn("[swipeRight] the world could not be put back:", e)
					}
				}

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
			let stoppedRuns = 0
			{
				const runRegistry = await import(
					"$lib/server/pipelines/runtime/runRegistry"
				)
				stoppedRuns = runRegistry.cancelSession(
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
			let released = 0
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
					released++
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

			// A Stop that arrived late stopped and released nothing: not an
			// error, and nothing to claim either.
			const res: Sockets.SessionMessages.Cancel.Response =
				released + stoppedRuns > 0
					? {
							success: `Cancelled ${released > 0 ? released : stoppedRuns} generating message(s)`
						}
					: {}
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
				// 🚧 A row on another person's personal lane is not theirs to
				// read (2026-10-17) — refused like a session they are not in.
				{
					const { laneViewFor, laneViewAllows } = await import("$lib/server/channels/lanes")
					const view = await laneViewFor(db, sessionMessage.sessionId, socket.user!.id)
					if (!laneViewAllows(view, sessionMessage.channel)) {
						const res: Sockets.SessionMessage.Response = {
							error: "Access denied. Session not found or no permission to access."
						}
						emitToUser("sessionMessage:error", res)
						throw new Error("Access denied.")
					}
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

			// Connection and sampling via resolveTaskConfig — the connection is
			// the instance's text->text default, the sampling the session's own
			// choice above it.
			const { connection, sampling, problem } = await resolveTaskConfig({
				taskType: "session",
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
							createdAt: new Date(),
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
			// 🚧 (seat-cast S2) A head named by its seated member reads as
			// its seat's card; nobody seated as that member → no head.
			const { storedSeatRef } = await import(
				"$lib/server/state/seatRefs"
			)
			const headCardRef = headRef
				? await storedSeatRef(db, params.sessionId, headRef)
				: null
			// ⏳ With the flip on (`state/memberForm.ts`) the stored head is a
			// member form (`seated-member:` / `player-seat:`): its card is the
			// seat's `cardId`; off, the card form's own number.
			let currentCharacterId: number | null = memberFormOn()
				? headCardRef
					? ((await seatOf(db, params.sessionId, headCardRef))?.cardId ?? null)
					: null
				: headCardRef && headCardRef.startsWith("character:")
					? Number(headCardRef.slice("character:".length))
					: null
			if (currentCharacterId !== null && !Number.isInteger(currentCharacterId))
				currentCharacterId = null
			let envoySpeaker: `envoy:${string}` | null =
				headRef?.startsWith("envoy:")
					? (headRef as `envoy:${string}`)
					: null
			// 🚧 A head that is a card-less seat's member (`seated-member:<id>`,
			// the seat holds no card): compiled for by that ref as `speaker`,
			// as the envoy head is. A member id, never a card id.
			let cardlessSpeaker: string | null = null
			const { hostSeatRefOf } = await import(
				"$lib/server/pipelines/prompt/seatCards"
			)
			if (!currentCharacterId && !envoySpeaker && memberFormOn() && headCardRef) {
				const headSeat = await seatOf(db, params.sessionId, headCardRef)
				if (
					headSeat &&
					headSeat.kind === "character" &&
					!headSeat.departed &&
					headSeat.cardId == null &&
					headSeat.castMemberId != null
				)
					cardlessSpeaker = hostSeatRefOf({
						kind: "character",
						seatId: headSeat.seatId,
						castMemberId: headSeat.castMemberId,
						cardId: null
					})
			}
			if (!currentCharacterId && !envoySpeaker && !cardlessSpeaker) {
				// The first active seat by position: a card, else (a live
				// card-less seat — no envoy, a member, `removedAt` null) its
				// member's ref.
				const firstSeat = session.sessionCharacters
					.filter(
						(cc) =>
							cc.isActive &&
							cc.removedAt == null &&
							cc.envoySlug == null &&
							(cc.characterId != null || cc.castMemberId != null)
					)
					.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]
				// By the row's own `characterId`: a card-less seat's `character`
				// is its member read as a card-shaped row with NO `id`.
				if (firstSeat?.characterId != null)
					currentCharacterId = firstSeat.characterId
				else if (firstSeat)
					cardlessSpeaker = hostSeatRefOf({
						kind: "character",
						seatId: firstSeat.id,
						castMemberId: firstSeat.castMemberId,
						cardId: null
					})
			}
			if (!currentCharacterId && !envoySpeaker && !cardlessSpeaker) {
				const { seatedEnvoys } = await import(
					"$lib/server/pipelines/entities/envoys"
				)
				const seat = (await seatedEnvoys(db, params.sessionId)).find(
					(e) => !e.removedAt && e.speaks === "in-turn"
				)
				if (seat) envoySpeaker = `envoy:${seat.slug}`
			}

			if (!currentCharacterId && !envoySpeaker && !cardlessSpeaker) {
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
				...(envoySpeaker
					? { speaker: envoySpeaker }
					: cardlessSpeaker
						? { speaker: cardlessSpeaker as `seated-member:${string}` }
						: {}),
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
		const { getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const mode = await getSessionGenre(db, await sessionGenreOf(db, sessionId))
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
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				await noteSocketInteraction(access, params.sessionId, "action")

				const [row] = await db
					.select({ turnOrder: schema.sessions.turnOrder })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, params.sessionId))
					.limit(1)
				if (!row)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: "Session not found."
					})
				// 🚧 seat-cast S3: an entry's ref is read as the form the session
				// stores (`storedSeatRef`: the member form once the flip is on —
				// ⏳ a card form from an old tab is translated — else the card
				// form) before it is compared (`sameEntry`) with the stored order,
				// judged or fired.
				// A member nobody is seated as stays as sent, which no order entry
				// equals; it is refused below and by `fireTurnEntry`, never stored.
				if (params.entry && typeof params.entry.ref === "string") {
					const { storedSeatRef } = await import("$lib/server/state/seatRefs")
					const stored = await storedSeatRef(
						db,
						params.sessionId,
						params.entry.ref
					)
					if (stored !== null && stored !== params.entry.ref)
						params.entry = { ...params.entry, ref: stored }
				}
				// 🚧 A channel for the owner alone (Lair rewrite D6): no
				// guest presses anything there.
				if (!access.isOwner && params.channel) {
					const { laneViewFor, laneViewAllows } = await import("$lib/server/channels/lanes")
					const view = await laneViewFor(db, params.sessionId, userId)
					if (view && !laneViewAllows(view, params.channel)) {
						const { sessionLaneFacts, hiddenChannelRefusal } = await import("$lib/server/channels/lanes")
						const facts = await sessionLaneFacts(db, params.sessionId)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: hiddenChannelRefusal(facts?.shape, params.channel)
						})
					}
				}
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
				let order = readTurnOrder(row).order
				let head = order[0]
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
				const { carryOnEntry, sentSinceReply } = await import(
					"$lib/server/sessions/fireTurn"
				)
				const pressedOnMain = isSameChannel(pressedOn, "main")
				let prepared =
					params.entry ??
					firstOn(pressedOn) ??
					(pressedOnMain ? undefined : head)
				/**
				 * 🚧 **The GM's Continue moves past a waiting player** (Lair
				 * rewrite D5, 2026-10-21): the owner's Continue, with a
				 * planned turn a person plays at the head of this channel,
				 * skips that seat (`skipWaitingTurn` — recorded on the plan,
				 * so no recompute prepares it again) and fires what is
				 * prepared after it. A guest's Continue skips nobody.
				 */
				if (!params.entry && access.isOwner && prepared && prepared.via === "plan") {
					const { entryIsPersons } = await import("$lib/server/sessions/fireTurn")
					if (
						typeof prepared.ref === "string" &&
						(await entryIsPersons(db, params.sessionId, prepared as import("@serene-pub/sdk").TurnEntryV1))
					) {
						const { skipWaitingTurn } = await import("$lib/server/sessions/turnPlan")
						const after = await skipWaitingTurn(db, params.sessionId, prepared.ref, socket.io)
						if (after) {
							order = after.order
							head = order[0]
							prepared = firstOn(pressedOn)
							if (!prepared)
								return reply({
									sessionId: params.sessionId,
									ok: true,
									reason: "skipped"
								})
						}
					}
				}
				/**
				 * 🚧 A guest who has moved since the story last did may carry
				 * it on too (feature 17, D4, 2026-10-15): Dungeon Crawler's
				 * round waits for everyone, and Continue from a player who
				 * has declared resolves it early. One who has not is refused
				 * below, as any guest with nothing prepared always was.
				 */
				const carriedOn =
					!prepared &&
					(access.isOwner ||
						(pressedOnMain &&
							(await sentSinceReply(db, params.sessionId, userId))))
				const wanted =
					prepared ??
					(carriedOn ? await carryOnEntry(db, params.sessionId) : null)
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

				if (!access.isOwner && !carriedOn) {
					// The head of its own channel (R5): the order's head, or
					// the first entry on another channel — the one a guest's
					// Continue on that channel's composer fires.
					const channelHead = firstOn(seated.channel)
					const isHead = !!channelHead && sameEntry(channelHead, seated)
					let ownsIt = false
					const seatRefForm =
						typeof seated.ref === "string"
							? (await import("$lib/server/sessions/seats")).parseSeatRef(
									seated.ref
								)?.form
							: undefined
					if (
						typeof seated.ref === "string" &&
						(seatRefForm === "character" ||
							seatRefForm === "seated-member" ||
							// ⏳ A player seat is named `player-seat:<id>` once
							// the flip is on, carded or not.
							(seatRefForm === "player-seat" && memberFormOn()))
					) {
						// 🚧 Judged through the seat (owner ruling 2026-11-05: "The
						// person who seated it"): `seatActorOf` — the seater of a
						// character seat, the player of a player seat; unset, the
						// owner of the member's active card. A `character:` ref no
						// seat of this session holds keeps its card's owner (the
						// card form; ⏳ a member-less character seat's ref).
						const { seatOf, seatActorOf } = await import(
							"$lib/server/sessions/seats"
						)
						const seat = await seatOf(db, params.sessionId, seated.ref)
						// ⏳ A card-less player seat's entry stays nobody's here, as
						// before the flip (`player-seat:` named only those then).
						if (seat && !(seatRefForm === "player-seat" && seat.cardId == null)) {
							ownsIt =
								(await seatActorOf(db, params.sessionId, seat)) === userId
						} else if (seatRefForm === "character") {
							const cardId = Number(seated.ref.slice("character:".length))
							const [character] = await db
								.select({ userId: schema.characters.userId })
								.from(schema.characters)
								.where(eq(schema.characters.id, cardId))
								.limit(1)
							ownsIt = character?.userId === userId
						}
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
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				await noteSocketInteraction(access, params.sessionId, "action")
				// 🚧 Busy only with what nobody watches stream — a background
				// step after the turn, its children settling: the press waits a
				// beat for it, never "wait for the reply to finish" with nothing
				// running (PLAN-dc-after-walk2 Q1-4, the walk's N9).
				const { settleBackgroundRuns } = await import("$lib/server/pipelines/entities/publishedValues")
				await settleBackgroundRuns(db, params.sessionId)
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
				// 🚧 On revision `branch` (PLAN-rulesets §28): the turn was
				// taken again in a new session — the list gains it.
				if (out.branchedTo != null) {
					await relistWithRow(socket, emitToUser, out.branchedTo)
				}
				return reply({
					sessionId: params.sessionId,
					ok: out.ok,
					...(out.preview ? { preview: true } : {}),
					...(rows ? { rows } : {}),
					...(out.runId ? { runId: out.runId } : {}),
					...(out.revision ? { revision: out.revision } : {}),
					...(out.branchedTo != null ? { branchedTo: out.branchedTo } : {}),
					...(out.error ? { error: out.error } : {})
				})
			} catch (error) {
				console.error("Error in sessionsRetakeTurnHandler:", error)
				return refuse("Failed to regenerate the last turn.")
			}
		})
}

/**
 * 🚧 **Back · Forward** (RF fix 5, owner ruling 2026-10-23): the session's
 * forward stack — `rewindTurn` / `forwardTurn` (`sessions/rewind.ts`) under
 * the session's generation lock, so a press never lands mid-turn. The
 * answer goes to the asker (`:error` for a refusal, the toast's); on a
 * press that moved, the whole session goes to everyone in it and the row
 * push says its new last line.
 */
function rewindPressHandler(
	event: "sessions:rewindTurn" | "sessions:forwardTurn",
	press: "rewindTurn" | "forwardTurn"
): Handler<Sockets.Sessions.RewindTurn.Params, Sockets.Sessions.RewindTurn.Response> {
	return {
		event,
		handler: async (socket, params, emitToUser) =>
			withSessionGenerationLock(params.sessionId, async () => {
				const userId = socket.user!.id
				const reply = (res: Sockets.Sessions.RewindTurn.Response) => {
					emitToUser(res.ok ? event : `${event}:error`, res)
					return res
				}
				try {
					const access = await checkSessionAccess(params.sessionId, userId)
					if (!access.hasAccess)
						return reply({ sessionId: params.sessionId, ok: false, error: "Session not found." })
					await noteSocketInteraction(access, params.sessionId, "action")
					const rewind = await import("$lib/server/sessions/rewind")
					const out = await rewind[press](db, {
						sessionId: params.sessionId,
						userId,
						io: socket.io
					})
					if (!out.ok) return reply({ sessionId: params.sessionId, ok: false, error: out.error })
					await broadcastSessionToParticipants(socket, params.sessionId, userId)
					broadcastSessionRow(socket.io, params.sessionId)
					return reply({
						sessionId: params.sessionId,
						ok: true,
						messageIds: out.messageIds,
						ahead: out.ahead
					})
				} catch (error) {
					console.error(`Error in ${event}:`, error)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: press === "rewindTurn" ? "Could not go back a turn." : "Could not go forward a turn."
					})
				}
			})
	}
}

export const sessionsRewindTurnHandler = rewindPressHandler("sessions:rewindTurn", "rewindTurn")
export const sessionsForwardTurnHandler = rewindPressHandler("sessions:forwardTurn", "forwardTurn")

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
			/**
			 * A press refused before its run (C2 follow-up, 2026-09-29): the
			 * page is told, because `register` discards what a handler
			 * returns. The outcome settles the press (a `/narrate <text>`
			 * draft is kept, the modal's text is kept for its next opening)
			 * and the sentence goes on the ungated `:error` for the toast —
			 * a gate never turns a refusal into silence (plan ruling 2).
			 */
			const refuse = (error: string) => {
				emitToUser("sessions:fireNarratorResponse", {
					sessionId: params.sessionId,
					success: false
				})
				emitToUser("sessions:fireNarratorResponse:error", {
					sessionId: params.sessionId,
					error
				})
				return { error }
			}
			/** Whether the outcome went out — so the catch answers once. */
			let answered = false
			try {
				const userId = socket.user!.id

				if (
					params.instructions &&
					params.instructions.length >
						MAX_NARRATOR_INSTRUCTIONS_LENGTH
				) {
					return refuse(
						`Narrator instructions too long (max ${MAX_NARRATOR_INSTRUCTIONS_LENGTH} characters).`
					)
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
					return refuse(
						"Could not fire the Narrator response: session not found."
					)
				}
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				await noteSocketInteraction(access, params.sessionId, "action")
				if (!access.isOwner) {
					return refuse(
						"Access denied. Only the session owner can fire a Narrator response."
					)
				}

				const session = await getPromptSessionFromDb(
					params.sessionId,
					userId
				)
				if (!session) {
					return refuse(
						"Could not fire the Narrator response: session not found."
					)
				}

				const hasGeneratingMessages = session.sessionMessages.some(
					(msg) => msg.isGenerating
				)
				if (hasGeneratingMessages) {
					return refuse(
						"A response is already generating in this session."
					)
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
					if (!resolution.ok) return refuse(resolution.error)
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
				// How the run went, to the page that fired it (genre uplift
				// C2, 2026-09-29): what spends a `/narrate <text>` draft, which
				// stays until the narration has run (S2) — kept on a stop or
				// an error, as `sessions:fireAction`'s answer keeps one.
				answered = true
				emitToUser("sessions:fireNarratorResponse", {
					sessionId: params.sessionId,
					success: outcome.ok
				})
				if (outcome.error && !outcome.stopped) {
					if (!outcome.shown)
						emitToUser("sessions:fireNarratorResponse:error", {
							sessionId: params.sessionId,
							error: outcome.error
						})
					return { error: outcome.error }
				}

				return { success: outcome.ok }
			} catch (error) {
				console.error("Error in fireNarratorResponseHandler:", error)
				const failed = "Failed to fire the Narrator response."
				if (answered) return { error: failed }
				return refuse(failed)
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
 * ⏳ The ref a person's persona line is offered under: with the flip on
 * (`state/memberForm.ts`) the player seat holding the persona — live before
 * departed, then position, then seat id (never a character seat that holds
 * the same card, ★K-2) — as `hostSeatRefOf` names it; else, or when no seat
 * holds it, the card form `character:<personaId>`.
 */
async function playerSeatRefOfPersona(
	dbh: Db,
	sessionId: number,
	personaId: number
): Promise<string> {
	if (memberFormOn()) {
		const seats = await dbh
			.select({
				id: schema.sessionPersonas.id,
				castMemberId: schema.sessionPersonas.castMemberId,
				removedAt: schema.sessionPersonas.removedAt,
				position: schema.sessionPersonas.position
			})
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					eq(schema.sessionPersonas.personaId, personaId)
				)
			)
		seats.sort(
			(a, b) =>
				Number(a.removedAt != null) - Number(b.removedAt != null) ||
				(a.position ?? 0) - (b.position ?? 0) ||
				a.id - b.id
		)
		if (seats[0]) return `player-seat:${seats[0].id}`
	}
	return `character:${personaId}`
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

/**
 * Switch one cast seat on or off — SET to `params.enabled`, never flipped
 * (note 34 follow-up): the Edit Session form holds the switch until Save,
 * so a flip from a stale form would invert the seat. A repeated set is a
 * no-op answered as a success. Every path answers the asker on this event,
 * refusals with `error` and the seat as it stands, so the form can close
 * on the answers (A24).
 */
export const sessionsSetCastSeatEnabledHandler: Handler<
	Sockets.Sessions.SetCastSeatEnabled.Params,
	Sockets.Sessions.SetCastSeatEnabled.Response
> = {
	event: "sessions:setCastSeatEnabled",
	handler: async (socket, params, emitToUser) => {
		const refuse = (error: string, enabled = false) => {
			const res: Sockets.Sessions.SetCastSeatEnabled.Response = {
				sessionId: params.sessionId,
				...(params.characterId != null
					? { characterId: params.characterId }
					: {}),
				...(params.castMemberId != null
					? { castMemberId: params.castMemberId }
					: {}),
				...(params.playerSeatId != null
					? { playerSeatId: params.playerSeatId }
					: {}),
				enabled,
				error
			}
			emitToUser("sessions:setCastSeatEnabled", res)
			return res
		}
		try {
			const userId = socket.user!.id
			if (typeof params.enabled !== "boolean")
				return refuse("Say whether the seat is switched on or off.")
			if (
				[params.characterId, params.castMemberId, params.playerSeatId].filter(
					(v) => v != null
				).length !== 1
			)
				return refuse(
					"Name one seat: a character, a cast member or a player seat."
				)

			// checkSessionAccess (owner OR guest), not an owner-only ad-hoc check —
			// a guest who brought their own character into a shared session must
			// be able to switch that character's own seat; only the per-row
			// escalation below decides whether *this* seat is theirs to manage.
			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) return refuse("Session not found.")

			let kind: "character" | "player" = "character"
			let seatId: number
			let seatIsActive: boolean
			let echo: Partial<Sockets.Sessions.SetCastSeatEnabled.Response>
			if (params.playerSeatId != null) {
				// A player seat (benched seats): by its own row, benched or in play.
				kind = "player"
				const [pseat] = await db
					.select({
						id: schema.sessionPersonas.id,
						isActive: schema.sessionPersonas.isActive,
						playerId: schema.sessionPersonas.userId,
						cardOwnerId: schema.characters.userId
					})
					.from(schema.sessionPersonas)
					.leftJoin(
						schema.characters,
						eq(schema.characters.id, schema.sessionPersonas.personaId)
					)
					.where(
						and(
							eq(schema.sessionPersonas.id, params.playerSeatId),
							eq(schema.sessionPersonas.sessionId, params.sessionId),
							isNull(schema.sessionPersonas.removedAt)
						)
					)
					.limit(1)
				if (!pseat) return refuse("That seat is not in this session.")
				if (
					!(
						sessionAccess.isOwner ||
						pseat.playerId === userId ||
						pseat.cardOwnerId === userId
					)
				)
					return refuse(
						"Only the session owner or this seat's player can change this.",
						!!pseat.isActive
					)
				seatId = pseat.id
				seatIsActive = !!pseat.isActive
				echo = { playerSeatId: params.playerSeatId }
			} else {
				// The live seat: by card, or by member (a card-less, non-envoy seat).
				const byCard = params.characterId != null
				const [seat] = await db
					.select({
						id: schema.sessionCharacters.id,
						isActive: schema.sessionCharacters.isActive,
						castMemberId: schema.sessionCharacters.castMemberId,
						seatedBy: schema.sessionCharacters.seatedByUserId,
						cardOwnerId: schema.characters.userId
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
							eq(schema.sessionCharacters.sessionId, params.sessionId),
							isNull(schema.sessionCharacters.removedAt),
							byCard
								? eq(
										schema.sessionCharacters.characterId,
										params.characterId!
									)
								: and(
										eq(
											schema.sessionCharacters.castMemberId,
											params.castMemberId!
										),
										isNull(schema.sessionCharacters.characterId),
										isNull(schema.sessionCharacters.envoySlug)
									)
						)
					)
					.limit(1)

				if (!seat) return refuse("Session character not found.")

				if (byCard) {
					if (!(sessionAccess.isOwner || seat.cardOwnerId === userId))
						return refuse(
							"Access denied. Only the session owner or this character's owner can change this.",
							!!seat.isActive
						)
				} else if (!(sessionAccess.isOwner || seat.seatedBy === userId))
					return refuse(
						"Only the session owner or the person who seated this cast member can change this.",
						!!seat.isActive
					)

				seatId = seat.id
				seatIsActive = !!seat.isActive
				echo = byCard
					? { characterId: params.characterId }
					: { castMemberId: params.castMemberId }
			}

			const res: Sockets.Sessions.SetCastSeatEnabled.Response = {
				sessionId: params.sessionId,
				...echo,
				enabled: params.enabled
			}
			// Already so: nothing moved, so no write and no cast-changed —
			// the answer alone, so the asker still settles.
			const result = await db.transaction(async (tx) =>
				setSeatBench(tx as unknown as Db, {
					sessionId: params.sessionId,
					kind,
					seatId,
					benched: !params.enabled
				})
			)
			if (!result.ok) return refuse(result.refusal, seatIsActive)
			if (result.changes.length === 0) {
				emitToUser("sessions:setCastSeatEnabled", res)
				return res
			}

			emitToUser("sessions:setCastSeatEnabled", res)
			await resendSession(socket, params.sessionId, emitToUser)
			// A seat's row moved (PLAN-turn-order §4.1, A2): the seat writer's
			// change says it as `cast-changed` under the person's `settings`
			// cause, which never fires a turn.
			await announceSeatChanges(
				db,
				socket.io,
				{ sessionId: params.sessionId, userId },
				result.changes
			)

			return res
		} catch (error) {
			console.error("Error in sessionsSetCastSeatEnabledHandler:", error)
			return refuse("Failed to switch the seat.")
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
		// A seat exposes the card it holds AND the card its cast member is
		// linked to, like `canViewCharacter`; each card is listed once.
		// Names are the cards' current card versions (`cardsNow`), never the
		// ⏳ copy; the queries select ids.
		const { cardsNow: cardsNowOf } = await import(
			"$lib/server/cast/seatedCast"
		)
		const named = async (
			rows: { id: number }[]
		): Promise<{ id: number; name: string }[]> => {
			const now = await cardsNowOf(
				db as unknown as Db,
				rows.map((r) => r.id)
			)
			return rows.flatMap((r) => {
				const card = now.get(r.id)
				return card ? [{ id: r.id, name: card.name }] : []
			})
		}
		const characterHeld = await db
			.select({
				id: schema.characters.id
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
		const characterLinked = await db
			.select({
				id: schema.characters.id
			})
			.from(schema.sessionCharacters)
			.innerJoin(
				schema.lorebookBindings,
				eq(
					schema.lorebookBindings.id,
					schema.sessionCharacters.castMemberId
				)
			)
			.innerJoin(
				schema.characters,
				eq(schema.lorebookBindings.characterId, schema.characters.id)
			)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, params.sessionId),
					eq(schema.characters.userId, userId)
				)
			)
			.orderBy(schema.characters.id)
		res.exposed.characters = await named(characterHeld)
		for (const card of await named(characterLinked))
			if (!res.exposed.characters.some((c) => c.id === card.id))
				res.exposed.characters.push(card)

		// Aliased: `session_characters` above already joined `characters` in
		// this handler, and both member tables point at it.
		const personaHeld = await db
			.select({ id: voicedCharacter.id })
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
		const personaLinked = await db
			.select({ id: voicedCharacter.id })
			.from(schema.sessionPersonas)
			.innerJoin(
				schema.lorebookBindings,
				eq(
					schema.lorebookBindings.id,
					schema.sessionPersonas.castMemberId
				)
			)
			.innerJoin(
				voicedCharacter,
				eq(schema.lorebookBindings.characterId, voicedCharacter.id)
			)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, params.sessionId),
					eq(voicedCharacter.userId, userId)
				)
			)
			.orderBy(voicedCharacter.id)
		res.exposed.personas = await named(personaHeld)
		for (const card of await named(personaLinked))
			if (!res.exposed.personas.some((c) => c.id === card.id))
				res.exposed.personas.push(card)

		// A seat also exposes its member's ACTIVE card on the session's
		// reading (the dated card; owner ruling 2026-11-05: "Everything in
		// session is cast -> active card"), once each, when it is the caller's.
		const { seatedCastOf } = await import("$lib/server/cast/seatedCast")
		const seatsNow = await seatedCastOf(db as unknown as Db, params.sessionId)
		const activeIds = new Set<number>()
		for (const seat of seatsNow) {
			const active = seat.asRead?.activeCardId
			if (active != null) activeIds.add(active)
		}
		if (activeIds.size) {
			const ownedActiveIds = await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(
					and(
						inArray(schema.characters.id, [...activeIds]),
						eq(schema.characters.userId, userId)
					)
				)
			const ownedActiveById = new Map(
				(await named(ownedActiveIds)).map((c) => [c.id, c])
			)
			for (const seat of seatsNow) {
				const active = seat.asRead?.activeCardId
				if (active == null || active === seat.cardId) continue
				if (active === seat.asRead?.linkedCardId) continue
				const card = ownedActiveById.get(active)
				if (!card) continue
				const list =
					seat.kind === "character"
						? res.exposed.characters
						: res.exposed.personas
				if (!list.some((c) => c.id === card.id)) list.push(card)
			}
		}

		// The session's lorebook is a single binding on the session row.
		// Exposed only when the caller owns it.
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
}
