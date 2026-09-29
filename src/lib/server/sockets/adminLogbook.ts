/**
 * Admin → History (`admin:logbook`): the admin logbook, read.
 *
 * One read with filters and a cursor (`server/adminLogbook/read.ts`). The
 * logbook is WRITTEN by the socket wrapper, never through a socket of its
 * own — there is deliberately no event that adds, edits or deletes a record.
 *
 * Admin only; `admin:` is a restricted interest prefix as well.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { listLogbook } from "$lib/server/adminLogbook/read"

export const adminLogbook: Handler<
	Sockets.Admin.Logbook.Params,
	Sockets.Admin.Logbook.Response
> = {
	event: "admin:logbook",
	handler: async (socket, params, emitToUser) => {
		if (!socket.user!.isAdmin) throw new Error("Unauthorized")
		const res: Sockets.Admin.Logbook.Response = {
			...(await listLogbook(db as unknown as Db, params ?? {})),
			// Echoed so a reply can be matched to the filters that asked for it
			// when two requests cross.
			requestId: params?.requestId ?? null
		}
		emitToUser("admin:logbook", res)
		return res
	}
}

export function registerAdminLogbookHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, adminLogbook, emitToUser)
}
