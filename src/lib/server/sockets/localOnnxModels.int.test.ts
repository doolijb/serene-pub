/**
 * The four local ONNX model handlers: who may call them, what they refuse, and
 * what a restart does to a download that was in flight.
 *
 * ⚠ No real download happens here. Warming the cache means calling
 * `pipeline()`, which fetches several hundred megabytes from the Hub — so what
 * is under test is every path that decides WHETHER to start one, plus the
 * validation in front of `addHubModel`. `fetch` is stubbed throughout: the
 * recommended list is answered from a fixture, and each Hub request is answered
 * by the test that needs it.
 *
 * `@huggingface/transformers` is stood in for, so the local ONNX probe answers
 * "loads" on every machine this runs on, and so a case can prove nothing
 * reached `pipeline()`. The one machine that cannot run the runtime is made
 * the honest way: `SERENE_PUB_PLATFORM=android`, which the probe reads first.
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { EMBEDDING_CAPABILITY } from "$lib/shared/constants/embeddings"

vi.mock("$lib/server/db", async (orig) => {
	// `...actual` and not `{ db }` alone: `connections.ts` reaches
	// `tokenCrypto` → `getCryptoSecretKey`, and an auth module reads it at
	// module scope, so a mock that returns only `db` crashes the import graph
	// before a single assertion runs.
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

/**
 * transformers.js, as the download calls it: the config, the pipeline's file
 * list and each file's size, then the task's model class and the tokenizer —
 * every one handed `cache_dir`. `pipeline` is here only to prove nothing
 * calls it: its file discovery ignores `cache_dir`.
 */
const { transformers } = vi.hoisted(() => {
	const model = { dispose: vi.fn(async () => {}) }
	return {
		transformers: {
			pipeline: vi.fn(),
			AutoConfig: {
				from_pretrained: vi.fn(async () => ({ model_type: "bert" }))
			},
			ModelRegistry: {
				get_pipeline_files: vi.fn(async () => [
					"config.json",
					"onnx/model.onnx",
					"tokenizer.json",
					"tokenizer_config.json"
				]),
				get_file_metadata: vi.fn(async () => ({
					exists: true,
					size: 100
				}))
			},
			AutoModel: { from_pretrained: vi.fn(async (..._: any[]) => model) },
			AutoModelForTokenClassification: {
				from_pretrained: vi.fn(async (..._: any[]) => model)
			},
			AutoTokenizer: {
				from_pretrained: vi.fn(async (..._: any[]) => ({}))
			},
			model
		}
	}
})
vi.mock("@huggingface/transformers", () => transformers)

/** Every transformers.js call a download makes, cleared. */
function clearTransformers() {
	for (const fn of [
		transformers.pipeline,
		transformers.AutoConfig.from_pretrained,
		transformers.ModelRegistry.get_pipeline_files,
		transformers.ModelRegistry.get_file_metadata,
		transformers.AutoModel.from_pretrained,
		transformers.AutoModelForTokenClassification.from_pretrained,
		transformers.AutoTokenizer.from_pretrained,
		transformers.model.dispose
	])
		fn.mockClear()
}

let testDb: TestDb
let dataDir: string

const EMBEDDINGS_YAML = `
models:
  - id: Xenova/all-MiniLM-L6-v2
    name: all-MiniLM-L6-v2
    dtype: q8
    size: 24
    dimensions: 384
    max_input_tokens: 256
    pooling: mean
    tier: fast
    details:
      description: "The smallest model that still works."
`

const admin = () => ({ user: { id: 1, isAdmin: true } }) as any
const plebeian = () => ({ user: { id: 2, isAdmin: false } }) as any
const noop = () => {}

/** Every emit, so a refusal's `:error` twin can be asserted. */
function recorder() {
	const emitted: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => {
		emitted.push({ event, data })
	}
	return { emitted, emit }
}

type HubAnswer = {
	ok: boolean
	status?: number
	body?: any
	text?: string
}

/** What each URL answers. The list URLs always answer the fixture. */
let hubAnswers: (url: string) => HubAnswer

