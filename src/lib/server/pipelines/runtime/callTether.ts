/**
 * The tether between a node's clock and the request the host performs for it.
 *
 * A generating node declares `timeoutKind: 'idle'` (F36): it is timed on the
 * gap between signs of progress, not on its whole run. Only the host sees
 * that progress — the stream's chunks, a wait in the model server's queue, a
 * managed model loading, a prompt being processed — so the executor hands the
 * host both ends of the node's clock (`CallHandles`), and this is where core
 * holds them:
 *
 * - **down** — `signal` aborts on the run's cancel OR the node's own timeout.
 *   Before this the dispatch listened to the run's signal only, so a node that
 *   timed out left KoboldCPP generating into nothing, and the next request
 *   queued behind the zombie.
 * - **up** — `pulse` restarts the node's idle window. Callers pulse on every
 *   streamed chunk (body and reasoning) and every queue status change, and
 *   `hold` pulses on a steady beat for as long as the request is in flight:
 *   a request that is out, with its connection open, is alive. What judges a
 *   stalled stream is the adapter's own idle watchdog (`idleTimeout.ts`, ten
 *   minutes without a byte), which aborts the fetch and fails the call; the
 *   node's idle window judges the host's own stages around it, and the
 *   pub's ceiling (`NODE_TIMEOUT_CEILING_MS`) bounds the whole.
 *
 * A handle-less call (an older executor, a hand-built host in a test) gets the
 * run's signal and a pulse that does nothing — exactly the old behaviour.
 */
import type { CallHandles } from "@serene-pub/sdk"

/**
 * How often an in-flight request says it is alive. Well inside the shortest
 * idle window any generating node declares (120 s), and cheap: one timer
 * restart per beat.
 */
export const IN_FLIGHT_PULSE_MS = 10_000

/**
 * The absolute bound on any one node invocation, passed to the executor as
 * `timeoutCeilingMs`. An idle node pulses its window open for as long as its
 * request is alive; this is what still ends one that never ends. An hour: a
 * long reply on slow local hardware — a long prompt to process, a model to
 * load, a queue to wait in, then thousands of tokens at a few a second — fits
 * with room, and no definition declares a `timeoutMs` anywhere near it.
 */
export const NODE_TIMEOUT_CEILING_MS = 60 * 60_000

export interface CallTether {
	/** Aborts on the run's cancel or the node's own timeout — hand it to the dispatch. */
	readonly signal: AbortSignal | undefined
	/** The node is alive: restarts an idle window. Safe to call on every chunk. */
	pulse(): void
	/** Runs `work`, pulsing every `IN_FLIGHT_PULSE_MS` until it settles. */
	hold<T>(work: () => Promise<T>): Promise<T>
}

export function tether(
	handles: CallHandles | undefined,
	runSignal: AbortSignal | undefined
): CallTether {
	const signals = [runSignal, handles?.signal].filter(
		(s): s is AbortSignal => s !== undefined
	)
	const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
	const pulse = () => {
		try {
			handles?.pulse()
		} catch {
			// A clock's bookkeeping must never take a reply down.
		}
	}
	return {
		signal,
		pulse,
		async hold<T>(work: () => Promise<T>): Promise<T> {
			pulse()
			const beat = setInterval(pulse, IN_FLIGHT_PULSE_MS)
			try {
				return await work()
			} finally {
				clearInterval(beat)
			}
		}
	}
}
