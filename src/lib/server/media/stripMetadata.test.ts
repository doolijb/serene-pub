/**
 * The attachment metadata strip (PLAN-composer-attachments §6.4, lane C).
 *
 * Fixtures are built here, byte by byte, so each test states exactly what
 * metadata the file carried: a JPEG with GPS and Orientation=6, a PNG with a
 * `tEXt` chunk, a WebP with an `EXIF` chunk, and a clean PNG that must come
 * back as the very same bytes (or dedupe would stop matching).
 */
import { describe, expect, test } from "vitest"
import zlib from "node:zlib"
import { PNG } from "pngjs"
import { decodeImage, encodeRaster } from "./convert/codecs"
import { jpegOrientation, stripAttachmentMetadata } from "./stripMetadata"

/** 16×8: left half red, right half blue. */
function redBlueRaster() {
	const width = 16
	const height = 8
	const data = new Uint8ClampedArray(width * height * 4)
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4
			const red = x < width / 2
			data[o] = red ? 255 : 0
			data[o + 1] = 0
			data[o + 2] = red ? 0 : 255
			data[o + 3] = 255
		}
	return { data, width, height }
}

/** A big-endian EXIF APP1 segment: IFD0 = Orientation + a GPS IFD pointer,
 *  GPS IFD = GPSLatitudeRef "N". */
function exifApp1(orientation: number): Buffer {
	const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 12 + 4)
	tiff.write("MM", 0, "latin1")
	tiff.writeUInt16BE(42, 2)
	tiff.writeUInt32BE(8, 4)
	let o = 8
	tiff.writeUInt16BE(2, o)
	o += 2
	// Orientation, SHORT, 1
	tiff.writeUInt16BE(0x0112, o)
	tiff.writeUInt16BE(3, o + 2)
	tiff.writeUInt32BE(1, o + 4)
	tiff.writeUInt16BE(orientation, o + 8)
	o += 12
	// GPSInfo IFD pointer, LONG, 1
	const gpsIfd = 8 + 2 + 2 * 12 + 4
	tiff.writeUInt16BE(0x8825, o)
	tiff.writeUInt16BE(4, o + 2)
	tiff.writeUInt32BE(1, o + 4)
	tiff.writeUInt32BE(gpsIfd, o + 8)
	o += 12
	tiff.writeUInt32BE(0, o) // no next IFD
	o += 4
	tiff.writeUInt16BE(1, o)
	o += 2
	// GPSLatitudeRef, ASCII, 2 ("N\0")
	tiff.writeUInt16BE(0x0001, o)
	tiff.writeUInt16BE(2, o + 2)
	tiff.writeUInt32BE(2, o + 4)
	tiff.write("N\0", o + 8, "latin1")
	o += 12
	tiff.writeUInt32BE(0, o)
	const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff])
	const head = Buffer.alloc(4)
	head[0] = 0xff
	head[1] = 0xe1
	head.writeUInt16BE(payload.length + 2, 2)
	return Buffer.concat([head, payload])
}

/** Insert a segment straight after SOI. */
function withSegment(jpeg: Buffer, segment: Buffer): Buffer {
	return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)])
}

function hasJpegMarker(buf: Buffer, marker: number): boolean {
	let i = 2
	while (i + 4 <= buf.length) {
		const m = buf[i + 1]
		if (m === 0xda || m === 0xd9) return false
		if (m === marker) return true
		i += 2 + buf.readUInt16BE(i + 2)
	}
	return false
}

function pngChunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const typeBuf = Buffer.from(type, "latin1")
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0)
	return Buffer.concat([len, typeBuf, data, crc])
}

function pngChunkTypes(buf: Buffer): string[] {
	const types: string[] = []
	let i = 8
	while (i + 8 <= buf.length) {
		const len = buf.readUInt32BE(i)
		types.push(buf.toString("latin1", i + 4, i + 8))
		i += 12 + len
	}
	return types
}

function cleanPng(): Buffer {
	const png = new PNG({ width: 2, height: 2 })
	png.data.fill(200)
	return PNG.sync.write(png)
}

function webpChunkTypes(buf: Buffer): string[] {
	const types: string[] = []
	let i = 12
	while (i + 8 <= buf.length) {
		const size = buf.readUInt32LE(i + 4)
		types.push(buf.toString("latin1", i, i + 4))
		i += 8 + size + (size & 1)
	}
	return types
}

