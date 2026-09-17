/**
 * Disk state: where the weights are, whether they are there, and the four
 * states one `connection_models` row can be in.
 *
 * ⚠ No database and no network. `localModelState` is handed every dependency it
 * would otherwise fetch, which is what the `deps` parameter is for — the
 * derivation itself is the thing under test, not the queries feeding it.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	cacheDirFor,
	claimDownload,
	clearCachedScans,
	clearDownloads,
	dirSizeBytes,
	isCached,
	localModelState,
	modelDirFor,
	onnxModalityOf,
	releaseDownload,
	removeCached,
	type LocalModelStateDeps
} from "./onnxCache"

const MODEL = "Xenova/test-embed"
const originalDataDir = process.env.SERENE_PUB_DATA_DIR
const dirs: string[] = []

const embeddingsEndpoint = { type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS }
const row = (extraJson: Record<string, any> | null = null) => ({
	model: MODEL,
	extraJson
})

const catalogOnly = (): LocalModelStateDeps => ({
	loadedModelId: null,
	registry: new Map(),
	// 24 MB, as the list publishes it.
	catalog: new Map([[MODEL, { sizeMb: 24, dimensions: 384 }]])
})

/** Put weights on disk where transformers.js would put them. */
async function writeWeights(bytes = 2048) {
	const dir = modelDirFor(MODEL, "embeddings")!
	await fs.mkdir(path.join(dir, "onnx"), { recursive: true })
	await fs.writeFile(path.join(dir, "config.json"), "{}")
	await fs.writeFile(
		path.join(dir, "onnx", "model_quantized.onnx"),
		Buffer.alloc(bytes)
	)
	clearCachedScans()
	return dir
}

beforeEach(async () => {
	const dir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-onnx-cache-")
	)
	dirs.push(dir)
	process.env.SERENE_PUB_DATA_DIR = dir
	delete process.env.TRANSFORMERS_CACHE
	clearCachedScans()
	clearDownloads()
})

afterEach(() => {
	clearDownloads()
})

