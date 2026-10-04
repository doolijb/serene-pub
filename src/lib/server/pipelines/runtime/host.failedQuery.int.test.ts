/**
 * A query that fails under the pipeline host leaves it as the plain sentence.
 *
 * The executor keeps only a thrown error's `message`, and that message is the
 * node's reason, the run's `haltReason`, the reply row's error that every
 * member of the session reads, and the `reply-failed` notification. Since
 * drizzle-orm 0.44 a failed query's message is its SQL and every value it
 * bound — here a value that stands in for a person's text — so the host
 * answers it plainly and puts the whole error in the server log. A real query
 * fails here (a text id against an integer column), not a stand-in.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { isFailedQuery, QUERY_FAILED_SENTENCE } from "$lib/server/db/errors"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const SECRET = "SECRET-not-a-number-z4"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-host-failedquery-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const node = {
	key: "history",
	definitionId: "core:query/session-messages",
	definitionVersion: 1,
	kind: "query"
}

describe("a failed query under the host", () => {
	test("reaches the run as the plain sentence, and the server log as the whole error", async () => {
		const { createHost } = await import("./host")
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			// The scope's session id is the bound value: Postgres refuses it
			// for an integer column, and drizzle's message carries it.
			const host = createHost(db as any, { sessionId: SECRET as any })
			const thrown = await Promise.resolve(
				host.read!("session_messages", {}, node as any)
			).catch((e: unknown) => e)

			expect(thrown).toBeInstanceOf(Error)
			expect((thrown as Error).message).toBe(QUERY_FAILED_SENTENCE)
			// What the executor would store, and every road after it.
			expect(JSON.stringify({ reason: (thrown as Error).message })).not.toMatch(
				new RegExp(`Failed query|select|${SECRET}`, "i")
			)
			// The whole error is the cause (for `console.error`'s inspection)…
			expect(isFailedQuery((thrown as Error).cause)).toBe(true)
			// …and it was logged once, naming the node.
			const call = logged.mock.calls.find((c) => String(c[0]).includes("history"))
			expect(call).toBeTruthy()
			expect(isFailedQuery(call![1])).toBe(true)
			expect(String((call![1] as Error).message)).toContain(SECRET)
		} finally {
			logged.mockRestore()
		}
	})

	test("an ordinary refusal passes through as the same object", async () => {
		const { createHost, HostScopeError } = await import("./host")
		const host = createHost(db as any, { sessionId: 1 })
		// Another session's history is refused by scope, not by the database.
		const thrown = await Promise.resolve(
			host.read!("session_messages", { sessionId: 2 }, node as any)
		).catch((e: unknown) => e)
		expect(thrown).toBeInstanceOf(HostScopeError)
	})
})
