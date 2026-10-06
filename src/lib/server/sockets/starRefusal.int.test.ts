/**
 * One star check, two doors.
 *
 * `connections:setDefault` (the Connections view's star) and
 * `connectionDefaults:set` (Admin → Defaults) both register an instance-wide
 * active connection, and once judged it with two copies of the same checks.
 * The copies drifted: Defaults accepted a model its host no longer lists and a
 * local ONNX model that isn't downloaded — registrations that fail every run
 * they name. Both now ask `starRefusal`, and this file runs ONE table of
 * refusals against BOTH handlers, so a check added to one door and not the
 * other fails here rather than on somebody's Send.
 *
 * Clearing a star stays allowed on both, even where nothing could run the
 * connection it named: refusing to un-star would be a trap.
 */

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
	// `...actual`, not `{ db }` alone: `connections.ts` reaches `tokenCrypto`
	// → `getCryptoSecretKey` at module scope.
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

// Observed, not run: an accepted embedding star stops and restarts the queue,
// and running a real lane here would need an embedding backend.
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
		path.join(os.tmpdir(), "serene-pub-vitest-star-refusal-")
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

afterEach(() => {
	delete process.env.SERENE_PUB_PLATFORM
})

const socket = {
	user: { id: 1, isAdmin: true },
	server: { to: () => ({ emit: () => {} }) }
} as any
const noop = () => {}

const CHAT = "text->text"
const EMBED = "text->embedding"

/** The two doors, pressed with the same choice. */
const DOORS = [
	{
		door: "connections:setDefault",
		press: async (capability: string, id: number | null, modelId: any) => {
			const { connectionsSetDefault } = await import("./connections")
			return connectionsSetDefault.handler(
				socket,
				{ capability, id, modelId } as any,
				noop
			)
		}
	},
	{
		door: "connectionDefaults:set",
		press: async (capability: string, id: number | null, modelId: any) => {
			const { connectionDefaultsSet } = await import(
				"./connectionDefaults"
			)
			return connectionDefaultsSet.handler(
				socket,
				{ capability, half: "connection", id, modelId } as any,
				noop
			)
		}
	}
] as const

async function connection(
	type: string,
	resolved: Record<string, unknown>,
	model = "a-model",
	modelValues: Record<string, unknown> = {}
) {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({
			name: `${type} ${Math.random()}`,
			type,
			extraJson: {},
			capabilities: { resolved }
		} as any)
		.returning()
	const [row] = await testDb
		.insert(schema.connectionModels)
		.values({
			connectionId: conn.id,
			model,
			name: model,
			...modelValues
		} as any)
		.returning()
	return { id: conn.id, modelId: row.id as number | null }
}

const chat = (modelValues?: Record<string, unknown>) =>
	connection(CONNECTION_TYPE.OPENAI, { [CHAT]: 1 }, "a-model", modelValues)
const localEmbeddings = (model: string) =>
	connection(CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS, { [EMBED]: 1 }, model)

/** `.onnx` weights under the repo's directory are the `on_disk` predicate. */
async function putOnDisk(model: string) {
	const dir = path.join(cacheDir, ...model.split("/"))
	await fs.mkdir(path.join(dir, "onnx"), { recursive: true })
	await fs.writeFile(path.join(dir, "config.json"), "{}")
	await fs.writeFile(path.join(dir, "onnx", "model.onnx"), "weights")
}

async function registered(capability: string) {
	const [input, output] = capability.split("->")
	return testDb.query.connectionDefaults.findFirst({
		where: (d, { and, eq }) => and(eq(d.input, input), eq(d.output, output))
	})
}

interface RefusalCase {
	name: string
	capability: string
	choose: () => Promise<{ id: number; modelId: number | null }>
	refusal: RegExp
}

/** Every reason a star is refused, in the order `starRefusal` asks. */
const REFUSALS: RefusalCase[] = [
	{
		name: "a connection that doesn't exist",
		capability: CHAT,
		choose: async () => ({ id: 2_000_000, modelId: 1 }),
		refusal: /^Connection not found\.$/
	},
	{
		name: "a local ONNX connection where the runtime didn't load",
		capability: EMBED,
		choose: async () => {
			process.env.SERENE_PUB_PLATFORM = "android"
			const ids = await localEmbeddings("Xenova/stranded")
			// On disk, so the machine's reason is the only one left.
			await putOnDisk("Xenova/stranded")
			return ids
		},
		refusal:
			/^Local ONNX models aren't available on this machine: .*Android/
	},
	{
		name: "no model named",
		capability: CHAT,
		choose: async () => ({ ...(await chat()), modelId: null }),
		refusal: /connections have no default model/
	},
	{
		name: "a model that no longer exists",
		capability: CHAT,
		choose: async () => ({ ...(await chat()), modelId: 2_000_000 }),
		refusal: /^That model no longer exists\.$/
	},
	{
		name: "a model on another connection",
		capability: CHAT,
		choose: async () => {
			const mine = await chat()
			const theirs = await chat()
			return { id: mine.id, modelId: theirs.modelId }
		},
		refusal: /not on the connection you chose/
	},
	{
		name: "a model switched off",
		capability: CHAT,
		choose: () => chat({ enabled: false }),
		refusal: /switched off/
	},
	{
		name: "a model its host no longer lists",
		capability: CHAT,
		choose: () => chat({ missingSince: new Date() }),
		refusal: /no longer listed by its host/
	},
	{
		name: "a local ONNX model that isn't downloaded",
		capability: EMBED,
		choose: () => localEmbeddings("Xenova/not-here"),
		refusal: /isn't downloaded yet/
	},
	{
		name: "a local ONNX model still downloading",
		capability: EMBED,
		choose: async () => {
			const ids = await localEmbeddings("Xenova/arriving")
			const { claimDownload } = await import(
				"$lib/server/localModels/onnxCache"
			)
			claimDownload({
				modality: "embeddings",
				modelId: "Xenova/arriving"
			} as any)
			return ids
		},
		refusal: /still downloading/
	},
	{
		name: "a connection that can't do the job",
		capability: CHAT,
		choose: () => connection(CONNECTION_TYPE.A1111, { "text->image": 1 }),
		refusal: /Chat/
	}
]

describe.each(DOORS)("$door", ({ press }) => {
	test.each(REFUSALS)(
		"refuses $name",
		async ({ capability, choose, refusal }) => {
			const { id, modelId } = await choose()
			await expect(press(capability, id, modelId)).rejects.toThrow(
				refusal
			)
			expect((await registered(capability))?.connectionId ?? null).toBe(
				null
			)
		},
		60_000
	)

	test("accepts a local ONNX model whose files are on disk", async () => {
		const { id, modelId } = await localEmbeddings("Xenova/on-disk")
		await putOnDisk("Xenova/on-disk")
		await press(EMBED, id, modelId)
		const row = await registered(EMBED)
		expect(row?.connectionId).toBe(id)
		expect(row?.connectionModelId).toBe(modelId)
	}, 60_000)

	test("still clears a star nothing could run, so the job can be switched away", async () => {
		const { id, modelId } = await localEmbeddings("Xenova/was-active")
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(testDb as any, EMBED, {
			connectionId: id,
			connectionModelId: modelId
		})
		process.env.SERENE_PUB_PLATFORM = "android"

		await press(EMBED, null, null)
		const row = await registered(EMBED)
		expect(row?.connectionId ?? null).toBeNull()
		expect(row?.connectionModelId ?? null).toBeNull()
	}, 60_000)
})
