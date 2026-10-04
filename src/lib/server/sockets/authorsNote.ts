/**
 * 🚧 `sessions:authorsNote` and `sessions:setAuthorsNote` (2026-10-02, AN1)
 * — the two doors core's Author's note widget asks through, by way of its
 * page (`sessionPage/requests/authorsNote.ts`). The rules are
 * `sessions/authorsNote.ts`'s: anyone in the session reads; its owner writes.
 *
 * Both answer with the note as it reads now, and every answer — reply and
 * refusal — carries the ask's `request` token back: the reply reaches every
 * tab of the person, and only the token tells an ask its own answer.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { sessionEvents } from "@serene-pub/sdk"
import {
	AuthorsNoteRefusal,
	readSessionAuthorsNote,
	writeSessionAuthorsNote
} from "$lib/server/sessions/authorsNote"

const tokenOf = (params: { request?: unknown }) =>
	typeof params?.request === "string" ? { request: params.request } : {}

export const sessionsAuthorsNote: Handler<
	Sockets.Sessions.AuthorsNote.Params,
	Sockets.Sessions.AuthorsNote.Response
> = {
	event: "sessions:authorsNote",
	handler: async (socket, params, emitToUser) => {
		const token = tokenOf(params)
		try {
			const note = await readSessionAuthorsNote(
				db,
				params.sessionId,
				socket.user!.id
			)
			const res = { sessionId: params.sessionId, ...token, note }
			emitToUser("sessions:authorsNote", res)
			return res
		} catch (error: any) {
			const res = {
				sessionId: params?.sessionId,
				...token,
				error:
					error instanceof AuthorsNoteRefusal
						? error.message
						: "The author's note could not be read."
			}
			if (!(error instanceof AuthorsNoteRefusal))
				console.warn("[authorsNote] read failed:", error)
			emitToUser("sessions:authorsNote:error", res)
			return res
		}
	}
}

export const sessionsSetAuthorsNote: Handler<
	Sockets.Sessions.SetAuthorsNote.Params,
	Sockets.Sessions.SetAuthorsNote.Response
> = {
	event: "sessions:setAuthorsNote",
	handler: async (socket, params, emitToUser) => {
		const token = tokenOf(params)
		const userId = socket.user!.id
		try {
			const { answer, changed, genreFields } = await writeSessionAuthorsNote(
				db,
				params.sessionId,
				userId,
				params.note
			)
			// The same event a settings save raises when `genreFields` moved
			// (§4.1), under the person's `settings` cause — which never fires a
			// turn. Best-effort: the note is saved either way.
			if (changed)
				try {
					const { emitSessionEvent } = await import(
						"$lib/server/pipelines/runtime/sessionEvents"
					)
					await emitSessionEvent(db, {
						sessionId: params.sessionId,
						userId,
						event: sessionEvents.sessionUpdated,
						payload: {
							sessionId: params.sessionId,
							changed: ["genreFields"],
							cause: { kind: "settings", userId }
						},
						io: socket.io
					})
				} catch (err) {
					console.warn("[authorsNote] session-updated emit failed:", err)
				}
			// An open Edit Session form follows the note it was not editing
			// (2026-10-03), rather than saving back the one it loaded.
			if (changed)
				emitToUser("sessions:genreFieldsChanged", {
					sessionId: params.sessionId,
					genreFields
				} satisfies Sockets.Sessions.GenreFieldsChanged.Response)
			const res = { sessionId: params.sessionId, ...token, note: answer }
			emitToUser("sessions:setAuthorsNote", res)
			return res
		} catch (error: any) {
			const res = {
				sessionId: params?.sessionId,
				...token,
				error:
					error instanceof AuthorsNoteRefusal
						? error.message
						: "The author's note could not be saved."
			}
			if (!(error instanceof AuthorsNoteRefusal))
				console.warn("[authorsNote] write failed:", error)
			emitToUser("sessions:setAuthorsNote:error", res)
			return res
		}
	}
}

export function registerAuthorsNoteHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsAuthorsNote, emitToUser)
	register(socket, sessionsSetAuthorsNote, emitToUser)
}
