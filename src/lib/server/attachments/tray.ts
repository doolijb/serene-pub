/**
 * **The tray** — files uploaded into a session's composer and not yet sent
 * (PLAN-composer-attachments §3.1, §4.1, §6; phase 1 lane A).
 *
 * A **tray item** is one such file; a person's tray items for one session are
 * their **tray**. ⚠ Not a held import (`imports/heldImports.ts`: one import
 * file waiting on one question), not the downloads tray, not the layout
 * editor's widget tray.
 *
 * ## Lifecycle
 *
 * 1. `beginTrayUpload` — the declared size and the file's first bytes are
 *    checked (type by magic bytes, the kind's cap, the tray's count and bytes,
 *    the person's and the server's in-flight ceilings, the begin rate) BEFORE
 *    any more bytes are accepted. A `tray_items` row is written `uploading`.
 * 2. `appendTrayChunk` — chunks accumulate **in memory**, strictly in order,
 *    each exactly `chunkBytes` but the last. Any lie (a chunk past the
 *    declared size, out of order, the wrong length) ends the upload.
 * 3. `finishTrayUpload` — the whole file is sniffed again, capped, checked
 *    for decode bombs, stripped of photo metadata (images), and stored by
 *    `createMedia` under `data/users/<uid>/sessions/<sid>/` — never under the
 *    OS temp directory. The row becomes `ready` (or `refused`, with the
 *    sentence, so the person sees why).
 * 4. Send (phase 2) turns ready items into message parts and deletes the rows.
 *
 * ## The one deletion rule
 *
 * A row going away never takes its file with it, except through
 * `releaseTrayFile`: only when THIS upload created the file (`fresh` — not a
 * dedupe hit on someone's avatar) **and** nothing references it. Sent
 * attachments follow the media store's no-cascade ruling (plan 28 §2).
 *
 * Every function takes `db` explicitly — the default-db dynamic import
 * bypasses a test's `vi.mock`.
 */
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm"
import type { AttachmentReaders } from "./readers"
import * as schema from "$lib/server/db/schema"
import {
	createMedia,
	deleteFile,
	getMedia,
	mediaUrl,
	sniffMedia
} from "$lib/server/media"
import { assertDecodableSize } from "$lib/server/media/convert/imageSize"
import { stripAttachmentMetadata } from "$lib/server/media/stripMetadata"
import { MediaVariant } from "$lib/shared/constants/MediaVisibility"
import {
	ATTACHMENT_CAPS,
	ATTACHMENT_COUNT_REFUSAL,
	ATTACHMENT_TYPE_REFUSAL,
	attachmentKindOf,
	attachmentSizeRefusal,
	formatCap,
	type AttachmentKind
} from "$lib/shared/attachments/caps"
import type { TrayItemView } from "$lib/shared/sockets/attachments"

const MiB = 1024 * 1024

export const TRAY_LIMITS = {
	/** Unsent tray lifetime (D10). */
	ttlMs: 24 * 60 * 60 * 1000,
	/** An upload that sends nothing for this long is dropped. */
	idleUploadMs: 2 * 60 * 1000,
	/** The sweep's period; it also runs once at boot. */
	sweepEveryMs: 60 * 60 * 1000,
	/** Uploads one person may have in flight at once (§6.8). */
	concurrentUploadsPerUser: 2,
	/** `begin`s one person may make a minute (§6.8). */
	beginsPerMinute: 20,
	/** Bytes one person may have in flight: two of the largest PDF. */
	inFlightBytesPerUser: 64 * MiB,
	/** Bytes everyone may have in flight together; past it the person
	 *  holding the most gives way first (the held-import rule). */
	inFlightBytesTotal: 256 * MiB
} as const

/** Any ask about a tray item that is not the asker's, or is gone. One
 *  sentence either way, so an id never tells a stranger it exists. */
export const TRAY_ITEM_GONE =
	"This attachment is no longer waiting — it was sent, removed or expired. Attach the file again."

export const TRAY_UPLOAD_INTERRUPTED =
	"The upload stopped before it finished. Attach the file again."

