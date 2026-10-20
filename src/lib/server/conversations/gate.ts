/**
 * The **attachment gate** (PLAN-private-messages-2026-10-12 §5): one rule,
 * applied at send for every current member and at read for the asker.
 *
 * | kind        | a person may see it when                 | helper                  |
 * |-------------|------------------------------------------|-------------------------|
 * | `session`   | they are its owner or a guest            | `checkSessionAccess`    |
 * | `character` | owner · cast in a session they open · shared | `canViewCharacter`  |
 * | `lorebook`  | owner · shared (admin exception stays)   | `canViewLorebook`       |
 * | `file`      | `canViewMedia` says so                   | `canViewMedia`          |
 *
 * The gate never CREATES access: attaching a session adds no guest, attaching a
 * character shares nothing.
 *
 * ⚠ The helpers read through the app's own `db` handle, so nothing here may run
 * inside a `db.transaction` (the outer handle deadlocks PGlite). `send` gates
 * BEFORE its transaction and re-checks membership inside it.
 */
import { and, asc, count, eq, isNotNull, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	canViewCharacter,
	checkSessionAccess
} from "$lib/server/utils/sessionAccess"
import { canViewLorebook } from "$lib/server/utils/ownedBook"
import { canViewMedia } from "$lib/server/media/access"
import type {
	ConversationAttachmentCard,
	ConversationAttachmentKind
} from "$lib/shared/sockets/conversations"

export type GateVerdict =
	| { ok: true }
	| { ok: false; blockedBy: number[]; gone?: true }

export const ATTACHMENT_KINDS: readonly ConversationAttachmentKind[] = [
	"session",
	"character",
	"lorebook",
	"file"
]

export function isAttachmentKind(k: unknown): k is ConversationAttachmentKind {
	return (ATTACHMENT_KINDS as readonly unknown[]).includes(k)
}

/**
 * `/media/<uuid>?…&r=<rev>` — the same string `media/index.ts`'s `mediaUrl`
 * builds, composed here so the gate does not load the media pipeline (sharp,
 * codecs) just to name a URL.
 */
export function mediaSrc(uuid: string, rev: number, thumb = false): string {
	return `/media/${uuid}?${thumb ? `v=thumb&r=${rev}` : `r=${rev}`}`
}

type FileRow = typeof schema.files.$inferSelect

async function fileRow(db: Db, id: number): Promise<FileRow | null> {
	const [row] = await db
		.select()
		.from(schema.files)
		.where(eq(schema.files.id, id))
		.limit(1)
	return row ?? null
}

/** Whether the subject still exists (a deleted one is `gone` for everybody). */
async function subjectExists(
	db: Db,
	kind: ConversationAttachmentKind,
	id: number
): Promise<boolean> {
	const table =
		kind === "session"
			? schema.sessions
			: kind === "character"
				? schema.characters
				: kind === "lorebook"
					? schema.lorebooks
					: schema.files
	const [row] = await db
		.select({ id: table.id })
		.from(table as any)
		.where(eq(table.id, id))
		.limit(1)
	return !!row
}

/** May `userId` see this subject? Assumes the subject exists. */
export async function canSee(
	db: Db,
	kind: ConversationAttachmentKind,
	subjectId: number,
	userId: number,
	file?: FileRow | null
): Promise<boolean> {
	switch (kind) {
		case "session":
			return (await checkSessionAccess(subjectId, userId)).hasAccess
		case "character": {
			const [row] = await db
				.select({ userId: schema.characters.userId })
				.from(schema.characters)
				.where(eq(schema.characters.id, subjectId))
				.limit(1)
			if (row?.userId === userId) return true
			return canViewCharacter(subjectId, userId)
		}
		case "lorebook":
			return canViewLorebook(subjectId, userId, { db })
		case "file": {
			const f = file ?? (await fileRow(db, subjectId))
			if (!f) return false
			return canViewMedia(f, userId, db)
		}
	}
}

/**
 * Can every one of `userIds` see this subject? `blockedBy` names those who
 * cannot, in the order given; a subject that does not exist blocks everyone
 * and says `gone`.
 */
export async function canAttach(
	kind: ConversationAttachmentKind,
	subjectId: number,
	userIds: number[],
	db: Db
): Promise<GateVerdict> {
	if (!isAttachmentKind(kind) || !Number.isInteger(subjectId))
		return { ok: false, blockedBy: [...userIds], gone: true }
	const file = kind === "file" ? await fileRow(db, subjectId) : null
	if (kind === "file" ? !file : !(await subjectExists(db, kind, subjectId)))
		return { ok: false, blockedBy: [...userIds], gone: true }
	const blockedBy: number[] = []
	for (const userId of userIds)
		if (!(await canSee(db, kind, subjectId, userId, file)))
			blockedBy.push(userId)
	return blockedBy.length ? { ok: false, blockedBy } : { ok: true }
}

/* --- cards ------------------------------------------------------------ */

const EXCERPT_MAX = 140

