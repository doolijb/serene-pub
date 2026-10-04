/**
 * No failed query's text leaves on a socket, whatever road the packet took.
 *
 * A real Socket.IO server and client, so every road the review named is the
 * real one: a direct `socket.emit` (the road `emitToUser` and the activity
 * cards take), a room broadcast (`broadcastToSessionUsers`,
 * `emitToInterested`, `pushToUser`), an ack, a refused handshake — and the
 * shapes it named: nested under `result` and `failures[]`, a serialised
 * `DrizzleQueryError`, whitespace collapsed onto one line. The values are
 * a `SECRET` that must never arrive; the SQL must never arrive either.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createServer, type Server as HttpServer } from "http"
import type { AddressInfo } from "net"
import { Server } from "socket.io"
import { io as ioClient, type Socket } from "socket.io-client"
import { DrizzleQueryError } from "drizzle-orm"
import { QUERY_FAILED_SENTENCE } from "$lib/server/db/errors"
import { installQueryTextGuard } from "./queryTextGuard"

const SECRET = "SECRET-PARAM-q9"

function failedQuery(): DrizzleQueryError {
	return new DrizzleQueryError(
		'insert into "session_messages" ("session_id", "content") values ($1, $2)',
		[7, SECRET],
		Object.assign(new Error("insert or update violates foreign key constraint"), {
			code: "23503"
		})
	)
}

let http: HttpServer
let io: Server
let client: Socket | null = null

beforeEach(async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {})
	http = createServer()
	io = new Server(http)
	installQueryTextGuard(io)
	await new Promise<void>((resolve) => http.listen(0, resolve))
})

afterEach(async () => {
	client?.close()
	client = null
	await new Promise<void>((resolve) => io.close(() => resolve()))
	vi.restoreAllMocks()
})

function connect(): Promise<Socket> {
	const { port } = http.address() as AddressInfo
	const c = ioClient(`http://localhost:${port}`, {
		transports: ["websocket"],
		reconnection: false
	})
	client = c
	return new Promise((resolve, reject) => {
		c.on("connect", () => resolve(c))
		c.on("connect_error", reject)
	})
}

/** The next `event` the client hears. */
const next = (c: Socket, event: string) =>
	new Promise<any>((resolve) => c.once(event, (...args: any[]) => resolve(args)))

/**
 * The server's side of each case runs when the client asks ("go"), so the
 * client's listener is always in place before the packet is sent.
 */
function onGo(send: (s: import("socket.io").Socket) => void) {
	io.on("connection", (s) => s.on("go", () => send(s)))
}

/** Connect, listen for `event`, then ask the server to send it. */
async function hear(event: string): Promise<any[]> {
	const c = await connect()
	const heard = next(c, event)
	c.emit("go")
	return heard
}

const leaks = (v: unknown) => {
	const s = JSON.stringify(v)
	return s.includes(SECRET) || s.includes("Failed query") || s.includes("insert into")
}

describe("the socket guard, on a real server", () => {
	test("a direct emit loses a failed query nested anywhere in an :error payload", async () => {
		onGo((s) =>
			s.emit("characters:create:error", {
				result: { error: failedQuery().message },
				hint: "kept"
			})
		)
		const [got] = await hear("characters:create:error")
		expect(got).toEqual({ result: { error: QUERY_FAILED_SENTENCE }, hint: "kept" })
	})

	test("a room broadcast loses one in an array of objects, and keeps a person's own words", async () => {
		onGo((s) => {
			s.join("user_1")
			io.to("user_1").emit("import:done", {
				failures: [{ name: "Ada", error: `Ada: ${failedQuery().message}` }],
				note: "The log said Failed query: and nothing else."
			})
		})
		const [got] = await hear("import:done")
		expect(got.failures).toEqual([{ name: "Ada", error: `Ada: ${QUERY_FAILED_SENTENCE}` }])
		// Not drizzle's shape (no `params:` line): a person's text, sent as written.
		expect(got.note).toBe("The log said Failed query: and nothing else.")
		expect(leaks(got.failures)).toBe(false)
	})

	test("an ack, a serialised error object and a one-line (collapsed) message", async () => {
		io.on("connection", (s) =>
			s.on("ask", (_: unknown, ack: (v: unknown) => void) =>
				ack({ error: failedQuery().message })
			)
		)
		onGo((s) =>
			s.emit("activity", {
				error: failedQuery(),
				errorMessage: failedQuery().message.replace(/\s+/g, " ")
			})
		)
		const [got] = await hear("activity")
		const acked = await client!.emitWithAck("ask", {})
		expect(acked).toEqual({ error: QUERY_FAILED_SENTENCE })
		expect(got.error).toEqual({ message: QUERY_FAILED_SENTENCE, code: "23503" })
		expect(got.errorMessage).toBe(QUERY_FAILED_SENTENCE)
		expect(leaks(got)).toBe(false)
	})

	test("a refused handshake's message", async () => {
		io.use((_s, next) => next(new Error(`auth: ${failedQuery().message}`)))
		const err = await connect().catch((e: Error) => e)
		expect((err as Error).message).toBe(`auth: ${QUERY_FAILED_SENTENCE}`)
	})

	test("binary rides through untouched beside a cleaned string", async () => {
		const bytes = Buffer.from([1, 2, 3, 250])
		onGo((s) => s.emit("upload:error", { file: bytes, error: failedQuery().message }))
		const [got] = await hear("upload:error")
		expect(Buffer.from(got.file)).toEqual(bytes)
		expect(got.error).toBe(QUERY_FAILED_SENTENCE)
	})

	test("the original goes to the server log", async () => {
		const warn = vi.mocked(console.warn)
		onGo((s) => s.emit("x:error", { error: failedQuery().message }))
		await hear("x:error")
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("x:error"),
			expect.stringContaining(SECRET)
		)
	})
})

describe("the encoder, directly", () => {
	test("an ordinary packet is encoded once and returned as it was", () => {
		const packet = { type: 2, nsp: "/", data: ["sessionMessage", { content: "hello" }] }
		const out = io.encoder.encode(packet as any)
		expect(out).toEqual(['2["sessionMessage",{"content":"hello"}]'])
	})

	test("installing twice wraps once", () => {
		const encode = io.encoder.encode
		installQueryTextGuard(io)
		expect(io.encoder.encode).toBe(encode)
	})
})