const TRAY_BUSY_DROPPED =
	"The server was too busy to finish this upload. Attach the file again."

/** A refusal whose message is a sentence for the person. Anything else
 *  thrown in here is an internal fault and is reworded before it leaves. */
export class TrayRefusal extends Error {}

const STORE_FAILED = "This file couldn't be stored. Try attaching it again."

/* --- in-flight uploads (memory) ------------------------------------- */

interface Upload {
	id: string
	userId: number
	sessionId: number
	filename: string
	declared: number
	received: number
	nextIndex: number
	chunks: Buffer[]
	startedAt: number
	lastAt: number
}

// One store per process, surviving a Vite SSR module reload (memory:
// reload splits server singletons).
const UPLOADS_KEY = Symbol.for("serene-pub.trayUploads")
const uploads: Map<string, Upload> = ((globalThis as any)[UPLOADS_KEY] ??=
	new Map<string, Upload>())
const BEGINS_KEY = Symbol.for("serene-pub.trayBegins")
const begins: Map<number, number[]> = ((globalThis as any)[BEGINS_KEY] ??=
	new Map<number, number[]>())

/** Uploads whose bytes are being stored right now — out of `uploads`, so
 *  no second finish or chunk can reach them, but not yet dead either. */
const finishing = new Set<string>()

/** Whether a row in `uploading` still has a live upload behind it. */
function isLive(id: string): boolean {
	return uploads.has(id) || finishing.has(id)
}

/** Test seam: forget every in-flight upload and begin count. */
export function __resetTrayMemoryForTests(): void {
	uploads.clear()
	begins.clear()
	finishing.clear()
}

/** Bytes reserved by in-flight uploads (declared, not received: the
 *  reservation is what a ceiling must bound). */
function inFlightBytes(userId?: number): number {
	let total = 0
	for (const u of uploads.values())
		if (userId === undefined || u.userId === userId) total += u.declared
	return total
}

function uploadsOf(userId: number): Upload[] {
	return [...uploads.values()].filter((u) => u.userId === userId)
}

/** Record a begin and say whether it is over the per-minute rate. */
function overBeginRate(userId: number, now: number): boolean {
	const recent = (begins.get(userId) ?? []).filter((t) => now - t < 60_000)
	if (recent.length >= TRAY_LIMITS.beginsPerMinute) {
		begins.set(userId, recent)
		return true
	}
	recent.push(now)
	begins.set(userId, recent)
	return false
}

/**
 * The oldest upload of whoever holds the most in-flight bytes — counting the
 * `incoming` bytes `userId` is about to reserve. Map order is insertion
 * order, so each person's first upload is their oldest.
 */
function heaviestHoldersOldest(userId: number, incoming: number): Upload | null {
	const held = new Map<number, number>([[userId, incoming]])
	const oldest = new Map<number, Upload>()
	for (const u of uploads.values()) {
		held.set(u.userId, (held.get(u.userId) ?? 0) + u.declared)
		if (!oldest.has(u.userId)) oldest.set(u.userId, u)
	}
	let pick: Upload | null = null
	let most = -1
	for (const [owner, upload] of oldest) {
		const bytes = held.get(owner)!
		if (bytes > most) {
			most = bytes
			pick = upload
		}
	}
	return pick
}

/** End an in-flight upload: forget its chunks and mark its row refused. */
async function abortUpload(
	db: Db,
	upload: Upload,
	refusal: string
): Promise<void> {
	uploads.delete(upload.id)
	await db
		.update(schema.trayItems)
		.set({ status: "refused", refusal })
		.where(eq(schema.trayItems.id, upload.id))
}

/* --- begin ---------------------------------------------------------- */

export interface BeginTrayUploadInput {
	userId: number
	sessionId: number
	filename: string
	bytes: number
	head: Buffer | Uint8Array
	/**
	 * The session's attachment readers (§3.2), computed by the caller outside
	 * any transaction. A kind no reading call reads is refused here, before a
	 * byte more arrives; absent, only the store's own rules apply.
	 */
	readers?: Pick<AttachmentReaders, "kinds">
}

