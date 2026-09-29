/**
 * The edges that are not the cast graph.
 *
 * `collectGraphLayers` walks outward from the speaker's node and answers "what
 * are this character's ties" — a question an entry endpoint cannot be part of,
 * because a place has no perspective, no visibility to be filtered through and
 * no cast seat. An edge may join two entries, or a character and an entry, and
 * those edges are read here instead: a flat list of the ones with an entry on
 * at least one end, with both ends already named.
 *
 * Its one reader is `core:query/relationship-search@1`'s link hop, which turns
 * an edge touching an entry the lore mechanisms chose this turn into a
 * candidate for the other end. One hop and no more — the hop expands chosen
 * entries, never the entries it just produced.
 *
 * ## Which edges (finding #151)
 *
 * An edge is a fact of ONE story, so it is read the way the session reads its
 * book (`sessionReadingOf`): on the session's line — shared, or the chain's
 * own, a dated edge (its `history_entry_id`) cut at the session's moment and
 * at its step's fork (`rowsOnReading`, the same rule durable stats take) — and
 * only while it stands (`status` active; a resolved, broken or evolved edge is
 * the story's past). A `secret` edge is one side's private stance and the hop
 * has no side to speak from, so it never carries one. Both ends must be of
 * this book and, when an end is an entry, a live one on the line: a hop to an
 * archived room, or to a sibling fork's, is a hop to nowhere this session is.
 *
 * Whether the FAR end may be shown to the speaker (character lore that is not
 * theirs) is the caller's to ask of its own `lorebook_entries` read — the one
 * privacy gate — never re-derived here.
 */

import { and, eq, inArray, isNotNull, ne, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rowsOnReading, sessionReadingOf } from "$lib/server/state/reading"
import {
	MAIN_HEAD,
	entryAt,
	entryOnLineSql,
	entryOverlaysFor
} from "$lib/server/state/entriesOnReading"

/** One end of an edge, named. */
export interface GraphEntryLinkEnd {
	kind: "cast" | "entry"
	id: number
	name: string
}

/** One edge with an entry on at least one end. */
export interface GraphEntryLink {
	/** `narrative_relationships.id` — what a candidate is addressed by. */
	id: number
	relationshipType: string
	description: string
	visibility: string
	status: string
	/** When the row last changed, as epoch milliseconds. */
	updatedAt: number
	from: GraphEntryLinkEnd
	to: GraphEntryLinkEnd
}

/**
 * Every entry-touching edge of one session's lorebook.
 *
 * `null` when the session has no lorebook, which is the same answer
 * `graph_relationships` gives and means "there is no graph here" rather than
 * "there is one and it is empty".
 */
export async function readGraphEntryLinks(
	db: Db,
	sessionId: number
): Promise<GraphEntryLink[] | null> {
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session?.lorebookId) return null
	const lorebookId = session.lorebookId
	const reading = (await sessionReadingOf(db, sessionId)) ?? {
		lorebookId,
		...MAIN_HEAD
	}

	const r = schema.narrativeRelationships
	const standing = await db
		.select()
		.from(r)
		.where(
			and(
				eq(r.lorebookId, lorebookId),
				or(isNotNull(r.fromEntryId), isNotNull(r.toEntryId)),
				eq(r.status, "active"),
				ne(r.visibility, "secret")
			)
		)
	// The line, with the moment and the fork cuts: the same rule durable
	// rows take, by the edge's history entry. A session row (`sessionId`)
	// does not exist on edges, so every one is judged.
	const onLine = await rowsOnReading(db, standing, reading)
	if (onLine.length === 0) return []

	// Both ends, named, in two queries rather than one per end: a book with a
	// hundred roads would otherwise be two hundred reads for a list this long.
	const entryIds = [
		...new Set(
			onLine.flatMap((r) =>
				[r.fromEntryId, r.toEntryId].filter(
					(id): id is number => id != null
				)
			)
		)
	]
	const nodeIds = [
		...new Set(
			onLine.flatMap((r) =>
				[r.fromNodeId, r.toNodeId].filter(
					(id): id is number => id != null
				)
			)
		)
	]
	const [entries, nodes, overlays] = await Promise.all([
		entryIds.length
			? db
					.select({
						id: schema.lorebookEntries.id,
						title: schema.lorebookEntries.title,
						enabled: schema.lorebookEntries.enabled,
						archived: schema.lorebookEntries.archived
					})
					.from(schema.lorebookEntries)
					.where(
						and(
							inArray(schema.lorebookEntries.id, entryIds),
							// Same book, on the line: an end anywhere else is
							// not a place this session's story has.
							eq(schema.lorebookEntries.lorebookId, lorebookId),
							entryOnLineSql(reading)
						)
					)
			: [],
		nodeIds.length
			? db
					.select({
						id: schema.lorebookBindings.id,
						name: schema.lorebookBindings.name
					})
					.from(schema.lorebookBindings)
					.where(
						and(
							inArray(schema.lorebookBindings.id, nodeIds),
							eq(schema.lorebookBindings.lorebookId, lorebookId)
						)
					)
			: [],
		entryOverlaysFor(db, lorebookId, reading, entryIds)
	])
	// Each end as the reading sees it: its amended title, and Off/archived
	// as amended by then. A switched-off or shelved end drops the edge.
	const entryNames = new Map<number, string>()
	for (const e of entries) {
		const seen = entryAt(
			{ id: e.id, name: e.title ?? "", enabled: e.enabled, archived: e.archived },
			overlays,
			reading
		)
		if (seen.enabled === false || seen.archived === true) continue
		entryNames.set(e.id, typeof seen.name === "string" ? seen.name : "")
	}
	const nodeNames = new Map(nodes.map((n) => [n.id, n.name]))
	const live = (nodeId: number | null, entryId: number | null) =>
		entryId != null ? entryNames.has(entryId) : nodeId != null && nodeNames.has(nodeId)

	const end = (
		nodeId: number | null,
		entryId: number | null
	): GraphEntryLinkEnd =>
		entryId != null
			? {
					kind: "entry",
					id: entryId,
					name: entryNames.get(entryId) ?? ""
				}
			: {
					kind: "cast",
					id: nodeId!,
					name: nodeNames.get(nodeId!) ?? ""
				}

	return onLine
		.filter((r) => live(r.fromNodeId, r.fromEntryId) && live(r.toNodeId, r.toEntryId))
		.map((r) => ({
		id: r.id,
		relationshipType: r.relationshipType,
		description: r.description,
		visibility: r.visibility,
		status: r.status,
		updatedAt: r.updatedAt.getTime(),
		from: end(r.fromNodeId, r.fromEntryId),
		to: end(r.toNodeId, r.toEntryId)
	}))
}
