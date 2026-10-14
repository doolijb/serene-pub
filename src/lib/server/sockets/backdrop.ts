/**
 * 🚧 `sessions:setBackdrop` (DESIGN-image-generation §6.4) — the door the
 * Backdrop widget's Change and Clear ask through, by way of its page
 * (`sessionPage/requests/setBackdrop.ts`). The rules are
 * `sessions/backdrop.ts`'s: the session's owner or an admin sets or clears
 * it, and the picture must be one the session may show.
 *
 * Every answer — reply and refusal — carries the ask's `request` token back:
 * the reply reaches every tab of the person, and only the token tells an ask
 * its own answer. A write that moved the pointer raises
 * `core:event/backdrop-set@1` under the person's `settings` cause (which
 * never fires a turn) and is pushed to every member as
 * `sessions:backdropChanged`.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { sessionEvents } from "@serene-pub/sdk"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	BackdropRefusal,
	announceBackdrop,
	backdropFileFor,
	writeBackdrop
} from "$lib/server/sessions/backdrop"

const tokenOf = (params: { request?: unknown }) =>
	typeof params?.request === "string" ? { request: params.request } : {}

export const sessionsSetBackdrop: Handler<
	Sockets.Sessions.SetBackdrop.Params,
	Sockets.Sessions.SetBackdrop.Response
> = {
	event: "sessions:setBackdrop",
	handler: async (socket, params, emitToUser) => {
		const token = tokenOf(params)
		const sessionId = params?.sessionId
		const refuse = (error: string) => {
			const res = { sessionId, ...token, error }
			emitToUser("sessions:setBackdrop:error", res)
			return res
		}
		try {
			const userId = socket.user!.id
			if (typeof sessionId !== "number" || !Number.isInteger(sessionId))
				return refuse("Which session's backdrop? None was named.")
			const access = await checkSessionAccess(sessionId, userId)
			if (!access.hasAccess && !socket.user!.isAdmin)
				return refuse("Session not found.")
			if (!access.isOwner && !socket.user!.isAdmin)
				return refuse("Only the session's owner can change its backdrop.")

			let mediaId: number | null = null
			if (params.mediaRef !== null) {
				if (typeof params.mediaRef !== "string")
					return refuse("Name the picture by its id, or nothing to clear the backdrop.")
				const file = await backdropFileFor(db, params.mediaRef, {
					sessionId,
					userId,
					castImages: true
				})
				if (!file) return refuse("That picture is not an image this session can show.")
				mediaId = file.id
			}

			const write = await writeBackdrop(db, sessionId, mediaId)
			if (write.changed) {
				try {
					const { emitSessionEvent } = await import(
						"$lib/server/pipelines/runtime/sessionEvents"
					)
					await emitSessionEvent(db, {
						sessionId,
						userId,
						event: sessionEvents.backdropSet,
						payload: {
							sessionId,
							backdropMediaId: write.next,
							previousBackdropMediaId: write.previous,
							cause: { kind: "settings", userId }
						},
						io: socket.io
					})
				} catch (err) {
					console.warn("[backdrop] backdrop-set emit failed:", err)
				}
				await announceBackdrop(socket.io, sessionId, write.next)
			}
			const res = { sessionId, ...token, backdropMediaId: write.next }
			emitToUser("sessions:setBackdrop", res)
			return res
		} catch (error: unknown) {
			if (!(error instanceof BackdropRefusal))
				console.warn("[backdrop] write failed:", error)
			return refuse(
				error instanceof BackdropRefusal
					? error.message
					: "The backdrop could not be changed."
			)
		}
	}
}

export function registerBackdropHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsSetBackdrop, emitToUser)
}
