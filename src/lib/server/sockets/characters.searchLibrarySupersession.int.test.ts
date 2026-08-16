/**
 * Round-15 audit fix: characters:searchLibrary previously ran every request
 * to completion regardless of whether a newer search from the same socket
 * had already superseded it — abandoned work still consumed real
 * CharaVault rate-limit budget for a result nobody would ever see. Fixed
 * via withSupersession(), which aborts a socket's own previous
 * still-in-flight search when a new one from the same socket arrives.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CardSourceUnavailableError } from "$lib/server/cardSources/types"

let testDb: TestDb
let dataDir: string
let cachedSearchMock: ReturnType<typeof vi.fn>

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

// characters:searchLibrary's own supersession wiring is what's under test —
// not card-source resolution, NSFW policy, or the real search call, which
// are all exercised elsewhere. Kept minimal and fully controlled.
vi.mock("$lib/server/cardSources", () => ({
	resolveCardSource: vi.fn(() => ({
		id: "github-serenepub",
		label: "GitHub",
		supports: () => true
	})),
	cachedSearch: (cachedSearchMock = vi.fn()),
	resolveNsfwParam: vi.fn(async () => false)
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-search-supersession-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

afterEach(() => {
	cachedSearchMock.mockReset()
})

async function makeUser(username: string) {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username })
		.returning()
	return user
}

function fakeSocket(userId: number, socketId: string) {
	return { id: socketId, user: { id: userId } } as any
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (err: any) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("characters:searchLibrary — supersession", () => {
	test("a superseded search never emits an error, and only the newest search's response reaches the client", async () => {
		const { charactersSearchLibrary } = await import("./characters")
		const user = await makeUser("search-supersession-user")
		const socket = fakeSocket(user.id, "socket-supersession-1")

		const emitted: { event: string; data: any }[] = []
		const emitToUser = (event: string, data: any) => {
			emitted.push({ event, data })
		}

		const firstWork = deferred<any>()
		let firstSignal: AbortSignal | undefined
		cachedSearchMock.mockImplementationOnce((_sourceId: any, _params: any, ctx: any) => {
			firstSignal = ctx.signal
			// Mirrors what the real cachedSearch()/getOrStartAbortable() does
			// for a caller whose OWN signal aborts: that caller's promise
			// rejects, regardless of what the underlying work later does —
			// a bare stub that ignores ctx.signal wouldn't exercise the
			// handler's `if (signal.aborted)` branch at all.
			return new Promise((resolve, reject) => {
				ctx.signal.addEventListener(
					"abort",
					() => reject(ctx.signal.reason),
					{ once: true }
				)
				firstWork.promise.then(resolve, reject)
			})
		})

		const firstCallPromise = charactersSearchLibrary.handler(
			socket,
			{ searchTerm: "first", requestId: "req-1" } as any,
			emitToUser
		)
		await vi.waitFor(() => expect(firstSignal).toBeDefined())
		expect(firstSignal!.aborted).toBe(false)

		// A second search from the SAME socket supersedes the first.
		let secondSignal: AbortSignal | undefined
		cachedSearchMock.mockImplementationOnce((_sourceId: any, _params: any, ctx: any) => {
			secondSignal = ctx.signal
			return Promise.resolve({ items: [], hasMore: false, nextOffset: 0 })
		})
		const secondCallPromise = charactersSearchLibrary.handler(
			socket,
			{ searchTerm: "second", requestId: "req-2" } as any,
			emitToUser
		)
		await vi.waitFor(() => expect(secondSignal).toBeDefined())

		expect(firstSignal!.aborted).toBe(true)
		expect(secondSignal!.aborted).toBe(false)

		// Let the first's now-abandoned work finally settle — it must not
		// emit anything, since nothing is listening for its result anymore.
		firstWork.resolve({ items: [], hasMore: false, nextOffset: 0 })
		await firstCallPromise
		await secondCallPromise

		expect(
			emitted.some((e) => e.event === "characters:searchLibrary:error")
		).toBe(false)
		expect(
			emitted.some(
				(e) =>
					e.event === "characters:searchLibrary" &&
					e.data.requestId === "req-2"
			)
		).toBe(true)
		expect(emitted.some((e) => e.data?.requestId === "req-1")).toBe(false)
	})

	test("a genuine (non-abort) error still emits the error event and re-throws", async () => {
		const { charactersSearchLibrary } = await import("./characters")
		const user = await makeUser("search-supersession-error-user")
		const socket = fakeSocket(user.id, "socket-supersession-2")

		const emitted: { event: string; data: any }[] = []
		const emitToUser = (event: string, data: any) => {
			emitted.push({ event, data })
		}

		cachedSearchMock.mockImplementationOnce(async () => {
			throw new CardSourceUnavailableError("upstream is down")
		})

		await expect(
			charactersSearchLibrary.handler(
				socket,
				{ searchTerm: "x", requestId: "req-3" } as any,
				emitToUser
			)
		).rejects.toThrow("upstream is down")

		const errorEvent = emitted.find(
			(e) => e.event === "characters:searchLibrary:error"
		)
		expect(errorEvent).toBeDefined()
		expect(errorEvent!.data.unreachable).toBe(true)
	})
})
