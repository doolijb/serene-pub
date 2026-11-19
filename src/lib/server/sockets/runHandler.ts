import type { Handler } from "$lib/shared/events"
import {
	logbookBegin,
	logbookCommit,
	logbookWants
} from "$lib/server/adminLogbook/record"
import { isBlockedDuringSetup } from "$lib/server/auth/setupGate"
import {
	connectionsVisibleTo,
	redactConnections
} from "$lib/server/connections/visibility"
import { ADMINISTRATOR_SUGGESTION } from "$lib/server/pipelines/runtime/haltExplanation"

const GENERIC_FALLBACK = "An error occurred while processing your request."

/**
 * Run a lazy payload, boxed.
 *
 * Boxed rather than returned bare so a thunk that legitimately produces
 * `undefined` or `null` is still emitted — `null` is a payload, a failure is
 * not. A rejection is logged and swallowed: `emitToUser`'s call sites do not
 * await it, so a throw here would surface as an unhandled rejection rather than
 * as the missing emit it actually is.
 */
export async function evaluate(
	event: string,
	thunk: () => any | Promise<any>
): Promise<{ value: any } | null> {
	try {
		return { value: await thunk() }
	} catch (error) {
		console.error(`Error building the payload for ${event}:`, error)
		return null
	}
}

/**
 * Run one handler for one request: the setup gate, the admin logbook, and the
 * refusal wording. The single path for a socket event and for a handler that
 * dispatches another event on the same socket, so both are logged and gated alike.
 */
export async function runHandler(
	socket: any,
	handler: Handler<any, any>,
	message: any,
	emitToUser: (event: string, data: any) => void
): Promise<void> {
	// A session that still owes setup — a password to choose, a second
	// factor to enrol (27 §1) — may only use what it needs to finish.
	// Enforced here rather than per-handler so a handler added later
	// cannot forget a gate it never had to know about.
	//
	// The flag is computed once at handshake. A tab that verifies elsewhere
	// keeps a stale `true` until it reconnects, which fails closed (it sees
	// refusals, never unauthorized access) and is what the post-verification
	// reload resolves.
	if (
		socket.pendingSetup?.length &&
		isBlockedDuringSetup(handler.event)
	) {
		answerAsker(socket, `${handler.event}:error`, {
			error:
				socket.pendingSetup[0] === "password"
					? "Set a new password to continue."
					: "Two-factor authentication is required to continue."
		})
		return
	}

	// Many handlers catch their own errors, emit a specific
	// `{event}:error` with a useful message via emitToUser, then
	// re-throw so this wrapper's catch below also runs (eg. for
	// logging). Wrapping emitToUser here to notice that emit means the
	// generic fallback below can skip re-emitting the same event with a
	// generic, less useful message — without needing every handler to
	// coordinate this explicitly.
	let specificErrorEmitted = false
	// The admin logbook (`server/adminLogbook`): null unless this event is
	// one it records and the actor is an admin. The payload a handler
	// emits on its own event stands in for a reply it did not return.
	// Checked synchronously first, so an unrecorded event (nearly all of
	// them) starts its handler on the same tick it always did.
	const logbook = logbookWants(socket.user, handler.event, message)
		? await logbookBegin(socket.user, handler.event, message)
		: null
	let emitted: unknown = undefined
	const trackedEmitToUser = (event: string, data: any) => {
		// The request's own refusal answers the tab that asked (A24).
		if (event === `${handler.event}:error`) {
			specificErrorEmitted = true
			return answerAsker(socket, event, data)
		}
		if (logbook && event === handler.event && typeof data !== "function")
			emitted = data
		// Forwarded, not discarded: a handler that passes a thunk gets back
		// the promise it may want to await before it returns.
		return emitToUser(event, data)
	}
	try {
		const result = await handler.handler(socket, message, trackedEmitToUser)
		if (logbook && !specificErrorEmitted)
			void logbookCommit(logbook, result ?? emitted)
	} catch (error) {
		console.error(`Error handling event ${handler.event}:`, error)
		if (specificErrorEmitted) return
		// A handler that words no refusal of its own gets this sentence;
		// `refusable()` is how a handler words its own.
		answerAsker(socket, `${handler.event}:error`, {
			error: connectionsVisibleTo(socket.user)
				? GENERIC_FALLBACK
				: `${GENERIC_FALLBACK} ${ADMINISTRATOR_SUGGESTION}`
		})
	}
}

/**
 * Send a request's refusal to the socket that asked, and to no other tab.
 *
 * The user's other tabs did not ask: in the whole room, every tab's Layout
 * toasts the refusal and every tab's `awaitReply` of the same event settles
 * on it. A refusal about THIS request is this socket's alone.
 *
 * ⚠ Never gated (plan ruling 2: gate outputs, never failures). A client that
 * declared interest in an event declared interest in being TOLD IT FAILED; a
 * gate here would turn a request the client is waiting on into silence.
 *
 * A socket that has gone — its tab reloaded while a long request was out —
 * hands the refusal to the user's room, so the failure still reaches a tab.
 * Redacted for the recipient, like every other emit on this road.
 */
function answerAsker(
	socket: any,
	event: string,
	data: any | (() => any | Promise<any>)
): void | Promise<void> {
	const userId = socket.user?.id
	if (!userId) return
	const target = socket.disconnected ? "user_" + userId : socket.id
	const send = (value: any) =>
		socket.io.to(target).emit(event, redactConnections(value, socket.user))
	if (typeof data !== "function") {
		send(data)
		return
	}
	return evaluate(event, data).then((box) => {
		if (box) send(box.value)
	})
}
