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