function stubFetch() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: any) => {
			const u = String(url)
			if (u.includes("serene-pub-onnx-list"))
				return {
					ok: true,
					status: 200,
					text: async () =>
						u.endsWith("ner.yaml") ? "models: []" : EMBEDDINGS_YAML
				} as any
			const answer = hubAnswers(u)
			return {
				ok: answer.ok,
				status: answer.status ?? (answer.ok ? 200 : 404),
				json: async () => {
					if (answer.body === undefined) throw new Error("not json")
					return answer.body
				},
				text: async () => answer.text ?? ""
			} as any
		})
	)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-onnx-handlers-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

beforeEach(async () => {
	hubAnswers = () => ({ ok: false, status: 404, body: { error: "unset" } })
	stubFetch()
	const { resetRecommendedLists } = await import(
		"$lib/server/localModels/onnxList"
	)
	const { clearCachedScans, clearDownloads } = await import(
		"$lib/server/localModels/onnxCache"
	)
	resetRecommendedLists()
	clearCachedScans()
	clearDownloads()
	await testDb.delete(schema.connectionDefaults)
	await testDb.delete(schema.localModels)
	await testDb.delete(schema.connectionModels)
	await testDb.delete(schema.connections)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

async function makeEndpoint(type: string, model = "Xenova/all-MiniLM-L6-v2") {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name: `fixture ${Math.random()}`,
			type,
			modality:
				type === CONNECTION_TYPE.LOCAL_ONNX_NER ? "ner" : "embeddings",
			extraJson: {}
		} as any)
		.returning()
	const [row] = await testDb
		.insert(schema.connectionModels)
		.values({ connectionId: conn.id, model, name: model })
		.returning()
	return { conn, row }
}

const handlers = () => import("./localOnnxModels")

describe("who may call these", () => {
	it("refuses a non-admin on every handler, and says why", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		const h = await handlers()
		for (const [handler, params] of [
			[h.connectionsDownloadModel, { id: conn.id, modelId: row.id }],
			[
				h.connectionsCancelModelDownload,
				{ id: conn.id, modelId: row.id }
			],
			[h.connectionsRemoveModelFiles, { id: conn.id, modelId: row.id }],
			[h.connectionsAddHubModel, { id: conn.id, hubId: "a/b" }]
		] as const) {
			const { emitted, emit } = recorder()
			const res: any = await (handler as any).handler(
				plebeian(),
				params,
				emit
			)
			expect(res.error).toContain("Only admin users")
			expect(emitted[0].event).toBe(`${handler.event}:error`)
		}
	}, 60_000)
})

describe("an endpoint whose models are not on this machine", () => {
	it("is refused with a sentence naming what does apply", async () => {
		const [conn] = await testDb
			.insert(schema.connections)
			.values({
				name: "A host",
				type: CONNECTION_TYPE.OLLAMA,
				modality: "text-gen",
				baseUrl: "http://localhost:11434",
				extraJson: {}
			} as any)
			.returning()
		const [row] = await testDb
			.insert(schema.connectionModels)
			.values({ connectionId: conn.id, model: "llama3.1:8b", name: "l" })
			.returning()

		const h = await handlers()
		const { emitted, emit } = recorder()
		const res = await h.connectionsDownloadModel.handler(
			admin(),
			{ id: conn.id, modelId: row.id },
			emit
		)
		expect(res.error).toBe(
			"Models on A host are managed by its host; downloading applies to local ONNX connections only."
		)
		expect(emitted[0].event).toBe("connections:downloadModel:error")

		// The same refusal from every one of the four.
		for (const handler of [
			h.connectionsCancelModelDownload,
			h.connectionsRemoveModelFiles
		]) {
			const out: any = await handler.handler(
				admin(),
				{ id: conn.id, modelId: row.id },
				noop
			)
			expect(out.error).toContain("managed by its host")
		}
		const added: any = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId: "org/name" },
			noop
		)
		expect(added.error).toContain("managed by its host")
	}, 60_000)
})

