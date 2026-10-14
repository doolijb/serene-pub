/**
 * 🚧 The **background remover** — the one matting model `core:task/cut-out@1`
 * runs (DESIGN-image-generation §1.9, unit I4, ruling §9.5).
 *
 * ## A local model no connection owns
 *
 * Every other ONNX model on this machine sits behind a connection (the local
 * embeddings / entities endpoints), and its download is that connection's
 * `connections:downloadModel`. This one is fetched by the task itself the first
 * time a picture needs cutting out, so nothing here has a connection id to push
 * progress against. What it shares with them is everything that is not a
 * connection:
 *
 *   · the cache rules (`onnxCache`, lane `matting` → `<app data>/models/matting`,
 *     `TRANSFORMERS_CACHE` wins as it does for the other two);
 *   · the registry row (`local_models`, `format: onnx`, `modality: matting`,
 *     filed under the Hub id) with the same `downloading → complete | error`
 *     lifecycle — so the row can be listed and deleted like any other;
 *   · the warm-not-transfer download (transformers.js's own loaders fetch the
 *     files the task needs, never a guessed file list), and the
 *     `download-settled` notification for the person whose run started it.
 *
 * ## ⚠ The row can disappear under it
 *
 * The managed KoboldCPP's directory scan (`sockets/koboldcpp.ts`) deletes every
 * `complete` `local_models` row whose filename it did not see in ITS
 * directories — ONNX rows included. So nothing here trusts the row to still be
 * there: the disk is the fact, and `ensureMattingRow` re-files it on every use.
 *
 * ## No native module
 *
 * transformers.js over `onnxruntime-node` is the runtime the other ONNX lanes
 * already load (`onnxRuntime.ts` is the one verdict on whether it can); image
 * bytes go through the jimp/jsquash codecs in `media/convert/codecs.ts`.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	cacheDirFor,
	dirSizeBytes,
	invalidateCachedScan,
	isCached,
	modelDirFor,
	removeCached
} from "./onnxCache"
import { localOnnxRefusal } from "./onnxRuntime"

/** The Hub repo (MIT). */
export const MATTING_MODEL_ID = "onnx-community/BiRefNet_lite-ONNX"
/** What media meta and logs call it. */
export const MATTING_MODEL_NAME = "BiRefNet_lite"
/** The `local_models.modality` value (NOMENCLATURE §10, §25). */
export const MATTING_MODALITY = "matting"
/** What a person is told it is. */
export const MATTING_DISPLAY_NAME = "Background remover (BiRefNet-lite)"
/**
 * Full precision: `onnx/model.onnx`. The repo's own transformers.js example
 * loads `fp32`, and an fp16 graph on the CPU provider is slower, not faster.
 */
export const MATTING_DTYPE = "fp32"

/** One RGBA picture in, its foreground matte out (one byte per pixel, 255 = keep). */
export type Matte = (raster: {
	data: Uint8ClampedArray
	width: number
	height: number
}) => Promise<{ alpha: Uint8ClampedArray; width: number; height: number }>

export type MattingState =
	| { state: "not_downloaded" }
	| {
			state: "downloading"
			percent: number | null
			/** A cancel was asked for; the fetch in flight is ending. */
			cancelling?: boolean
	  }
	| { state: "on_disk"; sizeBytes: number }
	| { state: "error"; error: string }

/** Called while the first-use download runs; `percent` null until sizes are known. */
export type MattingProgress = (p: { percent: number | null }) => void

// ---------------------------------------------------------------------------
// The registry row
// ---------------------------------------------------------------------------

/**
 * Write (or re-file) the one `local_models` row for the matting model.
 *
 * Upsert on `filename`, the table's unique key — the same key the connection
 * lanes file their ONNX rows under (`beginRegistryRow`).
 */
