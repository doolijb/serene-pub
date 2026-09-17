/**
 * The server half of socket interest.
 *
 * A client declares which events it actually wants (`client/sockets/interest`),
 * sends the full list on `interest:sync`, and this module keeps that list as a
 * per-socket **interest set**. The reply helpers — `sockets/index.ts`'s
 * `emitToUser` and `utils/broadcastHelpers.ts` — then ask `hasInterest` before
 * running a query or emitting a **gated event**.
 *
 * ## Why the handler stores the set with no `await` before it
 *
 * There are no acks in this protocol, so correctness depends entirely on
 * ordering: the client sends `interest:sync` BEFORE the request whose reply
 * it wants, on the SAME socket; Socket.IO delivers one connection's packets
 * in order; `register` in `sockets/index.ts` runs its gates synchronously
 * and then calls `await handler.handler(...)`, and a call proceeds
 * synchronously up to the callee's first `await`. `syncInterest` below has
 * none — it assigns `socket.interest` and returns — so the set is stored
 * before the request packet is dispatched, and before any handler of that
 * request can emit.
 *
 * ⚠ Do not add an `await` (a database read, a dynamic `import()`, a
 * `queueMicrotask`) ahead of the assignment. It would open exactly the window
 * an ack protocol exists to close, and the failure would be a rare missing
 * reply rather than an error — `index.interestGate.test.ts` pins the ordering.
 *
 * ## Expiry is disconnect, not silence
 *
 * The set is cleared when the socket disconnects and never on a timer.
 * Background tabs throttle timers to about one a minute, so a silence timeout
 * would go dark on a live tab. The client's periodic sync is self-healing — an
 * idempotent set replace — never a lease being renewed. (It is not a *lease*:
 * that word means a model permission, NOMENCLATURE §10.)
 */

import type { Handler } from "$lib/shared/events"
import {
	INTEREST_SCOPE_SEPARATOR,
	INTEREST_SYNC_EVENT,
	interestKey,
	isRestrictedInterest,
	type InterestKey,
	type InterestSyncParams
} from "$lib/shared/sockets/interest"

/** The half of a connected socket the interest gate reads. */
export interface InterestSocket {
	id: string
	/**
	 * The keys this client has declared. Set at connect (`connectSockets`), so
	 * a walk never has to answer for `undefined`.
	 */
	interest?: Set<InterestKey>
	/** The recipient, for the per-socket `redactConnections` at the emit. */
	user?: { id?: number; isAdmin?: boolean | null } | null
}

/**
 * The half of the Socket.IO server the gate reads.
 *
 * Structural rather than the real `Server`, because the gate needs exactly
 * three lookups — who is in a user's room, the socket behind an id, and every
 * connected socket — and stating them is what lets a test drive this with two
 * plain Maps.
 */
export interface InterestIo {
	sockets: {
		adapter: { rooms: { get(room: string): Set<string> | undefined } }
		sockets: {
			get(id: string): InterestSocket | undefined
			/**
			 * Every connected socket, for `anyInterestAnywhere` — the one
			 * question that is not about a room, because the broadcast helpers
			 * have to answer it before they know whose rooms to read.
			 */
			values(): Iterable<InterestSocket>
		}
	}
}

/**
 * Sockets in one user's room, in room order.
 *
 * A room holds ids; an id whose socket has already gone is skipped rather than
 * treated as uninterested, which is the same thing here and one less thing for
 * a caller to think about.
 */
export function socketsInUserRoom(
	io: InterestIo,
	userId: number
): InterestSocket[] {
	const ids = io?.sockets?.adapter?.rooms?.get(`user_${userId}`)
	if (!ids) return []
	const out: InterestSocket[] = []
	for (const id of ids) {
		const socket = io.sockets.sockets.get(id)
		if (socket) out.push(socket)
	}
	return out
}

/**
 * Does this socket want this event?
 *
 * A BARE key means "every scope": a client that declared `sessions:streamChunk`
 * gets the chunks of session 42 as well, so adding scopes in phase 3 cannot
 * silently narrow a consumer that never asked for one. With no scope,
 * `interestKey` returns the bare event and the two checks are the same lookup.
 *
 * Exported for the handful of exits that cannot go through `emitToUser` at all
 * — a stored per-socket emitter (`sockets/taskQueue.ts`, `sockets/activity.ts`)
 * holds its socket and answers this question itself, rather than being a second
 * door the gate cannot see.
 */
export function socketWants(
	socket: InterestSocket,
	event: string,
	scope?: string | null
): boolean {
	const declared = socket.interest
	if (!declared || declared.size === 0) return false
	return declared.has(interestKey(event, scope)) || declared.has(event)
}

/**
 * Does this socket want ANY scope of this event?
 *
 * The weaker question, and the only one answerable before a lazy payload has
 * run: a thunk's scope lives in the data the thunk has not produced yet. So a
 * gated cascade on a scoped event asks this first — nobody wants any scope of
 * it, so there is nothing to query for — and the exact question afterwards,
 * off the payload it built. A socket that declared only `sessionMessage#7`
 * answers yes here and is still dropped at delivery when the row turns out to
 * be session 42's.
 */
export function socketWantsAnyScope(
	socket: InterestSocket,
	event: string
): boolean {
	const declared = socket.interest
	if (!declared || declared.size === 0) return false
	if (declared.has(event)) return true
	const prefix = `${event}${INTEREST_SCOPE_SEPARATOR}`
	for (const key of declared) if (key.startsWith(prefix)) return true
	return false
}

/**
 * Does ANY of this user's sockets want this event?
 *
 * The question `broadcastHelpers` asks, where the recipient is a user id and
 * there is no socket to emit to one by one.
 */
