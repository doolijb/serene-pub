// scripts/singleFlight.js
//
// One runner, one run at a time, with every trigger that arrives mid-run
// collapsed into exactly one re-run afterwards.
//
// Split out of vite.config.ts so it can be tested without a Vite server, and
// because the failure it prevents is invisible from the call site. The docs
// recompile already sat behind a 300 ms debounce, which collapses a burst of
// watcher events — and nothing else. A save that lands four seconds into a
// four-second compile is not a burst: it started a SECOND compile over the
// same output directory, and the two interleaved their writes until one of
// them failed with ENOTEMPTY. Debouncing is about events; this is about runs.
//
// Side-effect free: importing this module only defines createSingleFlight.

/**
 * Wrap `run` so that it is never running twice.
 *
 * Calling the returned function while a run is in flight does NOT start a
 * second one. It marks the output stale and returns a promise for ONE
 * follow-up run that begins when the current one settles — one, however many
 * callers arrived meanwhile, because they all want the same thing: output that
 * reflects the newest input.
 *
 * The follow-up runs whether the current run resolved or rejected: a compile
 * that failed on a half-typed link is precisely the one whose re-run matters.
 * Each caller is handed the outcome of the run it was folded into, and the
 * flight is clear the moment that run settles either way — a throw can never
 * wedge it.
 *
 * ⚠ The returned promise rejects when its run does, so a caller that ignores
 * it is an unhandled rejection. Every caller here goes through a try/catch.
 *
 * @template T
 * @param {() => Promise<T>} run
 * @returns {() => Promise<T>}
 */
export function createSingleFlight(run) {
	/** The run in flight, or null when idle. @type {Promise<T> | null} */
	let running = null
	/** The one follow-up owed to mid-run triggers, or null. @type {Promise<T> | null} */
	let queued = null

	const start = () => {
		// `finally` is attached before anything else can subscribe, so the
		// flight is always clear by the time a waiter's `then` below fires —
		// which is what lets the follow-up start rather than queue itself
		// behind a run that has already finished.
		const settled = (async () => run())().finally(() => {
			running = null
		})
		running = settled
		return settled
	}

	const rerun = () => {
		queued = null
		return start()
	}

	return () => {
		if (!running) return start()
		// Both arms: a failed compile still owes the newest source a re-run.
		if (!queued) queued = running.then(rerun, rerun)
		return queued
	}
}