export async function ensureMattingRow(
	db: Db,
	patch: {
		status: "downloading" | "complete" | "error"
		sizeBytes?: number | null
		errorMessage?: string | null
	}
): Promise<void> {
	const values = {
		filename: MATTING_MODEL_ID,
		modelName: MATTING_MODEL_ID,
		modelUrl: `https://huggingface.co/${MATTING_MODEL_ID}`,
		downloadUrl: `https://huggingface.co/${MATTING_MODEL_ID}`,
		description:
			"Removes picture backgrounds for cut-outs. Downloaded once, the first time a picture needs one.",
		format: "onnx" as const,
		modality: MATTING_MODALITY,
		kind: "unknown" as const,
		kindSource: "declared" as const,
		quantization: MATTING_DTYPE,
		status: patch.status,
		errorMessage: patch.errorMessage ?? null,
		...(patch.sizeBytes !== undefined ? { sizeBytes: patch.sizeBytes } : {})
	}
	await db
		.insert(schema.localModels)
		.values(values)
		.onConflictDoUpdate({
			target: schema.localModels.filename,
			set: values
		})
}

/** The row, or null. */
export async function mattingRow(db: Db) {
	const [row] = await db
		.select()
		.from(schema.localModels)
		.where(
			and(
				eq(schema.localModels.filename, MATTING_MODEL_ID),
				eq(schema.localModels.modality, MATTING_MODALITY)
			)
		)
		.limit(1)
	return row ?? null
}

// ---------------------------------------------------------------------------
// Download and load — one of each in flight per process
// ---------------------------------------------------------------------------

let downloading: Promise<void> | null = null
let downloadPercent: number | null = null
/**
 * The running download's cancel. transformers.js takes no AbortSignal, so —
 * exactly as `connections:cancelModelDownload` does for the connection lanes
 * (`sockets/localOnnxModels.ts`, "Cancel cannot interrupt anything") — the
 * signal is read between steps, the file in flight runs to its own end, and
 * only THEN are the partial directory and the row removed, settling as
 * `not_downloaded`.
 */
let cancel: AbortController | null = null

/** What a caller waiting on a cancelled download is told. */
export const MATTING_CANCELLED_MESSAGE =
	"The background remover's download was cancelled."

/**
 * Ask the running download to stop. False when nothing is downloading.
 * The state stays `downloading` (with `cancelling`) until the fetch ends.
 */
export function cancelMattingDownload(): boolean {
	if (!downloading || !cancel) return false
	cancel.abort()
	return true
}
/** When the last progress push left, so admins hear at most four a second. */
let lastPushAt = 0
const PUSH_INTERVAL_MS = 250

/**
 * Tell every connected admin where the download stands, as the same
 * `localModels:matting` answer the Models view's row asks for — the
 * Downloads tray and the row both listen to it (the ONNX downloads'
 * `connections:modelDownloadProgress` needs a connection; this has none).
 * Best effort: a push is somebody's status line, never the download.
 */
async function pushMattingState(db: Db, force = false): Promise<void> {
	const now = Date.now()
	if (!force && now - lastPushAt < PUSH_INTERVAL_MS) return
	lastPushAt = now
	try {
		const { pushToConnectedAdmins } = await import(
			"$lib/server/sockets/utils/userPush"
		)
		pushToConnectedAdmins("localModels:matting", {
			name: MATTING_DISPLAY_NAME,
			...(await mattingModelState(db))
		})
	} catch (err) {
		console.warn("[matting] progress push:", err)
	}
}
/** Every caller waiting on the one download hears its progress. */
const progressListeners = new Set<MattingProgress>()

type Segmenter = (image: unknown) => Promise<unknown>
let segmenter: Segmenter | null = null
let loading: Promise<Segmenter> | null = null

/** Where this model's files are, or would be. */
export function mattingModelDir(): string | null {
	return modelDirFor(MATTING_MODEL_ID, "matting")
}

/** The state a Models view row (or a form's notice) would show. */
export async function mattingModelState(db: Db): Promise<MattingState> {
	if (downloading)
		return {
			state: "downloading",
			percent: downloadPercent,
			...(cancel?.signal.aborted ? { cancelling: true } : {})
		}
	const row = await mattingRow(db).catch(() => null)
	if (row?.status === "error")
		return { state: "error", error: row.errorMessage ?? "The download failed." }
	if (await isCached(MATTING_MODEL_ID, "matting"))
		return {
			state: "on_disk",
			sizeBytes: await dirSizeBytes(MATTING_MODEL_ID, "matting")
		}
	return { state: "not_downloaded" }
}

/**
 * Fetch the files the background-removal pipeline reads into the matting
 * cache, the way `fetchModelFiles` does for the connection lanes and for the
 * same reason: `pipeline()`'s file discovery reads `config.json` through
 * `env.cacheDir` (the embedding lane's directory), so the steps run by hand,
 * each handed `cache_dir`.
 */