const FILENAME_MAX = 255

function cleanFilename(raw: unknown): string {
	const name =
		typeof raw === "string"
			? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim()
			: ""
	return (name || "file").slice(0, FILENAME_MAX)
}

/**
 * Check what can be checked before a byte more is accepted, then open the
 * upload. Session access is the CALLER's check (the socket layer), made
 * before this runs.
 */
export async function beginTrayUpload(
	db: Db,
	input: BeginTrayUploadInput,
	now = Date.now()
): Promise<{ trayItemId: string; chunkBytes: number; filename: string }> {
	const filename = cleanFilename(input.filename)
	const declared = input.bytes
	if (!Number.isSafeInteger(declared) || declared <= 0)
		throw new TrayRefusal("That file is empty.")
	if (declared > ATTACHMENT_CAPS.absoluteBytes)
		throw new TrayRefusal(
			`A file can be at most ${formatCap(ATTACHMENT_CAPS.absoluteBytes)}.`
		)
	const head = Buffer.isBuffer(input.head)
		? input.head
		: input.head instanceof Uint8Array
			? Buffer.from(input.head)
			: null
	if (!head || head.length !== Math.min(declared, ATTACHMENT_CAPS.headBytes))
		throw new TrayRefusal(TRAY_UPLOAD_INTERRUPTED)

	// Type by magic bytes, on the head: an SVG or an EXE is refused before
	// its body is sent. A head that is only a prefix may end inside a UTF-8
	// character, which is not evidence of a binary.
	const kind = await kindOf(
		head.length < declared ? withoutPartialUtf8Tail(head) : head,
		filename
	)
	const verdict = input.readers?.kinds[kind]
	if (verdict && !verdict.allowed)
		throw new TrayRefusal(
			verdict.reason ?? "This reply can't read that kind of file."
		)
	const sizeRefusal = attachmentSizeRefusal(kind, declared)
	if (sizeRefusal) throw new TrayRefusal(sizeRefusal)

	// The tray: one message's worth.
	const [tray] = await db
		.select({
			count: sql<number>`count(*)::int`,
			bytes: sql<number>`coalesce(sum(${schema.trayItems.bytes}), 0)::int`
		})
		.from(schema.trayItems)
		.where(
			and(
				eq(schema.trayItems.userId, input.userId),
				eq(schema.trayItems.sessionId, input.sessionId),
				ne(schema.trayItems.status, "refused")
			)
		)
	if ((tray?.count ?? 0) >= ATTACHMENT_CAPS.filesPerMessage)
		throw new TrayRefusal(ATTACHMENT_COUNT_REFUSAL)
	if ((tray?.bytes ?? 0) + declared > ATTACHMENT_CAPS.trayBytes)
		throw new TrayRefusal(
			`A message's attachments can be at most ${formatCap(ATTACHMENT_CAPS.trayBytes)} together.`
		)

	// The person's own bounds.
	if (uploadsOf(input.userId).length >= TRAY_LIMITS.concurrentUploadsPerUser)
		throw new TrayRefusal(
			"Wait for your other uploads to finish, then try again."
		)
	if (inFlightBytes(input.userId) + declared > TRAY_LIMITS.inFlightBytesPerUser)
		throw new TrayRefusal(
			"Wait for your other uploads to finish, then try again."
		)
	if (overBeginRate(input.userId, now))
		throw new TrayRefusal(
			"Too many attachments in a minute. Wait a moment, then try again."
		)

	// The server's bound: the person holding the most gives way first.
	while (inFlightBytes() + declared > TRAY_LIMITS.inFlightBytesTotal) {
		const victim = heaviestHoldersOldest(input.userId, declared)
		if (!victim) break
		await abortUpload(db, victim, TRAY_BUSY_DROPPED)
	}

	const [{ position }] = await db
		.select({
			position: sql<number>`coalesce(max(${schema.trayItems.position}), -1)::int + 1`
		})
		.from(schema.trayItems)
		.where(
			and(
				eq(schema.trayItems.userId, input.userId),
				eq(schema.trayItems.sessionId, input.sessionId)
			)
		)
	const [row] = await db
		.insert(schema.trayItems)
		.values({
			userId: input.userId,
			sessionId: input.sessionId,
			filename,
			bytes: declared,
			status: "uploading",
			position
		})
		.returning({ id: schema.trayItems.id })

	uploads.set(row.id, {
		id: row.id,
		userId: input.userId,
		sessionId: input.sessionId,
		filename,
		declared,
		received: 0,
		nextIndex: 0,
		chunks: [],
		startedAt: now,
		lastAt: now
	})
	return {
		trayItemId: row.id,
		chunkBytes: ATTACHMENT_CAPS.chunkBytes,
		filename
	}
}

