/**
 * 🚧 `sessions:statTrail` (PLAN-core-widgets §3.10, F2, 2026-10-11) — the
 * door core's Stats widget asks a stat's **stat trail** through, by way of
 * its page (`sessionPage/requests/statTrail.ts`). A thin read: the changes
 * are `sessionStatTrail`'s (`state/statTrail.ts`), the same ledger and the
 * same reader the *Stat trail* pipeline query reads — nothing here decides
 * what changed.
 *
 * Who: anyone in the session (a guest too — the trail is the session's
 * state, which every participant sees). Every answer — reply and refusal —
 * carries the ask's `request` token back: the reply reaches every tab of the
 * person, and only the token tells an ask its own answer.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { sessionStatTrail } from "$lib/server/state/statTrail"

/** A refusal said to the asker in words (not a fault of the server's). */
export class StatTrailRefusal extends Error {}

const OWNER_KINDS = new Set(["session", "session_cast", "session_location"])

const tokenOf = (params: { request?: unknown }) =>
	typeof params?.request === "string" ? { request: params.request } : {}

/** One stat's trail in one session, for someone in it. See the module note. */
export async function readStatTrail(
	params: Omit<Sockets.Sessions.StatTrail.Params, "request">,
	userId: number
): Promise<NonNullable<Sockets.Sessions.StatTrail.Response["trail"]>> {
	const owner = params?.owner as { kind?: unknown; id?: unknown } | undefined
	if (
		!owner ||
		typeof owner.kind !== "string" ||
		!OWNER_KINDS.has(owner.kind) ||
		typeof owner.id !== "number" ||
		!Number.isInteger(owner.id)
	)
		throw new StatTrailRefusal("Name the stat's owner in this session.")
	const slotId = typeof params.slotId === "string" ? params.slotId.trim() : ""
	if (!slotId) throw new StatTrailRefusal("Name the stat to follow.")
	const access = await checkSessionAccess(params.sessionId, userId)
	if (!access.hasAccess)
		throw new StatTrailRefusal("This session is not one you are in.")
	const { changes } = await sessionStatTrail(db, {
		sessionId: params.sessionId,
		owner: {
			kind: owner.kind as "session" | "session_cast" | "session_location",
			id: owner.id
		},
		slotId,
		limit: typeof params.limit === "number" ? params.limit : undefined
	})
	return { changes }
}

export const sessionsStatTrail: Handler<
	Sockets.Sessions.StatTrail.Params,
	Sockets.Sessions.StatTrail.Response
> = {
	event: "sessions:statTrail",
	handler: async (socket, params, emitToUser) => {
		const token = tokenOf(params)
		try {
			const trail = await readStatTrail(params, socket.user!.id)
			const res = { sessionId: params.sessionId, ...token, trail }
			emitToUser("sessions:statTrail", res)
			return res
		} catch (error: any) {
			const res = {
				sessionId: params?.sessionId,
				...token,
				error:
					error instanceof StatTrailRefusal
						? error.message
						: "The stat's changes could not be read."
			}
			if (!(error instanceof StatTrailRefusal))
				console.warn("[statTrail] read failed:", error)
			emitToUser("sessions:statTrail:error", res)
			return res
		}
	}
}

export function registerStatTrailHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsStatTrail, emitToUser)
}
