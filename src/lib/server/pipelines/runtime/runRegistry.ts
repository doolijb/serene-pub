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

import type { StatusText } from "@serene-pub/sdk"

/**
 * What a run is FOR, as the message's own Stop reads it.
 *
 * A Stop that stopped every run in the session, whoever started it and
 * whatever it was doing, is a guest's Stop on a reply aborting the owner's
 * image render or summary. The kind is what lets `sessionMessages:cancel`
 * stop what the released rows are about and nothing else:
 *
 *  · `reply` — a turn filling a message row (`runReply`); stopped when the
 *    row it fills is among the released, or when it has not made one yet.
 *  · `action` — a contributed function a person triggered
 *    (`sessions:triggerFunction`): a render, a summary, a tool. Stopped only
 *    when its live row — if it has one — is among the released.
 *  · `maintenance` — nothing a person is watching from the composer; never
 *    stopped by a message's Stop. Reserved: nothing registers one yet.
 */
export type RunKind = "reply" | "action" | "maintenance"

export interface RunHandle {
	runId: string
	userId: number
	sessionId?: number
	specId?: string
	kind: RunKind
	/**
	 * The message row this run is filling, once it has one — a verb's row
	 * from the start, a fresh turn's from the moment its placeholder commits
	 * (`setLiveRow`). What `cancelSession` matches the released rows against.
	 */
	liveRow?: number
	/**
	 * What the run is doing right now (R-19): the last status a node set,
	 * `{speaker}` filled — *Jasmine is typing*. Kept here so `sessions:list`
	 * can say it for a session whose run is in flight, and cleared with the
	 * run. Ephemeral like the handle itself; the receipt keeps only the last
	 * one, and only when the run died.
	 */
	status?: StatusText
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
	kind: RunKind
	liveRow?: number
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

/**
 * Stop one run by id with a named actor — the shape a **parent's** stop
 * takes when it reaches a child it dispatched (`fireAction`, U5d): the
 * parent's abort is a fact, and this is that fact in this registry's
 * vocabulary, with the provenance the receipt wants. `false` for a run that
 * has already finished, which is the normal outcome of a stop arriving late.
 * Not an access rule: the caller already holds the parent's handle.
 */
export function cancelAs(runId: string, by: string, reason: string): boolean {
	const handle = runs.get(runId)
	if (!handle) return false
	stop(handle, by, reason)
	return true
}

/**
 * The row a run is filling, told to the registry the moment it exists.
 *
 * Called from the live row when a placeholder commits, so a fresh turn's run
 * can be matched against the rows a Stop released. A run id nothing matches
 * is a no-op — the run finished, or was never registered (a preview, a test).
 */
export function setLiveRow(runId: string, row: number): void {
	const handle = runs.get(runId)
	if (handle) handle.liveRow = row
}

/**
 * The run's current status, told to the registry by the status relay
 * (`runStatus.ts`) as each one lands, and cleared (`undefined`) when the run
 * ends. A run id nothing matches is a no-op — a preview, a test.
 */
export function setStatus(runId: string, status: StatusText | undefined): void {
	const handle = runs.get(runId)
	if (handle) handle.status = status
}

/**
 * What each session's newest in-flight run is doing, for the session list:
 * one status per session, the most recently started run's. A session with no
 * run in flight, or whose runs have set no status, is absent.
 */
export function statusesBySession(): Map<number, StatusText> {
	const out = new Map<number, { status: StatusText; startedAt: number }>()
	for (const handle of runs.values()) {
		if (handle.sessionId === undefined || !handle.status) continue
		const held = out.get(handle.sessionId)
		if (!held || handle.startedAt > held.startedAt)
			out.set(handle.sessionId, {
				status: handle.status,
				startedAt: handle.startedAt
			})
	}
	return new Map([...out].map(([id, v]) => [id, v.status]))
}

/**
 * Stop the runs a message's Stop was about — and only those.
 *
 * `sessionMessages:cancel` is the client's guarantee that a generating row
 * stops, whoever started the run: it releases the generating rows FIRST and
 * unconditionally, and this is the half that reaches the run itself. The
 * pipeline owns its row now (09-B B4), so a stop that did not reach the run
 * would leave the executor walking on to the write while the row it was
 * filling had already been released. Access was checked by the handler — a
 * participant may stop what is generating in a session they can read — so
 * there is no owner test here, unlike `cancel`, which answers a click on a run
 * card that names one run and one person.
 *
 * Scoped by the ROWS, not the session: a run is stopped when its live row is
 * among the released, or when it is a `reply` that has not made its row yet —
 * the window between a fresh turn starting and its placeholder committing,
 * where the only thing a Stop can mean for it is stop. An `action` with no row,
 * or with a row nobody released — the owner's image render, a summary — keeps
 * running through a guest's Stop on a reply. Before this it did not.
 */
export function cancelSession(
	sessionId: number,
	by: string,
	released: Iterable<number>
): number {
	const rows = new Set(released)
	let stopped = 0
	for (const handle of runs.values()) {
		if (handle.sessionId !== sessionId) continue
		if (handle.controller.signal.aborted) continue
		const about =
			(handle.liveRow !== undefined && rows.has(handle.liveRow)) ||
			(handle.kind === "reply" && handle.liveRow === undefined)
		if (!about) continue
		stop(handle, by, "the run was cancelled")
		stopped++
	}
	return stopped
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
