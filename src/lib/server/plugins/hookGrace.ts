/**
 * The grace policy: **abort, wait the run's budget, then kill.**
 *
 * The sandbox layer hands core two ways to stop a hook and deliberately no
 * opinion about how they relate — `abort` asks (the hook's own `ctx.signal`
 * fires and it winds down in its own frame), `kill` forces — and
 * `PluginSandbox.kill` says in as many words that sequencing the two "belongs
 * to the dispatcher, not here". This is the dispatcher's half, and the only
 * place in the app that sequences them.
 *
 * ## Two things this deliberately does not have
 *
 *  - **No declared "this hook handles abort" fact.** Handling an abort is
 *    observable behaviour, not metadata: from out here the only question that
 *    can be answered is *did it return inside the budget*. A synchronous hook,
 *    a tight loop, and a hook awaiting only already-resolved promises are one
 *    outcome and not three — none of them ever reaches an await where the
 *    signal can be delivered, so all three are killed, and a manifest flag
 *    claiming one of them cooperates would be a promise the sandbox cannot
 *    keep.
 *  - **No second entry point for cleanup.** A hook winds itself down inside
 *    the frame it was already in, where its transaction, its temp files and
 *    its locals are still in scope. Core calling some `onCancel` export
 *    instead would run in a fresh scope that holds none of them, and could
 *    only pretend to release what the first call is still holding.
 *
 * ## The budget belongs to the run, not the hook
 *
 * Five hooks in flight when one run is cancelled share ONE budget, so a cancel
 * costs the grace once rather than five times over. That also closes the
 * fan-out: a cancelled run cannot buy itself more time by dispatching more
 * hooks, because a hook that arrives after the cancellation inherits whatever
 * is *left* of the run's budget — and nothing at all once it has run out.
 *
 * ## The grace is a ceiling, never an extension
 *
 * A hook's own `timeoutMs` still applies underneath, and is often the shorter
 * of the two: a chain link runs on a 250ms budget, so the sandbox stops it long
 * before this policy would, and the grace never comes into it. What the grace
 * actually buys time for are the long-budget hooks — a plugin node's 30s, a
 * template engine's 3s — which are exactly the ones that could still be holding
 * something when the person presses Cancel. Nothing here can let a hook outlive
 * the deadline its caller gave it.
 *
 * ## The settle-during-grace race
 *
 * The whole point of the grace is that a hook may return inside it, and a hook
 * that returns is an ordinary success that must not then be killed. Two
 * independent guards, because this is the race the policy exists to lose
 * safely:
 *
 *  1. `settled(callId)` removes the call from its run's waiting set the moment
 *     the dispatcher stops waiting on it, and disarms the run's timer when the
 *     set empties — so a cancelled run whose hooks all returned leaves no
 *     timer behind at all.
 *  2. The reap only ever addresses call ids it aborted, and `kill` resolves the
 *     call through the live registry — a call that has settled is not there, so
 *     even a timer that somehow outlived its call stops at a no-op instead of
 *     landing on whatever ran next.
 */

/**
 * How long a cancelled run's hooks get to wind themselves down before core
 * stops them for certain.
 *
 * Hardcoded for now, and destined to be a setting: this is a judgement about
 * what an extension is allowed to keep doing after the person said stop, and
 * an instance running hooks that flush to slow storage will want a different
 * number from one running text transforms. It is deliberately *not* per hook
 * (see the header) — exposing it later means exposing one field, not a matrix.
 *
 * Two seconds, because the grace is not user-visible latency — cancelling a
 * run returns immediately and the winding-down happens behind it — so the
 * number only has to be long enough for a hook parked at an await to wake,
 * close what it opened and return, and short enough that a stuck hook is not
 * left touching the instance's data for a noticeable slice of a minute.
 */
export const HOOK_CANCEL_GRACE_MS = 2_000

/** What the policy needs from the dispatcher; nothing else about it. */
export interface GracePorts {
	/**
	 * The calls a run has in flight *right now*. Read fresh on every use
	 * rather than captured, because the set changes underneath: a call can
	 * settle, and a queued one can start, between the cancel and the reap.
	 */
	callsOfRun(runId: string): number[]
	/** Fire one call's `ctx.signal`. Asks; never waits. */
	abort(callId: number): void
	/** Stop one call for certain, recording why it was stopped. */
	kill(callId: number, reason: string): void
}

/** Who stopped a run and why — the provenance the receipt already carries. */
export interface RunStop {
	by: string
	reason: string
	/**
	 * The stop is a supersede: this id is being handed to a *new* run in the
	 * same breath (`runRegistry.start` re-uses a repeated id), so the record
	 * below must not be applied to anything that arrives afterwards — those
	 * hooks belong to the replacement run, and killing them would make a
	 * re-send cancel itself.
	 */
	idReused?: boolean
}

interface Cancelling {
	runId: string
	by: string
	reason: string
	/** One deadline for the whole run — the budget, spent once. */
	deadlineAt: number
	/** The single reap timer, armed only while something is waiting on it. */
	timer?: ReturnType<typeof setTimeout>
	/** Calls aborted under this cancellation that have not settled yet. */
	waiting: Set<number>
	/** Whether a later-arriving call still belongs to this cancellation. */
	sealed: boolean
}

