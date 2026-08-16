import { activityStore } from "$lib/server/utils/activityStore"

export function registerActivityHandlers(socket: any) {
	const userId: number = socket.user!.id
	const isAdmin: boolean = !!socket.user?.isAdmin

	const emitter = (event: string, data: unknown) => socket.emit(event, data)
	activityStore.registerEmitter(emitter, userId, isAdmin)

	socket.on("activity:get", () => {
		socket.emit("activity:update", {
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
		activityStore.unregisterEmitter(emitter)
	})
}
