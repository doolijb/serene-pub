/**
 * The **turn hold** — turns before background work (owner, 2026-10-03).
 *
 * A running turn opens a hold; the indexing lanes pick no *background* item
 * while any hold is open, nor for a short grace after the last one closes. A
 * promoted item — one a turn is waiting on — is never held back: the hold
 * pauses the sweep, not the queue's front.
 *
 * ## Why this exists
 *
 * PGlite runs Postgres in WASM on the main thread, and a query resolves as a
 * promise without ever returning to the event loop. A lane that awaits one
 * query after another is therefore **one long microtask chain**: timers, socket
 * reads and every other macrotask wait until the chain ends. Since retrieval
 * went on by default (R5) every turn queues its session on the annotation lane,
 * and on a big pub that lane's chain ran ~90 s — long enough that the next
 * turn's node clocks (2 s for the lore reads) expired while the turn's own
 * reads sat behind it, and its lore was recovered as empty.
 *
 * Two changes answer it, and this file is one of them: lanes now yield to the
 * event loop between items (`yieldToEventLoop`), and a turn's hold keeps their
 * background picks out of its way entirely.
 *
 * ## What a hold is not
 *
 * Not a lock — nothing waits on a hold except a lane deciding whether to pick
 * background work, so a hold can never deadlock a turn. Not a queue priority —
 * the lanes' own order (promotions first, then round-robin groups) is
 * untouched. And not model residency: a hold says nothing about which models
 * may be loaded (the lane-lifecycle rule — never couple a queue to residency).
 *
 * ## It cannot starve background work
 *
 * Background work resumes between turns: once the last hold closes and the
 * grace passes. A hold that is never closed — a bug, since `withTurnHold`
 * closes in `finally` — goes stale after `TURN_HOLD_STALE_MS` and is ignored
 * with a warning, so a leaked hold costs one long pause rather than the sweep.
 */

/**
 * The grace after the last hold closes before background work resumes.
 *
 * Long enough to bridge turns that follow one another — the next speaker in a
 * turn order, a chain of previews — so the sweep does not wedge one item into
 * the gap and make the next turn wait behind it; short enough that it resumes
 * while the person is still reading the reply.
 */
export const TURN_HOLD_GRACE_MS = 1_500

/**
 * How long a hold may stay open before it is presumed leaked and ignored.
 * Far past any real turn's own deadlines.
 */
export const TURN_HOLD_STALE_MS = 10 * 60_000

interface Hold {
	openedAt: number
	label: string
}

const holds = new Map<number, Hold>()
let nextHoldId = 1
let lastClosedAt = Number.NEGATIVE_INFINITY
let graceMs = TURN_HOLD_GRACE_MS

let quiet: { promise: Promise<void>; resolve: () => void } | null = null
let quietTimer: ReturnType<typeof setTimeout> | null = null

/** Drops holds past the stale mark, saying so once each. */
function pruneStale(now: number) {
	for (const [id, hold] of holds) {
		if (now - hold.openedAt < TURN_HOLD_STALE_MS) continue
		holds.delete(id)
		lastClosedAt = Math.max(lastClosedAt, hold.openedAt + TURN_HOLD_STALE_MS)
		console.warn(
			`[turn hold] "${hold.label}" was open for over ${Math.round(TURN_HOLD_STALE_MS / 60_000)} minutes and is ignored — background indexing resumes`
		)
	}
}

/**
 * Milliseconds until background work may run; 0 when it may run now.
 *
 * While a hold is open the answer is the time until the oldest one goes stale —
 * a close reschedules the wait long before that, so it is only the bound.
 */
function quietInMs(now = Date.now()): number {
	pruneStale(now)
	if (holds.size) {
		let oldest = Number.POSITIVE_INFINITY
		for (const hold of holds.values())
			oldest = Math.min(oldest, hold.openedAt)
		return Math.max(1, oldest + TURN_HOLD_STALE_MS - now)
	}
	return Math.max(0, lastClosedAt + graceMs - now)
}

function armQuietTimer() {
	if (quietTimer) clearTimeout(quietTimer)
	quietTimer = null
	if (!quiet) return
	const wait = quietInMs()
	if (wait <= 0) {
		const done = quiet
		quiet = null
		done.resolve()
		return
	}
	quietTimer = setTimeout(armQuietTimer, wait)
	// A lane waiting for quiet must not hold the process open.
	if (typeof quietTimer.unref === "function") quietTimer.unref()
}

/**
 * Open a hold. Returns its close, which is idempotent.
 *
 * Prefer `withTurnHold`, which cannot leak; this exists for a caller whose
 * turn does not fit one function.
 */
export function openTurnHold(label = "turn"): () => void {
	const id = nextHoldId++
	holds.set(id, { openedAt: Date.now(), label })
	let closed = false
	return () => {
		if (closed) return
		closed = true
		holds.delete(id)
		lastClosedAt = Date.now()
		// A lane parked on quiet now waits out the grace, not the stale bound.
		if (quiet) armQuietTimer()
	}
}

/** Run `fn` under a hold, closed however it ends. */
export async function withTurnHold<T>(
	fn: () => Promise<T>,
	label = "turn"
): Promise<T> {
	const close = openTurnHold(label)
	try {
		return await fn()
	} finally {
		close()
	}
}

/** True while a turn holds background work back — a hold is open, or the grace after one runs. */
export function isTurnHoldActive(): boolean {
	return quietInMs() > 0
}

/** How many holds are open now. For diagnostics and tests. */
export function openTurnHoldCount(): number {
	pruneStale(Date.now())
	return holds.size
}

/**
 * Resolves once no hold is open and the grace has passed. Never rejects.
 *
 * Every waiter shares one promise, so a lane that parks on it repeatedly while
 * a long turn runs does not pile up timers.
 */
export function whenTurnsQuiet(): Promise<void> {
	if (quietInMs() <= 0) return Promise.resolve()
	if (!quiet) {
		let resolve!: () => void
		const promise = new Promise<void>((r) => (resolve = r))
		quiet = { promise, resolve }
	}
	const pending = quiet.promise
	armQuietTimer()
	return pending
}

/**
 * One trip round the event loop.
 *
 * A lane awaits this between items: without it, a run of PGlite queries is a
 * single microtask chain and nothing else on the server — timers, sockets, a
 * turn's node clocks — gets a turn until the whole run ends (see the header).
 */
export const yieldToEventLoop = (): Promise<void> =>
	new Promise<void>((resolve) => setImmediate(resolve))

/** Tests only — sets the grace, or restores the default when omitted. */
export function setTurnHoldGraceForTests(ms: number = TURN_HOLD_GRACE_MS) {
	graceMs = ms
}

/** Tests only — forgets every hold and the last close. */
export function resetTurnHoldsForTests() {
	holds.clear()
	lastClosedAt = Number.NEGATIVE_INFINITY
	graceMs = TURN_HOLD_GRACE_MS
	if (quietTimer) clearTimeout(quietTimer)
	quietTimer = null
	const done = quiet
	quiet = null
	done?.resolve()
}
