import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest"
import http from "http"
import { SesWorkerRuntime } from "./SesWorkerRuntime"
import { QuickJsRuntime } from "./QuickJsRuntime"
import type { PluginRuntime } from "./types"

/**
 * The mediated fetch capability against a real local server: allowed hosts pass,
 * others and the no-grant case are refused. Async (SES) only — QuickJS refuses,
 * so network is a SES-backend capability.
 */

let server: http.Server
let baseUrl: string
const host = "127.0.0.1"

beforeAll(async () => {
	server = http.createServer((req, res) => {
		res.writeHead(200, { "content-type": "text/plain" })
		res.end("hello:" + req.method)
	})
	await new Promise<void>((r) => server.listen(0, host, () => r()))
	const addr = server.address() as { port: number }
	baseUrl = `http://${host}:${addr.port}/`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

let rt: PluginRuntime
afterEach(async () => {
	await rt?.dispose()
})

const HOOK = `module.exports = { hooks: {
	get: async function (input, ctx) {
		var res = await ctx.fetch(input.url);
		return { status: res.status, ok: res.ok, body: res.body };
	}
} }`

const opts = (input: Record<string, unknown>) => ({
	input,
	timeoutMs: 4000,
	seedLabel: "s",
	nowMs: 1
})

describe("fetch capability (SES)", () => {
	it("fetches an allowed host", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke({ pluginId: "p", hookName: "get" }, opts({ url: baseUrl }))
		expect(r.ok).toBe(true)
		if (r.ok) {
			const v = r.value as { status: number; ok: boolean; body: string }
			expect(v.status).toBe(200)
			expect(v.ok).toBe(true)
			expect(v.body).toBe("hello:GET")
		}
	}, 10_000)

	it("denies a host not in the allowlist", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: ["example.com"] })
		const r = await rt.invoke({ pluginId: "p", hookName: "get" }, opts({ url: baseUrl }))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
	}, 10_000)

	it("denies fetch without a network grant", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h") // no networkHosts
		const r = await rt.invoke({ pluginId: "p", hookName: "get" }, opts({ url: baseUrl }))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/permission not granted/)
	}, 10_000)

	it("rejects non-http(s) schemes", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: "file:///etc/passwd" })
		)
		expect(r.ok).toBe(false)
	}, 10_000)
})

describe("fetch on QuickJS", () => {
	it("is refused — network is a SES-backend capability", async () => {
		rt = new QuickJsRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke({ pluginId: "p", hookName: "get" }, opts({ url: baseUrl }))
		expect(r.ok).toBe(false) // async hook refused + ctx.fetch throws "requires SES"
	}, 10_000)
})