export class HookGracePolicy {
	/**
	 * Cancelled runs a later call could still belong to. A run leaves this map
	 * when it leaves the registry — which routinely happens *inside* the grace
	 * window, because a cancelled run returns from its executor almost at once
	 * while its hooks are still winding down. That is exactly why an armed reap
	 * holds its own record (below) rather than looking one up here: the hooks
	 * it aborted are still that stopped run's, whatever the registry now says.
	 */
	private readonly runs = new Map<string, Cancelling>()
	/**
	 * callId → the cancellation it is waiting under. By record and not by run
	 * id, so a settle is answered identically before and after the run has been
	 * forgotten.
	 */
	private readonly waitingCall = new Map<number, Cancelling>()

	constructor(private readonly ports: GracePorts) {}

	/**
	 * A run was stopped: ask every hook it has in flight to wind down, and put
	 * the whole set on one clock.
	 *
	 * Idempotent per run, and pointedly so — a second stop must not restart the
	 * budget. A run cancelled twice was stopped once; the extra press of the
	 * button is not more time.
	 */
	cancelRun(runId: string, stop: RunStop): void {
		if (this.runs.has(runId)) return
		const entry: Cancelling = {
			runId,
			by: stop.by,
			reason: stop.reason,
			deadlineAt: Date.now() + HOOK_CANCEL_GRACE_MS,
			waiting: new Set(),
			sealed: !!stop.idReused
		}
		this.runs.set(runId, entry)
		for (const callId of this.ports.callsOfRun(runId))
			this.ask(entry, callId)
	}

	/**
	 * A call reaching the sandbox under a run that is already cancelled.
	 *
	 * This is what makes the budget genuinely per-run. A cancelled run is not
	 * finished the instant it is stopped — a chain fold absorbs the failure of
	 * the link it just lost and dispatches the next one, and a call that was
	 * queued behind the ready-gate or a sequential plugin starts later still.
	 * Each of those inherits what is left of the run's budget, and once that is
	 * spent it is stopped on arrival rather than granted a fresh window.
	 */
	adopt(runId: string, callId: number): void {
		const entry = this.runs.get(runId)
		if (entry && !entry.sealed) this.ask(entry, callId)
	}

	/** The dispatcher stopped waiting on a call, however it ended. */
	settled(callId: number): void {
		if (!this.waitingCall.size) return
		const entry = this.waitingCall.get(callId)
		if (!entry) return
		this.waitingCall.delete(callId)
		entry.waiting.delete(callId)
		// Nothing left to reap: disarm rather than leave a timer to fire into
		// an empty set. The record itself stays while the run does — it is
		// still cancelled, and a hook arriving before the deadline is still its
		// business.
		if (!entry.waiting.size) this.disarm(entry)
	}

	/**
	 * A run left the registry: nothing more can arrive under its id, so no
	 * later call needs to be matched against it and the record is dropped. That
	 * is what keeps a long-lived process from accumulating one entry per cancel
	 * it has ever seen.
	 *
	 * ⚠ It does **not** call off a reap already armed. A cancelled run reaches
	 * its `finally` almost immediately — the executor stops between nodes,
	 * while its hooks are still winding down — so treating this as "never mind"
	 * would cancel the kill half of the policy in nearly every real
	 * cancellation, leaving an uncooperative hook running with nothing left to
	 * stop it.
	 */
	forget(runId: string): void {
		this.runs.delete(runId)
	}

	/** Drop every record and timer (dispose / test teardown). */
	dispose(): void {
		for (const entry of new Set(this.waitingCall.values()))
			this.disarm(entry)
		this.waitingCall.clear()
		this.runs.clear()
	}

	/**
	 * What the policy is still holding: every cancellation it could match a
	 * call against, plus every one with a reap still armed. The second half is
	 * the interesting one — "a settled call leaves no timer behind" is only
	 * checkable if the timers are visible.
	 */
	pending(): { runId: string; waiting: number[]; armed: boolean }[] {
		const all = new Set<Cancelling>([
			...this.runs.values(),
			...this.waitingCall.values()
		])
		return [...all].map((e) => ({
			runId: e.runId,
			waiting: [...e.waiting],
			armed: e.timer !== undefined
		}))
	}

	/** Ask one call to stop, on the run's clock rather than its own. */
	private ask(entry: Cancelling, callId: number): void {
		this.ports.abort(callId)
		const left = entry.deadlineAt - Date.now()
		// The budget is already spent — this call is late to a grace that is
		// over, and giving it its own would be the per-hook budget by another
		// name.
		if (left <= 0) {
			this.ports.kill(callId, this.why(entry))
			return
		}
		entry.waiting.add(callId)
		this.waitingCall.set(callId, entry)
		// One timer for the run, armed with what is *left* of the budget, so a
		// call adopted halfway through cannot extend it.
		if (!entry.timer) entry.timer = setTimeout(() => this.reap(entry), left)
	}

	/** The budget is up: whatever is still in flight is stopped for certain. */
	private reap(entry: Cancelling): void {
		entry.timer = undefined
		const why = this.why(entry)
		for (const callId of [...entry.waiting]) {
			entry.waiting.delete(callId)
			this.waitingCall.delete(callId)
			this.ports.kill(callId, why)
		}
	}

	private disarm(entry: Cancelling): void {
		if (entry.timer) clearTimeout(entry.timer)
		entry.timer = undefined
	}

	/**
	 * Why this hook was stopped, in the log's own words. Distinct from the
	 * sandbox's generic "the call was killed" *and* from an overrun, because
	 * "your extension was stopped because somebody cancelled the run" and
	 * "your extension would not stop on its own" are different things to know.
	 */
	private why(entry: Cancelling): string {
		return (
			`killed after the ${HOOK_CANCEL_GRACE_MS}ms cancellation grace — ` +
			`its run was stopped by ${entry.by} (${entry.reason})`
		)
	}
}
