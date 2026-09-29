import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import type { AuthenticatedSocket } from "../auth"
import { redactConnections, withoutConnectionIdentity } from "$lib/server/connections/visibility"
import { isGatedEvent, scopeOfPayload } from "$lib/shared/sockets/interest"
import {
	anyInterestAnywhere,
	hasInterest,
	interestedSockets,
	socketsInUserRoom,
	socketWants,
	socketWantsAnyScope
} from "../interest"

/**
 * A lazy broadcast payload — the cascade's query, deferred (plan ruling 4).
 *
 * Both helpers below take one wherever building the payload costs a query: the
 * thunk runs ONCE, and only after the gate has said somebody is listening, so a
 * re-read nobody wants is never paid for. Skipping the emit alone would save
 * nothing; the query is the cost.
 *
 * Nullish back means there is nothing to broadcast — the thunk's own guard on a
 * re-read that came back empty. So `null` is a skip here rather than a payload,
 * unlike `emitToUser`'s boxed thunk in `sockets/index.ts`: no broadcast in the
 * application sends one.
 *
 * ⚠ A rejection is NOT swallowed either. Every caller awaits this helper from
 * inside its own try/catch, so a payload that fails to build belongs to that
 * catch — the same place it would land had the caller built it itself.
 */
type LazyPayload = () => any | Promise<any>

function isLazy(data: unknown): data is LazyPayload {
	return typeof data === "function"
}

/**
 * Emit to a set of user rooms, hiding connections from those who are not
 * administrators.
 *
 * These broadcasts do not go through `sockets/index.ts`'s `emitToUser` — they
 * fan out to OTHER people's rooms, so there is no `socket.user` to read — which
 * is exactly why the rule has to be repeated here rather than assumed.
 *
 * The admin roster is only read when the payload actually carries connection
 * identity, and `withoutConnectionIdentity` answers that question by returning
 * the very same object when it found nothing to remove. The streaming path
 * broadcasts a message row per chunk and none of them has ever named a
 * connection, so the common case costs one walk and no query at all.
 *
 * ⚠ The owner's emit now happens after the guest lookup rather than before it —
 * both callers gather every recipient first so one roster read can serve them
 * all. Same number of queries, one of them moved: the owner's copy of a
 * streamed chunk lands a query later than it used to, which is not cumulative
 * across chunks.
 *
 * The interest gate is asked twice, for two different questions. PER RECIPIENT
 * first — a user none of whose sockets declared the key is dropped before
 * anything else happens, which keeps the one roster read above to the people who
 * are actually going to be sent something. Then PER SOCKET at the emit (ruling
 * 5), because a user's other tab may be open on another session and has no
 * business receiving this one's rows.
 *
 * `scope` is the **interest scope** the caller already extracted, passed in
 * rather than re-derived so the narrowing check and the delivery ask about the
 * same scope — `broadcastToSessionUsers` falls back to the session it was
 * called for when a payload does not name one, and a second extraction here
 * would read that as "no scope" and drop every scoped listener. Omitted (the
 * one-recipient helper below), the scope comes from the payload.
 */
async function emitRedacted(
	io: AuthenticatedSocket["io"],
	event: string,
	all: { userId: number; data: any }[],
	scope?: string | null
): Promise<void> {
	const recipients = isGatedEvent(event)
		? all.filter((r) =>
				hasInterest(
					io,
					r.userId,
					event,
					scope === undefined ? scopeOfPayload(event, r.data) : scope
				)
			)
		: all
	// Nobody to send to is nothing to look up. An ungated event reaches this
	// only with an empty list, where the loop below already emitted nothing.
	if (recipients.length === 0) return

	const hidden = new Map<any, any>()
	for (const { data } of recipients) {
		if (hidden.has(data)) continue
		hidden.set(data, withoutConnectionIdentity(data))
	}

	// Same object back means the payload named no connection, so who is an
	// administrator cannot change what anyone receives — and the roster is not
	// worth a round trip.
	const carriesIdentity = [...hidden].some(([raw, safe]) => raw !== safe)
	const admins = carriesIdentity
		? new Set(
				(
					await db
						.select({ id: schema.users.id })
						.from(schema.users)
						.where(
							and(
								inArray(
									schema.users.id,
									recipients.map((r) => r.userId)
								),
								eq(schema.users.isAdmin, true)
							)
						)
				).map((row) => row.id)
			)
		: null

	// A GATED event is delivered PER SOCKET (plan ruling 5), not to the room: a
	// user's second tab, open on another session, must not be sent this
	// session's chunks at all. The client registry drops a payload whose scope
	// it holds no key for, which is correct and pays the bandwidth anyway — one
	// row per streamed chunk, to every tab that user has open. Ungated events
	// keep the room emit they have always had.
	//
	// The redaction is still decided per USER, because that is what the admin
	// roster answers for; every socket of one user therefore receives the same
	// payload.
	const gated = isGatedEvent(event)
	for (const { userId, data } of recipients) {
		const payload = admins && !admins.has(userId) ? hidden.get(data) : data
		if (!gated) {
			io.to(`user_${userId}`).emit(event, payload)
			continue
		}
		const targets = interestedSockets(
			io,
			userId,
			event,
			scope === undefined ? scopeOfPayload(event, data) : scope
		)
		for (const target of targets) io.to(target.id).emit(event, payload)
	}
}

