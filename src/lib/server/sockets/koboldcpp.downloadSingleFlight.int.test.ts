/**
 * Plan A6 (connections bug-fix 2026-10-11): the "already downloading this
 * file" check and the concurrency cap both read `activeDownloads`, but the
 * entry was only written after the models-folder mkdir and the DB upsert —
 * two awaits later. Two presses of one Download both passed the check and
 * started two writers on one file. The claim now lands in the same
 * synchronous run as the checks.
 *
 * https/http are mocked so the background downloads never settle and make no
 * network call (see koboldcpp.downloadCapAndRateLimit.int.test.ts).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("https", () => ({ get: () => ({ on: () => {} }) }))
vi.mock("http", () => ({ get: () => ({ on: () => {} }) }))

let testDb: TestDb
let modelsDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-singleflight-models-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.koboldCppSettings)
		.values({ id: 1, koboldCppManagerModelsDir: modelsDir })
}, 60_000)

afterAll(async () => {
	await fs.rm(modelsDir, { recursive: true, force: true })
})

describe("koboldcpp:downloadModel — single flight per filename", () => {
	test("two simultaneous presses of one Download start it once", async () => {
		const { koboldCppDownloadModelHandler } = await import("./koboldcpp")
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: "koboldcpp-singleflight-user", isAdmin: true })
			.returning()
		const socket = { user: { id: admin.id, isAdmin: true } } as any
		const errors: string[] = []
		const emit = (event: string, data: any) => {
			if (event === "koboldcpp:downloadModel:error")
				errors.push(data.error)
		}
		const params = {
			filename: "single-flight.gguf",
			downloadUrl: "https://huggingface.co/test/single-flight.gguf",
			modelName: "Single Flight"
		} as any

		const results = await Promise.all([
			koboldCppDownloadModelHandler.handler(socket, params, emit),
			koboldCppDownloadModelHandler.handler(socket, params, emit)
		])

		expect(results.filter((r) => r.success === true)).toHaveLength(1)
		expect(results.filter((r) => r.success === false)).toHaveLength(1)
		expect(errors).toEqual(["Already downloading this file"])
	})
})
