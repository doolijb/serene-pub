/**
 * Push to a person from anywhere — the one path for server code that has no
 * socket handler in scope (a review gate parking a run, a cap pause, a
 * notification raised at a decision point).
 *
 * Extracted from `sockets/pipelines.ts` (the review / cap-pause transport) so
 * notifications reuse it instead of growing a fourth emit path. Installed once
 * from `connectSockets`, which is where `io` exists.
 *
 * ## The guarantees, and why each exists
 *
 * - **Call order is delivery order.** Pushes are chained: a gate pushes
 *   `reviewRequested` then, on cancel, `reviewClosed` for the same card, and a
 *   client that received them out of order would keep a card nothing can
 *   decide. A raise followed by a clear has the same shape.
 * - **Redacted for the RECIPIENT.** Connections are redacted against the user
 *   being pushed to, never against whichever socket installed the transport.
 * - **The interest gate holds.** A gated event is delivered per socket to the
 *   ones that declared it (`utils/broadcastHelpers.ts` does the same for the
 *   fan-outs); an ungated one keeps its room emit. The gate is asked BEFORE any
 *   row read, so a person with no surface open pays for nothing.
 * - **Survives a Vite SSR reload.** The installed push lives on `globalThis`,
 *   like the review gate's and the cap pause's own seams.
 *
 * `data` may be a thunk: it runs only when the push will actually be delivered
 * (after the gate), so a push nobody listens for never pays for its payload.
 *
 * Pushes made before any socket has connected go nowhere, which is acceptable
 * for every caller: what they push is also readable on connect.
 */
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { redactConnections } from "$lib/server/connections/visibility"
import { isGatedEvent } from "$lib/shared/sockets/interest"
import { interestedSockets, type InterestIo } from "../interest"

export type UserPush = (
	userId: number,
	event: string,
	data: unknown | (() => unknown | Promise<unknown>)
) => void

type PushIo = InterestIo & { to: (room: string) => any }

const PUSH_KEY = Symbol.for("serene-pub.userPush")

let chain: Promise<unknown> = Promise.resolve()

export function installUserPush(io: PushIo): void {
	const push: UserPush = (userId, event, data) => {
		chain = chain
			.then(async () => {
				const gated = isGatedEvent(event)
				if (gated && interestedSockets(io, userId, event).length === 0)
					return
				const [row] = await db
					.select({ isAdmin: schema.users.isAdmin })
					.from(schema.users)
					.where(eq(schema.users.id, userId))
					.limit(1)
				const raw =
					typeof data === "function"
						? await (data as () => unknown | Promise<unknown>)()
						: data
				const payload = redactConnections(raw, row)
				if (!gated) {
					io.to(`user_${userId}`).emit(event, payload)
					return
				}
				// Walked again rather than snapshotted: a socket that arrived
				// or left during the reads is treated as it is now.
				for (const target of interestedSockets(io, userId, event))
					io.to(target.id).emit(event, payload)
			})
			.catch((err) => {
				console.warn(`[userPush] could not deliver ${event}:`, err)
			})
	}
	;(globalThis as Record<symbol, unknown>)[PUSH_KEY] = push
}

/** Push to every socket of `userId` (gated events: only the interested ones). */
export const pushToUser: UserPush = (userId, event, data) =>
	((globalThis as Record<symbol, unknown>)[PUSH_KEY] as UserPush | undefined)?.(
		userId,
		event,
		data
	)
