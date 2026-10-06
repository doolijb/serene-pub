/**
 * Embedding service — Node.js only.
 *
 * Two interchangeable backends behind one API:
 *  - "local": @huggingface/transformers, an in-process ONNX pipeline. Whether
 *    this actually works on the current system is *probed*, not predicted —
 *    onnxruntime-node (the native addon transformers' Node backend loads)
 *    bundles prebuilt binaries for some platform/arch combos and not others,
 *    and that list has already changed once (Intel Mac support silently
 *    dropped as of 1.24.3) and will again. Rather than hardcode a platform
 *    denylist that's guaranteed to go stale, `localOnnxAvailability()`
 *    (`localModels/onnxRuntime.ts`, shared with the entity lane) attempts the
 *    import once, caches whether it threw, and reports that;
 *    getLocalEmbeddingUnsupportedReason() below words it for this lane.
 *    Android is the one hardcoded answer there, a fast path for a genuine
 *    architectural impossibility, not a prediction.
 *  - "api": a host, reached through an EMBEDDING ADAPTER
 *    (`server/embeddingAdapters/`) — OpenAI-compatible `/embeddings`, or
 *    Ollama's own `/api/embed`. Just an HTTP request, so it works everywhere
 *    including Android. ⚠ The route is chosen by the connection's TYPE, never
 *    by a local/api flag: `openai-embeddings` and `ollama-embeddings` are both
 *    hosts and speak different routes, so a flag can only reach one of them.
 *
 * Every exported function below stays backend-agnostic on purpose: callers
 * (vectorizationQueue.ts, the 0.5 RAG path, promptBuilder/index.ts's RAG
 * availability gate) never need to know which backend is active. That's
 * also what makes per-row staleness detection work for both backends with
 * no extra code — getLoadedModelId() returns whatever identifier is
 * currently active (a HF model id, or a composite api::baseUrl::model
 * string), and that's the exact value vectorizationQueue.ts already writes
 * into each row's embeddingModel column and compares against.
 *
 * Also provides: single embed()/batchEmbed() calls, and cosine similarity
 * computed in-process (no pgvector required).
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers"
import { findModel } from "./models"
import { cacheDirFor, isCached } from "$lib/server/localModels/onnxCache"
import { localOnnxAvailability } from "$lib/server/localModels/onnxRuntime"
import type { BaseEmbeddingAdapter } from "$lib/server/embeddingAdapters/BaseEmbeddingAdapter"
import {
	buildApiModelId,
	resolveEmbeddingTarget,
	type EmbeddingTarget
} from "./target"

/**
 * ⚠ `resolveVectorizationApiKey` is GONE, along with the key class it read.
 *
 * It decrypted `vectorization_configs.api_key` under
 * `VECTORIZATION_API_KEY_INFO` — a secret class of its own, derived from the
 * same root by a different HKDF info string. Embedding endpoints are connections
 * now, their key lives in `connections.extra_json.apiKey` under
 * `CONNECTION_API_KEY_INFO`, and migration 0127 re-encrypts across the two (it
 * has to: a copied ciphertext is undecryptable under the new class while looking
 * perfectly configured). Nothing in the running app derives the vectorization
 * key any more, and nothing should — see `migrateEmbeddingConnection`, the one
 * place that still holds it, exactly once, on the way out.
 */

export { buildApiModelId }

/**
 * Checked before the dynamic import in loadEmbeddingModel() below so every
 * caller — vectorization.ts's handlers, vectorizationQueue.ts's
 * resume-on-boot retry, and loadSockets.server.ts's auto-load — gets this
 * specific message instead of the socket dispatcher's generic "An error
 * occurred" fallback (thrown errors aren't forwarded verbatim to the
 * client, see sockets/index.ts's register()).
 *
 * The verdict itself is `localOnnxAvailability()`
 * (`localModels/onnxRuntime.ts`), shared with the entity lane because the two
 * load one runtime; only this sentence is the embedding lane's. The client is
 * sent the verdict, not this sentence — see `systemSettings:get`'s
 * `localOnnxAvailability`.
 */
export async function getLocalEmbeddingUnsupportedReason(): Promise<
	string | null
