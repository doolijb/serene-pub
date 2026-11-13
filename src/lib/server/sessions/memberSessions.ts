/**
 * The sessions that read one cast member — so a save of the member (name,
 * version, a dated change) reaches their open pages without a refresh. A
 * seated name on the session page is the card overlaid with the session's
 * `castNames`, built server-side and sent only on `sessions:get` /
 * `sessions:refresh`; the writer of the member pushes it (P2).
 */
import { and, eq, inArray, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export interface MemberSession {
	sessionId: number
	ownerId: number
}

/** Sessions reading the book, the session whose own book it is, and sessions seating the member (live seats). */
export async function sessionsReadingMember(
	db: Db,
	params: { lorebookId: number; memberId: number }
): Promise<MemberSession[]> {
	const ids = new Set<number>()
	const reading = await db
		.select({ id: schema.sessions.id })
		.from(schema.sessions)
		.where(eq(schema.sessions.lorebookId, params.lorebookId))
	for (const r of reading) ids.add(r.id)
	const [book] = await db
		.select({ sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, params.lorebookId))
	if (typeof book?.sessionId === "number") ids.add(book.sessionId)
	const seated = await db
		.select({ id: schema.sessionCharacters.sessionId })
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.castMemberId, params.memberId),
				isNull(schema.sessionCharacters.removedAt)
			)
		)
	for (const r of seated) ids.add(r.id)
	const voiced = await db
		.select({ id: schema.sessionPersonas.sessionId })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.castMemberId, params.memberId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)
	for (const r of voiced) ids.add(r.id)
	if (!ids.size) return []
	const rows = await db
		.select({ id: schema.sessions.id, ownerId: schema.sessions.userId })
		.from(schema.sessions)
		.where(inArray(schema.sessions.id, [...ids]))
	return rows.map((r) => ({ sessionId: r.id, ownerId: r.ownerId }))
}

/**
 * After a member's write landed: push each reading session to its
 * participants, as the session's owner (the editor may not own a reader's
 * session). A failure is logged, never a refusal of a write that landed.
 */
export async function tellMemberSessions(
	io: any,
	db: Db,
	lorebookId: number,
	memberId: number
): Promise<void> {
	try {
		const { pushSessionToParticipants } = await import(
			"$lib/server/sockets/sessions"
		)
		for (const s of await sessionsReadingMember(db, {
			lorebookId,
			memberId
		})) {
			try {
				await pushSessionToParticipants(io, s.sessionId, s.ownerId)
			} catch (e) {
				console.error(
					`telling session ${s.sessionId} of a cast member change failed:`,
					e
				)
			}
		}
	} catch (e) {
		console.error("telling the member's sessions failed:", e)
	}
}
