/**
 * Regression test for a real bug found while adding parallel chunked
 * downloads: the old single-stream download's `abort()` was bound only to
 * the *first* HTTP request. Once a redirect (or, now, a chunked download)
 * was underway, the actual streaming connection(s) were never captured by
 * `abort()` — cancelling mid-download rejected the outer promise and
 * triggered cleanup while the real connection(s) could still be writing to
 * disk in the background.
 *
 * koboldCppDownloadModelHandler now tracks every in-flight request (probe +
 * every chunk) in a shared Set, and abort() destroys all of them. This test
 * starts a chunked download whose chunk requests never resolve (simulating
 * genuinely in-progress downloads), cancels it, and asserts every chunk
 * request that had been issued so far was destroyed — not just the first.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Readable } from "stream"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

// Larger than 2x the real PARALLEL_CHUNK_SIZE_BYTES (64MB) so at least 3
// chunk requests are issued — enough to prove "every in-flight chunk", not
// just one, gets destroyed on cancel.
const TOTAL = 150 * 1024 * 1024

const createdRequests: Array<{ range: string; req: any }> = []

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
			createdRequests.push({ range, req })

			if (range === "bytes=0-0") {
				const res: any = new Readable({ read() {} })
				res.statusCode = 206
				res.headers = { "content-range": `bytes 0-0/${TOTAL}` }
				cb(res)
				res.push(Buffer.alloc(1))
				res.push(null)
				return req
			}

			// Chunk requests: respond with headers but never push data or end
			// the stream — these stay "in progress" until destroy()'d.
			const match = range.match(/bytes=(\d+)-(\d+)/)
			const start = match ? parseInt(match[1], 10) : 0
			const end = match ? parseInt(match[2], 10) : TOTAL - 1
			const res: any = new Readable({ read() {} })
			res.statusCode = 206
			res.headers = { "content-range": `bytes ${start}-${end}/${TOTAL}` }
			cb(res)
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
		path.join(os.tmpdir(), "serene-pub-koboldcpp-cancel-int-test-")
	)
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-cancel-models-dir-")
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

describe("koboldcpp:cancelDownload — chunked in-flight requests", () => {
	test("destroys every in-flight chunk request, not just the first", async () => {
		const {
			koboldCppDownloadModelHandler,
			koboldCppCancelDownloadHandler,
			koboldCppGetDownloadProgressHandler
		} = await import("./koboldcpp")
		const admin = await makeAdmin("kcpp-cancel-user")

		const filename = "cancel-test-model.gguf"
		await koboldCppDownloadModelHandler.handler(
			fakeSocket(admin.id),
			{
				filename,
				downloadUrl: `https://huggingface.co/test/${filename}`,
				modelName: "Cancel Test Model"
			} as any,
			noopEmit
		)

		// Wait until at least 2 real chunk requests (beyond the probe) have
		// been issued, proving the worker pool is genuinely running multiple
		// concurrent connections before we cancel.
		await waitUntil(
			() =>
				createdRequests.filter((r) => r.range !== "bytes=0-0").length >= 2
		)

		const chunkRequestsBeforeCancel = createdRequests.filter(
			(r) => r.range !== "bytes=0-0"
		)
		expect(chunkRequestsBeforeCancel.length).toBeGreaterThanOrEqual(2)

		await koboldCppCancelDownloadHandler.handler(
			fakeSocket(admin.id),
			{ filename },
			noopEmit
		)

		for (const { req } of chunkRequestsBeforeCancel) {
			expect(req.destroy).toHaveBeenCalled()
		}

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
		expect(finalRes.downloads[filename].status).toBe("cancelled")

		const dbRow = await testDb.query.koboldCppModels.findFirst({
			where: eq(schema.koboldCppModels.filename, filename)
		})
		expect(dbRow).toBeUndefined()

		const destPath = path.join(modelsDir, filename)
		await expect(fs.access(destPath)).rejects.toThrow()
	}, 15_000)
})
