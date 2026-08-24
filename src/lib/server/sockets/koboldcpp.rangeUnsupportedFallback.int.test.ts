/**
 * When the resolve step's 1-byte Range probe comes back as a normal 200
 * (not 206 with a content-range), the target doesn't support range
 * requests — koboldCppDownloadModelHandler must fall back to the original
 * single-stream download, reusing the probe's own in-flight response as the
 * body (no second HTTP request), rather than failing outright.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Readable } from "stream"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const BODY = Buffer.from("range-unsupported-full-body-content")

let getCallCount = 0

class FakeAgent {
	destroy() {}
}

function makeFakeHttpsModule() {
	return {
		Agent: FakeAgent,
		get(url: string, optionsOrCb: any, maybeCb?: (res: any) => void) {
			getCallCount++
			const cb =
				typeof optionsOrCb === "function" ? optionsOrCb : maybeCb!
			const req: any = { on: () => req, destroy: () => {} }

			// No Range support at all — always answer 200 with the full body,
			// exactly what a server ignoring the Range header would do.
			const res: any = new Readable({ read() {} })
			res.statusCode = 200
			res.headers = { "content-length": String(BODY.length) }
			cb(res)
			res.push(BODY)
			res.push(null)

			return req
		}
	}
}

vi.mock("https", () => makeFakeHttpsModule())
vi.mock("http", () => makeFakeHttpsModule())

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
		path.join(os.tmpdir(), "serene-pub-koboldcpp-fallback-int-test-")
	)
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-fallback-models-dir-")
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
	return { user: { id: userId, isAdmin: true }, on: () => {} } as any
}

const noopEmit = () => {}

async function waitForDone(
	getHandler: any,
	admin: any,
	filename: string,
	timeoutMs = 10_000
) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const res = await getHandler.handler(fakeSocket(admin.id), {}, noopEmit)
		const entry = res.downloads[filename]
		if (entry?.isDone) return entry
		await new Promise((r) => setTimeout(r, 20))
	}
	throw new Error("timed out waiting for download to finish")
}

describe("koboldcpp:downloadModel — range-unsupported fallback", () => {
	test("falls back to the resolve probe's own response body with no second request", async () => {
		const {
			koboldCppDownloadModelHandler,
			koboldCppGetDownloadProgressHandler
		} = await import("./koboldcpp")
		const admin = await makeAdmin("kcpp-fallback-user")

		const filename = "fallback-test-model.gguf"
		await koboldCppDownloadModelHandler.handler(
			fakeSocket(admin.id),
			{
				filename,
				downloadUrl: `https://huggingface.co/test/${filename}`,
				modelName: "Fallback Test Model"
			} as any,
			noopEmit
		)

		const finalEntry = await waitForDone(
			koboldCppGetDownloadProgressHandler,
			admin,
			filename
		)
		expect(finalEntry.status).toBe("success")
		expect(finalEntry.downloaded).toBe(BODY.length)
		expect(getCallCount).toBe(1)

		const destPath = path.join(modelsDir, filename)
		const written = await fs.readFile(destPath)
		expect(written.equals(BODY)).toBe(true)
	}, 15_000)
})
