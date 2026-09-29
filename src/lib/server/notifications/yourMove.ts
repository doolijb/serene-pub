/**
 * The `your-move` producer (PLAN-notifications §5, owner ruling Q1
 * 2026-09-28): a person is due when the session's STORED turn order's head is
 * their own entry. Only where there is a rotation — an empty order (a narrator
 * genre) or an AI head nobody fired is nobody's move.
 *
 * Turn order is state (canon A9): this reads the stored order and never
 * recomputes who is next. Who portrays the head is `resolvePortrayals`'
 * answer, asked as the session owner — so a persona whose owner has left the
 * session is nobody's portrayal here, and nobody is due.
 *
 * Called from the `turn-order-changed` settle point in `sessionEvents.ts`
 * (after the push and auto-advance), and from the boot re-check that
 * `service.ts` registers. Never throws.
 */
import { eq } from "drizzle-orm"
import { readTurnOrder, type EventCause } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	clearNotifications,
	openNotifications,
	openNotificationsOfKind,
	raiseNotification
} from "./store"
import {
	YOUR_MOVE,
	regardingFor,
	sessionHref
} from "$lib/shared/notifications/kinds"

export interface DueUser {
	/** False when the session is gone. */
	exists: boolean
	/** The person the stored head names, or null when nobody is due. */
	userId: number | null
	/** The session's name for the row's `{session}`. */
	sessionName: string
}

/** Who is due in a session, from its stored order. Throws on a failed read. */
export async function dueUserOf(db: Db, sessionId: number): Promise<DueUser> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			name: schema.sessions.name,
			metadata: schema.sessions.metadata
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { exists: false, userId: null, sessionName: "" }
	const sessionName = session.name?.trim() || "Untitled session"
	// The canonical head read (`headTurnEntry`), from the row already in hand.
	const head = readTurnOrder(session.metadata).order[0]
	if (!head || typeof head.ref !== "string")
		return { exists: true, userId: null, sessionName }
	let userId: number | null = null
	try {
		const { resolvePortrayals } = await import(
			"$lib/server/pipelines/runtime/portrayals"
		)
		const portrayals = await resolvePortrayals(db, {
			sessionId,
			runOwnerUserId: session.userId,
			refs: [head.ref]
		})
		const portrayal = Object.values(portrayals)[0]
		if (portrayal?.by === "person") {
			const id = Number(portrayal.userId)
			if (Number.isInteger(id) && id > 0) userId = id
		}
	} catch {
		// A ref that is not a participant reference names nobody.
	}
	return { exists: true, userId, sessionName }
}

/**
 * Settle a session's `your-move` rows against its stored order.
 *
 * - The user whose own send caused this (`cause.kind === 'user'`) and who is
 *   not due again: their row is cleared `acted`.
 * - Everyone else not due: `superseded`.
 * - The due user: raised only when they have no open row — re-raising on every
 *   recompute would re-light a row they already read.
 */
export async function settleYourMove(
	db: Db,
	opts: { sessionId: number; cause?: EventCause | null }
): Promise<void> {
	try {
		const regarding = regardingFor.move(opts.sessionId)
		const due = await dueUserOf(db, opts.sessionId)
		if (!due.exists) {
			await clearNotifications({ regarding }, "superseded", db)
			return
		}
		const actor =
			opts.cause?.kind === "user" &&
			Number.isInteger(opts.cause.userId) &&
			opts.cause.userId !== due.userId
				? (opts.cause.userId as number)
				: null
		if (actor !== null)
			await clearNotifications({ regarding, userId: actor }, "acted", db)
		await clearNotifications(
			{ regarding, exceptUserIds: due.userId !== null ? [due.userId] : [] },
			"superseded",
			db
		)
		if (due.userId === null) return
		// Every other user's row was just cleared, so an open row left for
		// this key is the due user's own.
		const open = await openNotifications(regarding, db)
		if (open.length) return
		await raiseNotification(
			{
				userIds: [due.userId],
				kind: YOUR_MOVE.id,
				regarding,
				href: sessionHref(opts.sessionId),
				vars: { session: due.sessionName }
			},
			db
		)
	} catch (err) {
		console.error(
			`[notifications] your-move settle for session ${opts.sessionId} failed:`,
			err
		)
	}
}

const MOVE_KEY = /^session:(\d+)\/move$/

/**
 * Boot re-check: every open `your-move` row whose user is not due now — or
 * whose session is gone — is cleared `superseded`. Raises nothing: a person
 * due at boot was raised for when the order was written.
 */
export async function recheckYourMove(db: Db): Promise<void> {
	const rows = await openNotificationsOfKind(YOUR_MOVE.id, db)
	const sessionIds = new Set<number>()
	for (const row of rows) {
		const m = MOVE_KEY.exec(row.regarding)
		if (m) sessionIds.add(Number(m[1]))
	}
	for (const sessionId of sessionIds) {
		const regarding = regardingFor.move(sessionId)
		const due = await dueUserOf(db, sessionId)
		await clearNotifications(
			{
				regarding,
				exceptUserIds:
					due.exists && due.userId !== null ? [due.userId] : []
			},
			"superseded",
			db
		)
	}
}
