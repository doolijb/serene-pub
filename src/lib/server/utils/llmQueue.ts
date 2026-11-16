import { AsyncLocalStorage } from "node:async_hooks"
import { v4 as uuidv4 } from "uuid"
import type { TaskType } from "./resolveTaskConfig"
import { llmLaneWidthOf, type LlmLaneHost } from "$lib/server/connections/llmLanes"

export type LLMQueueStatus =
	| "queued"
	| "loading"
	| "generating"
	| "done"
	| "error"
	| "cancelled"

export interface LLMQueueItemInput<T> {
	taskType: TaskType
	connectionName: string
	/**
	 * The host this call's LLM lane is keyed by (`resolveLlmLaneHost`). Absent:
	 * the LLM lane of `connectionName` alone (`connection:<name>`), width 1.
	 */
	lane?: LlmLaneHost
	samplingName: string
	sessionId?: number
	messageId?: number
	lorebookId?: number
	label?: string
	/** Who queued this — used for display in the queue snapshot only, not a throttle. */
	userId?: number
	/** Optional hook run before execute(), e.g. koboldcpp managed-mode model loading. */
	preflight?: (signal: AbortSignal) => Promise<void>
	execute: (signal: AbortSignal) => Promise<T>
	/** Adapter-specific cancellation side effect, e.g. adapter.abort(). */
	onCancel?: () => void
	onStatusChange?: (status: LLMQueueStatus) => void
	/**
	 * 🚧 Where the call waits among the queued ones (A13, R26): lower goes
	 * first — `LLM_PRIORITY.interactive` (session creation, a person's
	 * action), `event`, then `routine`; first-in-first-out within one. A
	 * running call is never pre-empted; priority orders the waiting calls
	 * within one LLM lane. Absent: the priority of the run whose work is
	 * calling (`currentLlmPriority`).
	 */
	priority?: number
}

export interface LLMQueueSnapshotItem {
	id: string
	taskType: TaskType
	connectionName: string
	/** Server-side only: the LLM lane key the item runs on. Never forwarded to clients. */
	laneKey: string
	samplingName: string
	status: LLMQueueStatus
	startedAt: string
	sessionId?: number
	messageId?: number
	lorebookId?: number
	label?: string
	userId?: number
	/** 🚧 The item's priority (A13): lower goes first. */
	priority?: number
}

/**
 * 🚧 **Model-queue priority** (A13, R26; PLAN-layering D7, 2026-10-20):
 * session creation and a person's actions first, then event runs (a reply
 * included), then routines — across sessions. FIFO within a priority.
 */
export const LLM_PRIORITY = Object.freeze({ interactive: 0, event: 1, routine: 2 })

/** The trigger family of the run whose work is running here, and whether it creates a session. */
interface RunFamilyContext {
	family: string
	creation?: boolean
}

/**
 * 🚧 The run a call belongs to, carried through its async work so the queue
 * reads its family at every enqueue site without a parameter threaded
 * through every binding. Set by `runSpec` around a run (`withRunFamily`).
 */
const runFamilies = new AsyncLocalStorage<RunFamilyContext>()

/** 🚧 Run `fn` as work of a run of this trigger family — every model call it queues takes that family's priority. */
export function withRunFamily<T>(family: string, fn: () => T, opts: { creation?: boolean } = {}): T {
	return runFamilies.run({ family, ...(opts.creation ? { creation: true } : {}) }, fn)
}

/** 🚧 The trigger family of the run whose work is calling, if any. */
export function currentRunFamily(): string | undefined {
	return runFamilies.getStore()?.family
}

/**
 * 🚧 A trigger family's priority (R26): actions and session creation
 * first, then events, then routines. A family core does not know yet (a
 * later one, LS1) and a call made outside any run wait with events.
 */
export function priorityOfFamily(family: string | undefined, opts: { creation?: boolean } = {}): number {
	if (opts.creation || family === "action") return LLM_PRIORITY.interactive
	if (family === "routine") return LLM_PRIORITY.routine
	return LLM_PRIORITY.event
}

