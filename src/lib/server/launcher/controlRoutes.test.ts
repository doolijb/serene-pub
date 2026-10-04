/**
 * The control routes' guard (CONTRACT §C3): every check alone turns a good
 * request into a bare 404 — and a request shaped like cloudflared's, which
 * arrives from 127.0.0.1, is one of them.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

const services = vi.hoisted(() => ({
	requestShutdown: vi.fn(async (_o: { reason: string; exitCode: number }) => {})
}))
vi.mock("$lib/server/services", () => services)

const startup = vi.hoisted(() => ({
	appReady: Promise.resolve(),
	getDatabaseState: () => ({ ok: true }),
	getStartupFailures: () => [] as string[]
}))
vi.mock("$lib/server/startup", () => startup)

import {
	handleControlRequest,
	healthStateOf,
	hostHeaderHostname,
	isControlPath,
	isControlRequestAllowed,
	isLoopbackPeer,
	tokenMatches,
	type ControlDeps
} from "./controlRoutes"
import { processIdentity } from "./runtimeFile"

const TOKEN = "a".repeat(64)

function goodHeaders(extra: Record<string, string> = {}): Headers {
	return new Headers({
		host: "127.0.0.1:3000",
		authorization: `Bearer ${TOKEN}`,
		...extra
	})
}

function req(over: Partial<{ method: string; pathname: string; peer: string | null; headers: Headers }> = {}) {
	return {
		method: "GET",
		pathname: "/api/launcher/health",
		peer: "127.0.0.1",
		headers: goodHeaders(),
		...over
	}
}

describe("isControlRequestAllowed — the truth table", () => {
	test("a launcher's request passes", () => {
		expect(isControlRequestAllowed(req(), TOKEN)).toBe("health")
		expect(
			isControlRequestAllowed(req({ method: "POST", pathname: "/api/launcher/shutdown" }), TOKEN)
		).toBe("shutdown")
	})

	test.each([["127.0.0.1"], ["127.1.2.3"], ["::1"], ["::ffff:127.0.0.1"]])(
		"loopback peer %s passes",
		(peer) => {
			expect(isControlRequestAllowed(req({ peer }), TOKEN)).toBe("health")
		}
	)

	test.each([["192.168.1.5"], ["10.0.0.1"], ["::ffff:192.168.1.5"], ["fe80::1"], [null]])(
		"peer %s is refused",
		(peer) => {
			expect(isControlRequestAllowed(req({ peer }), TOKEN)).toBeNull()
		}
	)

	test.each([["localhost:3000"], ["127.0.0.1"], ["[::1]:3000"], ["LOCALHOST:3000"]])(
		"Host %s passes",
		(host) => {
			expect(isControlRequestAllowed(req({ headers: goodHeaders({ host }) }), TOKEN)).toBe("health")
		}
	)

	test.each([
		["x.trycloudflare.com"],
		["pub.example.com:443"],
		["192.168.1.5:3000"],
		["127.0.0.1.nip.io"],
		["localhost.evil.com"],
		["127.0.0.1:abc"]
	])("Host %s is refused", (host) => {
		expect(isControlRequestAllowed(req({ headers: goodHeaders({ host }) }), TOKEN)).toBeNull()
	})

	test("a missing Host is refused", () => {
		const headers = goodHeaders()
		headers.delete("host")
		expect(isControlRequestAllowed(req({ headers }), TOKEN)).toBeNull()
	})

	test.each([
		["forwarded", "for=1.2.3.4"],
		["x-forwarded-for", "1.2.3.4"],
		["x-forwarded-host", "pub.example.com"],
		["x-forwarded-proto", "https"],
		["x-real-ip", "1.2.3.4"],
		["cf-connecting-ip", "1.2.3.4"],
		["cf-ray", "8a1b2c3d4e5f-AMS"],
		["cdn-loop", "cloudflare"],
		["via", "1.1 proxy"]
	])("any %s header is refused", (name, value) => {
		expect(isControlRequestAllowed(req({ headers: goodHeaders({ [name]: value }) }), TOKEN)).toBeNull()
	})

	test("an Origin header is refused (a browser page always sends one on POST)", () => {
		expect(
			isControlRequestAllowed(
				req({
					method: "POST",
					pathname: "/api/launcher/shutdown",
					headers: goodHeaders({ origin: "http://127.0.0.1:3000" })
				}),
				TOKEN
			)
		).toBeNull()
	})

	test.each([
		["no header", null],
		["wrong token", `Bearer ${"b".repeat(64)}`],
		["short token", "Bearer abc"],
		["token as Basic", `Basic ${TOKEN}`],
		["bare token", TOKEN]
	])("authorization: %s is refused", (_label, value) => {
		const headers = goodHeaders()
		if (value === null) headers.delete("authorization")
		else headers.set("authorization", value)
		expect(isControlRequestAllowed(req({ headers }), TOKEN)).toBeNull()
	})

	test.each([
		["POST", "/api/launcher/health"],
		["GET", "/api/launcher/shutdown"],
		["GET", "/api/launcher/health/"],
		["GET", "/api/launcher"],
		["DELETE", "/api/launcher/shutdown"]
	])("%s %s is no route", (method, pathname) => {
		expect(isControlRequestAllowed(req({ method, pathname }), TOKEN)).toBeNull()
	})

	test("a tunnel-shaped request from 127.0.0.1 is refused", () => {
		// cloudflared runs `--url http://127.0.0.1:<port>` and forwards the
		// public Host plus its own headers — loopback alone would admit it.
		const tunnel = req({
			peer: "127.0.0.1",
			headers: goodHeaders({
				host: "x.trycloudflare.com",
				"cf-ray": "8a1b2c3d4e5f-AMS",
				"cf-connecting-ip": "203.0.113.9",
				"x-forwarded-for": "203.0.113.9",
				"x-forwarded-proto": "https"
			})
		})
		expect(isControlRequestAllowed(tunnel, TOKEN)).toBeNull()
		// Even with every proxy header stripped, the public Host alone refuses it.
		expect(
			isControlRequestAllowed(req({ headers: goodHeaders({ host: "x.trycloudflare.com" }) }), TOKEN)
		).toBeNull()
	})
})

describe("pieces", () => {
	test("isControlPath covers the prefix only", () => {
		expect(isControlPath("/api/launcher")).toBe(true)
		expect(isControlPath("/api/launcher/anything")).toBe(true)
		expect(isControlPath("/api/launchers")).toBe(false)
		expect(isControlPath("/api/login")).toBe(false)
	})
	test("hostHeaderHostname", () => {
		expect(hostHeaderHostname("[::1]:3000")).toBe("[::1]")
		expect(hostHeaderHostname("[::1]x")).toBeNull()
		expect(hostHeaderHostname("a:b:c")).toBeNull()
	})
	test("isLoopbackPeer", () => {
		expect(isLoopbackPeer("127.0.0.1")).toBe(true)
		expect(isLoopbackPeer("128.0.0.1")).toBe(false)
	})
	test("tokenMatches is exact", () => {
		expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
		expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
		expect(tokenMatches(`Bearer ${TOKEN}`, "")).toBe(false)
	})
})

function deferred() {
	let resolve!: () => void
	let reject!: (e: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/** A startup module as the health route sees it. */
