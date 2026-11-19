/**
 * What the session handlers share: the ownership checks, the sessions list
 * (`buildSessionsListFor`, the relists), the session reads
 * (`getSessionFromDB`, `getPromptSessionFromDb`, `withSessionExtras`), the
 * refresh push to a session's participants, the lorebook binding check and
 * the line / clock patches a create and an update both write.
 *
 * A leaf among the `sessions.*.ts` modules: each imports these from here,
 * never from `sessions.ts`, and this module imports no `sessions*` module.
 */

import { isNewAttachOfDisabledBook, liveProvidedBookSql, markedBook, providedBooksReadableBy } from "$lib/server/plugins/providedMarks"
import { readComposerStates } from "@serene-pub/sdk"
import { withSessionArchiveClosure } from "$lib/server/sessions/archive"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { liveMessageWhere } from "$lib/server/messages/store"
import { readsPrompt, withEmbeddingStateFor, withoutDebugMeta } from "$lib/server/messages/debugMeta"
import { DEFAULT_CHANNEL, channelWhere } from "$lib/server/messages/channels"
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm"
import { settleSeats, syncMintedSeatMembers } from "$lib/server/sessions/seats"
import {
	lastVisibleMessages,
	liveMessageCounts,
	seatCastShownForSessions
} from "$lib/server/sessions/rowProjection"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import {
	broadcastToSessionUsers,
	emitToUserRedacted,
	getSessionUserIds
} from "./utils/broadcastHelpers"
import { relistBindings } from "./lorebooks"
import {
	checkSessionAccess,
	type SessionAccess
} from "$lib/server/utils/sessionAccess"
import { findOrCreateTagId } from "$lib/server/utils/tags"
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
 * What a new session may attach as its lorebook: one of the person's own
 * lorebooks. A live provided lorebook is never attached by a new session (a
 * session starts from it, on a copy in its notes: `starterKit`); only the
 * session that already reads it keeps it, and a next chapter passes the
 * session it follows as `sessionId`. A session's own notes are found only
 * through their session (PLAN-rulesets §26), and a starter lorebook is started
 * from, never read (`kitReadRefusal` says so first, in words).
 */
async function checkLorebookOwnership(
	lorebookId: number,
	userId: number,
	/** The session whose book this is, when it already has one: re-sending the book it reads is not a new attach. */
	sessionId?: number
): Promise<boolean> {
	const [book] = await db
		.select({
			sessionId: schema.lorebooks.sessionId,
			kind: schema.lorebooks.kind,
			provided: liveProvidedBookSql()
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (!book) return false
	if (book.provided) {
		if (sessionId == null) return false
		// The session already reads it, and the provided-read rule still admits it.
		const [reader] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (reader?.lorebookId !== lorebookId) return false
		if (
			!(await providedBooksReadableBy(db as unknown as Db, userId, [lorebookId])).has(lorebookId)
		)
			return false
	} else if (!(await findOwnedBook(db, userId, lorebookId))) return false
	if (await isNewAttachOfDisabledBook(db as unknown as Db, lorebookId, sessionId)) return false
	return book.sessionId == null && book.kind === "book"
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

	// First, find all sessions where the current user is a guest
	const guestSessions = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.userId, userId),
		columns: {
			sessionId: true
		}
	})

	const guestSessionIds = guestSessions.map((gc) => gc.sessionId)

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
	const { cardsNow, cardNameplatesNow } = await import(
		"$lib/server/cast/seatedCast"
	)
	// A read trimmed to the nameplate (the session list) never needs the whole
	// card, and never writes a first version to get it.
	const NAMEPLATE_FIELDS = ["id", "name", "nickname", "avatarMediaId"]
	const now = opts.only?.every((k) => NAMEPLATE_FIELDS.includes(k))
		? await cardNameplatesNow(db as unknown as Db, ids)
		: await cardsNow(db as unknown as Db, ids)
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
	let rows: any[] = newest.length ? await attachParts(db, newest) : []
	// G5/G6/D64: the compiled prompt goes to `readsPrompt` viewers. The
	// caller-only resend strips here; the members' push (`laneFilter` false) is
	// stripped per recipient by `broadcastToSessionUsers`.
	if (laneFilter && !(await readsPrompt(sessionId, userId)))
		rows = withoutDebugMeta(rows)
	const coversFromId = rows.length ? rows[0].id : null
	await withSessionExtras(sessionData, sessionId)
	return {
		session: { ...(sessionData as any), sessionMessages: rows },
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
	return emitToUser("sessions:refresh", async () => {
		const built = await buildSessionRefresh(sessionId, socket.user!.id, true)
		return built && (await withEmbeddingStateFor(built, socket.user))
	})
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
	// A session's notes are its owner's alone (G2): a guest's seat change is told no orphan of them.
	const notesOfAnother =
		(await (await import("$lib/server/lorebooks/ownBook")).ownBookAccessFor(db, lorebookId, socket.user!.id)) === false
	if (askAboutOrphans && orphaned.length > 0 && !notesOfAnother) {
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

export {
	checkCharacterOwnership,
	checkPersonaOwnership,
	checkCharactersOwnership,
	checkPersonasOwnership,
	checkLorebookOwnership,
	processSessionTags,
	buildSessionsListFor,
	putCardsNow,
	relistSessions,
	relistWithRow,
	noteSocketInteraction,
	getSessionFromDB,
	withSessionExtras,
	resendSession,
	broadcastSessionToParticipants,
	clockFromColumns
}
