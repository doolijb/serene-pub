/**
 * A pixel-size ceiling BEFORE any decode (lorebooks plan S4). The header is the
 * uploader's to write, and a decoder allocates whatever it claims: a 126-byte
 * PNG claiming 12,000 × 12,000 took `decodeImage` to 1.2 GB in two seconds.
 * The hostile fixtures here claim only just over the ceiling, so even a
 * regression costs the runner ~540 MB rather than its life.
 */
import { readFileSync } from "node:fs"
import { crc32, deflateSync } from "node:zlib"
import { describe, expect, test } from "vitest"
import { decodeImage, encodeRaster } from "./codecs"
import { makeThumbnail } from "../thumbnail"
import {
	MAX_DECODE_PIXELS,
	assertDecodableSize,
	readImageSize
} from "./imageSize"

function pngChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const body = Buffer.concat([Buffer.from(type, "latin1"), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body) >>> 0)
	return Buffer.concat([len, body, crc])
}

/** A tiny PNG whose IHDR claims `w × h` RGBA, with one row of real data. */
function claimingPng(w: number, h: number): Buffer {
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(Buffer.alloc(w * 4 + 1))),
		pngChunk("IEND", Buffer.alloc(0))
	])
}

/** A GIF header claiming a `w × h` logical screen, and nothing else. */
function claimingGif(w: number, h: number): Buffer {
	const b = Buffer.alloc(13)
	b.write("GIF89a", 0, "latin1")
	b.writeUInt16LE(w, 6)
	b.writeUInt16LE(h, 8)
	return Buffer.concat([b, Buffer.from([0x3b])])
}

/**
 * A GIF with a `sw × sh` screen and a first frame of `fw × fh`, plus any
 * `more` frames — each frame a single tiny LZW block (the decode need not
 * succeed; the size check has to come first).
 */
function gifWithFrame(
	sw: number,
	sh: number,
	fw: number,
	fh: number,
	more: [number, number][] = []
): Buffer {
	const frame = (w: number, h: number) => [
		0x2c,
		0,
		0,
		0,
		0,
		w & 255,
		w >> 8,
		h & 255,
		h >> 8,
		0,
		2,
		2,
		0x4c,
		0x01,
		0
	]
	return Buffer.from([
		...Buffer.from("GIF89a", "latin1"),
		sw & 255,
		sw >> 8,
		sh & 255,
		sh >> 8,
		0x80,
		0,
		0,
		0,
		0,
		0,
		255,
		255,
		255,
		...frame(fw, fh),
		...more.flatMap(([w, h]) => frame(w, h)),
		0x3b
	])
}

/** A PNG with an honest 1 × 1 IHDR, then a second IHDR claiming `w × h`. */
function pngWithSecondIhdr(w: number, h: number): Buffer {
	const ihdr = (width: number, height: number) => {
		const d = Buffer.alloc(13)
		d.writeUInt32BE(width, 0)
		d.writeUInt32BE(height, 4)
		d[8] = 8
		d[9] = 0
		return pngChunk("IHDR", d)
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		ihdr(1, 1),
		ihdr(w, h),
		pngChunk("IDAT", deflateSync(Buffer.alloc(w + 1))),
		pngChunk("IEND", Buffer.alloc(0))
	])
}

/**
 * `jpeg` with one more SOF0 claiming `w × h`: either a fake 1 × 1 SOF before
 * the real one and the real one rewritten to `w × h` ("before"), or a second
 * SOF after the first scan's entropy-coded data ("after-scan").
 */
function jpegWithExtraSof(
	jpeg: Buffer,
	w: number,
	h: number,
	where: "before" | "after-scan"
): Buffer {
	let at = 2
	let sof = -1
	while (at < jpeg.length) {
		if (jpeg[at + 1] === 0xc0) {
			sof = at
			break
		}
		at += 2 + jpeg.readUInt16BE(at + 2)
	}
	const len = 2 + jpeg.readUInt16BE(sof + 2)
	const sized = (width: number, height: number) => {
		const s = Buffer.from(jpeg.subarray(sof, sof + len))
		s.writeUInt16BE(height, 5)
		s.writeUInt16BE(width, 7)
		return s
	}
	if (where === "before") {
		return Buffer.concat([
			jpeg.subarray(0, sof),
			sized(1, 1),
			sized(w, h),
			jpeg.subarray(sof + len)
		])
	}
	const eoi = jpeg.length - 2 // FF D9
	return Buffer.concat([
		jpeg.subarray(0, eoi),
		sized(w, h),
		jpeg.subarray(eoi)
	])
}