> {
	const availability = await localOnnxAvailability()
	return availability.available
		? null
		: `Local embeddings are not available on this system: ${availability.reason} — use an external API instead.`
}

/**
 * Whether the local embedding lane can load. Also what boot calls to warm the
 * shared probe (`loadSockets.server.ts`), so the first `systemSettings:get`
 * finds the verdict already cached.
 */
export async function isLocalEmbeddingSupported(): Promise<boolean> {
	return (await getLocalEmbeddingUnsupportedReason()) === null
}

/**
 * The live API backend: the adapter instance, and what the first real call
 * measured.
 *
 * The ADAPTER is held rather than a `{baseUrl, apiKey, model}` bag, because the
 * bag was the OpenAI wire written into this file — there was nowhere for
 * Ollama's `/api/embed` to go. `dimensions` is not on the connection row and is
 * not declared anywhere: it is read back from the first response, because a
 * width nobody measured is a width that corrupts an index the day a backend
 * changes its default.
 */
type ApiEmbeddingBackend = {
	adapter: BaseEmbeddingAdapter
	/** For the log line and for `isModelReady`'s "validated" claim. */
	modelId: string
	dimensions: number
}

// Singleton pipeline — loaded lazily, replaced on model change
let pipeline: FeatureExtractionPipeline | null = null
let loadedModelId: string | null = null
let isLoading = false
let loadError: string | null = null

let activeBackend: "local" | "api" | null = null
let apiBackend: ApiEmbeddingBackend | null = null

// TTL idle timer — unloads the model after N minutes of inactivity
let ttlMinutes = 5
let ttlTimer: ReturnType<typeof setTimeout> | null = null

/**
 * When the lane last EMBEDDED something, not when it last loaded.
 *
 * The number the residency panel shows beside the idle window, so "unloads in
 * two minutes" can be read off the two together. Set by `embed`/`batchEmbed`
 * rather than by `resetTtlTimer`, because the timer is also reset by a load —
 * and "loaded four minutes ago, never used" is a different sentence from "last
 * used four minutes ago".
 */
let lastUsedAt: Date | null = null

export function setEmbeddingTtlMinutes(minutes: number) {
	ttlMinutes = minutes
	resetTtlTimer()
}

/** The idle window in force right now, in minutes. */
export function getEmbeddingTtlMinutes(): number {
	return ttlMinutes
}

/** ISO time of the last embed call, or null since the last unload. */
export function getEmbeddingLastUsedAt(): string | null {
	return lastUsedAt?.toISOString() ?? null
}

/** Marks the lane used. One place, so the two embed paths cannot disagree. */
function markUsed() {
	lastUsedAt = new Date()
	resetTtlTimer()
}

function resetTtlTimer() {
	if (ttlTimer) clearTimeout(ttlTimer)
	ttlTimer = null
	if (!pipeline || ttlMinutes <= 0) return
	ttlTimer = setTimeout(
		() => {
			ttlTimer = null
			unloadEmbeddingModel(`after ${ttlMinutes}m idle`)
		},
		ttlMinutes * 60 * 1000
	)
}

export type DownloadProgressCallback = (progress: {
	modelId: string
	status: "loading" | "downloading" | "ready" | "error"
	/** 0–100, or undefined if unknown */
	percent?: number
}) => void

/**
 * Load (or hot-swap) the embedding model.
 * Emits progress events via the optional callback so the UI can show a download bar.
 */
