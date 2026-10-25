/**
 * 🚧 The admin preset editor over the socket (PLAN-layering §4, P4, R2, R4,
 * A5; lane 7, 2026-10-21) — what `server/sessions/presetEditor.ts` answers:
 *
 *  · `sessionPresets:editor` — one preset's view: the genre's defaults, its
 *    changes, what a session on it runs, the genre's settings, the catalogue
 *    of triggers.
 *  · `sessionPresets:candidates` — the pipelines a trigger may run, each
 *    with whether it fits and why not (R4).
 *  · `sessions:conditionProps` — the derived properties a `when` may test
 *    (A5), for a genre.
 *  · `pipelines:registeredIn` — where a pipeline runs: the genres whose
 *    defaults register it, the presets that add, drop or change it.
 *
 * Administrators only; anyone else is answered with the refusal on the
 * reply (no `:error` event, so no toast: the editor says it where it asked).
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"

const ADMINS_ONLY = "Only an administrator edits presets."

export const sessionPresetsEditorHandler: Handler<
	Sockets.SessionAdmin.PresetEditor.Params,
	Sockets.SessionAdmin.PresetEditor.Response
> = {
	event: "sessionPresets:editor",
	handler: async (socket, params, emitToUser) => {
		const presetId = Number(params?.presetId)
		let res: Sockets.SessionAdmin.PresetEditor.Response
		if (!socket.user?.isAdmin) res = { presetId, error: ADMINS_ONLY }
		else
			try {
				const { presetEditorView } = await import("$lib/server/sessions/presetEditor")
				res = (await presetEditorView(db as unknown as Db, presetId)) ?? { presetId, error: "There is no such preset." }
			} catch (err) {
				console.warn("[presetEditor] the preset could not be read:", err)
				res = { presetId, error: "The preset could not be read." }
			}
		emitToUser("sessionPresets:editor", res)
		return res
	}
}

export const sessionPresetsCandidatesHandler: Handler<
	Sockets.SessionAdmin.RegistrationCandidates.Params,
	Sockets.SessionAdmin.RegistrationCandidates.Response
> = {
	event: "sessionPresets:candidates",
	handler: async (socket, params, emitToUser) => {
		const base = typeof params?.requestId === "string" ? { requestId: params.requestId } : {}
		let res: Sockets.SessionAdmin.RegistrationCandidates.Response
		const t = params?.trigger as { family?: unknown; event?: unknown; action?: unknown; cadence?: { id?: unknown } } | undefined
		const valid =
			!!t &&
			((t.family === "event" && typeof t.event === "string") ||
				(t.family === "action" && typeof t.action === "string") ||
				(t.family === "routine" && typeof t.cadence?.id === "string"))
		if (!socket.user?.isAdmin) res = { ...base, candidates: [], error: ADMINS_ONLY }
		else if (!valid) res = { ...base, candidates: [], error: "Pick what it runs on first: an event, an action or when a routine runs." }
		else
			try {
				const { registrationCandidates } = await import("$lib/server/sessions/presetEditor")
				res = { ...base, candidates: await registrationCandidates(db as unknown as Db, t as never) }
			} catch (err) {
				console.warn("[presetEditor] candidates could not be read:", err)
				res = { ...base, candidates: [], error: "The pipelines could not be read." }
			}
		emitToUser("sessionPresets:candidates", res)
		return res
	}
}

export const sessionsConditionPropsHandler: Handler<
	Sockets.Sessions.ConditionProps.Params,
	Sockets.Sessions.ConditionProps.Response
> = {
	event: "sessions:conditionProps",
	handler: async (socket, params, emitToUser) => {
		const genreId = String(params?.genreId ?? "")
		let res: Sockets.Sessions.ConditionProps.Response
		if (!socket.user?.isAdmin) res = { genreId, props: [], error: ADMINS_ONLY }
		else
			try {
				const { conditionPropsFor } = await import("$lib/server/sessions/presetEditor")
				res = { genreId, props: await conditionPropsFor(genreId) }
			} catch (err) {
				console.warn("[presetEditor] condition properties could not be derived:", err)
				res = { genreId, props: [], error: "What this genre's conditions may test could not be read." }
			}
		emitToUser("sessions:conditionProps", res)
		return res
	}
}

export const pipelinesRegisteredInHandler: Handler<
	Sockets.Pipelines.RegisteredIn.Params,
	Sockets.Pipelines.RegisteredIn.Response
> = {
	event: "pipelines:registeredIn",
	handler: async (socket, params, emitToUser) => {
		const slug = String(params?.slug ?? "")
		let res: Sockets.Pipelines.RegisteredIn.Response
		if (!socket.user?.isAdmin) res = { slug, places: [], error: "Only an administrator reads where a pipeline runs." }
		else
			try {
				const { registeredInOf } = await import("$lib/server/sessions/presetEditor")
				res = { slug, places: await registeredInOf(db as unknown as Db, slug) }
			} catch (err) {
				console.warn("[presetEditor] where a pipeline runs could not be read:", err)
				res = { slug, places: [], error: "Where this pipeline runs could not be read." }
			}
		emitToUser("pipelines:registeredIn", res)
		return res
	}
}

export function registerPresetEditorHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, sessionPresetsEditorHandler, emitToUser)
	register(socket, sessionPresetsCandidatesHandler, emitToUser)
	register(socket, sessionsConditionPropsHandler, emitToUser)
	register(socket, pipelinesRegisteredInHandler, emitToUser)
}
