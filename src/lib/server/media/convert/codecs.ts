/**
 * The codec stack, and the SINGLETONS every other module in `media/` shares.
 *
 * **Why this stack.** The project has zero native dependencies and
 * `android:full` runs `npm rebuild`, so `sharp` would make Android the first
 * platform that has to build libvips per-arch. Decode and resize are pure JS
 * (jimp's format readers and resize plugin); the webp encoder is WASM
 * (`@jsquash/webp`) — the same WASM-in-Node story PGlite already proves on
 * every supported platform.
 *
 * `@jsquash`'s emscripten glue loads its `.wasm` with `fetch()`, which Node's
 * undici refuses for `file://` URLs. So the module is compiled from disk here
 * and handed to `init()` explicitly, once.
 *
 * ⚠ **There is exactly one of each of these, and it lives here.** The jimp
 * instance carries its three format readers, and the webp encoder and decoder
 * each hold a compiled WASM module. A second copy of any of them would compile
 * the same `.wasm` again — on a platform where that compile is the slowest
 * thing an upload does. `thumbnail.ts` and the conversion router are both
 * consumers of this module, never owners of their own.
 *
 * **What this stack cannot do, stated so nobody looks for it (0182).**
 * `@jsquash/webp` exports a SINGLE-FRAME `encode`, so animated → animated WebP
 * is not implementable here at all. An animated GIF or WebP therefore keeps
 * itself as its display form — which is fine, a browser renders both natively
 * — and flattening one to a still is refused rather than done quietly (see the
 * router's `animation-would-be-lost`, and `readMotion` for how an animated WebP
 * comes to be recognised as one). The webp DECODER declines an animated file
 * as well — libwebp's still-image entry point errors on it — so an animated
 * WebP additionally has no dimensions and no thumbnail, and neither is
 * recoverable without an animation-aware decoder this build does not carry.
 * HEIC is refused at the door in `sniff.ts` (libheif-js is 6.4MB unpacked,
 * more than three times this whole codec stack), and video/audio transcoding
 * needs ffmpeg and is out of scope: declare the format, refuse a mismatch
 * honestly, convert nothing.
 */
import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { createJimp } from "@jimp/core"
import * as png from "@jimp/js-png"
import * as jpeg from "@jimp/js-jpeg"
import * as gif from "@jimp/js-gif"
import * as resize from "@jimp/plugin-resize"

const require = createRequire(import.meta.url)

/**
 * The one jimp instance. Its three format readers are also WRITERS — the same
 * plugins that decode png/jpeg/gif encode them too, which is what makes the
 * still-image conversion pairs reachable without another dependency.
 */
const Jimp = createJimp({
	formats: [
		(png as any).default ?? png,
		(jpeg as any).default ?? jpeg,
		(gif as any).default ?? gif
	],
	plugins: [(resize as any).methods]
})

let encoderReady: Promise<typeof import("@jsquash/webp/encode.js")> | null =
	null
let decoderReady: Promise<typeof import("@jsquash/webp/decode.js")> | null =
	null

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
			const wasmPath = require.resolve(
				"@jsquash/webp/codec/dec/webp_dec.wasm"
			)
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

export interface EncodeOptions {
	/** WebP only: write LOSSLESS, keeping alpha exactly. Ignores `quality`. */
	lossless?: boolean
	/** WebP and JPEG: 0–100. Unset leaves each encoder's own default, rather
	 *  than inventing a number here that would silently differ from it. */
	quality?: number
}

/**
 * Raw RGBA → the bytes of one still image. The ONE place this build writes
 * image bytes, so "what can we actually produce" has a single answer.
 *
 * SINGLE-FRAME by construction, every branch of it: the webp encoder writes one
 * frame and jimp's gif writer is handed one bitmap. The router is what stops an
 * animated source reaching here; this function has no way to tell.
 *
 * Throws for any other mime. Unreachable through the router, which checks the
 * pair against its registry first — and left as a throw rather than a silent
 * fallback so a converter registered without an encoder fails loudly.
 */