/** 🚧 The priority a call queued from here takes — its run's family's (`withRunFamily`). */
export function currentLlmPriority(): number {
	const ctx = runFamilies.getStore()
	return priorityOfFamily(ctx?.family, { creation: ctx?.creation })
}

export class CancelledError extends Error {
	constructor(message = "Cancelled") {
		super(message)
		this.name = "CancelledError"
	}
}

export class ForceDetachedError extends Error {
	constructor(
		message = "Cancelled request did not stop in time; queue forced ahead"
	) {
		super(message)
		this.name = "ForceDetachedError"
	}
}

/** True for any rejection that originated from a user/queue-initiated cancel — never a real failure. */
export function isQueueCancellation(err: unknown): boolean {
	return err instanceof CancelledError || err instanceof ForceDetachedError
}

interface Run<T> {
	id: string
	item: LLMQueueItemInput<T>
	status: LLMQueueStatus
	startedAt: string
	controller: AbortController
	resolve: (value: T) => void
	reject: (reason: unknown) => void
	settled: boolean
	forceDetachTimer: ReturnType<typeof setTimeout> | null
	/**
	 * The LLM lanes held by the causal chain that called enqueue(), captured
	 * there (never in pump, whose own async context belongs to whatever run
	 * happened to finish last).
	 */
	heldLanes: ReadonlySet<string>
}

interface Lane {
	queue: Run<any>[]
	running: Set<Run<any>>
	host?: LlmLaneHost
}

const FORCE_DETACH_MS = 10_000

// The queue has one LLM lane per host (see getConcurrencyKey below): a host is
// the URL origin of the connection's resolved base URL, and an LLM lane runs up
// to `llmLaneWidthOf` calls at once (1 for every local or managed host, so two
// generations never share a GPU; wider for a known cloud host). There is
// deliberately no per-user depth cap on top of that; `userId` on a queued item
// is used only for display (see snapshot()) and isn't a throttle. A flat depth
// ceiling, MAX_QUEUE_DEPTH per LLM lane, is the smaller fix for the
// resource-exhaustion half of the problem: without it, any authenticated user
// able to trigger repeated LLM calls could queue unbounded items (each a
// Run<T> holding closures over full session/adapter state) with no cap at all.
export const MAX_QUEUE_DEPTH = 20

// Concurrency grouping: one LLM lane per host. The key is the item's host
// origin (`llmLaneHostOf`); an item that names no host gets the LLM lane of its
// connection alone. A pure function of the item — same item, same LLM lane.
function getConcurrencyKey(item: LLMQueueItemInput<any>): string {
	return item.lane?.laneKey ?? `connection:${item.connectionName}`
}

type SnapshotListener = () => void

// Tracks which LLM lane keys are currently "held" by the causal chain of an
// in-flight run's execution — set around runIt() in pump() below (from the
// `heldLanes` captured at enqueue time), and inherited automatically by
// anything that run awaits (including further enqueue() calls made from deep
// within it). Exists to avoid a deadlock: an enqueue() onto an LLM lane the
// calling chain already holds would wait for a run that is itself waiting for
// it, so that case runs inline instead. No production caller does this today
// (every execute() is a leaf adapter call); the guard stays as a safety net.
const activeLanes = new AsyncLocalStorage<Set<string>>()

class LLMQueue {
	private lanes = new Map<string, Lane>()
	private runsById = new Map<string, Run<any>>()
	private listeners = new Set<SnapshotListener>()

	registerListener(fn: SnapshotListener) {
		this.listeners.add(fn)
	}

	unregisterListener(fn: SnapshotListener) {
		this.listeners.delete(fn)
	}

	private notify() {
		for (const fn of this.listeners) {
			try {
				fn()
			} catch {}
		}
	}

	private getLane(key: string): Lane {
		let lane = this.lanes.get(key)
		if (!lane) {
			lane = { queue: [], running: new Set() }
			this.lanes.set(key, lane)
		}
		return lane
	}

