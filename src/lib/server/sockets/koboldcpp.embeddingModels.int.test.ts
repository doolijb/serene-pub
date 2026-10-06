/**
 * Embedding models on the managed KoboldCPP — the three server doors.
 *
 *   · **"Use for embeddings"** (`koboldcpp:connectEmbeddingModel`) ensures the
 *     file as an `embeddings` model row on THE managed endpoint and answers the
 *     pair. It never writes the star: moving the embedding star re-indexes, so
 *     it goes through `connections:setDefault` behind its confirmation.
 *   · **"Move to embedding models"** (`koboldcpp:setModelKind`) is a person's
 *     answer for a file the header read wrong, and the endpoint's model rows
 *     follow it at once rather than at the next refresh.
 *   · **The one-time re-read**: a GGUF an older classifier filed as `detected`
 *     text is read once more, so an embedding model measured before the
 *     `embeddings` kind existed is listed as one — never overriding a person's
 *     own answer.
 *
 * Against a real (test) database and real files with real GGUF headers, as
 * `koboldcpp.imageModels.int.test.ts` does for image models.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { byCapability } from "$lib/server/connections/capabilityDefaults"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("https", () => ({ get: () => ({ on: () => {} }) }))
vi.mock("http", () => ({ get: () => ({ on: () => {} }) }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let testDb: TestDb
let modelsDir: string

// --- GGUF fixtures, built as modelKind.test.ts builds them --------------------

const u32 = (n: number) => {
	const b = Buffer.alloc(4)
	b.writeUInt32LE(n)
	return b
}
const u64 = (n: number) => {
	const b = Buffer.alloc(8)
	b.writeBigUInt64LE(BigInt(n))
	return b
}
const gstr = (s: string) => {
	const bytes = Buffer.from(s, "utf8")
	return Buffer.concat([u64(bytes.length), bytes])
}
const archKv = (value: string) =>
	Buffer.concat([gstr("general.architecture"), u32(8), gstr(value)])
const u32Kv = (key: string, value: number) =>
	Buffer.concat([gstr(key), u32(4), u32(value)])
const gguf = (...kvs: Buffer[]) =>
	Buffer.concat([
		Buffer.from("GGUF"),
		u32(3),
		u64(112),
		u64(kvs.length),
		...kvs
	])

/** A bge/nomic-shaped embedding GGUF: `bert` with a mean `pooling_type`. */
const EMBED_GGUF = gguf(archKv("bert"), u32Kv("bert.pooling_type", 1))
/** A chat model. */
const TEXT_GGUF = gguf(archKv("llama"))

beforeAll(async () => {
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-embedding-models-dir-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 })
	await testDb.insert(schema.koboldCppSettings).values({
		id: 1,
		koboldCppManagerEnabled: true,
		koboldCppManagerModelsDir: modelsDir
	})
}, 60_000)

afterAll(async () => {
	vi.unstubAllGlobals()
	await fs.rm(modelsDir, { recursive: true, force: true })
})

beforeEach(async () => {
	// koboldcpp is never running here: every probe is the unreachable answer
	// the listing is written for.
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: any) => {
			throw new Error(`unrouted fetch: ${String(url)}`)
		})
	)
	const { forgetRereadDetectedTextModels } = await import(
		"$lib/server/koboldcpp/rereadDetectedKinds"
	)
	forgetRereadDetectedTextModels()
	await testDb.delete(schema.connectionDefaults)
	await testDb.delete(schema.connections)
	await testDb.delete(schema.localModels)
	for (const f of await fs.readdir(modelsDir))
		await fs.rm(path.join(modelsDir, f), { force: true })
})

const socket = { user: { id: 1, isAdmin: true } } as any

/** Every emit, in order — the handler's own reply and its cascades. */
function recorder() {
	const emitted: { event: string; data: any }[] = []
	const emit = (event: string, data: any) => {
		emitted.push({ event, data })
	}
	return { emitted, emit }
}