export async function encodeRaster(
	raster: RasterImage,
	mime: string,
	opts: EncodeOptions = {}
): Promise<Buffer> {
	if (mime === "image/webp") {
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
			opts.lossless
				? { lossless: 1, exact: 1 }
				: opts.quality === undefined
					? {}
					: { quality: opts.quality }
		)
		return Buffer.from(out)
	}

	const img = await toJimp(raster)
	if (mime === "image/jpeg") {
		return img.getBuffer(
			"image/jpeg",
			opts.quality === undefined ? undefined : { quality: opts.quality }
		)
	}
	if (mime === "image/png" || mime === "image/gif") {
		return img.getBuffer(mime)
	}
	throw new Error(`No encoder for ${mime} in this build.`)
}

/** Wrap a raster in the jimp instance. Separate because both the resize path
 *  and the three jimp encoders need it, and the `as any` is the cast jimp's
 *  bitmap type needs for a Buffer view. */
async function toJimp(raster: RasterImage) {
	return Jimp.fromBitmap({
		data: Buffer.from(
			raster.data.buffer,
			raster.data.byteOffset,
			raster.data.byteLength
		),
		width: raster.width,
		height: raster.height
	} as any)
}

/** Resample to an exact size. Aspect is the caller's business — `makeThumbnail`
 *  computes the box, this just resamples into it. */
export async function resizeRaster(
	raster: RasterImage,
	width: number,
	height: number
): Promise<RasterImage> {
	const img = await toJimp(raster)
	img.resize({ w: width, h: height })
	return {
		data: new Uint8ClampedArray(img.bitmap.data),
		width: img.bitmap.width,
		height: img.bitmap.height
	}
}

export interface MotionInfo {
	/**
	 * THE answer to "would re-encoding this lose frames", and the only field
	 * that answers it.
	 *
	 * Not `frames > 1` and not `durationMs !== null`: a WebP container can
	 * declare itself animated while stating neither number, so a caller keying
	 * on either one would flatten exactly the file it was trying to protect.
	 */
	animated: boolean
	/** 1 for a still image, N when the container states a count. NULL means
	 *  animated with no count stated — never "still". */
	frames: number | null
	/** Total playback time in ms, or null when the container states no
	 *  per-frame delays this parse can read. Null is "unknown", not zero. */
	durationMs: number | null
}

/** Bit 1 of `VP8X`'s flags byte — libwebp's `ANIMATION_FLAG`. See
 *  `readWebpMotion` for how this was verified. */
const WEBP_ANIMATION_FLAG = 0x02

/**
 * Whether an image carries a time dimension, and for how long.
 *
 * Both formats that CAN animate are probed, each through its own container and
 * neither by decoding a frame: GIF through `omggif`'s `GifReader` (which
 * `@jimp/js-gif` already brings), WebP through a walk of its RIFF chunk list.
 * PNG and JPEG have no time dimension to find.
 *
 * NULL is reserved for "not knowable from these bytes" — a container this
 * cannot parse — and is NOT the same as "still". Nothing may read a null, here
 * or in `files.duration_ms`, as permission to flatten.
 *
 * This is what the router's `animation-would-be-lost` stands on, so an
 * UNDER-report is a flattened animation. WebP was under-reported until this
 * probe existed — it read as unknown, and the only thing standing between an
 * animated WebP and a single-frame re-encode was the DECODER erroring on it,
 * which reported a file that is not broken as broken. Do not rely on that
 * again: the refusal has to be a decision, not a codec accident.
 *
 * GIF frame delays are CENTIseconds, which is why `files.duration_ms` is
 * integer ms — an exact comparison is the point, and `0.07` is not exact.
 */
