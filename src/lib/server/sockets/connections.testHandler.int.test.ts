/**
 * Round-10 audit fix (LOW): connectionsTest/connectionsRefreshModels called
 * getConnectionAdapter(...) OUTSIDE their own try block, so an unsupported
 * connection type (getConnectionAdapter always throws rather than
 * returning a falsy Adapter — the "if (!Adapter)" branch that used to sit
 * after it could never run) surfaced as an uncaught error instead of the
 * handler's own clean {ok:false, error, connectionId} response. Fixed by
 * moving the call inside the existing try; the dead branch was deleted.
 *
 * Also (LOW): neither handler throttled calls to external hosts at all.
 * Fixed by reusing loginRateLimit as a plain N-calls-per-window limiter,
 * keyed per-operation, recording every call (not just failures).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

// The adapter a test talks to, swappable per test: `null` keeps the real
// family loader (the unsupported-type case needs its throw).
let stubAdapter: {
	testConnection: (c: any) => Promise<any>
	listModels: (c: any) => Promise<any>
} | null = null
vi.mock("$lib/server/connections/modelSync", async () => {
	const actual = await vi.importActual<
		typeof import("$lib/server/connections/modelSync")
	>("$lib/server/connections/modelSync")
	return {
		...actual,
		adapterIO: async (type: string, db?: any) =>
			stubAdapter ?? actual.adapterIO(type, db)
	}
})

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-connections-test-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeAdmin(username: string) {
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return admin
}

function fakeSocket(userId: number) {
	return { user: { id: userId, isAdmin: true } } as any
}

const noopEmit = () => {}

describe("connections:test — unsupported type", () => {
	test("returns a clean {ok:false, error} response instead of throwing uncaught", async () => {
		const { connectionsTest } = await import("./connections")
		const { loginRateLimit } = await import(
			"$lib/server/services/loginRateLimit"
		)
		const admin = await makeAdmin("connections-test-unsupported-user")
		loginRateLimit.clearRateLimit(`${admin.id}:connections:test`)

		const res = await connectionsTest.handler(
			fakeSocket(admin.id),
			{ connection: { type: "totally-unsupported-type" } as any },
			noopEmit
		)
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/unsupported connection type/i)
	})
})

describe("connections:test — rate limiting", () => {
	test("the 6th call within the window is rejected as rate limited", async () => {
		const { connectionsTest } = await import("./connections")
		const { loginRateLimit } = await import(
			"$lib/server/services/loginRateLimit"
		)
		const admin = await makeAdmin("connections-test-ratelimit-user")

		// loginRateLimit is a module-wide singleton reused across every test
		// in this process. The key is per user, so a fresh admin starts at
		// zero; cleared anyway so this test's own count is deterministic.
		loginRateLimit.clearRateLimit(`${admin.id}:connections:test`)

		const results: boolean[] = []
		for (let i = 0; i < 6; i++) {
			const res = await connectionsTest.handler(
				fakeSocket(admin.id),
				{
					connection: {
						id: 900 + i,
						type: "rate-limit-probe-" + i
					} as any
				},
				noopEmit
			)
			results.push(/rate limited/i.test(res.error ?? ""))
			// The refusal names its row, so the form can clear "testing".
			if (i === 5) expect(res.connectionId).toBe(905)
		}

		expect(results.slice(0, 5)).toEqual([false, false, false, false, false])
		expect(results[5]).toBe(true)
	})

	test("the budget is per user: one admin's tests do not refuse another's", async () => {
		const { connectionsTest } = await import("./connections")
		const busy = await makeAdmin("connections-test-ratelimit-busy")
		const other = await makeAdmin("connections-test-ratelimit-other")
		for (let i = 0; i < 6; i++)
			await connectionsTest.handler(
				fakeSocket(busy.id),
				{ connection: { type: "rate-limit-busy-" + i } as any },
				noopEmit
			)
		const res = await connectionsTest.handler(
			fakeSocket(other.id),
			{ connection: { type: "rate-limit-other" } as any },
			noopEmit
		)
		expect(res.error ?? "").not.toMatch(/rate limited/i)
	})
})

/**
 * Plan A1 (connections bug-fix 2026-10-11): a test of an UNSAVED edit listed
 * a different host, and that listing was synced onto the saved row — its real
 * models marked missing, the row stamped fresh so the next open skipped the
 * re-list. A draft test now answers in the reply alone.
 */
