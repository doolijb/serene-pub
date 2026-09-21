/**
 * Writing a session's numbers onto the world's timeline (R8).
 *
 * ## Two sources of rows, and only one of them survives the session
 *
 * A session-layer row is per change, anchored to a message, and cascades with
 * its session — that is play, and play is meant to be retractable. A **durable**
 * row is the same shape filed against the *world*: owner `cast_member` or
 * `lorebook`, anchored to a history entry and a scene rather than to a message,
 * with `source_session_id` / `source_message_id` as **plain ints with no keys**
 * so the row outlives the session that produced it. That is what makes "she was
 * at 4 health when the bell drowned" a fact about the story rather than about a
 * chat log somebody might delete.
 *
 * ## Three writers, one function
 *
 * Scene capture (automatic, and reviewable like every other capture), the
 * session-delete safeguard (the last row before the cascade takes everything
 * else), and a manual *record now* mark. Three moments, one write: three
 * implementations of "and then record it" is how the delete safeguard ends up
 * recording a different set of slots from the capture beside it.
 *
 * ## No lorebook, no timeline
 *
 * A session with no world has nowhere to record to, and its state dies with it.
 * That is correct and not a gap (R8): there is no world for the numbers to be
 * true *of*, and inventing one to hold them would be inventing a world nobody
 * asked for.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	configFor,
	sessionLinks,
	valueOf,
	vocabularyFor
} from "$lib/server/state/resolve"
import { newestMessageId } from "$lib/server/state/write"

/** Why a row is being recorded — the ledger reads it, and it is not a status. */
export type RecordReason = "scene" | "delete" | "mark"

export interface RecordOptions {
	reason: RecordReason
	/** The captured moment, when a capture is what asked. */
	sceneId?: number | null
	/** The story-clock anchor. Null when this session has no history entry to file under. */
	historyEntryId?: number | null
	/** Ledger narration for the whole recording. */
	note?: string | null
}

export interface RecordReport {
	/** False when there was no world to record to — the ordinary case for a chat. */
	recorded: boolean
	values: number
	configs: number
	/** Which owners got rows: `lorebook:3`, `cast_member:12`. */
	owners: string[]
	historyEntryId: number | null
	sceneId: number | null
}

/**
 * Record what this session's numbers are now, onto the world's timeline.
 *
 * ⚠ **Values and configurations both**, and that is not belt and braces: a
 * value is only meaningful against the configuration it was written under — a
 * 35 means one thing under a cap of 40 and is impossible under a cap of 20 —
 * and the plan's rule is that a value validates against the config valid at its
 * own anchor. Recording the value alone would put a number on the timeline with
 * no way to ever say what it meant.
 *
 * ⚠ A **derived** slot is never recorded. It has no value to store by
 * construction, and storing one guarantees staleness — the same rule
 * `checkSlotValue` refuses a write with.
 *
 * ⚠ Absent stays absent. A slot nobody has valued gets no row: "we did not
 * record a mood" and "her mood was nothing" are different claims, and only the
 * missing row can say the first.
 */
export async function recordToTimeline(
	db: Db,
	sessionId: number,
	opts: RecordOptions
): Promise<RecordReport> {
	const links = await sessionLinks(db, sessionId)
	const report: RecordReport = {
		recorded: false,
		values: 0,
		configs: 0,
		owners: [],
		historyEntryId: opts.historyEntryId ?? null,
		sceneId: opts.sceneId ?? null
	}
	// No world, no timeline. See the file header: this is the design, not a gap.
	if (!links.lorebookId) return report

	const vocabulary = await vocabularyFor(db, sessionId, links)
	const storable = vocabulary.entries
		.map((e) => e.decl)
		.filter((d) => d.type !== "derived")
	if (!storable.length) return report

	const sourceMessageId = await newestMessageId(db, sessionId)
	const updatedBy = `session:${sessionId}`
	const common = {
		branchId: await branchOf(db, sessionId),
		historyEntryId: report.historyEntryId,
		sceneId: report.sceneId,
		sourceSessionId: sessionId,
		sourceMessageId,
		updatedBy,
		// A durable row is NOT session-scoped: `session_id` is the column that
		// makes the session layer disappear with its session, and this row is
		// the one that must not.
		sessionId: null,
		validFromMessageId: null,
		note: opts.note ?? null
	}

	/** One owner's whole state, read from the session and filed against the world. */
	const record = async (
		read: { kind: "session" | "session_cast"; id: number },
		write: { kind: "lorebook" | "cast_member"; id: number },
		facet: "world" | "cast"
	) => {
		let wrote = false
		for (const decl of storable) {
			if (!decl.appliesTo.includes(facet)) continue
			const value = await valueOf(db, {
				sessionId,
				owner: read,
				slotId: decl.id
			})
			if (value === undefined) continue
			await db.insert(schema.attributeValues).values({
				ownerKind: write.kind,
				ownerId: write.id,
				slotId: decl.id,
				value: { v: value },
				...common
			})
			report.values++
			// The configuration in force, as the whole resolved thing rather
			// than as this layer's deviations: a timeline row has no layers
			// underneath it to inherit from, so a deviation alone would resolve
			// to something different the day the declaration's own config moves.
			await db.insert(schema.attributeConfigs).values({
				ownerKind: write.kind,
				ownerId: write.id,
				slotId: decl.id,
				config: await configFor(db, {
					sessionId,
					owner: read,
					slotId: decl.id
				}),
				...common
			})
			report.configs++
			wrote = true
		}
		if (wrote) report.owners.push(`${write.kind}:${write.id}`)
	}

	await record(
		{ kind: "session", id: sessionId },
		{ kind: "lorebook", id: links.lorebookId },
		"world"
	)
	for (const member of links.cast) {
		// Only a character bound into this world has a versioned cast member to
		// live beside. One that is not bound has nowhere on the timeline to be,
		// and inventing a binding here would be inventing a cast member the
		// author never put in their world.
		if (!member.castMemberId) continue
		await record(
			{ kind: "session_cast", id: member.characterId },
			{ kind: "cast_member", id: member.castMemberId },
			"cast"
		)
	}

	report.recorded = report.values > 0 || report.configs > 0
	return report
}

/**
 * Which branch of the world's history this session is on.
 *
 * Null today, always: `lorebook_branches` does not exist yet (R8), and the
 * column is here so the writers fill it the day it does rather than needing a
 * back-fill over rows nobody can date. Written as a function rather than a
 * literal so there is one place to change.
 */
async function branchOf(_db: Db, _sessionId: number): Promise<number | null> {
	return null
}

/**
 * The history entry a session's own moments hang from, or null.
 *
 * The newest scene the session has captured names one; a session that has never
 * been captured has none, and a null anchor is the honest answer — "this was
 * true at some point in this session" rather than a moment nobody wrote.
 */
export async function newestHistoryEntryOf(
	db: Db,
	sessionId: number
): Promise<{ historyEntryId: number | null; sceneId: number | null }> {
	const rows = await db
		.select({
			id: schema.scenes.id,
			historyEntryId: schema.scenes.historyEntryId
		})
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
	let best: { id: number; historyEntryId: number } | undefined
	for (const row of rows) if (!best || row.id > best.id) best = row
	return {
		historyEntryId: best?.historyEntryId ?? null,
		sceneId: best?.id ?? null
	}
}
