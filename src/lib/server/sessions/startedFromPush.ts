/**
 * **Updated**, live (brief 6b of `PLAN-layout-one-format-2026-09-28`).
 *
 * A session's layout is its own copy; the **session layout preset** it
 * **started from** is provenance only, and the editor marks it **Updated**
 * when that row's `layout_updated_at` is later than the session's
 * `layout_copied_at`. That fact moves whenever the row's layout does — a
 * _Save changes to "*Name*"_ from another session, a plugin update, a core
 * reconcile — and a page that learned it only on `:get` showed nothing until
 * a reload. So every writer that moves `layout_updated_at` tells the sessions
 * that now read Updated: `sessions:panelLayout:startedFromUpdated`, scoped to
 * the session (`#<sessionId>`), each person their own answer — the flag, the
 * provenance, and the refreshed list the pane draws from. Nothing else moves:
 * the push is a label, never a copy.
 *
 * The interest rule holds (memory `project_socket_interest_plan`): the gate
 * is asked BEFORE any read. No socket anywhere declaring any scope of the
 * event means no query; a row is built for a person only when one of their
 * sockets holds that session's exact scope (`hasInterest`), and delivery goes
 * through `emitToUserRedacted`, which asks the exact scope again per socket.
 *
 * The same answer carries the list, so it is also how OTHER people's lists
 * follow a shared layout (`pushLayoutListChanged`): sharing one, stopping
 * sharing it, renaming or deleting a shared one changes what everyone else
 * with a session of its genre open is offered — and a deleted one leaves the
 * sessions that started from it with no source to name.
 *
 * `io` comes from the caller that has one (a socket handler's `socket.io`) or
 * from the transport `connectSockets` installs (`installStartedFromPush`),
 * held on `globalThis` so it survives a Vite SSR reload, like `userPush`.
 *
 * ⚠ A push is lost on a socket that is down when it is sent. A reconcile at
 * BOOT runs before sockets accept, so it pushes to nobody — including a page
 * left open across the restart, whose socket is still reconnecting. So the
 * session page asks for the same answer on every (re)connect
 * (`client/sockets/interest.svelte.ts` `onConnect`), and the push is what
 * reaches a page that stayed connected.
 */
import { and, eq, gte, inArray, lt, type SQL } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { emitToUserRedacted } from "$lib/server/sockets/utils/broadcastHelpers"
import {
	ANY_SCOPE,
	anyInterestAnywhere,
	hasInterest,
	scopesWantedAnywhere,
	type InterestIo
} from "$lib/server/sockets/interest"
import type { AuthenticatedSocket } from "$lib/server/sockets/auth"

export const STARTED_FROM_UPDATED_EVENT = "sessions:panelLayout:startedFromUpdated"

type PushIo = AuthenticatedSocket["io"]

const IO_KEY = Symbol.for("serene-pub.startedFromPushIo")

/** Bound from `connectSockets`, where `io` exists; `null` unbinds (tests). */
export function installStartedFromPush(io: InterestIo | null): void {
	;(globalThis as Record<symbol, unknown>)[IO_KEY] = io ?? undefined
}

function installedIo(): PushIo | undefined {
	return (globalThis as Record<symbol, unknown>)[IO_KEY] as PushIo | undefined
}

/** How many answers this module has built — a test seam, so "nothing was built" is a fact. */
let builds = 0
export const __startedFromPushBuildsForTests = () => builds

/** Which rows moved: by id (a save into one), or since an instant (a reconcile). */
export type MovedLayouts = { layoutPresetIds: readonly number[] } | { since: Date }

/** Does ANY connected socket want any scope of the event? Asked before any read. */
const anyoneWatching = (io: PushIo): boolean =>
	anyInterestAnywhere(io as InterestIo, STARTED_FROM_UPDATED_EVENT, ANY_SCOPE)

/**
 * Build and send each (person, session) their own answer. Resolves how many
 * were sent. One person's answer failing must not cost the others theirs;
 * their next open (or reconnect) reads the same facts.
 */
async function deliver(
	io: PushIo,
	targets: Iterable<{ sessionId: number; userId: number }>
): Promise<number> {
	const { startedFromUpdatedAnswer } = await import("$lib/server/sockets/sessions")
	let sent = 0
	for (const { sessionId, userId } of targets) {
		try {
			builds++
			const payload = await startedFromUpdatedAnswer(sessionId, userId)
			if (!payload) continue
			await emitToUserRedacted(io, userId, STARTED_FROM_UPDATED_EVENT, payload)
			sent++
		} catch (e) {
			console.warn(
				`[startedFromPush] session ${sessionId} for user ${userId} failed:`,
				e
			)
		}
	}
	return sent
}

