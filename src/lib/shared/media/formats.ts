/**
 * The file-format vocabulary, per media kind.
 *
 * **Two different questions, deliberately kept as two different fields.**
 * `animated` is a fact about the FORMAT — the container either can carry a time
 * dimension or it cannot, and that is true of GIF whether or not anything here
 * can write one. `decode` and `encode` are facts about THIS BUILD — whether the
 * bundled codec stack can read or write those bytes today.
 *
 * That split is the whole point of the table. A file picker offering "what this
 * provider accepts" wants the format facts: a backend that takes animated WebP
 * takes it regardless of what we can produce. The conversion router wants the
 * build facts: it must refuse what it cannot actually make rather than hand
 * back something lesser that looks right. One merged "supported" flag would
 * force those two readers to disagree, and the way that failure shows up is a
 * silently flattened animation, not an error.
 *
 * **This module is browser-safe and must stay that way.** It is the half of the
 * media vocabulary a picker renders from, so it imports no `node:` builtin, no
 * `$lib/server` module and no codec — see `formats.test.ts`, which enforces
 * exactly that by scanning this file's own imports. The codecs live behind
 * `$lib/server/media/convert`, and the router there reads this table rather
 * than keeping a second list of its own.
 *
 * **Kinds come from the SDK** (`MEDIA_KINDS`), not from the app's own
 * `MediaKind`. The app's enum carries an extra `other` for a stored blob it
 * cannot classify, and `other` has no formats by definition — a format table
 * keyed on it would have an empty bucket that reads as a gap.
 */
import { MEDIA_KINDS, type MediaKind } from "@serene-pub/sdk"

/**
 * One format the vocabulary knows about.
 *
 * Declared for everything a backend might reasonably accept, not just for what
 * this build can handle — a format missing from here reads as "not a thing",
 * which is a worse lie than "a thing we cannot convert".
 */
export interface MediaFormat {
	/** The canonical mime. Aliases (`image/jpg`) normalise onto it. */
	mime: string
	kind: MediaKind
	/** Lower case, no leading dot. The FIRST is the one a derived file is named
	 *  with, and it is what `extensionForMime` returns. */
	extensions: readonly string[]
	/**
	 * Whether the format can carry a TIME DIMENSION — more than one frame, or a
	 * duration. A conversion into a format that cannot, from a source that
	 * does, is the downgrade the router refuses.
	 *
	 * True for audio and video by nature; true for GIF, WebP, APNG and AVIF,
	 * whose containers all allow frames; false for JPEG, PNG and a page
	 * document.
	 */
	animated: boolean
	/** Whether THIS BUILD can turn these bytes into its kind's working
	 *  representation (pixels, for an image). */
	decode: boolean
	/** Whether THIS BUILD can write these bytes. */
	encode: boolean
	/** Why a `false` above is false, or a caveat on a `true`. Carried so a
	 *  refusal can say something a user can act on instead of "unsupported". */
	note?: string
}

/**
 * The refusal that has to keep its exact wording.
 *
 * `sniff.ts` fails a HEIC upload at the door with this advice, by ruling:
 * libheif-js is 6.4MB unpacked against roughly 2.0MB for the entire rest of the
 * codec stack, and this project has zero native dependencies on purpose. The
 * table says the same thing in the same words so a refusal downstream of the
 * upload does not contradict the one at the door.
 */
const HEIC_NOTE =
	"HEIC/HEIF can't be read by this server. Export or convert the photo to JPEG or PNG first — on iOS, Settings › Camera › Formats › Most Compatible saves as JPEG."

/** Audio and video transcoding needs ffmpeg, which is out of scope by ruling:
 *  declare the format, refuse a mismatch honestly, convert nothing. */
const NEEDS_FFMPEG =
	"Audio and video transcoding needs ffmpeg, which this build does not carry. The format is declared so a mismatch can be refused honestly; nothing converts it."

/** Extracting or writing a paginated document needs a document engine, not a
 *  codec, and none is bundled. */
const NEEDS_DOC_ENGINE =
	"Reading or writing this needs a document engine, which this build does not carry."

/**
 * Every declared format, in the order a tie between two formats sharing an
 * extension is broken (PNG before APNG, so `png` resolves to `image/png`).
 *
 * The four still-image formats with `decode` AND `encode` are exactly the ones
 * the conversion router can route between; `convert.test.ts` pins that
 * correspondence in both directions, so a `true` added here without a converter
 * — or a converter added without the `true` — fails rather than drifts.
 */
