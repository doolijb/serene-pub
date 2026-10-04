/**
 * The one guard every writer of a relationship row (`narrative_relationships`)
 * goes through: `narrativeGraph:createRelationship`, `:updateRelationship` and
 * `:deleteRelationship`, and the host's `writeLoreLink` — which serves both
 * `link-lore-entries@1` and `create-lore-entry@1`'s `links`
 * (plan B0, places-graph 2026-09-29).
 *
 * What it holds today:
 *
 * - **No self-link**, for both kinds of end — two entry ends, or two cast
 *   ends, naming one row. An entry-ended self-loop is meaningless (a room that
 *   leads to itself); a cast one is a tie with nobody. ⚠ Cast self-loops are
 *   refused HERE only, never by a CHECK: a 0.5.x import can still carry one,
 *   and only the cast merge deletes those. An update that leaves both ends
 *   alone is therefore not re-judged, so such a row can still be reworded or
 *   deleted.
 * - **The line.** A relationship belongs to the line it was drawn on
 *   (`branch_id`, null = main). An update or delete must come from that line —
 *   the one the client says it is reading. Changing another line's row from
 *   here would rewrite that line, main included; the canvas's
 *   `relLockedReason` said so, and now the server does.
 * - **One row per way (plan B1).** A relationship with an entry at either end
 *   is refused when a row on the same line, at the same date, with the same
 *   name (case aside) already says what it would say — the same words read
 *   from the same end. That is the same link again, or its **mirror**: a row
 *   drawn from the far end whose words one already says ("connects to" drawn
 *   back from the other room, or a way back that is the first row's own
 *   relationship type). So one two-way door is one row with one name and one
 *   description. The exact duplicate is also the partial unique index
 *   `narrative_relationships_entry_pair_uq`; a mirror no index can see.
 *   Only judged when the writer states what the row says (`saying`). The
 *   host's `writeLoreLink` asks a session's question instead —
 *   `linksOnReadingThatWay`, across the lines and dates the session reads —
 *   and answers with the standing row's id when it says everything asked,
 *   which is what makes the lore-link outlets idempotent (places plan B2).
 * - **A deleted date folds its twins.** Deleting a history entry un-dates the
 *   links it dated (`SET NULL`), which can make one link twice;
 *   `foldRelationshipsUndatedBy` runs first in every delete of entries.
 *
 * Nothing restricts which entry types may relate: any entry may relate to any
 * entry, as before.
 */

import {
	and,
	eq,
	isNull,
	ne,
	or,
	sql,
	type AnyColumn,
	type SQL
} from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { rowsOnReading, type LineReading } from "$lib/server/state/reading"

/** A relationship's two ends, as its columns hold them: a cast member (`node`) or an entry. */
export interface RelationshipEnds {
	fromNodeId: number | null
	fromEntryId: number | null
	toNodeId: number | null
	toEntryId: number | null
}

/**
 * What a relationship says, as the one-row-per-way check compares it: its
 * book, line and date, its name, and its words from each end.
 */
export interface RelationshipSaying {
	lorebookId: number
	/** The line. Null is main. */
	branchId: number | null
	/** Its date (a history entry). Null is undated. */
	historyEntryId: number | null
	/** Its name (column `title`, `name` on the wire). Empty is unnamed. */
	title: string
	/** Its words read from the `from` end. */
	relationshipType: string
	/** Its words read from the `to` end. Null is one way. */
	reverseRelationshipType: string | null
}

/** One write, as the guard judges it. */
export type RelationshipWrite =
	| {
			op: "create"
			/** The ends the new row will have. */
			ends: RelationshipEnds
			/** Who asks — a node's key — prefixed to a refusal; absent for a socket. */
			where?: string
			/**
			 * What the new row will say. Given, a row that already says it is
			 * refused (one row per way); absent, that is not judged.
			 */
			saying?: RelationshipSaying
	  }
	| {
			op: "update"
			/** The row as it stands. */
			row: RelationshipEnds & { id: number; branchId: number | null }
			/**
			 * The ends after the update when it moves one; null when it leaves
			 * both where they were — judged by value, since a client may resend
			 * the ends it read.
			 */
			ends: RelationshipEnds | null
			/** The line the writer reads. Null is main. */
			line: number | null
			/**
			 * What the row will say, when the update changes it (its ends, words,
			 * name or date); absent or null when it does not — a resent row is
			 * not judged again.
			 */
			saying?: RelationshipSaying | null
	  }
	| {
			op: "delete"
			row: { branchId: number | null }
			/** The line the writer reads. Null is main. */
			line: number | null
	  }

