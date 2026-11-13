/**
 * The two local ONNX connections come with Serene Pub: undeletable
 * everywhere, fixed names, never a second row of a type, and their names
 * are reserved against every other connection.
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi
} from "vitest"
import * as schema from "$lib/server/db/schema"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

const runtime = vi.hoisted(() => ({
	available: true as boolean
}))
vi.mock("$lib/server/localModels/onnxRuntime", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		localOnnxAvailability: async () =>
			runtime.available
				? { available: true }
				: { available: false, reason: "no runtime here" },
		localOnnxRefusal: async () =>
			runtime.available
				? null
				: "Local ONNX models aren't available on this machine: no runtime here."
	}
})

let testDb: any
beforeAll(async () => {
	testDb = (await import("$lib/server/db")).db
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 120_000)

beforeEach(async () => {
	runtime.available = true
	await testDb.delete(schema.loadouts)
	await testDb.delete(schema.connectionModels)
	await testDb.delete(schema.connections)
}, 60_000)

const admin = () =>
	({
		user: { id: 1, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) },
		server: { to: () => ({ emit: () => {} }) }
	}) as any
const emitted: [string, any][] = []
const emit = (event: string, data: any) => {
	emitted.push([event, data])
}

async function run(fn: () => Promise<any>) {
	emitted.length = 0
	try {
		return { res: await fn() }
	} catch (e: any) {
		return { error: e?.message ?? (String(e) as string) }
	}
}

async function create(connection: Record<string, unknown>) {
	const { connectionsCreate } = await import("./connections")
	return run(() =>
		connectionsCreate.handler(admin(), { connection } as any, emit as any)
	)
}
async function update(connection: Record<string, unknown>) {
	const { connectionsUpdate } = await import("./connections")
	return run(() =>
		connectionsUpdate.handler(admin(), { connection } as any, emit as any)
	)
}
async function del(id: number) {
	const { connectionsDelete } = await import("./connections")
	return run(() => connectionsDelete.handler(admin(), { id }, emit as any))
}
async function rows() {
	return testDb.select().from(schema.connections)
}
async function seedOnnx(name = "Local embeddings") {
	const [row] = await testDb
		.insert(schema.connections)
		.values({
			name,
			type: "local-onnx",
			modality: "embeddings",
			extraJson: {}
		} as any)
		.returning()
	return row
}

describe("delete", () => {
	test("is refused for a local ONNX row while the runtime loads", async () => {
		const row = await seedOnnx()
		const out = await del(row.id)
		expect(out.error).toBe(
			`"Local embeddings" comes with Serene Pub and can't be deleted. To free space, use Delete from disk on one of its models instead.`
		)
		expect(emitted.some(([e]) => e === "error")).toBe(true)
		expect((await rows()).length).toBe(1)
	}, 60_000)

	test("is refused while the runtime is unavailable too", async () => {
		const row = await seedOnnx()
		runtime.available = false
		const out = await del(row.id)
		expect(out.error).toBe(
			`"Local embeddings" comes with Serene Pub and can't be deleted. To free space, use Delete from disk on one of its models instead.`
		)
		expect(emitted.some(([e]) => e === "error")).toBe(true)
		expect((await rows()).length).toBe(1)
	}, 60_000)

	test("is unaffected for other connections", async () => {
		const [row] = await testDb
			.insert(schema.connections)
			.values({
				name: "An Ollama",
				type: "ollama",
				baseUrl: "http://o.test:11434",
				extraJson: {}
			} as any)
			.returning()
		const out = await del(row.id)
		expect(out.error).toBeUndefined()
		expect((await rows()).length).toBe(0)
	}, 60_000)
})

describe("rename", () => {
	test("is refused; an unchanged name passes", async () => {
		const row = await seedOnnx()
		const bad = await update({ id: row.id, name: "Mine" })
		expect(bad.error).toBe(
			`"Local embeddings" comes with Serene Pub and keeps its name.`
		)
		expect(emitted.some(([e]) => e === "connections:update:error")).toBe(
			true
		)
		const ok = await update({ id: row.id, name: "Local embeddings " })
		expect(ok.error).toBeUndefined()
		expect((await rows())[0].name).toBe("Local embeddings")
	}, 60_000)
})

describe("create", () => {
	test("a second row of the type is refused", async () => {
		await seedOnnx()
		const out = await create({ name: "Another", type: "local-onnx" })
		expect(out.error).toBe(
			`Serene Pub already has "Local embeddings". Download models into it instead.`
		)
		expect((await rows()).length).toBe(1)
	}, 60_000)

	test("the first row gets the fixed name whatever was sent", async () => {
		const out = await create({ name: "Whatever", type: "local-onnx-ner" })
		expect(out.error).toBeUndefined()
		expect(out.res.connection.name).toBe("Local named entities")
	}, 60_000)

	test("another connection cannot take a fixed name", async () => {
		const out = await create({
			name: "local EMBEDDINGS",
			type: "ollama",
			baseUrl: "http://o2.test:11434"
		})
		expect(out.error).toBe(
			`A connection named "local EMBEDDINGS" already exists.`
		)
	}, 60_000)

	test("nor rename onto one", async () => {
		const made = await create({
			name: "Plain",
			type: "ollama",
			baseUrl: "http://o3.test:11434"
		})
		const out = await update({
			id: made.res.connection.id,
			name: "local EMBEDDINGS"
		})
		expect(out.error).toMatch(/already exists/)
	}, 60_000)
})

describe("connections:list projection (★C-5)", () => {
	let dataDir: string
	let prevDataDir: string | undefined
	beforeAll(async () => {
		prevDataDir = process.env.SERENE_PUB_DATA_DIR
		dataDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "serene-pub-vitest-c3-")
		)
		process.env.SERENE_PUB_DATA_DIR = dataDir
	})
	afterAll(async () => {
		if (prevDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
		else process.env.SERENE_PUB_DATA_DIR = prevDataDir
		await fs.rm(dataDir, { recursive: true, force: true })
	})

	let fetchSpy: ReturnType<typeof vi.spyOn>
	beforeEach(async () => {
		const { resetRecommendedLists } = await import(
			"$lib/server/localModels/onnxList"
		)
		resetRecommendedLists()
		await testDb.delete(schema.localModels)
		fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => new Response("", { status: 500 }))
	}, 60_000)
	afterEach(() => {
		vi.restoreAllMocks()
	})

	async function seedWithModel() {
		const row = await seedOnnx()
		await testDb.insert(schema.connectionModels).values({
			connectionId: row.id,
			model: "Xenova/all-MiniLM-L6-v2",
			name: "all-MiniLM-L6-v2"
		} as any)
		return row
	}
	async function modelOf(row: { id: number }) {
		const { buildConnectionsList } = await import("./connections")
		const list: any = await buildConnectionsList()
		const conn = list.connectionsList.find((c: any) => c.id === row.id)
		return conn.models[0]
	}

	test("nothing asked: no fetch, the built-in catalogue answers", async () => {
		const row = await seedWithModel()
		const model = await modelOf(row)
		expect(fetchSpy).not.toHaveBeenCalled()
		expect(model.local).toBeDefined()
	}, 60_000)

	test("a model on disk: the list may fetch", async () => {
		const row = await seedWithModel()
		await testDb.insert(schema.localModels).values({
			format: "onnx",
			modality: "embeddings",
			status: "complete",
			filename: "Xenova/all-MiniLM-L6-v2",
			modelName: "all-MiniLM-L6-v2"
		} as any)
		await modelOf(row)
		expect(fetchSpy).toHaveBeenCalled()
	}, 60_000)
})