async function onDisk(
	filename: string,
	bytes: Buffer,
	row?: {
		kind: "text" | "image" | "embeddings" | "unknown"
		kindSource: "user" | "detected" | "declared" | "assumed"
		status?: string
	}
) {
	await fs.writeFile(path.join(modelsDir, filename), bytes)
	if (row)
		await testDb.insert(schema.localModels).values({
			filename,
			modelName: filename.replace(/\.gguf$/, ""),
			sizeBytes: bytes.length,
			status: row.status ?? "complete",
			kind: row.kind,
			kindSource: row.kindSource
		})
}

const modelRow = (filename: string) =>
	testDb.query.localModels.findFirst({
		where: eq(schema.localModels.filename, filename)
	})

const managedEndpoint = () =>
	testDb.query.connections.findFirst({
		where: eq(schema.connections.type, CONNECTION_TYPE.KOBOLDCPP_MANAGED)
	})

const endpointModel = (connectionId: number, model: string) =>
	testDb.query.connectionModels.findFirst({
		where: and(
			eq(schema.connectionModels.connectionId, connectionId),
			eq(schema.connectionModels.model, model)
		)
	})

async function connectEmbeddingModel(
	filename: string,
	emit: (event: string, data: any) => void = () => {}
) {
	const { koboldCppConnectEmbeddingModelHandler } = await import(
		"./koboldcpp"
	)
	return koboldCppConnectEmbeddingModelHandler.handler(
		socket,
		{ filename },
		emit
	)
}

async function setModelKind(
	filename: string,
	kind: "text" | "image" | "embeddings",
	emit: (event: string, data: any) => void = () => {}
) {
	const { koboldCppSetModelKindHandler } = await import("./koboldcpp")
	return koboldCppSetModelKindHandler.handler(
		socket,
		{ filename, kind },
		emit
	)
}

async function listModels() {
	const { koboldCppListModelsHandler } = await import("./koboldcpp")
	return koboldCppListModelsHandler.handler(socket, {}, () => {})
}

