/**
 * `attachments:*` — the composer tray's upload family
 * (PLAN-composer-attachments §3.1, phase 1 lane B).
 *
 * Thin: access, then one call into `$lib/server/attachments/tray`, which owns
 * every cap and the one deletion rule. The wire contract — who hears which
 * reply — is stated in `$lib/shared/sockets/attachments`:
 *
 * - `begin` / `chunk` answer the socket that asked and no other tab: a chunk
 *   ack is progress for one upload, and every tab hearing a reply per MiB is
 *   noise.
 * - `finish` / `remove` / `list` reach every tab of the person, so a tray
 *   reappears in a second tab like a draft does.
 * - Every refusal goes to the asker (the `register()` wrapper routes
 *   `<event>:error` there), carrying `sessionId` and `trayItemId` when known.
 *
 * **Who may stage.** Anyone with access to the session — its owner and its
 * guests (D8: guests may attach, as they may send). Checked at `begin`, at
 * `list`, and again at `finish`, so a guest removed mid-upload stores
 * nothing. A tray item is its uploader's alone (`tray_items.user_id`).
 */
import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	TRAY_ITEM_GONE,
	TrayRefusal,
	appendTrayChunk,
	beginTrayUpload,
	finishTrayUpload,
	listTray,
	removeTrayItem
} from "$lib/server/attachments/tray"
import { attachmentReaders } from "$lib/server/attachments/readers"
import { redactConnections } from "$lib/server/connections/visibility"
import type {
	AttachmentsReadersParams,
	AttachmentsReadersResponse,
	AttachmentsBeginParams,
	AttachmentsBeginResponse,
	AttachmentsChunkParams,
	AttachmentsChunkResponse,
	AttachmentsError,
	AttachmentsFinishParams,
	AttachmentsFinishResponse,
	AttachmentsListParams,
	AttachmentsListResponse,
	AttachmentsRemoveFromMessageParams,
	AttachmentsRemoveFromMessageResponse,
	AttachmentsRemoveParams,
	AttachmentsRemoveResponse
} from "$lib/shared/sockets/attachments"

const NO_ACCESS = "Session not found or no permission to access."

/** A sentence for the person: a tray refusal as worded, anything else
 *  generic (and logged) so no internal detail leaves. */
function sentence(error: unknown, fallback: string): string {
	if (error instanceof TrayRefusal) return error.message
	console.error("[attachments]", error)
	return fallback
}

/**
 * Reply to the asking socket only, through the one projection: the room is
 * the socket itself and the subject is its own `socket.user`, so recipient
 * and subject are the same person.
 */
function replyToAsker(socket: any, event: string, data: unknown): void {
	socket.emit?.(event, redactConnections(data, socket.user))
}

async function requireSession(sessionId: unknown, userId: number) {
	if (!Number.isSafeInteger(sessionId)) throw new TrayRefusal(NO_ACCESS)
	const access = await checkSessionAccess(sessionId as number, userId)
	if (!access.hasAccess) throw new TrayRefusal(NO_ACCESS)
}

/** The session a tray item of `userId` belongs to, or the gone sentence. */
async function sessionOfItem(userId: number, trayItemId: unknown) {
	if (typeof trayItemId !== "string") throw new TrayRefusal(TRAY_ITEM_GONE)
	const row = await db.query.trayItems
		.findFirst({
			where: and(
				eq(schema.trayItems.id, trayItemId),
				eq(schema.trayItems.userId, userId)
			),
			columns: { sessionId: true }
		})
		// A malformed uuid is a driver error, and the same answer as a
		// stranger's id.
		.catch(() => undefined)
	if (!row) throw new TrayRefusal(TRAY_ITEM_GONE)
	return row.sessionId
}

export const attachmentsBegin: Handler<
	AttachmentsBeginParams,
	AttachmentsBeginResponse
