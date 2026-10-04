/**
 * **Photo metadata strip for attachments** (PLAN-composer-attachments §6.4,
 * owner D7 2026-10-02).
 *
 * An attachment's bytes go to third-party model APIs and to session guests,
 * and a phone photo's EXIF carries where it was taken. So before an attached
 * image reaches `createMedia`, its EXIF / XMP / IPTC / text metadata is
 * removed **losslessly** — whole container segments dropped, pixels untouched:
 *
 * - JPEG: APP1 (EXIF, XMP), APP13 (IPTC / Photoshop) and COM segments. APP2
 *   (the ICC colour profile) is kept — it is colour, not provenance.
 * - PNG: `eXIf`, `tEXt`, `iTXt`, `zTXt` chunks.
 * - WebP: `EXIF` and `XMP ` chunks, and the VP8X flags that announce them.
 * - GIF: unchanged (no EXIF container; comment extensions are not read).
 *
 * **Orientation first.** A JPEG whose EXIF Orientation is not 1 is decoded
 * (jimp applies the orientation while decoding) and re-encoded upright,
 * because dropping the tag alone would turn every portrait phone photo on its
 * side. That one case re-encodes; every other file keeps its pixels byte for
 * byte.
 *
 * **A clean file is returned as the SAME bytes** — `changed: false` — so its
 * hash, and therefore per-user dedupe, is exactly what it would have been.
 *
 * Attachments only. Avatars and other uploads are untouched by ruling.
 */
import { decodeImage, encodeRaster } from "./convert/codecs"

export interface StrippedImage {
	bytes: Buffer
	/** False when nothing was removed: `bytes` is the input, untouched. */
	changed: boolean
	/** True when a JPEG was re-encoded to apply its EXIF orientation. */
	reoriented: boolean
}

/** Quality for the one re-encode (an orientation fix). High, because the
 *  source was already lossy once. */
const REORIENT_JPEG_QUALITY = 92

const UNREADABLE = "This image couldn't be read. Try saving it again as a PNG or JPEG."

export async function stripAttachmentMetadata(
	input: Buffer | Uint8Array,
	mime: string
): Promise<StrippedImage> {
	const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)
	if (mime === "image/jpeg") return stripJpeg(buf)
	if (mime === "image/png") {
		const out = stripPng(buf)
		return { bytes: out ?? buf, changed: !!out, reoriented: false }
	}
	if (mime === "image/webp") {
		const out = stripWebp(buf)
		return { bytes: out ?? buf, changed: !!out, reoriented: false }
	}
	return { bytes: buf, changed: false, reoriented: false }
}

/* --- JPEG ------------------------------------------------------------- */

const JPEG_DROP = new Set([0xe1, 0xed, 0xfe])

async function stripJpeg(buf: Buffer): Promise<StrippedImage> {
	const orientation = jpegOrientation(buf)
	if (orientation !== null && orientation >= 2 && orientation <= 8) {
		// jimp's decoder rotates/flips by the EXIF tag; the encoder writes a
		// bare JFIF with no EXIF at all. The segment pass still runs over the
		// result so the guarantee does not rest on an encoder's habits.
		const raster = await decodeImage(buf, "image/jpeg")
		const upright = await encodeRaster(raster, "image/jpeg", {
			quality: REORIENT_JPEG_QUALITY
		})
		return {
			bytes: stripJpegSegments(upright) ?? upright,
			changed: true,
			reoriented: true
		}
	}
	const out = stripJpegSegments(buf)
	return { bytes: out ?? buf, changed: !!out, reoriented: false }
}

/**
 * Walk the marker segments up to the start of scan and drop the metadata
 * ones. Null when there was nothing to drop. Throws on a truncated header —
 * a file this walk cannot follow is one whose metadata it cannot vouch for.
 */
function stripJpegSegments(buf: Buffer): Buffer | null {
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8)
		throw new Error(UNREADABLE)
	const keep: Buffer[] = [buf.subarray(0, 2)]
	let dropped = false
	let i = 2
	while (i < buf.length) {
		if (buf[i] !== 0xff) throw new Error(UNREADABLE)
		// Fill bytes: any number of 0xFF may precede a marker.
		let m = i + 1
		while (m < buf.length && buf[m] === 0xff) m++
		if (m >= buf.length) throw new Error(UNREADABLE)
		const marker = buf[m]
		// Start of scan or end of image: everything after is entropy-coded
		// data (and any trailer), copied verbatim.
		if (marker === 0xda || marker === 0xd9) {
			keep.push(buf.subarray(i))
			break
		}
		// Standalone markers carry no length.
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			keep.push(buf.subarray(i, m + 1))
			i = m + 1
			continue
		}
		if (m + 2 >= buf.length) throw new Error(UNREADABLE)
		const len = buf.readUInt16BE(m + 1)
		const end = m + 1 + len
		if (len < 2 || end > buf.length) throw new Error(UNREADABLE)
		if (JPEG_DROP.has(marker)) dropped = true
		else keep.push(buf.subarray(i, end))
		i = end
	}
	return dropped ? Buffer.concat(keep) : null
}