/** `bytes` less a trailing, incomplete UTF-8 sequence (at most 3 bytes). */
function withoutPartialUtf8Tail(bytes: Buffer): Buffer {
	for (let back = 1; back <= Math.min(3, bytes.length); back++) {
		const byte = bytes[bytes.length - back]
		if ((byte & 0xc0) === 0x80) continue // a continuation byte
		const need =
			(byte & 0xe0) === 0xc0 ? 2 : (byte & 0xf0) === 0xe0 ? 3 : (byte & 0xf8) === 0xf0 ? 4 : 1
		return need > back ? bytes.subarray(0, bytes.length - back) : bytes
	}
	return bytes
}

/** The attachment kind of some bytes, or a refusal sentence. */
async function kindOf(bytes: Buffer, filename: string): Promise<AttachmentKind> {
	let mime: string
	try {
		mime = (await sniffMedia(bytes, { filename, allowDocuments: true })).mime
	} catch (error: any) {
		// HEIC carries its own actionable sentence; every other unknown type
		// gets the attachment one (the store's lists types no model reads).
		const message = String(error?.message ?? "")
		throw new TrayRefusal(
			message.startsWith("HEIC") ? message : ATTACHMENT_TYPE_REFUSAL
		)
	}
	const kind = attachmentKindOf(mime)
	if (!kind) throw new TrayRefusal(ATTACHMENT_TYPE_REFUSAL)
	// SVG has no magic bytes, so the store's text sniff would take it as a
	// `.txt`. It stays refused (§6.1): a file that IS an SVG document, or is
	// named as one, is not a text attachment.
	if (kind === "text" && looksLikeSvg(bytes, filename))
		throw new TrayRefusal(ATTACHMENT_TYPE_REFUSAL)
	return kind
}

/** An SVG document: named `.svg`, or text whose first element is `<svg`
 *  (after an optional BOM, XML prolog, comments and doctype). Markdown that
 *  merely quotes SVG code is still text. */
const SVG_START =
	/^\uFEFF?\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>/]/i
function looksLikeSvg(bytes: Buffer, filename: string): boolean {
	if (/\.svgz?$/i.test(filename)) return true
	return SVG_START.test(bytes.subarray(0, 4100).toString("utf-8"))
}

/* --- chunk ---------------------------------------------------------- */

/** The in-flight upload `trayItemId` of `userId`, or the gone sentence. */
function ownUpload(userId: number, trayItemId: unknown): Upload {
	const upload =
		typeof trayItemId === "string" ? uploads.get(trayItemId) : undefined
	if (!upload || upload.userId !== userId) throw new TrayRefusal(TRAY_ITEM_GONE)
	return upload
}

export async function appendTrayChunk(
	db: Db,
	userId: number,
	params: { trayItemId: string; index: number; data: Buffer | Uint8Array },
	now = Date.now()
): Promise<{ sessionId: number; received: number; bytes: number }> {
	const upload = ownUpload(userId, params.trayItemId)
	const data = Buffer.isBuffer(params.data)
		? params.data
		: params.data instanceof Uint8Array
			? Buffer.from(params.data)
			: null
	if (params.index !== upload.nextIndex || !data) {
		await abortUpload(db, upload, TRAY_UPLOAD_INTERRUPTED)
		throw new TrayRefusal(TRAY_UPLOAD_INTERRUPTED)
	}
	const remaining = upload.declared - upload.received
	const expected = Math.min(ATTACHMENT_CAPS.chunkBytes, remaining)
	if (data.length > remaining) {
		// More bytes than were declared: the size was a lie.
		await abortUpload(db, upload, "The file was larger than it said.")
		throw new TrayRefusal("The file was larger than it said.")
	}
	if (data.length !== expected) {
		await abortUpload(db, upload, TRAY_UPLOAD_INTERRUPTED)
		throw new TrayRefusal(TRAY_UPLOAD_INTERRUPTED)
	}
	upload.chunks.push(data)
	upload.received += data.length
	upload.nextIndex++
	upload.lastAt = now
	return {
		sessionId: upload.sessionId,
		received: upload.received,
		bytes: upload.declared
	}
}

