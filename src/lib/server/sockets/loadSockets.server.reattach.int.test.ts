/**
 * One Socket.IO server per HTTP server per process.
 *
 * A dev server re-evaluates `loadSockets.server.ts`, and every handler module
 * it imports, on each code change. A re-evaluation that attaches a second
 * `SocketIOServer` to the one HTTP server stacks another set of engine.io
 * `request`/`upgrade`/`close` listeners on it (what Node's
 * MaxListenersExceededWarning counts) and another set of handlers behind every
 * event, so each message is answered twice. What is asserted here is that the
 * second attach creates nothing and rebinds handlers onto the live `io`.
 *
 * The tests share one HTTP server and run in order: the rule is about state
 * that lives as long as the process, so each step is the next thing that
 * happens to the same server.
 *
 * `$lib/server/startup` is mocked rather than booted. `attachSocketServer`
 * needs `appReady` settled and a database it can call open, and the real module
 * runs every startup task (migrations, plugins, services) at import to get
 * there. Filed as `.int.test.ts` because it imports the whole socket handler
 * graph and attaches a real Socket.IO server to a real `http.Server`.
 */
import http from "node:http"
import { beforeAll, describe, expect, test, vi } from "vitest"
import type { Server as SocketIOServer } from "socket.io"

// The socket graph reaches $lib/server/auth, which calls getCryptoSecretKey()
// at import time. No handler queries the database here, so `db` is a stub and
// no PGlite instance is built.
vi.mock("$lib/server/db", () => ({
	db: {},
	getCryptoSecretKey: () => "reattach-test-crypto-secret-key"
}))

vi.mock("$lib/server/startup", () => ({
	appReady: Promise.resolve(),
	getDatabaseState: () => ({ ok: true })
}))

/**
 * What each once-per-process starter was called, counted here rather than with
 * `vi.fn()`: `vi.resetModules()` below can hand a re-evaluated module a fresh
 * mock instance, and a count that starts over says nothing about the process.
 */
const starts = vi.hoisted(() => ({
	vectorization: 0,
	annotation: 0,
	warmProbe: 0
}))

vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("$lib/server/embedding/vectorizationQueue")
	>()),
	startPeriodicVectorizationScan: () => {
		starts.vectorization++
	}
}))

vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/annotations/queue")>()),
	startPeriodicAnnotationScan: () => {
		starts.annotation++
	}
}))

// The warm probe's only job is to pay a dynamic import's cost early. Stubbed so
// this file does not pay it for real.
vi.mock("$lib/server/embedding/index", async (importOriginal) => ({
	...(await importOriginal<typeof import("$lib/server/embedding/index")>()),
	isLocalEmbeddingSupported: async () => {
		starts.warmProbe++
		return false
	}
}))

/**
 * The attach state the module keeps on `globalThis`.
 *
 * Absent reads as empty rather than throwing, so a run against a module that
 * keeps no such state fails on the assertion that names the rule instead of on
 * a property access.
 */
function socketState(): Partial<{
	io: SocketIOServer | null
	httpServer: http.Server | null
	scans: boolean
}> {
	return (globalThis as any).__SERENE_PUB_SOCKET_STATE__ ?? {}
}

/**
 * Engine.io adds one of each of these per attach, and removes none of them on a
 * second attach, so a growing count is the leak itself.
 */
function listenerCounts(server: http.Server) {
	return {
		request: server.listeners("request").length,
		upgrade: server.listeners("upgrade").length,
		close: server.listeners("close").length,
		listening: server.listeners("listening").length
	}
}

/** A namespace emits both for the same socket, so both are the handler set. */
function connectionListeners(io: SocketIOServer) {
	return io.listeners("connect").length + io.listeners("connection").length
}

let server: http.Server
/** The module instance a first attach runs from, kept for the second call. */
let firstInstance: typeof import("./loadSockets.server")

beforeAll(() => {
	// Never listened on: attaching is what is under test, and a bound port is
	// one more thing for a parallel sweep to collide on.
	server = http.createServer()
})

describe("attachSocketServer", () => {
	test("the first attach creates the one Socket.IO server", async () => {
		firstInstance = await import("./loadSockets.server")
		const before = listenerCounts(server)

		await firstInstance.attachSocketServer(server)

		const state = socketState()
		expect(state.io).toBeTruthy()
		expect(state.httpServer).toBe(server)
		expect(listenerCounts(server).upgrade).toBe(before.upgrade + 1)
		expect(connectionListeners(state.io!)).toBe(1)
	})

	test("a second attach against the same server creates no second one", async () => {
		const io = socketState().io
		const before = listenerCounts(server)

		await firstInstance.attachSocketServer(server)

		// The assertion the MaxListenersExceededWarning is about.
		expect(listenerCounts(server)).toEqual(before)
		expect(socketState().io).toBe(io)
		expect(connectionListeners(io!)).toBe(1)
	})

	test("the periodic scans and the warm probe start once, not once per attach", async () => {
		expect(starts.vectorization).toBe(1)
		expect(starts.annotation).toBe(1)
		// The probe is fire-and-forget, so its call lands a microtask after the
		// attach it was started from returned.
		await vi.waitFor(() => expect(starts.warmProbe).toBe(1))
	})

	test("a re-evaluated module reuses the io and rebinds its handlers", async () => {
		const io = socketState().io
		const before = listenerCounts(server)

		// What Vite's SSR HMR does to this module on a code change.
		vi.resetModules()
		const reEvaluated = await import("./loadSockets.server")
		expect(reEvaluated.attachSocketServer).not.toBe(
			firstInstance.attachSocketServer
		)

		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		await reEvaluated.attachSocketServer(server)
		const lines = log.mock.calls.map((c) => String(c[0]))
		log.mockRestore()

		expect(listenerCounts(server)).toEqual(before)
		expect(socketState().io).toBe(io)
		expect(connectionListeners(io!)).toBe(1)
		expect(lines).toContainEqual(
			expect.stringContaining(
				"Socket handlers re-attached after a code change"
			)
		)
	})

	test("a rebind starts no second scan", async () => {
		// Still the counts from the first attach: the scans and the probe
		// already running own the process's timers and cached results, and the
		// re-evaluated module has no way to stop the ones it did not start.
		expect(starts.vectorization).toBe(1)
		expect(starts.annotation).toBe(1)
		expect(starts.warmProbe).toBe(1)
		expect(socketState().scans).toBe(true)
	})
})