async function fetchFiles(
	onPercent: (percent: number) => void,
	signal?: AbortSignal
) {
	const {
		AutoConfig,
		AutoModelForImageSegmentation,
		AutoProcessor,
		ModelRegistry
	} = (await import("@huggingface/transformers")) as any
	const cache_dir = cacheDirFor("matting")
	const config = await AutoConfig.from_pretrained(MATTING_MODEL_ID, {
		cache_dir
	})
	if (signal?.aborted) return
	const files: string[] = await ModelRegistry.get_pipeline_files(
		"background-removal",
		MATTING_MODEL_ID,
		{ config, dtype: MATTING_DTYPE }
	)
	if (signal?.aborted) return
	const loadingBytes: Record<string, { loaded: number; total: number }> = {}
	const progress_callback = (event: any) => {
		if (event?.status !== "progress" || typeof event.file !== "string")
			return
		loadingBytes[event.file] = {
			loaded: Number(event.loaded) || 0,
			total: Number(event.total) || 0
		}
		let loaded = 0
		let total = 0
		for (const f of Object.values(loadingBytes)) {
			loaded += f.loaded
			total += f.total
		}
		if (total > 0) onPercent(Math.round((loaded / total) * 100))
	}
	const [model] = await Promise.all([
		AutoModelForImageSegmentation.from_pretrained(MATTING_MODEL_ID, {
			cache_dir,
			config,
			dtype: MATTING_DTYPE,
			progress_callback
		}),
		files.includes("preprocessor_config.json")
			? AutoProcessor.from_pretrained(MATTING_MODEL_ID, {
					cache_dir,
					progress_callback
				})
			: null
	])
	// A download loads nothing into the process for keeps: the private model
	// instance `from_pretrained` built is freed here, and the pipeline below
	// opens its own from the directory.
	try {
		await model?.dispose?.()
	} catch {
		// A session that will not close is a leak, not a failed download.
	}
}

/**
 * Download the model once. Concurrent callers share the one download; the
 * row says `downloading` while it runs and `complete` / `error` after, and
 * the person whose run started it gets the `download-settled` notification.
 */
export async function downloadMattingModel(
	db: Db,
	opts: { userId?: number | null; onProgress?: MattingProgress } = {}
): Promise<void> {
	if (opts.onProgress) progressListeners.add(opts.onProgress)
	try {
		if (downloading) return await downloading
		downloading = (async () => {
			const refusal = await localOnnxRefusal()
			if (refusal) throw new Error(refusal)
			downloadPercent = null
			const controller = new AbortController()
			cancel = controller
			let failure: unknown = null
			await ensureMattingRow(db, { status: "downloading" })
			console.log(`[matting] Downloading ${MATTING_MODEL_ID}, once`)
			void pushMattingState(db, true)
			try {
				await fetchFiles((percent) => {
					if (controller.signal.aborted) return
					downloadPercent = percent
					void pushMattingState(db)
					for (const l of progressListeners) {
						try {
							l({ percent })
						} catch {
							// A listener is somebody's status line; never the download.
						}
					}
				}, controller.signal)
			} catch (err) {
				failure = err
			}
			invalidateCachedScan(MATTING_MODEL_ID, "matting")
			if (controller.signal.aborted) {
				// The fetch has ended one way or the other; only now is the
				// directory nobody's to delete. No notification: the person
				// who cancelled knows.
				try {
					await removeCached(MATTING_MODEL_ID, "matting")
					await db
						.delete(schema.localModels)
						.where(
							and(
								eq(schema.localModels.filename, MATTING_MODEL_ID),
								eq(schema.localModels.modality, MATTING_MODALITY)
							)
						)
				} catch (err) {
					console.error("[matting] removing a cancelled download:", err)
				}
				invalidateCachedScan(MATTING_MODEL_ID, "matting")
				throw new Error(MATTING_CANCELLED_MESSAGE)
			}
			const message =
				failure == null
					? null
					: failure instanceof Error
						? failure.message
						: String(failure)
			try {
				await ensureMattingRow(
					db,
					message == null
						? {
								status: "complete",
								sizeBytes: await dirSizeBytes(MATTING_MODEL_ID, "matting")
							}
						: { status: "error", errorMessage: message }
				)
			} catch (err) {
				console.error("[matting] settling the registry row:", err)
			}
			try {
				const { notifyDownloadSettled, downloadHref } = await import(
					"$lib/server/notifications/downloads"
				)
				await notifyDownloadSettled(
					{
						userId: opts.userId,
						source: "onnx",
						key: `${MATTING_MODALITY}:${MATTING_MODEL_ID}`,
						model: MATTING_DISPLAY_NAME,
						href: downloadHref(null),
						...(message != null ? { error: failure } : {})
					},
					db
				)
			} catch (err) {
				console.error("[matting] download notification:", err)
			}
			if (failure != null) throw failure
		})()
		await downloading
	} finally {
		if (opts.onProgress) progressListeners.delete(opts.onProgress)
		// Whoever settles first clears the slot; later awaiters only read it.
		const settled = downloading != null
		downloading = null
		cancel = null
		// The settled state (on disk, or the failure), so the tray's line ends.
		if (settled) void pushMattingState(db, true)
	}
}

