/**
 * Round-8 audit fix: connections:test/refreshModels responses carried no
 * connection id at all ({ok, error, models} / {models, error}), unlike
 * connections:get/update/create/delete which already include the full
 * entity. Since these are emitToUser broadcasts (every open tab for the
 * user, not just the requester), a client had no way to discard a response
 * for a different connection than the one it's currently showing — e.g. two
 * tabs testing two different connections at once. The fix echoes back
 * params.connection?.id as connectionId so the client can guard on it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: vi.fn(async () => ({
		Adapter: class {},
		testConnection: async () => ({ ok: true, error: null }),
		listModels: async () => ({ models: ["model-a", "model-b"] })
	}))
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-connections-request-echo-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeAdmin(username: string) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return user
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: true } } as any
}

const noopEmit = () => {}

describe("connections:test — echoes connectionId (PGlite integration)", () => {
	test("echoes params.connection.id back for an existing connection", async () => {
		const { connectionsTest } = await import("./connections")
		const admin = await makeAdmin("connections-test-echo-admin")
		const [connection] = await testDb
			.insert(schema.connections)
			.values({ name: "Test Conn", type: "ollama" })
			.returning()

		const res = await connectionsTest.handler(
			fakeSocket(admin.id),
			{ connection: { id: connection.id, type: "ollama" } } as any,
			noopEmit
		)

		expect(res.connectionId).toBe(connection.id)
	})

	test("echoes undefined for a not-yet-created connection", async () => {
		const { connectionsTest } = await import("./connections")
		const admin = await makeAdmin("connections-test-echo-new-admin")

		const res = await connectionsTest.handler(
			fakeSocket(admin.id),
			{ connection: { type: "ollama" } } as any,
			noopEmit
		)

		expect(res.connectionId).toBeUndefined()
	})
})

describe("connections:refreshModels — echoes connectionId (PGlite integration)", () => {
	test("echoes params.connection.id back", async () => {
		const { connectionsRefreshModels } = await import("./connections")
		const admin = await makeAdmin("connections-refresh-echo-admin")
		const [connection] = await testDb
			.insert(schema.connections)
			.values({ name: "Test Conn", type: "ollama" })
			.returning()

		const res = await connectionsRefreshModels.handler(
			fakeSocket(admin.id),
			{ connection: { id: connection.id, type: "ollama" } } as any,
			noopEmit
		)

		expect(res.connectionId).toBe(connection.id)
	})
})
