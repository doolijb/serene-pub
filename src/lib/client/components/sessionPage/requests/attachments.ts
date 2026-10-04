/**
 * 🚧 The composer's attachments (core only; composer attachments §3.3, D9):
 *
 * - `attach-files` `{ files }` — upload files into the session's tray.
 *   Resolves once they are queued; each tile's progress, readiness or
 *   refusal reaches the composer through the dossier (`composer.tray`).
 * - `remove-tray-item` `{ trayItemId }` — take one out of the tray.
 * - `remove-attachment` `{ messageId, partId }` — take one attachment off a
 *   sent message (remove only); the server judges who may.
 *
 * Core's own widgets only (the askers table): a plugin's widget never
 * uploads as the viewer.
 */

/** What these answers need of the page's tray (`composerTray.svelte.ts`). */
export interface AttachmentRequestDeps {
	attach(files: File[]): void
	remove(trayItemId: string): void
	removeFromMessage(messageId: number, partId: number): void
}

const isFile = (f: unknown): f is File =>
	typeof File !== "undefined" ? f instanceof File : !!f && typeof (f as File).slice === "function"

/** Answer one `attach-files`. */
export function answerAttachFiles(params: unknown, deps: AttachmentRequestDeps): void {
	const files = (params as { files?: unknown })?.files
	if (!Array.isArray(files) || !files.length) throw new Error("no files to attach")
	const real = files.filter(isFile)
	if (real.length !== files.length) throw new Error("only files can be attached")
	deps.attach(real)
}

/** Answer one `remove-tray-item`. */
export function answerRemoveTrayItem(params: unknown, deps: AttachmentRequestDeps): void {
	const id = (params as { trayItemId?: unknown })?.trayItemId
	if (typeof id !== "string" || !id) throw new Error("no attachment named")
	deps.remove(id)
}

/** Answer one `remove-attachment`. */
export function answerRemoveAttachment(params: unknown, deps: AttachmentRequestDeps): void {
	const p = (params ?? {}) as { messageId?: unknown; partId?: unknown }
	if (!Number.isSafeInteger(p.messageId) || !Number.isSafeInteger(p.partId))
		throw new Error("no attachment named")
	deps.removeFromMessage(p.messageId as number, p.partId as number)
}
