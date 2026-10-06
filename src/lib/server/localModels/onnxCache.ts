/**
 * Where local ONNX weights live on disk, what is actually there, and the one
 * derivation that turns those facts into `LocalModelState` for the wire.
 *
 * ## The two cache directories, stated once
 *
 * They were written twice and slightly differently — `env.cacheDir` in
 * `embedding/index.ts`, a per-call `cache_dir` in `ner/index.ts` — and a third
 * consumer (downloads) would have made three. The RULES are unchanged:
 *
 *   · embeddings → `TRANSFORMERS_CACHE ?? <app data>/models/embeddings`
 *   · entities   → `TRANSFORMERS_CACHE ?? <app data>/models/ner`
 *
 * Separate subdirectories because the two catalogues can name one repo id, and a
 * shared directory would make one cache entry mean two things.
 *
 * ## ⚠ The layout is `<dir>/<org>/<name>/…`, NOT `models--org--name`
 *
 * `@huggingface/transformers` 4.2.0's `FileCache` keys on the plain request path
 * (`buildResourcePaths` → `pathJoin(repoId, filename)`), so a warmed repo lands
 * at `<cacheDir>/Xenova/bert-base-NER/onnx/model_quantized.onnx`. The
 * `models--org--name` form is the *Python* `huggingface_hub` layout and has
 * never existed here — `isModelCached` in `embedding/index.ts` looked for it and
 * therefore answered `false` for every model on every machine, which is why
 * `vectorization:listModels.modelCached` has always been false. That function
 * now delegates here.
 *
 * ## Scans are memoised for the process
 *
 * A model list renders every row, and walking several hundred megabytes of
 * weights per row per render is not a "cheap stat". Each model directory is
 * scanned at most once and the result held until something this process did
 * could have changed it — a download settling, or files being removed. A model
 * that appears on disk by some other route (a second instance, a hand copy) is
 * seen on the next restart, which is the price of not walking on every list.
 */

import fs from "node:fs/promises"
import path from "node:path"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import {
	catalogView,
	recommendedEmbeddingModels,
	recommendedNerModels
} from "./onnxList"
import type { OnnxCatalogView, OnnxModality } from "./onnxList"

export type { OnnxCatalogView, OnnxModality }

/** Is this endpoint one of the two that keeps its weights on this machine? */
export function onnxModalityOf(type: string): OnnxModality | null {
	if (type === CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS) return "embeddings"
	if (type === CONNECTION_TYPE.LOCAL_ONNX_NER) return "ner"
	return null
}

/**
 * The directory `pipeline()` is pointed at for this lane.
 *
 * ⚠ `TRANSFORMERS_CACHE` wins for BOTH lanes when it is set, which is what the
 * two loaders already did. It is an escape hatch for somebody who keeps weights
 * elsewhere, and honouring it in one lane but not the other would split a
 * machine's models across two roots.
 */
export function cacheDirFor(modality: OnnxModality): string {
	return (
		process.env.TRANSFORMERS_CACHE ??
		path.join(getAppDataDir(), "models", modality)
	)
}

/**
 * The directory one repo id occupies, or null for an id that could escape the
 * cache root.
 *
 * ⚠ The null arm is not theoretical: `connections:addHubModel` takes a repo id
 * from a person, and `removeCached` deletes a directory recursively. An id is
 * accepted only as plain path segments — no `..`, no absolute path, no empty
 * segment — and the resolved path is checked to still be inside the root.
 */
export function modelDirFor(
	modelId: string,
	modality: OnnxModality
): string | null {
	const root = cacheDirFor(modality)
	const segments = (modelId ?? "").split("/")
	if (!segments.length) return null
	for (const s of segments) {
		if (!s || s === "." || s === ".." || s.includes("\\")) return null
	}
	const dir = path.resolve(root, ...segments)
	const withinRoot =
		dir === path.resolve(root) ||
		dir.startsWith(path.resolve(root) + path.sep)
	return withinRoot ? dir : null
}

interface DirScan {
	/** The directory exists and holds at least one file. */
	present: boolean
	/**
	 * At least one `.onnx` file is there.
	 *
	 * The predicate for `on_disk`, rather than "the directory is not empty": a
	 * download interrupted after `config.json` and before the weights leaves a
	 * directory that is not empty and cannot be loaded, and calling that
	 * "on disk" is the one answer a person cannot act on.
	 */
	weights: boolean
	bytes: number
}

const scans = new Map<string, DirScan>()
const scanKey = (modelId: string, modality: OnnxModality) =>
	`${modality}:${modelId}`