describe("koboldcpp:connectEmbeddingModel — the pair, never the star", () => {
	test("ensures an embedding model row on the managed endpoint and answers the pair", async () => {
		const filename = "nomic-embed-text-v1.5.Q4_K_M.gguf"
		await onDisk(filename, EMBED_GGUF, {
			kind: "embeddings",
			kindSource: "detected"
		})
		const { emitted, emit } = recorder()

		const res = (await connectEmbeddingModel(filename, emit)) as any

		const endpoint = await managedEndpoint()
		expect(endpoint).toBeTruthy()
		const row = await endpointModel(endpoint!.id, filename)
		expect(row!.modality).toBe("embeddings")
		expect(res).toEqual({
			filename,
			connectionId: endpoint!.id,
			modelId: row!.id,
			name: row!.name
		})
		expect(emitted.at(-1)).toEqual({
			event: "koboldcpp:connectEmbeddingModel",
			data: res
		})
		// ⚠ No star: that is `connections:setDefault`'s, behind the re-index
		// confirmation.
		expect(
			await testDb.query.connectionDefaults.findFirst({
				where: byCapability("text->embedding")
			})
		).toBeUndefined()
	}, 60_000)

	test("turns a row the endpoint still lists as text-gen into an embedding model", async () => {
		const filename = "bge-m3-Q8_0.gguf"
		await onDisk(filename, EMBED_GGUF, {
			kind: "embeddings",
			kindSource: "user"
		})
		const { ensureManagedKoboldCppEndpoint } = await import(
			"$lib/server/koboldcpp/managedEndpoint"
		)
		const endpoint = await ensureManagedKoboldCppEndpoint(
			testDb as any,
			"http://localhost:5001"
		)
		await testDb.insert(schema.connectionModels).values({
			connectionId: endpoint.id,
			model: filename,
			name: "bge-m3",
			modality: "text-gen"
		})

		const res = (await connectEmbeddingModel(filename)) as any

		expect(res.connectionId).toBe(endpoint.id)
		expect((await endpointModel(endpoint.id, filename))!.modality).toBe(
			"embeddings"
		)
		// One endpoint — the one that was already there.
		expect(
			await testDb.query.connections.findMany({
				where: eq(
					schema.connections.type,
					CONNECTION_TYPE.KOBOLDCPP_MANAGED
				)
			})
		).toHaveLength(1)
	}, 60_000)

	test("accepts a file only the endpoint's listing has seen, by its header", async () => {
		const filename = "dropped-in-embed.gguf"
		await onDisk(filename, EMBED_GGUF)
		const res = (await connectEmbeddingModel(filename)) as any
		expect(res.modelId).toBeGreaterThan(0)
	}, 60_000)

	test("refuses anything that is not an embedding model, saying what it is", async () => {
		await onDisk("chat.gguf", TEXT_GGUF, {
			kind: "text",
			kindSource: "detected"
		})
		await onDisk("unreadable.gguf", Buffer.from("GGUF"), {
			kind: "unknown",
			kindSource: "assumed"
		})
		await onDisk("unregistered-chat.gguf", TEXT_GGUF)
		const { emitted, emit } = recorder()

		expect(await connectEmbeddingModel("chat.gguf", emit)).toEqual({
			error: "That's a text model. Mark it as an embedding model first if you're sure."
		})
		expect(emitted.at(-1)!.event).toBe(
			"koboldcpp:connectEmbeddingModel:error"
		)
		expect(
			((await connectEmbeddingModel("unreadable.gguf")) as any).error
		).toMatch(/could not tell what that file is/)
		expect(
			((await connectEmbeddingModel("unregistered-chat.gguf")) as any)
				.error
		).toMatch(/text model/)
		expect(
			((await connectEmbeddingModel("never-there.gguf")) as any).error
		).toBe("That model file is no longer on disk")
		// Nothing was written for any of them.
		expect(await managedEndpoint()).toBeUndefined()
	}, 60_000)

	test("refuses while the managed KoboldCPP is turned off", async () => {
		await onDisk("nomic.gguf", EMBED_GGUF, {
			kind: "embeddings",
			kindSource: "detected"
		})
		await testDb
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagerEnabled: false })
		try {
			expect(
				((await connectEmbeddingModel("nomic.gguf")) as any).error
			).toBe("KoboldCPP, run by Serene Pub, is turned off")
		} finally {
			await testDb
				.update(schema.koboldCppSettings)
				.set({ koboldCppManagerEnabled: true })
		}
	}, 60_000)
})

describe("koboldcpp:setModelKind — moving a file to the embedding models", () => {
	test("records the answer, and the endpoint's row follows it at once", async () => {
		// A GGUF converted without its pooling key reads as a chat model.
		const filename = "old-convert-embed.gguf"
		await onDisk(filename, TEXT_GGUF, {
			kind: "text",
			kindSource: "detected"
		})
		const { ensureManagedKoboldCppEndpoint } = await import(
			"$lib/server/koboldcpp/managedEndpoint"
		)
		const endpoint = await ensureManagedKoboldCppEndpoint(
			testDb as any,
			"http://localhost:5001"
		)
		await testDb.insert(schema.connectionModels).values({
			connectionId: endpoint.id,
			model: filename,
			name: filename,
			modality: "text-gen"
		})

		await setModelKind(filename, "embeddings")

		const rec = await modelRow(filename)
		expect(rec!.kind).toBe("embeddings")
		expect(rec!.kindSource).toBe("user")
		expect(rec!.modality).toBe("embeddings")
		// Without the sync the row would sit under Text models until Refresh.
		expect((await endpointModel(endpoint.id, filename))!.modality).toBe(
			"embeddings"
		)

		// …and back, the same way.
		await setModelKind(filename, "text")
		expect((await endpointModel(endpoint.id, filename))!.modality).toBe(
			"text-gen"
		)
	}, 60_000)

	test("refuses to make a .safetensors file an embedding model", async () => {
		const filename = "sd15.safetensors"
		await onDisk(filename, Buffer.from("not a gguf"), {
			kind: "image",
			kindSource: "detected"
		})
		const { emitted, emit } = recorder()
		await expect(
			setModelKind(filename, "embeddings", emit)
		).rejects.toThrow("Only a .gguf file can be an embedding model.")
		expect(emitted.at(-1)!.event).toBe("koboldcpp:setModelKind:error")
		expect((await modelRow(filename))!.kind).toBe("image")
	}, 60_000)
})

