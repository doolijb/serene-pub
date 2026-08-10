/**
 * Round-12 audit fix (MEDIUM): authMiddleware never touched loginRateLimit
 * at all — unlike the HTTP login route's 5-attempts/60s limiter, nothing
 * throttled repeated failed handshake attempts (disallowed origins, bad
 * tokens) from the same address, and there was no cap on how many
 * concurrent sockets one account (or the disabled-accounts auto-admin
 * fallback) could hold open. Fixed by reusing loginRateLimit (keyed
 * `socketHandshake:${address}`, recording immediately before any
 * origin/DB work — closes the same TOCTOU class round 13 already fixed
 * for HTTP login) and a generous per-user room-size cap
 * (MAX_CONCURRENT_SOCKETS_PER_USER = 50) checked right before joining the
 * user's room.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"

let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-auth-ratelimit-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function makeFakeSocket(
	overrides: {
		address?: string
		origin?: string
		host?: string
		roomSize?: number
	} = {}
) {
	const rooms = new Map<string, { size: number }>()
	if (overrides.roomSize != null) {
		rooms.set(`user_1`, { size: overrides.roomSize } as any)
	}
	const joined: string[] = []
	let disconnected = false
	const socket: any = {
		handshake: {
			address: overrides.address ?? "203.0.113.5",
			headers: {
				origin: overrides.origin ?? "http://evil.example.com",
				host: overrides.host ?? "myserver.local"
			},
			auth: {}
		},
		nsp: { adapter: { rooms } },
		join: (room: string) => joined.push(room),
		disconnect: () => {
			disconnected = true
		},
		get joined() {
			return joined
		},
		get isDisconnected() {
			return disconnected
		}
	}
	return socket
}

function callMiddleware(socket: any): Promise<Error | undefined> {
	return new Promise(async (resolve) => {
		const { authMiddleware } = await import("./auth")
		await authMiddleware(socket, (err?: Error) => resolve(err))
	})
}

describe("authMiddleware — handshake rate limiting (Round-12 audit fix, PGlite integration)", () => {
	test("caps repeated failed handshake attempts from the same address, then rejects further attempts before any DB work", async () => {
		const address = "203.0.113.10"
		// The real "$lib/server/db" module's own init (PGlite + migrations +
		// defaults sync) only pays its cost once, on the first import across
		// this file — the default 5s test timeout isn't enough for that plus
		// this test's 6 sequential middleware calls.

		// loginRateLimit's default ceiling is 5 attempts per window — burn
		// through it with attempts that fail the origin check (disallowed
		// origin, no matching allowlist entry).
		for (let i = 0; i < 5; i++) {
			const socket = makeFakeSocket({ address })
			const err = await callMiddleware(socket)
			expect(err?.message).toBe("Origin not allowed")
			expect(socket.isDisconnected).toBe(true)
		}

		// The 6th attempt is rejected by the rate limiter itself — proven by
		// using a socket with no Origin header at all, which would otherwise
		// take an entirely different path (isMissingOriginAllowed) rather
		// than "Origin not allowed".
		const socket = makeFakeSocket({ address, origin: undefined as any })
		delete socket.handshake.headers.origin
		const err = await callMiddleware(socket)
		expect(err?.message).toBe("Too many connection attempts")
		expect(socket.isDisconnected).toBe(true)
	}, 30_000)

	test("a successful connection clears the rate-limit counter for that address", async () => {
		const address = "203.0.113.20"

		// A couple of failed (origin-rejected) attempts, then a successful
		// one (same-hostname origin, accounts disabled by default in a bare
		// test DB — auto-attaches successfully).
		for (let i = 0; i < 2; i++) {
			const socket = makeFakeSocket({ address })
			const err = await callMiddleware(socket)
			expect(err?.message).toBe("Origin not allowed")
		}

		const successSocket = makeFakeSocket({
			address,
			origin: "http://myserver.local",
			host: "myserver.local"
		})
		const successErr = await callMiddleware(successSocket)
		expect(successErr).toBeUndefined()
		expect(successSocket.isDisconnected).toBe(false)

		// The counter was cleared by that success — another 4 failures (not
		// 5 total) shouldn't trip the limiter yet.
		for (let i = 0; i < 4; i++) {
			const socket = makeFakeSocket({ address })
			const err = await callMiddleware(socket)
			expect(err?.message).toBe("Origin not allowed")
		}
		const stillOk = makeFakeSocket({
			address,
			origin: "http://myserver.local",
			host: "myserver.local"
		})
		const stillOkErr = await callMiddleware(stillOk)
		expect(stillOkErr).toBeUndefined()
	})
})

describe("authMiddleware — handshake rate limiting honors ADDRESS_HEADER behind a trusted proxy (Round-14 audit fix)", () => {
	afterEach(() => {
		delete process.env.ADDRESS_HEADER
	})

	test("two different real clients behind the same proxy peer get independent rate-limit buckets once ADDRESS_HEADER is set", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const proxyPeer = "127.0.0.1"

		// Client A (real address 203.0.113.40, reaching us via the local
		// proxy) burns through its own bucket.
		for (let i = 0; i < 5; i++) {
			const socket = makeFakeSocket({ address: proxyPeer })
			socket.handshake.headers["x-forwarded-for"] = "203.0.113.40"
			const err = await callMiddleware(socket)
			expect(err?.message).toBe("Origin not allowed")
		}
		const clientASixth = makeFakeSocket({ address: proxyPeer })
		clientASixth.handshake.headers["x-forwarded-for"] = "203.0.113.40"
		const errA = await callMiddleware(clientASixth)
		expect(errA?.message).toBe("Too many connection attempts")

		// Client B — same proxy peer address, different real client behind
		// it — must not be caught by client A's now-exhausted bucket. Before
		// this fix, both would have keyed on the shared proxy peer address
		// and collapsed into one bucket.
		const clientB = makeFakeSocket({
			address: proxyPeer,
			origin: "http://myserver.local",
			host: "myserver.local"
		})
		clientB.handshake.headers["x-forwarded-for"] = "203.0.113.41"
		const errB = await callMiddleware(clientB)
		expect(errB).toBeUndefined()
		expect(clientB.isDisconnected).toBe(false)
	}, 30_000)

	test("without ADDRESS_HEADER set, the raw proxy peer address is used as before (no behavior change)", async () => {
		const proxyPeer = "203.0.113.50" // non-local, so the header would be ignored either way
		for (let i = 0; i < 5; i++) {
			const socket = makeFakeSocket({ address: proxyPeer })
			socket.handshake.headers["x-forwarded-for"] = "198.51.100.1"
			const err = await callMiddleware(socket)
			expect(err?.message).toBe("Origin not allowed")
		}
		// A "different" forwarded-for value doesn't help — ADDRESS_HEADER is
		// unset, so the raw peer address is still what's keyed on.
		const socket = makeFakeSocket({ address: proxyPeer })
		socket.handshake.headers["x-forwarded-for"] = "198.51.100.2"
		const err = await callMiddleware(socket)
		expect(err?.message).toBe("Too many connection attempts")
	}, 30_000)
})

describe("authMiddleware — per-user concurrent connection cap (Round-12 audit fix, PGlite integration)", () => {
	test("rejects a new connection once the target user's room is already at the cap", async () => {
		// A fresh address so the rate limiter above doesn't interfere.
		const socket = makeFakeSocket({
			address: "203.0.113.30",
			origin: "http://myserver.local",
			host: "myserver.local",
			roomSize: 50 // MAX_CONCURRENT_SOCKETS_PER_USER
		})
		const err = await callMiddleware(socket)
		expect(err?.message).toBe("Too many concurrent connections")
		expect(socket.isDisconnected).toBe(true)
		expect(socket.joined).toEqual([])
	})

	test("still joins normally when under the cap", async () => {
		const socket = makeFakeSocket({
			address: "203.0.113.31",
			origin: "http://myserver.local",
			host: "myserver.local",
			roomSize: 3
		})
		const err = await callMiddleware(socket)
		expect(err).toBeUndefined()
		expect(socket.isDisconnected).toBe(false)
		expect(socket.joined).toEqual(["user_1"])
	})
})
