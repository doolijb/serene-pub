import { activityStore } from "$lib/server/utils/activityStore"
import { redactConnections } from "$lib/server/connections/visibility"

export function registerActivityHandlers(socket: any) {
	const userId: number = socket.user!.id
	const isAdmin: boolean = !!socket.user?.isAdmin

	/**
	 * The activity stream is a FOURTH place payloads leave the server, and until
	 * now the only one that did not apply the connection projection: these are
	 * raw `socket.emit`s, so `sockets/index.ts`'s `emitToUser` wrapper never sees
	 * them, and a non-admin reads their own activities here.
	 *
	 * What it removes is `connection`, the identity bag `activityError` puts on
	 * a terminalised record — the same field, under the same key, as a stored
	 * generation error. The walk is also here for the first OTHER field that is
	 * spelled this way, so it does not have to be noticed: the same reasoning
	 * the wrapper itself carries.
	 *
	 * ⚠ It cannot cover `errorMessage`, which is free text — no key-shaped rule
	 * can see a name that is a substring. That half is held by `activityError`,
	 * which composes the sentence without one and moves anything a service said
	 * into the field above. A write that sets `errorMessage` from a caught
	 * `err.message` directly puts the base URL and the model file straight back
	 * on a non-admin's own card, so every terminalising write in `scenes.ts`,
	 * `summarize.ts` and `narrativeGraph.ts` goes through that helper instead.
	 */
	const send = (event: string, data: unknown) =>
		socket.emit(event, redactConnections(data, socket.user))

	activityStore.registerEmitter(send, userId, isAdmin)

	socket.on("activity:get", () => {
		send("activity:update", {
			activities: activityStore.getFor(userId, isAdmin)
		})
	})

	socket.on("activity:dismiss", (req: { id: string }) => {
		const activity = activityStore.getById(req?.id)
		if (!activity) return
		if (!isAdmin && activity.userId !== userId) return
		activityStore.remove(req.id)
	})

	socket.on("activity:cancel", (req: { id: string }) => {
		const activity = activityStore.getById(req?.id)
		if (!activity) return
		if (!isAdmin && activity.userId !== userId) return
		activityStore.cancel(req.id)
	})

	socket.on("disconnect", () => {
		activityStore.unregisterEmitter(send)
	})
}
