/**
 * The Places lens, as arithmetic (plan places-graph §10.2, B4).
 *
 * The lens is the lore graph canvas drawing the book's places: **every** place
 * on the line being read is a node — including one nothing joins yet, so two
 * unlinked places can be joined by an ⌥-drag — and every relationship with a
 * place at an end is an edge, whatever its relationship type. The cast
 * members and the other lore a relationship joins to a place come with it (a
 * region that is only lore, a keeper); a relationship that touches no place
 * (two members, two factions) is the Graph lens's, not this one's.
 *
 * ⚠ **Resolved rows.** The places and the other lore are the workspace's rows
 * read through its one resolver (`LorebooksWorkspace` `resolveRows`): on the
 * line, as of the moment. So an amended name is the node's name, and a place
 * archived as of the moment is not drawn. The relationships' own copy of an
 * entry's name is the base row's, which is why every name here is looked up.
 *
 * A place is never filed under anything, so nothing here nests: "inside" is
 * words on a line (`is inside` / `holds`), drawn like any other.
 */

import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { placeDraft } from "../sections/entryDrafts"
import {
	entryKey,
	graphEdges,
	graphNodes,
	type CastNodeLike,
	type EndpointLike,
	type GraphEdge,
	type GraphNode,
	type RelationshipLike
} from "../graphs/graphModel"

/** A place, as little of its resolved row as the lens needs. */
export interface PlaceRowLike {
	id: number
	name?: string | null
	/** Archived as of the moment being read (a dated archive included). */
	archived?: boolean | null
	/** "a floor, a district, a wing" — tints the node and filters the lens. */
	category?: string | null
}

/** Any other entry of the book, as little of its resolved row as naming needs. */
export interface LoreRowLike {
	id: number
	name?: string | null
	archived?: boolean | null
}

export interface PlaceGraphInput {
	/** The book's places on the line being read, resolved at the moment. */
	places: readonly PlaceRowLike[]
	/**
	 * Every other entry on the line, resolved at the moment. An entry end that
	 * is not here (archived, another line's, gone) is not drawn.
	 */
	otherEntries: readonly LoreRowLike[]
	/** The book's cast rows; only those joined to a drawn place are drawn. */
	cast: readonly CastNodeLike[]
	/** The relationships on the line, at the moment (`edgesAtMoment`). */
	relationships: readonly RelationshipLike[]
	/** Narrow the places to one category (case-insensitive); null is all. */
	category?: string | null
	/** Relationships this session's build proposed, marked as new. */
	newIds?: ReadonlySet<number>
}

export interface PlaceGraph {
	nodes: GraphNode[]
	edges: GraphEdge[]
	/** The places drawn, after the category filter. */
	placeCount: number
	/** Every live place on the line, before it. */
	placeTotal: number
	/** Drawn places no edge reaches. */
	placesWithNoLinks: number
	/** The ids of the places drawn. */
	placeIds: ReadonlySet<number>
	/** Each category the live places carry, once, sorted. */
	categories: string[]
	/**
	 * The category narrowing the places, as the places first wrote it, or
	 * null. One no live place carries (renamed, archived away) narrows
	 * nothing.
	 */
	category: string | null
}

const trimmed = (value: string | null | undefined) => (value ?? "").trim()
const categoryKey = (value: string | null | undefined) =>
	trimmed(value).toLowerCase()

const nameOfRow = (row: { id: number; name?: string | null }) =>
	trimmed(row.name) || `#${row.id}`

/** A place row, as a node — what a place just made is drawn and picked as. */
export function placeNode(row: PlaceRowLike): GraphNode {
	const category = trimmed(row.category)
	return {
		key: entryKey(row.id),
		kind: "entry",
		id: row.id,
		name: nameOfRow(row),
		state: "active",
		visibility: "normal",
		typeId: LOCATION_TYPE_ID,
		...(category ? { category } : {})
	}
}

/** The relationships with one of these places at an end. */
export function relationshipsOfPlaces<
	R extends Pick<RelationshipLike, "from" | "to">
>(relationships: readonly R[], placeIds: ReadonlySet<number>): R[] {
	const isPlace = (end: EndpointLike) =>
		end.kind === "entry" && placeIds.has(end.entryId)
	return relationships.filter((rel) => isPlace(rel.from) || isPlace(rel.to))
}

