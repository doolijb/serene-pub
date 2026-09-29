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
				metadata: original.metadata,
				lorebookId: original.lorebookId,
				// The same line of the book, its clock where the parent's
				// stands (ruling 15, story-time P3): a branched session plays
				// on from where its parent read — then keeps its own clock.
				lorebookBranchId: original.lorebookBranchId,
				storyClockYear: original.storyClockYear,
				storyClockMonth: original.storyClockMonth,
				storyClockDay: original.storyClockDay,
				storyClockHour: original.storyClockHour,
				storyClockMinute: original.storyClockMinute,
				// The same genre, preset and genre fields: the copies keep
				// their channels, and the new session has to have them to
				// keep them on. ⚠ The handler this replaced said as much and
				// copied none of the three, so a branch of an adventure came
				// up as a chat (2026-09-16).
				genreId: original.genreId,
				presetId: original.presetId,
				genreFields: original.genreFields,
				// Which world attributes it reads comes along with what it
				// tracks (its picks, below): a branch tracks what its parent did.
				worldAttributes: original.worldAttributes,
				// The state version comes along (U5f): the copied value and
				// possession rows keep the versions they landed at, and a
				// branch that restarted at zero would read every one of them
				// as "moved since" the first proposal made on it.
				stateVersion: original.stateVersion
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
					isActive: sc.isActive
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

		const copied = messagesToCopy.length
			? await insertLegacyMany(
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
			: []

		// The anchors, remapped (R10). `insertLegacyMany` returns the rows of
		// one INSERT in the order they were given, so zipping is the map — and
		// the map is the whole of why state can be copied at all: every
		// attribute row is anchored to a message id, and an id from the source
		// session means nothing in the branch.
		//
		// ⚠ The branch copied NONE of these before today, so a forked adventure
		// arrived with every bar back at its declaration default and no ledger.
		const remap = new Map<number, number>()
		messagesToCopy.forEach((message, i) => {
			const row = copied[i]
			if (row) remap.set(message.id, row.id)
		})
		await copyStateRows(tx, {
			sessionId,
			created: created.id,
			forkMessageId: fromMessageId,
			remap
		})

		return created
	})
}

/**
 * Copy a session's state rows into its branch, anchors remapped.
 *
 * Values and configurations — the session-layer tables (an inventory is a
 * value since phase 3b; the retired possession edges are not copied) — and
 * the sheets its owners have, which is what the branch *tracks* rather than
 * what it holds. Rows anchored after the fork are left behind: a branch is the
 * conversation up to a point, and carrying a change made three replies later
 * would be carrying a fact from a future the branch never had.
 *
 * A null anchor is "from the beginning" and always comes across.
 *
 * ⚠ **Proposals are never copied, on purpose.** A pending decision belongs to
 * the person who was asked, in the session they were asked in; two sessions
 * each holding the same undecided line is two chances to answer one question,
 * and no way to say which answer was meant.
 */
async function copyStateRows(
	tx: Db,
	input: {
		sessionId: number
		created: number
		forkMessageId: number
		remap: Map<number, number>
	}
): Promise<void> {
	const { sessionId, created, forkMessageId, remap } = input
	/** The anchor a copied row gets, or `undefined` when the row stays behind. */
	const anchor = (source: number | null): number | null | undefined => {
		if (source === null) return null
		if (source > forkMessageId) return undefined
		return remap.get(source) ?? undefined
	}

	const values = await tx
		.select()
		.from(schema.attributeValues)
		.where(eq(schema.attributeValues.sessionId, sessionId))
	for (const row of values) {
		const at = anchor(row.validFromMessageId)
		if (at === undefined) continue
		const { id: _id, createdAt: _createdAt, ...rest } = row
		await tx.insert(schema.attributeValues).values({
			...rest,
			sessionId: created,
			validFromMessageId: at
		})
	}

	const configs = await tx
		.select()
		.from(schema.attributeConfigs)
		.where(eq(schema.attributeConfigs.sessionId, sessionId))
	for (const row of configs) {
		const at = anchor(row.validFromMessageId)
		if (at === undefined) continue
		const { id: _id, createdAt: _createdAt, ...rest } = row
		await tx.insert(schema.attributeConfigs).values({
			...rest,
			sessionId: created,
			validFromMessageId: at
		})
	}

	// What the branch TRACKS, as opposed to what it holds: the session's own
	// sheets and its cast's. Both are keyed by `session_id`, so both are found
	// by one predicate and both are remapped the same way — the `session_cast`
	// owner id is a `characters.id` and does not change across a branch, which
	// is why only the `session` owner's id moves.
	const sheets = await tx
		.select()
		.from(schema.ownerSheets)
		.where(eq(schema.ownerSheets.sessionId, sessionId))
	for (const row of sheets)
		await tx.insert(schema.ownerSheets).values({
			ownerKind: row.ownerKind,
			ownerId: row.ownerKind === "session" ? created : row.ownerId,
			sessionId: created,
			sheetId: row.sheetId,
			position: row.position
		})
	// …and its attribute picks, the rest of what it tracks.
	const picks = await tx
		.select()
		.from(schema.sessionAttributePicks)
		.where(eq(schema.sessionAttributePicks.sessionId, sessionId))
	for (const row of picks)
		await tx.insert(schema.sessionAttributePicks).values({
			sessionId: created,
			slotId: row.slotId,
			enabled: row.enabled
		})
}