describe("stripAttachmentMetadata — JPEG", () => {
	test("GPS + Orientation=6 comes out with no APP1 and upright pixels", async () => {
		const source = await encodeRaster(redBlueRaster(), "image/jpeg", {
			quality: 95
		})
		const withExif = withSegment(source, exifApp1(6))
		expect(jpegOrientation(withExif)).toBe(6)
		expect(withExif.includes(Buffer.from("N\0", "latin1"))).toBe(true)

		const out = await stripAttachmentMetadata(withExif, "image/jpeg")
		expect(out.changed).toBe(true)
		expect(out.reoriented).toBe(true)
		expect(hasJpegMarker(out.bytes, 0xe1)).toBe(false)
		expect(jpegOrientation(out.bytes)).toBeNull()

		// Orientation 6 is "rotate 90° clockwise to display": the 16×8 source
		// becomes 8×16, and its left (red) half becomes the TOP half.
		const upright = await decodeImage(out.bytes, "image/jpeg")
		expect(upright.width).toBe(8)
		expect(upright.height).toBe(16)
		const px = (x: number, y: number) => {
			const o = (y * upright.width + x) * 4
			return [upright.data[o], upright.data[o + 2]]
		}
		const [topR, topB] = px(4, 3)
		const [botR, botB] = px(4, 12)
		expect(topR).toBeGreaterThan(200)
		expect(topB).toBeLessThan(60)
		expect(botB).toBeGreaterThan(200)
		expect(botR).toBeLessThan(60)
	})

	test("Orientation=1 with EXIF drops the segment without re-encoding", async () => {
		const source = await encodeRaster(redBlueRaster(), "image/jpeg")
		const withExif = withSegment(source, exifApp1(1))
		const out = await stripAttachmentMetadata(withExif, "image/jpeg")
		expect(out.changed).toBe(true)
		expect(out.reoriented).toBe(false)
		// Lossless: exactly the source back, the segment cut out.
		expect(out.bytes.equals(source)).toBe(true)
	})

	test("a JPEG with no metadata is returned untouched", async () => {
		const source = await encodeRaster(redBlueRaster(), "image/jpeg")
		const out = await stripAttachmentMetadata(source, "image/jpeg")
		expect(out.changed).toBe(false)
		expect(out.bytes).toBe(source)
	})

	test("a truncated header is refused rather than passed on", async () => {
		const bad = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 0x01])
		await expect(stripAttachmentMetadata(bad, "image/jpeg")).rejects.toThrow(
			/couldn't be read/
		)
	})
})

describe("stripAttachmentMetadata — PNG", () => {
	test("a PNG with tEXt is stripped and still decodes", async () => {
		const clean = cleanPng()
		const iend = clean.length - 12
		const withText = Buffer.concat([
			clean.subarray(0, 33), // signature + IHDR
			pngChunk("tEXt", Buffer.from("Comment\0taken at home", "latin1")),
			pngChunk("eXIf", exifApp1(1).subarray(10)),
			clean.subarray(33, iend),
			clean.subarray(iend)
		])
		expect(pngChunkTypes(withText)).toContain("tEXt")

		const out = await stripAttachmentMetadata(withText, "image/png")
		expect(out.changed).toBe(true)
		const types = pngChunkTypes(out.bytes)
		expect(types).not.toContain("tEXt")
		expect(types).not.toContain("eXIf")
		expect(out.bytes.equals(clean)).toBe(true)
		const decoded = await decodeImage(out.bytes, "image/png")
		expect(decoded.width).toBe(2)
	})

	test("a byte-identical PNG with no metadata is untouched (hash and dedupe hold)", async () => {
		const clean = cleanPng()
		const out = await stripAttachmentMetadata(clean, "image/png")
		expect(out.changed).toBe(false)
		expect(out.bytes).toBe(clean)
	})
})

describe("stripAttachmentMetadata — WebP", () => {
	test("a WebP with an EXIF chunk is stripped and its VP8X flag cleared", async () => {
		const plain = await encodeRaster(redBlueRaster(), "image/webp", {
			lossless: true
		})
		// Rebuild as an extended file: VP8X (EXIF flag set) + the image chunk
		// + an EXIF chunk.
		const imageChunk = plain.subarray(12)
		const vp8x = Buffer.alloc(18)
		vp8x.write("VP8X", 0, "latin1")
		vp8x.writeUInt32LE(10, 4)
		vp8x[8] = 0x08
		vp8x.writeUIntLE(16 - 1, 12, 3)
		vp8x.writeUIntLE(8 - 1, 15, 3)
		const exifPayload = exifApp1(1).subarray(10) // the TIFF block
		const exifChunk = Buffer.alloc(8 + exifPayload.length + (exifPayload.length & 1))
		exifChunk.write("EXIF", 0, "latin1")
		exifChunk.writeUInt32LE(exifPayload.length, 4)
		exifPayload.copy(exifChunk, 8)
		const body = Buffer.concat([vp8x, imageChunk, exifChunk])
		const header = Buffer.alloc(12)
		header.write("RIFF", 0, "latin1")
		header.writeUInt32LE(4 + body.length, 4)
		header.write("WEBP", 8, "latin1")
		const withExif = Buffer.concat([header, body])
		expect(webpChunkTypes(withExif)).toContain("EXIF")

		const out = await stripAttachmentMetadata(withExif, "image/webp")
		expect(out.changed).toBe(true)
		expect(webpChunkTypes(out.bytes)).not.toContain("EXIF")
		expect(out.bytes[12 + 8] & 0x08).toBe(0)
		expect(out.bytes.readUInt32LE(4)).toBe(out.bytes.length - 8)
		const decoded = await decodeImage(out.bytes, "image/webp")
		expect(decoded.width).toBe(16)
		expect(decoded.height).toBe(8)
	})

	test("a plain WebP is untouched", async () => {
		const plain = await encodeRaster(redBlueRaster(), "image/webp")
		const out = await stripAttachmentMetadata(plain, "image/webp")
		expect(out.changed).toBe(false)
		expect(out.bytes).toBe(plain)
	})
})