export async function loadEmbeddingModel(
	modelId: string,
	onProgress?: DownloadProgressCallback
): Promise<void> {
	if (activeBackend === "local" && loadedModelId === modelId && pipeline)
		return
	if (isLoading) throw new Error("Model is already loading")

	const unsupportedReason = await getLocalEmbeddingUnsupportedReason()
	if (unsupportedReason) throw new Error(unsupportedReason)

	// The catalogue first, because its `dtype` is the answer in the ordinary
	// case. A model the registry holds — an `.onnx` the user downloaded, filed
	// under modality `embeddings` — is loadable too, at the precision its
	// download fetched (`registeredEmbeddingModel`), or with no dtype override
	// when the row records none: guessing a precision is how a working file
	// stops loading. The entity loader resolves it the same way.
	const modelDef = findModel(modelId)
	const registered = modelDef ? null : await registeredEmbeddingModel(modelId)
	if (!modelDef && !registered)
		throw new Error(`Unknown embedding model: ${modelId}`)
	const dtype = modelDef?.dtype ?? registered?.dtype ?? null

	isLoading = true
	pipeline = null
	loadedModelId = null
	loadError = null
	apiBackend = null

	try {
		// Dynamic import keeps this out of the browser bundle entirely
		const { pipeline: createPipeline, env } = await import(
			"@huggingface/transformers"
		)

		// Store models inside the app data directory so they stay with
		// the rest of Serene Pub's data. TRANSFORMERS_CACHE can override.
		// The rule itself lives in `localModels/onnxCache.ts` — the download
		// path and the "is it on disk" check have to agree with this line, and
		// three copies of one path is how they stop agreeing.
		env.cacheDir = cacheDirFor("embeddings")

		onProgress?.({ modelId, status: "loading" })

		pipeline = (await createPipeline("feature-extraction", modelId, {
			...(dtype ? { dtype: dtype as any } : {}),
			// @ts-ignore — progress_callback is valid but not in all type defs
			progress_callback: (event: any) => {
				if (event?.status === "downloading") {
					const percent =
						event.total > 0
							? Math.round((event.loaded / event.total) * 100)
							: undefined
					onProgress?.({ modelId, status: "downloading", percent })
				} else if (event?.status === "loading") {
					onProgress?.({ modelId, status: "loading" })
				}
			}
		})) as FeatureExtractionPipeline

		loadedModelId = modelId
		activeBackend = "local"
		onProgress?.({ modelId, status: "ready" })
		console.log(`[embedding] Model loaded: ${modelId}`)
		resetTtlTimer()
	} catch (err: any) {
		loadError = err?.message ?? "Unknown error loading model"
		onProgress?.({ modelId, status: "error" })
		console.error(`[embedding] Failed to load model ${modelId}:`, err)
		throw err
	} finally {
		isLoading = false
	}
}

/**
 * The local model registry's row for an id the catalogue does not name, or
 * null when it holds none. The mirror of the entity lane's
 * `registeredNerModel` (`ner/index.ts`).
 *
 * `dtype` is the precision the row's download fetched — `local_models.
 * quantization`, which `connections:downloadModel` records from the same
 * resolution it downloads with (catalogue, then the model's declared
 * `extra_json.onnx.dtype`). Loading at any other precision asks for weights
 * the download never fetched: a Hub-added model set to `fp16` downloaded
 * `model_fp16.onnx` and then looked for `model.onnx`. Null for a row that
 * records none.
 *
 * Answers null rather than throwing when the database is unreachable: the
 * caller's next step is a refusal naming the model, which is a better sentence
 * than a database error in a path about loading a model.
 */
async function registeredEmbeddingModel(
	id: string
): Promise<{ dtype: string | null } | null> {
	if (!id) return null
	try {
		const { db } = await import("$lib/server/db")
		const schema = await import("$lib/server/db/schema")
		const { and, eq, or } = await import("drizzle-orm")
		const [row] = await db
			.select({ quantization: schema.localModels.quantization })
			.from(schema.localModels)
			.where(
				and(
					eq(schema.localModels.modality, "embeddings"),
					or(
						eq(schema.localModels.modelName, id),
						eq(schema.localModels.filename, id)
					)
				)
			)
			.limit(1)
		if (!row) return null
		return { dtype: row.quantization || null }
	} catch {
		return null
	}
}

/**
 * Validate and activate a host-backed embedding connection as the backend.
 *
 * Issues one REAL embed call before activating anything, exactly as before: a
 * config that fails validation never reaches the "ready" state, so
 * `isModelReady()` cannot report true for a broken setup, and the round trip is
 * also the only way to learn the vector width.
 *
 * Takes the starred CONNECTION rather than a `{baseUrl, apiKey, model}` bag.
 * The bag was the OpenAI wire in disguise — it could only ever be handed to one
 * hand-rolled client — and the type is what chooses between `/embeddings` and
 * Ollama's `/api/embed`. The adapter also reads the key off the row itself, so
 * no plaintext secret has to be threaded through this call at all.
 *
 * `modelId` is the identity the star resolved to (`EmbeddingTarget.modelId`),
 * which every vector is stamped with — passed in rather than rebuilt here, so
 * a type with a spelling of its own (`buildManagedKoboldCppModelId`) stamps the
 * identity staleness is judged by.
 */
