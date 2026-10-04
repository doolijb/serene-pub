/**
 * An image's pixel size read from its header alone — no decode, no
 * allocation (lorebooks plan S4).
 *
 * Decoding allocates `width × height × 4` bytes for whatever the header
 * claims, and the header is the uploader's to write: a 126-byte PNG claiming
 * 12,000 × 12,000 took `decodeImage` to 1.2 GB of memory in two seconds. So the
 * size is read here first and `decodeImage` refuses past `MAX_DECODE_PIXELS`
 * before a decoder sees the file.
 *
 * Covers the four formats this build decodes (PNG/APNG, JPEG, GIF, WebP). Each
 * walks the WHOLE container and answers with the largest size any of its
 * headers claims — every PNG IHDR, a GIF's screen and every frame descriptor,
 * every JPEG frame header (SOFn), a WebP's canvas and every frame header. The
 * first match is not enough: the uploader writes every header, and each
 * decoder here sizes its bitmap from one that need not be the first (S4
 * review — a second IHDR, a GIF frame larger than its screen, a fake SOF in
 * front of the real one all got past a first-match reader).
 */

export interface ImageSize {
	width: number
	height: number
}

/**
 * The most pixels any decode may produce: 8,192 × 8,192, about 67 megapixels
 * and 256 MiB of RGBA — above a 48–50 MP phone photo (8,160 × 6,120).
 */
export const MAX_DECODE_EDGE = 8192
export const MAX_DECODE_PIXELS = MAX_DECODE_EDGE * MAX_DECODE_EDGE

export type ImageFormat = "png" | "jpeg" | "gif" | "webp"

/** Which of the four decodable formats the bytes open as, by magic number. */
export function imageFormatOf(b: Uint8Array): ImageFormat | null {
	if (
		b.length >= 8 &&
		b[0] === 0x89 &&
		b[1] === 0x50 &&
		b[2] === 0x4e &&
		b[3] === 0x47 &&
		b[4] === 0x0d &&
		b[5] === 0x0a &&
		b[6] === 0x1a &&
		b[7] === 0x0a
	)
		return "png"
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
		return "jpeg"
	if (
		b.length >= 6 &&
		b[0] === 0x47 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x38 &&
		(b[4] === 0x37 || b[4] === 0x39) &&
		b[5] === 0x61
	)
		return "gif"
	if (
		b.length >= 12 &&
		ascii(b, 0, 4) === "RIFF" &&
		ascii(b, 8, 4) === "WEBP"
	)
		return "webp"
	return null
}

function ascii(b: Uint8Array, at: number, n: number): string {
	let s = ""
	for (let i = 0; i < n && at + i < b.length; i++)
		s += String.fromCharCode(b[at + i])
	return s
}

const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1]
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8)
const u24le = (b: Uint8Array, at: number) =>
	b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