> = {
	event: "attachments:begin",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		try {
			await requireSession(params?.sessionId, userId)
			// The reading rule (§3.2): a kind nothing in this session's reply
			// reads is refused before its body is sent. Outside any
			// transaction — it reads pipelines and connections.
			const readers = await attachmentReaders(db, {
				sessionId: params.sessionId,
				userId
			})
			const opened = await beginTrayUpload(db, {
				userId,
				sessionId: params.sessionId,
				filename: params.filename,
				bytes: params.bytes,
				head: params.head,
				readers
			})
			const res: AttachmentsBeginResponse = {
				sessionId: params.sessionId,
				...opened
			}
			replyToAsker(socket, "attachments:begin", res)
			return res
		} catch (error) {
			const err: AttachmentsError = {
				error: sentence(error, "Couldn't start the upload."),
				sessionId: params?.sessionId
			}
			emitToUser("attachments:begin:error", err)
			// A refusal is an answer, not a fault: only a fault reaches the
			// wrapper's log.
			if (!(error instanceof TrayRefusal)) throw error
			return undefined as never
		}
	}
}

export const attachmentsChunk: Handler<
	AttachmentsChunkParams,
	AttachmentsChunkResponse
> = {
	event: "attachments:chunk",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		try {
			const progress = await appendTrayChunk(db, userId, {
				trayItemId: params?.trayItemId,
				index: params?.index,
				data: params?.data
			})
			const res: AttachmentsChunkResponse = {
				sessionId: progress.sessionId,
				trayItemId: params.trayItemId,
				index: params.index,
				received: progress.received,
				bytes: progress.bytes
			}
			replyToAsker(socket, "attachments:chunk", res)
			return res
		} catch (error) {
			const err: AttachmentsError = {
				error: sentence(error, "The upload failed."),
				trayItemId: params?.trayItemId
			}
			emitToUser("attachments:chunk:error", err)
			// A refusal is an answer, not a fault: only a fault reaches the
			// wrapper's log.
			if (!(error instanceof TrayRefusal)) throw error
			return undefined as never
		}
	}
}

export const attachmentsFinish: Handler<
	AttachmentsFinishParams,
	AttachmentsFinishResponse
> = {
	event: "attachments:finish",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		let sessionId: number | undefined
		try {
			sessionId = await sessionOfItem(userId, params?.trayItemId)
			try {
				await requireSession(sessionId, userId)
			} catch (error) {
				// Access gone mid-upload: nothing is stored, and the item goes.
				await removeTrayItem(db, userId, params.trayItemId).catch(
					() => {}
				)
				throw error
			}
			const trayItem = await finishTrayUpload(db, userId, params.trayItemId)
			const res: AttachmentsFinishResponse = { sessionId, trayItem }
			emitToUser("attachments:finish", res)
			return res
		} catch (error) {
			const err: AttachmentsError = {
				error: sentence(error, "Couldn't store the file."),
				sessionId,
				trayItemId: params?.trayItemId
			}
			emitToUser("attachments:finish:error", err)
			// A refusal is an answer, not a fault: only a fault reaches the
			// wrapper's log.
			if (!(error instanceof TrayRefusal)) throw error
			return undefined as never
		}
	}
}

export const attachmentsRemove: Handler<
	AttachmentsRemoveParams,
	AttachmentsRemoveResponse
> = {
	event: "attachments:remove",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		try {
			// Own items only, and no session check: taking your own file back
			// out of a session you have since lost access to is allowed.
			await sessionOfItem(userId, params?.trayItemId)
			const { sessionId } = await removeTrayItem(
				db,
				userId,
				params.trayItemId
			)
			const res: AttachmentsRemoveResponse = {
				sessionId,
				trayItemId: params.trayItemId
			}
			emitToUser("attachments:remove", res)
			return res
		} catch (error) {
			const err: AttachmentsError = {
				error: sentence(error, "Couldn't remove the attachment."),
				trayItemId: params?.trayItemId
			}
			emitToUser("attachments:remove:error", err)
			// A refusal is an answer, not a fault: only a fault reaches the
			// wrapper's log.
			if (!(error instanceof TrayRefusal)) throw error
			return undefined as never
		}
	}
}

export const attachmentsList: Handler<
	AttachmentsListParams,
	AttachmentsListResponse