async function walk(dir: string, depth = 0): Promise<DirScan> {
	const out: DirScan = { present: false, weights: false, bytes: 0 }
	// A repo is `config.json`, a tokenizer and an `onnx/` folder. Anything
	// deeper than a handful of levels is not a transformers cache entry, and an
	// unbounded walk over a directory somebody pointed TRANSFORMERS_CACHE at is
	// not a cost this should be able to pay.
	if (depth > 6) return out
	let entries
	try {
		entries = await fs.readdir(dir, { withFileTypes: true })
	} catch {
		return out
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			const nested = await walk(full, depth + 1)
			out.present ||= nested.present
			out.weights ||= nested.weights
			out.bytes += nested.bytes
			continue
		}
		if (!entry.isFile()) continue
		// A `.tmp.<pid>.<rand>` file is a write in flight, not a cached file.
		if (entry.name.includes(".tmp.")) continue
		out.present = true
		if (entry.name.toLowerCase().endsWith(".onnx")) out.weights = true
		try {
			out.bytes += (await fs.stat(full)).size
		} catch {
			// Vanished between readdir and stat — a concurrent remove. Its
			// bytes are not on disk, which is the answer this is computing.
		}
	}
	return out
}

async function scan(modelId: string, modality: OnnxModality): Promise<DirScan> {
	const key = scanKey(modelId, modality)
	const cached = scans.get(key)
	if (cached) return cached
	const dir = modelDirFor(modelId, modality)
	const result = dir
		? await walk(dir)
		: { present: false, weights: false, bytes: 0 }
	scans.set(key, result)
	return result
}

/**
 * Forget what this process believes about one model's files.
 *
 * Called when a download settles and when files are removed — the two moments
 * this process changes the directory. Forgetting more than necessary is cheap;
 * forgetting too little shows a stale size beside a model somebody just
 * downloaded.
 */
export function invalidateCachedScan(modelId: string, modality: OnnxModality) {
	scans.delete(scanKey(modelId, modality))
}

/** Test seam, and the reset a `TRANSFORMERS_CACHE` change would need. */
export function clearCachedScans() {
	scans.clear()
}

/**
 * Are this model's weights on this machine?
 *
 * The generalisation of `isModelCached` (embeddings only, and looking for a
 * directory name that never existed — see the header).
 */
export async function isCached(
	modelId: string,
	modality: OnnxModality
): Promise<boolean> {
	return (await scan(modelId, modality)).weights
}

/** Bytes this model occupies, or 0 when nothing of it is there. */
export async function dirSizeBytes(
	modelId: string,
	modality: OnnxModality
): Promise<number> {
	return (await scan(modelId, modality)).bytes
}

/**
 * Delete one model's directory. Answers whether anything was there.
 *
 * ⚠ Recursive, on a path built by `modelDirFor` and nowhere else — see that
 * function for why an id from a person cannot name a directory outside the
 * cache root.
 */
export async function removeCached(
	modelId: string,
	modality: OnnxModality
): Promise<boolean> {
	const dir = modelDirFor(modelId, modality)
	invalidateCachedScan(modelId, modality)
	if (!dir) return false
	try {
		await fs.rm(dir, { recursive: true, force: true })
		return true
	} catch (err) {
		console.error(`[onnx-cache] could not remove ${dir}:`, err)
		return false
	}
}

// ---------------------------------------------------------------------------
// Downloads in flight, in THIS process
// ---------------------------------------------------------------------------

/**
 * One warm in progress.
 *
 * Held here rather than in the socket module that drives it because
 * `localModelState` below has to read it, and a disk module that imported a
 * socket module would close a cycle through `connections.ts`.
 *
 * ⚠ Per PROCESS and never persisted. A `downloading` row in `local_models` that
 * no entry here matches is a download a restart interrupted, which is exactly
 * what `reconcileOnnxDownloadsOnBoot` settles — a stale `downloading` must never
 * be believed.
 */
export interface OnnxDownload {
	readonly key: string
	readonly modality: OnnxModality
	readonly modelId: string
	/** The endpoint the request named, for the progress push. */
	connectionId: number
	/** The `connection_models` row, for the progress push. */
	connectionModelId: number
	/**
	 * Cancellation REQUESTED.
	 *
	 * Not "stopped": transformers.js exposes no abort signal, so the in-flight
	 * fetch runs to its own end. The state pushed meanwhile stays `downloading`
	 * with no error — see `connections:cancelModelDownload`.
	 */
	cancelled: boolean
	percent?: number
	downloadedBytes?: number
	totalBytes?: number
	/** Resolves when the warm has settled, whatever the outcome. */
	settled?: Promise<void>
}

