/**
 * Self-throttles outbound requests to charavault.net to stay under its
 * published rate limits. A single shared sliding-window counter for the
 * whole process — CharaVault's limit is effectively a property of this
 * Serene Pub instance (one shared outbound IP), not of any individual
 * request.
 *
 * The ceiling is dynamic: 120/min when a CharaVault session is currently
 * cached and unexpired, else 15/min (a conservative floor — CharaVault
 * documents 60/min for anonymous traffic, but a separate, undocumented
 * lower tier for traffic it identifies as VPS/datacenter-sourced, which is
 * exactly what most self-hosted instances are; since we can't tell which
 * tier we've been placed in, assume the worst case rather than risk the
 * 240/min ban threshold).
 *
 * Callers are queued by priority, not just arrival order: "interactive"
 * callers (search, card detail, login — a human is waiting on the result)
 * are always granted a slot ahead of "background" callers (card thumbnail
 * fetches, which fire in bulk — up to a full page's worth — without any
 * single one being something the user is watching a spinner for). This
 * doesn't change the total budget, only who gets to spend it first, so a
 * burst of thumbnail loads can no longer make a typed search or a "Load
 * More" click wait behind them. Every acquire() call goes through the same
 * two queues below — there is no separate polling path — so this ordering
 * actually holds.
 *
 * Background callers aren't left waiting forever, though: a queued
 * background acquire() times out (rejecting with RateLimitTimeoutError) if
 * it hasn't been granted a slot within BACKGROUND_TIMEOUT_MS, and the
 * background queue itself is capped so a fast-scrolling client can't queue
 * up hundreds of thumbnail requests that are doomed to time out anyway.
 * Callers (the image proxy route) are expected to degrade gracefully on
 * this rejection rather than hang.
 */

const WINDOW_MS = 60_000
const AUTHENTICATED_CEILING = 120
const CONSERVATIVE_CEILING = 15

// Round-12 audit fix (MEDIUM): interactive-first *queue ordering* above
// doesn't reserve any *budget* — if background traffic has already pushed
// timestamps.length up to the ceiling, a brand-new interactive call still
// has to wait for a slot to free up (up to the full 60s window), priority
// or not. A single page of results can fire up to PAGE_SIZE (20)
// cache-miss thumbnail (background) requests nearly at once — on the
// conservative 15/min ceiling (the common case: no CharaVault credential
// configured), that alone can consume the *entire* budget, so a "Load
// More" click shortly after has to wait out almost the full window. This
// reserve keeps background traffic from ever fully starving interactive
// traffic: background may only fill up to (ceiling - reserve), so a fresh
// interactive call always has headroom under the full ceiling and is
// granted immediately, without needing to out-wait background traffic
// that already claimed a slot.
const INTERACTIVE_RESERVE = 5

/** How long a queued background (thumbnail) request waits before giving up. */
const BACKGROUND_TIMEOUT_MS = 40_000
/** Max queued background requests — roughly two pages' worth of thumbnails. */
const BACKGROUND_QUEUE_CAP = 48

/** Max queued interactive requests — bounds the unbounded-queue-growth/
 * memory concern this fixes without adding a per-waiter timeout (see the
 * comment in acquire() for why interactive waiters don't time out). */
const INTERACTIVE_QUEUE_CAP = 20

export type AcquirePriority = "interactive" | "background"

export class RateLimitTimeoutError extends Error {
	constructor() {
		super("Timed out waiting for a CharaVault rate-limit slot")
		this.name = "RateLimitTimeoutError"
	}
}

/** Distinct from RateLimitTimeoutError ("waited too long") — this means
 * the caller gave up before a slot was granted (eg. a newer search
 * superseded it). Callers treat this as routine/quiet, not a user-facing
 * error. */
export class RateLimitAbortedError extends Error {
	constructor() {
		super(
			"CharaVault request was cancelled before a rate-limit slot was granted"
		)
		this.name = "RateLimitAbortedError"
	}
}

interface Waiter {
	resolve: () => void
	reject: (err: Error) => void
	timeoutId?: ReturnType<typeof setTimeout>
	abortCleanup?: () => void
}

let timestamps: number[] = []
const queues: Record<AcquirePriority, Waiter[]> = {
	interactive: [],
	background: []
}

// Snapshot of the most recent caller's hasActiveSession — see the JSDoc on
// acquire() below for why this is a passed-in value rather than a live
// import from session.ts.
let latestHasActiveSession = false
let drainTimer: ReturnType<typeof setTimeout> | undefined

function pruneStale(now: number) {
	const cutoff = now - WINDOW_MS
	while (timestamps.length > 0 && timestamps[0] <= cutoff) {
		timestamps.shift()
	}
}

function removeWaiter(queue: Waiter[], waiter: Waiter) {
	const idx = queue.indexOf(waiter)
	if (idx !== -1) queue.splice(idx, 1)
}