/** The EXIF Orientation tag (1–8) of a JPEG, or null when it states none. */
export function jpegOrientation(buf: Buffer): number | null {
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
	let i = 2
	while (i + 4 <= buf.length) {
		if (buf[i] !== 0xff) return null
		const marker = buf[i + 1]
		if (marker === 0xda || marker === 0xd9) return null
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			i += 2
			continue
		}
		const len = buf.readUInt16BE(i + 2)
		const start = i + 4
		const end = i + 2 + len
		if (len < 2 || end > buf.length) return null
		if (
			marker === 0xe1 &&
			end - start >= 14 &&
			buf.toString("latin1", start, start + 6) === "Exif\0\0"
		) {
			return tiffOrientation(buf.subarray(start + 6, end))
		}
		i = end
	}
	return null
}

function tiffOrientation(tiff: Buffer): number | null {
	if (tiff.length < 8) return null
	const order = tiff.toString("latin1", 0, 2)
	const le = order === "II"
	if (!le && order !== "MM") return null
	const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o))
	const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))
	const ifd = u32(4)
	if (ifd + 2 > tiff.length) return null
	const count = u16(ifd)
	for (let n = 0; n < count; n++) {
		const entry = ifd + 2 + n * 12
		if (entry + 12 > tiff.length) return null
		if (u16(entry) === 0x0112) {
			const value = u16(entry + 8)
			return value >= 1 && value <= 8 ? value : null
		}
	}
	return null
}

/* --- PNG -------------------------------------------------------------- */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt"])

/** Dropping a whole chunk needs no CRC work: each chunk carries its own. */
function stripPng(buf: Buffer): Buffer | null {
	if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE))
		throw new Error(UNREADABLE)
	const keep: Buffer[] = [buf.subarray(0, 8)]
	let dropped = false
	let i = 8
	while (i < buf.length) {
		if (i + 12 > buf.length) throw new Error(UNREADABLE)
		const len = buf.readUInt32BE(i)
		const type = buf.toString("latin1", i + 4, i + 8)
		const end = i + 12 + len
		if (end > buf.length) throw new Error(UNREADABLE)
		if (PNG_DROP.has(type)) dropped = true
		else keep.push(buf.subarray(i, end))
		i = end
		if (type === "IEND") {
			// Anything after IEND is not PNG; keep it as found.
			if (i < buf.length) keep.push(buf.subarray(i))
			break
		}
	}
	return dropped ? Buffer.concat(keep) : null
}

/* --- WebP ------------------------------------------------------------- */

const WEBP_DROP = new Set(["EXIF", "XMP "])
/** VP8X flag bits that announce the chunks above. */
const VP8X_EXIF = 0x08
const VP8X_XMP = 0x04

function stripWebp(buf: Buffer): Buffer | null {
	if (
		buf.length < 12 ||
		buf.toString("latin1", 0, 4) !== "RIFF" ||
		buf.toString("latin1", 8, 12) !== "WEBP"
	)
		throw new Error(UNREADABLE)
	const riffEnd = Math.min(buf.length, 8 + buf.readUInt32LE(4))
	const keep: Buffer[] = []
	let dropped = false
	let vp8x: Buffer | null = null
	let i = 12
	while (i + 8 <= riffEnd) {
		const fourcc = buf.toString("latin1", i, i + 4)
		const size = buf.readUInt32LE(i + 4)
		const end = i + 8 + size + (size & 1)
		if (i + 8 + size > riffEnd) throw new Error(UNREADABLE)
		const chunk = buf.subarray(i, Math.min(end, riffEnd))
		if (WEBP_DROP.has(fourcc)) dropped = true
		else if (fourcc === "VP8X") {
			vp8x = Buffer.from(chunk)
			keep.push(vp8x)
		} else keep.push(chunk)
		i = end
	}
	if (vp8x && vp8x.length > 8 && vp8x[8] & (VP8X_EXIF | VP8X_XMP)) {
		vp8x[8] &= ~(VP8X_EXIF | VP8X_XMP)
		dropped = true
	}
	if (!dropped) return null
	const body = Buffer.concat(keep)
	const header = Buffer.alloc(12)
	header.write("RIFF", 0, "latin1")
	header.writeUInt32LE(4 + body.length, 4)
	header.write("WEBP", 8, "latin1")
	return Buffer.concat([header, body])
}
