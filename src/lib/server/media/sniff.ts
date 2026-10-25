/**
 * The single choke point every upload passes through (28 §4).
 *
 * Generalises the old `sniffImageExtension`: same `file-type` call, same
 * refusal to trust a client-supplied mime or extension, now answering for
 * documents too and returning the coarse `kind` the row stores.
 */
import { fileTypeFromBuffer } from "file-type"
import { MediaKind, type MediaKindType } from "$lib/shared/constants/MediaVisibility"

/**
 * One cap for every kind (28 §4, ruled), replacing the old 10MB image-only
 * ceiling. It sits under Socket.IO's `maxHttpBufferSize` (1e8, see
 * loadSockets.server.ts) with headroom — uploads travel over sockets, not HTTP
 * multipart, so that is the real ceiling above this one.
 *
 * Raising images from 10MB to 50MB is only safe *because* thumbnails exist: a
 * 40MB source PNG no longer reaches a list view. The two changes are coupled;
 * do not lift this without them.
 */
export const MAX_MEDIA_UPLOAD_BYTES = 50 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"])

/**
 * Document types are matched on extension where `file-type` can see one, and
 * fall back to a text sniff — `.txt`/`.md` have no magic bytes at all, so a
 * content-type answer is the only one available for them.
 */
const DOCUMENT_EXTENSIONS = new Set(["pdf", "epub", "docx", "odt", "rtf"])

const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	pdf: "application/pdf",
	epub: "application/epub+zip",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	odt: "application/vnd.oasis.opendocument.text",
	rtf: "application/rtf",
	txt: "text/plain",
	md: "text/markdown"
}

/**
 * 🚧 Sounds and moving pictures (O4, 2026-10-21): `file-type`'s extension →
 * the format table's canonical mime (`shared/media/formats.ts`), so a stored
 * file's mime is one the adapters' `accepts` lists can name.
 */
const AUDIO_MIME_BY_EXT: Record<string, string> = {
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	opus: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/mp4",
	m4b: "audio/mp4",
	aac: "audio/aac"
}
const VIDEO_MIME_BY_EXT: Record<string, string> = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mkv: "video/x-matroska",
	mpg: "video/mpeg",
	ogv: "video/ogg",
	avi: "video/x-msvideo"
}

export interface SniffResult {
	ext: string
	mime: string
	kind: MediaKindType
}

/** True when the buffer decodes as UTF-8 with no control bytes that would only
 *  appear in a binary — the test for a `.txt`/`.md` upload, which carries no
 *  magic number to detect. */
function looksLikeText(buffer: Uint8Array): boolean {
	const sample = buffer.subarray(0, 8192)
	for (const byte of sample) {
		// Allow tab, LF, CR; reject other C0 controls and NUL.
		if (byte === 9 || byte === 10 || byte === 13) continue
		if (byte < 32 || byte === 127) return false
	}
	try {
		// `stream` when the sample is a prefix: a multi-byte character cut
		// in half by the sample's end is not evidence of a binary. A whole
		// file must decode completely.
		new TextDecoder("utf-8", { fatal: true }).decode(sample, {
			stream: sample.length < buffer.length
		})
	} catch {
		return false
	}
	return true
}

export async function sniffMedia(
	buffer: Buffer | Uint8Array,
	opts?: { filename?: string; allowDocuments?: boolean; allowMedia?: boolean }
): Promise<SniffResult> {
	if (buffer.length > MAX_MEDIA_UPLOAD_BYTES) {
		throw new Error(
			`Upload is too large (max ${MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024)}MB).`
		)
	}

	const detected = await fileTypeFromBuffer(buffer)
	let ext = detected?.ext?.toLowerCase()
	if (ext === "jpeg") ext = "jpg"

	if (ext && IMAGE_EXTENSIONS.has(ext)) {
		return {
			ext,
			mime: MIME_BY_EXT[ext] ?? detected!.mime,
			kind: MediaKind.IMAGE
		}
	}

	// 🚧 O4: a sound or a moving picture, where the caller takes them (the
	// composer's tray, a model's spoken reply). WebM and Ogg carry either:
	// the claimed name decides between a sound and a picture — a label, never
	// a path, so trusting it here is harmless.
	if (opts?.allowMedia && ext) {
		const claimed = opts.filename?.split(".").pop()?.toLowerCase()
		if (ext === "webm" && (claimed === "weba" || detected?.mime?.startsWith("audio/")))
			return { ext: "weba", mime: "audio/webm", kind: MediaKind.AUDIO }
		if (ext === "ogg" && claimed === "ogv")
			return { ext: "ogv", mime: "video/ogg", kind: MediaKind.VIDEO }
		if (AUDIO_MIME_BY_EXT[ext])
			return { ext, mime: AUDIO_MIME_BY_EXT[ext], kind: MediaKind.AUDIO }
		if (VIDEO_MIME_BY_EXT[ext])
			return { ext, mime: VIDEO_MIME_BY_EXT[ext], kind: MediaKind.VIDEO }
	}

	if (opts?.allowDocuments) {
		if (ext && DOCUMENT_EXTENSIONS.has(ext)) {
			return {
				ext,
				mime: MIME_BY_EXT[ext] ?? detected!.mime,
				kind: MediaKind.DOCUMENT
			}
		}
		// No magic bytes. Plain text is the only thing we accept on a content
		// sniff, and the claimed extension picks between txt and md — it
		// decides a label, never a path, so trusting it here is harmless.
		if (!ext && looksLikeText(buffer)) {
			const claimed = opts.filename?.split(".").pop()?.toLowerCase()
			const textExt = claimed === "md" || claimed === "markdown" ? "md" : "txt"
			return {
				ext: textExt,
				mime: MIME_BY_EXT[textExt],
				kind: MediaKind.DOCUMENT
			}
		}
	}

	// Named before the generic refusal, because "not a recognized image type"
	// is useless advice for a photo straight off an iPhone. HEIC is a HARD FAIL
	// by ruling: decoding it needs libheif-js (6.4MB unpacked, more than three
	// times the entire existing codec stack) and this project has zero native
	// dependencies on purpose. A userAgent-conditional client-side conversion is
	// the parked plan; nothing goes in the bundle for it now.
	if (ext === "heic" || ext === "heif") {
		throw new Error(
			"HEIC/HEIF images (the iPhone default) can't be read by this server. Export or convert the photo to JPEG or PNG first — on iOS, Settings › Camera › Formats › Most Compatible saves as JPEG."
		)
	}

	throw new Error(
		opts?.allowDocuments
			? opts?.allowMedia
				? "Unrecognized file type (png/jpg/webp/gif, pdf/epub/docx/odt/rtf/txt/md, mp3/wav/ogg/flac/m4a, mp4/webm/mov)"
				: "Unrecognized file type (png/jpg/webp/gif, pdf/epub/docx/odt/rtf/txt/md)"
			: "Uploaded file is not a recognized image type (png/jpg/webp/gif)"
	)
}
