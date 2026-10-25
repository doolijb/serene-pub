/**
 * 🚧 `sessions:settingsForm` / `sessions:updateSetting` (PLAN-layering A9,
 * A10, R1, R32, R36, R37; lane 5b, 2026-10-20): the session's settings form,
 * derived from its genre and registrations, and the one write through it.
 * What the form holds and who may change what is
 * `server/sessions/settingsForm.ts`'s; this file only asks and answers.
 *
 * Replies on the same event, a refusal as its `error` (never an `:error`
 * event, so no toast: the form says it where it was asked). A genre field's
 * change is the owner's setting change — a `session-updated` naming
 * `genreFields` under the person's `settings` cause, an interaction (R21) —
 * and the session's participants are told the session changed.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { sessionEvents } from "@serene-pub/sdk"

type FormResponse = Sockets.Sessions.SettingsForm.Response
type UpdateResponse = Sockets.Sessions.UpdateSetting.Response

/** The session's derived settings form, for the asker. A guest is answered with no groups and why. */
export const sessionsSettingsFormHandler: Handler<Sockets.Sessions.SettingsForm.Params, FormResponse> = {
	event: "sessions:settingsForm",
	handler: async (socket, params, emitToUser) => {
		const sessionId = Number(params?.sessionId)
		let res: FormResponse = { sessionId, groups: [] }
		try {
			const { settingsForm } = await import("$lib/server/sessions/settingsForm")
			res = await settingsForm(db, sessionId, { userId: socket.user!.id, isAdmin: !!socket.user!.isAdmin })
		} catch (error) {
			console.warn("[settingsForm] read failed:", error)
			res = { sessionId, groups: [], error: "The session's settings could not be read." }
		}
		emitToUser("sessions:settingsForm", res)
		return res
	}
}

/** Change one setting through the cascade; answered with the form after. */
export const sessionsUpdateSettingHandler: Handler<Sockets.Sessions.UpdateSetting.Params, UpdateResponse> = {
	event: "sessions:updateSetting",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const viewer = { userId, isAdmin: !!socket.user!.isAdmin }
		const sessionId = Number(params?.sessionId)
		const base: UpdateResponse = {
			sessionId,
			...(typeof params?.requestId === "string" ? { requestId: params.requestId } : {}),
			address: params?.address
		}
		const reply = (res: UpdateResponse) => {
			emitToUser("sessions:updateSetting", res)
			return res
		}
		const { settingsForm, updateSetting, SettingRefusal } = await import("$lib/server/sessions/settingsForm")
		let changes: "genreFields" | "registrations" | "rigour"
		try {
			;({ changes } = await updateSetting(db, sessionId, viewer, params?.address, params?.value ?? null))
		} catch (error) {
			if (error instanceof SettingRefusal) return reply({ ...base, error: error.message })
			console.warn("[settingsForm] write failed:", error)
			return reply({ ...base, error: "The setting could not be saved." })
		}
		// 🚧 An owner's setting change is an interaction (R11, R21; lane 6).
		{
			const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
			await noteInteraction(db, sessionId, "setting")
		}
		// An owner's setting change: `session-updated`, under the person's
		// `settings` cause. Best-effort — the write has landed.
		try {
			const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
			await emitSessionEvent(db, {
				sessionId,
				userId,
				event: sessionEvents.sessionUpdated,
				payload: {
					sessionId,
					changed: [changes],
					cause: { kind: "settings", userId }
				},
				io: socket.io
			})
		} catch (err) {
			console.warn("[settingsForm] session-updated emit failed:", err)
		}
		const form = await settingsForm(db, sessionId, viewer)
		emitToUser("sessions:settingsForm", form)
		if (changes === "genreFields" || changes === "rigour")
			try {
				const { pushSessionToParticipants } = await import("$lib/server/sockets/sessions")
				await pushSessionToParticipants(socket.io, sessionId, userId)
			} catch (err) {
				console.warn("[settingsForm] participants not told:", err)
			}
		return reply({ ...base, form })
	}
}

export function registerSessionSettingsHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, sessionsSettingsFormHandler, emitToUser)
	register(socket, sessionsUpdateSettingHandler, emitToUser)
}
