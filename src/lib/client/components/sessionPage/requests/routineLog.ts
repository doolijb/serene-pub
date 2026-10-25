/**
 * 🚧 `routine-log` (PLAN-layering A7, R23; lane 7, 2026-10-21): core's
 * *While you were away* widget asks what the session's routines did —
 * through the page's `sessions:routineLog`, the server's read of the
 * routine runs (`server/pipelines/routines/log.ts`). Core's widgets only
 * (the askers table). Anyone with the session open may ask: the log is the
 * session's, as its messages are.
 *
 * A refusal or a failed read is the asking widget's own error (R77), never
 * a toast.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Params = WidgetRequests["routine-log"]["params"]
type Result = WidgetRequests["routine-log"]["result"]

/** The page's read: one `sessions:routineLog` for this session, settled on its reply. */
export type RoutineLogRead = (ask: Sockets.Sessions.RoutineLog.Params) => Promise<Sockets.Sessions.RoutineLog.Response>

/** The most lines one ask may name (the server clamps the same). */
export const ROUTINE_LOG_MOST = 200

/** Answer one `routine-log` for the page's session. Rejects, in words, on a bad ask or a refusal. */
export async function answerRoutineLog(params: Params, sessionId: number | null, read: RoutineLogRead): Promise<Result> {
	const p = (params ?? {}) as Partial<Params>
	if (p.limit !== undefined && (typeof p.limit !== "number" || !Number.isInteger(p.limit) || p.limit < 1))
		throw new Error("routine-log's limit is a whole number of lines, at least 1")
	if (p.since !== undefined && (typeof p.since !== "number" || !Number.isFinite(p.since)))
		throw new Error("routine-log's since is a time in epoch milliseconds")
	if (sessionId == null) throw new Error("this page has no session open")
	const res = await read({
		sessionId,
		...(p.limit !== undefined ? { limit: Math.min(ROUTINE_LOG_MOST, p.limit) } : {}),
		...(p.since !== undefined ? { since: p.since } : {})
	})
	if (res.error) throw new Error(res.error)
	return { lastInteractionAt: res.lastInteractionAt ?? null, entries: res.entries ?? [] }
}