export function hasInterest(
	io: InterestIo,
	userId: number,
	event: string,
	scope?: string | null
): boolean {
	for (const socket of socketsInUserRoom(io, userId))
		if (socketWants(socket, event, scope)) return true
	return false
}

/**
 * Does ANY connected socket, in anybody's room, want this event at this scope?
 *
 * The question `broadcastToSessionUsers` asks BEFORE it reads a session's owner
 * and guest roster — two queries, paid once per streamed chunk — because at that
 * point it does not yet know whose rooms are involved, and the roster read is
 * the cost the gate exists to skip.
 *
 * ⚠ This is a NARROWING only. It never decides who receives anything: a true
 * answer merely says the work is worth doing, and delivery still goes through
 * the per-recipient `hasInterest` and the per-socket redaction behind it. So the
 * worst a false positive costs is the two queries this call was avoiding, while
 * a false negative would be silence — which is why it walks every socket rather
 * than guessing at rooms.
 *
 * Fails CLOSED on an `io` with no socket registry (a test double, never the real
 * server), for the same reason `socketsInUserRoom` does: a missing roster is
 * "nobody is listening", which surfaces as a test that emitted nothing rather
 * than as a delivery to somebody who never asked.
 */
export function anyInterestAnywhere(
	io: InterestIo,
	event: string,
	scope?: string | null
): boolean {
	const all = io?.sockets?.sockets
	if (!all || typeof all.values !== "function") return false
	for (const socket of all.values())
		if (socket && socketWants(socket, event, scope)) return true
	return false
}

/**
 * The sockets of one user that want this event, for per-socket delivery.
 *
 * Empty means the gate is closed: no query worth running and nothing to emit.
 */
export function interestedSockets(
	io: InterestIo,
	userId: number,
	event: string,
	scope?: string | null
): InterestSocket[] {
	return socketsInUserRoom(io, userId).filter((socket) =>
		socketWants(socket, event, scope)
	)
}

/**
 * One malformed-sync complaint per socket.
 *
 * A client looping on a bad payload would otherwise write the log a hundred
 * times a minute, and the hundredth line says nothing the first did not. Keyed
 * on the socket object so it goes when the connection does.
 */
const malformedSyncWarned = new WeakSet<object>()

/**
 * The keys a sync actually establishes: strings, minus anything this subject
 * may not hold.
 *
 * Garbage is ignored rather than refused. A sync carries no reply, so throwing
 * would only reach the generic `{event}:error` fallback and tell a client
 * nothing it could act on — while a client that sends one bad payload would
 * lose the set it had. Dropping to what is valid keeps the failure bounded to
 * the keys that were actually wrong.
 */
function acceptedKeys(
	socket: InterestSocket,
	params: InterestSyncParams | undefined
): InterestKey[] {
	const raw = params?.keys
	if (!Array.isArray(raw)) {
		// A client clearing its last key sends `{ keys: [] }`, so this branch
		// is always a bug on the other side rather than an empty declaration.
		if (!malformedSyncWarned.has(socket)) {
			malformedSyncWarned.add(socket)
			console.warn(
				`${INTEREST_SYNC_EVENT}: ignoring a payload whose keys are not ` +
					`an array (socket ${socket.id}, user ${socket.user?.id})`
			)
		}
		return []
	}

	const strings = raw.filter(
		(key): key is InterestKey => typeof key === "string"
	)
	if (strings.length !== raw.length && !malformedSyncWarned.has(socket)) {
		malformedSyncWarned.add(socket)
		console.warn(
			`${INTEREST_SYNC_EVENT}: ignoring ${raw.length - strings.length} ` +
				`non-string keys (socket ${socket.id}, user ${socket.user?.id})`
		)
	}

	// Defence in depth (plan ruling 6c). The handlers' own admin checks remain
	// the boundary — this only refuses to REMEMBER a key a non-admin could
	// never have been served anyway, so a family that is admin-only everywhere
	// cannot be kept alive here by a client that lies about what it wants.
	if (socket.user?.isAdmin) return strings

	const kept: InterestKey[] = []
	const dropped: InterestKey[] = []
	for (const key of strings)
		(isRestrictedInterest(key) ? dropped : kept).push(key)

	if (dropped.length)
		console.warn(
			`${INTEREST_SYNC_EVENT}: dropped restricted interest keys from ` +
				`non-admin user ${socket.user?.id}: ${dropped.join(", ")}`
		)

	return kept
}

/** Replace this socket's interest set. Synchronous — see the file header. */
function syncInterest(
	socket: InterestSocket,
	params: InterestSyncParams | undefined
): void {
	socket.interest = new Set(acceptedKeys(socket, params))
}

/**
 * `interest:sync` — the client's full key list, replacing what the server held.
 *
 * Replacing rather than merging is what makes the periodic sync self-healing: a
 * key the client dropped while the socket was wedged goes on the next one.
 *
 * Emits NOTHING. An echo would be a reply nobody declared interest in, on the
 * one event that exists so replies can be skipped — and the handler is
 * synchronous, not async, so the generic error fallback in `register` has
 * nothing to fire on.
 */
export const interestSync: Handler<InterestSyncParams, void> = {
	event: INTEREST_SYNC_EVENT,
	handler: async (socket, params, _emitToUser) => {
		syncInterest(socket, params)
	}
}

export function registerInterestHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, interestSync, emitToUser)

	// Ruling 1: expiry IS disconnect. Cleared rather than replaced with a new
	// Set so the field a concurrent walk is already holding empties with it,
	// and so it is never momentarily undefined.
	socket.on("disconnect", () => {
		socket.interest?.clear()
	})
}
