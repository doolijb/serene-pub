/**
 * Every Ollama connection is managed against its OWN host (ruled 2026-09-24,
 * plan B4).
 *
 * The `ollama:*` handlers all read one global `ollamaManagerBaseUrl`, so a
 * second Ollama connection showed the first one's status, and deleting a model
 * from the list forgot it on every Ollama endpoint — deleting any endpoint that
 * emptied, the managed one included. These pin the routing: the named
 * connection's host is the one asked, a non-Ollama id is refused, and a delete
 * on one host touches only that host's rows and never deletes a connection.
 */

import {
	afterAll,
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

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

// The Ollama client, observed: which host each call was made against.
const deletes: Array<{ host: string; model: string }> = []
vi.mock("ollama", () => ({
	Ollama: class {
		host: string
		constructor(opts: { host: string }) {
			this.host = opts.host
		}
		async delete({ model }: { model: string }) {
			deletes.push({ host: this.host, model })
		}
		async list() {
			return { models: [] }
		}
		async ps() {
			return { models: [] }
		}
	}
}))

const fetched: string[] = []
beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-ollama-per-connection-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 } as any)
	await testDb
		.insert(schema.ollamaSettings)
		.values({ id: 1, ollamaManagerBaseUrl: "http://manager:11434/" } as any)
		.onConflictDoUpdate({
			target: schema.ollamaSettings.id,
			set: { ollamaManagerBaseUrl: "http://manager:11434/" }
		})
	vi.stubGlobal("fetch", async (url: string) => {
		fetched.push(String(url))
		return new Response(JSON.stringify({ version: "0.30.7" }), {
			status: 200
		})
	})
}, 60_000)

afterAll(async () => {
	vi.unstubAllGlobals()
	await fs.rm(dataDir, { recursive: true, force: true })
})

const admin = { user: { id: 1, isAdmin: true } } as any
const nonAdmin = { user: { id: 2, isAdmin: false } } as any
const noop = () => {}

async function makeConnection(type: string, baseUrl: string, models: string[]) {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name: `${type}@${baseUrl}`,
			type,
			modality: "text-gen",
			baseUrl,
			extraJson: {},
			capabilities: { resolved: { "text->text": 1 } }
		} as any)
		.returning()
	for (const model of models)
		await testDb
			.insert(schema.connectionModels)
			.values({ connectionId: conn.id, model, name: model })
	return conn.id as number
}

beforeEach(async () => {
	fetched.length = 0
	deletes.length = 0
	await testDb.delete(schema.connectionDefaults)
	await testDb.delete(schema.connectionModels)
	await testDb.delete(schema.connections)
})

describe("ollama handlers, per connection", () => {
	it("asks the named connection's host, not the manager's", async () => {
		const a = await makeConnection(
			CONNECTION_TYPE.OLLAMA,
			"http://a:11434/",
			[]
		)
		const b = await makeConnection(
			CONNECTION_TYPE.OLLAMA,
			"http://b:11434",
			[]
		)
		const { ollamaVersionHandler } = await import("./ollama")
		const ra = await ollamaVersionHandler.handler(
			admin,
			{ connectionId: a },
			noop
		)
		const rb = await ollamaVersionHandler.handler(
			admin,
			{ connectionId: b },
			noop
		)
		expect(fetched).toEqual([
			"http://a:11434/api/version",
			"http://b:11434/api/version"
		])
		// Scoped answers carry their scope.
		expect(ra.connectionId).toBe(a)
		expect(rb.connectionId).toBe(b)
	}, 60_000)

	it("⏳ with no connection named, still asks the manager's address", async () => {
		const { ollamaVersionHandler } = await import("./ollama")
		const res = await ollamaVersionHandler.handler(admin, {}, noop)
		expect(fetched).toEqual(["http://manager:11434/api/version"])
		expect(res.connectionId).toBeNull()
	}, 60_000)

	it("refuses a connection that is not Ollama", async () => {
		const other = await makeConnection(
			CONNECTION_TYPE.OPENAI,
			"http://openai.example/v1",
			[]
		)
		const { ollamaVersionHandler } = await import("./ollama")
		await expect(
			ollamaVersionHandler.handler(admin, { connectionId: other }, noop)
		).rejects.toThrow(/not an Ollama connection/)
		expect(fetched).toEqual([])
	}, 60_000)

	it("stays admin-only", async () => {
		const a = await makeConnection(
			CONNECTION_TYPE.OLLAMA,
			"http://a:11434",
			[]
		)
		const { ollamaVersionHandler } = await import("./ollama")
		await expect(
			ollamaVersionHandler.handler(nonAdmin, { connectionId: a }, noop)
		).rejects.toThrow(/Unauthorized/)
	}, 60_000)

	it("a delete on one host forgets the model there only, and deletes no connection", async () => {
		const a = await makeConnection(
			CONNECTION_TYPE.OLLAMA,
			"http://a:11434/",
			["llama3"]
		)
		const b = await makeConnection(
			CONNECTION_TYPE.OLLAMA,
			"http://b:11434",
			["llama3"]
		)
		const { ollamaDeleteModelHandler } = await import("./ollama")
		await ollamaDeleteModelHandler.handler(
			admin,
			{ modelName: "llama3", connectionId: a },
			noop
		)
		expect(deletes).toEqual([{ host: "http://a:11434", model: "llama3" }])
		const connections = await testDb.query.connections.findMany()
		expect(connections.map((c) => c.id).sort()).toEqual([a, b].sort())
		const models = await testDb.query.connectionModels.findMany()
		expect(models.map((m) => m.connectionId)).toEqual([b])
	}, 60_000)
})
