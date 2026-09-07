/**
 * The runs currently in flight, so one can be stopped.
 *
 * `runSpec` has taken a `signal` since it existed, but nothing triggered from a
 * button ever passed one — so a pipeline run, once started, ran to completion no
 * matter what. That is tolerable for a summarize step and not for an image
 * render, which is a minute of GPU somebody may want back the instant they see
 * the prompt was wrong.
 *
 * A module-level map rather than anything durable: a run only exists while this
 * process is running it, and a restart cancels every run by definition. The
 * `userId` rides along so a run can only be stopped by whoever started it — a run
 * id is unguessable, but unguessable is not an access rule.
 */

export interface RunHandle {
	runId: string
	userId: number
	sessionId?: number
	specId?: string
	controller: AbortController
	startedAt: number
	/**
	 * Who stopped it and why, recorded at the moment of the abort.
	 *
	 * An `AbortSignal` carries the *fact* of a stop and nothing else — it has
	 * no room for an actor or a cause — so the provenance the receipt wants
	 * (`cancelledBy`, `haltReason`) has to be kept beside the controller. Set
	 * only by `stop` below, immediately before `.abort()`, so a handle that is
	 * aborted is a handle that already knows the answer.
	 */
	cancelledBy?: string
	cancelReason?: string
}

const runs = new Map<string, RunHandle>()

/**
 * Somebody who needs to know when a run stops — and there is exactly one:
 * the plugin runtime, whose in-flight hooks are the one thing a run starts
 * that an `AbortController` cannot reach. A hook runs inside a sandbox on
 * another thread; the only way to stop it is to address it by name.
 *
 * Declared here and implemented in `$lib/server/plugins`, never the other way
 * round — the same direction `pluginDispatch` takes, and for the same reason:
 * this module must not import the plugin subsystem, so that a build with
 * extensions dark carries none of it.
 */
export interface RunStopObserver {
	/** A run was stopped. Called before the abort reaches anything else. */
	stopped(runId: string, stop: RunStop): void
	/** A run left the registry; nothing more can arrive under this id. */
	finished(runId: string): void
}

/** Who stopped a run and why, plus what the id is about to become. */
export interface RunStop {
	by: string
	reason: string
	/**
	 * The stop is a supersede — `start` below is handing this very id to a new
	 * run in the same breath. An observer keyed on the id must apply this stop
	 * only to what was already running, never to what arrives after it, or a
	 * client re-sending a run would cancel its own replacement.
	 */
	idReused?: boolean
}

let observer: RunStopObserver | null = null

/** Wire the observer (startup). Idempotent; the last one wins. */
export function setRunStopObserver(next: RunStopObserver | null): void {
	observer = next
}

/**
 * The one way a run is stopped: record who and why, *then* abort.
 *
 * In that order, because the projection below reads the fields off the back of
 * `signal.aborted` — aborting first would leave a window where a run is
 * cancelled and cannot say by whom.
 *
 * Every stop in this module comes through here — a user's cancel, a supersede,
 * a reset — which is why the observer is notified from here rather than from
 * the three callers: a stop that forgot to tell it would be a run whose hooks
 * kept running, and that is precisely the bug this is closing.
 */
function stop(
	handle: RunHandle,
	by: string,
	reason: string,
	idReused = false
): void {
	handle.cancelledBy = by
	handle.cancelReason = reason
	handle.controller.abort()
	// After the abort, and never allowed to break it: an observer that throws
	// must not leave the run half-stopped for everything else that listens.
	try {
		observer?.stopped(handle.runId, { by, reason, idReused })
	} catch (e) {
		console.error("[runs] a run-stop observer threw:", e)
	}
}

/**
 * Register a run and get its signal.
 *
 * The caller supplies the id rather than receiving one, because a client needs
 * to be able to cancel a run it has not yet heard back about — the window
 * between pressing the button and the first progress event is exactly when
 * somebody realises they made a mistake.
 */
export function start(args: {
	runId: string
	userId: number
	sessionId?: number
	specId?: string
}): RunHandle {
	// A repeated id means a client re-sent; the older run is the stale one.
	// Its own reason, not the user-cancel one: nobody pressed anything, and a
	// receipt that said they did would be reporting a person who does not exist.
	const stale = runs.get(args.runId)
	if (stale)
		stop(
			stale,
			"system:superseded",
			"superseded by a newer run with the same id",
			// The id survives this stop and belongs to the run being started
			// below — see `RunStop.idReused`.
			true
		)
	const handle: RunHandle = {
		...args,
		controller: new AbortController(),
		startedAt: Date.now()
	}
	runs.set(args.runId, handle)
	return handle
}

/**
 * Stop a run.
 *
 * `found: false` for a run that has already finished — that is not an error, it
 * is a cancel that arrived late, which is the normal outcome of pressing Cancel
 * just as the result lands.
 */
export function cancel(
	runId: string,
	userId: number
): { found: boolean; allowed: boolean } {
	const handle = runs.get(runId)
	if (!handle) return { found: false, allowed: true }
	if (handle.userId !== userId) return { found: true, allowed: false }
	// The registry is the only place that still knows who asked. Recorded here
	// or nowhere: by the time the executor reads it back, the request is gone.
	stop(handle, `user:${userId}`, "the run was cancelled")
	return { found: true, allowed: true }
}

/** Always in a `finally` — a run left registered is a leak and a stale cancel target. */
export function finish(runId: string): void {
	runs.delete(runId)
	try {
		observer?.finished(runId)
	} catch (e) {
		console.error("[runs] a run-stop observer threw:", e)
	}
}

/** What is running right now, for diagnostics. */
export function active(): RunHandle[] {
	return [...runs.values()]
}

/** Test seam. */
export function _reset(): void {
	for (const handle of runs.values())
		stop(handle, "system:reset", "the run registry was reset")
	runs.clear()
}

/**
 * This run's cancellation, in the shape the executor asks for.
 *
 * One source, two shapes. `controller.abort()` is the only stop there is: the
 * adapters get it as an event through `scope.signal`, and the executor — which
 * cannot listen for anything, because it only ever pauses *between* nodes —
 * gets it as this poll. The rule underneath both is that **the signal object
 * never crosses a boundary it cannot cross; the fact does, in the shape that
 * boundary speaks.** A second controller here would be a second source, and
 * two sources of one truth is how a run gets cancelled in one half of itself.
 *
 * The provenance is the reason the executor wants a function rather than a
 * signal: it stamps `cancelledBy` and `haltReason` on the receipt, so
 * "somebody stopped it" stays distinguishable from "it broke".
 */
export function cancellation(
	handle: RunHandle
): { by: string; reason: string } | undefined {
	if (!handle.controller.signal.aborted) return undefined
	// Only reached when something aborted the controller without going through
	// `stop` — nothing in this module does, so this says "aborted, provenance
	// unknown" rather than inventing an actor.
	return {
		by: handle.cancelledBy ?? "system:unknown",
		reason: handle.cancelReason ?? "the run was aborted"
	}
}
