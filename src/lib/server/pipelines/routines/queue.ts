/**
 * 🚧 **The routine queue** (PLAN-layering D7, R13, R14, R18, §11-6; lane 6,
 * 2026-10-20) — per session, in memory, one routine at a time, in order.
 *
 * ```
 * a cadence comes due ─▶ a firing (its own cause) ─▶ the session's queue
 *                                                     │ waits while an action or event run of the
 *                                                     │ session is pending or running (R13)
 *                                                     ▼
 *                                                   run, one at a time, in order (R14)
 * ```
 *
 *  · **Every firing is its own entry** with its own `cause` — nothing is
 *    merged, joined or dropped (R14) — except by Allow stacking (R18).
 *  · **Allow stacking off** (the default): a firing that finds the same
 *    registration WAITING (queued, not started) is refused, with an inspector
 *    line ("Skipped: already waiting"); one that arrives while it RUNS still
 *    queues one, so changes made during a run get one follow-up. On: every
 *    firing queues.
 *  · **Routines always wait** (R13, worded by family, LS2): a routine starts
 *    only when the session has no `action` or `event` run pending or running
 *    — the run registry, the session's event chain and its generation lock.
 *    A routine run never makes anything else wait.
 *  · Keyed on the **registration key** (§11-6), never a preset slot, so a
 *    registration of any origin gets the same rules.
 *
 * The queue is pure over what it is handed (`RoutineQueueDeps`): whether the
 * session is busy, how to wait a beat, how to run a firing, how to say a
 * refusal. The runtime wires the real ones (`run.ts`); a test wires fakes.
 */
import type { RoutineCause } from "@serene-pub/sdk"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"

/** One firing of one routine — its own entry in its session's queue. */
export interface RoutineFiringEntry {
	id: string
	/** The database handle the firing runs against — handed down, never the default one. */
	db: unknown
	sessionId: number
	registrationKey: string
	pipeline: string
	/** What the moment carried (R9). */
	cause: RoutineCause
	/** The turn, round or scene it fired on. */
	firedAt: { turn?: number; round?: number; sceneId?: number }
	/** 0: a person's moment woke it; 1: a routine's own write did (R19). */
	depth: number
	/** Where its writes are announced — the socket server the moment came through. */
	io?: SessionIo
	/** Fired by hand (R39): the person who pressed Run now. */
	runNow?: { userId: number }
	queuedAt: number
}

/** What a queue needs from the runtime. */
export interface RoutineQueueDeps {
	/** Is an action or event run of this session pending or running (R13)? */
	busy(sessionId: number): boolean
	/** Wait a beat for the session to settle (resolves; never rejects). */
	waitQuiet(sessionId: number): Promise<void>
	/** Run one firing to its end (or until it parks for a person). Never rejects past the queue. */
	run(firing: RoutineFiringEntry): Promise<void>
	/** A firing was refused (Allow stacking off) — say it where the inspector reads. */
	refused(firing: RoutineFiringEntry, reason: string): Promise<void>
}

interface SessionQueue {
	waiting: RoutineFiringEntry[]
	running: RoutineFiringEntry | null
	draining: Promise<void> | null
	/** Told when the drain stops to wait for the session (a settle stops waiting on it). */
	onBlocked: Array<() => void>
}

/** What the inspector shows of a session's queue (the watch item, §3). */
export interface RoutineQueueView {
	running: { registrationKey: string; queuedAt: number } | null
	waiting: Array<{ registrationKey: string; queuedAt: number; cause: RoutineCause }>
}

/** The sentence a refused firing leaves in the inspector (R18). */
export const ALREADY_WAITING = "Skipped: already waiting"

export class RoutineQueue {
	private readonly queues = new Map<number, SessionQueue>()

	constructor(private readonly deps: RoutineQueueDeps) {}

	/**
	 * Queue a firing — or refuse it when the same registration is already
	 * WAITING and does not allow stacking (R18). Resolves once it is queued or
	 * refused; never waits for the run.
	 */
	async fire(
		firing: RoutineFiringEntry,
		opts: { allowStacking?: boolean } = {}
	): Promise<{ queued: true } | { queued: false; reason: string }> {
		const q = this.queueOf(firing.sessionId)
		if (!opts.allowStacking && q.waiting.some((w) => w.registrationKey === firing.registrationKey)) {
			await this.deps.refused(firing, ALREADY_WAITING).catch(() => undefined)
			return { queued: false, reason: ALREADY_WAITING }
		}
		q.waiting.push(firing)
		void this.drain(firing.sessionId)
		return { queued: true }
	}

	/** Is this registration waiting (queued, not started) in its session? */
	isWaiting(sessionId: number, registrationKey: string): boolean {
		return !!this.queues.get(sessionId)?.waiting.some((w) => w.registrationKey === registrationKey)
	}

	/** Is this registration running in its session? */
	isRunning(sessionId: number, registrationKey: string): boolean {
		return this.queues.get(sessionId)?.running?.registrationKey === registrationKey
	}

	/** The session's queue, for the inspector. */
	view(sessionId: number): RoutineQueueView {
		const q = this.queues.get(sessionId)
		return {
			running: q?.running ? { registrationKey: q.running.registrationKey, queuedAt: q.running.queuedAt } : null,
			waiting: (q?.waiting ?? []).map((w) => ({ registrationKey: w.registrationKey, queuedAt: w.queuedAt, cause: w.cause }))
		}
	}

	/**
	 * The drains a settle may wait on: every session whose queue is working
	 * and not held by a run of its own session (a reply parked at a review
	 * gate would hold it for as long as a person takes).
	 */
	settling(sessionId?: number): Promise<void>[] {
		const out: Promise<void>[] = []
		for (const [id, q] of this.queues) {
			if (sessionId !== undefined && id !== sessionId) continue
			const draining = q.draining
			if (!draining) continue
			if (!q.running && this.deps.busy(id)) continue
			// Until the drain ends — or stops to wait for the session again, so
			// a settle never waits on a routine a parked run is holding.
			out.push(
				new Promise<void>((resolve) => {
					q.onBlocked.push(resolve)
					void draining.then(resolve, resolve)
				})
			)
		}
		return out
	}

	/** Every session with something queued or running. */
	sessions(): number[] {
		return [...this.queues.keys()]
	}

	/** Tests: drop every queue (a run already started finishes on its own). */
	reset(): void {
		this.queues.clear()
	}

	private queueOf(sessionId: number): SessionQueue {
		let q = this.queues.get(sessionId)
		if (!q) this.queues.set(sessionId, (q = { waiting: [], running: null, draining: null, onBlocked: [] }))
		return q
	}

	/** Run the session's firings one at a time, each once the session is quiet (R13). */
	private drain(sessionId: number): Promise<void> {
		const q = this.queueOf(sessionId)
		if (q.draining) return q.draining
		q.draining = (async () => {
			try {
				while (q.waiting.length) {
					while (this.deps.busy(sessionId)) {
						for (const told of q.onBlocked.splice(0)) told()
						await this.deps.waitQuiet(sessionId)
					}
					const next = q.waiting.shift()
					if (!next) break
					q.running = next
					try {
						await this.deps.run(next)
					} catch (err) {
						console.warn(`[routines] ${next.registrationKey} in session ${sessionId} failed:`, err)
					} finally {
						q.running = null
					}
				}
			} finally {
				q.draining = null
				for (const told of q.onBlocked.splice(0)) told()
				if (!q.waiting.length && !q.running && this.queues.get(sessionId) === q) this.queues.delete(sessionId)
			}
		})()
		return q.draining
	}
}
