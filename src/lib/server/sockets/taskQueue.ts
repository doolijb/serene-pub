import { taskQueue } from "$lib/server/utils/taskQueue"
import type { Handler } from "$lib/shared/events"
import { isGatedEvent } from "$lib/shared/sockets/interest"
import { socketWants } from "./interest"

/**
 * Registers task queue handlers for admin sockets.
 * On connect: registers this socket as a broadcast target and sends current snapshot.
 * On disconnect: unregisters the emitter.
 */
export function registerTaskQueueHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	// Matches the shared `register` helper in index.ts (unused here — this
	// handler wires up plain socket.on listeners directly — but the type
	// must match what index.ts actually passes in).
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	if (!socket.user?.isAdmin) return

	/**
	 * The interest gate, applied at the one exit that does not go through
	 * `emitToUser`.
	 *
	 * Every send in this file is a RAW `socket.emit` — the queue's broadcast
	 * reaches a person through a stored per-socket emitter rather than through
	 * whichever handler happens to be running — so `sockets/index.ts` never
	 * sees them and cannot gate them. The emitter holds its own socket, which
	 * is exactly what the gate needs: per-socket delivery (plan ruling 5) is
	 * the default here rather than something to arrange.
	 *
	 * It narrows who RECEIVES, never who MAY: the admin check above is still
	 * the boundary, and an ungated event keeps the behaviour it has today, so
	 * nothing changes until `taskQueue:update` is in `GATED_EVENTS`.
	 *
	 * ⚠ Once it is, the connect-time snapshot below lands before the client
	 * has synced anything and is therefore dropped — the panel's own
	 * `taskQueue:get`, sent after its interest, is what fills it. That is the
	 * point of the gate: an admin session with no queue panel open is not sent
	 * a snapshot it never asked for.
	 */
	const send = (event: string, data: unknown) => {
		if (isGatedEvent(event) && !socketWants(socket, event)) return
		socket.emit(event, data)
	}

	// Register this socket's emitter so taskQueue.broadcast() reaches it
	taskQueue.registerEmitter(send)

	// Send current snapshot immediately on connect
	send("taskQueue:update", { tasks: taskQueue.snapshot() })

	// Allow admin to manually re-fetch the snapshot
	socket.on("taskQueue:get", () => {
		send("taskQueue:update", { tasks: taskQueue.snapshot() })
	})

	socket.on("disconnect", () => {
		taskQueue.unregisterEmitter(send)
	})
}
