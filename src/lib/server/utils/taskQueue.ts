import { v4 as uuidv4 } from "uuid"
import type { TaskType } from "./resolveTaskConfig"

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

class TaskQueue {
	private tasks = new Map<string, QueuedTask>()
	private emitters = new Set<AdminEmitter>()

	registerEmitter(fn: AdminEmitter) {
		this.emitters.add(fn)
	}

	unregisterEmitter(fn: AdminEmitter) {
		this.emitters.delete(fn)
	}

	private broadcast() {
		const payload = { tasks: this.snapshot() }
		for (const emit of this.emitters) {
			try { emit("taskQueue:update", payload) } catch {}
		}
	}

	start(params: Omit<QueuedTask, "id" | "startedAt">): string {
		const id = uuidv4()
		this.tasks.set(id, { ...params, id, startedAt: new Date().toISOString() })
		this.broadcast()
		return id
	}

	finish(id: string) {
		this.tasks.delete(id)
		this.broadcast()
	}

	snapshot(): QueuedTask[] {
		return [...this.tasks.values()]
	}

	get size() {
		return this.tasks.size
	}
}

export const taskQueue = new TaskQueue()
