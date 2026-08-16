/**
 * If any one chunk request in a parallel chunked download fails terminally
 * (a non-206 status, or a socket error), the whole download must fail —
 * and every other still-in-flight chunk request should be destroyed rather
 * than left dangling. This drives one chunk request to a hard error while
 * others are still pending, and asserts the siblings get destroyed and the
 * download's final state is "error" (not "cancelled" — that string is
 * reserved for user-initiated abort()).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Readable } from "stream"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const TOTAL = 150 * 1024 * 1024

const chunkRequests: Array<{ range: string; req: any }> = []
let failedOneChunk = false

class FakeAgent {
	destroy() {}
}

function makeFakeHttpsModule() {
	return {
		Agent: FakeAgent,
		get(url: string, optionsOrCb: any, maybeCb?: (res: any) => void) {
			const options = typeof optionsOrCb === "function" ? {} : optionsOrCb
			const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb!
			const range: string = options?.headers?.Range ?? "(none)"
			const req: any = { on: () => req, destroy: vi.fn() }

			if (range === "bytes=0-0") {
				const res: any = new Readable({ read() {} })
				res.statusCode = 206
				res.headers = { "content-range": `bytes 0-0/${TOTAL}` }
				cb(res)
				res.push(Buffer.alloc(1))
				res.push(null)
				return req
			}

			chunkRequests.push({ range, req })

			// The first chunk request to arrive fails outright (a non-206
			// status, eg. a transient 500) — every sibling chunk request
			// stays pending (no data pushed) until the caller's cleanup
			// destroys them.
			if (!failedOneChunk) {
				failedOneChunk = true
				const res: any = new Readable({ read() {} })
				res.statusCode = 500
				res.headers = {}
				cb(res)
				res.push(null)
				return req
			}

			const match = range.match(/bytes=(\d+)-(\d+)/)
			const start = match ? parseInt(match[1], 10) : 0
			const end = match ? parseInt(match[2], 10) : TOTAL - 1
			const res: any = new Readable({ read() {} })
			res.statusCode = 206
			res.headers = { "content-range": `bytes ${start}-${end}/${TOTAL}` }
			cb(res)
			// Never pushes data — stays pending until destroyed.

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
		path.join(os.tmpdir(), "serene-pub-koboldcpp-chunkerror-int-test-")
	)
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-chunkerror-models-dir-")
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

async function waitUntil(
	check: () => boolean | Promise<boolean>,
	timeoutMs = 10_000
) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		if (await check()) return
		await new Promise((r) => setTimeout(r, 20))
	}
	throw new Error("timed out waiting for condition")
}

describe("koboldcpp:downloadModel — one chunk erroring aborts the rest", () => {
	test("destroys sibling in-flight chunk requests and marks the download as error", async () => {
		const {
			koboldCppDownloadModelHandler,
			koboldCppGetDownloadProgressHandler
		} = await import("./koboldcpp")
		const admin = await makeAdmin("kcpp-chunk-error-user")

		const filename = "chunk-error-test-model.gguf"
		await koboldCppDownloadModelHandler.handler(
			fakeSocket(admin.id),
			{
				filename,
				downloadUrl: `https://huggingface.co/test/${filename}`,
				modelName: "Chunk Error Test Model"
			} as any,
			noopEmit
		)

		await waitUntil(async () => {
			const res = await koboldCppGetDownloadProgressHandler.handler(
				fakeSocket(admin.id),
				{},
				noopEmit
			)
			return res.downloads[filename]?.isDone === true
		})

		const finalRes = await koboldCppGetDownloadProgressHandler.handler(
			fakeSocket(admin.id),
			{},
			noopEmit
		)
		expect(finalRes.downloads[filename].status).toBe("error")

		const dbRow = await testDb.query.koboldCppModels.findFirst({
			where: (models, { eq }) => eq(models.filename, filename)
		})
		expect(dbRow?.status).toBe("error")
		expect(dbRow?.errorMessage).toBeTruthy()

		// Every chunk request that was in flight when the error hit (the
		// failing one plus any pending siblings) should have been destroyed
		// as part of cleanup — none left dangling.
		expect(chunkRequests.length).toBeGreaterThanOrEqual(1)
		for (const { req } of chunkRequests) {
			expect(req.destroy).toHaveBeenCalled()
		}
	}, 15_000)
})
