/**
 * A local ONNX model can only be made active once its files are on this disk.
 *
 * Nothing fetches an ONNX model on use: the embeddings and entity lanes load
 * whatever is in the cache directory, so registering a model that is not
 * downloaded points every embed or scan at nothing. The capability view once
 * offered **Use** on every catalogue row, downloaded or not, and the handler
 * accepted it — this pins the server half of that fix, so no client (and no raw
 * socket call) can make the choice. On a machine whose ONNX runtime didn't
 * load, none can be made active at all.
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
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

let testDb: TestDb
let dataDir: string
let cacheDir: string

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

// Observed, not run: a successful embedding star restarts the queue, and
// running a real lane here would need an embedding backend.
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	stopVectorization: () => {},
	startVectorizationQueue: async () => {},
	clearVectorizationFailureTracking: () => {},
	clearInlineEmbedCooldown: () => {}
}))
vi.mock("$lib/server/embedding/index", async (orig) => {
	const actual = (await orig()) as any
	return { ...actual, unloadEmbeddingModel: () => {} }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-onnx-not-downloaded-")
	)
	cacheDir = path.join(dataDir, "transformers")
	process.env.SERENE_PUB_DATA_DIR = dataDir
	process.env.TRANSFORMERS_CACHE = cacheDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 } as any)
}, 60_000)

afterAll(async () => {
	delete process.env.TRANSFORMERS_CACHE
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socket = { user: { id: 1, isAdmin: true } } as any
const noop = () => {}

async function makeOnnxConnection(model: string) {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name: "Local embeddings (ONNX)",
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			modality: "embeddings",
			baseUrl: null,
			extraJson: {},
			capabilities: { resolved: { "text->embedding": 1 } }
		} as any)
		.returning()
	const [modelRow] = await testDb
		.insert(schema.connectionModels)
		.values({ connectionId: conn.id, model, name: model })
		.returning()
	return { connectionId: conn.id, modelId: modelRow.id }
}

async function setDefault(id: number, modelId: number) {
	const { connectionsSetDefault } = await import("./connections")
	return connectionsSetDefault.handler(
		socket,
		{ capability: "text->embedding", id, modelId } as any,
		noop
	)
}

async function registered() {
	return testDb.query.connectionDefaults.findFirst({
		where: (d, { and, eq }) =>
			and(eq(d.input, "text"), eq(d.output, "embedding"))
	})
}

beforeEach(async () => {
	await testDb.delete(schema.connectionDefaults)
	await testDb.delete(schema.connectionModels)
	await testDb.delete(schema.connections)
	const { clearCachedScans, clearDownloads } = await import(
		"$lib/server/localModels/onnxCache"
	)
	clearCachedScans()
	clearDownloads()
	await fs.rm(cacheDir, { recursive: true, force: true })
})

describe("making a local ONNX model active", () => {
	it("is refused while the model is not downloaded", async () => {
		const { connectionId, modelId } =
			await makeOnnxConnection("Xenova/not-here")
		await expect(setDefault(connectionId, modelId)).rejects.toThrow(
			/isn't downloaded yet/
		)
		expect(await registered()).toBeUndefined()
	}, 60_000)

	it("is refused while the model is still downloading", async () => {
		const { connectionId, modelId } =
			await makeOnnxConnection("Xenova/arriving")
		const { claimDownload } = await import(
			"$lib/server/localModels/onnxCache"
		)
		claimDownload({
			modality: "embeddings",
			modelId: "Xenova/arriving"
		} as any)
		await expect(setDefault(connectionId, modelId)).rejects.toThrow(
			/still downloading/
		)
		expect(await registered()).toBeUndefined()
	}, 60_000)

	it("is accepted once the weights are on disk", async () => {
		const { connectionId, modelId } =
			await makeOnnxConnection("Xenova/on-disk")
		// TRANSFORMERS_CACHE is the root for both lanes, so the repo sits
		// directly under it. `.onnx` weights are the `on_disk` predicate.
		const dir = path.join(cacheDir, "Xenova", "on-disk")
		await fs.mkdir(path.join(dir, "onnx"), { recursive: true })
		await fs.writeFile(path.join(dir, "config.json"), "{}")
		await fs.writeFile(path.join(dir, "onnx", "model.onnx"), "weights")

		await setDefault(connectionId, modelId)
		const row = await registered()
		expect(row?.connectionId).toBe(connectionId)
		expect(row?.connectionModelId).toBe(modelId)
	}, 60_000)
})

/**
 * A machine whose ONNX runtime didn't load: no local ONNX model can be made
 * active, downloaded or not, and the refusal is the machine's reason — the
 * sentence the create, download and add-by-Hub-id gates give. Clearing the
 * star stays open, so a person can always switch away. Made the honest way:
 * `SERENE_PUB_PLATFORM=android`, which the probe reads first.
 */
describe("making a local ONNX model active where the runtime didn't load", () => {
	beforeEach(() => {
		process.env.SERENE_PUB_PLATFORM = "android"
	})
	afterEach(() => {
		delete process.env.SERENE_PUB_PLATFORM
	})

	async function onDisk(model: string) {
		const ids = await makeOnnxConnection(model)
		const dir = path.join(cacheDir, ...model.split("/"))
		await fs.mkdir(path.join(dir, "onnx"), { recursive: true })
		await fs.writeFile(path.join(dir, "config.json"), "{}")
		await fs.writeFile(path.join(dir, "onnx", "model.onnx"), "weights")
		return ids
	}

	it("is refused with the machine's reason, even with the weights on disk", async () => {
		const { connectionId, modelId } = await onDisk("Xenova/stranded")
		const emitted: Array<[string, any]> = []
		const { connectionsSetDefault } = await import("./connections")
		await expect(
			connectionsSetDefault.handler(
				socket,
				{ capability: "text->embedding", id: connectionId, modelId } as any,
				(event: string, data: any) => emitted.push([event, data])
			)
		).rejects.toThrow(
			/^Local ONNX models aren't available on this machine: .*Android/
		)
		expect(emitted.map(([event]) => event)).toEqual([
			"error",
			"connections:setDefault:error"
		])
		expect(await registered()).toBeUndefined()
	}, 60_000)

	it("still clears the star, so the lane can be switched away", async () => {
		const { connectionId, modelId } = await onDisk("Xenova/was-active")
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(testDb as any, "text->embedding", {
			connectionId,
			connectionModelId: modelId
		})

		const { connectionsSetDefault } = await import("./connections")
		await connectionsSetDefault.handler(
			socket,
			{ capability: "text->embedding", id: null, modelId: null } as any,
			noop
		)
		const row = await registered()
		expect(row?.connectionId ?? null).toBeNull()
		expect(row?.connectionModelId ?? null).toBeNull()
	}, 60_000)
})