describe("removing a model's files", () => {
	it("refuses the model the capability default names", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(testDb as any, EMBEDDING_CAPABILITY, {
			connectionId: conn.id,
			connectionModelId: row.id
		})

		const h = await handlers()
		const { emitted, emit } = recorder()
		const res = await h.connectionsRemoveModelFiles.handler(
			admin(),
			{ id: conn.id, modelId: row.id },
			emit
		)
		expect(res.error).toBe(
			"The active model can't be removed from disk. Make another model active first."
		)
		expect(emitted[0].event).toBe("connections:removeModelFiles:error")
	}, 60_000)

	it("refuses while a download for that model is in flight", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		const { claimDownload, clearDownloads } = await import(
			"$lib/server/localModels/onnxCache"
		)
		claimDownload({
			modality: "embeddings",
			modelId: row.model,
			connectionId: conn.id,
			connectionModelId: row.id
		})
		const h = await handlers()
		const res = await h.connectionsRemoveModelFiles.handler(
			admin(),
			{ id: conn.id, modelId: row.id },
			noop
		)
		expect(res.error).toBe(
			"That model is downloading. Cancel the download first."
		)
		clearDownloads()
	}, 60_000)

	it("removes the files and the registry row but keeps the model row", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		const { cacheDirFor, clearCachedScans, modelDirFor } = await import(
			"$lib/server/localModels/onnxCache"
		)
		const dir = modelDirFor(row.model, "embeddings")!
		await fs.mkdir(path.join(dir, "onnx"), { recursive: true })
		await fs.writeFile(path.join(dir, "onnx", "m.onnx"), Buffer.alloc(16))
		clearCachedScans()
		await testDb.insert(schema.localModels).values({
			filename: row.model,
			modelName: row.model,
			format: "onnx",
			modality: "embeddings",
			status: "complete"
		} as any)

		const h = await handlers()
		const res = await h.connectionsRemoveModelFiles.handler(
			admin(),
			{ id: conn.id, modelId: row.id },
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.local.state).toBe("not_downloaded")
		await expect(fs.stat(dir)).rejects.toThrow()
		expect(await testDb.select().from(schema.localModels)).toHaveLength(0)
		// ⚠ The connection_models row stays — a catalogue model comes straight
		// back on the next sync, and a user-added one must not vanish because
		// somebody freed disk.
		expect(
			await testDb
				.select()
				.from(schema.connectionModels)
				.where(eq(schema.connectionModels.id, row.id))
		).toHaveLength(1)
		expect(cacheDirFor("embeddings")).toContain(dataDir)
	}, 60_000)
})