describe("the one-time re-read of GGUFs once called text", () => {
	test("moves a detected text row whose header is an embedding model — and nothing a person decided", async () => {
		await onDisk("nomic-old.gguf", EMBED_GGUF, {
			kind: "text",
			kindSource: "detected"
		})
		await onDisk("person-says-text.gguf", EMBED_GGUF, {
			kind: "text",
			kindSource: "user"
		})
		await onDisk("real-chat.gguf", TEXT_GGUF, {
			kind: "text",
			kindSource: "detected"
		})

		const res = await listModels()

		const moved = await modelRow("nomic-old.gguf")
		expect(moved!.kind).toBe("embeddings")
		expect(moved!.modality).toBe("embeddings")
		// Still the header's answer, not a person's.
		expect(moved!.kindSource).toBe("detected")
		expect(
			res.availableModels.find((m) => m.name === "nomic-old.gguf")!.kind
		).toBe("embeddings")

		expect((await modelRow("person-says-text.gguf"))!.kind).toBe("text")
		expect((await modelRow("real-chat.gguf"))!.kind).toBe("text")
	}, 60_000)

	test("reads each file once per process, so later listings pay nothing", async () => {
		await onDisk("nomic-once.gguf", EMBED_GGUF, {
			kind: "text",
			kindSource: "detected"
		})
		const { rereadDetectedTextModels } = await import(
			"$lib/server/koboldcpp/rereadDetectedKinds"
		)
		const settings = (await testDb.query.koboldCppSettings.findFirst())!
		expect(await rereadDetectedTextModels(testDb as any, settings)).toEqual(
			["nomic-once.gguf"]
		)

		// Put the row back as it was: a second pass in this process leaves it.
		await testDb
			.update(schema.localModels)
			.set({ kind: "text", modality: "text-gen" })
			.where(eq(schema.localModels.filename, "nomic-once.gguf"))
		expect(await rereadDetectedTextModels(testDb as any, settings)).toEqual(
			[]
		)
		expect((await modelRow("nomic-once.gguf"))!.kind).toBe("text")
	}, 60_000)

	test("the managed endpoint's sync files the moved model as an embedding model", async () => {
		const filename = "nomic-sync.gguf"
		await onDisk(filename, EMBED_GGUF, {
			kind: "text",
			kindSource: "detected"
		})
		const { ensureManagedKoboldCppEndpoint } = await import(
			"$lib/server/koboldcpp/managedEndpoint"
		)
		const endpoint = await ensureManagedKoboldCppEndpoint(
			testDb as any,
			"http://localhost:5001"
		)
		await testDb.insert(schema.connectionModels).values({
			connectionId: endpoint.id,
			model: filename,
			name: filename,
			modality: "text-gen"
		})

		const { syncManyConnectionModels } = await import(
			"$lib/server/connections/modelSync"
		)
		await syncManyConnectionModels(testDb as any, {
			types: [CONNECTION_TYPE.KOBOLDCPP_MANAGED],
			force: true
		})

		expect((await modelRow(filename))!.kind).toBe("embeddings")
		expect((await endpointModel(endpoint.id, filename))!.modality).toBe(
			"embeddings"
		)
	}, 60_000)
})