export function excerptOf(text: string | null | undefined, max = EXCERPT_MAX): string | null {
	const flat = (text ?? "").replace(/\s+/g, " ").trim()
	if (!flat) return null
	return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** "PNG", "PDF" — the mime's subtype, short. */
function mimeLabel(mime: string): string {
	const sub = (mime.split("/")[1] ?? mime).split(/[+;.-]/)[0]
	return (sub || "file").toUpperCase()
}

/** The session's display title: its name, or its cast's names. */
async function sessionCardBody(db: Db, sessionId: number) {
	const [session] = await db
		.select({ name: schema.sessions.name, genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	const cast = await db
		.select({
			name: schema.characters.name,
			nickname: schema.characters.nickname,
			uuid: schema.files.uuid,
			rev: schema.files.rev
		})
		.from(schema.sessionCharacters)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionCharacters.characterId)
		)
		.leftJoin(schema.files, eq(schema.files.id, schema.characters.avatarMediaId))
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.removedAt),
				isNotNull(schema.sessionCharacters.characterId)
			)
		)
		.orderBy(asc(schema.sessionCharacters.position))
	const faces = cast.slice(0, 3).map((c) => ({
		name: c.nickname || c.name,
		src: c.uuid ? mediaSrc(c.uuid, c.rev ?? 0, true) : null
	}))
	let genreName: string | null = null
	try {
		const { getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		genreName = (await getSessionGenre(db, session.genreId))?.name ?? null
	} catch {
		genreName = null
	}
	const title =
		session.name?.trim() ||
		cast.map((c) => c.nickname || c.name).join(", ") ||
		"Untitled session"
	return { title, subtitle: genreName, faces }
}

async function characterCardBody(db: Db, characterId: number) {
	const [row] = await db
		.select({
			name: schema.characters.name,
			nickname: schema.characters.nickname,
			description: schema.characters.description,
			isPersona: schema.characters.isPersona,
			uuid: schema.files.uuid,
			rev: schema.files.rev
		})
		.from(schema.characters)
		.leftJoin(schema.files, eq(schema.files.id, schema.characters.avatarMediaId))
		.where(eq(schema.characters.id, characterId))
		.limit(1)
	if (!row) return null
	return {
		title: row.nickname || row.name,
		subtitle: excerptOf(row.description),
		avatarSrc: row.uuid ? mediaSrc(row.uuid, row.rev ?? 0, true) : null,
		isPersona: row.isPersona
	}
}

async function lorebookCardBody(db: Db, lorebookId: number) {
	const [row] = await db
		.select({ name: schema.lorebooks.name })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (!row) return null
	const [{ n }] = await db
		.select({ n: count() })
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.archived, false)
			)
		)
	return { title: row.name, subtitle: `${n} ${n === 1 ? "entry" : "entries"}` }
}

function fileCardBody(file: FileRow) {
	const mime = file.displayMime ?? "application/octet-stream"
	const bytes = file.displayBytes ?? 0
	const isImage = file.kind === "image"
	return {
		title: file.filename || (isImage ? "Image" : "File"),
		subtitle: `${mimeLabel(mime)} · ${formatBytes(bytes)}`,
		src: mediaSrc(file.uuid, file.rev),
		thumbSrc: isImage ? mediaSrc(file.uuid, file.rev, true) : null,
		mime,
		bytes,
		isImage
	}
}

/**
 * One attachment as ONE reader may see it: the full card when they pass the
 * gate, otherwise `{available: false}` with why. `id` is the attachment row's
 * id (a picker candidate has no row and passes its `subjectId`).
 */
export async function attachmentCardFor(
	kind: ConversationAttachmentKind,
	subjectId: number,
	viewerId: number,
	db: Db,
	id: number = subjectId
): Promise<ConversationAttachmentCard> {
	const unavailable = (why: "not-shared" | "gone"): ConversationAttachmentCard => ({
		id,
		kind,
		subjectId,
		available: false,
		unavailableWhy: why
	})
	if (!isAttachmentKind(kind)) return unavailable("gone")
	const file = kind === "file" ? await fileRow(db, subjectId) : null
	if (kind === "file" ? !file : !(await subjectExists(db, kind, subjectId)))
		return unavailable("gone")
	if (!(await canSee(db, kind, subjectId, viewerId, file)))
		return unavailable("not-shared")
	switch (kind) {
		case "session": {
			const body = await sessionCardBody(db, subjectId)
			return body
				? { id, kind, subjectId, available: true, ...body }
				: unavailable("gone")
		}
		case "character": {
			const body = await characterCardBody(db, subjectId)
			return body
				? { id, kind, subjectId, available: true, ...body }
				: unavailable("gone")
		}
		case "lorebook": {
			const body = await lorebookCardBody(db, subjectId)
			return body
				? { id, kind, subjectId, available: true, ...body }
				: unavailable("gone")
		}
		case "file":
			return { id, kind, subjectId, available: true, ...fileCardBody(file!) }
	}
}

/** "Nia", "Nia and Tomas", "Nia, Tomas and Ash". */
export function joinNames(names: string[]): string {
	if (names.length <= 1) return names[0] ?? ""
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