describe("adding a model by Hub id", () => {
	const hubId = "some-org/some-model"

	it("refuses an id that is not org/name", async () => {
		const { conn } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		const h = await handlers()
		const res = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId: "not a model id" },
			noop
		)
		expect(res.error).toBe(
			"A Hugging Face model id looks like `organisation/model-name`."
		)
	}, 60_000)

	it("passes the Hub's own sentence through on a 404", async () => {
		const { conn } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		hubAnswers = () => ({
			ok: false,
			status: 404,
			body: { error: "Repository not found" }
		})
		const h = await handlers()
		const { emitted, emit } = recorder()
		const res = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId },
			emit
		)
		expect(res.error).toBe(`${hubId}: Repository not found`)
		expect(emitted[0].event).toBe("connections:addHubModel:error")
	}, 60_000)

	it("refuses a repo with no ONNX export", async () => {
		const { conn } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		hubAnswers = () => ({
			ok: true,
			body: {
				siblings: [
					{ rfilename: "config.json" },
					{ rfilename: "pytorch_model.bin" }
				]
			}
		})
		const h = await handlers()
		const res = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId },
			noop
		)
		expect(res.error).toContain("has no ONNX export")
	}, 60_000)

	it("refuses an embedding model whose config publishes no hidden size", async () => {
		const { conn } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		hubAnswers = (url) =>
			url.includes("/api/models/")
				? {
						ok: true,
						body: {
							siblings: [{ rfilename: "onnx/model.onnx" }]
						}
					}
				: { ok: true, body: { model_type: "bert" } }
		const h = await handlers()
		const res = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId },
			noop
		)
		expect(res.error).toContain("publishes no hidden size")
		expect(
			await testDb.select().from(schema.connectionModels)
		).toHaveLength(1)
	}, 60_000)

	it("creates the row, with the width read off config.json", async () => {
		const { conn } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		hubAnswers = (url) =>
			url.includes("/api/models/")
				? {
						ok: true,
						body: {
							private: false,
							siblings: [
								{ rfilename: "config.json" },
								{ rfilename: "onnx/model_quantized.onnx" }
							]
						}
					}
				: {
						ok: true,
						body: {
							hidden_size: 1024,
							max_position_embeddings: 8192
						}
					}
		const h = await handlers()
		const res = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId, dtype: "q8" },
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.created?.model).toBe(hubId)
		expect(res.created?.name).toBe("some-model")
		expect(res.created?.local).toMatchObject({
			state: "not_downloaded",
			addedByUser: true,
			catalog: { dimensions: 1024, maxInputTokens: 8192 }
		})
		const [created] = await testDb
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.model, hubId))
		expect((created.extraJson as any).onnx).toMatchObject({
			addedByUser: true,
			dtype: "q8",
			hub: { dimensions: 1024, maxInputTokens: 8192 }
		})

		// A second add of the same id is refused rather than duplicated.
		const again = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId },
			noop
		)
		expect(again.error).toBe(
			`${hubId} is already listed on this connection.`
		)
	}, 60_000)

	it("reads an entity model's labels out of id2label", async () => {
		const { conn } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_NER,
			"Xenova/bert-base-NER"
		)
		hubAnswers = (url) =>
			url.includes("/api/models/")
				? {
						ok: true,
						body: { siblings: [{ rfilename: "onnx/m.onnx" }] }
					}
				: {
						ok: true,
						body: {
							id2label: {
								"0": "O",
								"1": "B-PER",
								"2": "I-PER",
								"3": "B-LOC"
							}
						}
					}
		const h = await handlers()
		const res = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId },
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.created?.local?.catalog?.labels).toEqual(["PER", "LOC"])
	}, 60_000)
})

describe("on a machine that can't run local ONNX models", () => {
	beforeEach(() => {
		process.env.SERENE_PUB_PLATFORM = "android"
		clearTransformers()
	})
	afterEach(() => {
		delete process.env.SERENE_PUB_PLATFORM
	})

	it("refuses a download with the machine's reason, before claiming or importing anything", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		const h = await handlers()
		const { emitted, emit } = recorder()
		const res = await h.connectionsDownloadModel.handler(
			admin(),
			{ id: conn.id, modelId: row.id },
			emit
		)
		expect(res.error).toMatch(
			/^Local ONNX models aren't available on this machine: .*Android/
		)
		expect(res.local.state).toBe("not_downloaded")
		expect(emitted[0]).toEqual({
			event: "connections:downloadModel:error",
			data: { error: res.error }
		})
		const { activeDownload } = await import(
			"$lib/server/localModels/onnxCache"
		)
		expect(activeDownload("embeddings", row.model)).toBeUndefined()
		expect(await testDb.select().from(schema.localModels)).toEqual([])
		expect(transformers.AutoConfig.from_pretrained).not.toHaveBeenCalled()
		expect(transformers.pipeline).not.toHaveBeenCalled()
	}, 60_000)

	it("refuses adding a model by Hub id before asking the Hub", async () => {
		const { conn } = await makeEndpoint(CONNECTION_TYPE.LOCAL_ONNX_NER)
		const h = await handlers()
		const { emitted, emit } = recorder()
		const res: any = await h.connectionsAddHubModel.handler(
			admin(),
			{ id: conn.id, hubId: "some-org/some-model" },
			emit
		)
		expect(res.error).toMatch(/aren't available on this machine/)
		expect(emitted[0].event).toBe("connections:addHubModel:error")
		const asked = (fetch as any).mock.calls.map((c: any[]) => String(c[0]))
		expect(
			asked.filter((u: string) => u.includes("huggingface.co"))
		).toEqual([])
	}, 60_000)

	it("refuses creating a local ONNX connection, and only that", async () => {
		const { connectionsCreate } = await import("./connections")
		for (const type of [
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			CONNECTION_TYPE.LOCAL_ONNX_NER
		]) {
			const { emitted, emit } = recorder()
			await expect(
				connectionsCreate.handler(
					admin(),
					{ connection: { name: `Local ${type}`, type } as any },
					emit
				)
			).rejects.toThrow(/aren't available on this machine/)
			expect(emitted[0].event).toBe("connections:create:error")
		}
		expect(await testDb.select().from(schema.connections)).toEqual([])

		// Any other type is none of this gate's business.
		const res = await connectionsCreate.handler(
			admin(),
			{
				connection: {
					name: "Hosted embeddings",
					type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
					baseUrl: "https://embed.test/v1"
				} as any
			},
			noop
		)
		expect(res.connection.type).toBe(CONNECTION_TYPE.OPENAI_EMBEDDINGS)
	}, 60_000)

	it("still removes files that are already here", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		)
		const h = await handlers()
		const res: any = await h.connectionsRemoveModelFiles.handler(
			admin(),
			{ id: conn.id, modelId: row.id },
			noop
		)
		expect(res.error ?? "").not.toMatch(/aren't available/)
	}, 60_000)
})

