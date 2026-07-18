import { v4 as uuidv4 } from "uuid"
import type { TaskType } from "./resolveTaskConfig"

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
	samplingName: string
	chatId?: number
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
}

export interface LLMQueueSnapshotItem {
	id: string
	taskType: TaskType
	connectionName: string
	samplingName: string
	status: LLMQueueStatus
	startedAt: string
	chatId?: number
	messageId?: number
	lorebookId?: number
	label?: string
	userId?: number
}

export class CancelledError extends Error {
	constructor(message = "Cancelled") {
		super(message)
		this.name = "CancelledError"
	}
}

export class ForceDetachedError extends Error {
	constructor(message = "Cancelled request did not stop in time; queue forced ahead") {
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
}

interface Lane {
	queue: Run<any>[]
	running: Run<any> | null
}

const FORCE_DETACH_MS = 10_000

// The queue has a single global lane (see getConcurrencyKey below) — only one
// LLM call executes at a time across the whole application, regardless of
// who queued it. There is deliberately no per-user depth cap on top of that;
// `userId` on a queued item is used only for display (see snapshot()) and
// isn't a throttle.

// Concurrency grouping. Hardcoded to a single global lane today; swap this out
// for a per-connection/per-connection-type key once that's needed — nothing
// else in this module or its callers needs to change.
function getConcurrencyKey(_item: LLMQueueItemInput<any>): string {
	return "global"
}

type SnapshotListener = () => void

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
			lane = { queue: [], running: null }
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
	enqueue<T>(item: LLMQueueItemInput<T>, presetId?: string): { id: string; done: Promise<T> } {
		const id = presetId ?? uuidv4()
		const laneKey = getConcurrencyKey(item)

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
			forceDetachTimer: null
		}

		this.runsById.set(id, run)
		this.getLane(laneKey).queue.push(run)
		item.onStatusChange?.("queued")
		this.notify()

		this.pump(laneKey)

		return { id, done }
	}

	private setStatus(run: Run<any>, status: LLMQueueStatus) {
		run.status = status
		run.item.onStatusChange?.(status)
		this.notify()
	}

	private async pump(laneKey: string) {
		const lane = this.getLane(laneKey)
		if (lane.running) return
		const run = lane.queue.shift()
		if (!run) return

		lane.running = run
		this.runIt(laneKey, run).finally(() => {
			if (lane.running === run) lane.running = null
			this.pump(laneKey)
		})
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
				this.settle(run, "cancelled", () => run.reject(new CancelledError()))
			} else {
				this.settle(run, "error", () => run.reject(err))
			}
		} finally {
			this.runsById.delete(run.id)
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
			this.settle(run, "cancelled", () => run.reject(new CancelledError()))
			this.runsById.delete(run.id)
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
				this.settle(run, "cancelled", () => run.reject(new ForceDetachedError()))
				this.runsById.delete(run.id)
				if (lane.running === run) {
					lane.running = null
					this.pump(laneKey)
				}
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
				samplingName: run.item.samplingName,
				status: run.status,
				startedAt: run.startedAt,
				chatId: run.item.chatId,
				messageId: run.item.messageId,
				lorebookId: run.item.lorebookId,
				label: run.item.label,
				userId: run.item.userId
			})
		}
		return out
	}

	get size() {
		return this.runsById.size
	}
}

export const llmQueue = new LLMQueue()
