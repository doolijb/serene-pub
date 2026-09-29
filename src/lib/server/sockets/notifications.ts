/**
 * The `notifications:` family (types: `shared/sockets/notifications.ts`).
 *
 * Every user reads and writes only their own rows; the store scopes each
 * write by `socket.user.id`. Raising is never a socket verb — rows are raised
 * by the server at its decision points (`server/notifications/store.ts`).
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import type {
	NotificationsIdsParams,
	NotificationsListParams,
	NotificationsListResponse,
	NotificationsViewingParams
} from "$lib/shared/sockets/notifications"
import {
	dismissNotifications,
	listNotifications,
	markNotificationsRead
} from "$lib/server/notifications/store"
import { VIEWING_PROP, parseViewing } from "$lib/server/notifications/viewing"

const dbh = () => db as unknown as Db

export const notificationsList: Handler<
	NotificationsListParams,
	NotificationsListResponse
> = {
	event: "notifications:list",
	handler: async (socket, _params, emitToUser) => {
		const res = await listNotifications(socket.user!.id, dbh())
		emitToUser("notifications:list", res)
		return res
	}
}

export const notificationsRead: Handler<NotificationsIdsParams, void> = {
	event: "notifications:read",
	handler: async (socket, params) => {
		// The fresh list reaches every tab as `notifications:changed`.
		await markNotificationsRead(socket.user!.id, params?.ids, dbh())
	}
}

export const notificationsDismiss: Handler<NotificationsIdsParams, void> = {
	event: "notifications:dismiss",
	handler: async (socket, params) => {
		await dismissNotifications(socket.user!.id, params?.ids, dbh())
	}
}

/**
 * What this tab has on screen. Stored on the socket (so a disconnect forgets
 * it) and read at raise time by `userIsViewing`. Malformed is stored as null.
 */
export const notificationsViewing: Handler<NotificationsViewingParams, void> = {
	event: "notifications:viewing",
	handler: async (socket, params) => {
		socket[VIEWING_PROP] = parseViewing(params?.viewing)
	}
}

export function registerNotificationHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, notificationsList, emitToUser)
	register(socket, notificationsRead, emitToUser)
	register(socket, notificationsDismiss, emitToUser)
	register(socket, notificationsViewing, emitToUser)
}
