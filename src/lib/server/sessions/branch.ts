/**
 * Branching a session — the write behind `core:outlet/branch-session@1`
 * (R-15, 2026-09-16). Lifted out of `sessions:branch` so the handler keeps
 * only what the venue decides (the owner check) and the write runs as a
 * built-in: receipted, emitting `session-branched`, recorded in the new
 * session's changes.
 *
 * A branch is a new session with the same cast, guests and tags and a copy
 * of the history up to and including the fork message, each copy keeping its
 * channel. One transaction: a crash partway through must not leave a
 * half-copied session visible in the list.
 */

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { insertLegacyMany } from "$lib/server/messages/store"
import { canonicalChannel } from "$lib/server/messages/channels"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"

export class BranchError extends Error {}

export interface BranchRequest {
	/** The session being forked. */
	sessionId: number
	/** The last message the copy keeps; must belong to `sessionId`. */
	fromMessageId: number
	/** The new session's name. Null keeps the source's. */
	title?: string | null
}

/** The new session's row. */
export async function branchSession(
	db: Db,
	request: BranchRequest
): Promise<typeof schema.sessions.$inferSelect> {
	const { sessionId, fromMessageId } = request
	const original = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		with: {
			sessionCharacters: {
				orderBy: asc(schema.sessionCharacters.position)
			},
			sessionPersonas: {
				orderBy: asc(schema.sessionPersonas.position)
			},
			sessionGuests: true,
			sessionTags: true
		}
	})
	if (!original) throw new BranchError("Original session not found")

	const fork = await db.query.sessionMessages.findFirst({
		where: and(
			eq(schema.sessionMessages.id, fromMessageId),
			eq(schema.sessionMessages.sessionId, sessionId)
		)
	})
	if (!fork) throw new BranchError("Branch message not found")

	const allMessages = await db.query.sessionMessages.findMany({
		where: eq(schema.sessionMessages.sessionId, sessionId),
		orderBy: asc(schema.sessionMessages.id)
	})
	const messagesToCopy = allMessages.filter((m) => m.id <= fromMessageId)

	return await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(schema.sessions)
			.values({
				name: request.title ?? original.name,
				scenario: original.scenario,
				userId: original.userId,
				isGroup: original.isGroup,
				groupReplyStrategy: original.groupReplyStrategy,
				metadata: original.metadata,
				lorebookId: original.lorebookId,
				// The same genre, preset and genre fields: the copies keep
				// their channels, and the new session has to have them to
				// keep them on. ⚠ The handler this replaced said as much and
				// copied none of the three, so a branch of an adventure came
				// up as a chat (2026-09-16).
				genreId: original.genreId,
				presetId: original.presetId,
				genreFields: original.genreFields
			} satisfies InsertSession)
			.returning()

		// Removed participants aren't copied into the branch at all — a
		// soft-removed row resurrecting as active in the new session would
		// undo the whole point of removing them. Nor is a seat with neither
		// a character nor an envoy: that is a departed character whose row
		// the global delete nulled, kept only for its `removedName`.
		//
		// A seat is a character's OR an envoy's (U5g; the CHECK on the
		// table says so), and the branch keeps both: a guide session's
		// branch with no mascot seated would have no one to answer, and
		// the copy would have silently changed who is in the room (U5g
		// review, C2).
		const sessionCharacters = (original as any).sessionCharacters.filter(
			(cc: any) => !cc.removedAt && (cc.characterId || cc.envoySlug)
		)
		if (sessionCharacters.length > 0)
			await tx.insert(schema.sessionCharacters).values(
				sessionCharacters.map((sc: any) => ({
					sessionId: created.id,
					characterId: sc.characterId ?? null,
					envoySlug: sc.envoySlug ?? null,
					position: sc.position,
					isActive: sc.isActive,
					visibility: sc.visibility
				}))
			)

		const sessionPersonas = (original as any).sessionPersonas.filter(
			(cp: any) => !cp.removedAt
		)
		if (sessionPersonas.length > 0) {
			await tx.insert(schema.sessionPersonas).values(
				sessionPersonas.map((sp: any) => ({
					sessionId: created.id,
					personaId: sp.personaId,
					position: sp.position
				}))
			)
			for (const sp of sessionPersonas)
				await markCharacterAsPersona(sp.personaId, tx)
		}

		const sessionGuests = (original as any).sessionGuests
		if (sessionGuests.length > 0)
			await tx.insert(schema.sessionGuests).values(
				sessionGuests.map((g: any) => ({
					sessionId: created.id,
					userId: g.userId
				}))
			)

		const sessionTags = (original as any).sessionTags
		if (sessionTags.length > 0)
			await tx.insert(schema.sessionTags).values(
				sessionTags.map((t: any) => ({
					sessionId: created.id,
					tagId: t.tagId
				}))
			)

		if (messagesToCopy.length > 0)
			await insertLegacyMany(
				tx,
				messagesToCopy.map(
					(message) =>
						({
							sessionId: created.id,
							userId: message.userId,
							personaId: message.personaId,
							characterId: message.characterId,
							role: message.role,
							// The branch is the same conversation, so each
							// copy keeps its lane (20 §7). Canonicalised
							// because this is a write — the source row already
							// is one, and a write path that trusts that is a
							// write path that stops being true later.
							channel: canonicalChannel((message as any).channel),
							content: message.content,
							isHidden: message.isHidden,
							isNarratorResponse: message.isNarratorResponse,
							// Always settled: a copy is never being written.
							isGenerating: false,
							metadata: message.metadata
						}) satisfies InsertSessionMessage
				)
			)

		return created
	})
}
