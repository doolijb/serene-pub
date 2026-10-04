/**
 * `attachments:*` — the composer **tray**'s upload family
 * (PLAN-composer-attachments §3.1, phase 1 lane B; owner D4 2026-10-02).
 *
 * A **tray item** is a file uploaded into a session's composer and not yet
 * sent; a person's tray items for one session are their **tray**. ⚠ Not a
 * held import (`imports/heldImports.ts`), not the downloads tray, not the
 * layout editor's widget tray.
 *
 * Transport is chunked binary Socket.IO: `begin` carries the file's first
 * bytes so the server can sniff and refuse before accepting more, then
 * `chunk`s of `chunkBytes` (1 MiB) arrive in order, each acknowledged, then
 * `finish` stores the file. One Buffer per event — socket.io's parser drops
 * the transport on messages with many binary attachments (see
 * `Sockets.Import.SillyTavern.StageFiles`).
 *
 * **Who hears what.** `begin` and `chunk` replies — and every refusal — go to
 * the socket that asked, and no other tab. `finish`, `remove` and `list`
 * replies go to every tab of the person, so a tray reappears in a second tab
 * the way a draft does. Every reply carries `sessionId` top-level (scoped
 * events must carry their scope key), and every refusal carries the
 * `trayItemId` it is about when there is one.
 *
 * Kept here, not in the `Sockets` namespace — the placement `jump.ts` and
 * `imageGen.ts` use.
 */
import type { AttachmentKind } from "$lib/shared/attachments/caps"
import type { ConnectionIdentity } from "$lib/shared/connections/identity"

export type TrayItemStatus = "uploading" | "ready" | "refused"

/** One tray item as a client sees it. Never carries a path. */
export interface TrayItemView {
	id: string
	sessionId: number
	status: TrayItemStatus
	/** The sentence a refused item shows. */
	refusal: string | null
	/** Display only. */
	filename: string | null
	bytes: number
	position: number
	/** Null until the file is stored. */
	attachmentKind: AttachmentKind | null
	mime: string | null
	file: {
		id: number
		uuid: string
		width: number | null
		height: number | null
		/** The display form. */
		url: string
		/** The 480 px square thumbnail, derived on first request. */
		thumbUrl: string
	} | null
	createdAt: string
}

export interface AttachmentsBeginParams {
	sessionId: number
	filename: string
	/** The whole file's size, declared. Checked again as chunks arrive. */
	bytes: number
	/** The file's first `min(bytes, headBytes)` bytes. */
	head: Uint8Array
}
export interface AttachmentsBeginResponse {
	sessionId: number
	trayItemId: string
	/** Every chunk but the last must be exactly this long. */
	chunkBytes: number
	/** Echo of the request's filename, so a tab can match its own begin. */
	filename: string
}

export interface AttachmentsChunkParams {
	trayItemId: string
	/** 0-based; chunks arrive strictly in order. */
	index: number
	data: Uint8Array
}
export interface AttachmentsChunkResponse {
	sessionId: number
	trayItemId: string
	index: number
	/** Bytes received so far — progress. */
	received: number
	bytes: number
}

export interface AttachmentsFinishParams {
	trayItemId: string
}
export interface AttachmentsFinishResponse {
	sessionId: number
	/** `ready`, or `refused` with its sentence — a refused item stays in the
	 *  tray so the person sees why, until they remove it. */
	trayItem: TrayItemView
}

export interface AttachmentsRemoveParams {
	trayItemId: string
}
export interface AttachmentsRemoveResponse {
	sessionId: number
	trayItemId: string
}

export interface AttachmentsListParams {
	sessionId: number
}
export interface AttachmentsListResponse {
	sessionId: number
	tray: TrayItemView[]
}

/**
 * `attachments:removeFromMessage` — take one attachment off a SENT message
 * (D9: remove only). Whoever may edit the message may; the file stays (the
 * no-cascade ruling). The reply reaches every tab of the person; the changed
 * row reaches the session as a `sessionMessage` push.
 */
export interface AttachmentsRemoveFromMessageParams {
	messageId: number
	/** The `message_parts` row id of the `core:image` / `core:file` part. */
	partId: number
}
export interface AttachmentsRemoveFromMessageResponse {
	sessionId: number
	messageId: number
	partId: number
}

/** Every `attachments:*:error`. */
export interface AttachmentsError {
	error: string
	sessionId?: number
	trayItemId?: string
	/** `removeFromMessage` refusals: the message and part asked about. */
	messageId?: number
	partId?: number
}

/* --- the reading rule (§3.2) --------------------------------------- */

/** Whether a kind may be attached at all (union over reading calls, D1). */
export interface AttachmentVerdict {
	allowed: boolean
	/** The sentence when refused — never a connection name (visibility). */
	reason?: string
}

/**
 * One **reading call** — a model call that is handed the transcript's
 * attachments: the reply's, the form answer's, or an action's (2026-10-03).
 */
export interface AttachmentReadingCall {
	/** The reply's call: its node key. Any other spec's: `<spec slug>#<node key>`. */
	key: string
	/**
	 * The reply's call: what the settings panel heads its group with
	 * (`groupHeadingOf`). Any other spec's: its action's name ("Look"), or
	 * "Form answers" — with the heading after a colon when that spec has more
	 * than one reading call.
	 */
	label: string
	/** The kinds this call reads. Text is always among them. */
	reads: AttachmentKind[]
	/** The kinds this call is handed as a placeholder (`[image: cat.png]`, D3). */
	placeholderFor: AttachmentKind[]
	/** Why it cannot read each kind it cannot — safe sentences, no names. */
	reasons: Partial<Record<AttachmentKind, string>>
	/** 🔒 Admin only: the pair it runs on. `redactConnections` removes it. */
	connection?: ConnectionIdentity
}

/** **Attachment readers** — what this session's reply can read (`attachmentReaders`). */
export interface AttachmentReaders {
	kinds: Record<AttachmentKind, AttachmentVerdict>
	calls: AttachmentReadingCall[]
	/** What the file picker offers, per kind: mimes and extensions. Empty for a refused kind. */
	accepts: Record<AttachmentKind, string[]>
	/** The instance caps (D6) — the client's pre-check reads the same numbers. */
	limits: {
		filesPerMessage: number
		bytesPerKind: Record<AttachmentKind, number>
	}
}

/**
 * `attachments:readers` — the session's attachment readers, for the
 * composer's readers line. The reply reaches the asking socket only; a
 * non-admin's carries no `connection` on any call.
 */
export interface AttachmentsReadersParams {
	sessionId: number
	channel?: string
}
export interface AttachmentsReadersResponse {
	sessionId: number
	readers: AttachmentReaders
}