/** A WebP whose VP8X canvas is `cw × ch` and whose VP8L frame is `fw × fh`. */
function webpCanvasAndFrame(
	cw: number,
	ch: number,
	fw: number,
	fh: number
): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const head = Buffer.alloc(8)
		head.write(type, 0, "latin1")
		head.writeUInt32LE(data.length, 4)
		return Buffer.concat([head, data, Buffer.alloc(data.length % 2)])
	}
	const vp8x = Buffer.alloc(10)
	vp8x.writeUIntLE(cw - 1, 4, 3)
	vp8x.writeUIntLE(ch - 1, 7, 3)
	const vp8l = Buffer.alloc(16)
	vp8l[0] = 0x2f
	vp8l.writeUInt32LE(
		(((fw - 1) & 0x3fff) | (((fh - 1) & 0x3fff) << 14)) >>> 0,
		1
	)
	const body = Buffer.concat([
		Buffer.from("WEBP", "latin1"),
		chunk("VP8X", vp8x),
		chunk("VP8L", vp8l)
	])
	const head = Buffer.alloc(8)
	head.write("RIFF", 0, "latin1")
	head.writeUInt32LE(body.length, 4)
	return Buffer.concat([head, body])
}

/** Just over the ceiling: 8,193 × 8,193. */
const OVER = 8193

const outcomeOf = (work: Promise<unknown>) =>
	work.then(
		() => "decoded",
		(e) => String(e?.message ?? e)
	)

const raster = (width: number, height: number) => ({
	data: new Uint8ClampedArray(width * height * 4).fill(200),
	width,
	height
})

describe("S4 — the header's size, read without decoding", () => {
	test("PNG, JPEG, GIF and WebP (lossless and lossy) as their encoders wrote them", async () => {
		const src = raster(37, 21)
		for (const mime of [
			"image/png",
			"image/jpeg",
			"image/gif",
			"image/webp"
		]) {
			const bytes = await encodeRaster(src, mime, { quality: 80 })
			expect(readImageSize(bytes), mime).toEqual({
				width: 37,
				height: 21
			})
		}
		const lossless = await encodeRaster(src, "image/webp", {
			lossless: true
		})
		expect(readImageSize(lossless)).toEqual({ width: 37, height: 21 })
	}, 60_000)

	test("the app's own 1024 × 1536 mascot", () => {
		expect(readImageSize(readFileSync("static/mascot.png"))).toEqual({
			width: 1024,
			height: 1536
		})
	})

	test("a JPEG whose frame header sits behind Exif and fill bytes", async () => {
		const jpeg = await encodeRaster(raster(9, 5), "image/jpeg", {
			quality: 80
		})
		const exif = Buffer.concat([
			Buffer.from([0xff, 0xe1, 0x00, 0x10]),
			Buffer.from("Exif\0\0", "latin1"),
			Buffer.alloc(8)
		])
		const padded = Buffer.concat([
			jpeg.subarray(0, 2),
			exif,
			Buffer.from([0xff, 0xff]), // fill bytes before the next marker
			jpeg.subarray(2)
		])
		expect(readImageSize(padded)).toEqual({ width: 9, height: 5 })
	})

	test("anything else is null, and passes the check untouched", () => {
		const bmp = Buffer.from("BM" + "\0".repeat(40), "latin1")
		expect(readImageSize(bmp)).toBeNull()
		expect(() => assertDecodableSize(bmp)).not.toThrow()
	})

	test("a recognised format whose size can't be read is refused", () => {
		const headless = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
		expect(() => assertDecodableSize(headless)).toThrow(
			"Serene Pub couldn't read this image's size, so it didn't open it."
		)
	})
})

