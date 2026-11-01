/**
 * connections:discoverLocal — Serene Pub's own managed services are not offered
 * back as "detected" providers. Real test DB and real handler; the network
 * probe (`discoverLocalProviders`) is replaced by a list of candidates.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000 })

const found = vi.hoisted(() => ({ list: [] as any[] }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "test-crypto-secret-key" }
})
vi.mock("$lib/server/connections/discoverLocal", async (orig) => ({
	...(await orig<typeof import("$lib/server/connections/discoverLocal")>()),
	discoverLocalProviders: async () => found.list
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	stopVectorization: () => {},
	startVectorizationQueue: async () => {},
	clearVectorizationFailureTracking: () => {},
	clearInlineEmbedCooldown: () => {}
}))

let db: TestDb
let socket: any

const candidate = (type: string, baseUrl: string) => ({
	type,
	label: type,
	baseUrl,
	models: [],
	error: null
})
const run = async () => {
	const { connectionsDiscoverLocal } = await import("./connections")
	const res = await connectionsDiscoverLocal.handler(socket, {} as any, (() => {}) as any)
	return res.providers.map((p: any) => `${p.type}@${p.baseUrl}`).sort()
}
const addRow = (type: string, baseUrl: string, name: string) =>
	db.insert(schema.connections).values({ name, type, baseUrl, capabilities: {} } as any)

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	const [admin] = await db.insert(schema.users).values({ username: "disc-admin", isAdmin: true }).returning()
	socket = { user: { id: admin.id, isAdmin: true } }
}, 120_000)

beforeEach(async () => {
	await db.delete(schema.connectionModels)
	await db.delete(schema.connections)
	found.list = []
})

afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client.close().catch(() => {})
})

describe("connections:discoverLocal exclusion", () => {
	it("a managed audio.cpp on :5002 hides a discovered audio.cpp on localhost:5002", async () => {
		await addRow(CONNECTION_TYPE.AUDIOCPP_MANAGED, "http://127.0.0.1:5002", "audio.cpp")
		found.list = [candidate(CONNECTION_TYPE.AUDIOCPP, "http://localhost:5002")]
		expect(await run()).toEqual([])
	})

	it("the same managed row does not hide an audio.cpp found on another port", async () => {
		await addRow(CONNECTION_TYPE.AUDIOCPP_MANAGED, "http://127.0.0.1:5002", "audio.cpp")
		found.list = [candidate(CONNECTION_TYPE.AUDIOCPP, "http://localhost:8080")]
		expect(await run()).toEqual([`${CONNECTION_TYPE.AUDIOCPP}@http://localhost:8080`])
	})

	it("with no managed row, an audio.cpp on :5002 is someone's own and is offered", async () => {
		found.list = [candidate(CONNECTION_TYPE.AUDIOCPP, "http://localhost:5002")]
		expect(await run()).toEqual([`${CONNECTION_TYPE.AUDIOCPP}@http://localhost:5002`])
	})

	it("a managed audio.cpp on :5002 does not hide a KoboldCPP or llama.cpp on another port", async () => {
		await addRow(CONNECTION_TYPE.AUDIOCPP_MANAGED, "http://127.0.0.1:5002", "audio.cpp")
		found.list = [
			candidate(CONNECTION_TYPE.KOBOLDCPP, "http://localhost:5001"),
			candidate(CONNECTION_TYPE.LLAMACPP, "http://localhost:8080/")
		]
		expect(await run()).toEqual(
			[
				`${CONNECTION_TYPE.KOBOLDCPP}@http://localhost:5001`,
				`${CONNECTION_TYPE.LLAMACPP}@http://localhost:8080/`
			].sort()
		)
	})

	it("the managed-port check is by type: a managed audio.cpp does not hide a KoboldCPP on the SAME port", async () => {
		await addRow(CONNECTION_TYPE.AUDIOCPP_MANAGED, "http://127.0.0.1:5001", "audio.cpp")
		found.list = [candidate(CONNECTION_TYPE.KOBOLDCPP, "http://localhost:5001")]
		expect(await run()).toEqual([`${CONNECTION_TYPE.KOBOLDCPP}@http://localhost:5001`])
	})

	it("a managed KoboldCPP at the same host hides a discovered KoboldCPP (still works)", async () => {
		await addRow(CONNECTION_TYPE.KOBOLDCPP_MANAGED, "http://localhost:5001", "KoboldCPP")
		found.list = [candidate(CONNECTION_TYPE.KOBOLDCPP, "http://localhost:5001")]
		expect(await run()).toEqual([])
	})

	// Finding, pinned as-is: the audio.cpp check compares ports only (`portOf`),
	// not hosts. Discovery only ever probes localhost, and the managed row's
	// baseUrl is always 127.0.0.1:<settings port>, so a remote host cannot reach
	// this branch in practice; but fed one, the handler would hide it.
	it("pins: the audio.cpp exclusion ignores the host (a candidate on another host, same port, is hidden)", async () => {
		await addRow(CONNECTION_TYPE.AUDIOCPP_MANAGED, "http://127.0.0.1:5002", "audio.cpp")
		found.list = [candidate(CONNECTION_TYPE.AUDIOCPP, "http://192.168.1.50:5002")]
		expect(await run()).toEqual([])
	})
})