describe("connections:test — a draft never writes the saved row", () => {
	const SYNCED_AT = new Date("2026-01-02T03:04:05.000Z")

	async function seedRow(label: string) {
		const [conn] = await testDb
			.insert(schema.connections)
			.values({
				name: `Draft test ${label}`,
				type: "openai",
				baseUrl: "http://saved-host:1234/v1",
				extraJson: { apiKey: "sk-saved" },
				modelsSyncedAt: SYNCED_AT
			} as any)
			.returning()
		await testDb.insert(schema.connectionModels).values({
			connectionId: conn.id,
			model: "saved-model",
			name: "saved-model"
		} as any)
		return conn
	}

	async function readBack(id: number) {
		const row = await testDb.query.connections.findFirst({
			where: (c, { eq }) => eq(c.id, id)
		})
		const models = await testDb.query.connectionModels.findMany({
			where: (m, { eq }) => eq(m.connectionId, id)
		})
		return { row: row!, models }
	}

	function listing(models: string[]) {
		stubAdapter = {
			testConnection: async () => ({ ok: true }),
			listModels: async () => ({
				models: models.map((id) => ({ id, name: id }))
			})
		}
	}

	test("a draft with another baseUrl leaves missingSince and modelsSyncedAt alone", async () => {
		const { connectionsTest } = await import("./connections")
		const admin = await makeAdmin("connections-test-draft-url")
		const conn = await seedRow("url")
		listing(["other-host-model"])
		try {
			const res = await connectionsTest.handler(
				fakeSocket(admin.id),
				{
					connection: {
						id: conn.id,
						type: "openai",
						baseUrl: "http://some-other-host:9999/v1",
						extraJson: { apiKey: "sk-saved" }
					} as any
				},
				noopEmit
			)
			expect(res.ok).toBe(true)
			expect(res.models.map((m: any) => m.id)).toEqual([
				"other-host-model"
			])
			const { row, models } = await readBack(conn.id)
			expect(row.modelsSyncedAt?.toISOString()).toBe(
				SYNCED_AT.toISOString()
			)
			expect(models.map((m) => m.model)).toEqual(["saved-model"])
			expect(models[0].missingSince).toBeNull()
		} finally {
			stubAdapter = null
		}
	})

	test("a draft with another key leaves the saved row alone", async () => {
		const { connectionsTest } = await import("./connections")
		const admin = await makeAdmin("connections-test-draft-key")
		const conn = await seedRow("key")
		listing(["other-account-model"])
		try {
			await connectionsTest.handler(
				fakeSocket(admin.id),
				{
					connection: {
						id: conn.id,
						type: "openai",
						baseUrl: "http://saved-host:1234/v1",
						extraJson: { apiKey: "sk-someone-else" }
					} as any
				},
				noopEmit
			)
			const { row, models } = await readBack(conn.id)
			expect(row.modelsSyncedAt?.toISOString()).toBe(
				SYNCED_AT.toISOString()
			)
			expect(models[0].missingSince).toBeNull()
		} finally {
			stubAdapter = null
		}
	})

	test("a test of the saved endpoint (blank key = keep stored) still syncs", async () => {
		const { connectionsTest } = await import("./connections")
		const admin = await makeAdmin("connections-test-draft-same")
		const conn = await seedRow("same")
		listing(["saved-model", "new-model"])
		try {
			await connectionsTest.handler(
				fakeSocket(admin.id),
				{
					connection: {
						id: conn.id,
						type: "openai",
						// A trailing slash is spelling, not another host.
						baseUrl: "http://saved-host:1234/v1/",
						extraJson: { apiKey: "" }
					} as any
				},
				noopEmit
			)
			const { row, models } = await readBack(conn.id)
			expect(row.modelsSyncedAt?.getTime()).toBeGreaterThan(
				SYNCED_AT.getTime()
			)
			expect(models.map((m) => m.model).sort()).toEqual([
				"new-model",
				"saved-model"
			])
		} finally {
			stubAdapter = null
		}
	})
})
