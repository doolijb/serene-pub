/**
 * 🚧 The session's **author's note**, read and written for the Author's note
 * widget (2026-10-02, AN1).
 *
 * The note is a genre field (`authorsNote`, `AUTHORS_NOTE_FIELD` in core's
 * catalogue; Chat declares it), stored in `sessions.genre_fields` like every
 * other genre field — so the widget and Edit Session › Settings write the same
 * value, and a run reads it through `genreFieldsFor`. This module adds the two
 * things the widget needs that the settings form does not: the last reply's
 * verdict (off its receipt), and a write of the note alone that leaves the
 * session's other fields as they are.
 *
 * Who may: anyone in the session reads it; only the session's owner writes it
 * — the rule `sessions:update` already holds every session setting to.
 */

import { and, desc, eq, sql } from "drizzle-orm"
import type { AuthorsNoteV1, AuthorsNoteValueV1 } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	STANDARD_GENRE_ID,
	genreFieldsFor,
	getSessionGenre
} from "$lib/server/pipelines/entities/sessionGenres"
import {
	AUTHORS_NOTE_DEPTH_DEFAULT,
	readAuthorsNoteValue
} from "$lib/server/pipelines/prompt/authorsNote"

/** The note a session reads before anybody wrote one — the field's declared defaults. */
export const AUTHORS_NOTE_DEFAULT: AuthorsNoteValueV1 = {
	text: "",
	depth: AUTHORS_NOTE_DEPTH_DEFAULT,
	interval: 1,
	role: "system"
}

/** Refused, in the widget's words. */
export class AuthorsNoteRefusal extends Error {}

async function sessionRow(db: Db, sessionId: number) {
	const [row] = await db
		.select({
			id: schema.sessions.id,
			userId: schema.sessions.userId,
			genreId: schema.sessions.genreId,
			genreFields: schema.sessions.genreFields
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row ?? null
}

async function isGuest(db: Db, sessionId: number, userId: number) {
	const [g] = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(
			and(
				eq(schema.sessionGuests.sessionId, sessionId),
				eq(schema.sessionGuests.userId, userId)
			)
		)
		.limit(1)
	return !!g
}

/** Does this session's genre declare the note (an `object` field named `authorsNote`)? */
async function offeredFor(db: Db, genreId: string | null): Promise<boolean> {
	const genre = await getSessionGenre(db, genreId ?? STANDARD_GENRE_ID)
	const decl = (genre?.shape as { fields?: Record<string, { type?: unknown }> } | undefined)
		?.fields?.authorsNote
	return decl?.type === "object"
}

/**
 * What the newest reply's prompt did with the note: the assemble node's
 * `authorsNote` decision off the session's newest receipt that recorded one.
 * Turn-order and other runs record none, so they are passed over by the
 * filter rather than read and discarded. Null when no reply has carried a
 * decision yet.
 */
export async function lastAuthorsNoteDecision(
	db: Db,
	sessionId: number
): Promise<AuthorsNoteV1["lastReply"]> {
	const [run] = await db
		.select({ receipt: schema.pipelineRuns.receipt })
		.from(schema.pipelineRuns)
		.where(
			and(
				eq(schema.pipelineRuns.sessionId, sessionId),
				eq(schema.pipelineRuns.isPreview, false),
				// The decision's own key and first field, as the binding writes
				// it — the builder's unplaced copy (`gatedBy`) never matches.
				sql`${schema.pipelineRuns.receipt}::text like '%"authorsNote":{"included":%'`
			)
		)
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(1)
	const nodes = (run?.receipt as { nodes?: Array<{ output?: unknown }> } | undefined)?.nodes
	if (!Array.isArray(nodes)) return null
	for (let i = nodes.length - 1; i >= 0; i--) {
		const d = (nodes[i]?.output as { authorsNote?: Record<string, unknown> } | undefined)
			?.authorsNote
		if (!d || typeof d.included !== "boolean") continue
		const reason = d.reason === "empty" || d.reason === "interval" ? d.reason : "included"
		return {
			included: d.included,
			reason,
			depth: typeof d.depth === "number" ? d.depth : 0,
			targetIndex: typeof d.targetIndex === "number" ? d.targetIndex : 0
		}
	}
	return null
}

/** The note as the viewer reads it. Refuses a session they are not in. */
export async function readSessionAuthorsNote(
	db: Db,
	sessionId: number,
	userId: number
): Promise<AuthorsNoteV1> {
	const row = await sessionRow(db, sessionId)
	if (!row) throw new AuthorsNoteRefusal("This session was not found.")
	const owner = row.userId === userId
	if (!owner && !(await isGuest(db, sessionId, userId)))
		throw new AuthorsNoteRefusal("This session was not found.")
	const offered = await offeredFor(db, row.genreId)
	const fields = offered ? await genreFieldsFor(db, sessionId) : {}
	return {
		offered,
		canEdit: offered && owner,
		note: readAuthorsNoteValue(fields.authorsNote) ?? { ...AUTHORS_NOTE_DEFAULT },
		lastReply: offered ? await lastAuthorsNoteDecision(db, sessionId) : null
	}
}

/**
 * Save the note, whole, as the session's owner — and only the note: the
 * session's other genre fields stay as stored. Read and written in one
 * transaction, so a settings save landing at the same moment is neither lost
 * nor put back (2026-10-03). Returns the note as it now reads, whether the
 * stored value moved (a save of what is already there is not a change), and
 * the stored genre fields after the write — what `sessions:genreFieldsChanged`
 * pushes.
 */
export async function writeSessionAuthorsNote(
	db: Db,
	sessionId: number,
	userId: number,
	value: unknown
): Promise<{ answer: AuthorsNoteV1; changed: boolean; genreFields: Record<string, unknown> }> {
	const row = await sessionRow(db, sessionId)
	if (!row) throw new AuthorsNoteRefusal("This session was not found.")
	if (row.userId !== userId)
		throw new AuthorsNoteRefusal("Only the session's owner can change the author's note.")
	if (!(await offeredFor(db, row.genreId)))
		throw new AuthorsNoteRefusal("This kind of session has no author's note.")
	const note = readAuthorsNoteValue(value)
	if (!note) throw new AuthorsNoteRefusal("The author's note was not readable.")
	const { changed, genreFields } = await db.transaction(async (tx) => {
		const [current] = await tx
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		const stored = (current?.genreFields ?? {}) as Record<string, unknown>
		const before = readAuthorsNoteValue(stored.authorsNote)
		if (JSON.stringify(before) === JSON.stringify(note))
			return { changed: false, genreFields: stored }
		const next = { ...stored, authorsNote: note }
		await tx
			.update(schema.sessions)
			.set({ genreFields: next, updatedAt: new Date().toISOString() })
			.where(eq(schema.sessions.id, sessionId))
		return { changed: true, genreFields: next }
	})
	return { answer: await readSessionAuthorsNote(db, sessionId, userId), changed, genreFields }
}
