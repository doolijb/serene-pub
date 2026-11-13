/**
 * 🚧 **Merge ‹book› into these notes** (★B-2, 2026-11-08; the code says *fold*): the session's attached book
 * copied into its own notes, which the session then reads alone. Owner of the session only.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { foldInParent } from "$lib/server/lorebooks/foldInParent"
import { FOLD_DONE, FOLD_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"

export const sessionsFoldInParentHandler: Handler<
	Sockets.Sessions.FoldInParent.Params,
	Sockets.Sessions.FoldInParent.Response
> = refusable(
	"sessions:foldInParent",
	async (
		socket,
		params: Sockets.Sessions.FoldInParent.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		const sessionId = params.sessionId
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.isOwner) throw new Error(FOLD_REFUSALS.notOwner)
		const folded = await foldInParent(db, { sessionId, userId })
		// Committed: announce the re-pointed character seats (the one seat path, ★s4-seat-ev).
		const { announceSeatChanges } = await import(
			"$lib/server/sessions/seats"
		)
		await announceSeatChanges(
			db,
			socket.io,
			{ sessionId, userId },
			folded.seatChanges
		)
		const res: Sockets.Sessions.FoldInParent.Response = {
			sessionId,
			lorebookId: folded.lorebookId
		}
		emitToUser("sessions:foldInParent", res)
		// The one toast, through the central `success` path (Layout).
		emitToUser("success", {
			title: FOLD_DONE(folded.foldedFrom.name)
		} satisfies Sockets.Success.Response)
		const { relistLorebooks, relistSessionNotes } = await import(
			"./lorebooks"
		)
		relistLorebooks(socket, emitToUser)
		relistSessionNotes(socket, emitToUser)
		const { pushSessionToParticipants } = await import("./sessions")
		await pushSessionToParticipants(socket.io, sessionId, userId)
		broadcastSessionRow(socket.io, sessionId)
		return res
	},
	"The lorebook could not be merged into this session's notes.",
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
	register(socket, sessionsFoldInParentHandler, emitToUser)
}
