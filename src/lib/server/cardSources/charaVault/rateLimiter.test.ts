import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { acquire, RateLimitTimeoutError, _resetForTests } from "./rateLimiter"

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

// Round-8 audit fix: the interactive queue used to have no cap at all,
// unlike background's — a client issuing many rapid distinct requests
// could queue unbounded waiters, starving other users behind the shared
// ceiling and growing process memory. Interactive waiters deliberately get
// no per-waiter timeout (see acquire()'s own comment on why) — the cap
// alone is what bounds the growth/starvation concern.
describe("acquire — interactive queue cap (Round-8 audit fix)", () => {
	test("the (cap+1)th queued interactive call rejects immediately once the queue is full", async () => {
		// Exhaust the ceiling first so subsequent calls actually queue
		// instead of resolving immediately.
		for (let i = 0; i < 15; i++) {
			await acquire(false, "interactive")
		}

		// Fill the interactive queue up to its cap (20) — each is a
		// legitimately-queued waiter (no timeout of its own) that will
		// resolve once enough ceiling windows pass; give each a no-op catch
		// so the test isn't left with dangling unhandled promises.
		for (let i = 0; i < 20; i++) {
			acquire(false, "interactive").catch(() => {})
		}

		await expect(acquire(false, "interactive")).rejects.toThrow(
			RateLimitTimeoutError
		)
	})
})

// Round-12 audit fix (MEDIUM): interactive-first queue *ordering* alone
// didn't reserve any *budget* — if background traffic (thumbnails) had
// already consumed the whole ceiling, a fresh interactive call (a "Load
// More" click) still had to wait out almost the full 60s window, priority
// or not. A single page of results can fire up to 20 background thumbnail
// requests nearly at once, which alone can exhaust the 15/min conservative
// ceiling. Fixed by reserving INTERACTIVE_RESERVE (5) slots that
// background traffic can never fill.
describe("acquire — interactive budget reserve (Round-12 audit fix)", () => {
	test("background traffic saturates only up to (ceiling - reserve), never the full ceiling", async () => {
		// 10 background acquires should all resolve immediately (ceiling 15 -
		// reserve 5 = 10 available to background).
		for (let i = 0; i < 10; i++) {
			await acquire(false, "background")
		}

		// The 11th background call must queue — background may never push
		// past (ceiling - reserve).
		let resolved = false
		acquire(false, "background").then(() => {
			resolved = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(resolved).toBe(false)
	})

	test("a fresh interactive call is granted immediately even though background already claimed (ceiling - reserve) slots", async () => {
		// Saturate background up to its effective ceiling (10, per above).
		for (let i = 0; i < 10; i++) {
			await acquire(false, "background")
		}

		// An interactive call arriving after background has already claimed
		// its slots must still resolve immediately — proving the reserve
		// actually reserves headroom, not just re-orders an already-full
		// queue.
		let resolved = false
		acquire(false, "interactive").then(() => {
			resolved = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(resolved).toBe(true)
	})

	test("interactive traffic may still use the full ceiling, unaffected by the reserve", async () => {
		// All 15 slots via interactive alone — the reserve only constrains
		// background, not interactive-vs-interactive contention.
		for (let i = 0; i < 15; i++) {
			await acquire(false, "interactive")
		}
		let resolved = false
		acquire(false, "interactive").then(() => {
			resolved = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(resolved).toBe(false)
	})

	test("background's effective ceiling frees up again once its earlier timestamps age out of the window", async () => {
		for (let i = 0; i < 10; i++) {
			await acquire(false, "background")
		}

		// Once the whole window has rolled over, those 10 timestamps are
		// pruned — a fresh background acquire (not one that's been queued
		// and racing its own timeout) resolves immediately again.
		await vi.advanceTimersByTimeAsync(60_001)
		let resolved = false
		acquire(false, "background").then(() => {
			resolved = true
		})
		await vi.advanceTimersByTimeAsync(0)
		expect(resolved).toBe(true)
	})
})