export async function readMotion(
	buffer: Buffer | Uint8Array,
	mime: string
): Promise<MotionInfo | null> {
	if (mime === "image/webp") return readWebpMotion(buffer)
	if (mime !== "image/gif") return null
	try {
		// CommonJS, and it assigns its exports inside a try block, which the
		// ESM interop's lexer does not always see — hence the `.default`
		// fallback, the same shape as the jimp format plugins above.
		const omggif = await import("omggif")
		const GifReader = omggif.GifReader ?? (omggif as any).default?.GifReader
		const reader = new GifReader(Buffer.from(buffer))
		const frames = reader.numFrames()
		let centiseconds = 0
		for (let i = 0; i < frames; i++) {
			centiseconds += reader.frameInfo(i).delay ?? 0
		}
		return { animated: frames > 1, frames, durationMs: centiseconds * 10 }
	} catch {
		// A GIF we cannot parse is one we know nothing about, and saying so is
		// what stops a flatten being justified by a failed probe.
		return null
	}
}

/**
 * The WebP container's own answer, read from its RIFF chunk list.
 *
 * TWO signals say "animated" and EITHER is taken, because they are written by
 * different halves of a muxer and a disagreement has to resolve toward keeping
 * the original:
 *
 *  - the `ANIM` chunk. Structural evidence — it carries the animation's global
 *    parameters and exists only in a file that has frames — and the signal that
 *    survives a tool rewriting the header flags.
 *  - `VP8X`'s animation FLAG, bit 1 of the flags byte. Verified against real
 *    libwebp output rather than taken from memory or from a comment: an
 *    animated file's flags byte reads 0x02, and the neighbouring bit anyone
 *    would confuse it with — alpha, on a still image — reads 0x10.
 *
 * The frame COUNT and the duration come from the `ANMF` chunk headers, which
 * carry a 24-bit per-frame duration in ms; they are read from the same single
 * walk and so cost nothing extra. They are not the signal, though: a file may
 * carry the flag and no frames this walk can enumerate, and `animated` still
 * has to be true.
 *
 * Nothing here decodes a pixel — `@jsquash/webp`'s decoder refuses an animated
 * file outright, so a probe that needed a decode could not answer at all.
 */
function readWebpMotion(buffer: Buffer | Uint8Array): MotionInfo | null {
	const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
	// `RIFF` <u32 size> `WEBP`, then a flat list of `<fourCC> <u32 size>
	// <payload>` with every payload padded to an even length.
	if (
		buf.length < 16 ||
		buf.toString("latin1", 0, 4) !== "RIFF" ||
		buf.toString("latin1", 8, 12) !== "WEBP"
	)
		return null

	let declared = false
	let frames = 0
	let durationMs = 0
	let offset = 12
	let complete = true
	while (offset + 8 <= buf.length) {
		const fourCC = buf.toString("latin1", offset, offset + 4)
		const size = buf.readUInt32LE(offset + 4)
		const body = offset + 8
		if (size > buf.length - body) {
			// A chunk claiming more bytes than the file holds. Stop, and record
			// that the walk did not finish.
			complete = false
			break
		}
		if (fourCC === "ANIM") {
			declared = true
		} else if (fourCC === "VP8X" && size >= 1) {
			// Spec: VP8X, when present, is the FIRST chunk — so the flag is
			// read before any later chunk can truncate the walk.
			declared ||= (buf[body] & WEBP_ANIMATION_FLAG) !== 0
		} else if (fourCC === "ANMF" && size >= 16) {
			// The 16-byte frame header: x, y, width-1, height-1 and duration as
			// 24-bit LE fields, then a flags byte, then the frame's own image
			// chunks — which this deliberately does not descend into.
			frames++
			durationMs += buf.readUIntLE(body + 12, 3)
		}
		offset = body + size + (size % 2)
	}

	if (declared || frames > 1) {
		return {
			animated: true,
			frames: frames || null,
			durationMs: frames ? durationMs : null
		}
	}
	// An incomplete walk may not claim "still": the chunk it never reached is
	// exactly the one that would have mattered.
	return complete ? { animated: false, frames: 1, durationMs: null } : null
}
