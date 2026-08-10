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
 *    denylist that's guaranteed to go stale, getLocalEmbeddingUnsupportedReason()
 *    below actually attempts the import once, caches whether it threw, and
 *    reports that. See that function for the one hardcoded exception
 *    (Android), which is a fast path for a genuine architectural
 *    impossibility, not a prediction.
 *  - "api": a plain OpenAI-compatible /embeddings HTTP endpoint (also
 *    implemented by Ollama, LM Studio, llama.cpp server, etc.) — just an
 *    HTTP request, so it works everywhere including Android.
 *
 * Every exported function below stays backend-agnostic on purpose: callers
 * (vectorizationQueue.ts, RagInfillEngine.ts, promptBuilder/index.ts's RAG
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
import { getAppDataDir, isAndroidWrapper } from "$lib/server/utils"
import path from "path"
import {
	decryptToken,
	VECTORIZATION_API_KEY_INFO
} from "$lib/server/utils/tokenCrypto"

/**
 * Decrypts a vectorizationConfigs row's apiKey (encrypted at rest via
 * tokenCrypto.ts) for actual use — every DB read site that's about to pass
 * the key to activateApiEmbedding() or echo it back to the admin client
 * should go through this, not read `.apiKey` directly off the row.
 * activateApiEmbedding()/apiEmbed() themselves stay encryption-agnostic —
 * they only ever see the already-decrypted value threaded through here.
 */
export function resolveVectorizationApiKey(vecConfig: {
	apiKey: string | null
	apiKeyIv: string | null
	apiKeyAuthTag: string | null
}): string | null {
	if (!vecConfig.apiKey || !vecConfig.apiKeyIv || !vecConfig.apiKeyAuthTag) {
		return null
	}
	return decryptToken(
		{
			ciphertext: vecConfig.apiKey,
			iv: vecConfig.apiKeyIv,
			authTag: vecConfig.apiKeyAuthTag
		},
		VECTORIZATION_API_KEY_INFO
	)
}

type LocalEmbeddingProbeResult = { supported: boolean; reason: string | null }

// In-memory only, per process lifetime — deliberately never persisted.
// A persisted "unsupported" verdict would survive an onnxruntime-node
// upgrade that fixes this exact platform, which is precisely the class of
// upstream churn this probe exists to stop chasing. One dynamic import per
// server boot is cheap enough to never need a durable cache.
let probeResult: LocalEmbeddingProbeResult | null = null
let probePromise: Promise<LocalEmbeddingProbeResult> | null = null

/**
 * Attempts the real dynamic import once and caches whether it threw. This
 * is a pure loadability check — it must stay a bare `import()` with nothing
 * else in the try block. Do not fold model-loading (loadEmbeddingModel's
 * createPipeline(...) call) into this function or its try/catch: a later
 * failure to download model weights or write to disk is a transient error,
 * not a capability fact, and would otherwise get cached here as a
 * false-permanent "platform unsupported" verdict.
 */
async function probeLocalEmbeddingSupport(): Promise<LocalEmbeddingProbeResult> {
	if (probeResult) return probeResult
	if (!probePromise) {
		probePromise = (async () => {
			try {
				await import("@huggingface/transformers")
				probeResult = { supported: true, reason: null }
			} catch (err: any) {
				probeResult = {
					supported: false,
					reason: `Local embeddings are not available on this system (${err?.message ?? "failed to load the local embedding engine"}) — use an external API instead.`
				}
			}
			return probeResult
		})()
	}
	return probePromise
}

/**
 * Checked before the dynamic import in loadEmbeddingModel() below so every
 * caller — vectorization.ts's handlers, vectorizationQueue.ts's
 * resume-on-boot retry, and loadSockets.server.ts's auto-load — gets this
 * specific message instead of the socket dispatcher's generic "An error
 * occurred" fallback (thrown errors aren't forwarded verbatim to the
 * client, see sockets/index.ts's register()). Exported so systemSettings.ts
 * can surface the same condition to the client as a single
 * `localEmbeddingsSupported` capability flag — named by capability, not by
 * platform, so the setup UI (which only cares "can I offer Local as a
 * choice") doesn't need a new prop every time upstream drops support for
 * another platform.
 */
export async function getLocalEmbeddingUnsupportedReason(): Promise<
	string | null
> {
	if (isAndroidWrapper()) {
		// A genuine architectural impossibility (Bionic can't dlopen glibc
		// binaries), not a "true today" fact that could change with an
		// onnxruntime-node release — worth a fast, specific message without
		// waiting on an import attempt that would fail anyway.
		return "Local embeddings are not available in the Android app — use an external API instead."
	}
	return (await probeLocalEmbeddingSupport()).reason
}

/** The capability flag sent to the client — see getLocalEmbeddingUnsupportedReason() above. */
export async function isLocalEmbeddingSupported(): Promise<boolean> {
	return (await getLocalEmbeddingUnsupportedReason()) === null
}

type ApiEmbeddingConfig = {
	baseUrl: string
	apiKey?: string | null
	model: string
	dimensions: number
}

// Singleton pipeline — loaded lazily, replaced on model change
let pipeline: FeatureExtractionPipeline | null = null
let loadedModelId: string | null = null
let isLoading = false
let loadError: string | null = null

let activeBackend: "local" | "api" | null = null
let apiConfig: ApiEmbeddingConfig | null = null

/** The composite identifier stored as embeddingModel for API-backed vectors — changes if either the endpoint or the model changes, so staleness detection (unmodified, model-string-based) catches both. */
export function buildApiModelId(baseUrl: string, model: string): string {
	return `api::${baseUrl}::${model}`
}

// TTL idle timer — unloads the model after N minutes of inactivity
let ttlMinutes = 5
let ttlTimer: ReturnType<typeof setTimeout> | null = null

export function setEmbeddingTtlMinutes(minutes: number) {
	ttlMinutes = minutes
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

	const modelDef = findModel(modelId)
	if (!modelDef) throw new Error(`Unknown embedding model: ${modelId}`)

	isLoading = true
	pipeline = null
	loadedModelId = null
	loadError = null
	apiConfig = null

	try {
		// Dynamic import keeps this out of the browser bundle entirely
		const { pipeline: createPipeline, env } = await import(
			"@huggingface/transformers"
		)

		// Store models inside the app data directory so they stay with
		// the rest of Serene Pub's data. TRANSFORMERS_CACHE can override.
		env.cacheDir =
			process.env.TRANSFORMERS_CACHE ??
			path.join(getAppDataDir(), "models", "embeddings")

		onProgress?.({ modelId, status: "loading" })

		pipeline = (await createPipeline("feature-extraction", modelId, {
			...(modelDef.dtype ? { dtype: modelDef.dtype } : {}),
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
 * Validate and activate an external OpenAI-compatible embeddings API as the
 * embedding backend. Issues one real test embed call before activating
 * anything — a config that fails validation never reaches the "ready"
 * state, so isModelReady() can't report true for a broken setup. Throws on
 * failure; callers should not persist the config unless this resolves.
 */
export async function activateApiEmbedding(
	config: { baseUrl: string; apiKey?: string | null; model: string },
	onProgress?: DownloadProgressCallback
): Promise<{ dimensions: number }> {
	if (isLoading) throw new Error("Model is already loading")

	const modelId = buildApiModelId(config.baseUrl, config.model)
	isLoading = true
	pipeline = null
	loadedModelId = null
	apiConfig = null
	loadError = null

	try {
		onProgress?.({ modelId, status: "loading" })

		const { OpenAI } = await import("openai")
		const client = new OpenAI({
			apiKey: config.apiKey || undefined,
			baseURL: config.baseUrl
		})

		const testResult = await client.embeddings.create({
			model: config.model,
			input: "test"
		})
		const dimensions = testResult.data[0]?.embedding?.length
		if (!dimensions) {
			throw new Error(
				"Embeddings API returned no vector data for the test request"
			)
		}

		apiConfig = { ...config, dimensions }
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

type ConfiguredEmbeddingTarget = {
	modelId: string
	mode: "local" | "api"
	ttlMinutes: number
	localModelName?: string
	apiBaseUrl?: string
	apiKey?: string | null
	apiModel?: string
}

/**
 * Reads systemSettings/vectorizationConfigs and reports what backend/model
 * WOULD be loaded, without loading anything — the single source of truth
 * for "what's configured," consumed by loadConfiguredEmbeddingModel() below
 * (the "bring it up for real" side) and by getConfiguredModelId() (the
 * "just tell me the identity, cheaply" side used by the vectorization
 * queue's peek-before-load check). Two cheap DB reads, no pipeline/API call.
 *
 * Returns null if vectorization is disabled or no model is chosen yet
 * (today's silent no-op case). Still throws for "API mode selected but
 * apiBaseUrl/apiModel missing" — that's a real misconfiguration, not
 * "nothing to do," and both callers below should hear about it (the queue's
 * peek catches this specific throw and treats it as null instead, so a
 * broken config doesn't spam every idle tick — see getConfiguredModelId()).
 */
export async function getConfiguredEmbeddingTarget(): Promise<ConfiguredEmbeddingTarget | null> {
	const { db } = await import("$lib/server/db")
	const { schema } = await import("$lib/server/db")
	const { eq } = await import("drizzle-orm")

	const settings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { vectorizationEnabled: true, embeddingModelName: true }
	})
	if (!settings?.vectorizationEnabled || !settings.embeddingModelName)
		return null

	const vecConfig = await db.query.vectorizationConfigs.findFirst({
		where: eq(schema.vectorizationConfigs.id, 1),
		columns: {
			embeddingModelTtlMinutes: true,
			mode: true,
			apiBaseUrl: true,
			apiKey: true,
			apiKeyIv: true,
			apiKeyAuthTag: true,
			apiModel: true
		}
	})
	const ttlMinutes = vecConfig?.embeddingModelTtlMinutes ?? 5

	if (vecConfig?.mode === "api") {
		if (!vecConfig.apiBaseUrl || !vecConfig.apiModel) {
			throw new Error(
				"API vectorization is enabled but not fully configured"
			)
		}
		return {
			modelId: buildApiModelId(vecConfig.apiBaseUrl, vecConfig.apiModel),
			mode: "api",
			ttlMinutes,
			apiBaseUrl: vecConfig.apiBaseUrl,
			apiKey: resolveVectorizationApiKey(vecConfig),
			apiModel: vecConfig.apiModel
		}
	}
	return {
		modelId: settings.embeddingModelName,
		mode: "local",
		ttlMinutes,
		localModelName: settings.embeddingModelName
	}
}

/**
 * Cheap projection of getConfiguredEmbeddingTarget() for the vectorization
 * queue's peek-before-load check (see runQueue() in vectorizationQueue.ts)
 * — just the identity string pickNextItem() needs to check for pending
 * work, without paying any load cost. Unlike the loader below, an
 * incomplete API config is reported as "nothing to load" (null) rather than
 * thrown — a queue peek shouldn't surface a config error on every idle
 * tick; that error still surfaces normally once real work exists and a real
 * load is attempted (or via a manual trigger).
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
export async function loadConfiguredEmbeddingModel(): Promise<void> {
	const target = await getConfiguredEmbeddingTarget()
	if (!target) return

	// Load TTL config before loading the model so the timer starts correctly.
	setEmbeddingTtlMinutes(target.ttlMinutes)

	if (target.mode === "api") {
		await activateApiEmbedding({
			baseUrl: target.apiBaseUrl!,
			apiKey: target.apiKey,
			model: target.apiModel!
		})
	} else {
		await loadEmbeddingModel(target.localModelName!)
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
	apiConfig = null
	activeBackend = null
	loadError = null
	console.log(`[embedding] Model unloaded${reason ? ` ${reason}` : ""}`)
}

/** Returns the currently active model/API identifier, or null if none is active */
export function getLoadedModelId(): string | null {
	return loadedModelId
}

/**
 * True if the active backend (local pipeline or external API) is loaded
 * and validated, ready to embed. False for a merely "enabled" but
 * unconfigured/unvalidated/failed state — callers (notably the RAG
 * availability gate in promptBuilder/index.ts) rely on this distinction to
 * skip RagInfillEngine rather than surface broken/empty RAG context.
 */
export function isModelReady(): boolean {
	if (activeBackend === "local")
		return pipeline !== null && loadedModelId !== null
	if (activeBackend === "api")
		return apiConfig !== null && loadedModelId !== null
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
 * Check whether a model's files are present in the local cache without
 * loading it into memory. Returns true if the model directory exists and
 * contains at least one file, false if the cache appears empty or missing.
 */
export async function isModelCached(modelId: string): Promise<boolean> {
	try {
		const { env } = await import("@huggingface/transformers")
		const cacheDir =
			process.env.TRANSFORMERS_CACHE ??
			path.join(getAppDataDir(), "models", "embeddings")

		// @huggingface/transformers caches under {cacheDir}/models--{org}--{name}/
		const safeName = modelId.replace(/\//g, "--")
		const modelCacheDir = path.join(cacheDir, `models--${safeName}`)

		const { readdir } = await import("fs/promises")
		const entries = await readdir(modelCacheDir)
		return entries.length > 0
	} catch {
		return false
	}
}

/**
 * Embed a single text string. Returns a float array.
 * Throws if no backend is active.
 */
export async function embed(text: string): Promise<number[]> {
	if (activeBackend === "api" && apiConfig) {
		const [vector] = await apiEmbed([text], apiConfig)
		resetTtlTimer()
		return vector
	}
	if (!pipeline) throw new Error("No embedding model loaded")
	const result = await pipeline(text, { pooling: "mean", normalize: true })
	resetTtlTimer()
	return Array.from(result.data as Float32Array)
}

/**
 * Embed multiple strings. More efficient than calling embed() in a loop
 * when the backend supports batching (both do: transformers.js pipelines
 * natively, the API backend via a single /embeddings call with an array
 * input, per the OpenAI-compatible spec).
 */
export async function batchEmbed(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return []

	if (activeBackend === "api" && apiConfig) {
		const vectors = await apiEmbed(texts, apiConfig)
		resetTtlTimer()
		return vectors
	}

	if (!pipeline) throw new Error("No embedding model loaded")
	const results = await pipeline(texts, { pooling: "mean", normalize: true })
	resetTtlTimer()
	// When given an array, result.data is a flat Float32Array of all embeddings
	const flat = Array.from(results.data as Float32Array)
	const dims = flat.length / texts.length
	return texts.map((_, i) => flat.slice(i * dims, (i + 1) * dims))
}

/** Calls the configured OpenAI-compatible /embeddings endpoint, ordering results by the API's own index field rather than trusting response order. */
async function apiEmbed(
	texts: string[],
	config: ApiEmbeddingConfig
): Promise<number[][]> {
	const { OpenAI } = await import("openai")
	const client = new OpenAI({
		apiKey: config.apiKey || undefined,
		baseURL: config.baseUrl
	})
	const result = await client.embeddings.create({
		model: config.model,
		input: texts
	})
	return [...result.data]
		.sort((a, b) => a.index - b.index)
		.map((item) => item.embedding)
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