export const MEDIA_FORMATS: readonly MediaFormat[] = [
	// ── image ────────────────────────────────────────────────────────────────
	{
		mime: "image/png",
		kind: "image",
		extensions: ["png"],
		animated: false,
		decode: true,
		encode: true
	},
	{
		mime: "image/apng",
		kind: "image",
		extensions: ["apng", "png"],
		animated: true,
		decode: false,
		encode: false,
		note: "APNG shares PNG's magic bytes, and the bundled PNG codec sees only the first frame. Declared undecodable so an animation is refused rather than silently flattened."
	},
	{
		mime: "image/jpeg",
		kind: "image",
		extensions: ["jpg", "jpeg"],
		animated: false,
		decode: true,
		encode: true
	},
	{
		mime: "image/gif",
		kind: "image",
		extensions: ["gif"],
		animated: true,
		decode: true,
		encode: true,
		note: "Decode and encode are both SINGLE-FRAME. An animated GIF keeps GIF as its display form — a browser renders one natively — and the router refuses to flatten it."
	},
	{
		mime: "image/webp",
		kind: "image",
		extensions: ["webp"],
		animated: true,
		decode: true,
		encode: true,
		note: "`@jsquash/webp` exports a single-frame encode, so animated WebP can be neither written nor recognised here."
	},
	{
		mime: "image/avif",
		kind: "image",
		extensions: ["avif"],
		animated: true,
		decode: false,
		encode: false,
		note: "Needs an AV1 decoder; nothing in this build carries one."
	},
	{
		mime: "image/heic",
		kind: "image",
		extensions: ["heic"],
		animated: true,
		decode: false,
		encode: false,
		note: HEIC_NOTE
	},
	{
		mime: "image/heif",
		kind: "image",
		extensions: ["heif"],
		animated: true,
		decode: false,
		encode: false,
		note: HEIC_NOTE
	},
	{
		mime: "image/bmp",
		kind: "image",
		extensions: ["bmp"],
		animated: false,
		decode: false,
		encode: false,
		note: "`@jimp/js-bmp` is not installed. Adding it is a pure-JS dependency, unlike the refused ones."
	},
	{
		mime: "image/tiff",
		kind: "image",
		extensions: ["tif", "tiff"],
		animated: true,
		decode: false,
		encode: false,
		note: "Multi-page container; no bundled codec reads it."
	},
	{
		mime: "image/svg+xml",
		kind: "image",
		extensions: ["svg"],
		animated: true,
		decode: false,
		encode: false,
		note: "A vector document. Rasterising one needs a renderer rather than a codec, and rendering untrusted SVG is its own hazard."
	},

	// ── audio ────────────────────────────────────────────────────────────────
	{
		mime: "audio/mpeg",
		kind: "audio",
		extensions: ["mp3"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "audio/wav",
		kind: "audio",
		extensions: ["wav"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "audio/ogg",
		kind: "audio",
		extensions: ["ogg", "oga"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "audio/flac",
		kind: "audio",
		extensions: ["flac"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "audio/mp4",
		kind: "audio",
		extensions: ["m4a"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "audio/aac",
		kind: "audio",
		extensions: ["aac"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "audio/webm",
		kind: "audio",
		extensions: ["weba"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},

	// ── video ────────────────────────────────────────────────────────────────
	{
		mime: "video/mp4",
		kind: "video",
		extensions: ["mp4", "m4v"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "video/webm",
		kind: "video",
		extensions: ["webm"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "video/quicktime",
		kind: "video",
		extensions: ["mov"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "video/x-matroska",
		kind: "video",
		extensions: ["mkv"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "video/mpeg",
		kind: "video",
		extensions: ["mpeg", "mpg"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "video/ogg",
		kind: "video",
		extensions: ["ogv"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},
	{
		mime: "video/x-msvideo",
		kind: "video",
		extensions: ["avi"],
		animated: true,
		decode: false,
		encode: false,
		note: NEEDS_FFMPEG
	},

	// ── document ─────────────────────────────────────────────────────────────
	{
		mime: "application/pdf",
		kind: "document",
		extensions: ["pdf"],
		animated: false,
		decode: false,
		encode: false,
		note: NEEDS_DOC_ENGINE
	},
	{
		mime: "application/epub+zip",
		kind: "document",
		extensions: ["epub"],
		animated: false,
		decode: false,
		encode: false,
		note: NEEDS_DOC_ENGINE
	},
	{
		mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		kind: "document",
		extensions: ["docx"],
		animated: false,
		decode: false,
		encode: false,
		note: NEEDS_DOC_ENGINE
	},
	{
		mime: "application/vnd.oasis.opendocument.text",
		kind: "document",
		extensions: ["odt"],
		animated: false,
		decode: false,
		encode: false,
		note: NEEDS_DOC_ENGINE
	},
	{
		mime: "application/rtf",
		kind: "document",
		extensions: ["rtf"],
		animated: false,
		decode: false,
		encode: false,
		note: NEEDS_DOC_ENGINE
	},
	{
		mime: "text/plain",
		kind: "document",
		extensions: ["txt", "text"],
		animated: false,
		decode: true,
		encode: true,
		note: "UTF-8 needs no codec, which is why these two flags are true. It does NOT mean a text conversion is available: relabelling text/plain as text/markdown changes no bytes, so no converter is registered for it."
	},
	{
		mime: "text/markdown",
		kind: "document",
		extensions: ["md", "markdown"],
		animated: false,
		decode: true,
		encode: true,
		note: "As text/plain: readable and writable as UTF-8, with no converter registered."
	},
	{
		mime: "text/csv",
		kind: "document",
		extensions: ["csv"],
		animated: false,
		decode: true,
		encode: true,
		note: "As text/plain: readable and writable as UTF-8, with no converter registered."
	},
	{
		mime: "text/html",
		kind: "document",
		extensions: ["html", "htm"],
		animated: false,
		decode: true,
		encode: true,
		note: "As text/plain: readable and writable as UTF-8, with no converter registered."
	}
]

/**
 * Mimes that are wrong but common, mapped onto the canonical one.
 *
 * Small and closed on purpose. This is for spellings that arrive from a browser
 * or a backend and mean an existing format — never a place to alias one format
 * onto a different one, which would make a conversion look like a passthrough.
 */
const MIME_ALIASES: Readonly<Record<string, string>> = {
	"image/jpg": "image/jpeg",
	"image/pjpeg": "image/jpeg",
	"image/x-png": "image/png",
	"audio/x-wav": "audio/wav",
	"audio/wave": "audio/wav",
	"audio/x-flac": "audio/flac",
	"audio/mp3": "audio/mpeg",
	"application/x-pdf": "application/pdf",
	"text/x-markdown": "text/markdown"
}

/**
 * Lower-case, parameters stripped, aliases resolved.
 *
 * `Content-Type` legitimately carries parameters (`text/plain; charset=utf-8`)
 * and case is not significant, so a raw string is compared against the table
 * only after passing through here. Every lookup below does it, so a caller does
 * not have to remember.
 */
export function normalizeMime(raw: string | null | undefined): string {
	if (!raw) return ""
	const bare = raw.split(";")[0]!.trim().toLowerCase()
	return MIME_ALIASES[bare] ?? bare
}

const BY_MIME: ReadonlyMap<string, MediaFormat> = new Map(
	MEDIA_FORMATS.map((f) => [f.mime, f])
)

/** The declared format for a mime, or undefined when the vocabulary does not
 *  know it at all — which is a different answer from "we cannot convert it". */
export function formatByMime(
	raw: string | null | undefined
): MediaFormat | undefined {
	return BY_MIME.get(normalizeMime(raw))
}

/** Every declared format of one kind, in table order. */
export function formatsForKind(kind: MediaKind): readonly MediaFormat[] {
	return MEDIA_FORMATS.filter((f) => f.kind === kind)
}

/** The extension a file of this format is named with. Undefined for a mime the
 *  vocabulary does not know, so a caller cannot invent one from a mime's
 *  subtype. */
export function extensionForMime(
	raw: string | null | undefined
): string | undefined {
	return formatByMime(raw)?.extensions[0]
}

/** Whether this build can read these bytes. False for an unknown mime. */
export function canDecodeMime(raw: string | null | undefined): boolean {
	return formatByMime(raw)?.decode ?? false
}

/** Whether this build can write these bytes. False for an unknown mime. */
export function canEncodeMime(raw: string | null | undefined): boolean {
	return formatByMime(raw)?.encode ?? false
}

/**
 * Whether the FORMAT can carry a time dimension.
 *
 * Not "does this file have one" — that needs the bytes, and it is `readMotion`
 * that reads them (GIF and WebP, each through its own container). This answers
 * the question a capability list asks: could a backend that named this mime be
 * sent an animation at all.
 */
export function formatIsAnimatable(raw: string | null | undefined): boolean {
	return formatByMime(raw)?.animated ?? false
}

/** The kinds the table is keyed on, re-exported so a consumer enumerating the
 *  table does not need a second import to iterate it. */
export { MEDIA_KINDS }
export type { MediaKind }