/* --- finish --------------------------------------------------------- */

/** Every byte is UTF-8 text with no control bytes but tab, LF and CR. */
function isWholeText(bytes: Buffer): boolean {
	for (const byte of bytes) {
		if (byte === 9 || byte === 10 || byte === 13) continue
		if (byte < 32 || byte === 127) return false
	}
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes)
		return true
	} catch {
		return false
	}
}

/**
 * Store the file. Resolves with the item — `ready`, or `refused` with the
 * sentence. Rejects only with the gone sentence (not the asker's, or no
 * longer uploading).
 */
export async function finishTrayUpload(
	db: Db,
	userId: number,
	trayItemId: string
): Promise<TrayItemView> {
	const upload = ownUpload(userId, trayItemId)
	uploads.delete(upload.id)
	finishing.add(upload.id)
	try {
		return await storeUpload(db, userId, upload)
	} finally {
		finishing.delete(upload.id)
	}
}

async function storeUpload(
	db: Db,
	userId: number,
	upload: Upload
): Promise<TrayItemView> {
	if (upload.received !== upload.declared) {
		await abortUpload(db, upload, TRAY_UPLOAD_INTERRUPTED)
		return (await trayItemView(db, userId, upload.id))!
	}
	const raw = Buffer.concat(upload.chunks)
	upload.chunks = []

	try {
		const kind = await kindOf(raw, upload.filename)
		const sizeRefusal = attachmentSizeRefusal(kind, raw.length)
		if (sizeRefusal) throw new TrayRefusal(sizeRefusal)
		let bytes: Buffer = raw
		if (kind === "text" && !isWholeText(raw))
			throw new TrayRefusal(ATTACHMENT_TYPE_REFUSAL)
		if (kind === "image") {
			try {
				// The pixel ceiling from the header, before anything decodes.
				assertDecodableSize(raw)
			} catch (error: any) {
				throw new TrayRefusal(String(error?.message))
			}
			const mime = (await sniffMedia(raw, { allowDocuments: true })).mime
			try {
				bytes = (await stripAttachmentMetadata(raw, mime)).bytes
			} catch (error: any) {
				throw new TrayRefusal(String(error?.message))
			}
		}
		const created = await createMedia(db, {
			userId,
			sessionId: upload.sessionId,
			bytes,
			filename: upload.filename,
			allowDocuments: true
		})
		const [row] = await db
			.update(schema.trayItems)
			.set({
				status: "ready",
				refusal: null,
				fileId: created.file.id,
				fresh: created.created,
				bytes: bytes.length
			})
			.where(eq(schema.trayItems.id, upload.id))
			.returning({ id: schema.trayItems.id })
		// Removed (or swept) while the file was being stored: the file must
		// not outlive the item that made it.
		if (!row) {
			if (created.created) await releaseTrayFile(db, created.file.id)
			throw new TrayRefusal(TRAY_ITEM_GONE)
		}
	} catch (error) {
		if (!(error instanceof TrayRefusal))
			console.error("[tray] storing an attachment failed:", error)
		const refusal = error instanceof TrayRefusal ? error.message : STORE_FAILED
		if (refusal === TRAY_ITEM_GONE) throw error
		await db
			.update(schema.trayItems)
			.set({ status: "refused", refusal })
			.where(eq(schema.trayItems.id, upload.id))
	}
	const view = await trayItemView(db, userId, upload.id)
	if (!view) throw new TrayRefusal(TRAY_ITEM_GONE)
	return view
}

