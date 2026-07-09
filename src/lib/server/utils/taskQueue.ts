import { v4 as uuidv4 } from "uuid"
import type { TaskType } from "./resolveTaskConfig"
import { llmQueue } from "./llmQueue"

export interface QueuedTask {
	id: string
	taskType: TaskType
	connectionName: string
	samplingName: string
	startedAt: string
	/** Optional context references for display */
	chatId?: number
	lorebookId?: number
	label?: string
}

type AdminEmitter = (event: string, data: unknown) => void

/**
 * Display projection for the admin Activity panel. `llmQueue` is the real
 * execution queue and source of truth for anything that's been migrated to
 * go through it; `start()`/`finish()` remain here as a legacy registration
 * path for call sites not yet migrated onto `llmQueue.enqueue()`. Once every
 * consumer is migrated, the legacy Map will always be empty and this becomes
 * a pure read-through projection.
 */
class TaskQueue {
	private legacyTasks = new Map<string, QueuedTask>()
	private emitters = new Set<AdminEmitter>()

	constructor() {
		llmQueue.registerListener(() => this.broadcast())
	}

	registerEmitter(fn: AdminEmitter) {
		this.emitters.add(fn)
	}

	unregisterEmitter(fn: AdminEmitter) {
		this.emitters.delete(fn)
	}

	private broadcast() {
		const payload = { tasks: this.snapshot() }
		for (const emit of this.emitters) {
			try {
				emit("taskQueue:update", payload)
			} catch {}
		}
	}

	/** @deprecated use llmQueue.enqueue() instead — kept for not-yet-migrated call sites. */
	start(params: Omit<QueuedTask, "id" | "startedAt">): string {
		const id = uuidv4()
		this.legacyTasks.set(id, { ...params, id, startedAt: new Date().toISOString() })
		this.broadcast()
		return id
	}

	/** @deprecated pairs with start() above. */
	finish(id: string) {
		this.legacyTasks.delete(id)
		this.broadcast()
	}

	snapshot(): QueuedTask[] {
		const fromQueue: QueuedTask[] = llmQueue.snapshot().map((item) => ({
			id: item.id,
			taskType: item.taskType,
			connectionName: item.connectionName,
			samplingName: item.samplingName,
			startedAt: item.startedAt,
			chatId: item.chatId,
			lorebookId: item.lorebookId,
			label: item.label
		}))
		return [...fromQueue, ...this.legacyTasks.values()]
	}

	get size() {
		return llmQueue.size + this.legacyTasks.size
	}
}

export const taskQueue = new TaskQueue()