export async function activateApiEmbedding(
	connection: AdapterConnection,
	onProgress?: DownloadProgressCallback,
	modelId: string = buildApiModelId(
		connection.baseUrl ?? "",
		connection.model ?? ""
	)
): Promise<{ dimensions: number }> {
	if (isLoading) throw new Error("Model is already loading")

	isLoading = true
	pipeline = null
	loadedModelId = null
	apiBackend = null
	loadError = null

	try {
		onProgress?.({ modelId, status: "loading" })

		const { getEmbeddingAdapter } = await import(
			"$lib/server/utils/getEmbeddingAdapter"
		)
		const { Adapter } = await getEmbeddingAdapter(connection.type)
		const adapter = new Adapter(connection)

		const probe = await adapter.embedText({ input: ["test"] })
		const dimensions = probe.dimensions
		if (!dimensions) {
			throw new Error(
				"Embeddings API returned no vector data for the test request"
			)
		}

		apiBackend = { adapter, modelId, dimensions }
		loadedModelId = modelId
		activeBackend = "api"
		onProgress?.({ modelId, status: "ready" })
		console.log(
			`[embedding] API backend activated: ${modelId} (${dimensions}d)`
		)
		resetTtlTimer()
		return { dimensions }
	} catch (err: any) {
		loadError = err?.message ?? "Unknown error validating embeddings API"
		onProgress?.({ modelId, status: "error" })
		console.error(
			`[embedding] Failed to activate API backend ${modelId}:`,
			err
		)
		throw err
	} finally {
		isLoading = false
	}
}

/**
 * What backend WOULD be loaded, without loading anything.
 *
 * The single source of truth for "what's configured", consumed by
 * `loadConfiguredEmbeddingModel()` below (the "bring it up for real" side) and
 * by `getConfiguredModelId()` (the "just tell me the identity, cheaply" side the
 * vectorization queue's peek-before-load check uses).
 *
 * ⚠ It reads THE STAR — the `text->embedding` row in `connection_defaults` — and
 * nothing else. See `./target` for why that is the one store, and for why this
 * is not `resolveCapabilityTarget`.
 *
 * Null means "nothing to do", including for a connection somebody has not
 * finished. ⚠ An incomplete endpoint is never a THROW: a half-filled connection
 * row is a row somebody is part-way through, the queue peeks at this on every
 * idle tick, and the error a person needs is the one the connection's own Test
 * button gives beside the field that is empty.
 */
export async function getConfiguredEmbeddingTarget(): Promise<EmbeddingTarget | null> {
	const { db } = await import("$lib/server/db")
	return resolveEmbeddingTarget(db)
}

/**
 * Cheap projection of getConfiguredEmbeddingTarget() for the vectorization
 * queue's peek-before-load check (see runQueue() in vectorizationQueue.ts)
 * — just the identity string pickNextItem() needs to check for pending
 * work, without paying any load cost.
 *
 * The try/catch is not about a misconfiguration — the resolver answers null for
 * one. It is about the database read itself: this runs on every idle tick, and a
 * transient failure there must not become an unhandled rejection inside the
 * queue loop.
 */
export async function getConfiguredModelId(): Promise<string | null> {
	try {
		const target = await getConfiguredEmbeddingTarget()
		return target?.modelId ?? null
	} catch {
		return null
	}
}

/**
 * Loads/activates whatever embedding backend is currently configured —
 * mode-aware (local vs. API), and sets the TTL from the persisted config
 * before loading so the idle timer starts correctly. The single source of
 * truth for "bring the configured backend up from cold," used by the
 * vectorization queue's on-demand load and by
 * loadConfiguredEmbeddingModelOpportunistically() below — previously
 * duplicated (once correctly, in loadSockets.server.ts's boot-time
 * autoLoadEmbeddingModel(), and once mode-unaware, in
 * vectorizationQueue.ts's runQueue()), which silently broke API-backend
 * setups the moment the boot-time copy was the only one still running.
 * No-ops if vectorization is disabled or unconfigured; throws on an actual
 * load/activation failure (matching loadEmbeddingModel()/
 * activateApiEmbedding()'s own contract, and getConfiguredEmbeddingTarget()'s).
 */