describe("downloading a model", () => {
	beforeEach(() => clearTransformers())

	async function download(conn: { id: number }, row: { id: number }) {
		const h = await handlers()
		await h.connectionsDownloadModel.handler(
			admin(),
			{ id: conn.id, modelId: row.id },
			noop
		)
	}

	/**
	 * A Hub-added model's precision lives on its model row, which only the
	 * download reads. Recorded on the registry row (`local_models.
	 * quantization`), it is what both loaders read back (`registeredNerModel`,
	 * `registeredEmbeddingModel`), so the load asks for the weights file this
	 * fetched rather than the runtime's default.
	 */
	it("records the precision it downloads on the registry row", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_NER,
			"some-org/hand-added-ner"
		)
		await testDb
			.update(schema.connectionModels)
			.set({ extraJson: { onnx: { addedByUser: true, dtype: "fp16" } } })
			.where(eq(schema.connectionModels.id, row.id))

		await download(conn, row)
		const { activeDownload } = await import(
			"$lib/server/localModels/onnxCache"
		)
		await activeDownload("ner", row.model)?.settled

		const fetched =
			transformers.AutoModelForTokenClassification.from_pretrained.mock
				.lastCall
		expect(fetched?.[0]).toBe(row.model)
		expect(fetched?.[1]).toMatchObject({ dtype: "fp16" })
		expect(
			transformers.ModelRegistry.get_pipeline_files.mock.lastCall
		).toMatchObject(["token-classification", row.model, { dtype: "fp16" }])
		const [registered] = await testDb
			.select()
			.from(schema.localModels)
			.where(eq(schema.localModels.filename, row.model))
		expect(registered).toMatchObject({
			modality: "ner",
			quantization: "fp16",
			status: "complete"
		})
	}, 60_000)

	/**
	 * Every file lands under its OWN modality's directory. `pipeline()` read
	 * `config.json` with no cache directory while deciding which files to
	 * fetch, so it landed in `env.cacheDir` — the embedding lane's — and an
	 * entity model's download left a stray there. Each step is now handed
	 * `cache_dir`, and `pipeline()` is not called at all.
	 */
	it.each([
		[
			CONNECTION_TYPE.LOCAL_ONNX_NER,
			"ner",
			"AutoModelForTokenClassification"
		],
		[CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, "embeddings", "AutoModel"]
	] as const)(
		"a %s download writes only under its own cache directory",
		async (type, modality, modelClass) => {
			const { conn, row } = await makeEndpoint(type, "Xenova/some-model")
			await download(conn, row)
			const { activeDownload, cacheDirFor } = await import(
				"$lib/server/localModels/onnxCache"
			)
			await activeDownload(modality, row.model)?.settled
			const dir = cacheDirFor(modality)

			expect(transformers.pipeline).not.toHaveBeenCalled()
			expect(
				transformers.AutoConfig.from_pretrained
			).toHaveBeenCalledWith(row.model, { cache_dir: dir })
			for (const [, , options] of transformers.ModelRegistry
				.get_file_metadata.mock.calls as any[])
				expect(options).toEqual({ cache_dir: dir })
			expect(
				(transformers as any)[modelClass].from_pretrained.mock
					.lastCall?.[1]
			).toMatchObject({ cache_dir: dir })
			expect(
				transformers.AutoTokenizer.from_pretrained.mock.lastCall?.[1]
			).toMatchObject({ cache_dir: dir })
			// A download loads nothing into a lane: what it built is freed.
			expect(transformers.model.dispose).toHaveBeenCalledTimes(1)
		},
		60_000
	)

	/**
	 * One bar across every file, sized up front: the model class's own
	 * `progress_total` covers its files only, so it is ignored, and the
	 * tokenizer's bytes count too.
	 */
	it("reports one percentage across the model and the tokenizer", async () => {
		const { conn, row } = await makeEndpoint(
			CONNECTION_TYPE.LOCAL_ONNX_NER,
			"Xenova/slow-model"
		)
		let finish!: () => void
		let report!: (event: any) => void
		const reached = new Promise<void>((started) => {
			transformers.AutoModelForTokenClassification.from_pretrained.mockImplementationOnce(
				async (_id: string, options: any) => {
					report = options.progress_callback
					started()
					await new Promise<void>((done) => (finish = done))
					return transformers.model
				}
			)
		})
		await download(conn, row)
		await reached
		const { activeDownload } = await import(
			"$lib/server/localModels/onnxCache"
		)
		const live = activeDownload("ner", row.model)!

		// Four files of 100 bytes; `config.json` already counts as fetched.
		report({
			status: "progress",
			file: "tokenizer.json",
			loaded: 100,
			total: 100
		})
		report({
			status: "progress",
			file: "onnx/model.onnx",
			loaded: 50,
			total: 100
		})
		expect(live.percent).toBe(63)
		expect(live.downloadedBytes).toBe(250)
		expect(live.totalBytes).toBe(400)
		report({ status: "progress_total", progress: 10, loaded: 1, total: 10 })
		expect(live.percent).toBe(63)

		finish()
		await live.settled
	}, 60_000)
})

describe("a restart during a download", () => {
	it("settles every stale `downloading` row to an error naming the restart", async () => {
		await testDb.insert(schema.localModels).values([
			{
				filename: "Xenova/interrupted",
				modelName: "Xenova/interrupted",
				format: "onnx",
				modality: "embeddings",
				status: "downloading"
			},
			{
				filename: "Xenova/finished",
				modelName: "Xenova/finished",
				format: "onnx",
				modality: "embeddings",
				status: "complete"
			},
			// A gguf mid-download is KoboldCPP's business, not this sweep's.
			{
				filename: "some-llm.gguf",
				modelName: "some-llm",
				format: "gguf",
				modality: "text-gen",
				status: "downloading"
			}
		] as any)

		const h = await handlers()
		await h.reconcileOnnxDownloadsOnBoot()

		const rows = await testDb.select().from(schema.localModels)
		const by = (f: string) => rows.find((r) => r.filename === f)!
		expect(by("Xenova/interrupted").status).toBe("error")
		expect(by("Xenova/interrupted").errorMessage).toBe(
			"Download interrupted by a restart"
		)
		expect(by("Xenova/finished").status).toBe("complete")
		expect(by("some-llm.gguf").status).toBe("downloading")
	}, 60_000)
})