/** Two ends that name one row, of either kind. */
const joinsItself = (ends: RelationshipEnds): boolean =>
	(ends.fromEntryId != null && ends.fromEntryId === ends.toEntryId) ||
	(ends.fromNodeId != null && ends.fromNodeId === ends.toNodeId)

/** A line as a person reads it: main, or the branch's name. */
async function lineName(tx: Db, branchId: number | null): Promise<string> {
	if (branchId == null) return "main"
	const [branch] = await tx
		.select({ name: schema.lorebookBranches.name })
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.id, branchId))
		.limit(1)
	return branch?.name ?? "another line"
}

/**
 * The guard's refusal: a sentence for the person, never a fault. A writer that
 * goes on past a refused row (the merge's undo leaves it out and counts it)
 * catches this class and nothing else, so a bug still fails the write.
 */
export class RelationshipRefusal extends Error {}

/**
 * Refuse a relationship write the guards forbid, with a sentence
 * (`RelationshipRefusal`).
 *
 * `tx` is the writer's own handle — its transaction when it has one — so a
 * read here sees what the write sees.
 */
export async function assertRelationshipWrite(
	tx: Db,
	write: RelationshipWrite
): Promise<void> {
	const refuse = (sentence: string): never => {
		throw new RelationshipRefusal(
			write.op === "create" && write.where
				? `${write.where}: ${sentence}`
				: sentence
		)
	}
	if (write.op !== "create") {
		const owner = write.row.branchId ?? null
		if (owner !== (write.line ?? null))
			refuse(
				`This relationship belongs to ${await lineName(tx, owner)}. Open that line to change it.`
			)
	}
	const ends = write.op === "delete" ? null : write.ends
	if (ends && joinsItself(ends)) refuse("Nothing can be linked to itself.")
	if (write.op === "create" && write.saying) {
		if ((await findLinkedThatWay(tx, write.ends, write.saying)) != null)
			refuse(LINKED_THAT_WAY)
	}
	if (write.op === "update" && write.saying) {
		const after = write.ends ?? write.row
		if (
			(await findLinkedThatWay(tx, after, write.saying, write.row.id)) !=
			null
		)
			refuse(LINKED_THAT_WAY)
	}
}

/** The refusal of a second row for one way. */
export const LINKED_THAT_WAY = "These two are already linked that way."

/** Whether a relationship has an entry at either end — a lore link. */
export const hasEntryEnd = (ends: RelationshipEnds): boolean =>
	ends.fromEntryId != null || ends.toEntryId != null

/**
 * The id of a row that already says what `saying` would say between `ends`,
 * or null.
 *
 * Same book, same line, same date, same name (case aside), and one sentence
 * in common read from the same end:
 *
 * - **the same way round** (A→B): the same relationship type, or — both being
 *   two-way — the same reverse relationship type;
 * - **the other way round** (B→A): its reverse type is the requested
 *   relationship type, or its relationship type is the requested reverse.
 *
 * ⚠ A tie between two cast members is never judged (null): a cast pair's
 * versions and perspectives are several rows by design, and it carries no
 * reverse. `exceptId` leaves out the row being updated.
 */
export async function findLinkedThatWay(
	tx: Db,
	ends: RelationshipEnds,
	saying: RelationshipSaying,
	exceptId?: number
): Promise<number | null> {
	if (!hasEntryEnd(ends)) return null
	const r = schema.narrativeRelationships
	const [found] = await tx
		.select({ id: r.id })
		.from(r)
		.where(
			and(
				eq(r.lorebookId, saying.lorebookId),
				saying.branchId == null
					? isNull(r.branchId)
					: eq(r.branchId, saying.branchId),
				saying.historyEntryId == null
					? isNull(r.historyEntryId)
					: eq(r.historyEntryId, saying.historyEntryId),
				wordsAre(r.title, saying.title),
				sharesASentence(ends, saying),
				exceptId != null ? ne(r.id, exceptId) : undefined
			)
		)
		.limit(1)
	return found?.id ?? null
}

/** A column's words, case aside, as a test. */
const wordsAre = (column: AnyColumn, words: string): SQL =>
	sql`lower(${column}) = lower(${words}::text)`

