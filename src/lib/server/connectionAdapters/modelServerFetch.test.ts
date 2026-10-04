/**
 * undici's own timeouts for model-server requests (`modelServerFetch.ts`).
 *
 * Node's fetch ends a response whose body goes quiet for five minutes, and a
 * request whose headers take five — both inside the adapters' own bounds, so
 * a long KoboldCPP prompt-processing silence, or any unstreamed reply over
 * five minutes, failed before the adapter could judge it.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import * as http from "node:http"
import {
	dispatcherWithTimeouts,
	MODEL_SERVER_BODY_TIMEOUT_MS,
	MODEL_SERVER_HEADERS_TIMEOUT_MS,
	modelServerDispatcher,
	modelServerFetch,
	modelServerFetchOptions
} from "./modelServerFetch"
import { LLM_IDLE_TIMEOUT_MS, LLM_NONSTREAMING_TIMEOUT_MS } from "./idleTimeout"

/** undici's defaults — what every model-server request ran on before. */
const UNDICI_DEFAULT_MS = 300_000

describe("the model-server timeouts", () => {
	it("sit above the adapters' own bounds, so the adapter's watchdog always fires first", () => {
		expect(MODEL_SERVER_HEADERS_TIMEOUT_MS).toBeGreaterThan(
			LLM_NONSTREAMING_TIMEOUT_MS
		)
		expect(MODEL_SERVER_BODY_TIMEOUT_MS).toBeGreaterThan(
			LLM_IDLE_TIMEOUT_MS
		)
		expect(MODEL_SERVER_BODY_TIMEOUT_MS).toBeGreaterThan(UNDICI_DEFAULT_MS)
	})

	it("one dispatcher, built once", () => {
		const d = modelServerDispatcher()
		expect(d).toBeDefined()
		expect(modelServerDispatcher()).toBe(d)
		expect(modelServerFetchOptions()).toEqual({ dispatcher: d })
	})
})

describe("modelServerFetch", () => {
	afterEach(() => vi.unstubAllGlobals())

	it("hands the global fetch — read at call time — the model-server dispatcher", async () => {
		const stub = vi.fn(async () => new Response("ok"))
		vi.stubGlobal("fetch", stub)
		await modelServerFetch("http://127.0.0.1:1/x", { method: "POST" })
		expect(stub).toHaveBeenCalledWith(
			"http://127.0.0.1:1/x",
			expect.objectContaining({
				method: "POST",
				dispatcher: modelServerDispatcher()
			})
		)
	})
})

describe("a dispatcher's timeouts are the ones a request runs on (real HTTP)", () => {
	let server: http.Server | undefined
	afterEach(async () => {
		await new Promise<void>((resolve) =>
			server ? server.close(() => resolve()) : resolve()
		)
		server = undefined
	})

	it("a body that goes quiet ends at the dispatcher's bodyTimeout, not undici's default", async () => {
		server = http.createServer((_req, res) => {
			// KoboldCPP's shape: headers at once, then nothing while the
			// prompt is processed.
			res.writeHead(200, { "Content-Type": "text/event-stream" })
			res.write(": open\n\n")
		})
		const port = await new Promise<number>((resolve) =>
			server!.listen(0, "127.0.0.1", () =>
				resolve((server!.address() as any).port)
			)
		)
		const dispatcher = dispatcherWithTimeouts({
			headersTimeout: 5_000,
			bodyTimeout: 150
		})
		expect(dispatcher).toBeDefined()
		const started = Date.now()
		const res = await fetch(`http://127.0.0.1:${port}/`, {
			dispatcher
		} as RequestInit)
		const reader = res.body!.getReader()
		let failure: any
		try {
			while (!(await reader.read()).done) {
				/* drain */
			}
		} catch (e) {
			failure = e
		}
		expect(failure?.cause?.code ?? failure?.code).toBe(
			"UND_ERR_BODY_TIMEOUT"
		)
		expect(Date.now() - started).toBeLessThan(3_000)
		;(dispatcher as { destroy?: () => Promise<void> }).destroy?.()
	}, 10_000)
})
