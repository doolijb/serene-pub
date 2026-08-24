/**
 * KoboldCPP model downloads previously used a single sequential HTTP
 * connection, which throughput-caps well below what Hugging Face's CDN can
 * sustain across parallel connections (the same reason hf_transfer/aria2c
 * exist). koboldCppDownloadModelHandler now resolves the download once via
 * a 1-byte Range probe, then — when the target supports ranges — splits the
 * file into byte-range chunks and downloads them concurrently via a bounded
 * worker pool, writing each chunk at its exact offset through a single
 * shared FileHandle's positional writes.
 *
 * This test drives a fake https module whose responses stream deterministic
 * content (byte value at absolute offset P == P % 256) across a file large
 * enough to require multiple 64MB chunks, and verifies: (a) more than one
 * distinct Range was requested (proves chunking actually happened, not a
 * silent single-request fallback), (b) the written file's bytes are correct
 * at sampled offsets spanning every chunk boundary (proves positional
 * writes land at the right place regardless of which worker handled them),
 * and (c) the download completes with the correct total.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Readable } from "stream"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

// Larger than 2x the real PARALLEL_CHUNK_SIZE_BYTES (64MB) so at least 3
// chunks are required — chosen without needing to know the exact constant,
// since verification below is offset-based (byte value == offset % 256),
// not chunk-boundary-based.
const TOTAL = 150 * 1024 * 1024

const requestedRanges: string[] = []

class FakeAgent {
	destroy() {}
}

function makeFakeHttpsModule() {
	return {
		Agent: FakeAgent,
		get(url: string, optionsOrCb: any, maybeCb?: (res: any) => void) {
			const options = typeof optionsOrCb === "function" ? {} : optionsOrCb
			const cb =
				typeof optionsOrCb === "function" ? optionsOrCb : maybeCb!
			const range: string | undefined = options?.headers?.Range
			requestedRanges.push(range ?? "(none)")

			const req: any = {
				_errorHandlers: [] as Array<(err: Error) => void>,
				on(event: string, handler: any) {
					if (event === "error") this._errorHandlers.push(handler)
					return req
				},
				destroy() {
					for (const h of this._errorHandlers)
						h(new Error("destroyed"))
				}
			}

			if (range === "bytes=0-0") {
				const res: any = new Readable({ read() {} })
				res.statusCode = 206
				res.headers = { "content-range": `bytes 0-0/${TOTAL}` }
				cb(res)
				res.push(Buffer.alloc(1))
				res.push(null)
				return req
			}

			const match = range?.match(/bytes=(\d+)-(\d+)/)
			const start = match ? parseInt(match[1], 10) : 0
			const end = match ? parseInt(match[2], 10) : TOTAL - 1
			const res: any = new Readable({ read() {} })
			res.statusCode = 206
			res.headers = { "content-range": `bytes ${start}-${end}/${TOTAL}` }
			cb(res)

			let pos = start
			const pump = () => {
				if (pos > end) {
					res.push(null)
					return
				}
				const len = Math.min(65536, end - pos + 1)
				const buf = Buffer.alloc(len)
				for (let i = 0; i < len; i++) buf[i] = (pos + i) % 256
				res.push(buf)
				pos += len
				setImmediate(pump)
			}
			pump()

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
		path.join(os.tmpdir(), "serene-pub-koboldcpp-parallel-int-test-")
	)
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-parallel-models-dir-")
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
	timeoutMs = 15_000
) {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		const res = await getHandler.handler(fakeSocket(admin.id), {}, noopEmit)
		const entry = res.downloads[filename]
		if (entry?.isDone) return entry
		await new Promise((r) => setTimeout(r, 25))
	}
	throw new Error("timed out waiting for download to finish")
}

describe("koboldcpp:downloadModel — parallel chunked download", () => {
	test("splits a large file into multiple range requests and writes every byte at its correct offset", async () => {
		const {
			koboldCppDownloadModelHandler,
			koboldCppGetDownloadProgressHandler
		} = await import("./koboldcpp")
		const admin = await makeAdmin("kcpp-parallel-user")

		const filename = "parallel-test-model.gguf"
		await koboldCppDownloadModelHandler.handler(
			fakeSocket(admin.id),
			{
				filename,
				downloadUrl: `https://huggingface.co/test/${filename}`,
				modelName: "Parallel Test Model"
			} as any,
			noopEmit
		)

		const finalEntry = await waitForDone(
			koboldCppGetDownloadProgressHandler,
			admin,
			filename
		)
		expect(finalEntry.status).toBe("success")
		expect(finalEntry.downloaded).toBe(TOTAL)
		expect(finalEntry.total).toBe(TOTAL)

		// Proves chunking actually happened: the probe (bytes=0-0) plus more
		// than one distinct real chunk range.
		const distinctChunkRanges = new Set(
			requestedRanges.filter((r) => r !== "bytes=0-0")
		)
		expect(distinctChunkRanges.size).toBeGreaterThan(1)

		const destPath = path.join(modelsDir, filename)
		const stat = await fs.stat(destPath)
		expect(stat.size).toBe(TOTAL)

		const fh = await fs.open(destPath, "r")
		try {
			const samples = [
				0,
				1000,
				64 * 1024 * 1024 - 1,
				64 * 1024 * 1024,
				128 * 1024 * 1024 - 1,
				128 * 1024 * 1024,
				TOTAL - 1
			]
			for (const offset of samples) {
				const buf = Buffer.alloc(1)
				await fh.read(buf, 0, 1, offset)
				expect(buf[0]).toBe(offset % 256)
			}
		} finally {
			await fh.close()
		}
	}, 30_000)
})
