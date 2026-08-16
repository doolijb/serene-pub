import type { TaskType } from "./resolveTaskConfig"
import { llmQueue, type LLMQueueStatus } from "./llmQueue"

export interface QueuedTask {
	id: string
	taskType: TaskType
	connectionName: string
	samplingName: string
	status: LLMQueueStatus
	startedAt: string
	/** Optional context references for display */
	chatId?: number
	lorebookId?: number
	label?: string
}

type AdminEmitter = (event: string, data: unknown) => void

/**
 * Display projection for the admin Activity panel over `llmQueue`, the real
 * execution queue and source of truth.
 */
class TaskQueue {
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

	snapshot(): QueuedTask[] {
		return llmQueue.snapshot().map((item) => ({
			id: item.id,
			taskType: item.taskType,
			connectionName: item.connectionName,
			samplingName: item.samplingName,
			status: item.status,
			startedAt: item.startedAt,
			chatId: item.chatId,
			lorebookId: item.lorebookId,
			label: item.label
		}))
	}

	get size() {
		return llmQueue.size
	}
}

export const taskQueue = new TaskQueue()
