/**
 * A person's view of the session annex (R57, V1c): the values whose audience
 * holds for them, merged per owner into one object. The annex itself never
 * leaves the server; this is what a screen and its widgets are given.
 *
 * Held against the same resolver the action audiences use
 * (`resolvePortrayals` with the viewer as the asker): `participant` and
 * `person` hold for a member, `owner` for the session's owner, `user:<id>` for
 * that user, a `character:` or `envoy:` for whoever portrays it — and `ai`
 * for nobody here, since a person is not the model's context.
 *
 * Who may see a key is its owner's **annex declaration**'s to say (ruling
 * 2026-09-26), never what a write stored beside the value: a key declared
 * for pipelines only, and a key no declaration covers — legacy data written
 * before the ruling — is pipelines only (R59) and never in a view.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	audienceHolds,
	isParticipantRef,
	visibleTo,
	type DataAudiences,
	type ParticipantRef
} from "@serene-pub/sdk"
import { resolvePortrayals } from "$lib/server/pipelines/runtime/portrayals"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { emitToUserRedacted } from "$lib/server/sockets/utils/broadcastHelpers"
import { declaredAudiences } from "$lib/server/sessions/annexFields"

export type AnnexView = Record<string, Record<string, unknown>>

/** One member's view, or null when they cannot reach the session. */
export async function annexViewFor(
	db: Db,
	sessionId: number,
	userId: number
): Promise<AnnexView | null> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess) return null
	const [row] = await db
		.select({
			annex: schema.sessions.annex,
			genreId: schema.sessions.genreId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	const audiences: DataAudiences = await declaredAudiences(
		db,
		row.genreId ?? "core:genre/chat"
	)
	// Only well-formed references reach the resolver: one malformed row must
	// not fail every member's view (it holds for nobody instead).
	const refs = [
		...new Set(
			Object.values(audiences).flatMap((keys) =>
				Object.values(keys).flat()
			)
		)
	].filter((r) => isParticipantRef(r)) as ParticipantRef[]
	if (!refs.length) return {}
	const portrayals = await resolvePortrayals(db, {
		sessionId,
		runOwnerUserId: userId,
		refs
	})
	return visibleTo(
		(row.annex ?? {}) as Record<string, unknown>,
		audiences,
		(held) => audienceHolds(held, portrayals, { userId })
	)
}

/**
 * Re-send every member their own view, after the annex changed. Each gets
 * theirs alone, through the per-recipient emit — never one payload for the
 * room, which would be the union of everybody's.
 */
export async function pushAnnexViews(
	db: Db,
	io: SessionIo,
	sessionId: number
): Promise<void> {
	if (!io) return
	const [session] = await db
		.select({
			ownerId: schema.sessions.userId,
			genreId: schema.sessions.genreId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return
	// Nothing anybody may see: every view is `{}`, and was before.
	const audiences = await declaredAudiences(db, session.genreId ?? "core:genre/chat")
	if (!Object.values(audiences).some((keys) => Object.keys(keys ?? {}).length)) return
	const guests = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(eq(schema.sessionGuests.sessionId, sessionId))
	const members = new Set<number>([
		session.ownerId,
		...guests.map((g) => g.userId)
	])
	// Lazy: the view is built only for a member with a tab that wants it.
	for (const userId of members)
		await emitToUserRedacted(io, userId, "sessions:annex", async () => {
			const annex = await annexViewFor(db, sessionId, userId)
			return annex === null ? null : { sessionId, annex }
		})
}
