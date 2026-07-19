import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { acquire, _resetForTests } from "./rateLimiter"

beforeEach(() => {
	vi.useFakeTimers()
	_resetForTests()
})

afterEach(() => {
	vi.useRealTimers()
})

test("acquire: allows up to 15 immediate calls per minute when no session is active", async () => {
	for (let i = 0; i < 15; i++) {
		await acquire(false)
	}

	let resolved = false
	acquire(false).then(() => {
		resolved = true
	})
	await vi.advanceTimersByTimeAsync(0)
	expect(resolved).toBe(false)

	// The 16th call must wait for the oldest timestamp to fall outside the window.
	await vi.advanceTimersByTimeAsync(60_001)
	expect(resolved).toBe(true)
})

test("acquire: allows up to 120 immediate calls per minute when a session is active", async () => {
	for (let i = 0; i < 120; i++) {
		await acquire(true)
	}

	let resolved = false
	acquire(true).then(() => {
		resolved = true
	})
	await vi.advanceTimersByTimeAsync(0)
	expect(resolved).toBe(false)

	await vi.advanceTimersByTimeAsync(60_001)
	expect(resolved).toBe(true)
})

test("acquire: ceiling drops immediately once the session is no longer active", async () => {
	for (let i = 0; i < 15; i++) {
		await acquire(true)
	}

	// Session drops (eg. credential revoked) — the same 15 calls already
	// used up the conservative ceiling, so a 16th call under the dropped
	// ceiling must wait even though we're nowhere near the 120 ceiling.
	let resolved = false
	acquire(false).then(() => {
		resolved = true
	})
	await vi.advanceTimersByTimeAsync(0)
	expect(resolved).toBe(false)

	await vi.advanceTimersByTimeAsync(60_001)
	expect(resolved).toBe(true)
})