/** The loaded pipeline, downloading first when the files are not here. */
async function loadSegmenter(
	db: Db,
	opts: { userId?: number | null; onProgress?: MattingProgress }
): Promise<Segmenter> {
	if (segmenter) return segmenter
	if (loading) return loading
	loading = (async () => {
		const refusal = await localOnnxRefusal()
		if (refusal) throw new Error(refusal)
		if (!(await isCached(MATTING_MODEL_ID, "matting")))
			await downloadMattingModel(db, opts)
		const { pipeline } = (await import("@huggingface/transformers")) as any
		// By DIRECTORY, not by repo id — the only way it loads offline and the
		// only way `env.cacheDir` is never consulted (see `ner/index.ts`).
		const dir = mattingModelDir()
		const source =
			dir && (await isCached(MATTING_MODEL_ID, "matting"))
				? dir
				: MATTING_MODEL_ID
		const loaded = (await pipeline("background-removal", source, {
			cache_dir: cacheDirFor("matting"),
			dtype: MATTING_DTYPE
		})) as Segmenter
		// The disk is the fact; the row follows it (see the header).
		await ensureMattingRow(db, {
			status: "complete",
			sizeBytes: await dirSizeBytes(MATTING_MODEL_ID, "matting")
		}).catch(() => {})
		segmenter = loaded
		return loaded
	})()
	try {
		return await loading
	} finally {
		loading = null
	}
}

/**
 * The matte for one picture: the background-removal pipeline's output alpha.
 *
 * transformers.js answers an RGBA `RawImage` with the mask put into its alpha
 * channel; only that channel is read here. Its size is whatever the pipeline
 * answered at (the input's, in 4.2.0) — the caller scales it to the original.
 */
export function mattingMatte(
	db: Db,
	opts: { userId?: number | null; onProgress?: MattingProgress } = {}
): Matte {
	return async (raster) => {
		const run = await loadSegmenter(db, opts)
		const { RawImage } = (await import("@huggingface/transformers")) as any
		const input = new RawImage(raster.data, raster.width, raster.height, 4)
		const out = (await run(input)) as {
			data: Uint8ClampedArray | Uint8Array
			width: number
			height: number
			channels: number
		}
		const result = Array.isArray(out) ? out[0] : out
		const { width, height, channels } = result
		const alpha = new Uint8ClampedArray(width * height)
		if (channels === 1) alpha.set(result.data)
		else
			for (let i = 0; i < width * height; i++)
				alpha[i] = result.data[i * channels + (channels - 1)]
		return { alpha, width, height }
	}
}

/**
 * *Delete from disk*: unload, remove the files, drop the row. The next cut-out
 * downloads it again.
 */
export async function removeMattingModel(db: Db): Promise<boolean> {
	if (downloading) throw new Error("The background remover is downloading.")
	segmenter = null
	const removed = await removeCached(MATTING_MODEL_ID, "matting")
	await db
		.delete(schema.localModels)
		.where(
			and(
				eq(schema.localModels.filename, MATTING_MODEL_ID),
				eq(schema.localModels.modality, MATTING_MODALITY)
			)
		)
	return removed
}

/** Test seam: forget the loaded pipeline and any in-flight state. */
export function resetMattingForTests() {
	segmenter = null
	loading = null
	downloading = null
	downloadPercent = null
	cancel = null
	progressListeners.clear()
}
