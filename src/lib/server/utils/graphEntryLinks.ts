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
 */

import { and, eq, inArray, isNotNull, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

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

	const rows = await db
		.select()
		.from(schema.narrativeRelationships)
		.where(
			and(
				eq(
					schema.narrativeRelationships.lorebookId,
					session.lorebookId
				),
				or(
					isNotNull(schema.narrativeRelationships.fromEntryId),
					isNotNull(schema.narrativeRelationships.toEntryId)
				)
			)
		)
	if (rows.length === 0) return []

	// Both ends, named, in two queries rather than one per end: a book with a
	// hundred roads would otherwise be two hundred reads for a list this long.
	const entryIds = [
		...new Set(
			rows.flatMap((r) =>
				[r.fromEntryId, r.toEntryId].filter(
					(id): id is number => id != null
				)
			)
		)
	]
	const nodeIds = [
		...new Set(
			rows.flatMap((r) =>
				[r.fromNodeId, r.toNodeId].filter(
					(id): id is number => id != null
				)
			)
		)
	]
	const [entries, nodes] = await Promise.all([
		entryIds.length
			? db
					.select({
						id: schema.lorebookEntries.id,
						title: schema.lorebookEntries.title
					})
					.from(schema.lorebookEntries)
					.where(inArray(schema.lorebookEntries.id, entryIds))
			: [],
		nodeIds.length
			? db
					.select({
						id: schema.lorebookBindings.id,
						name: schema.lorebookBindings.name
					})
					.from(schema.lorebookBindings)
					.where(inArray(schema.lorebookBindings.id, nodeIds))
			: []
	])
	const entryNames = new Map(entries.map((e) => [e.id, e.title ?? ""]))
	const nodeNames = new Map(nodes.map((n) => [n.id, n.name]))

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

	return rows.map((r) => ({
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