/**
 * Emit to ONE user room that is not necessarily the caller's own.
 *
 * For the handful of pushes aimed at somebody else — a newly added guest's
 * session list, say — which by definition cannot go through the caller's
 * `emitToUser` and so would otherwise leave the redaction behind.
 *
 * `data` may be a `LazyPayload`, for the ones whose payload is a query: a fresh
 * session list for a guest who was just added is the whole `sessions:list`
 * read, paid for somebody who may have no tab open at all.
 */
export async function emitToUserRedacted(
	io: AuthenticatedSocket["io"],
	userId: number,
	event: string,
	data: any | LazyPayload
): Promise<void> {
	if (!isLazy(data)) {
		await emitRedacted(io, event, [{ userId, data }])
		return
	}

	// The gate, before the query. Asked as the WEAKER question — has this user
	// a socket wanting ANY scope of the event — for the reason `emitToUser`'s
	// thunk path gives: a thunk's scope lives in the payload it has not
	// produced yet. `emitRedacted` below still asks the exact scope off what
	// the thunk built, so a socket watching another session is dropped at
	// delivery rather than served the wrong rows.
	if (
		isGatedEvent(event) &&
		!socketsInUserRoom(io, userId).some((socket) =>
			socketWantsAnyScope(socket, event)
		)
	)
		return

	const payload = await data()
	if (payload == null) return
	await emitRedacted(io, event, [{ userId, data: payload }])
}

/**
 * Broadcast an event to all users involved in a session (owner + guests)
 * @param io The socket.io instance
 * @param sessionId The session ID to broadcast to
 * @param event The event name
 * @param data The data to emit, or a `LazyPayload` that builds it
 */
export async function broadcastToSessionUsers(
	io: AuthenticatedSocket["io"],
	sessionId: number,
	event: string,
	data: any | LazyPayload
) {
	// The gate comes BEFORE the two reads below, which is the whole of it for
	// this helper: the streaming push broadcasts one row per chunk, so the
	// owner and guest lookups are paid per chunk for a session no open view may
	// be watching. Asked of every connected socket rather than of a room —
	// whose rooms to read is exactly what the queries below are for — and it
	// only ever NARROWS: `emitRedacted` still decides per recipient and then per
	// socket.
	//
	// The scope falls back to the session this broadcast is for when a payload
	// does not name one, so an event whose shape drifts fails towards sending
	// rather than towards silence. The same value goes to `emitRedacted`, so
	// both halves ask about one scope.
	//
	// A LAZY payload has no scope to read yet — the query that would name one
	// is the query being skipped — so the narrowing asks about `sessionId`, the
	// session this broadcast is FOR. That is the scope its payload will name;
	// a thunk that builds ANOTHER session's payload must be passed eagerly
	// instead, because the sockets watching that other session are the ones
	// this check would then miss.
	const gated = isGatedEvent(event)
	const narrowing = gated
		? isLazy(data)
			? String(sessionId)
			: (scopeOfPayload(event, data) ?? String(sessionId))
		: undefined
	if (narrowing !== undefined && !anyInterestAnywhere(io, event, narrowing))
		return

	// Only now is the payload worth building, and it is built exactly once.
	const payload = isLazy(data) ? await data() : data
	// Nullish from a thunk is the empty re-query — nothing to broadcast.
	if (isLazy(data) && payload == null) return

	// The scope DELIVERY asks about, read off the payload that now exists. On
	// the eager path this is the same value the narrowing used, from the same
	// payload; on the lazy one it is the first look the gate gets at what was
	// actually built.
	const scope = gated
		? (scopeOfPayload(event, payload) ?? String(sessionId))
		: undefined

	// Get session owner
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})

	if (!session) return

	// Get all guests
	const guests = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.sessionId, sessionId),
		columns: { userId: true }
	})

	await emitRedacted(
		io,
		event,
		[
			{ userId: session.userId, data: payload },
			...guests.map((guest) => ({ userId: guest.userId, data: payload }))
		],
		scope
	)
}

