/**
 * **Send with attachments** — a person's tray items become parts of the
 * message they send (PLAN-composer-attachments §3.1 "Commit on Send", phase 2
 * lane D).
 *
 * One transaction, through `tx` only (the outer `db` deadlocks PGlite):
 *
 *  1. every tray item named is the sender's, in this session, and `ready` —
 *     anything else refuses the whole send with a sentence, and the tray stays
 *     as it was;
 *  2. every item's kind passes the **attachment readers** verdict (computed
 *     by the caller BEFORE the transaction — it reads pipelines and
 *     connections, which are not the send's to lock);
 *  3. the message row is written (`insertLegacy`), then one `core:image` /
 *     `core:file` part per item, in tray order, at native ordinals ≥ 10
 *     (`appendParts`) — the body text is the legacy mirror's and is untouched;
 *  4. a file THIS upload created (`fresh`) gets `files.message_id` — the
 *     provenance a deduped file (someone's avatar) already has elsewhere and
 *     keeps;
 *  5. the tray rows go. Their files stay: a sent attachment follows the media
 *     store's no-cascade ruling (plan 28 §2).
 *
 * Part data is the shape `mediaParts` (the host) writes for generated images,
 * so a person's attachment and a pipeline's image are the same part.
 */
import { and, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { appendParts, insertLegacy, type NativePartInput } from "$lib/server/messages/store"
import { getMedia } from "$lib/server/media"
import {
	ATTACHMENT_CAPS,
	ATTACHMENT_COUNT_REFUSAL,
	ATTACHMENT_TYPE_REFUSAL,
	attachmentKindOf
} from "$lib/shared/attachments/caps"
import { TRAY_ITEM_GONE, TrayRefusal } from "./tray"
import type { AttachmentReaders } from "./readers"
import { mediaPartFor } from "./partData"

export const TRAY_ITEM_STILL_UPLOADING =
	"An attachment is still uploading — wait for it to finish, then send."

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The tray item ids a send names, checked for shape and de-duplicated in the
 * order given. Not a list, or an entry that is not an id, is the gone
 * sentence — the same one an id that never existed gets.
 */
export function normaliseTrayItemIds(raw: unknown): string[] {
	if (raw == null) return []
	if (!Array.isArray(raw)) throw new TrayRefusal(TRAY_ITEM_GONE)
	const ids: string[] = []
	for (const id of raw) {
		if (typeof id !== "string" || !UUID.test(id))
			throw new TrayRefusal(TRAY_ITEM_GONE)
		if (!ids.includes(id)) ids.push(id)
	}
	if (ids.length > ATTACHMENT_CAPS.filesPerMessage)
		throw new TrayRefusal(ATTACHMENT_COUNT_REFUSAL)
	return ids
}

export interface CommitTraySendInput {
	userId: number
	sessionId: number
	trayItemIds: string[]
	message: Omit<typeof schema.sessionMessages.$inferInsert, "id">
	readers: AttachmentReaders
}

export interface CommitTraySendResult {
	message: typeof schema.sessionMessages.$inferSelect
	parts: Array<typeof schema.messageParts.$inferSelect>
}

/**
 * Write the message and its attachments, or nothing. Throws `TrayRefusal`
 * (a sentence for the person) on any refusal; the transaction rolls back and
 * the tray is untouched.
 */
export async function commitTraySend(
	db: Db,
	input: CommitTraySendInput
): Promise<CommitTraySendResult> {
	const { userId, sessionId, trayItemIds, readers } = input
	return db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const rows = trayItemIds.length
			? await t
					.select()
					.from(schema.trayItems)
					.where(
						and(
							inArray(schema.trayItems.id, trayItemIds),
							eq(schema.trayItems.userId, userId),
							eq(schema.trayItems.sessionId, sessionId)
						)
					)
			: []
		// Another person's id, another session's, a sent or expired one: one
		// sentence, so an id never tells a stranger it exists.
		if (rows.length !== trayItemIds.length)
			throw new TrayRefusal(TRAY_ITEM_GONE)

		// Tray order — the order the person sees the tiles in.
		rows.sort(
			(a, b) =>
				a.position - b.position ||
				a.createdAt.getTime() - b.createdAt.getTime()
		)

		const parts: NativePartInput[] = []
		const freshFileIds: number[] = []
		for (const row of rows) {
			if (row.status === "uploading")
				throw new TrayRefusal(TRAY_ITEM_STILL_UPLOADING)
			if (row.status !== "ready" || row.fileId == null)
				throw new TrayRefusal(row.refusal ?? TRAY_ITEM_GONE)
			const file = await getMedia(t, row.fileId)
			if (!file) throw new TrayRefusal(TRAY_ITEM_GONE)
			const mime = file.displayMime ?? ""
			const kind = attachmentKindOf(mime)
			if (!kind) throw new TrayRefusal(ATTACHMENT_TYPE_REFUSAL)
			const verdict = readers.kinds[kind]
			if (!verdict?.allowed)
				throw new TrayRefusal(
					verdict?.reason ?? "This reply can't read that kind of file."
				)
			// The tray kept the name the person's file had; the store kept the
			// one it was first stored under. The store's wins (`mediaPartFor`).
			parts.push(
				mediaPartFor(file, {
					as: kind === "image" ? "image" : "file",
					name: row.filename,
					mime
				}) as NativePartInput
			)
			if (row.fresh) freshFileIds.push(file.id)
		}

		const message = await insertLegacy(t, input.message)
		const written = await appendParts(t, message.id, parts)

		if (freshFileIds.length)
			await t
				.update(schema.files)
				.set({ messageId: message.id })
				.where(
					and(
						inArray(schema.files.id, freshFileIds),
						isNull(schema.files.messageId)
					)
				)

		if (rows.length)
			await t.delete(schema.trayItems).where(
				inArray(
					schema.trayItems.id,
					rows.map((r) => r.id)
				)
			)

		return { message, parts: written }
	})
}
