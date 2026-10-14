/**
 * 🚧 `sessions:stepSettings` / `sessions:setStepSetting` (PROPOSAL-live-scenes
 * §15 G11): the story settings of the steps a session's pipelines put in
 * session settings — Chat's reply tick, the sprite picker — read and set at
 * session scope by the session's owner. What is a step setting, and what is
 * never one (a model's plumbing), is `server/sessions/stepSettings.ts`'s.
 *
 * Replies on the same event, a refusal as its `error` (never an `:error`
 * event, so no toast: the form says it where it was asked).
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"

type Read = Sockets.Sessions.Bindings.StepSettings.Response
type Write = Sockets.Sessions.Bindings.SetStepSetting.Response

/** The session's step settings: the owner's; anyone else is told none. */
export const sessionsStepSettingsHandler: Handler<
	Sockets.Sessions.Bindings.StepSettings.Params,
	Read
> = {
	event: "sessions:stepSettings",
	handler: async (socket, params, emitToUser) => {
		const sessionId = Number(params?.sessionId)
		const res: Read = { sessionId, steps: [] }
		try {
			const access = await checkSessionAccess(sessionId, socket.user!.id)
			if (access.hasAccess && access.isOwner) {
				const { readStepSettings } = await import("$lib/server/sessions/stepSettings")
				res.steps = await readStepSettings(db, sessionId, socket.user!.id)
			}
		} catch (error) {
			console.warn("[stepSettings] read failed:", error)
		}
		emitToUser("sessions:stepSettings", res)
		return res
	}
}

/** Set one step setting (null clears it back to what it inherits). Owner only. */
export const sessionsSetStepSettingHandler: Handler<
	Sockets.Sessions.Bindings.SetStepSetting.Params,
	Write
> = {
	event: "sessions:setStepSetting",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const base: Write = {
			sessionId,
			...(typeof params?.requestId === "string" ? { requestId: params.requestId } : {}),
			spec: String(params?.spec ?? ""),
			nodeKey: String(params?.nodeKey ?? ""),
			path: String(params?.path ?? "")
		}
		const reply = (res: Write) => {
			emitToUser("sessions:setStepSetting", res)
			return res
		}
		try {
			const access = await checkSessionAccess(sessionId, userId)
			if (!access.hasAccess || !access.isOwner)
				return reply({ ...base, error: "Only the session's owner changes its settings." })
			const { readStepSettings, writeStepSetting, StepSettingRefusal } = await import(
				"$lib/server/sessions/stepSettings"
			)
			try {
				await writeStepSetting(db, {
					sessionId,
					userId,
					spec: base.spec,
					nodeKey: base.nodeKey,
					path: base.path,
					value: params?.value === undefined ? null : params.value
				})
			} catch (error) {
				if (error instanceof StepSettingRefusal)
					return reply({ ...base, error: error.message })
				throw error
			}
			const steps = await readStepSettings(db, sessionId, userId)
			emitToUser("sessions:stepSettings", { sessionId, steps } satisfies Read)
			return reply({ ...base, steps })
		} catch (error) {
			console.warn("[stepSettings] write failed:", error)
			return reply({ ...base, error: "The setting could not be saved." })
		}
	}
}

export function registerStepSettingsHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsStepSettingsHandler, emitToUser)
	register(socket, sessionsSetStepSettingHandler, emitToUser)
}
