/**
 * The thumbnail worker: the codec half of `makeThumbnail` — decode, crop,
 * resize, webp encode — run on a `worker_threads` thread instead of the main one.
 *
 * **Why.** A 2,000 px image takes long enough to decode and encode that every
 * socket and every request waits behind it. The frame maths stays on the main
 * thread (it is microseconds); the pixels go here.
 *
 * **What it owns:** the one thumbnail-worker thread and its FIFO. Nothing else
 * in the app learns it exists (P2) — only `thumbnail.ts` imports this module.
 *
 * **What it does not:** frame maths (`thumbnail.ts`), the in-thread codecs
 * (`convert/codecs.ts` stays the one in-thread copy, and is what runs when this
 * thread cannot start), and any other media work (`makeFitted`, conversion).
 *
 * ⚠ The thumbnail worker compiles the webp WASM a SECOND time, at its first
 * use (accepted, perf-E's note). `codecs.ts`'s "exactly one of each" rule is
 * about the main thread, which still compiles its own copy only if it ever
 * needs one.
 *
 * Same bytes out on either path: the program below mirrors `codecs.ts` call for
 * call, loading the very same ESM files the main thread loads.
 */
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Worker } from "node:worker_threads"
import {
	cropRaster,
	decodeImage,
	encodeRaster,
	resizeRaster,
	type RasterImage
} from "./convert/codecs"
import { assertDecodableSize } from "./convert/imageSize"

const require = createRequire(import.meta.url)

/** A job the thumbnail worker took and died during (crash, out of memory,
 *  exit). Only that job fails. */
export class ThumbnailWorkerStopped extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ThumbnailWorkerStopped"
	}
}

/** CommonJS text run with `eval: true` (the `compile.ts` pattern): never a
 *  module of the build, so it is the same code in dev, vitest and the build.
 *  Every package comes in by a file URL the host resolved. */
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads")
const { readFile } = require("node:fs/promises")
const u = workerData.urls
const msg = (e) => String((e && e.message) || e)
let Jimp, simd
let enc = null, dec = null
let encCompiled = false, decCompiled = false
const cropRaster = (r, x, y, w, h) => {
	const data = new Uint8ClampedArray(w * h * 4)
	const rowBytes = w * 4
	for (let row = 0; row < h; row++) {
		const from = ((y + row) * r.width + x) * 4
		data.set(r.data.subarray(from, from + rowBytes), row * rowBytes)
	}
	return { data, width: w, height: h }
}
const toJimp = (r) =>
	Jimp.fromBitmap({
		data: Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength),
		width: r.width,
		height: r.height
	})
