/**
 * Embedding service — Node.js only.
 *
 * Wraps @huggingface/transformers to provide:
 *  - Model loading with progress callbacks
 *  - Single embed() and batchEmbed() API
 *  - Cosine similarity computed in-process (no pgvector required)
 *  - Modular: swap out the backend by replacing this module
 */

import type { FeatureExtractionPipeline } from "@huggingface/transformers"
import { findModel } from "./models"
import { getAppDataDir } from "$lib/server/utils"
import path from "path"

// Singleton pipeline — loaded lazily, replaced on model change
let pipeline: FeatureExtractionPipeline | null = null
let loadedModelId: string | null = null
let isLoading = false
let loadError: string | null = null

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
	ttlTimer = setTimeout(() => {
		ttlTimer = null
		unloadEmbeddingModel()
		console.log(`[embedding] Model unloaded after ${ttlMinutes}m idle`)
	}, ttlMinutes * 60 * 1000)
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
	if (loadedModelId === modelId && pipeline) return
	if (isLoading) throw new Error("Model is already loading")

	const modelDef = findModel(modelId)
	if (!modelDef) throw new Error(`Unknown embedding model: ${modelId}`)

	isLoading = true
	pipeline = null
	loadedModelId = null
	loadError = null

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

/** Unload the current model and free memory */
export function unloadEmbeddingModel(): void {
	if (ttlTimer) { clearTimeout(ttlTimer); ttlTimer = null }
	pipeline = null
	loadedModelId = null
	loadError = null
	console.log("[embedding] Model unloaded")
}

/** Returns the currently loaded model ID, or null if none is loaded */
export function getLoadedModelId(): string | null {
	return loadedModelId
}

/** True if a model is loaded and ready to embed */
export function isModelReady(): boolean {
	return pipeline !== null && loadedModelId !== null
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
 * Throws if no model is loaded.
 */
export async function embed(text: string): Promise<number[]> {
	if (!pipeline) throw new Error("No embedding model loaded")
	const result = await pipeline(text, { pooling: "mean", normalize: true })
	resetTtlTimer()
	return Array.from(result.data as Float32Array)
}

/**
 * Embed multiple strings. More efficient than calling embed() in a loop
 * when the pipeline supports batching.
 */
export async function batchEmbed(texts: string[]): Promise<number[][]> {
	if (!pipeline) throw new Error("No embedding model loaded")
	if (texts.length === 0) return []

	const results = await pipeline(texts, { pooling: "mean", normalize: true })
	resetTtlTimer()
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
	items: Array<T & { embedding: number[] | null; embeddingModel?: string | null }>,
	opts?: { topK?: number; modelId?: string }
): Array<T & { score: number }> {
	const scored = items
		.filter((item) => {
			if (item.embedding == null) return false
			if (opts?.modelId && item.embeddingModel !== opts.modelId) return false
			return true
		})
		.map((item) => ({
			...item,
			score: cosineSimilarity(queryEmbedding, item.embedding!)
		}))
		.sort((a, b) => b.score - a.score)

	return opts?.topK ? scored.slice(0, opts.topK) : scored
}
