/**
 * The actual "why are koboldcpp downloads slow" root cause, binary-download
 * side: downloadVariant() attached a `res.on("data", chunk => { ...;
 * emitProgress() })` listener alongside `.pipe(writer)` — for a large
 * binary, that fired the broadcast on every single TCP chunk, competing
 * with the download's own network I/O on Node's single event loop. Fixed
 * with a leading-edge time throttle (PROGRESS_EMIT_THROTTLE_MS) on the
 * broadcast only — the byte counter itself still updates on every chunk.
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

const CHUNK_COUNT = 200

function makeFakeHttpsModule() {
	return {
		get(url: string, cb: (res: any) => void) {
			const dataListeners: Array<(chunk: Buffer) => void> = []
			const res: any = {
				statusCode: 200,
				headers: { "content-length": String(CHUNK_COUNT * 1024) },
				on(event: string, handler: any) {
					if (event === "data") dataListeners.push(handler)
					return res
				},
				pipe(dest: any) {
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
				destroy: () => {}
			}
			cb(res)
			return req
		}
	}
}

vi.mock("https", () => makeFakeHttpsModule())
vi.mock("http", () => makeFakeHttpsModule())

let destDir: string

beforeAll(async () => {
	destDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-binarymgr-throttle-")
	)
})

afterAll(async () => {
	await fs.rm(destDir, { recursive: true, force: true })
})

describe("binaryManager.downloadVariant — progress broadcast throttling", () => {
	test("hundreds of rapid chunk arrivals collapse into a handful of broadcasts, not one per chunk", async () => {
		const { registerEmitter, unregisterEmitter, downloadVariant } =
			await import("./binaryManager")

		const emit = vi.fn()
		registerEmitter(1, emit)

		await downloadVariant({
			assetName: "throttle-test-binary.bin",
			downloadUrl: "https://github.com/test/throttle-test-binary.bin",
			destDir
		})

		unregisterEmitter(1)

		expect(emit.mock.calls.length).toBeGreaterThan(0)
		expect(emit.mock.calls.length).toBeLessThan(10)

		const finalCall = emit.mock.calls[emit.mock.calls.length - 1][0]
		expect(finalCall.download?.status).toBe("success")
		expect(finalCall.download?.downloaded).toBe(CHUNK_COUNT * 1024)
	})
})