export async function loadConfiguredEmbeddingModel(
	onProgress?: DownloadProgressCallback
): Promise<void> {
	const target = await getConfiguredEmbeddingTarget()
	if (!target) return

	// Load TTL config before loading the model so the timer starts correctly.
	setEmbeddingTtlMinutes(target.ttlMinutes)

	if (target.mode === "api") {
		// The merged row, so the adapter reads its own base URL, model and
		// (encrypted) key off the connection it was built from — and the
		// identity the star resolved to, which is what every vector is stamped
		// with and what staleness compares.
		await activateApiEmbedding(
			target.connection,
			onProgress,
			target.modelId
		)
	} else {
		// ⚠ `onProgress` is not optional in practice on this arm: a first local
		// load DOWNLOADS several hundred megabytes, and a button that sits there
		// for four minutes with nothing moving reads as a hang.
		await loadEmbeddingModel(target.localModelName!, onProgress)
	}
}

let lastOpportunisticLoadAttemptAt = 0

/**
 * Fire-and-forget load for a caller that wants the model warm for a FUTURE
 * call, not this one (e.g. promptBuilder's RAG gate falling back to
 * keyword mode for the current turn because the model isn't ready) — never
 * throws, and is a no-op if a load is already in flight, already ready, or
 * was already attempted within the last ttlMinutes.
 *
 * The cooldown matters because the TTL idle-unload timer starts at load
 * time, not on first embed() (see resetTtlTimer(), called at the end of
 * both loadEmbeddingModel() and activateApiEmbedding()). An opportunistic
 * load is by definition never followed by an embed() call of its own — if
 * it were, the caller wouldn't have needed an opportunistic load in the
 * first place. So without this cooldown, a sustained slow-paced session
 * (every gap longer than ttlMinutes) would load-then-idle-unload on every
 * single cold turn for no benefit — RAG still never actually engages, just
 * with added load/unload churn. This bounds it to at most one attempt per
 * ttlMinutes-sized window. It still can't help a session whose gaps are
 * *always* longer than the TTL (nothing short of raising the TTL or
 * blocking on load would), but it stops making that case actively worse.
 */
export async function loadConfiguredEmbeddingModelOpportunistically(): Promise<void> {
	if (isModelReady() || isModelLoading()) return
	const now = Date.now()
	if (now - lastOpportunisticLoadAttemptAt < ttlMinutes * 60 * 1000) return
	lastOpportunisticLoadAttemptAt = now
	await loadConfiguredEmbeddingModel()
}

/**
 * Unload the current model/API config and free memory. `reason`, if given,
 * is appended to the log line (e.g. the TTL timer's "after Nm idle") — one
 * line per unload, not two, regardless of caller.
 */
export function unloadEmbeddingModel(reason?: string): void {
	if (ttlTimer) {
		clearTimeout(ttlTimer)
		ttlTimer = null
	}
	pipeline = null
	loadedModelId = null
	apiBackend = null
	activeBackend = null
	loadError = null
	// Nothing is resident, so there is no "last used" to report about it. The
	// panel reads null as "not loaded", which is the same fact twice rather
	// than a time that outlives the thing it describes.
	lastUsedAt = null
	console.log(`[embedding] Model unloaded${reason ? ` ${reason}` : ""}`)
}

/** Returns the currently active model/API identifier, or null if none is active */
export function getLoadedModelId(): string | null {
	return loadedModelId
}

/**
 * The LOCAL model resident in this lane, or null.
 *
 * ⚠ Not a second spelling of `getLoadedModelId`. That one answers with whatever
 * identity is active, including an `api::baseUrl::model` composite for a hosted
 * backend — which is the right answer for stamping a row and the wrong one for
 * "are this repo's files loaded right now". `LocalModelState.loaded` is the
 * second question, and the mirror of `getLoadedNerModelId()` next door.
 */
