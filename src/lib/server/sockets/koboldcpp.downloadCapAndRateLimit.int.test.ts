/**
 * Round-10 audit fix (LOW): koboldCppDownloadModelHandler only guarded
 * re-downloading the exact same filename — nothing capped the number of
 * distinct concurrent downloads, unlike binaryManager's own single-flight
 * guard. Fixed with MAX_CONCURRENT_MODEL_DOWNLOADS.
 *
 * Also (LOW): koboldCppSearchModelsHandler hit Hugging Face on every call
 * with no throttling. Fixed by reusing loginRateLimit, same as
 * connections.ts.
 *
 * The actual file download runs in a fire-and-forget async IIFE (the
 * handler itself returns as soon as the DB row + in-memory tracking entry
 * are written, "so we can return immediately" per its own comment) — https/
 * http are mocked here so those background downloads never resolve
 * (simulating 3 genuinely still-in-progress downloads) without making any
 * real network call or leaving dangling connections after the test exits.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
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

vi.mock("https", () => ({ get: () => ({ on: () => {} }) }))
vi.mock("http", () => ({ get: () => ({ on: () => {} }) }))

let testDb: TestDb
let dataDir: string
let modelsDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-download-int-test-")
	)
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-models-dir-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb
		.insert(schema.koboldCppSettings)
		.values({ id: 1, koboldCppManagerModelsDir: modelsDir })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
	await fs.rm(modelsDir, { recursive: true, force: true })
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

describe("koboldcpp:downloadModel — concurrent download cap", () => {
	test("a 4th concurrent download for a different filename is rejected once 3 are in progress", async () => {
		const { koboldCppDownloadModelHandler } = await import("./koboldcpp")
		const admin = await makeAdmin("koboldcpp-download-cap-user")

		for (let i = 0; i < 3; i++) {
			const res = await koboldCppDownloadModelHandler.handler(
				fakeSocket(admin.id),
				{
					filename: `cap-test-model-${i}.gguf`,
					downloadUrl: `https://huggingface.co/test/cap-test-model-${i}.gguf`,
					modelName: `Cap Test Model ${i}`
				} as any,
				noopEmit
			)
			expect(res.success).not.toBe(false)
		}

		const rejected = await koboldCppDownloadModelHandler.handler(
			fakeSocket(admin.id),
			{
				filename: "cap-test-model-overflow.gguf",
				downloadUrl:
					"https://huggingface.co/test/cap-test-model-overflow.gguf",
				modelName: "Overflow Model"
			} as any,
			noopEmit
		)
		expect(rejected.success).toBe(false)
	})
})

describe("koboldcpp:searchModels — rate limiting", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("the 6th call within the window is rejected as rate limited", async () => {
		const { koboldCppSearchModelsHandler } = await import("./koboldcpp")
		const { loginRateLimit } = await import(
			"$lib/server/services/loginRateLimit"
		)
		loginRateLimit.clearRateLimit("koboldcpp:searchModels")
		const admin = await makeAdmin("koboldcpp-search-ratelimit-user")

		// Avoid any real HTTPS call to huggingface.co for the calls that
		// pass the rate-limit check — fetch itself isn't under test here.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ models: [] })
			}))
		)

		const errors: string[] = []
		for (let i = 0; i < 6; i++) {
			try {
				await koboldCppSearchModelsHandler.handler(
					fakeSocket(admin.id),
					{ searchTerm: "test" } as any,
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

		vi.unstubAllGlobals()
	})
})