function mod(
	appReady: Promise<void>,
	{ dbOk = true, failures = [] as string[] } = {}
) {
	return {
		appReady,
		getDatabaseState: () => ({ ok: dbOk }),
		getStartupFailures: () => failures
	}
}

describe("health states", () => {
	test("starting while startup loads, then while appReady is pending", () => {
		expect(healthStateOf(null)).toBe("starting")
		const d = deferred()
		expect(healthStateOf(mod(d.promise))).toBe("starting")
	})

	test("ready once appReady resolves; recovery when the database did not open", async () => {
		const ok = deferred()
		const m = mod(ok.promise)
		expect(healthStateOf(m)).toBe("starting")
		ok.resolve()
		await ok.promise
		expect(healthStateOf(m)).toBe("ready")

		const broken = deferred()
		const rec = mod(broken.promise, { dbOk: false })
		healthStateOf(rec)
		broken.resolve()
		await broken.promise
		expect(healthStateOf(rec)).toBe("recovery")
	})

	test("a startup that threw is failed, not starting: the launcher would wait forever", async () => {
		const d = deferred()
		const m = mod(d.promise, { failures: ["attic"] })
		healthStateOf(m)
		d.reject(new Error("boom"))
		await d.promise.catch(() => {})
		expect(healthStateOf(m)).toBe("failed")
	})

	test("a failsHealth task that failed is failed, though the app serves", async () => {
		const d = deferred()
		const m = mod(d.promise, { failures: ["pipelines"] })
		healthStateOf(m)
		d.resolve()
		await d.promise
		expect(healthStateOf(m)).toBe("failed")
	})

	test("recovery outranks a task failure: the database is the thing to fix", async () => {
		const d = deferred()
		const m = mod(d.promise, { dbOk: false, failures: ["pipelines"] })
		healthStateOf(m)
		d.resolve()
		await d.promise
		expect(healthStateOf(m)).toBe("recovery")
	})
})