/**
 * The test `findLinkedThatWay` names: a row between `ends` (either way round)
 * with one sentence in common with `saying`, read from the same end. The book,
 * line, date and name are the caller's.
 */
function sharesASentence(
	ends: RelationshipEnds,
	saying: Pick<RelationshipSaying, "relationshipType" | "reverseRelationshipType">
): SQL {
	const r = schema.narrativeRelationships
	/** One end of the row, as a column test. */
	const endIs = (
		node: AnyColumn,
		entry: AnyColumn,
		nodeId: number | null,
		entryId: number | null
	): SQL => (entryId != null ? eq(entry, entryId) : eq(node, nodeId!))
	const type = saying.relationshipType
	const reverse = saying.reverseRelationshipType
	const sameWay = and(
		endIs(r.fromNodeId, r.fromEntryId, ends.fromNodeId, ends.fromEntryId),
		endIs(r.toNodeId, r.toEntryId, ends.toNodeId, ends.toEntryId),
		reverse != null
			? or(
					wordsAre(r.relationshipType, type),
					wordsAre(r.reverseRelationshipType, reverse)
				)
			: wordsAre(r.relationshipType, type)
	)
	const otherWay = and(
		endIs(r.fromNodeId, r.fromEntryId, ends.toNodeId, ends.toEntryId),
		endIs(r.toNodeId, r.toEntryId, ends.fromNodeId, ends.fromEntryId),
		reverse != null
			? or(
					wordsAre(r.reverseRelationshipType, type),
					wordsAre(r.relationshipType, reverse)
				)
			: wordsAre(r.reverseRelationshipType, type)
	)
	return or(sameWay, otherWay)!
}

/**
 * A relationship a session's reading already holds that a new lore link would
 * say again — one row `linksOnReadingThatWay` answers with.
 */
export interface LinkOnReading {
	id: number
	/**
	 * The row's own `from` end. On a mirror (drawn from the far end) it is
	 * the requested `to`, never the requested `from`.
	 */
	fromEntryId: number | null
	/**
	 * It says everything the request says: the same relationship type read
	 * from the same end and, when the request is two-way, the same reverse —
	 * the same link again, or its true mirror. False is a row that shares ONE
	 * sentence and not the rest (a one-way door where both ways was asked).
	 */
	saysAll: boolean
	/**
	 * Active and not secret — what the session's prompts and relationship hop
	 * read (`readGraphEntryLinks`). A resolved, broken or secret row still
	 * holds the words, so a second row may not say them again.
	 */
	standing: boolean
	status: string
	visibility: string
}

/**
 * The relationships a session's READING already holds that say something
 * `saying` would say between `ends` (places plan B2, review round): the
 * question the lore-link outlets ask before they write, so that a re-run
 * never stacks a room's ways out *as the session reads them*.
 *
 * `findLinkedThatWay` keys on one line and one date, as the unique index does
 * — right for a person drawing on the line they have open, and wrong for a
 * session: a fork reads main's links drawn before its fork, and every session
 * reads a link dated at or before its moment. So this looks across the book —
 * every line, every date — for a row with the same name (case aside) and one
 * sentence in common read from the same end, and keeps the ones the reading
 * sees (`rowsOnReading`: the line's chain, its fork cuts, its moment). The
 * session's own line undated is always among them, so a row the unique index
 * would refuse is always found here first.
 *
 * Each is said to say ALL of the request or only part of it, and to stand or
 * not; what to do with a partial or no-longer-standing row is the caller's.
 *
 * ⚠ A row the reading does not see yet (dated after the moment, or on a line
 * forked from this one) is not found, so a link written now can meet its twin
 * there later — the same as the socket's per-line judgement.
 */
