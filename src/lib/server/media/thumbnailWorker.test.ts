// The thumbnail worker: same bytes out as the in-thread path, restarts after a
// death, falls back once with a named reason, keeps the pixel ceiling on the
// main thread.
import { readFileSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { afterEach, describe, expect, test, vi } from "vitest"
import { PNG } from "pngjs"
import { encodeRaster } from "./convert/codecs"
import { makeThumbnail } from "./thumbnail"
import {
	ThumbnailWorkerStopped,
	__setThumbnailWorkerForTests,
	__thumbnailWorkerStartsForTests
} from "./thumbnailWorker"

const T = 60_000
const IN_THREAD = { source: 'throw new Error("in-thread for this test")' }

afterEach(() => {
	vi.restoreAllMocks()
	__setThumbnailWorkerForTests()
})

function gradient(w: number, h: number): Uint8ClampedArray {
	const data = new Uint8ClampedArray(w * h * 4)
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4
			data[i] = (x * 255) / w
			data[i + 1] = (y * 255) / h
			data[i + 2] = (x * 7 + y * 13) % 256
			data[i + 3] = 255
		}
	return data
}

function pngOf(w: number, h: number): Buffer {
	const p = new PNG({ width: w, height: h })
	p.data = Buffer.from(gradient(w, h))
	return PNG.sync.write(p)
}

function claimingPng(w: number, h: number, idat: Buffer): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4)
		len.writeUInt32BE(data.length)
		return Buffer.concat([
			len,
			Buffer.from(type, "latin1"),
			data,
			Buffer.alloc(4)
		])
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8
	ihdr[9] = 6
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", idat),
		chunk("IEND", Buffer.alloc(0))
	])
}

async function inThread(...a: Parameters<typeof makeThumbnail>) {
	__setThumbnailWorkerForTests(IN_THREAD)
	vi.spyOn(console, "warn").mockImplementation(() => {})
	const out = await makeThumbnail(...a)
	__setThumbnailWorkerForTests()
	return out
}

async function viaWorker(...a: Parameters<typeof makeThumbnail>) {
	__setThumbnailWorkerForTests()
	return makeThumbnail(...a)
}

async function expectSame(...a: Parameters<typeof makeThumbnail>) {
	const expected = await inThread(...a)
	vi.restoreAllMocks()
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
	const before = __thumbnailWorkerStartsForTests()
	const got = await viaWorker(...a)
	expect(__thumbnailWorkerStartsForTests()).toBeGreaterThan(before)
	expect(warn).not.toHaveBeenCalled()
	if (expected === null) {
		expect(got).toBeNull()
		return
	}
	expect(got).not.toBeNull()
	expect(got!.width).toBe(expected.width)
	expect(got!.height).toBe(expected.height)
	expect(Buffer.compare(got!.bytes, expected.bytes)).toBe(0)
}

const raster = (w: number, h: number) => ({
	data: gradient(w, h),
	width: w,
	height: h
})

describe("thumbnail worker: byte identity", () => {
	test(
		"mascot, portrait: crop + resize",
		async () => {
			await expectSame(readFileSync("static/mascot.png"), "image/png")
		},
		T
	)
	test(
		"mascot with an off-centre frame",
		async () => {
			await expectSame(readFileSync("static/mascot.png"), "image/png", {
				x: 3,
				y: 5,
				w: 200,
				h: 150
			} as never)
		},
		T
	)
	test(
		"2,000 x 2,000 PNG: resize, no crop",
		async () => {
			await expectSame(pngOf(2000, 2000), "image/png")
		},
		T
	)
	test(
		"32 x 32 PNG: encode only",
		async () => {
			await expectSame(pngOf(32, 32), "image/png")
		},
		T
	)
	test(
		"600 x 600 WebP, JPEG and GIF",
		async () => {
			const r = raster(600, 600)
			await expectSame(
				await encodeRaster(r, "image/webp", { quality: 80 }),
				"image/webp"
			)
			await expectSame(
				await encodeRaster(r, "image/jpeg", { quality: 80 }),
				"image/jpeg"
			)
			await expectSame(await encodeRaster(r, "image/gif"), "image/gif")
		},
		T
	)
	test(
		"64 x 64 WebP is null on both paths",
		async () => {
			const webp = await encodeRaster(raster(64, 64), "image/webp", {
				quality: 80
			})
			await expectSame(webp, "image/webp")
		},
		T
	)
})