afterAll(async () => {
	if (originalDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = originalDataDir
	for (const dir of dirs)
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("the cache directory", () => {
	it("is the lane's own subdirectory under the app data directory", () => {
		expect(cacheDirFor("embeddings")).toBe(
			path.join(process.env.SERENE_PUB_DATA_DIR!, "models", "embeddings")
		)
		expect(cacheDirFor("ner")).toBe(
			path.join(process.env.SERENE_PUB_DATA_DIR!, "models", "ner")
		)
	})

	it("is overridden by TRANSFORMERS_CACHE for both lanes", () => {
		process.env.TRANSFORMERS_CACHE = "/somewhere/else"
		expect(cacheDirFor("embeddings")).toBe("/somewhere/else")
		expect(cacheDirFor("ner")).toBe("/somewhere/else")
		delete process.env.TRANSFORMERS_CACHE
	})

	it("lays a repo out as <org>/<name>, not models--org--name", () => {
		expect(modelDirFor(MODEL, "embeddings")).toBe(
			path.join(cacheDirFor("embeddings"), "Xenova", "test-embed")
		)
	})

	it("refuses an id that would escape the cache root", () => {
		expect(modelDirFor("../../etc", "embeddings")).toBeNull()
		expect(modelDirFor("Xenova/../../etc", "embeddings")).toBeNull()
		expect(modelDirFor("", "embeddings")).toBeNull()
	})

	it("recognises only the two local ONNX types", () => {
		expect(onnxModalityOf(CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS)).toBe(
			"embeddings"
		)
		expect(onnxModalityOf(CONNECTION_TYPE.LOCAL_ONNX_NER)).toBe("ner")
		expect(onnxModalityOf(CONNECTION_TYPE.OLLAMA)).toBeNull()
	})
})

describe("what is on disk", () => {
	it("is false with nothing there, and true once weights are", async () => {
		expect(await isCached(MODEL, "embeddings")).toBe(false)
		await writeWeights()
		expect(await isCached(MODEL, "embeddings")).toBe(true)
		expect(await dirSizeBytes(MODEL, "embeddings")).toBeGreaterThan(2000)
	})

	it("does not call a config-only directory cached", async () => {
		// What an interrupted download leaves: a directory that is not empty
		// and cannot be loaded.
		const dir = modelDirFor(MODEL, "embeddings")!
		await fs.mkdir(dir, { recursive: true })
		await fs.writeFile(path.join(dir, "config.json"), "{}")
		clearCachedScans()
		expect(await isCached(MODEL, "embeddings")).toBe(false)
	})

	it("removes the directory and forgets it", async () => {
		const dir = await writeWeights()
		expect(await removeCached(MODEL, "embeddings")).toBe(true)
		await expect(fs.stat(dir)).rejects.toThrow()
		expect(await isCached(MODEL, "embeddings")).toBe(false)
	})
})

describe("the derived state", () => {
	it("is not_downloaded with the list's size when nothing is there", async () => {
		const state = await localModelState(
			null as any,
			embeddingsEndpoint,
			row(),
			catalogOnly()
		)
		expect(state).toMatchObject({
			state: "not_downloaded",
			sizeBytes: 24_000_000,
			loaded: false,
			addedByUser: false
		})
		expect(state!.catalog).toMatchObject({ dimensions: 384 })
	})

	it("is on_disk with the MEASURED size once the weights are there", async () => {
		await writeWeights(4096)
		const state = await localModelState(
			null as any,
			embeddingsEndpoint,
			row(),
			catalogOnly()
		)
		expect(state!.state).toBe("on_disk")
		// Measured, not the list's 24 MB.
		expect(state!.sizeBytes).toBeGreaterThan(4000)
		expect(state!.sizeBytes).toBeLessThan(24_000_000)
	})

	it("is error when the registry row failed, even with partial files there", async () => {
		await writeWeights()
		const state = await localModelState(
			null as any,
			embeddingsEndpoint,
			row(),
			{
				...catalogOnly(),
				registry: new Map([
					[
						MODEL,
						{
							status: "error",
							errorMessage: "Download interrupted by a restart",
							sizeBytes: null
						}
					]
				])
			}
		)
		expect(state!.state).toBe("error")
		expect(state!.error).toBe("Download interrupted by a restart")
	})

	it("is downloading while this process has one, with no error on a cancel", async () => {
		const { download } = claimDownload({
			modality: "embeddings",
			modelId: MODEL,
			connectionId: 1,
			connectionModelId: 2
		})
		download.percent = 42
		download.downloadedBytes = 10
		download.totalBytes = 100
		// A cancel that has been REQUESTED but not settled still reads as a
		// download in progress — nothing has failed and nothing has stopped.
		download.cancelled = true

		const state = await localModelState(
			null as any,
			embeddingsEndpoint,
			row(),
			catalogOnly()
		)
		expect(state).toMatchObject({
			state: "downloading",
			percent: 42,
			downloadedBytes: 10,
			totalBytes: 100,
			error: null
		})
		releaseDownload(download)
	})

	it("claims one download per model and hands the second caller the first", () => {
		const first = claimDownload({
			modality: "embeddings",
			modelId: MODEL,
			connectionId: 1,
			connectionModelId: 2
		})
		const second = claimDownload({
			modality: "embeddings",
			modelId: MODEL,
			connectionId: 1,
			connectionModelId: 2
		})
		expect(first.claimed).toBe(true)
		expect(second.claimed).toBe(false)
		expect(second.download).toBe(first.download)
		// The same id in the OTHER lane is a different file in a different
		// directory, so it is a different download.
		const ner = claimDownload({
			modality: "ner",
			modelId: MODEL,
			connectionId: 1,
			connectionModelId: 2
		})
		expect(ner.claimed).toBe(true)
	})

	it("reports loaded only for the model the lane holds", async () => {
		const loaded = await localModelState(
			null as any,
			embeddingsEndpoint,
			row(),
			{ ...catalogOnly(), loadedModelId: MODEL }
		)
		expect(loaded!.loaded).toBe(true)
		const other = await localModelState(
			null as any,
			embeddingsEndpoint,
			row(),
			{ ...catalogOnly(), loadedModelId: "someone/else" }
		)
		expect(other!.loaded).toBe(false)
	})

	it("reads addedByUser and the hub catalogue off the row", async () => {
		const state = await localModelState(
			null as any,
			embeddingsEndpoint,
			row({
				onnx: {
					addedByUser: true,
					hub: { dimensions: 1024, maxInputTokens: 8192 }
				}
			}),
			{ loadedModelId: null, registry: new Map(), catalog: new Map() }
		)
		expect(state!.addedByUser).toBe(true)
		expect(state!.catalog).toEqual({
			dimensions: 1024,
			maxInputTokens: 8192
		})
	})

	it("answers null for an endpoint that is not a local ONNX one", async () => {
		expect(
			await localModelState(
				null as any,
				{ type: CONNECTION_TYPE.OLLAMA },
				row(),
				catalogOnly()
			)
		).toBeNull()
	})
})
