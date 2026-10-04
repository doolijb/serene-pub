/**
 * **A transcript's attachments** — the read behind
 * `core:query/history-attachments@1` (PLAN-composer-attachments §3.5).
 *
 * For the given message ids, the files each message's ACTIVE revision shows
 * (`core:image` / `core:file` parts, in part order), as `HistoryAttachmentV1`
 * references keyed by message id. One query for the parts, one for the
 * files. A text file's body is read off disk up to `textFileBytes`, because a
 * text file reaches every model as text and the placement step that reads
 * this is pure.
 *
 * Scoped to one session: a message id of any other session contributes
 * nothing, however it reached the query. A part naming a file missing from
 * the store is dropped — the media strip shows that tile as missing (the
 * lightbox's "File … available" line), and a prompt has nothing to send
 * for it.
 *
 * Takes `db` explicitly (the run's own handle).
 */
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { HistoryAttachmentV1 } from "@serene-pub/sdk"
import { attachmentKindOf } from "$lib/shared/attachments/caps"
import { ATTACHMENT_PART_TYPES } from "./references"

export const TEXT_FILE_BYTES_DEFAULT = 65536

const MEDIA_KINDS = new Set(["image", "audio", "video", "document"])

export async function historyAttachmentsFor(
	db: Db,
	input: {
		sessionId: number
		messageIds: readonly number[]
		textFileBytes?: number
	}
): Promise<Record<string, HistoryAttachmentV1[]>> {
	const ids = [
		...new Set(
			input.messageIds.filter((id) => Number.isInteger(id) && id > 0)
		)
	]
	if (!ids.length) return {}

	const rows = await db
		.select({
			messageId: schema.messageParts.messageId,
			step: schema.messageParts.step,
			revision: schema.messageParts.revision,
			ordinal: schema.messageParts.ordinal,
			type: schema.messageParts.type,
			data: schema.messageParts.data,
			activeRevisions: schema.messages.activeRevisions
		})
		.from(schema.messageParts)
		.innerJoin(
			schema.messages,
			eq(schema.messages.id, schema.messageParts.messageId)
		)
		.where(
			and(
				inArray(schema.messageParts.messageId, ids),
				eq(schema.messages.sessionId, input.sessionId),
				inArray(schema.messageParts.type, [...ATTACHMENT_PART_TYPES])
			)
		)
	// The revision that shows, per step — `textOf`'s rule: the map's entry,
	// else revision 0.
	const active = rows
		.filter(
			(r) =>
				r.revision ===
				(((r.activeRevisions ?? {}) as Record<string, number>)[
					String(r.step)
				] ?? 0)
		)
		.sort(
			(a, b) =>
				a.messageId - b.messageId ||
				a.step - b.step ||
				a.ordinal - b.ordinal
		)
	const assetIdOf = (data: unknown): number | null => {
		const raw = (data as { assetId?: unknown } | null)?.assetId
		const n = typeof raw === "string" ? Number(raw) : raw
		return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null
	}
	const fileIds = [
		...new Set(active.map((r) => assetIdOf(r.data)).filter((n): n is number => n != null))
	]
	if (!fileIds.length) return {}
	const files = await db
		.select()
		.from(schema.files)
		.where(inArray(schema.files.id, fileIds))
	const fileById = new Map(files.map((f) => [f.id, f]))

	const cap = Math.max(
		0,
		Math.floor(input.textFileBytes ?? TEXT_FILE_BYTES_DEFAULT)
	)
	const bodies = new Map<number, { body: string; truncated: boolean }>()
	const out: Record<string, HistoryAttachmentV1[]> = {}
	for (const row of active) {
		const fileId = assetIdOf(row.data)
		const file = fileId != null ? fileById.get(fileId) : undefined
		if (!file) continue
		const data = (row.data ?? {}) as Record<string, unknown>
		const mime =
			file.displayMime ??
			(typeof data.mime === "string" ? data.mime : "application/octet-stream")
		const attachmentKind =
			row.type === "core:image" ? "image" : attachmentKindOf(mime)
		const ref: HistoryAttachmentV1 = {
			uuid: String(file.uuid),
			kind: (MEDIA_KINDS.has(file.kind) ? file.kind : "document") as HistoryAttachmentV1["kind"],
			mime,
			bytes: file.displayBytes ?? 0,
			...(file.width ? { width: file.width } : {}),
			...(file.height ? { height: file.height } : {}),
			...(() => {
				const name =
					file.filename ??
					(typeof data.filename === "string" ? data.filename : null) ??
					(typeof data.name === "string" ? data.name : null)
				return name ? { filename: name } : {}
			})(),
			...(typeof data.alt === "string" && data.alt.trim()
				? { text: data.alt.trim() }
				: {}),
			attachmentKind
		}
		if (attachmentKind === "text") {
			let read = bodies.get(file.id)
			if (!read) {
				read = await readTextBody(db, file.id, cap)
				bodies.set(file.id, read)
			}
			ref.body = read.body
			if (read.truncated) ref.bodyTruncated = true
		}
		;(out[String(row.messageId)] ??= []).push(ref)
	}
	return out
}

/** A text file's body, decoded, cut at `cap` bytes (never mid-character). */
async function readTextBody(
	db: Db,
	fileId: number,
	cap: number
): Promise<{ body: string; truncated: boolean }> {
	const { readMedia } = await import("$lib/server/media")
	const read = await readMedia(db, fileId)
	if (!read) return { body: "", truncated: false }
	const bytes = read.bytes
	const truncated = bytes.length > cap
	let body = new TextDecoder("utf-8", { fatal: false }).decode(
		truncated ? bytes.subarray(0, cap) : bytes
	)
	// A cut inside a multi-byte character decodes to U+FFFD at the end.
	if (truncated) body = body.replace(/�+$/, "")
	// A byte-order mark is not text.
	if (body.charCodeAt(0) === 0xfeff) body = body.slice(1)
	return { body, truncated }
}
