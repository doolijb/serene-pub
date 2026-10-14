/**
 * 🚧 A session's **backdrop** (DESIGN-image-generation §6.4, ruling §9.4):
 * `sessions.backdropMediaId`, the one picture the Backdrop widget shows
 * behind or beside the Stage. Session state — a role pointer at `files.id`,
 * like the user's own `user_settings.background_media_id`; an FK `ON DELETE
 * SET NULL` (migration 0106), so a deleted file clears it — never a message
 * part.
 *
 * Two writers, one rule each, both through this module:
 *  - a pipeline, by `core:outlet/set-backdrop@1` (the host's commit), when
 *    the run's user is the session's owner or an admin (else refused on the
 *    run, not halted), under the rule `create-message`'s media keeps: the
 *    file is the session's, the run's user's, or already shown in the session;
 *  - a person, by `sessions:setBackdrop` (the Backdrop widget's Change and
 *    Clear): the session's owner or an admin, and the file may also be a
 *    cast member's own image — the gallery the widget's chooser pages.
 *
 * After a write that moved the pointer, every member hears
 * `sessions:backdropChanged` (scoped on `sessionId`) and the session's
 * action lists are re-sent, since `backdrop.*` is a published value an
 * action's enabled-when may read. The `core:event/backdrop-set@1` emission
 * is the caller's: a run emits under its own cause, a person under
 * `settings`.
 *
 * ⚠ Not the app background, not a message attachment, not the retired
 * *scene image* pins.
 */
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { AuthenticatedSocket } from "$lib/server/sockets/auth"

/** A refusal said to the person or written on the receipt, in words. */
export class BackdropRefusal extends Error {}

/** Who is setting the backdrop, for the file check. */
export interface BackdropWriter {
	sessionId: number
	/** The person, or the user a run acts as; null for none. */
	userId: number | null
	/** A person's pick may be a cast member's gallery image; a run's may not. */
	castImages: boolean
}

/** The file's uuid, off a bare string or a media reference (`{ uuid }`). */
export function refUuid(ref: unknown): string | null {
	const uuid =
		typeof ref === "string"
			? ref
			: ref && typeof ref === "object"
				? (ref as { uuid?: unknown }).uuid
				: null
	return typeof uuid === "string" && uuid.trim() ? uuid.trim() : null
}

/**
 * 🚧 A file named by its id, the other form `/media/{id}` takes — what the
 * Backdrop chooser's *From this session* section answers as `ref`, since a
 * line's picture part carries the file's id (`data.assetId`) and no uuid
 * (lane D3, 2026-10-12). A positive integer string; else null.
 */
export function refFileId(ref: unknown): number | null {
	return typeof ref === "string" && /^[1-9]\d{0,15}$/.test(ref.trim())
		? Number(ref.trim())
		: null
}

/**
 * The file a reference names — its uuid, or its id (`refFileId`) — if it is
 * an image this writer may show in this session; refused, in words, when it
 * is not theirs to show; null when no file has that address or it is not an
 * image. The same checks whichever form named it.
 */
export async function backdropFileFor(
	db: Db,
	ref: unknown,
	who: BackdropWriter
): Promise<{ id: number } | null> {
	const fileId = refFileId(ref)
	const uuid = fileId === null ? refUuid(ref) : null
	if (fileId === null && !uuid) return null
	// A uuid column refuses a malformed string with a database error — say
	// "no such file" instead.
	if (
		uuid &&
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
	)
		return null
	const [row] = await db
		.select({
			id: schema.files.id,
			kind: schema.files.kind,
			userId: schema.files.userId,
			sessionId: schema.files.sessionId,
			characterId: schema.files.characterId
		})
		.from(schema.files)
		.where(fileId !== null ? eq(schema.files.id, fileId) : eq(schema.files.uuid, uuid!))
		.limit(1)
	if (!row || row.kind !== "image") return null
	if (row.sessionId != null && row.sessionId === who.sessionId) return { id: row.id }
	if (who.userId != null && row.userId === who.userId) return { id: row.id }
	const { isFileReferencedInSession } = await import(
		"$lib/server/attachments/references"
	)
	if (await isFileReferencedInSession(db, row.id, who.sessionId)) return { id: row.id }
	if (who.castImages && row.characterId != null && (await inCast(db, who.sessionId, row.characterId)))
		return { id: row.id }
	throw new BackdropRefusal(
		"That picture belongs to neither this session nor you, so it cannot be its backdrop."
	)
}

