/**
 * Round-10 audit fix (LOW): ollamaSearchAvailableModelsHandler's Hugging
 * Face branch hit that host on every call with no throttling. Fixed by
 * reusing loginRateLimit, same pattern as connections.ts/koboldcpp.ts.
 * source: "recommended" (not "huggingface") skips the network branch
 * entirely, so this doesn't need to mock fetch — the rate-limit check
 * itself runs before the source switch either way.
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
		path.join(os.tmpdir(), "serene-pub-ollama-search-int-test-")
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

describe("ollama:searchAvailableModels — rate limiting", () => {
	test("the 6th call within the window is rejected as rate limited", async () => {
		const { ollamaSearchAvailableModelsHandler } = await import(
			"./ollama"
		)
		const { loginRateLimit } = await import(
			"$lib/server/services/loginRateLimit"
		)
		loginRateLimit.clearRateLimit("ollama:searchAvailableModels")
		const admin = await makeAdmin("ollama-search-ratelimit-user")

		const errors: string[] = []
		for (let i = 0; i < 6; i++) {
			try {
				await ollamaSearchAvailableModelsHandler.handler(
					fakeSocket(admin.id),
					{ searchTerm: "test", source: "recommended" } as any,
					noopEmit
				)
				errors.push("")
			} catch (err: any) {
				errors.push(err.message)
			}
		}

		expect(errors.slice(0, 5).every((e) => !/rate limited/i.test(e))).toBe(
			true
		)
		expect(errors[5]).toMatch(/rate limited/i)
	})
})