export function getLoadedEmbeddingModelId(): string | null {
	return activeBackend === "local" ? loadedModelId : null
}

/**
 * True if the active backend (local pipeline or external API) is loaded
 * and validated, ready to embed. False for a merely "enabled" but
 * unconfigured/unvalidated/failed state — callers (notably the RAG
 * availability gate in promptBuilder/index.ts) rely on this distinction to
 * skip the 0.5 RAG path rather than surface broken/empty RAG context.
 */
export function isModelReady(): boolean {
	if (activeBackend === "local")
		return pipeline !== null && loadedModelId !== null
	if (activeBackend === "api")
		return apiBackend !== null && loadedModelId !== null
	return false
}

/** True while a model download/load is in progress */
export function isModelLoading(): boolean {
	return isLoading
}

/** Returns the last load error message, or null if none */
export function getLoadError(): string | null {
	return loadError
}

/**
 * Check whether a model's files are present in the local cache without loading
 * it into memory.
 *
 * ⚠ The layout is `{cacheDir}/{org}/{name}/…`. `models--{org}--{name}` is the
 * *Python* `huggingface_hub` layout and transformers.js never writes it, so a
 * check against that name answers `false` for every model on every machine
 * with the weights sitting right there — and `listModels.modelCached` reports
 * a model as absent while it loads fine. The rule is stated once, in
 * `localModels/onnxCache.ts`, which this delegates to.
 */
export async function isModelCached(modelId: string): Promise<boolean> {
	return isCached(modelId, "embeddings")
}

/**
 * Embed a single text string. Returns a float array.
 * Throws if no backend is active.
 */
export async function embed(text: string): Promise<number[]> {
	if (activeBackend === "api" && apiBackend) {
		const { vectors } = await apiBackend.adapter.embedText({
			input: [text]
		})
		markUsed()
		return vectors[0]
	}
	if (!pipeline) throw new Error("No embedding model loaded")
	const result = await pipeline(text, { pooling: "mean", normalize: true })
	markUsed()
	return Array.from(result.data as Float32Array)
}

/**
 * Embed multiple strings. More efficient than calling embed() in a loop
 * when the backend supports batching (every backend does: transformers.js
 * pipelines natively, and `embedText` is array-in/array-out on every adapter
 * precisely because each protocol behind it batches).
 */
export async function batchEmbed(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return []

	if (activeBackend === "api" && apiBackend) {
		const { vectors } = await apiBackend.adapter.embedText({ input: texts })
		markUsed()
		return vectors
	}

	if (!pipeline) throw new Error("No embedding model loaded")
	const results = await pipeline(texts, { pooling: "mean", normalize: true })
	markUsed()
	// When given an array, result.data is a flat Float32Array of all embeddings
	const flat = Array.from(results.data as Float32Array)
	const dims = flat.length / texts.length
	return texts.map((_, i) => flat.slice(i * dims, (i + 1) * dims))
}

/**
 * Cosine similarity between two equal-length vectors.
 * Returns a value in [-1, 1]; higher = more similar.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0
	let dot = 0
	let normA = 0
	let normB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if (normA === 0 || normB === 0) return 0
	return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Rank items by cosine similarity to a query embedding.
 *
 * Pass `modelId` (the currently loaded model) to automatically skip rows
 * whose `embeddingModel` doesn't match — mixing vectors from different models
 * produces meaningless similarity scores.
 *
 * Returns items sorted descending by score, optionally limited to topK.
 */
export function rankBySimilarity<T>(
	queryEmbedding: number[],
	items: Array<
		T & { embedding: number[] | null; embeddingModel?: string | null }
	>,
	opts?: { topK?: number; modelId?: string }
): Array<T & { score: number }> {
	const scored = items
		.filter((item) => {
			if (item.embedding == null) return false
			if (opts?.modelId && item.embeddingModel !== opts.modelId)
				return false
			return true
		})
		.map((item) => ({
			...item,
			score: cosineSimilarity(queryEmbedding, item.embedding!)
		}))
		.sort((a, b) => b.score - a.score)

	return opts?.topK ? scored.slice(0, opts.topK) : scored
}