export function buildPlaceGraph(input: PlaceGraphInput): PlaceGraph {
	const live = input.places.filter((row) => !row.archived)

	// One category per spelling-insensitive key, named as first written.
	const categoryByKey = new Map<string, string>()
	for (const row of live) {
		const key = categoryKey(row.category)
		if (key && !categoryByKey.has(key))
			categoryByKey.set(key, trimmed(row.category))
	}
	const categories = [...categoryByKey.values()].sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base" })
	)

	const asked = categoryKey(input.category)
	const wanted = categoryByKey.has(asked) ? asked : ""
	const drawn = wanted
		? live.filter((row) => categoryKey(row.category) === wanted)
		: live
	const placeIds = new Set(drawn.map((row) => row.id))
	const placeNames = new Map(drawn.map((row) => [row.id, nameOfRow(row)]))
	const loreNames = new Map(
		input.otherEntries
			.filter((row) => !row.archived)
			.map((row) => [row.id, nameOfRow(row)])
	)
	const castIds = new Set(input.cast.map((row) => row.id))

	const drawable = (end: EndpointLike) =>
		end.kind === "cast"
			? castIds.has(end.bindingId)
			: placeIds.has(end.entryId) || loreNames.has(end.entryId)
	/** The end, named by its resolved row rather than the edge's base copy. */
	const named = (end: EndpointLike): EndpointLike =>
		end.kind === "cast"
			? end
			: {
					...end,
					name:
						placeNames.get(end.entryId) ??
						loreNames.get(end.entryId) ??
						end.name
				}

	const relationships = relationshipsOfPlaces(input.relationships, placeIds)
		.filter((rel) => drawable(rel.from) && drawable(rel.to))
		.map((rel) => ({ ...rel, from: named(rel.from), to: named(rel.to) }))

	const joinedCast = new Set<number>()
	for (const rel of relationships)
		for (const end of [rel.from, rel.to])
			if (end.kind === "cast") joinedCast.add(end.bindingId)

	const nodes = graphNodes({
		cast: input.cast.filter((row) => joinedCast.has(row.id)),
		relationships,
		scopeEntries: [],
		alwaysEntries: drawn.map((row) => ({
			id: row.id,
			name: nameOfRow(row),
			typeId: LOCATION_TYPE_ID,
			category: trimmed(row.category) || null
		}))
	})
	const edges = graphEdges(
		relationships,
		new Set(nodes.map((n) => n.key)),
		input.newIds
	)

	const reached = new Set<string>()
	for (const edge of edges) reached.add(edge.fromKey).add(edge.toKey)

	return {
		nodes,
		edges,
		placeCount: drawn.length,
		placeTotal: live.length,
		placesWithNoLinks: drawn.filter((row) => !reached.has(entryKey(row.id)))
			.length,
		placeIds,
		category: wanted ? categoryByKey.get(wanted)! : null,
		categories
	}
}

/**
 * What the other end of a new relationship may be: the canvas's nodes, then
 * every live place on the line that is not already one of them (a place the
 * category filter hides is still somewhere a way can lead), then `others` —
 * on the Places lens, the whole cast, so a place's first keeper or resident
 * can be linked from the map before anything joins them to it. Each once.
 */
export function linkCandidates(
	canvasNodes: readonly GraphNode[],
	places: readonly PlaceRowLike[],
	others: readonly GraphNode[] = []
): GraphNode[] {
	const out: GraphNode[] = []
	const seen = new Set<string>()
	const offer = (node: GraphNode) => {
		if (seen.has(node.key)) return
		seen.add(node.key)
		out.push(node)
	}
	for (const node of canvasNodes) offer(node)
	for (const row of places) if (!row.archived) offer(placeNode(row))
	for (const node of others) offer(node)
	return out
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/** The drawing, said out loud above it. */
export function placeGraphHeadline(
	graph: PlaceGraph,
	category: string | null
): string {
	if (graph.placeTotal === 0)
		return "Places · none yet · New place adds the first"
	const count =
		graph.placeCount === graph.placeTotal
			? plural(graph.placeTotal, "place", "places")
			: `${graph.placeCount} of ${graph.placeTotal} places`
	const parts = [
		"Places",
		category ? `${count} in ${category}` : count,
		plural(graph.edges.length, "link", "links")
	]
	if (graph.placesWithNoLinks > 0)
		parts.push(`${graph.placesWithNoLinks} with no links`)
	return parts.join(" · ")
}

/**
 * What making a place sends — the one way a place is made on the spot (the
 * canvas's **New place** / **New place…**, a place's **Link a place**): the
 * Places door's own draft (`placeDraft`), named, on the line being read.
 */
export function newPlaceEntry(
	lorebookId: number,
	name: string,
	/** The line being read; null is main, which sends no line. */
	branchId: number | null
): Sockets.Entries.Create.Params {
	return {
		entry: {
			...placeDraft(lorebookId),
			name: name.trim(),
			...(branchId != null ? { branchId } : {})
		} as Sockets.Entries.Create.Params["entry"]
	}
}