/* --- remove, list --------------------------------------------------- */

/** Take an item out of the tray; its file goes too only under the one
 *  deletion rule. Resolves with the item's session. */
export async function removeTrayItem(
	db: Db,
	userId: number,
	trayItemId: string
): Promise<{ sessionId: number }> {
	if (typeof trayItemId !== "string") throw new TrayRefusal(TRAY_ITEM_GONE)
	const upload = uploads.get(trayItemId)
	if (upload?.userId === userId) uploads.delete(trayItemId)
	const [row] = await db
		.delete(schema.trayItems)
		.where(
			and(
				eq(schema.trayItems.id, trayItemId),
				eq(schema.trayItems.userId, userId)
			)
		)
		.returning()
	if (!row) throw new TrayRefusal(TRAY_ITEM_GONE)
	if (row.fresh && row.fileId != null) await releaseTrayFile(db, row.fileId)
	return { sessionId: row.sessionId }
}

/** One person's tray for one session, in tray order. */
export async function listTray(
	db: Db,
	userId: number,
	sessionId: number
): Promise<TrayItemView[]> {
	const rows = await db
		.select()
		.from(schema.trayItems)
		.where(
			and(
				eq(schema.trayItems.userId, userId),
				eq(schema.trayItems.sessionId, sessionId)
			)
		)
		.orderBy(asc(schema.trayItems.position), asc(schema.trayItems.createdAt))
	return Promise.all(rows.map((row) => toView(db, row)))
}

async function trayItemView(
	db: Db,
	userId: number,
	id: string
): Promise<TrayItemView | null> {
	const row = await db.query.trayItems.findFirst({
		where: and(
			eq(schema.trayItems.id, id),
			eq(schema.trayItems.userId, userId)
		)
	})
	return row ? toView(db, row) : null
}

type TrayRow = typeof schema.trayItems.$inferSelect

async function toView(db: Db, row: TrayRow): Promise<TrayItemView> {
	const file = row.fileId != null ? await getMedia(db, row.fileId) : null
	const mime = file?.displayMime ?? null
	// An `uploading` row with no upload in memory belongs to a process that
	// has gone (a restart); say so rather than show a bar that never moves.
	const orphaned = row.status === "uploading" && !isLive(row.id)
	return {
		id: row.id,
		sessionId: row.sessionId,
		status: orphaned ? "refused" : (row.status as TrayItemView["status"]),
		refusal: orphaned ? TRAY_UPLOAD_INTERRUPTED : row.refusal,
		filename: row.filename,
		bytes: row.bytes,
		position: row.position,
		attachmentKind: mime ? attachmentKindOf(mime) : null,
		mime,
		file: file
			? {
					id: file.id,
					uuid: file.uuid,
					width: file.width,
					height: file.height,
					url: mediaUrl(file.uuid, file.rev),
					thumbUrl: mediaUrl(file.uuid, file.rev, MediaVariant.THUMB)
				}
			: null,
		createdAt: row.createdAt.toISOString()
	}
}

/* --- the deletion rule ---------------------------------------------- */

/**
 * Is anything pointing at file `fileId` — anything a tray deletion would
 * break? Over-reports rather than under-reports:
 *
 * - the file's own provenance moved past the tray (`messageId` set at Send,
 *   or a `characterId` from a re-parent);
 * - a message part naming it (`data->>'assetId'`, `message_parts_asset_idx`),
 *   whatever its type;
 * - another tray item (a second attach of the same bytes deduped onto it);
 * - an avatar, a sprite, a user's background.
 *
 * Not checked: an `{kind:"image", assetId}` block nested in a part's block
 * tree (a plugin's), which no index can reach. A fresh tray file — at most a
 * day old, in this person's own session directory — reaching one is not a
 * path any core writer takes.
 */