describe("S4 — decodeImage refuses past the ceiling before any decoder runs", () => {
	test("a PNG claiming 8,193 × 8,193 is refused, in a sentence, without allocating", async () => {
		const png = claimingPng(OVER, OVER)
		expect(png.length).toBeLessThan(200)
		const before = process.memoryUsage().arrayBuffers
		const started = performance.now()
		expect(await outcomeOf(decodeImage(png, "image/png"))).toBe(
			"This image is 8,193 × 8,193 pixels, larger than the 8,192 × 8,192 Serene Pub will open."
		)
		expect(performance.now() - started).toBeLessThan(250)
		expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(
			16 * 1024 * 1024
		)
	})

	test("a GIF claiming a 65,535 × 65,535 screen is refused", async () => {
		expect(
			await outcomeOf(decodeImage(claimingGif(65535, 65535), "image/gif"))
		).toMatch(/^This image is 65,535 × 65,535 pixels/)
	})

	// The header a decoder sizes its bitmap from is not always the first one
	// (S4 review). Each fixture below puts a small, honest-looking header where
	// a first-match reader stops, and the real size where the decoder looks.

	test("a GIF whose first frame is larger than its 1 × 1 screen is refused", async () => {
		// omggif sizes the frame's index buffer and its blit loop from the
		// frame's own descriptor, never checked against the screen: at
		// 30,000² this ran for five seconds on the event loop.
		const gif = gifWithFrame(1, 1, OVER, OVER)
		expect(gif.length).toBeLessThan(64)
		expect(readImageSize(gif)).toEqual({ width: OVER, height: OVER })
		const started = performance.now()
		expect(await outcomeOf(decodeImage(gif, "image/gif"))).toMatch(
			/^This image is 8,193 × 8,193 pixels/
		)
		expect(performance.now() - started).toBeLessThan(250)
	})

	test("a later GIF frame counts as much as the first", () => {
		const gif = gifWithFrame(1, 1, 1, 1, [[OVER, 2]])
		expect(readImageSize(gif)).toEqual({ width: OVER, height: 2 })
	})

	test("a PNG with a second, larger IHDR is refused", async () => {
		// pngjs keeps the LAST IHDR it meets and allocates for it; a PNG card
		// is its own avatar, so a card file reached this directly.
		const png = pngWithSecondIhdr(OVER, OVER)
		expect(png.length).toBeLessThan(200)
		expect(readImageSize(png)).toEqual({ width: OVER, height: OVER })
		const before = process.memoryUsage().arrayBuffers
		expect(await outcomeOf(decodeImage(png, "image/png"))).toMatch(
			/^This image is 8,193 × 8,193 pixels/
		)
		expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(
			16 * 1024 * 1024
		)
	})

	test("a JPEG with a fake 1 × 1 frame header before the real one is refused", async () => {
		// jpeg-js overwrites its frame at every SOF and decodes the last.
		const jpeg = await encodeRaster(raster(9, 5), "image/jpeg", {
			quality: 80
		})
		const hostile = jpegWithExtraSof(jpeg, OVER, OVER, "before")
		expect(readImageSize(hostile)).toEqual({ width: OVER, height: OVER })
		expect(() => assertDecodableSize(hostile)).toThrow(
			/^This image is 8,193 × 8,193 pixels/
		)
	})

	test("a JPEG frame header after the first scan counts too", async () => {
		const jpeg = await encodeRaster(raster(9, 5), "image/jpeg", {
			quality: 80
		})
		const hostile = jpegWithExtraSof(jpeg, OVER, OVER, "after-scan")
		expect(readImageSize(hostile)).toEqual({ width: OVER, height: OVER })
	})

	test("a WebP whose frame is larger than its 1 × 1 canvas reads as the frame", () => {
		// libwebp refuses this mismatch itself today; the ceiling does not
		// lean on that.
		expect(readImageSize(webpCanvasAndFrame(1, 1, OVER, OVER))).toEqual({
			width: OVER,
			height: OVER
		})
	})

	test("the thumbnail path meets the same ceiling", async () => {
		expect(
			await outcomeOf(makeThumbnail(claimingPng(OVER, OVER), "image/png"))
		).toMatch(/larger than the 8,192 × 8,192 Serene Pub will open/)
	})

	test("an image at the ceiling's edge still decodes", async () => {
		expect(MAX_DECODE_PIXELS).toBe(8192 * 8192)
		const png = await encodeRaster(raster(64, 48), "image/png", {})
		const out = await decodeImage(png, "image/png")
		expect([out.width, out.height]).toEqual([64, 48])
	})
})
