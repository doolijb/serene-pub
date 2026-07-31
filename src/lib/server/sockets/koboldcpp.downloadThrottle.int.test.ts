/**
 * The actual "why are koboldcpp downloads slow" root cause: both
 * koboldCppDownloadModelHandler and binaryManager.downloadVariant attached
 * a `res.on("data", chunk => { ...; emitDownloadProgress() })` listener
 * alongside `.pipe(writer)` — for a multi-GB file, that fired the
 * broadcast (JSON-serialize + Socket.IO emit to every registered admin)
 * on every single TCP chunk, competing with the download's own network
 * I/O on Node's single event loop. Fixed with a leading-edge time
 * throttle (PROGRESS_EMIT_THROTTLE_MS) on the broadcast only — the byte
 * counter itself (read by the pull-based koboldCppGetDownloadProgressHandler)
 * still updates on every chunk.
 *
 * This test drives a fake https response that fires many "data" events
 * synchronously (simulating rapid real-world delivery) and asserts the
 * broadcast count collapses to a handful, not one-per-chunk, while the
 * download still completes successfully.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

const CHUNK_COUNT = 200

function makeFakeHttpsModule() {
	return {
		get(url: string, optionsOrCb: any, maybeCb?: (res: any) => void) {
			// The real download handler now issues a 1-byte Range probe
			// first (3-arg get(url, options, cb)) before the actual
			// download request — support both call shapes. Always
			// responding 200 (not 206) here means the probe is answered as
			// "range unsupported", so the resolve step hands this exact
			// response straight to the fallback path with no second
			// request — the single-`get`-call flow this test relies on.
			const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb!
			const dataListeners: Array<(chunk: Buffer) => void> = []
			const res: any = {
				statusCode: 200,
				headers: { "content-length": String(CHUNK_COUNT * 1024) },
				on(event: string, handler: any) {
					if (event === "data") dataListeners.push(handler)
					return res
				},
				pipe(dest: any) {
					// Fire every chunk synchronously, back-to-back — the
					// realistic worst case for a fast connection, where
					// thousands of "data" events can arrive within a single
					// throttle window.
					for (let i = 0; i < CHUNK_COUNT; i++) {
						for (const handler of dataListeners) {
							handler(Buffer.alloc(1024))
						}
					}
					dest.end()
					return dest
				}
			}
			const req: any = {
				on: () => req,
				once: () => req,
				destroy: () => {}
			}
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
		path.join(os.tmpdir(), "serene-pub-koboldcpp-throttle-int-test-")
	)
	modelsDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-koboldcpp-throttle-models-dir-")
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
	return {
		user: { id: userId, isAdmin: true },
		on: () => {}
	} as any
}

const noopRegister = () => {}

describe("koboldcpp:downloadModel — progress broadcast throttling", () => {
	test("hundreds of rapid chunk arrivals collapse into a handful of broadcasts, not one per chunk", async () => {
		const { koboldCppDownloadModelHandler, registerKoboldCppHandlers } =
			await import("./koboldcpp")
		const admin = await makeAdmin("kcpp-throttle-user")

		const emitToUser = vi.fn()
		registerKoboldCppHandlers(fakeSocket(admin.id), emitToUser, noopRegister)

		await koboldCppDownloadModelHandler.handler(
			fakeSocket(admin.id),
			{
				filename: "throttle-test-model.gguf",
				downloadUrl: "https://huggingface.co/test/throttle-test-model.gguf",
				modelName: "Throttle Test Model"
			} as any,
			() => {}
		)

		// The download runs in a fire-and-forget background IIFE — give the
		// synchronous fake-stream chain (which resolves via a real
		// fs.createWriteStream "finish" event, a couple of microtask ticks
		// away) a moment to settle.
		await new Promise((resolve) => setTimeout(resolve, 50))

		const progressCalls = emitToUser.mock.calls.filter(
			([event]) => event === "koboldcpp:downloadProgress"
		)
		// 200 chunks fired synchronously within one throttle window should
		// collapse to a small, bounded number of broadcasts (the
		// unconditional start/downloading/success transitions plus at most
		// one or two throttled ticks) — nowhere near CHUNK_COUNT.
		expect(progressCalls.length).toBeGreaterThan(0)
		expect(progressCalls.length).toBeLessThan(10)

		const finalCall = progressCalls[progressCalls.length - 1]?.[1]
		expect(
			finalCall?.downloads?.["throttle-test-model.gguf"]?.status
		).toBe("success")
		expect(
			finalCall?.downloads?.["throttle-test-model.gguf"]?.downloaded
		).toBe(CHUNK_COUNT * 1024)
	})
})