/** Is this character seated in the session, as a character or a persona. */
async function inCast(db: Db, sessionId: number, characterId: number): Promise<boolean> {
	const [seat] = await db
		.select({ id: schema.sessionCharacters.characterId })
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				eq(schema.sessionCharacters.characterId, characterId)
			)
		)
		.limit(1)
	if (seat) return true
	const [persona] = await db
		.select({ id: schema.sessionPersonas.personaId })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				eq(schema.sessionPersonas.personaId, characterId)
			)
		)
		.limit(1)
	return !!persona
}

/**
 * The one rule for who may move a session's backdrop — the session's owner
 * or an admin — for a run as for a person (`sessions:setBackdrop`). Null
 * when `userId` may; else the reason, one line. A run with no person
 * acting has nobody to be the owner, so it may not.
 */
export async function backdropWriterRefusal(
	db: Db,
	sessionId: number,
	userId: number | null
): Promise<string | null> {
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return "That session no longer exists."
	if (userId != null && session.userId === userId) return null
	if (userId != null) {
		const [u] = await db
			.select({ isAdmin: schema.users.isAdmin })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.limit(1)
		if (u?.isAdmin) return null
	}
	return "Only the session's owner or an admin can change its backdrop."
}

/** What a write did: whether the pointer moved, and from what to what. */
export interface BackdropWrite {
	changed: boolean
	previous: number | null
	next: number | null
}

/**
 * Point the session's backdrop at `mediaId` (null clears it). Writes nothing
 * — and says so — when it already points there. Refused when the session
 * does not exist.
 */
export async function writeBackdrop(
	db: Db,
	sessionId: number,
	mediaId: number | null
): Promise<BackdropWrite> {
	const [row] = await db
		.select({ backdropMediaId: schema.sessions.backdropMediaId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) throw new BackdropRefusal("That session no longer exists.")
	const previous = row.backdropMediaId ?? null
	if (previous === mediaId) return { changed: false, previous, next: mediaId }
	await db
		.update(schema.sessions)
		.set({ backdropMediaId: mediaId })
		.where(eq(schema.sessions.id, sessionId))
	return { changed: true, previous, next: mediaId }
}

/**
 * Tell the session's members the backdrop moved, and re-send their action
 * lists (enabled-when reads `backdrop.*`). Best-effort: a failed push never
 * undoes the write.
 */
export async function announceBackdrop(
	io: AuthenticatedSocket["io"] | null | undefined,
	sessionId: number,
	backdropMediaId: number | null
): Promise<void> {
	if (!io) return
	try {
		const { broadcastToSessionUsers } = await import(
			"$lib/server/sockets/utils/broadcastHelpers"
		)
		await broadcastToSessionUsers(io, sessionId, "sessions:backdropChanged", {
			sessionId,
			backdropMediaId
		} satisfies Sockets.Sessions.BackdropChanged.Response)
		const { pushSessionActions } = await import("$lib/server/sessions/actionsPush")
		await pushSessionActions(io, sessionId)
	} catch (err) {
		console.warn(`[backdrop] the push for session ${sessionId} failed:`, err)
	}
}

/** The published value enabled-when reads as `backdrop`: `{ set, mediaId }`. */
export interface PublishedBackdrop {
	set: boolean
	mediaId: number | null
}

/** The session's backdrop as a published value — one small read. */
export async function publishedBackdrop(
	db: Db,
	sessionId: number
): Promise<PublishedBackdrop> {
	const [row] = await db
		.select({ backdropMediaId: schema.sessions.backdropMediaId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const mediaId = row?.backdropMediaId ?? null
	return { set: mediaId !== null, mediaId }
}
