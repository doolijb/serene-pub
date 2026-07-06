import { taskQueue } from "$lib/server/utils/taskQueue"

/**
 * Registers task queue handlers for admin sockets.
 * On connect: registers this socket as a broadcast target and sends current snapshot.
 * On disconnect: unregisters the emitter.
 */
export function registerTaskQueueHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (handler: any) => void
) {
	if (!socket.user?.isAdmin) return

	// Register this socket's emitter so taskQueue.broadcast() reaches it
	const emitter = (event: string, data: unknown) => socket.emit(event, data)
	taskQueue.registerEmitter(emitter)

	// Send current snapshot immediately on connect
	socket.emit("taskQueue:update", { tasks: taskQueue.snapshot() })

	// Allow admin to manually re-fetch the snapshot
	socket.on("taskQueue:get", () => {
		socket.emit("taskQueue:update", { tasks: taskQueue.snapshot() })
	})

	socket.on("disconnect", () => {
		taskQueue.unregisterEmitter(emitter)
	})
}
