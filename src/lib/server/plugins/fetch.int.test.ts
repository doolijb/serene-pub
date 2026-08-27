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
let port = 0
const host = "127.0.0.1"

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const url = req.url || "/"
		// Redirect to a host that is NOT in any test's allowlist — the classic
		// "allowlisted host bounces you to a forbidden target" SSRF.
		if (url.indexOf("/redir-external") === 0) {
			res.writeHead(302, { location: "http://blocked.example/evil" })
			return res.end()
		}
		// Redirect to the cloud-metadata endpoint (also not allowlisted).
		if (url.indexOf("/redir-metadata") === 0) {
			res.writeHead(302, {
				location: "http://169.254.169.254/latest/meta-data/"
			})
			return res.end()
		}
		// Redirect within the same (allowlisted) host — must be followed.
		if (url.indexOf("/redir-same") === 0) {
			res.writeHead(302, { location: "/final" })
			return res.end()
		}
		res.writeHead(200, { "content-type": "text/plain" })
		res.end("hello:" + req.method + ":" + url)
	})
	await new Promise<void>((r) => server.listen(0, host, () => r()))
	const addr = server.address() as { port: number }
	port = addr.port
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
			expect(v.body).toBe("hello:GET:/")
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

	// The redirect-SSRF fix: the allowlist is re-checked on every hop, so an
	// allowlisted host cannot bounce the request to a forbidden target.
	it("refuses a redirect to a host outside the allowlist", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl + "redir-external" })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
	}, 10_000)

	it("refuses a redirect to the cloud-metadata endpoint", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl + "redir-metadata" })
		)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
	}, 10_000)

	// Port scoping: an explicit host:port grant binds the request to that port.
	it("honours an explicit host:port grant and rejects the wrong port", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [`${host}:${port}`] })
		const ok = await rt.invoke({ pluginId: "p", hookName: "get" }, opts({ url: baseUrl }))
		expect(ok.ok).toBe(true)
		await rt.dispose()

		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [`${host}:1`] })
		const bad = await rt.invoke({ pluginId: "p", hookName: "get" }, opts({ url: baseUrl }))
		expect(bad.ok).toBe(false)
		if (!bad.ok) expect(bad.reason).toMatch(/not permitted/)
	}, 15_000)

	// A bare-hostname / wildcard grant reaches only the default web ports, so the
	// ephemeral test port is refused even though the host matches — closing the
	// any-port hole a bare grant used to leave open.
	it("refuses a wildcard grant on a non-web port", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: ["*"] })
		const r = await rt.invoke({ pluginId: "p", hookName: "get" }, opts({ url: baseUrl }))
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.reason).toMatch(/not permitted/)
	}, 10_000)

	it("still follows a redirect within an allowlisted host", async () => {
		rt = new SesWorkerRuntime()
		await rt.load("p", HOOK, "h", { networkHosts: [host] })
		const r = await rt.invoke(
			{ pluginId: "p", hookName: "get" },
			opts({ url: baseUrl + "redir-same" })
		)
		expect(r.ok).toBe(true)
		if (r.ok) {
			const v = r.value as { status: number; ok: boolean; body: string }
			expect(v.status).toBe(200)
			expect(v.body).toBe("hello:GET:/final") // landed on the redirect target
		}
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
