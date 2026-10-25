/**
 * 🚧 The session's **routines** over the socket (PLAN-layering R23, R39, A7;
 * lane 6, 2026-10-20) — what lane 7 builds on:
 *
 *  · `sessions:runRoutine` — **Run now**: the owner fires an enabled routine
 *    by hand (`runRoutineNow`); answered `queued` or with a sentence.
 *  · `sessions:routines` — each routine the session has, as it stands
 *    (waiting, running, paused and why, what it needs, whether the viewer
 *    may Run it now).
 *  · `sessions:routineLog` — *While you were away*: the session's recent
 *    routine runs — what ran, wrote, skipped or paused, and why.
 *
 * Each replies on its own event, a refusal as its `error` (no `:error`
 * event, so no toast: the asker says it where it was asked).
 */
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"

export const sessionsRunRoutineHandler: Handler<
	Sockets.Sessions.RunRoutine.Params,
	Sockets.Sessions.RunRoutine.Response
> = {
	event: "sessions:runRoutine",
	handler: async (socket, params, emitToUser) => {
		const base = {
			sessionId: Number(params?.sessionId),
			registrationKey: String(params?.registrationKey ?? ""),
			...(typeof params?.requestId === "string" ? { requestId: params.requestId } : {})
		}
		const reply = (res: Sockets.Sessions.RunRoutine.Response) => {
			emitToUser("sessions:runRoutine", res)
			return res
		}
		try {
			const { runRoutineNow } = await import("$lib/server/pipelines/routines/run")
			const outcome = await runRoutineNow(db as unknown as Db, {
				sessionId: base.sessionId,
				userId: socket.user!.id,
				registrationKey: base.registrationKey,
				io: socket.io
			})
			return reply("queued" in outcome ? { ...base, queued: true } : { ...base, error: outcome.refused })
		} catch (err) {
			console.warn("[routines] Run now failed:", err)
			return reply({ ...base, error: "The routine could not be started." })
		}
	}
}

export const sessionsRoutinesHandler: Handler<Sockets.Sessions.Routines.Params, Sockets.Sessions.Routines.Response> = {
	event: "sessions:routines",
	handler: async (socket, params, emitToUser) => {
		const sessionId = Number(params?.sessionId)
		let res: Sockets.Sessions.Routines.Response
		try {
			const access = await checkSessionAccess(sessionId, socket.user!.id)
			if (!access.hasAccess) res = { sessionId, routines: [], error: "Session not found." }
			else {
				const { sessionRoutines } = await import("$lib/server/pipelines/routines/log")
				res = { sessionId, routines: await sessionRoutines(db as unknown as Db, sessionId, { isOwner: !!access.isOwner }) }
			}
		} catch (err) {
			console.warn("[routines] the session's routines could not be read:", err)
			res = { sessionId, routines: [], error: "The session's routines could not be read." }
		}
		emitToUser("sessions:routines", res)
		return res
	}
}

export const sessionsRoutineLogHandler: Handler<Sockets.Sessions.RoutineLog.Params, Sockets.Sessions.RoutineLog.Response> = {
	event: "sessions:routineLog",
	handler: async (socket, params, emitToUser) => {
		const sessionId = Number(params?.sessionId)
		let res: Sockets.Sessions.RoutineLog.Response
		try {
			const access = await checkSessionAccess(sessionId, socket.user!.id)
			if (!access.hasAccess) res = { sessionId, lastInteractionAt: null, entries: [], error: "Session not found." }
			else {
				const { routineLog } = await import("$lib/server/pipelines/routines/log")
				const [row] = await db
					.select({ lastInteractionAt: schema.sessions.lastInteractionAt })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, sessionId))
					.limit(1)
				res = {
					sessionId,
					lastInteractionAt: row?.lastInteractionAt ? row.lastInteractionAt.getTime() : null,
					entries: await routineLog(db as unknown as Db, sessionId, {
						...(typeof params?.since === "number" ? { since: params.since } : {}),
						...(typeof params?.limit === "number" ? { limit: params.limit } : {})
					})
				}
			}
		} catch (err) {
			console.warn("[routines] the routine log could not be read:", err)
			res = { sessionId, lastInteractionAt: null, entries: [], error: "What the routines did could not be read." }
		}
		emitToUser("sessions:routineLog", res)
		return res
	}
}

export function registerRoutineHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, sessionsRunRoutineHandler, emitToUser)
	register(socket, sessionsRoutinesHandler, emitToUser)
	register(socket, sessionsRoutineLogHandler, emitToUser)
}
