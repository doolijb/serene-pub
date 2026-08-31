/**
 * Thumbnails (28 §5): webp, longest edge 320px, aspect preserved.
 *
 * **Why this codec stack.** The project has zero native dependencies and
 * `android:full` runs `npm rebuild`, so `sharp` would make Android the first
 * platform that has to build libvips per-arch. Decode and resize are pure JS
 * (jimp's format readers and resize plugin); the webp encoder is WASM
 * (`@jsquash/webp`) — the same WASM-in-Node story PGlite already proves on
 * every supported platform.
 *
 * `@jsquash`'s emscripten glue loads its `.wasm` with `fetch()`, which Node's
 * undici refuses for `file://` URLs. So the module is compiled from disk here
 * and handed to `init()` explicitly, once.
 */
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { createJimp } from "@jimp/core"
import * as png from "@jimp/js-png"
import * as jpeg from "@jimp/js-jpeg"
import * as gif from "@jimp/js-gif"
import * as resize from "@jimp/plugin-resize"

/**
 * Longest edge.
 *
 * Was 320, sized off the 64px avatars in CharacterListItem and the persona
 * panel. Character *cards* render their image far larger than an avatar does,
 * and 320 was visibly soft there — so this is sized for the card, and the
 * avatars get the headroom for free.
 *
 * Raising this makes existing thumbnails stale rather than wrong; the backfill
 * pass regenerates any thumbnail smaller than this whose original still has
 * pixels to give (see backfill.ts).
 */
export const THUMB_MAX_EDGE = 480
export const THUMB_QUALITY = 82

const require = createRequire(import.meta.url)

const Jimp = createJimp({
	formats: [
		(png as any).default ?? png,
		(jpeg as any).default ?? jpeg,
		(gif as any).default ?? gif
	],
	plugins: [(resize as any).methods]
})

let encoderReady: Promise<typeof import("@jsquash/webp/encode.js")> | null = null
let decoderReady: Promise<typeof import("@jsquash/webp/decode.js")> | null = null

async function webpEncoder() {
	if (!encoderReady) {
		encoderReady = (async () => {
			const enc = await import("@jsquash/webp/encode.js")
			const { simd } = await import("wasm-feature-detect")
			// init() picks the SIMD build when the runtime has it, so the
			// module handed over has to be the matching one.
			const file = (await simd()) ? "webp_enc_simd.wasm" : "webp_enc.wasm"
			const wasmPath = require.resolve(`@jsquash/webp/codec/enc/${file}`)
			await enc.init(await WebAssembly.compile(await readFile(wasmPath)))
			return enc
		})()
	}
	return encoderReady
}

async function webpDecoder() {
	if (!decoderReady) {
		decoderReady = (async () => {
			const dec = await import("@jsquash/webp/decode.js")
			const wasmPath = require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")
			await dec.init(await WebAssembly.compile(await readFile(wasmPath)))
			return dec
		})()
	}
	return decoderReady
}

export interface RasterImage {
	data: Uint8ClampedArray
	width: number
	height: number
}

/** Decode to raw RGBA. webp goes through jsquash because jimp's webp reader is
 *  the same wasm with the same fetch problem; everything else is pure JS. */
export async function decodeImage(
	buffer: Buffer | Uint8Array,
	mime: string
): Promise<RasterImage> {
	if (mime === "image/webp") {
		const dec = await webpDecoder()
		const out = await dec.default(
			buffer.buffer.slice(
				buffer.byteOffset,
				buffer.byteOffset + buffer.byteLength
			) as ArrayBuffer
		)
		return {
			data: new Uint8ClampedArray(out.data),
			width: out.width,
			height: out.height
		}
	}
	const img = await Jimp.fromBuffer(Buffer.from(buffer))
	return {
		data: new Uint8ClampedArray(img.bitmap.data),
		width: img.bitmap.width,
		height: img.bitmap.height
	}
}

/** Dimensions only — cheap enough to run on every image upload so the row can
 *  carry width/height, which is what stops a thumbnail grid reflowing as the
 *  browser learns each size last. */
export async function readDimensions(
	buffer: Buffer | Uint8Array,
	mime: string
): Promise<{ width: number; height: number } | null> {
	try {
		const img = await decodeImage(buffer, mime)
		return { width: img.width, height: img.height }
	} catch {
		return null
	}
}

export interface ThumbnailResult {
	bytes: Buffer
	width: number
	height: number
	mime: "image/webp"
	ext: "webp"
}

/**
 * Aspect is preserved rather than square-cropped: every call site already
 * applies `object-cover`, so baking a crop in would discard information the CSS
 * is perfectly able to discard itself.
 *
 * Returns null when the source is already smaller than the target — a
 * thumbnail bigger than its original is pure waste, and the original serves.
 */
export async function makeThumbnail(
	buffer: Buffer | Uint8Array,
	mime: string
): Promise<ThumbnailResult | null> {
	const src = await decodeImage(buffer, mime)
	const longest = Math.max(src.width, src.height)
	if (longest <= THUMB_MAX_EDGE && mime === "image/webp") return null

	const scale = Math.min(1, THUMB_MAX_EDGE / longest)
	const width = Math.max(1, Math.round(src.width * scale))
	const height = Math.max(1, Math.round(src.height * scale))

	let raster = src
	if (scale < 1) {
		const img = await Jimp.fromBitmap({
			data: Buffer.from(src.data.buffer, src.data.byteOffset, src.data.byteLength),
			width: src.width,
			height: src.height
		} as any)
		img.resize({ w: width, h: height })
		raster = {
			data: new Uint8ClampedArray(img.bitmap.data),
			width: img.bitmap.width,
			height: img.bitmap.height
		}
	}

	const enc = await webpEncoder()
	// The encoder's ImageData type pins the buffer to a plain ArrayBuffer;
	// jimp hands back a view over a Node Buffer's pool, so copy rather than
	// cast — the copy is the thing that makes the type true.
	const out = await enc.default(
		{
			data: Uint8ClampedArray.from(raster.data),
			width: raster.width,
			height: raster.height,
			colorSpace: "srgb"
		} as ImageData,
		{ quality: THUMB_QUALITY }
	)
	return {
		bytes: Buffer.from(out),
		width: raster.width,
		height: raster.height,
		mime: "image/webp",
		ext: "webp"
	}
}
