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
}

const runs = new Map<string, RunHandle>()

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
	runs.get(args.runId)?.controller.abort()
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
	handle.controller.abort()
	return { found: true, allowed: true }
}

/** Always in a `finally` — a run left registered is a leak and a stale cancel target. */
export function finish(runId: string): void {
	runs.delete(runId)
}

/** What is running right now, for diagnostics. */
export function active(): RunHandle[] {
	return [...runs.values()]
}

/** Test seam. */
export function _reset(): void {
	for (const handle of runs.values()) handle.controller.abort()
	runs.clear()
}