const resizeRaster = (r, w, h) => {
	const img = toJimp(r)
	img.resize({ w, h })
	return { data: new Uint8ClampedArray(img.bitmap.data), width: img.bitmap.width, height: img.bitmap.height }
}
const timed = async (fn) => {
	const t = Date.now()
	const out = await fn()
	return [out, Date.now() - t]
}
async function decoder() {
	if (dec) return [dec, null]
	const [d, ms] = await timed(async () => {
		const m = await import(u.webpDecode)
		await m.init(await WebAssembly.compile(await readFile(u.decWasm)))
		return m
	})
	dec = d
	return [dec, ms]
}
async function encoder() {
	if (enc) return [enc, null]
	const [e, ms] = await timed(async () => {
		const m = await import(u.webpEncode)
		const file = (await simd()) ? u.encWasmSimd : u.encWasm
		await m.init(await WebAssembly.compile(await readFile(file)))
		return m
	})
	enc = e
	return [enc, ms]
}
async function run(job) {
	if (job.op === "decode") {
		let out, compiledMs = null
		if (job.mime === "image/webp") {
			const [d, ms] = await decoder()
			compiledMs = ms
			const r = await d.default(job.bytes)
			out = { data: new Uint8ClampedArray(r.data), width: r.width, height: r.height }
		} else {
			const img = await Jimp.fromBuffer(Buffer.from(new Uint8Array(job.bytes)))
			out = { data: new Uint8ClampedArray(img.bitmap.data), width: img.bitmap.width, height: img.bitmap.height }
		}
		return [{ kind: "decoded", data: out.data.buffer, width: out.width, height: out.height, compiledMs }, [out.data.buffer]]
	}
	let raster = { data: new Uint8ClampedArray(job.data), width: job.width, height: job.height }
	if (job.cut) raster = cropRaster(raster, job.cut.x, job.cut.y, job.cut.w, job.cut.h)
	if (job.resizeTo) raster = resizeRaster(raster, job.resizeTo.width, job.resizeTo.height)
	const [e, ms] = await encoder()
	const out = await e.default(
		{ data: Uint8ClampedArray.from(raster.data), width: raster.width, height: raster.height, colorSpace: "srgb" },
		{ quality: job.quality }
	)
	return [{ kind: "encoded", bytes: out, compiledMs: ms }, [out]]
}
;(async () => {
	try {
		const [core, js_png, js_jpeg, js_gif, resize, wfd] = await Promise.all([
			import(u.core), import(u.png), import(u.jpeg), import(u.gif), import(u.resize), import(u.wasmFeatureDetect)
		])
		simd = wfd.simd
		Jimp = core.createJimp({
			formats: [js_png.default ?? js_png, js_jpeg.default ?? js_jpeg, js_gif.default ?? js_gif],
			plugins: [resize.methods]
		})
	} catch (e) {
		parentPort.postMessage({ kind: "unavailable", message: msg(e) })
		return
	}
	parentPort.on("message", async (job) => {
		try {
			const [answer, transfer] = await run(job)
			parentPort.postMessage(answer, transfer)
		} catch (e) {
			parentPort.postMessage({ kind: "failed", message: msg(e) })
		}
	})
	parentPort.postMessage({ kind: "ready" })
})()
`

type Answer =
	| {
			kind: "decoded"
			data: ArrayBuffer
			width: number
			height: number
			compiledMs: number | null
	  }
	| { kind: "encoded"; bytes: ArrayBuffer; compiledMs: number | null }
	| { kind: "failed"; message: string }

interface Handle {
	worker: Worker
	pending: { resolve: (a: Answer) => void; reject: (e: Error) => void } | null
	loggedDecoder: boolean
	loggedEncoder: boolean
}

let source: string = WORKER_SOURCE
let current: Handle | null = null
let starting: Promise<Handle | null> | null = null
/** Set once a start failed: every later job runs in-thread. */
let cannotStart = false
let warned = false
let starts = 0
/** The version of the world a start belongs to; a test reset bumps it. */
let epoch = 0

// One thumbnail worker, not a pool: thumbnails are rare, bursty and each one
// already saturates a core; a second would only double the WASM memory.
let tail: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
	const p = tail.then(fn)
	tail = p.catch(() => {})
	return p
}

/** The ESM entry of a package, found through its `package.json` exports. */
function esmEntry(pkg: string): string {
	let pkgJson: string
	try {
		pkgJson = require.resolve(`${pkg}/package.json`)
	} catch (e) {
		throw new Error(`${pkg} did not resolve`, { cause: e })
	}
	const manifest = JSON.parse(readFileSync(pkgJson, "utf8"))
	const entry = manifest.exports?.["."]?.import?.default
	if (typeof entry !== "string")
		throw new Error(`${pkg} has no ESM entry in its package.json`)
	return pathToFileURL(path.resolve(path.dirname(pkgJson), entry)).href
}

function resolveUrls(): Record<string, string> {
	const file = (spec: string): string => {
		try {
			return pathToFileURL(require.resolve(spec)).href
		} catch (e) {
			throw new Error(`${spec} did not resolve`, { cause: e })
		}
	}
	return {
		core: esmEntry("@jimp/core"),
		png: esmEntry("@jimp/js-png"),
		jpeg: esmEntry("@jimp/js-jpeg"),
		gif: esmEntry("@jimp/js-gif"),
		resize: esmEntry("@jimp/plugin-resize"),
		wasmFeatureDetect: esmEntry("wasm-feature-detect"),
		webpEncode: file("@jsquash/webp/encode.js"),
		webpDecode: file("@jsquash/webp/decode.js"),
		// The wasm files are read inside the thread, so these are paths.
		encWasmSimd: require.resolve(
			"@jsquash/webp/codec/enc/webp_enc_simd.wasm"
		),
		encWasm: require.resolve("@jsquash/webp/codec/enc/webp_enc.wasm"),
		decWasm: require.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")
	}
}

function startFailed(reason: string): null {
	cannotStart = true
	if (!warned) {
		warned = true
		console.warn(
			`[media] the thumbnail worker could not start (${reason}) — thumbnails are made on the main thread`
		)
	}
	return null
}

function start(): Promise<Handle | null> {
	const myEpoch = epoch
	return new Promise<Handle | null>((resolve) => {
		let worker: Worker
		let urls: Record<string, string>
		try {
			urls = resolveUrls()
			starts++
			worker = new Worker(source, { eval: true, workerData: { urls } })
		} catch (e) {
			resolve(startFailed(String((e as Error)?.message ?? e)))
			return
		}
		worker.unref()
		const handle: Handle = {
			worker,
			pending: null,
			loggedDecoder: false,
			loggedEncoder: false
		}
		let ready = false
		const stale = () => myEpoch !== epoch
		worker.on("message", (m: { kind: string; message?: string }) => {
			if (stale()) return
			if (!ready) {
				if (m.kind === "ready") {
					ready = true
					current = handle
					resolve(handle)
				} else if (m.kind === "unavailable") {
					resolve(startFailed(m.message ?? "unavailable"))
					void worker.terminate().catch(() => {})
				}
				return
			}
			const p = handle.pending
			handle.pending = null
			p?.resolve(m as Answer)
		})
		const died = (why: string) => {
			if (stale()) return
			if (!ready) {
				resolve(startFailed(why))
				return
			}
			if (current === handle) current = null
			const p = handle.pending
			handle.pending = null
			p?.reject(
				new ThumbnailWorkerStopped(
					`the thumbnail worker stopped: ${why}`
				)
			)
		}
		worker.on("error", (e: Error) => died(String(e?.message ?? e)))
		worker.on("exit", (code) => died(`(exit ${code})`))
	})
}

async function acquire(): Promise<Handle | null> {
	if (cannotStart) return null
	if (current) return current
	if (!starting) {
		const s = start().finally(() => {
			if (starting === s) starting = null
		})
		starting = s
	}
	return starting
}

function call(
	h: Handle,
	job: object,
	transfer: ArrayBuffer[]
): Promise<Answer> {
	return new Promise<Answer>((resolve, reject) => {
		h.pending = { resolve, reject }
		h.worker.postMessage(job, transfer)
	}).then((a) => {
		if (a.kind === "failed") throw new Error(a.message)
		return a
	})
}

function logCompile(h: Handle, what: "encoder" | "decoder", ms: number | null) {
	if (ms === null) return
	if (what === "encoder" ? h.loggedEncoder : h.loggedDecoder) return
	if (what === "encoder") h.loggedEncoder = true
	else h.loggedDecoder = true
	console.debug(
		`[media] thumbnail worker compiled the webp ${what} in ${ms} ms`
	)
}

/** Decode to raw RGBA, off the main thread. The pixel ceiling is checked HERE,
 *  on the main thread, before anything is posted (assertDecodableSize) — same
 *  error, same sentence. */
export function decodeForThumbnail(
	buffer: Buffer | Uint8Array,
	mime: string
): Promise<RasterImage> {
	return enqueue(async () => {
		assertDecodableSize(buffer)
		const h = await acquire()
		if (!h) return decodeImage(buffer, mime)
		// One copy into a fresh ArrayBuffer, which is the thing transferred:
		// the caller keeps its Buffer (it may be a slice of a shared pool).
		const bytes = Uint8Array.prototype.slice.call(buffer)
			.buffer as ArrayBuffer
		const a = await call(h, { op: "decode", mime, bytes }, [bytes])
		if (a.kind !== "decoded")
			throw new Error("the thumbnail worker answered out of turn")
		logCompile(h, "decoder", a.compiledMs)
		return {
			data: new Uint8ClampedArray(a.data),
			width: a.width,
			height: a.height
		}
	})
}

/** Crop (when `cut` is set), resize (when `resizeTo` is set), encode webp at
 *  `quality`. The raster is transferred: the caller is done with it. */
export function encodeThumbnail(
	raster: RasterImage,
	opts: {
		cut: { x: number; y: number; w: number; h: number } | null
		resizeTo: { width: number; height: number } | null
		quality: number
	}
): Promise<Buffer> {
	return enqueue(async () => {
		const h = await acquire()
		if (!h) {
			let r = opts.cut
				? cropRaster(
						raster,
						opts.cut.x,
						opts.cut.y,
						opts.cut.w,
						opts.cut.h
					)
				: raster
			if (opts.resizeTo)
				r = await resizeRaster(
					r,
					opts.resizeTo.width,
					opts.resizeTo.height
				)
			return encodeRaster(r, "image/webp", { quality: opts.quality })
		}
		let data = raster.data.buffer as ArrayBuffer
		if (
			raster.data.byteOffset !== 0 ||
			raster.data.byteLength !== data.byteLength
		)
			data = data.slice(
				raster.data.byteOffset,
				raster.data.byteOffset + raster.data.byteLength
			)
		const a = await call(
			h,
			{
				op: "encode",
				data,
				width: raster.width,
				height: raster.height,
				cut: opts.cut,
				resizeTo: opts.resizeTo,
				quality: opts.quality
			},
			[data]
		)
		if (a.kind !== "encoded")
			throw new Error("the thumbnail worker answered out of turn")
		logCompile(h, "encoder", a.compiledMs)
		return Buffer.from(a.bytes)
	})
}

/** @internal Tests only. Terminates any live worker, forgets "cannot start" and
 *  "already warned", and sets the worker's program (`source`; omitted = the
 *  real one). */
export function __setThumbnailWorkerForTests(opts?: { source?: string }): void {
	epoch++
	const h = current
	current = null
	starting = null
	cannotStart = false
	warned = false
	source = opts?.source ?? WORKER_SOURCE
	if (h) void h.worker.terminate().catch(() => {})
}

/** @internal Tests only. How many workers this process has started. */
export function __thumbnailWorkerStartsForTests(): number {
	return starts
}
