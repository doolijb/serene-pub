import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	acquire,
	RateLimitTimeoutError,
	RateLimitAbortedError,
	_resetForTests
} from "./rateLimiter"

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

// Round-15 audit fix: nothing previously cancelled a queued/in-flight
// CharaVault request when the client that triggered it moved on (eg. a
// newer search superseding an older one) — abandoned work still consumed
// real rate-limit slots and queue depth. acquire() now accepts an optional
// AbortSignal so a caller that's given up can be removed immediately.
describe("acquire — caller cancellation (Round-15 audit fix)", () => {
	test("a queued waiter rejects with RateLimitAbortedError, not RateLimitTimeoutError, when its signal aborts", async () => {
		// Exhaust the ceiling so the next call actually queues instead of
		// resolving immediately.
		for (let i = 0; i < 15; i++) {
			await acquire(false)
		}

		const controller = new AbortController()
		const promise = acquire(false, "interactive", controller.signal)
		controller.abort()

		await expect(promise).rejects.toThrow(RateLimitAbortedError)
	})

	test("aborting a queued waiter frees its queue slot immediately, for a later caller to use", async () => {
		for (let i = 0; i < 15; i++) {
			await acquire(false)
		}

		// Fill the interactive queue to its cap (20).
		const controllers: AbortController[] = []
		for (let i = 0; i < 20; i++) {
			const controller = new AbortController()
			controllers.push(controller)
			acquire(false, "interactive", controller.signal).catch(() => {})
		}

		// Confirm the queue is genuinely full first (baseline).
		await expect(acquire(false, "interactive")).rejects.toThrow(
			RateLimitTimeoutError
		)

		// Abort one of the already-queued waiters.
		controllers[0].abort()

		// A new call should now be admitted to the queue instead of
		// synchronously rejected for "queue full" — it lands 20th in FIFO
		// order behind the 19 still-queued waiters, so it won't actually be
		// GRANTED within just one window rollover; what this test checks is
		// admission (no immediate RateLimitTimeoutError), not grant timing.
		let settled = false
		acquire(false, "interactive")
			.catch(() => {})
			.finally(() => {
				settled = true
			})
		await vi.advanceTimersByTimeAsync(0)
		expect(settled).toBe(false)
	})

	test("a pre-aborted signal rejects immediately without ever entering the queue", async () => {
		for (let i = 0; i < 15; i++) {
			await acquire(false)
		}

		// Fill the queue to its cap so a later probe can tell whether the
		// pre-aborted call below consumed a slot.
		for (let i = 0; i < 20; i++) {
			acquire(false, "interactive").catch(() => {})
		}

		const controller = new AbortController()
		controller.abort()
		await expect(
			acquire(false, "interactive", controller.signal)
		).rejects.toThrow(RateLimitAbortedError)

		// If the pre-aborted call had briefly occupied a slot, the queue
		// would now be under its cap — but it's still exactly full, so a
		// genuinely new call is still rejected for "queue full," not queued.
		await expect(acquire(false, "interactive")).rejects.toThrow(
			RateLimitTimeoutError
		)
	})
})