export async function isFileReferenced(
	db: Db,
	fileId: number,
	opts: { exceptTrayItemId?: string } = {}
): Promise<boolean> {
	const file = await getMedia(db, fileId)
	if (!file) return false
	if (file.messageId != null || file.characterId != null) return true
	const part = await db
		.select({ id: schema.messageParts.id })
		.from(schema.messageParts)
		.where(sql`(${schema.messageParts.data}->>'assetId') = ${String(fileId)}`)
		.limit(1)
	if (part.length) return true
	const tray = await db
		.select({ id: schema.trayItems.id })
		.from(schema.trayItems)
		.where(
			opts.exceptTrayItemId
				? and(
						eq(schema.trayItems.fileId, fileId),
						ne(schema.trayItems.id, opts.exceptTrayItemId)
					)
				: eq(schema.trayItems.fileId, fileId)
		)
		.limit(1)
	if (tray.length) return true
	const avatar = await db
		.select({ id: schema.characters.id })
		.from(schema.characters)
		.where(eq(schema.characters.avatarMediaId, fileId))
		.limit(1)
	if (avatar.length) return true
	const sprite = await db
		.select({ id: schema.sprites.id })
		.from(schema.sprites)
		.where(eq(schema.sprites.fileId, fileId))
		.limit(1)
	if (sprite.length) return true
	const background = await db
		.select({ id: schema.userSettings.id })
		.from(schema.userSettings)
		.where(eq(schema.userSettings.backgroundMediaId, fileId))
		.limit(1)
	return background.length > 0
}

/** Delete a file a tray item created, if nothing references it. Call only
 *  for a `fresh` item's file, after its row is gone. */
export async function releaseTrayFile(db: Db, fileId: number): Promise<boolean> {
	if (await isFileReferenced(db, fileId)) return false
	await deleteFile(db, fileId)
	return true
}

/* --- the sweep ------------------------------------------------------ */

export interface TraySweepResult {
	/** In-flight uploads dropped for sending nothing. */
	idle: number
	/** Rows expired by the TTL. */
	expired: number
	/** Files those expiries deleted. */
	filesDeleted: number
}

/**
 * Drop idle uploads, mark uploads a dead process left behind, and expire tray
 * items older than the TTL — deleting a file only under the one rule.
 */
export async function sweepTray(
	db: Db,
	now = Date.now()
): Promise<TraySweepResult> {
	let idle = 0
	for (const upload of [...uploads.values()]) {
		if (now - upload.lastAt > TRAY_LIMITS.idleUploadMs) {
			await abortUpload(db, upload, TRAY_UPLOAD_INTERRUPTED)
			idle++
		}
	}

	const stale = await db
		.select({ id: schema.trayItems.id })
		.from(schema.trayItems)
		.where(eq(schema.trayItems.status, "uploading"))
	const dead = stale.map((r) => r.id).filter((id) => !isLive(id))
	if (dead.length)
		await db
			.update(schema.trayItems)
			.set({ status: "refused", refusal: TRAY_UPLOAD_INTERRUPTED })
			.where(inArray(schema.trayItems.id, dead))

	const expired = await db
		.delete(schema.trayItems)
		.where(lt(schema.trayItems.createdAt, new Date(now - TRAY_LIMITS.ttlMs)))
		.returning()
	let filesDeleted = 0
	for (const row of expired) {
		uploads.delete(row.id)
		if (row.fresh && row.fileId != null)
			if (await releaseTrayFile(db, row.fileId)) filesDeleted++
	}
	return { idle, expired: expired.length, filesDeleted }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null

/** Boot: sweep once, then every `sweepEveryMs`. Never holds the process open. */
export async function startTraySweep(): Promise<void> {
	const { db, dbReady } = await import("$lib/server/db")
	await dbReady
	const run = () =>
		sweepTray(db as unknown as Db).catch((error) =>
			console.error("[tray] sweep failed:", error)
		)
	await run()
	if (!sweepTimer) {
		sweepTimer = setInterval(run, TRAY_LIMITS.sweepEveryMs)
		sweepTimer.unref?.()
	}
}

export async function stopTraySweep(): Promise<void> {
	if (sweepTimer) clearInterval(sweepTimer)
	sweepTimer = null
}