const u32be = (b: Uint8Array, at: number) =>
	((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
const u32le = (b: Uint8Array, at: number) =>
	(b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0

/**
 * The largest of every size a file's headers claim — width and height taken
 * separately, so the result bounds any one bitmap a decoder could size from
 * any one of them. Null when none was found.
 */
class LargestSize {
	private width = -1
	private height = 0
	add(width: number, height: number): void {
		this.width = Math.max(this.width, width)
		this.height = Math.max(this.height, height)
	}
	get size(): ImageSize | null {
		return this.width < 0
			? null
			: { width: this.width, height: this.height }
	}
}

/**
 * Every IHDR up to IEND. PNG allows exactly one, first — but pngjs keeps the
 * LAST it meets and allocates for that, so a 1 × 1 IHDR followed by a
 * 12,000 × 12,000 one read as 1 × 1 to a first-chunk reader and decoded to
 * 1.4 GB (S4 review).
 */
function pngSize(b: Uint8Array): ImageSize | null {
	const found = new LargestSize()
	let at = 8
	while (at + 8 <= b.length) {
		const length = u32be(b, at)
		const type = ascii(b, at + 4, 4)
		if (type === "IHDR") {
			if (at + 16 > b.length) return null
			found.add(u32be(b, at + 8), u32be(b, at + 12))
		} else if (type === "IEND") break
		at += 12 + length
	}
	return found.size
}

/**
 * The logical screen AND every frame's image descriptor. omggif sizes a
 * frame's index buffer and its blit loop from the frame's own descriptor and
 * never checks it against the screen: a 35-byte GIF with a 1 × 1 screen and a
 * 65,535 × 65,535 frame blocked the event loop for three minutes (S4 review).
 * The walk is omggif's own (`GifReader`), block for block; a block it would
 * throw on ends the walk, since the decoder then refuses the file itself.
 */
function gifSize(b: Uint8Array): ImageSize | null {
	if (b.length < 13) return null
	const found = new LargestSize()
	found.add(u16le(b, 6), u16le(b, 8))
	let at = 13
	if (b[10] & 0x80) at += 3 * (1 << ((b[10] & 0x7) + 1))
	/** Past a run of sub-blocks; -1 when it runs off the end. */
	const skipSubBlocks = (from: number): number => {
		let p = from
		while (p < b.length) {
			const size = b[p++]
			if (size === 0) return p
			p += size
		}
		return -1
	}
	while (at < b.length) {
		const block = b[at++]
		if (block === 0x3b) break
		if (block === 0x21) {
			// An extension: its label, then sub-blocks (the graphics control
			// and application extensions are sub-blocks too, as written).
			at = skipSubBlocks(at + 1)
			if (at < 0) break
		} else if (block === 0x2c) {
			if (at + 9 > b.length) return null
			found.add(u16le(b, at + 4), u16le(b, at + 6))
			const packed = b[at + 8]
			at += 9
			if (packed & 0x80) at += 3 * (1 << ((packed & 0x7) + 1))
			at = skipSubBlocks(at + 1) // past the LZW code size, then the data
			if (at < 0) break
		} else break
	}
	return found.size
}

/** Start-of-frame markers: SOF0–3, 5–7, 9–11, 13–15 (not DHT, JPG or DAC). */
const isSof = (m: number) =>
	m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc

/**
 * Every frame header (SOFn) up to end of image — including any after a scan.
 * jpeg-js takes a new frame, and allocates for it, at EVERY SOF it meets, so a
 * fake 1 × 1 SOF in front of a real 8,400 × 8,400 one passed a first-match
 * reader (S4 review). Entropy-coded data is skipped to the next marker as a
 * decoder does: a 0xFF there is always followed by a stuffed 0x00 or RSTn.
 */
function jpegSize(b: Uint8Array): ImageSize | null {
	const found = new LargestSize()
	let at = 2
	while (at + 1 < b.length) {
		// A marker is 0xFF then a code; any number of 0xFF fill bytes may
		// precede the code, and bytes between segments — a scan's entropy-
		// coded data, or stray bytes — are skipped to the next 0xFF.
		if (b[at] !== 0xff) {
			const next = b.indexOf(0xff, at)
			if (next < 0) break
			at = next
			continue
		}
		let code = b[at + 1]
		while (code === 0xff && at + 2 < b.length) {
			at++
			code = b[at + 1]
		}
		at += 2
		// Markers with no length: TEM, RST0–7, SOI; and a stuffed 0x00.
		if (code === 0x01 || (code >= 0xd0 && code <= 0xd8) || code === 0x00)
			continue
		if (code === 0xd9) break
		if (at + 2 > b.length) break
		const length = u16be(b, at)
		if (isSof(code)) {
			if (at + 7 > b.length) return null
			found.add(u16be(b, at + 5), u16be(b, at + 3))
		}
		if (length < 2) return null
		at += length
	}
	return found.size
}

/**
 * The VP8X canvas, every top-level VP8 / VP8L frame header, and every ANMF
 * frame's own size. libwebp refuses a still image whose frame disagrees with
 * its canvas today; the ceiling does not lean on that.
 */
function webpSize(b: Uint8Array): ImageSize | null {
	const found = new LargestSize()
	let at = 12
	while (at + 8 <= b.length) {
		const type = ascii(b, at, 4)
		const size = u32le(b, at + 4)
		const data = at + 8
		if (type === "VP8X" || type === "ANMF") {
			// VP8X: flags(4) then canvas; ANMF: x(3), y(3) then the frame's.
			const off = type === "VP8X" ? 4 : 6
			if (data + off + 6 > b.length) return null
			found.add(u24le(b, data + off) + 1, u24le(b, data + off + 3) + 1)
		} else if (type === "VP8L") {
			if (data + 5 > b.length || b[data] !== 0x2f) return null
			const bits = u32le(b, data + 1)
			found.add((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
		} else if (type === "VP8 ") {
			// A key frame: 3-byte frame tag, the 9d 01 2a start code, then
			// 14-bit width and height (the top two bits are scaling).
			if (data + 10 > b.length) return null
			if (
				b[data + 3] !== 0x9d ||
				b[data + 4] !== 0x01 ||
				b[data + 5] !== 0x2a
			)
				return null
			found.add(u16le(b, data + 6) & 0x3fff, u16le(b, data + 8) & 0x3fff)
		}
		at = data + size + (size % 2)
	}
	return found.size
}

/**
 * The largest size the image's headers declare, or null when these bytes are
 * none of the four formats or no header can be read.
 */
export function readImageSize(b: Uint8Array): ImageSize | null {
	switch (imageFormatOf(b)) {
		case "png":
			return pngSize(b)
		case "jpeg":
			return jpegSize(b)
		case "gif":
			return gifSize(b)
		case "webp":
			return webpSize(b)
		default:
			return null
	}
}

/**
 * Throws a sentence when these bytes would decode to more than
 * `MAX_DECODE_PIXELS`, or are one of the four formats but their size cannot be
 * read (no decoder can size a bitmap from a header this cannot find). Bytes of
 * any other format pass through untouched: their decoder refuses them.
 */
export function assertDecodableSize(b: Uint8Array): void {
	const format = imageFormatOf(b)
	if (!format) return
	const size = readImageSize(b)
	if (!size) {
		throw new Error(
			"Serene Pub couldn't read this image's size, so it didn't open it."
		)
	}
	if (size.width * size.height > MAX_DECODE_PIXELS) {
		const n = (v: number) => v.toLocaleString("en")
		throw new Error(
			`This image is ${n(size.width)} × ${n(size.height)} pixels, larger than the ${n(MAX_DECODE_EDGE)} × ${n(MAX_DECODE_EDGE)} Serene Pub will open.`
		)
	}
}
