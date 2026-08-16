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
		loginRateLimit.clearRateLimit("connections:test")
		const admin = await makeAdmin("connections-test-unsupported-user")

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
		// in this process — the "connections:test" key may already carry
		// attempts from other tests (in this file or elsewhere) sharing it.
		// Reset it so this test's own count is deterministic.
		loginRateLimit.clearRateLimit("connections:test")

		const results: boolean[] = []
		for (let i = 0; i < 6; i++) {
			const res = await connectionsTest.handler(
				fakeSocket(admin.id),
				{
					connection: {
						type: "rate-limit-probe-" + i
					} as any
				},
				noopEmit
			)
			results.push(/rate limited/i.test(res.error ?? ""))
		}

		expect(results.slice(0, 5)).toEqual([false, false, false, false, false])
		expect(results[5]).toBe(true)
	})
})