/**
 * Tell every session that started from a moved layout, and now reads it as
 * **Updated**, so its editor shows the Updated line, chip and dot without a
 * reload. Resolves the number of answers sent; never throws (a push is never
 * the reason a save or a reconcile fails).
 */
export async function pushStartedFromUpdated(
	moved: MovedLayouts,
	io: PushIo | null | undefined = installedIo()
): Promise<number> {
	try {
		if (!io || !anyoneWatching(io)) return 0
		const which: SQL | undefined =
			"since" in moved
				? gte(schema.sessionLayoutPresets.layoutUpdatedAt, moved.since)
				: moved.layoutPresetIds.length
					? inArray(schema.sessionLayoutPresets.id, [...moved.layoutPresetIds])
					: undefined
		if (!which) return 0
		const rows = await db
			.select({
				sessionId: schema.sessionPanelLayouts.sessionId,
				userId: schema.sessionPanelLayouts.userId
			})
			.from(schema.sessionPanelLayouts)
			.innerJoin(
				schema.sessionLayoutPresets,
				eq(
					schema.sessionLayoutPresets.id,
					schema.sessionPanelLayouts.startedFromLayoutPresetId
				)
			)
			.where(
				and(
					which,
					// Only the sessions that now READ Updated: the saving session
					// was stamped at the same instant and is not among them.
					lt(
						schema.sessionPanelLayouts.layoutCopiedAt,
						schema.sessionLayoutPresets.layoutUpdatedAt
					)
				)
			)
		if (!rows.length) return 0
		// The exact scope, per person: a tab on another session wants
		// nothing about this one, so nothing is built for it.
		return await deliver(
			io,
			rows.filter(({ sessionId, userId }) =>
				hasInterest(io, userId, STARTED_FROM_UPDATED_EVENT, String(sessionId))
			)
		)
	} catch (e) {
		console.warn("[startedFromPush] could not push Updated:", e)
		return 0
	}
}

/**
 * What OTHER people are offered of a layout changed: a person's layout was
 * shared or stopped being shared, or a shared one was renamed or deleted.
 * Every other person with a session of its genre open gets their refreshed
 * list — the card appears, is renamed or goes — and, after a delete, the
 * started-from line of a session that had copied it (the FK nulled it).
 * An open pane offers only cards that exist for its person: a verb on a
 * vanished one is refused.
 *
 * The actor is left out: their own tabs hear the verb's answer. An admin who
 * acts on someone else's layout is the actor, so the author is told.
 *
 * Same gate as the Updated push: nobody wanting any scope means no query;
 * the sessions are the ones people have open (`scopesWantedAnywhere`), read
 * once for their genre, never a scan of who might care. Never throws.
 */
export async function pushLayoutListChanged(
	changed: { genreId: string; actorId: number },
	io: PushIo | null | undefined = installedIo()
): Promise<number> {
	try {
		if (!io || !anyoneWatching(io)) return 0
		const watched = scopesWantedAnywhere(io as InterestIo, STARTED_FROM_UPDATED_EVENT)
		watched.delete(changed.actorId)
		const open = new Set<number>()
		for (const scopes of watched.values())
			for (const scope of scopes) {
				const id = Number(scope)
				if (Number.isInteger(id)) open.add(id)
			}
		if (!open.size) return 0
		const { sessionGenres } = await import("$lib/server/sockets/sessions")
		const genres = await sessionGenres([...open])
		const targets: Array<{ sessionId: number; userId: number }> = []
		for (const [userId, scopes] of watched)
			for (const scope of scopes) {
				const sessionId = Number(scope)
				if (genres.get(sessionId) === changed.genreId)
					targets.push({ sessionId, userId })
			}
		if (!targets.length) return 0
		return await deliver(io, targets)
	} catch (e) {
		console.warn("[startedFromPush] could not push a layout list:", e)
		return 0
	}
}

/**
 * Run a reconcile that may move layouts (core's shipped layouts, a plugin's
 * declared ones), then tell the sessions whose source it moved. The instant
 * is taken BEFORE the run, so every `layout_updated_at` it writes is at or
 * after it; a run that moves nothing pushes nothing.
 */
export async function afterLayoutReconcile<T>(
	run: () => Promise<T>,
	io: PushIo | null | undefined = installedIo()
): Promise<T> {
	const since = new Date()
	const result = await run()
	await pushStartedFromUpdated({ since }, io)
	return result
}