	/**
	 * @param presetId - Optional pre-generated id. Pass this when the caller
	 * needs to persist the id (e.g. to a DB row, for cancellation) before the
	 * run can possibly start — generate it, persist it, then enqueue with it,
	 * so the id is always resolvable the moment the run exists.
	 */
	enqueue<T>(
		item: LLMQueueItemInput<T>,
		presetId?: string
	): { id: string; done: Promise<T> } {
		const laneKey = getConcurrencyKey(item)

		// Re-entrant call: the caller is already executing inside a running
		// item of this exact LLM lane. The chain legitimately holds it, so
		// queuing here would deadlock — run it immediately instead. A nested
		// enqueue onto an LLM lane the chain does not hold queues normally.
		const heldLanes: ReadonlySet<string> = activeLanes.getStore() ?? new Set<string>()
		if (heldLanes.has(laneKey)) {
			return this.runInline(item, laneKey, presetId)
		}

		const lane = this.getLane(laneKey)
		if (item.lane) lane.host = item.lane
		if (lane.queue.length >= MAX_QUEUE_DEPTH) {
			throw new Error(
				"Too many LLM requests are queued right now. Please try again shortly."
			)
		}

		const id = presetId ?? uuidv4()

		let resolve!: (value: T) => void
		let reject!: (reason: unknown) => void
		const done = new Promise<T>((res, rej) => {
			resolve = res
			reject = rej
		})

		const run: Run<T> = {
			id,
			item,
			status: "queued",
			startedAt: new Date().toISOString(),
			controller: new AbortController(),
			resolve,
			reject,
			settled: false,
			forceDetachTimer: null,
			heldLanes
		}

		this.runsById.set(id, run)
		// 🚧 By priority (A13, R26), first-in-first-out within one: after
		// every queued call of the same or a higher priority.
		if (item.priority === undefined) item.priority = currentLlmPriority()
		const at = lane.queue.findIndex((r) => (r.item.priority ?? LLM_PRIORITY.event) > item.priority!)
		if (at === -1) lane.queue.push(run)
		else lane.queue.splice(at, 0, run)
		item.onStatusChange?.("queued")
		this.notify()

		this.pump(laneKey)

		return { id, done }
	}

	/**
	 * Runs an item immediately, bypassing the lane's queue/running slot
	 * entirely — used only for the re-entrant case above. Deliberately
	 * doesn't touch `lane.queue`/`lane.running`: the LLM lane is already held
	 * by the outer run for the whole duration of this call (runIt() itself
	 * never touches `lane.running` — only pump()'s wrapping .finally() does,
	 * and that's bypassed here), so a genuinely queued third item on the
	 * same LLM lane still correctly waits for the outer run to finish rather
	 * than starting concurrently with it.
	 */
	private runInline<T>(
		item: LLMQueueItemInput<T>,
		laneKey: string,
		presetId?: string
	): { id: string; done: Promise<T> } {
		const id = presetId ?? uuidv4()

		let resolve!: (value: T) => void
		let reject!: (reason: unknown) => void
		const done = new Promise<T>((res, rej) => {
			resolve = res
			reject = rej
		})

		const run: Run<T> = {
			id,
			item,
			status: "queued",
			startedAt: new Date().toISOString(),
			controller: new AbortController(),
			resolve,
			reject,
			settled: false,
			forceDetachTimer: null,
			heldLanes: activeLanes.getStore() ?? new Set<string>()
		}

		this.runsById.set(id, run)
		item.onStatusChange?.("queued")
		this.notify()

		void this.runIt(laneKey, run)

		return { id, done }
	}

	private setStatus(run: Run<any>, status: LLMQueueStatus) {
		run.status = status
		run.item.onStatusChange?.(status)
		this.notify()
	}

	/** Removing a run from the queue always changes what clients should see
	 * (the "ghost" entry class of bug: a terminal-status notify() fires,
	 * then the run is deleted with no follow-up notify(), leaving clients
	 * showing a stale entry until some unrelated later event happens to
	 * re-notify) — routing every deletion through here makes
	 * deletion-implies-notify structural instead of something each call
	 * site has to remember. */
	private removeRun(id: string) {
		this.runsById.delete(id)
		this.notify()
	}

