/**
 * **Attachment caps** — what a person may put in a session composer's tray
 * (PLAN-composer-attachments §3.1, §6.2; owner D5/D6, 2026-10-02).
 *
 * Shared so the composer can refuse a file before it uploads a byte and the
 * server can refuse the same file with the same sentence. The server is the
 * authority: every cap here is checked again at `attachments:begin` (the
 * declared size), against the chunks as they arrive (the actual size) and at
 * `attachments:finish` (the sniffed type).
 *
 * The **attachment kind** decides the cap. It is decided from the sniffed mime
 * (`sniffMedia`, magic bytes), never from the extension or the browser's mime:
 *
 * - `image` — PNG, JPEG, WebP, GIF. For calls that can read images.
 * - `text` — `.txt` / `.md`, which carry no magic bytes and are accepted on a
 *   content sniff (UTF-8, no control bytes). Inlined for every model.
 * - `pdf` — stored and forwarded only, never parsed by the app.
 *
 * EPUB, DOCX, ODT and RTF are storable media but **no model reads them** in
 * v1, so they are not offered (D5). SVG stays refused by `sniffMedia`.
 */

const MiB = 1024 * 1024

export const ATTACHMENT_KINDS = ["image", "text", "pdf"] as const

/** What kind of attachment a file is — R3: never a bare "kind". */
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const ATTACHMENT_CAPS = {
	/** Files in one tray, which is one message's attachments (D6). */
	filesPerMessage: 10,
	/** Bytes per file, by attachment kind (D6). */
	bytesPerKind: {
		image: 20 * MiB,
		text: 1 * MiB,
		pdf: 32 * MiB
	} satisfies Record<AttachmentKind, number>,
	/** The media store's own ceiling (`MAX_MEDIA_UPLOAD_BYTES`); no kind's cap
	 *  may exceed it. */
	absoluteBytes: 50 * MiB,
	/** One tray's bytes together. Not an owner default: the plan names
	 *  "per-tray bytes" without a number, so this is ten of the largest
	 *  ordinary file (a 10 MiB photo) — overrule freely. */
	trayBytes: 100 * MiB,
	/** One `attachments:chunk` (D4). Keeps every event far under Socket.IO's
	 *  transport ceiling. */
	chunkBytes: 1 * MiB,
	/** How much of the file `attachments:begin` carries so the server can
	 *  sniff and refuse before accepting more — `file-type`'s sample size. */
	headBytes: 4100
} as const

const IMAGE_MIMES = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
])
const TEXT_MIMES = new Set(["text/plain", "text/markdown"])

/** The attachment kind of a SNIFFED mime, or null when it is not offered. */
export function attachmentKindOf(mime: string): AttachmentKind | null {
	if (IMAGE_MIMES.has(mime)) return "image"
	if (TEXT_MIMES.has(mime)) return "text"
	if (mime === "application/pdf") return "pdf"
	return null
}

/** The byte cap for an attachment kind. */
export function attachmentCapBytes(kind: AttachmentKind): number {
	return Math.min(
		ATTACHMENT_CAPS.bytesPerKind[kind],
		ATTACHMENT_CAPS.absoluteBytes
	)
}

/** "20 MB" — the unit people read, for a refusal sentence. */
export function formatCap(bytes: number): string {
	return `${Math.round(bytes / MiB)} MB`
}

const KIND_NOUN: Record<AttachmentKind, string> = {
	image: "An image",
	text: "A text file",
	pdf: "A PDF"
}

/** The refusal for a file over its kind's cap, or null when it fits. */
export function attachmentSizeRefusal(
	kind: AttachmentKind,
	bytes: number
): string | null {
	const cap = attachmentCapBytes(kind)
	if (bytes <= cap) return null
	return `${KIND_NOUN[kind]} can be at most ${formatCap(cap)}.`
}

/** The refusal for a file whose type is not offered. */
export const ATTACHMENT_TYPE_REFUSAL =
	"That file type can't be attached. Attach an image (PNG, JPEG, WebP, GIF), a text file (.txt, .md) or a PDF."

/** The refusal when the tray is full. */
export const ATTACHMENT_COUNT_REFUSAL = `A message can carry at most ${ATTACHMENT_CAPS.filesPerMessage} files.`
