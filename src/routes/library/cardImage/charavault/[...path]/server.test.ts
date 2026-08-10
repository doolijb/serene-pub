/**
 * The image-proxy route was rewritten to fix missing CharaVault thumbnails:
 * error responses previously carried no Cache-Control at all (risking a
 * browser caching a transient 429/502 and never retrying it), the upstream
 * fetch wasn't deduped against concurrent requests for the same
 * not-yet-cached image, and a client disconnecting mid-request fell through
 * to a misleading 404 instead of a 499. These tests cover the route's own
 * logic (status/header mapping, cache-key/TTL wiring, abort handling) —
 * getOrFetchCardBytes's own dedup/cache behavior is already covered by
 * diskCache.test.ts and isn't re-tested here.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	CardSourceInvalidRefError,
	CardSourceRateLimitedError,
	CardSourceUnavailableError
} from "$lib/server/cardSources/types"
import { RateLimitTimeoutError } from "$lib/server/cardSources/charaVault/rateLimiter"

// vi.hoisted() runs before vi.mock()'s own hoisted factories — the only
// TDZ-safe way to share mock references between them and the test bodies
// below, regardless of whether the mocked module ends up imported
// statically or dynamically.
const {
	authenticateRequestMock,
	getOrFetchCardBytesMock,
	fetchCharaVaultCardResponseMock
} = vi.hoisted(() => ({
	authenticateRequestMock: vi.fn(),
	getOrFetchCardBytesMock: vi.fn(),
	fetchCharaVaultCardResponseMock: vi.fn()
}))

// +server.ts imports fetchCharaVaultCardResponse from charaVaultSource.ts
// purely to pass it as a fetcher callback — none of these tests actually
// invoke it (getOrFetchCardBytes is mocked below, so the real fetcher is
// never called). But merely IMPORTING charaVaultSource.ts transitively
// imports $lib/server/db, whose top-level checkDatabaseLock() opens a real
// PGlite connection and process.exit(1)s if it can't get a lock (eg. a real
// dev server already holds it) — a trivial db stub cuts that off at the
// root, same as cardSources.cardDetailSupersession.test.ts already does.
vi.mock("$lib/server/db", () => ({ db: {} }))

vi.mock("$lib/server/auth/authenticateRequest", () => ({
	authenticateRequest: authenticateRequestMock
}))

vi.mock("$lib/server/cardSources/diskCache", () => ({
	getOrFetchCardBytes: getOrFetchCardBytesMock,
	IMAGE_TTL_MS: 30 * 24 * 60 * 60_000
}))

// Only mocked (rather than left real) for the Fix 1 test below, which needs
// to control what the route's own inline fetcher receives back without
// making a real network call. Every other test in this file mocks
// getOrFetchCardBytes wholesale instead, so this mock's return value is
// irrelevant to them.
vi.mock("$lib/server/cardSources/charaVault/charaVaultSource", () => ({
	fetchCharaVaultCardResponse: fetchCharaVaultCardResponseMock
}))

import { GET } from "./+server"

afterEach(() => {
	getOrFetchCardBytesMock.mockReset()
	authenticateRequestMock.mockReset()
	fetchCharaVaultCardResponseMock.mockReset()
})

function fakeEvent(path: string, signal: AbortSignal = new AbortController().signal) {
	return {
		params: { path },
		request: { signal }
	} as any
}

describe("GET /library/cardImage/charavault/[...path]", () => {
	test("success: returns the bytes with a long, public Cache-Control", async () => {
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
		getOrFetchCardBytesMock.mockResolvedValue(Buffer.from("png-bytes"))

		const res = await GET(fakeEvent("folder/file.png"))

		expect(res.status).toBe(200)
		expect(res.headers.get("Content-Type")).toBe("image/png")
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400")
		expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(
			"png-bytes"
		)
	})

	test("success: passes the cache key, the request signal, and IMAGE_TTL_MS through to getOrFetchCardBytes", async () => {
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
		getOrFetchCardBytesMock.mockResolvedValue(Buffer.from("bytes"))
		const signal = new AbortController().signal

		await GET(fakeEvent("folder/file.png", signal))

		expect(getOrFetchCardBytesMock).toHaveBeenCalledWith(
			"charavault:folder/file.png",
			expect.any(Function),
			signal,
			30 * 24 * 60 * 60_000
		)
	})

	test.each([
		["CardSourceRateLimitedError", new CardSourceRateLimitedError(5000), 429, "5"],
		["RateLimitTimeoutError", new RateLimitTimeoutError(), 429, "5"]
	])(
		"%s maps to 429 with Retry-After and Cache-Control: no-store",
		async (_name, error, expectedStatus, expectedRetryAfter) => {
			authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
			getOrFetchCardBytesMock.mockRejectedValue(error)

			const res = await GET(fakeEvent("folder/file.png"))

			expect(res.status).toBe(expectedStatus)
			expect(res.headers.get("Retry-After")).toBe(expectedRetryAfter)
			expect(res.headers.get("Cache-Control")).toBe("no-store")
		}
	)

	test("CardSourceInvalidRefError maps to 400 with Cache-Control: no-store", async () => {
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
		getOrFetchCardBytesMock.mockRejectedValue(
			new CardSourceInvalidRefError("bad ref")
		)

		const res = await GET(fakeEvent("folder/file.png"))

		expect(res.status).toBe(400)
		expect(res.headers.get("Cache-Control")).toBe("no-store")
	})

	test("CardSourceUnavailableError maps to 502 with Cache-Control: no-store", async () => {
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
		getOrFetchCardBytesMock.mockRejectedValue(
			new CardSourceUnavailableError("upstream down")
		)

		const res = await GET(fakeEvent("folder/file.png"))

		expect(res.status).toBe(502)
		expect(res.headers.get("Cache-Control")).toBe("no-store")
	})

	test("an unrecognized error maps to 404 with Cache-Control: no-store", async () => {
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
		getOrFetchCardBytesMock.mockRejectedValue(new Error("unexpected"))

		const res = await GET(fakeEvent("folder/file.png"))

		expect(res.status).toBe(404)
		expect(res.headers.get("Cache-Control")).toBe("no-store")
	})

	test("a client-abort-triggered rejection returns 499, not 404 — even though the rejection itself doesn't match any known error type", async () => {
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
		const controller = new AbortController()
		// Mirrors what pendingAbortableFetch.ts's attachWaiter actually
		// rejects with when the caller's own signal aborts: the signal's
		// reason, not one of this route's known CardSource error types.
		getOrFetchCardBytesMock.mockImplementation(() => {
			controller.abort()
			return Promise.reject(controller.signal.reason)
		})

		const res = await GET(fakeEvent("folder/file.png", controller.signal))

		expect(res.status).toBe(499)
	})

	test("a body-read failure (eg. a mid-transfer timeout) is reclassified as 502, not left as an unretried 404", async () => {
		// Round-5 fix: a failure reading the response body used to propagate
		// unclassified, matching none of the route's instanceof branches and
		// falling through to 404 — which RetryableImage.svelte deliberately
		// never retries. Must drive the route's REAL inline fetcher (where
		// the reclassification wrap lives) rather than mocking
		// getOrFetchCardBytes to reject directly — that would bypass the
		// fetcher entirely and could never actually exercise the fix (a
		// mistake worth guarding against explicitly, not just avoiding by
		// accident).
		authenticateRequestMock.mockResolvedValue({ id: 1, username: "a" })
		getOrFetchCardBytesMock.mockImplementation(
			(
				_key: string,
				fetcher: (signal: AbortSignal) => Promise<Buffer>,
				signal?: AbortSignal,
				_ttlMs?: number
			) => fetcher(signal ?? new AbortController().signal)
		)
		fetchCharaVaultCardResponseMock.mockResolvedValue({
			arrayBuffer: () =>
				Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))
		})

		const res = await GET(fakeEvent("folder/file.png"))

		expect(res.status).toBe(502)
		expect(res.headers.get("Cache-Control")).toBe("no-store")
	})

	test("unauthenticated requests are rejected before touching the cache/fetch path", async () => {
		authenticateRequestMock.mockResolvedValue(null)

		const res = await GET(fakeEvent("folder/file.png"))

		expect(res.status).toBe(401)
		expect(getOrFetchCardBytesMock).not.toHaveBeenCalled()
	})
})