export async function linksOnReadingThatWay(
	tx: Db,
	ends: RelationshipEnds,
	saying: Pick<
		RelationshipSaying,
		"lorebookId" | "title" | "relationshipType" | "reverseRelationshipType"
	>,
	reading: LineReading
): Promise<LinkOnReading[]> {
	if (!hasEntryEnd(ends)) return []
	const r = schema.narrativeRelationships
	const rows = await tx
		.select({
			id: r.id,
			fromNodeId: r.fromNodeId,
			fromEntryId: r.fromEntryId,
			relationshipType: r.relationshipType,
			reverseRelationshipType: r.reverseRelationshipType,
			status: r.status,
			visibility: r.visibility,
			branchId: r.branchId,
			historyEntryId: r.historyEntryId
		})
		.from(r)
		.where(
			and(
				eq(r.lorebookId, saying.lorebookId),
				wordsAre(r.title, saying.title),
				sharesASentence(ends, saying)
			)
		)
		.orderBy(r.id)
	if (rows.length === 0) return []
	const seen = await rowsOnReading(tx, rows, reading)
	const same = (a: string | null, b: string | null): boolean =>
		a != null && b != null && a.toLowerCase() === b.toLowerCase()
	const type = saying.relationshipType
	const reverse = saying.reverseRelationshipType
	return seen.map((row) => {
		const sameWayRound =
			row.fromEntryId === ends.fromEntryId &&
			row.fromNodeId === ends.fromNodeId
		const saysAll = sameWayRound
			? same(row.relationshipType, type) &&
				(reverse == null || same(row.reverseRelationshipType, reverse))
			: same(row.reverseRelationshipType, type) &&
				(reverse == null || same(row.relationshipType, reverse))
		return {
			id: row.id,
			fromEntryId: row.fromEntryId,
			saysAll,
			standing: row.status === "active" && row.visibility !== "secret",
			status: row.status,
			visibility: row.visibility
		}
	})
}

/**
 * Before entries are deleted: fold the entry↔entry relationships the delete
 * would make twins. Call it in the delete's own transaction, just before the
 * delete, with the delete's own condition on `lorebook_entries` (`deleting`).
 * Every entry filed under those is counted too, as the `anchor_entry_id`
 * cascade takes them in the same statement.
 *
 * A relationship dated by a history entry keeps its row when that entry goes:
 * `history_entry_id` is `ON DELETE SET NULL`, so the row turns undated. The
 * date is part of the one-row-per-way key (`narrative_relationships_entry_pair_uq`),
 * so a link that also stands undated, or at a second date going in the same
 * delete, would become its own twin, and the whole delete would fail on a raw
 * unique violation: a timeline event that could not be deleted, a fork that
 * could not be deleted. One row survives per group instead, by the rule 0193
 * folded stored duplicates with: the most description, then the oldest (lowest
 * id). A row the delete takes anyway (an end is going) may be folded too;
 * the result is the same.
 *
 * Cast rows are never folded: no index holds them. ⚠ A mirror the delete
 * leaves (a dated row and an undated row saying one way from both ends) is not
 * folded either; the writers refuse a new one, and either row can be deleted.
 *
 * Returns the ids it deleted.
 */
export async function foldRelationshipsUndatedBy(
	tx: Db,
	deleting: SQL
): Promise<number[]> {
	const rows = rawRows<{ id: number }>(
		await tx.execute(sql`
			WITH RECURSIVE gone(id) AS (
				SELECT "id" FROM "lorebook_entries" WHERE ${deleting}
				UNION
				SELECT e."id" FROM "lorebook_entries" e JOIN gone g ON e."anchor_entry_id" = g."id"
			),
			undated AS (
				SELECT r."id", r."lorebook_id", r."from_entry_id", r."to_entry_id"
				  FROM "narrative_relationships" r JOIN gone g ON r."history_entry_id" = g."id"
				 WHERE r."from_entry_id" IS NOT NULL AND r."to_entry_id" IS NOT NULL
			),
			ranked AS (
				SELECT r."id", row_number() OVER (
					PARTITION BY r."lorebook_id", r."from_entry_id", r."to_entry_id",
						lower(r."relationship_type"), lower(r."title"), coalesce(r."branch_id", 0),
						CASE WHEN r."history_entry_id" IN (SELECT "id" FROM gone) THEN 0
							ELSE coalesce(r."history_entry_id", 0) END
					ORDER BY length(r."description") DESC, r."id"
				) AS "rank"
				  FROM "narrative_relationships" r
				 WHERE EXISTS (
					SELECT 1 FROM undated u
					 WHERE u."lorebook_id" = r."lorebook_id"
					   AND u."from_entry_id" = r."from_entry_id"
					   AND u."to_entry_id" = r."to_entry_id"
				 )
			)
			DELETE FROM "narrative_relationships" d
			 USING ranked k
			 WHERE d."id" = k."id" AND k."rank" > 1
			RETURNING d."id"
		`)
	)
	return rows.map((r) => Number(r.id))
}
