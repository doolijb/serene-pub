/**
 * 🚧 **Clone with changes and attach** (pr-6, B §B-4, R-p): the session's attached book copied whole, the
 * session moved onto the copy, its own book's changes written into it. Owner of the session only.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { cloneWithChanges } from "$lib/server/lorebooks/ownBook"
import { SHARE_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"

export const sessionsCloneWithChangesHandler: Handler<
	Sockets.Sessions.CloneWithChanges.Params,
	Sockets.Sessions.CloneWithChanges.Response
> = refusable(
	"sessions:cloneWithChanges",
	async (socket, params: Sockets.Sessions.CloneWithChanges.Params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = params.sessionId
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.isOwner) throw new Error(SHARE_REFUSALS.notOwner)
		const made = await cloneWithChanges(db, {
			sessionId,
			userId,
			name: typeof params.name === "string" ? params.name : null
		})
		const res: Sockets.Sessions.CloneWithChanges.Response = {
			sessionId,
			lorebookId: made.lorebookId,
			name: made.name
		}
		emitToUser("sessions:cloneWithChanges", res)
		// The one toast, through the central `success` path (Layout).
		emitToUser("success", {
			title: `Cloned with this session's notes: ${made.name}`
		} satisfies Sockets.Success.Response)
		const { relistLorebooks, relistSessionNotes } = await import("./lorebooks")
		relistLorebooks(socket, emitToUser)
		relistSessionNotes(socket, emitToUser)
		const { pushSessionToParticipants } = await import("./sessions")
		await pushSessionToParticipants(socket.io, sessionId, userId)
		broadcastSessionRow(socket.io, sessionId)
		return res
	},
	"The lorebook could not be cloned with this session's notes.",
	undefined,
	(p) => ({ sessionId: (p as any)?.sessionId })
)

export function registerOwnBookHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
): void {
	register(socket, sessionsCloneWithChangesHandler, emitToUser)
}