function scheduleDrain(waitMs: number) {
	if (drainTimer) clearTimeout(drainTimer)
	drainTimer = setTimeout(drain, waitMs)
}

function grant(waiter: Waiter) {
	if (waiter.timeoutId) clearTimeout(waiter.timeoutId)
	waiter.abortCleanup?.()
	timestamps.push(Date.now())
	waiter.resolve()
}

/** Grants as many queued waiters as the current window allows, then
 * reschedules itself if anyone's still waiting. Interactive waiters may use
 * the full ceiling; background waiters are held to (ceiling - reserve) so
 * they can never fully starve a fresh interactive call — see
 * INTERACTIVE_RESERVE above. */
function drain() {
	drainTimer = undefined
	const now = Date.now()
	pruneStale(now)

	const ceiling = latestHasActiveSession
		? AUTHENTICATED_CEILING
		: CONSERVATIVE_CEILING

	while (timestamps.length < ceiling && queues.interactive.length > 0) {
		grant(queues.interactive.shift()!)
	}
	while (
		timestamps.length < ceiling - INTERACTIVE_RESERVE &&
		queues.background.length > 0
	) {
		grant(queues.background.shift()!)
	}

	if (queues.interactive.length > 0 || queues.background.length > 0) {
		const now2 = Date.now()
		pruneStale(now2)
		const waitMs =
			Math.max(0, (timestamps[0] ?? now2) + WINDOW_MS - now2) + 1
		scheduleDrain(waitMs)
	}
}

/**
 * Acquire a slot before making a CharaVault HTTP call. Resolves once a
 * slot is available (immediately, if under the ceiling and no
 * higher-priority waiter is ahead in queue).
 *
 * @param hasActiveSession - Cheap synchronous check for whether a session
 *   is currently cached and unexpired. Deliberately NOT "would getting a
 *   session succeed" — that could itself trigger a login call and create a
 *   circular dependency on this very limiter.
 * @param priority - "interactive" (default) for calls a user is directly
 *   waiting on (search, card detail, login); "background" for bulk/opportunistic
 *   calls (card thumbnails) that should never make an interactive call wait.
 * @param signal - Optional. If the caller no longer wants this request (eg.
 *   a newer search superseded it) and this call is still queued, it's
 *   removed immediately — freeing the slot without spending a timestamp —
 *   and rejects with RateLimitAbortedError instead of RateLimitTimeoutError.
 */
export async function acquire(
	hasActiveSession: boolean,
	priority: AcquirePriority = "interactive",
	signal?: AbortSignal
): Promise<void> {
	latestHasActiveSession = hasActiveSession

	// Checked first, ahead of the queue-cap checks below — a caller that's
	// already given up shouldn't get a "queue is full" error when the real
	// reason is "I don't want this anymore," and shouldn't consume a queue
	// slot at all.
	if (signal?.aborted) {
		throw new RateLimitAbortedError()
	}

	if (
		priority === "background" &&
		queues.background.length >= BACKGROUND_QUEUE_CAP
	) {
		throw new RateLimitTimeoutError()
	}
	if (
		priority === "interactive" &&
		queues.interactive.length >= INTERACTIVE_QUEUE_CAP
	) {
		throw new RateLimitTimeoutError()
	}

	return new Promise((resolve, reject) => {
		const waiter: Waiter = { resolve, reject }
		if (priority === "background") {
			waiter.timeoutId = setTimeout(() => {
				removeWaiter(queues.background, waiter)
				waiter.abortCleanup?.()
				reject(new RateLimitTimeoutError())
			}, BACKGROUND_TIMEOUT_MS)
		}
		// Interactive waiters deliberately get no per-waiter timeout, only
		// the queue-length cap above — a timeout short enough to matter for
		// UX (eg. 15s) rejects a legitimate burst of interactive activity
		// under the conservative (15/min, no session) ceiling, since even a
		// handful of near-simultaneous calls can take longer than that to
		// drain through no fault of any single caller. The cap alone
		// already bounds the unbounded-growth/memory concern this fixes;
		// letting interactive calls wait it out (as they always have) keeps
		// that fix from also breaking normal, non-abusive usage.
		if (signal) {
			const onAbort = () => {
				removeWaiter(queues[priority], waiter)
				if (waiter.timeoutId) clearTimeout(waiter.timeoutId)
				reject(new RateLimitAbortedError())
			}
			signal.addEventListener("abort", onAbort, { once: true })
			waiter.abortCleanup = () =>
				signal.removeEventListener("abort", onAbort)
		}
		queues[priority].push(waiter)
		drain()
	})
}

/** Test-only: reset the shared window and queues between test cases. */
export function _resetForTests() {
	timestamps = []
	if (drainTimer) clearTimeout(drainTimer)
	drainTimer = undefined
	for (const priority of ["interactive", "background"] as const) {
		for (const waiter of queues[priority]) {
			if (waiter.timeoutId) clearTimeout(waiter.timeoutId)
		}
		queues[priority] = []
	}
}