const downloads = new Map<string, OnnxDownload>()

export const downloadKey = (modality: OnnxModality, modelId: string) =>
	`${modality}:${modelId}`

/** The live warm for this model, or undefined. */
export function activeDownload(
	modality: OnnxModality,
	modelId: string
): OnnxDownload | undefined {
	return downloads.get(downloadKey(modality, modelId))
}

/**
 * Claim the one slot for `${modality}:${modelId}`.
 *
 * Returns the EXISTING entry when one is already there, which is how a second
 * press answers the current state instead of starting a second download of the
 * same weights into the same directory.
 */
export function claimDownload(entry: Omit<OnnxDownload, "key" | "cancelled">): {
	download: OnnxDownload
	claimed: boolean
} {
	const key = downloadKey(entry.modality, entry.modelId)
	const existing = downloads.get(key)
	if (existing) return { download: existing, claimed: false }
	const created: OnnxDownload = { ...entry, key, cancelled: false }
	downloads.set(key, created)
	return { download: created, claimed: true }
}

/** Release the slot. Idempotent — a settle and a cancel can both reach it. */
export function releaseDownload(download: OnnxDownload) {
	if (downloads.get(download.key) === download) downloads.delete(download.key)
}

/** Test seam — module state again. */
export function clearDownloads() {
	downloads.clear()
}

// ---------------------------------------------------------------------------
// The derivation
// ---------------------------------------------------------------------------

/**
 * What the caller already knows, so a list of twenty rows is not twenty
 * queries and twenty list loads.
 *
 * Every field is optional: `localModelState` fetches what it was not given,
 * which is what makes the singular form usable on its own from a handler.
 */
export interface LocalModelStateDeps {
	/** The model id resident in this modality's lane, or null. */
	loadedModelId?: string | null
	/** The recommended list, by id. */
	catalog?: ReadonlyMap<string, OnnxCatalogView>
	/** `local_models` rows for this modality, by the id they were filed under. */
	registry?: ReadonlyMap<string, RegistryFact>
}

/** The half of a `local_models` row this derivation reads. */
export interface RegistryFact {
	status: string
	errorMessage: string | null
	sizeBytes: number | null
}

/** The catalogue a user-added row carries on its own `connection_models` row. */
function hubCatalog(
	row: { extraJson?: Record<string, any> | null },
	modality: OnnxModality
): OnnxCatalogView | undefined {
	const hub = (row.extraJson as any)?.onnx?.hub
	if (!hub || typeof hub !== "object") return undefined
	const view: OnnxCatalogView = {}
	if (modality === "embeddings" && typeof hub.dimensions === "number")
		view.dimensions = hub.dimensions
	if (modality === "ner" && Array.isArray(hub.labels))
		view.labels = hub.labels.filter((l: unknown) => typeof l === "string")
	if (typeof hub.maxInputTokens === "number")
		view.maxInputTokens = hub.maxInputTokens
	return Object.keys(view).length ? view : undefined
}

/** The list as a map, for whichever lane the endpoint belongs to. */
export async function catalogMapFor(
	modality: OnnxModality
): Promise<Map<string, OnnxCatalogView>> {
	const defs =
		modality === "embeddings"
			? await recommendedEmbeddingModels()
			: await recommendedNerModels()
	return new Map(defs.map((d) => [d.id, catalogView(d)]))
}

/** The lane's resident model id, read without loading anything. */
async function laneLoadedModelId(
	modality: OnnxModality
): Promise<string | null> {
	try {
		if (modality === "ner") {
			const { getLoadedNerModelId } = await import("$lib/server/ner")
			return getLoadedNerModelId()
		}
		const { getLoadedEmbeddingModelId } = await import(
			"$lib/server/embedding/index"
		)
		return getLoadedEmbeddingModelId()
	} catch {
		return null
	}
}

/** `local_models` facts for one modality, by the id they were filed under. */
export async function registryMapFor(
	db: Db,
	modality: OnnxModality
): Promise<Map<string, RegistryFact>> {
	const out = new Map<string, RegistryFact>()
	try {
		const schema = await import("$lib/server/db/schema")
		const { and, eq } = await import("drizzle-orm")
		const rows = await db
			.select({
				filename: schema.localModels.filename,
				modelName: schema.localModels.modelName,
				status: schema.localModels.status,
				errorMessage: schema.localModels.errorMessage,
				sizeBytes: schema.localModels.sizeBytes
			})
			.from(schema.localModels)
			.where(
				and(
					eq(schema.localModels.modality, modality),
					eq(schema.localModels.format, "onnx")
				)
			)
		for (const r of rows) {
			const fact: RegistryFact = {
				status: r.status,
				errorMessage: r.errorMessage ?? null,
				sizeBytes: r.sizeBytes ?? null
			}
			// Filed under the Hub id on either column, the way the two
			// lanes' registry readers (`registeredEmbeddingModel`,
			// `registeredNerModel`) look it up.
			if (r.filename) out.set(r.filename, fact)
			if (r.modelName && !out.has(r.modelName)) out.set(r.modelName, fact)
		}
	} catch {
		// A registry that cannot be read means no error rows are known, which
		// degrades to reading the disk — a worse answer, never a failed list.
	}
	return out
}