function event(method: string, pathname: string, headers: Headers, peer = "127.0.0.1") {
	return {
		request: new Request(`http://127.0.0.1:3000${pathname}`, { method, headers }),
		url: new URL(`http://127.0.0.1:3000${pathname}`),
		platform: { req: { socket: { remoteAddress: peer } } }
	} as any
}

describe("handleControlRequest", () => {
	afterEach(() => {
		vi.useRealTimers()
		services.requestShutdown.mockClear()
	})

	function deps(over: Partial<ControlDeps> = {}): ControlDeps {
		return {
			token: TOKEN,
			version: "0.6.1",
			pid: 4242,
			startedAt: "2026-10-01T12:00:00.000Z",
			startup: () => null,
			shutdown: vi.fn(),
			clients: () => null,
			...over
		}
	}

	test("refusals are a bare 404 with no body", async () => {
		const res = handleControlRequest(
			event("GET", "/api/launcher/health", goodHeaders({ host: "x.trycloudflare.com", "cf-ray": "1" })),
			"0.6.1",
			deps()
		)
		expect(res.status).toBe(404)
		expect(await res.text()).toBe("")
		expect(res.headers.get("cache-control")).toBe("no-store")
	})

	test("health answers without waiting for startup", async () => {
		const pending = new Promise<void>(() => {})
		const res = handleControlRequest(
			event("GET", "/api/launcher/health", goodHeaders()),
			"0.6.1",
			deps({ startup: () => mod(pending) })
		)
		expect(res.status).toBe(200)
		expect(res.headers.get("cache-control")).toBe("no-store")
		expect(await res.json()).toEqual({
			version: "0.6.1",
			ready: false,
			state: "starting",
			pid: 4242,
			startedAt: "2026-10-01T12:00:00.000Z",
			failedTasks: [],
			clients: null
		})
	})

	test("health names the failed tasks and the connected clients", async () => {
		const done = deferred()
		const m = mod(done.promise, { failures: ["pipelines"] })
		healthStateOf(m)
		done.resolve()
		await done.promise
		const res = handleControlRequest(
			event("GET", "/api/launcher/health", goodHeaders()),
			"0.6.1",
			deps({ startup: () => m, clients: () => 2 })
		)
		expect(await res.json()).toMatchObject({
			ready: false,
			state: "failed",
			failedTasks: ["pipelines"],
			clients: 2
		})
	})

	test("shutdown answers 202 and then asks for the stop", async () => {
		const d = deps()
		const res = handleControlRequest(
			event("POST", "/api/launcher/shutdown", goodHeaders()),
			"0.6.1",
			d
		)
		expect(res.status).toBe(202)
		expect(await res.json()).toEqual({ ok: true })
		expect(d.shutdown).toHaveBeenCalledTimes(1)
	})

	test("a refused shutdown stops nothing", () => {
		const d = deps()
		const headers = goodHeaders({ origin: "http://evil.example" })
		const res = handleControlRequest(event("POST", "/api/launcher/shutdown", headers), "0.6.1", d)
		expect(res.status).toBe(404)
		expect(d.shutdown).not.toHaveBeenCalled()
	})

	test("the real wiring: the process token, then requestShutdown(launcher, 0) once startup settles", async () => {
		vi.useFakeTimers()
		const token = processIdentity().token
		const headers = new Headers({ host: "localhost:3000", authorization: `Bearer ${token}` })
		const res = handleControlRequest(event("POST", "/api/launcher/shutdown", headers), "0.6.1")
		expect(res.status).toBe(202)
		expect(services.requestShutdown).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(200)
		await vi.waitFor(() =>
			expect(services.requestShutdown).toHaveBeenCalledWith({ reason: "launcher", exitCode: 0 })
		)
	})

	test("the real wiring refuses a token from somewhere else", () => {
		const headers = new Headers({ host: "localhost:3000", authorization: `Bearer ${TOKEN}` })
		const res = handleControlRequest(event("GET", "/api/launcher/health", headers), "0.6.1")
		expect(res.status).toBe(404)
	})
})