describe("thumbnail worker: failure modes", () => {
	test(
		"ceiling is refused on the main thread, no worker started",
		async () => {
			__setThumbnailWorkerForTests()
			const before = __thumbnailWorkerStartsForTests()
			await expect(
				makeThumbnail(
					claimingPng(
						8193,
						8193,
						deflateSync(Buffer.alloc(8193 * 4 + 1))
					),
					"image/png"
				)
			).rejects.toThrow(
				/larger than the 8,192 × 8,192 Serene Pub will open/
			)
			expect(__thumbnailWorkerStartsForTests()).toBe(before)
		},
		T
	)

	test(
		"a death mid-job fails only that job, and the next job restarts it",
		async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
			const png = pngOf(32, 32)
			__setThumbnailWorkerForTests({
				source: `const { parentPort } = require("node:worker_threads")
parentPort.on("message", () => process.exit(7))
parentPort.postMessage({ kind: "ready" })`
			})
			const err = await makeThumbnail(png, "image/png").catch((e) => e)
			expect(err).toBeInstanceOf(ThumbnailWorkerStopped)
			expect(err.message).toContain("exit 7")
			expect(warn).not.toHaveBeenCalled()
			const starts = __thumbnailWorkerStartsForTests()
			await expect(
				makeThumbnail(png, "image/png")
			).rejects.toBeInstanceOf(ThumbnailWorkerStopped)
			expect(__thumbnailWorkerStartsForTests()).toBeGreaterThan(starts)
			warn.mockRestore()
			const expected = await inThread(png, "image/png")
			const got = await viaWorker(png, "image/png")
			expect(Buffer.compare(got!.bytes, expected!.bytes)).toBe(0)
		},
		T
	)

	test(
		"a start failure falls back in-thread and warns once with the reason",
		async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
			__setThumbnailWorkerForTests(IN_THREAD)
			const png = pngOf(700, 500)
			const a = await makeThumbnail(png, "image/png")
			const b = await makeThumbnail(png, "image/png")
			expect(a).not.toBeNull()
			expect(Buffer.compare(a!.bytes, b!.bytes)).toBe(0)
			expect(warn).toHaveBeenCalledTimes(1)
			const text = String(warn.mock.calls[0][0])
			expect(text).toContain("in-thread for this test")
			expect(text).toContain("main thread")
		},
		T
	)

	test(
		"corrupt bytes fail with the in-thread sentence and the worker stays up",
		async () => {
			const corrupt = claimingPng(
				64,
				64,
				Buffer.from("not a deflate stream")
			)
			__setThumbnailWorkerForTests(IN_THREAD)
			vi.spyOn(console, "warn").mockImplementation(() => {})
			const expected = await makeThumbnail(corrupt, "image/png").catch(
				(e) => e
			)
			expect(expected).toBeInstanceOf(Error)
			vi.restoreAllMocks()

			__setThumbnailWorkerForTests()
			const err = await makeThumbnail(corrupt, "image/png").catch(
				(e) => e
			)
			expect(err).toBeInstanceOf(Error)
			expect(err).not.toBeInstanceOf(ThumbnailWorkerStopped)
			expect(err.message).toBe(expected.message)
			const starts = __thumbnailWorkerStartsForTests()
			expect(starts).toBeGreaterThan(0)
			const ok = await makeThumbnail(pngOf(700, 500), "image/png")
			expect(ok).not.toBeNull()
			expect(__thumbnailWorkerStartsForTests()).toBe(starts)
		},
		T
	)
})