/**
 * One `connection_models` row on a local ONNX endpoint, as `LocalModelState`.
 *
 * The order of the arms is the whole of the derivation and is deliberate:
 *
 *   1. **A download in this process wins.** It is the only state that is about
 *      right now rather than about the disk.
 *   2. **Then a recorded error**, because a failed download leaves whatever
 *      partial files it got, and reporting those as `on_disk` would hide the
 *      failure behind a model that looks ready and will not load.
 *   3. **Then the disk**, measured.
 *   4. **Otherwise not downloaded**, sized from the list — a figure the list
 *      published, never one this file estimated.
 *
 * `state` is independent of whether the model is the capability default: a
 * default that is `not_downloaded` is exactly what somebody needs to see before
 * the first job stalls.
 */
export async function localModelState(
	db: Db,
	connection: { type: string },
	row: { model: string; extraJson?: Record<string, any> | null },
	deps: LocalModelStateDeps = {}
): Promise<Sockets.Connections.LocalModelState | null> {
	const modality = onnxModalityOf(connection.type)
	if (!modality) return null

	const modelId = row.model
	const catalog =
		(deps.catalog ?? (await catalogMapFor(modality))).get(modelId) ??
		hubCatalog(row, modality)
	const loadedModelId =
		deps.loadedModelId !== undefined
			? deps.loadedModelId
			: await laneLoadedModelId(modality)
	const addedByUser = (row.extraJson as any)?.onnx?.addedByUser === true
	const listedBytes =
		catalog?.sizeMb != null ? Math.round(catalog.sizeMb * 1e6) : null

	const base = {
		loaded: loadedModelId != null && loadedModelId === modelId,
		addedByUser,
		...(catalog ? { catalog } : {})
	}

	const download = activeDownload(modality, modelId)
	if (download) {
		return {
			...base,
			state: "downloading",
			sizeBytes: listedBytes,
			...(download.percent != null ? { percent: download.percent } : {}),
			...(download.downloadedBytes != null
				? { downloadedBytes: download.downloadedBytes }
				: {}),
			...(download.totalBytes != null
				? { totalBytes: download.totalBytes }
				: {}),
			// ⚠ Stays null while a cancel is settling. A cancel is not a
			// failure, and the client says "cancelling" in its own words.
			error: null
		}
	}

	const registry = (
		deps.registry ?? (await registryMapFor(db, modality))
	).get(modelId)
	if (registry?.status === "error") {
		return {
			...base,
			state: "error",
			sizeBytes: listedBytes,
			error: registry.errorMessage ?? "The download failed."
		}
	}

	if (await isCached(modelId, modality)) {
		return {
			...base,
			state: "on_disk",
			sizeBytes: await dirSizeBytes(modelId, modality)
		}
	}

	return { ...base, state: "not_downloaded", sizeBytes: listedBytes }
}

/**
 * Every row on one endpoint, in one pass.
 *
 * Empty for every endpoint that is not one of the two local ONNX types, which
 * is what keeps `ModelRow.local` absent everywhere else — a remote host's
 * models have no disk state here, and a field that was present-but-empty would
 * read as one.
 */
export async function localModelStates(
	db: Db,
	endpoint: { type: string },
	rows: ReadonlyArray<{
		id: number
		model: string
		extraJson?: Record<string, any> | null
	}>
): Promise<Map<number, Sockets.Connections.LocalModelState>> {
	const out = new Map<number, Sockets.Connections.LocalModelState>()
	const modality = onnxModalityOf(endpoint.type)
	if (!modality || rows.length === 0) return out
	const [catalog, registry, loadedModelId] = await Promise.all([
		catalogMapFor(modality),
		registryMapFor(db, modality),
		laneLoadedModelId(modality)
	])
	for (const row of rows) {
		const state = await localModelState(db, endpoint, row, {
			catalog,
			registry,
			loadedModelId
		})
		if (state) out.set(row.id, state)
	}
	return out
}
