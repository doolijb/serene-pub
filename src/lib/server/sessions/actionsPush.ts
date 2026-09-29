/**
 * The action list, re-sent when a run starts and when it ends (plans/29
 * R-15 *enabled-when*; plans/30 U5e, reviews C1/C2, W-A1, W-A4;
 * 2026-09-17).
 *
 * An action's enabled-when verdict is a snapshot of the session's published
 * values, and a run is what moves them: `session.generating` rises and
 * falls, the state-keeper's writes land, a reply becomes the newest row.
 * The **server** is the authority for when a verdict has moved, so every
 * road a run takes — the reply road (`runReply`), a fired action
 * (`sessions:fireAction`, its parked settle included) — calls this
 * once per **root** after `runRegistry.start` and once after
 * `runRegistry.finish`. Children dispatched under a root end inside the
 * root's await and are covered by its pushes; a child parked at review and
 * settled later pushes from its own settle (`dispatchFires`'s `onSettled`).
 * A client never relists on its own progress frames.
 *
 * The gate comes before every read (the interest rule: a socket that wants
 * nothing costs no query): first, does ANY connected socket hold this
 * session's scope — `sessions:actions#<id>`, what the session page
 * declares — and only then is the roster read, and a list built per member
 * whose own socket holds it. A tab on another session is sent nothing and
 * has no list built for it. The payload is `buildSessionActions`', the one
 * the reply to `sessions:actions` carries.
 *
 * Reads and pushes for one session are **serialised** on one chain: the
 * start push's list takes a few queries to build, and a fast run's end push
 * must not overtake it and leave the client on a stale "generating"; a
 * client's own request made while a run is ending (`sessions:actions`, a
 * mount mid-run) queues behind the end push for the same reason
 * (`withSessionActionsChain`).
 */

import {
	emitToUserRedacted,
	getSessionUserIds
} from "$lib/server/sockets/utils/broadcastHelpers"
import { anyInterestAnywhere, hasInterest } from "$lib/server/sockets/interest"
import type { AuthenticatedSocket } from "$lib/server/sockets/auth"

const EVENT = "sessions:actions"

/** The work in flight per session, so the next read or push on that session queues behind it. */
const chains = new Map<number, Promise<unknown>>()

/** How many lists this module has built — a test seam, so "no list was built for them" is a fact and not an inference. */
let builds = 0
export const __actionsPushBuildsForTests = () => builds

/**
 * Run `fn` behind everything already queued on this session's chain — a
 * push, or another request — and ahead of whatever comes next. A failure in
 * an earlier link does not fail this one; the chain only orders.
 */
export function withSessionActionsChain<T>(
	sessionId: number,
	fn: () => Promise<T>
): Promise<T> {
	const key = Number(sessionId)
	const prior = chains.get(key) ?? Promise.resolve()
	const next = prior.catch(() => {}).then(fn)
	chains.set(key, next)
	void next
		.catch(() => {})
		.finally(() => {
			if (chains.get(key) === next) chains.delete(key)
		})
	return next
}

/** One push of `sessions:actions` to every member watching the session, each their own list. */
export function pushSessionActions(
	io: AuthenticatedSocket["io"] | null | undefined,
	sessionId: number
): Promise<void> {
	if (!io) return Promise.resolve()
	return withSessionActionsChain(sessionId, () => pushNow(io, sessionId))
}

async function pushNow(
	io: AuthenticatedSocket["io"],
	sessionId: number
): Promise<void> {
	const scope = String(sessionId)
	// The room first, before the roster read: nobody watching this
	// session's list means nobody is read and nothing is built.
	if (!anyInterestAnywhere(io, EVENT, scope)) return
	let members: number[]
	try {
		members = await getSessionUserIds(sessionId)
	} catch (e) {
		console.warn(
			`[actionsPush] members of session ${sessionId} could not be read:`,
			e
		)
		return
	}
	const { buildSessionActions } = await import("$lib/server/sockets/sessions")
	for (const userId of members) {
		// The exact scope, per member: one whose only tab is on another
		// session wants no list of this one, so none is built.
		if (!hasInterest(io, userId, EVENT, scope)) continue
		try {
			builds++
			// `member: true` — the roster just said so; no second access read.
			const payload = await buildSessionActions(
				sessionId,
				userId,
				"main",
				{
					member: true
				}
			)
			await emitToUserRedacted(io, userId, EVENT, payload)
		} catch (e) {
			// One member's list failing to build must not cost the others
			// theirs; the next listing they ask for is the same query.
			console.warn(
				`[actionsPush] sessions:actions for user ${userId} on session ${sessionId} failed:`,
				e
			)
		}
	}
}