> = {
	event: "attachments:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		try {
			await requireSession(params?.sessionId, userId)
			const res: AttachmentsListResponse = {
				sessionId: params.sessionId,
				tray: await listTray(db, userId, params.sessionId)
			}
			emitToUser("attachments:list", res)
			return res
		} catch (error) {
			const err: AttachmentsError = {
				error: sentence(error, "Couldn't read the attachments."),
				sessionId: params?.sessionId
			}
			emitToUser("attachments:list:error", err)
			// A refusal is an answer, not a fault: only a fault reaches the
			// wrapper's log.
			if (!(error instanceof TrayRefusal)) throw error
			return undefined as never
		}
	}
}

/**
 * Take one attachment off a SENT message (D9: remove only). Whoever may edit
 * the message may; the file stays (no-cascade). The changed row is pushed to
 * the session like any other row change, with its parts.
 */
export const attachmentsRemoveFromMessage: Handler<
	AttachmentsRemoveFromMessageParams,
	AttachmentsRemoveFromMessageResponse
> = {
	event: "attachments:removeFromMessage",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		let sessionId: number | undefined
		try {
			const { removeMessageAttachment } = await import(
				"$lib/server/attachments/remove"
			)
			const removed = await removeMessageAttachment(db, {
				userId,
				messageId: params?.messageId,
				partId: params?.partId
			})
			sessionId = removed.sessionId
			const res: AttachmentsRemoveFromMessageResponse = {
				sessionId: removed.sessionId,
				messageId: removed.messageId,
				partId: removed.partId
			}
			emitToUser("attachments:removeFromMessage", res)

			const [row] = await db
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, removed.messageId))
			if (row) {
				const { attachParts } = await import("$lib/server/messages/store")
				const { broadcastToSessionUsers } = await import(
					"./utils/broadcastHelpers"
				)
				const [sessionMessage] = await attachParts(db, [row])
				await broadcastToSessionUsers(
					socket.io,
					removed.sessionId,
					"sessionMessage",
					{ sessionMessage }
				)
			}
			return res
		} catch (error) {
			const err: AttachmentsError = {
				error: sentence(error, "Couldn't remove the attachment."),
				sessionId: sessionId ?? (error as { sessionId?: number })?.sessionId,
				messageId: params?.messageId,
				partId: params?.partId
			}
			emitToUser("attachments:removeFromMessage:error", err)
			// A refusal is an answer, not a fault: only a fault reaches the
			// wrapper's log.
			if (!(error instanceof TrayRefusal)) throw error
			return undefined as never
		}
	}
}

/**
 * The session's **attachment readers** (§3.2): what each model call of its
 * reply can read — the composer's readers line and the kinds it disables.
 * Answers the asking socket only. A call's pair (`connection`) reaches
 * administrators alone (`redactConnections`, the one projection).
 */
export const attachmentsReaders: Handler<
	AttachmentsReadersParams,
	AttachmentsReadersResponse
> = {
	event: "attachments:readers",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		try {
			await requireSession(params?.sessionId, userId)
			const readers = await attachmentReaders(db, {
				sessionId: params.sessionId,
				userId,
				...(typeof params.channel === "string"
					? { channel: params.channel }
					: {})
			})
			const res: AttachmentsReadersResponse = redactConnections(
				{ sessionId: params.sessionId, readers },
				socket.user
			)
			replyToAsker(socket, "attachments:readers", res)
			return res
		} catch (error) {
			const err: AttachmentsError = {
				error: sentence(error, "Couldn't read what this reply can read."),
				sessionId: params?.sessionId
			}
			emitToUser("attachments:readers:error", err)
			if (!(error instanceof TrayRefusal)) throw error
			return undefined as never
		}
	}
}

export function registerAttachmentHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, attachmentsBegin, emitToUser)
	register(socket, attachmentsChunk, emitToUser)
	register(socket, attachmentsFinish, emitToUser)
	register(socket, attachmentsRemove, emitToUser)
	register(socket, attachmentsList, emitToUser)
	register(socket, attachmentsRemoveFromMessage, emitToUser)
	register(socket, attachmentsReaders, emitToUser)
}