/*
 * ⚠ `broadcastToSessionUsersVaryingByRole` used to live here: same fan-out,
 * but a different payload for the owner than for the guests, so a raw service
 * error could reach "their own connection/credentials" and nobody else.
 *
 * It is gone rather than merely unused, because the axis it encoded is the one
 * 0.6 overturned. Connections are the administrator's; a non-admin OWNER has no
 * more relationship to the instance's compute than a guest does, so a helper
 * whose whole shape is owner-vs-guest is a trap for the next person who needs to
 * hide something. It was also solving the wrong half: its one caller,
 * `persistGenerationErrorRow`, STORES the error and `projectLegacy` re-serves it
 * on every reload, so a redaction made at the broadcast was undone by the next
 * page load. The fix is the shape of the stored row (identity in a field the
 * projection removes), which makes one payload right for every recipient and
 * leaves `emitRedacted` — one rule, per recipient — as the only thing that
 * varies by who is listening.
 */

/**
 * Get all user IDs involved in a session (owner + guests)
 * @param sessionId The session ID
 * @returns Array of user IDs
 */
export async function getSessionUserIds(sessionId: number): Promise<number[]> {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})

	if (!session) return []

	const userIds = [session.userId]

	// Get all guests
	const guests = await db.query.sessionGuests.findMany({
		where: eq(schema.sessionGuests.sessionId, sessionId),
		columns: { userId: true }
	})

	// Add guest user IDs
	for (const guest of guests) {
		userIds.push(guest.userId)
	}

	return userIds
}

/**
 * Create a broadcaster function for a specific session
 * This allows handlers to emit to all session participants without needing the IO instance
 * @param io The socket.io instance
 * @param sessionId The session ID
 * @returns A function that broadcasts to all session users
 */
export function createSessionBroadcaster(
	io: AuthenticatedSocket["io"],
	sessionId: number
) {
	return async (event: string, data: any) => {
		await broadcastToSessionUsers(io, sessionId, event, data)
	}
}

/**
 * Emit to EVERY connected socket that declared interest in `event` (at the
 * payload's scope, when the event is scoped) — whoever's it is, in no
 * particular room.
 *
 * For the instance-wide pushes that are about something every viewer may
 * have on screen rather than about one user or one session: an authored
 * component changed (`components:changed`), and any session page drawing it
 * has to hear so. The interest registry is what keeps that from being a
 * broadcast to every tab: a socket that declared nothing gets nothing.
 *
 * ⚠ Only for a GATED event (`GATED_EVENTS`): an ungated event has no
 * interest to consult, so it is refused here rather than silently sent to
 * nobody. Redacted per recipient, as every exit is.
 *
 * `only` narrows the recipients further, for a payload that is cut per
 * recipient (`sessionPresets:list`: the admin table and the picker's cut) —
 * one call per cut, each to the sockets it is for, through this one exit.
 */
export function emitToInterested(
	io: Pick<AuthenticatedSocket["io"], "to"> & { sockets: { sockets: { values(): Iterable<any> } } },
	event: string,
	payload: any,
	only?: (socket: any) => boolean
): number {
	if (!isGatedEvent(event))
		throw new Error(`emitToInterested('${event}'): the event is not gated, so no socket can have declared interest in it`)
	const scope = scopeOfPayload(event, payload)
	let sent = 0
	const all = io?.sockets?.sockets
	if (!all || typeof all.values !== "function") return 0
	for (const socket of all.values()) {
		if (!socket || !socketWants(socket, event, scope)) continue
		if (only && !only(socket)) continue
		io.to(socket.id).emit(event, redactConnections(payload, socket.user))
		sent++
	}
	return sent
}