	private pump(laneKey: string) {
		const lane = this.getLane(laneKey)
		while (lane.running.size < llmLaneWidthOf(lane.host, laneKey)) {
			const run = lane.queue.shift()
			if (!run) return
			lane.running.add(run)
			// The run's own chain: what its enqueuer held plus this LLM lane —
			// never the async context pump happens to be called from.
			const held = new Set([...run.heldLanes, laneKey])
			activeLanes.run(held, () => {
				this.runIt(laneKey, run).finally(() => {
					lane.running.delete(run)
					this.pump(laneKey)
				})
			})
		}
	}

	/** Re-reads every LLM lane's width and starts waiting items a raised width now allows. */
	widthsChanged(): void {
		for (const laneKey of [...this.lanes.keys()]) this.pump(laneKey)
	}

	private async runIt(laneKey: string, run: Run<any>) {
		const { item, controller } = run
		try {
			if (item.preflight) {
				this.setStatus(run, "loading")
				await item.preflight(controller.signal)
			}
			// The run may have been force-detached while preflight() was still
			// in flight — the queue has already moved on to a later run for the
			// same lane/message. Don't let this zombie proceed to execute() or
			// emit further status changes that could clobber the current run's.
			if (run.settled) return
			this.setStatus(run, "generating")
			const result = await item.execute(controller.signal)
			this.settle(run, "done", () => run.resolve(result))
		} catch (err: any) {
			if (controller.signal.aborted) {
				this.settle(run, "cancelled", () =>
					run.reject(new CancelledError())
				)
			} else {
				this.settle(run, "error", () => run.reject(err))
			}
		} finally {
			this.removeRun(run.id)
		}
	}

	private settle(run: Run<any>, status: LLMQueueStatus, apply: () => void) {
		if (run.settled) return
		run.settled = true
		if (run.forceDetachTimer) {
			clearTimeout(run.forceDetachTimer)
			run.forceDetachTimer = null
		}
		this.setStatus(run, status)
		apply()
	}

	/** Always eventually frees the queue slot, regardless of whether the
	 * underlying execute()/preflight() promise ever settles. */
	cancel(id: string): void {
		const run = this.runsById.get(id)
		if (!run) return // already settled/removed — nothing to do

		if (run.status === "queued") {
			const laneKey = getConcurrencyKey(run.item)
			const lane = this.getLane(laneKey)
			const idx = lane.queue.indexOf(run)
			if (idx !== -1) lane.queue.splice(idx, 1)
			this.settle(run, "cancelled", () =>
				run.reject(new CancelledError())
			)
			this.removeRun(run.id)
			return
		}

		// Currently loading/generating: request cooperative cancellation, but
		// don't trust it — force the lane to advance if it doesn't respond in time.
		run.controller.abort()
		try {
			run.item.onCancel?.()
		} catch {}

		if (!run.forceDetachTimer) {
			run.forceDetachTimer = setTimeout(() => {
				if (run.settled) return
				console.warn(
					`[llmQueue] run ${run.id} (${run.item.taskType}) did not respond to cancellation within ${FORCE_DETACH_MS}ms — forcing queue to proceed`
				)
				const laneKey = getConcurrencyKey(run.item)
				const lane = this.getLane(laneKey)
				this.settle(run, "cancelled", () =>
					run.reject(new ForceDetachedError())
				)
				this.removeRun(run.id)
				if (lane.running.delete(run)) this.pump(laneKey)
			}, FORCE_DETACH_MS)
		}
	}

	snapshot(): LLMQueueSnapshotItem[] {
		const out: LLMQueueSnapshotItem[] = []
		for (const run of this.runsById.values()) {
			out.push({
				id: run.id,
				taskType: run.item.taskType,
				connectionName: run.item.connectionName,
				laneKey: getConcurrencyKey(run.item),
				samplingName: run.item.samplingName,
				status: run.status,
				startedAt: run.startedAt,
				sessionId: run.item.sessionId,
				messageId: run.item.messageId,
				lorebookId: run.item.lorebookId,
				label: run.item.label,
				userId: run.item.userId,
				...(run.item.priority !== undefined ? { priority: run.item.priority } : {})
			})
		}
		return out
	}

	get size() {
		return this.runsById.size
	}
}

export const llmQueue = new LLMQueue()
